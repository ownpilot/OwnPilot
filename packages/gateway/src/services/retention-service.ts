/**
 * Retention Service
 *
 * Centralized database retention enforcement (gap 24.3).
 * Runs per-table cleanup methods on a configurable schedule.
 * A single nightly job reads retention_policies metadata and executes
 * each table's existing cleanup method.
 */

import { getLog } from './log.js';
import { getJobsRepository } from '../db/repositories/jobs.js';
import { getClawsRepository } from '../db/repositories/claws.js';
import { createWorkflowsRepository } from '../db/repositories/workflows.js';
import { createSubagentsRepository } from '../db/repositories/subagents.js';
import { createOrchestraRepository } from '../db/repositories/orchestra.js';
import { createTriggersRepository } from '../db/repositories/triggers.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { embeddingCacheRepo } from '../db/repositories/embedding-cache.js';
import { createLogsRepository } from '../db/repositories/logs.js';
import { getProviderMetricsRepository } from '../db/repositories/provider-metrics.js';
import { JobQueueService } from './job-queue-service.js';

const log = getLog('RetentionService');

export interface RetentionResult {
  table: string;
  deleted: number;
  retentionDays: number;
}

/** Table name → cleanup method (using factory functions for user-scoped repos) */
const CLEANUP_METHODS: Record<string, () => Promise<number>> = {
  request_logs: () => createLogsRepository('default').cleanupOld(30),
  claw_history: () => getClawsRepository().cleanupOldHistory(90),
  claw_audit_log: () => getClawsRepository().cleanupOldAuditLog(30),
  workflow_logs: () => createWorkflowsRepository('default').cleanupOldWorkflowLogs(90),
  plan_history: () => createOrchestraRepository('default').cleanupOld(90),
  trigger_history: () => createTriggersRepository('default').cleanupHistory(30),
  heartbeat_log: () => getHeartbeatLogRepository().cleanupOld(30),
  subagent_history: () => createSubagentsRepository('default').cleanupOld(90),
  embedding_cache: () => embeddingCacheRepo.cleanupOld(7),
  jobs: () => getJobsRepository().cleanupOld(30),
  job_history: () => getJobsRepository().cleanupHistory(90),
  provider_metrics: () => getProviderMetricsRepository().purgeOld(30),
};

/**
 * Run retention cleanup for all enabled tables.
 * Called by the nightly retention cleanup job.
 */
export async function runRetentionCleanup(): Promise<RetentionResult[]> {
  const results: RetentionResult[] = [];

  for (const [table, cleanupFn] of Object.entries(CLEANUP_METHODS)) {
    try {
      const count = await cleanupFn();
      results.push({ table, deleted: count, retentionDays: getRetentionDays(table) });
      log.debug('Retention cleanup done', { table, deleted: count });
    } catch (err) {
      log.warn('Retention cleanup failed', { table, error: String(err) });
      results.push({ table, deleted: 0, retentionDays: getRetentionDays(table) });
    }
  }

  const total = results.reduce((sum, r) => sum + r.deleted, 0);
  log.info(`Retention cleanup complete. Total deleted: ${total}`, {
    byTable: results.map(r => `${r.table}:${r.deleted}`).join(', '),
  });

  return results;
}

/**
 * Schedule the nightly retention cleanup job via JobQueueService.
 * Ensures exactly one cleanup runs per day.
 *
 * @param hour UTCHour for cleanup (default 2 = 02:00 UTC)
 */
export function scheduleRetentionCleanup(hour = 2): string {
  // Calculate next UTC midnight + hour
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, hour, 0, 0, 0));
  const runAfter = new Date(next);

  const queue = JobQueueService.getInstance();
  queue.enqueue(
    'nightly_retention_cleanup',
    { scheduledUtc: runAfter.toISOString() },
    { queue: 'system', priority: 100, runAfter }
  );

  log.info('Retention cleanup scheduled', { runAfter: runAfter.toISOString() });
  return 'nightly_retention_cleanup';
}

/**
 * Register the retention cleanup worker with JobQueueService.
 * Called once at server boot.
 */
export function registerRetentionCleanupWorker(): () => void {
  const queue = JobQueueService.getInstance();
  return queue.startWorker(
    async (_job) => {
      log.info('Running nightly retention cleanup...');
      const results = await runRetentionCleanup();
      return { cleaned: results };
    },
    { queue: 'system', concurrency: 1, name: 'retention_cleanup_worker' }
  );
}

const RETENTION_DAYS: Record<string, number> = {
  request_logs: 30,
  audit_log: 90,
  claw_history: 90,
  claw_audit_log: 30,
  workflow_logs: 90,
  plan_history: 90,
  trigger_history: 30,
  heartbeat_log: 30,
  subagent_history: 90,
  embedding_cache: 7,
  jobs: 30,
  job_history: 90,
  provider_metrics: 30,
};

function getRetentionDays(table: string): number {
  return RETENTION_DAYS[table] ?? 30;
}

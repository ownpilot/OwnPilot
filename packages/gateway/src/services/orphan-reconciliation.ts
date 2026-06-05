/**
 * Orphan Session Reconciliation
 *
 * At boot, autonomous systems (Claw, Plan, Workflow) may have
 * sessions that were running when the parent process was killed (OOM, crash,
 * SIGKILL, deploy). These sessions are "orphaned" — the DB reflects a running
 * state but no actual process is executing them.
 *
 * This module provides a single reconcileOrphanedSessions() call that scans
 * all relevant tables and marks orphans as aborted with a reason.
 * Called once at server boot, before any autonomous system starts.
 *
 * Also provides per-system reconciliation functions for use in health checks
 * and manual recovery.
 */

import { getLog } from './log.js';

const log = getLog('OrphanReconciliation');

// ============================================================================
// Constants
// ============================================================================

/**
 * Any session that has been in 'running' state without completing
 * for longer than this threshold is considered orphaned.
 * Set conservatively high to avoid false positives on long-running tasks.
 */
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

interface ReconciliationResult {
  system: string;
  orphaned: number;
  recovered: number;
  errors: string[];
}

// ============================================================================
// Claw Reconciliation
// ============================================================================

/**
 * Reconcile orphaned claw sessions.
 * Finds claw_sessions with state='running' and last_heartbeat older than ORPHAN_THRESHOLD_MS,
 * marks them as 'stopped' with reason 'orphan_recovery'.
 */
async function reconcileOrphanedClaws(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { system: 'claw', orphaned: 0, recovered: 0, errors: [] };

  try {
    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();

    const orphaned = await repo.getOrphanedSessions(ORPHAN_THRESHOLD_MS);
    result.orphaned = orphaned.length;

    for (const session of orphaned) {
      try {
        await repo.updateSessionStatus(session.id, 'stopped', 'orphan_recovery');
        result.recovered++;
        log.warn(`[reconcile] Claw orphan recovered: ${session.id} [${session.name}]`);
      } catch (err) {
        const msg = `Failed to reconcile claw ${session.id}: ${err}`;
        log.error(msg);
        result.errors.push(msg);
      }
    }

    if (orphaned.length > 0) {
      log.warn(
        `[reconcile] Claw: found ${orphaned.length} orphaned sessions, recovered ${result.recovered}`
      );
    }
  } catch (err) {
    const msg = `Claw reconciliation failed: ${err}`;
    log.error(msg);
    result.errors.push(msg);
  }

  return result;
}

// ============================================================================
// Workflow Reconciliation
// ============================================================================

/**
 * Reconcile orphaned workflow executions.
 * Finds workflow_logs rows that are the latest entry for a workflow_run
 * with status='running' and duration_ms IS NULL where the started_at
 * is older than ORPHAN_THRESHOLD_MS.
 * Marks them as 'failed' with reason 'orphan_recovery'.
 */
async function reconcileOrphanedWorkflows(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    system: 'workflow',
    orphaned: 0,
    recovered: 0,
    errors: [],
  };

  try {
    const { createWorkflowsRepository } = await import('../db/repositories/workflows/index.js');
    const repo = createWorkflowsRepository();

    const orphaned = await repo.getOrphanedRuns(ORPHAN_THRESHOLD_MS);
    result.orphaned = orphaned.length;

    for (const run of orphaned) {
      try {
        await repo.markRunFailed(run.id, 'orphan_recovery');
        result.recovered++;
        log.warn(`[reconcile] Workflow orphan recovered: ${run.id} [${run.name}]`);
      } catch (err) {
        const msg = `Failed to reconcile workflow ${run.id}: ${err}`;
        log.error(msg);
        result.errors.push(msg);
      }
    }

    if (orphaned.length > 0) {
      log.warn(
        `[reconcile] Workflow: found ${orphaned.length} orphaned runs, recovered ${result.recovered}`
      );
    }
  } catch (err) {
    const msg = `Workflow reconciliation failed: ${err}`;
    log.error(msg);
    result.errors.push(msg);
  }

  return result;
}

// ============================================================================
// Plan Reconciliation
// ============================================================================

/**
 * Reconcile orphaned plan executions.
 * Finds plan_history rows with status='running' where started_at
 * is older than ORPHAN_THRESHOLD_MS.
 * Marks them as 'failed' with reason 'orphan_recovery'.
 */
async function reconcileOrphanedPlans(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    system: 'plan',
    orphaned: 0,
    recovered: 0,
    errors: [],
  };

  try {
    const { createPlansRepository } = await import('../db/repositories/plans.js');
    const repo = createPlansRepository();

    const orphaned = await repo.getOrphanedPlans(ORPHAN_THRESHOLD_MS);
    result.orphaned = orphaned.length;

    for (const plan of orphaned) {
      try {
        await repo.markPlanFailed(plan.id, 'orphan_recovery');
        result.recovered++;
        log.warn(`[reconcile] Plan orphan recovered: ${plan.id} [${plan.name}]`);
      } catch (err) {
        const msg = `Failed to reconcile plan ${plan.id}: ${err}`;
        log.error(msg);
        result.errors.push(msg);
      }
    }

    if (orphaned.length > 0) {
      log.warn(
        `[reconcile] Plan: found ${orphaned.length} orphaned executions, recovered ${result.recovered}`
      );
    }
  } catch (err) {
    const msg = `Plan reconciliation failed: ${err}`;
    log.error(msg);
    result.errors.push(msg);
  }

  return result;
}

// ============================================================================
// Master Reconciliation
// ============================================================================

/**
 * Reconcile ALL orphaned sessions across all autonomous systems.
 * Called at server boot, before any manager starts.
 *
 * Returns a summary of all reconciliation results.
 */
export async function reconcileOrphanedSessions(): Promise<ReconciliationResult[]> {
  log.info('[reconcile] Starting orphan session reconciliation...');

  const results = await Promise.allSettled([
    reconcileOrphanedClaws(),
    reconcileOrphanedWorkflows(),
    reconcileOrphanedPlans(),
  ]);

  const summaries = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { system: 'unknown', orphaned: 0, recovered: 0, errors: [String(r.reason)] }
  );

  const totalOrphaned = summaries.reduce((sum, r) => sum + r.orphaned, 0);
  const totalRecovered = summaries.reduce((sum, r) => sum + r.recovered, 0);
  const totalErrors = summaries.reduce((sum, r) => sum + r.errors.length, 0);

  log.info(
    `[reconcile] Done. orphaned=${totalOrphaned} recovered=${totalRecovered} errors=${totalErrors}`
  );

  return summaries;
}

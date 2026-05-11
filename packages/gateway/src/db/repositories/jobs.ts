/**
 * Jobs Repository — persisted job queue using FOR UPDATE SKIP LOCKED.
 * Provides at-least-once execution guarantee for workflow nodes, triggers, etc.
 */

import { BaseRepository } from './base.js';

const JOBS_TABLE = 'jobs';
const JOB_HISTORY_TABLE = 'job_history';

export type JobStatus = 'available' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  name: string;
  queue: string;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: JobStatus;
  runAfter: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  /**
   * For workflow_node jobs: the workflow run log ID (wfLog.id).
   * Extracted from payload.workflowRunId for type-safe access.
   */
  workflowRunId?: string;
  /**
   * For workflow_node jobs: the specific node ID being executed.
   * Extracted from payload.nodeId for type-safe access.
   */
  nodeId?: string;
}

export interface CreateJobInput {
  id: string;
  name: string;
  queue?: string;
  priority?: number;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
  /**
   * For workflow_node jobs: the workflow run log ID (wfLog.id).
   * Used to persist node results back to the workflow log.
   */
  workflowRunId?: string;
  /**
   * For workflow_node jobs: the specific node ID being executed.
   * Used to build nodeOutputs map on crash recovery.
   */
  nodeId?: string;
}

export interface JobStats {
  available: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export class JobsRepository extends BaseRepository {
  /**
   * Claim the next available job using FOR UPDATE SKIP LOCKED.
   * Returns null if no jobs are available to claim.
   *
   * Uses a CTE to atomically select-and-update in a single statement,
   * eliminating the TOCTOU window between SELECT and UPDATE that existed
   * when these were two separate queries.
   */
  async claimJob(queue = 'default', priority = 0): Promise<JobRecord | null> {
    // Atomic claim-and-update via CTE: SELECT FOR UPDATE locks the row, then UPDATE
    // modifies it — all in one round-trip. This prevents two workers from claiming
    // the same job even under concurrent execution.
    const sql = `
      WITH claimed AS (
        SELECT id, name, queue, priority, payload, result,
               run_after, started_at, completed_at, attempts, max_attempts,
               created_at, updated_at
        FROM ${JOBS_TABLE}
        WHERE status = 'available'
          AND queue = $1
          AND priority <= $2
          AND run_after <= NOW()
        ORDER BY priority DESC, run_after ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${JOBS_TABLE} AS j
      SET status = 'active',
          started_at = NOW(),
          attempts = c.attempts + 1,
          updated_at = NOW()
      FROM claimed AS c
      WHERE j.id = c.id
      RETURNING
        j.id, j.name, j.queue, j.priority, j.payload, j.result,
        j.status, j.run_after, j.started_at, j.completed_at,
        j.attempts, j.max_attempts, j.created_at, j.updated_at
    `;
    const rows = await this.query<{
      id: string;
      name: string;
      queue: string;
      priority: number;
      payload: Record<string, unknown>;
      result: Record<string, unknown> | null;
      status: JobStatus;
      run_after: Date;
      started_at: Date | null;
      completed_at: Date | null;
      attempts: number;
      max_attempts: number;
      created_at: Date;
      updated_at: Date;
    }>(sql, [queue, priority]);

    if (rows.length === 0) return null;

    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      queue: r.queue,
      priority: r.priority,
      payload: r.payload,
      result: r.result,
      status: r.status,
      runAfter: r.run_after,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      workflowRunId: (r.payload as Record<string, unknown>)?.workflowRunId as string | undefined,
      nodeId: (r.payload as Record<string, unknown>)?.nodeId as string | undefined,
    };
  }

  /**
   * Create a new job in the queue.
   */
  async create(input: CreateJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const sql = `
      INSERT INTO ${JOBS_TABLE} (id, name, queue, priority, payload, max_attempts, run_after, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, queue, priority, payload, result, status, run_after, started_at, completed_at, attempts, max_attempts, created_at, updated_at
    `;
    const rows = await this.query<{
      id: string;
      name: string;
      queue: string;
      priority: number;
      payload: Record<string, unknown>;
      result: Record<string, unknown> | null;
      status: JobStatus;
      run_after: Date;
      started_at: Date | null;
      completed_at: Date | null;
      attempts: number;
      max_attempts: number;
      created_at: Date;
      updated_at: Date;
    }>(sql, [
      input.id,
      input.name,
      input.queue ?? 'default',
      input.priority ?? 0,
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      (input.runAfter ?? new Date()).toISOString(),
      now,
      now,
    ]);
    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      queue: r.queue,
      priority: r.priority,
      payload: r.payload,
      result: r.result,
      status: r.status,
      runAfter: r.run_after,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      workflowRunId: input.workflowRunId,
      nodeId: input.nodeId,
    };
  }

  /**
   * Mark a job as completed.
   */
  async complete(jobId: string, result: Record<string, unknown>): Promise<void> {
    await this.execute(
      `UPDATE ${JOBS_TABLE} SET status = 'completed', result = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [jobId, JSON.stringify(result)]
    );
  }

  /**
   * Mark a job as failed. If attempts exhausted, move to job_history.
   */
  async fail(jobId: string, error: string): Promise<void> {
    const job = await this.getById(jobId);
    if (!job) return;

    const now = new Date().toISOString();

    if (job.attempts >= job.maxAttempts) {
      // Move to dead-letter queue
      const historyId = `${jobId}_${Date.now()}`;
      await this.execute(
        `INSERT INTO ${JOB_HISTORY_TABLE} (id, job_id, job_name, queue, payload, result, status, attempt, max_attempts, failed_at, error)
         VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7, $8, $9, $10)`,
        [historyId, jobId, job.name, job.queue, JSON.stringify(job.payload), JSON.stringify({ error }), job.attempts, job.maxAttempts, now, error]
      );
      await this.execute(`DELETE FROM ${JOBS_TABLE} WHERE id = $1`, [jobId]);
    } else {
      // Reschedule with exponential backoff
      const backoffMs = Math.min(job.attempts ** 2 * 5000, 3600000);
      const runAfter = new Date(Date.now() + backoffMs).toISOString();
      await this.execute(
        `UPDATE ${JOBS_TABLE} SET status = 'available', result = $2, run_after = $3, updated_at = $4 WHERE id = $1`,
        [jobId, JSON.stringify({ error }), runAfter, now]
      );
    }
  }

  /**
   * Cancel a job (mark as cancelled, skip retry).
   */
  async cancel(jobId: string): Promise<void> {
    await this.execute(
      `UPDATE ${JOBS_TABLE} SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );
  }

  /**
   * Get a job by ID.
   */
  async getById(jobId: string): Promise<JobRecord | null> {
    const rows = await this.query<{
      id: string;
      name: string;
      queue: string;
      priority: number;
      payload: Record<string, unknown>;
      result: Record<string, unknown> | null;
      status: JobStatus;
      run_after: Date;
      started_at: Date | null;
      completed_at: Date | null;
      attempts: number;
      max_attempts: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, queue, priority, payload, result, status, run_after, started_at, completed_at, attempts, max_attempts, created_at, updated_at
       FROM ${JOBS_TABLE} WHERE id = $1`,
      [jobId]
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      queue: r.queue,
      priority: r.priority,
      payload: r.payload,
      result: r.result,
      status: r.status,
      runAfter: r.run_after,
      startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      workflowRunId: (r.payload as Record<string, unknown>)?.workflowRunId as string | undefined,
      nodeId: (r.payload as Record<string, unknown>)?.nodeId as string | undefined,
    };
  }

  /**
   * Get queue statistics.
   */
  async getStats(queue?: string): Promise<JobStats> {
    const where = queue ? `WHERE queue = $1` : '';
    const params = queue ? [queue] : [];
    const rows = await this.query<{ status: JobStatus; count: string }>(
      `SELECT status, COUNT(*) as count FROM ${JOBS_TABLE} ${where} GROUP BY status`,
      params
    );
    const stats: JobStats = { available: 0, active: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const row of rows) {
      stats[row.status] = parseInt(row.count, 10);
    }
    return stats;
  }

  /**
   * List jobs by status and optional queue.
   */
  async listByStatus(status: JobStatus, queue?: string, limit = 100): Promise<JobRecord[]> {
    const where = [`status = $1`];
    const params: unknown[] = [status];
    if (queue) { where.push(`queue = $2`); params.push(queue); }
    where.push(`LIMIT $${params.length + 1}`);
    params.push(limit);

    const rows = await this.query<{
      id: string; name: string; queue: string; priority: number; payload: Record<string, unknown>;
      result: Record<string, unknown> | null; status: JobStatus; run_after: Date;
      started_at: Date | null; completed_at: Date | null; attempts: number;
      max_attempts: number; created_at: Date; updated_at: Date;
    }>(
      `SELECT id, name, queue, priority, payload, result, status, run_after, started_at, completed_at, attempts, max_attempts, created_at, updated_at
       FROM ${JOBS_TABLE} WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    return rows.map(r => ({
      id: r.id, name: r.name, queue: r.queue, priority: r.priority, payload: r.payload,
      result: r.result, status: r.status, runAfter: r.run_after, startedAt: r.started_at ?? null,
      completedAt: r.completed_at ?? null, attempts: r.attempts, maxAttempts: r.max_attempts,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  /**
   * Purge completed/failed jobs older than maxAgeDays.
   * Call periodically to keep the jobs table bounded.
   */
  async cleanupOld(maxAgeDays = 30): Promise<number> {
    const result = await this.execute(
      `DELETE FROM ${JOBS_TABLE} WHERE status IN ('completed', 'failed') AND updated_at < NOW() - INTERVAL '${maxAgeDays} days'`
    );
    return result.changes;
  }

  /**
   * Purge dead-letter entries older than maxAgeDays.
   */
  async cleanupHistory(maxAgeDays = 90): Promise<number> {
    const result = await this.execute(
      `DELETE FROM ${JOB_HISTORY_TABLE} WHERE failed_at < NOW() - INTERVAL '${maxAgeDays} days'`
    );
    return result.changes;
  }
}

// Singleton
let _repo: JobsRepository | null = null;

export function getJobsRepository(): JobsRepository {
  if (!_repo) _repo = new JobsRepository();
  return _repo;
}
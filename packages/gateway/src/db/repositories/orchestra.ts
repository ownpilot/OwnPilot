/**
 * Orchestra Executions Repository
 *
 * Persists completed orchestra plan executions for audit and history.
 */

import type { OrchestraExecution } from '@ownpilot/core';
import { BaseRepository } from './base.js';

// ============================================================================
// Row Type
// ============================================================================

interface ExecutionRow {
  id: string;
  parent_id: string;
  user_id: string;
  description: string;
  strategy: string;
  state: string;
  plan: string;
  task_results: string;
  total_duration_ms: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

// ============================================================================
// Row Mapper
// ============================================================================

function rowToExecution(row: ExecutionRow): OrchestraExecution {
  return {
    id: row.id,
    parentId: row.parent_id,
    userId: row.user_id,
    plan: parseJson(row.plan, { description: '', tasks: [], strategy: 'sequential' }),
    state: row.state as OrchestraExecution['state'],
    taskResults: parseJson(row.task_results, []),
    totalDurationMs: row.total_duration_ms ?? 0,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    error: row.error ?? undefined,
  };
}

function parseJson<T>(value: string | unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

// ============================================================================
// Repository
// ============================================================================

export class OrchestraRepository extends BaseRepository {
  async saveExecution(execution: OrchestraExecution): Promise<void> {
    await this.query(
      `INSERT INTO orchestra_executions
       (id, parent_id, user_id, description, strategy, state, plan, task_results, total_duration_ms, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        execution.id,
        execution.parentId,
        execution.userId,
        execution.plan.description,
        execution.plan.strategy,
        execution.state,
        JSON.stringify(execution.plan),
        JSON.stringify(execution.taskResults),
        execution.totalDurationMs,
        execution.error ?? null,
        execution.startedAt.toISOString(),
        execution.completedAt?.toISOString() ?? null,
      ]
    );
  }

  async getHistory(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: OrchestraExecution[]; total: number }> {
    const countRows = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM orchestra_executions WHERE user_id = $1',
      [userId]
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const rows = await this.query<ExecutionRow>(
      'SELECT * FROM orchestra_executions WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );

    return { entries: rows.map(rowToExecution), total };
  }

  async getById(id: string): Promise<OrchestraExecution | null> {
    const row = await this.queryOne<ExecutionRow>(
      'SELECT * FROM orchestra_executions WHERE id = $1',
      [id]
    );
    return row ? rowToExecution(row) : null;
  }

  async cleanupOld(retentionDays = 30): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `DELETE FROM orchestra_executions
       WHERE started_at < NOW() - INTERVAL '1 day' * $1
       RETURNING id`,
      [retentionDays]
    );
    return rows.length;
  }

  /**
   * Get aggregate statistics across all orchestra executions.
   */
  async getStats(userId?: string): Promise<{
    total: number;
    active: number;
    successCount: number;
    successRate: number;
    avgCost: number;
    avgDuration: number;
    totalCost: number;
    errorRate: number;
    byState: Record<string, number>;
    tasksSucceeded: number;
    tasksFailed: number;
  }> {
    const where = userId ? 'WHERE user_id = $1' : '';
    const params = userId ? [userId] : [];

    const row = await this.queryOne<{
      total: string;
      active: string;
      success_count: string;
      avg_duration: string;
      error_count: string;
      tasks_succeeded: string;
      tasks_failed: string;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE state IN ('planning', 'running', 'waiting_user', 'paused')) AS active,
         COUNT(*) FILTER (WHERE state = 'completed') AS success_count,
         COALESCE(AVG(total_duration_ms), 0) AS avg_duration,
         COUNT(*) FILTER (WHERE state = 'failed') AS error_count,
         0 AS tasks_succeeded,
         0 AS tasks_failed
       FROM orchestra_executions ${where}`,
      params
    );

    const total = parseInt(row?.total ?? '0', 10);
    const active = parseInt(row?.active ?? '0', 10);
    const successCount = parseInt(row?.success_count ?? '0', 10);
    const errorCount = parseInt(row?.error_count ?? '0', 10);

    const stateRows = await this.query<{ state: string; count: string }>(
      `SELECT state, COUNT(*)::text AS count FROM orchestra_executions ${where} GROUP BY state`,
      params
    );
    const byState: Record<string, number> = {};
    for (const r of stateRows) byState[r.state] = parseInt(r.count, 10);

    return {
      total,
      active,
      successCount,
      successRate: total > 0 ? successCount / total : 0,
      avgCost: 0,
      avgDuration: parseFloat(row?.avg_duration ?? '0'),
      totalCost: 0,
      errorRate: total > 0 ? errorCount / total : 0,
      byState,
      tasksSucceeded: parseInt(row?.tasks_succeeded ?? '0', 10),
      tasksFailed: parseInt(row?.tasks_failed ?? '0', 10),
    };
  }
}

// Factory function
export function createOrchestraRepository(_userId = 'default'): OrchestraRepository {
  return new OrchestraRepository();
}

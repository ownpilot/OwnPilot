/**
 * Heartbeat Log Repository — audit trail for heartbeat cycles
 */

import { BaseRepository, parseJsonField } from './base.js';
import type { HeartbeatLogEntry } from '@ownpilot/core';

// ── DB Row Types ────────────────────────────────────

interface HeartbeatLogRow {
  id: string;
  agent_id: string;
  soul_version: number | null;
  tasks_run: string;
  tasks_skipped: string;
  tasks_failed: string;
  duration_ms: number | null;
  token_usage: string;
  cost: string;
  created_at: string;
}

// ── Row → Record Mapper ────────────────────────────

function rowToEntry(row: HeartbeatLogRow): HeartbeatLogEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    soulVersion: row.soul_version ?? 0,
    tasksRun: parseJsonField(row.tasks_run, []),
    tasksSkipped: parseJsonField(row.tasks_skipped, []),
    tasksFailed: parseJsonField(row.tasks_failed, []),
    durationMs: row.duration_ms ?? 0,
    tokenUsage: parseJsonField(row.token_usage, { input: 0, output: 0 }),
    cost: parseFloat(row.cost ?? '0'),
    createdAt: new Date(row.created_at),
  };
}

// ── Repository ──────────────────────────────────────

export class HeartbeatLogRepository extends BaseRepository {
  async create(data: Omit<HeartbeatLogEntry, 'id' | 'createdAt'>): Promise<void> {
    await this.execute(
      `INSERT INTO heartbeat_log
       (agent_id, soul_version, tasks_run, tasks_skipped, tasks_failed,
        duration_ms, token_usage, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.agentId,
        data.soulVersion,
        JSON.stringify(data.tasksRun),
        JSON.stringify(data.tasksSkipped),
        JSON.stringify(data.tasksFailed),
        data.durationMs,
        JSON.stringify(data.tokenUsage),
        data.cost,
      ]
    );
  }

  async getRecent(agentId: string, limit: number): Promise<HeartbeatLogEntry[]> {
    const rows = await this.query<HeartbeatLogRow>(
      `SELECT * FROM heartbeat_log WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return rows.map(rowToEntry);
  }

  async getLatest(agentId: string): Promise<HeartbeatLogEntry | null> {
    const row = await this.queryOne<HeartbeatLogRow>(
      `SELECT * FROM heartbeat_log WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [agentId]
    );
    return row ? rowToEntry(row) : null;
  }

  async list(limit: number, offset: number): Promise<HeartbeatLogEntry[]> {
    const rows = await this.query<HeartbeatLogRow>(
      `SELECT * FROM heartbeat_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToEntry);
  }

  async listByUser(userId: string, limit: number, offset: number): Promise<HeartbeatLogEntry[]> {
    const rows = await this.query<HeartbeatLogRow>(
      `SELECT hl.* FROM heartbeat_log hl
       JOIN heartbeats h ON h.id = hl.agent_id
       WHERE h.user_id = $1
       ORDER BY hl.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows.map(rowToEntry);
  }

  async countByUser(userId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM heartbeat_log hl
       JOIN heartbeats h ON h.id = hl.agent_id
       WHERE h.user_id = $1`,
      [userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async listByAgent(agentId: string, limit: number, offset: number): Promise<HeartbeatLogEntry[]> {
    const rows = await this.query<HeartbeatLogRow>(
      `SELECT * FROM heartbeat_log WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
    return rows.map(rowToEntry);
  }

  async isAgentOwnedByUser(agentId: string, userId: string): Promise<boolean> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM heartbeats WHERE id = $1 AND user_id = $2`,
      [agentId, userId]
    );
    return parseInt(row?.count ?? '0', 10) > 0;
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM heartbeat_log`
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getStats(agentId?: string): Promise<{
    totalCycles: number;
    totalCost: number;
    avgDurationMs: number;
    failureRate: number;
  }> {
    const where = agentId ? 'WHERE agent_id = $1' : '';
    const params = agentId ? [agentId] : [];

    const row = await this.queryOne<{
      total_cycles: string;
      total_cost: string;
      avg_duration: string;
      failure_count: string;
    }>(
      `SELECT
         COUNT(*) AS total_cycles,
         COALESCE(SUM(cost), 0) AS total_cost,
         COALESCE(AVG(duration_ms), 0) AS avg_duration,
         COUNT(*) FILTER (WHERE jsonb_array_length(tasks_failed) > 0) AS failure_count
       FROM heartbeat_log ${where}`,
      params
    );

    const totalCycles = parseInt(row?.total_cycles ?? '0', 10);
    const failureCount = parseInt(row?.failure_count ?? '0', 10);

    return {
      totalCycles,
      totalCost: parseFloat(row?.total_cost ?? '0'),
      avgDurationMs: parseFloat(row?.avg_duration ?? '0'),
      failureRate: totalCycles > 0 ? failureCount / totalCycles : 0,
    };
  }

  async getStatsByUser(
    userId: string,
    agentId?: string
  ): Promise<{
    totalCycles: number;
    totalCost: number;
    avgDurationMs: number;
    failureRate: number;
  }> {
    let where = 'WHERE h.user_id = $1';
    const params: unknown[] = [userId];
    if (agentId) {
      where += ' AND hl.agent_id = $2';
      params.push(agentId);
    }

    const row = await this.queryOne<{
      total_cycles: string;
      total_cost: string;
      avg_duration: string;
      failure_count: string;
    }>(
      `SELECT
         COUNT(*) AS total_cycles,
         COALESCE(SUM(hl.cost), 0) AS total_cost,
         COALESCE(AVG(hl.duration_ms), 0) AS avg_duration,
         COUNT(*) FILTER (WHERE jsonb_array_length(hl.tasks_failed) > 0) AS failure_count
       FROM heartbeat_log hl
       JOIN heartbeats h ON h.id = hl.agent_id
       ${where}`,
      params
    );

    const totalCycles = parseInt(row?.total_cycles ?? '0', 10);
    const failureCount = parseInt(row?.failure_count ?? '0', 10);

    return {
      totalCycles,
      totalCost: parseFloat(row?.total_cost ?? '0'),
      avgDurationMs: parseFloat(row?.avg_duration ?? '0'),
      failureRate: totalCycles > 0 ? failureCount / totalCycles : 0,
    };
  }

  /** Batch-fetch the latest heartbeat entry for each agent ID. O(1) query via DISTINCT ON. */
  async getLatestByAgentIds(agentIds: string[]): Promise<Map<string, HeartbeatLogEntry>> {
    if (agentIds.length === 0) return new Map();
    const placeholders = agentIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query<HeartbeatLogRow>(
      `SELECT DISTINCT ON (agent_id) *
       FROM heartbeat_log
       WHERE agent_id IN (${placeholders})
       ORDER BY agent_id, created_at DESC`,
      agentIds
    );
    const result = new Map<string, HeartbeatLogEntry>();
    for (const row of rows) {
      result.set(row.agent_id, rowToEntry(row));
    }
    return result;
  }
}

// ── Singleton ──

let _instance: HeartbeatLogRepository | null = null;

export function getHeartbeatLogRepository(): HeartbeatLogRepository {
  if (!_instance) {
    _instance = new HeartbeatLogRepository();
  }
  return _instance;
}

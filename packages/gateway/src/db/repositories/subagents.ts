/**
 * Subagents Repository (PostgreSQL)
 *
 * Persists completed subagent executions for audit/debugging.
 * Active sessions live in memory (SubagentManager), only final
 * results are stored here.
 */

import type { SubagentSession, SubagentHistoryEntry, SubagentToolCall } from '@ownpilot/core';
import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';

// ============================================================================
// Row Types
// ============================================================================

interface HistoryRow {
  id: string;
  parent_id: string;
  parent_type: string;
  user_id: string;
  name: string;
  task: string;
  state: string;
  result: string | null;
  error: string | null;
  tool_calls: string;
  turns_used: number;
  tool_calls_used: number;
  tokens_used: string | null;
  duration_ms: number | null;
  provider: string;
  model: string;
  spawned_at: string;
  completed_at: string | null;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToHistoryEntry(row: HistoryRow): SubagentHistoryEntry {
  return {
    id: row.id,
    parentId: row.parent_id,
    parentType: row.parent_type,
    userId: row.user_id,
    name: row.name,
    task: row.task,
    state: row.state as SubagentHistoryEntry['state'],
    result: row.result,
    error: row.error,
    toolCalls: parseJsonField<SubagentToolCall[]>(row.tool_calls, []),
    turnsUsed: row.turns_used,
    toolCallsUsed: row.tool_calls_used,
    tokensUsed: parseJsonFieldNullable<{ prompt: number; completion: number }>(row.tokens_used),
    durationMs: row.duration_ms,
    provider: row.provider,
    model: row.model,
    spawnedAt: new Date(row.spawned_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class SubagentsRepository extends BaseRepository {
  /**
   * Save a completed subagent execution to history
   */
  async saveExecution(session: SubagentSession): Promise<void> {
    const sql = `
      INSERT INTO subagent_history (
        id, parent_id, parent_type, user_id, name, task, state,
        result, error, tool_calls, turns_used, tool_calls_used,
        tokens_used, duration_ms, provider, model, spawned_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `;
    await this.query(sql, [
      session.id,
      session.parentId,
      session.parentType,
      session.userId,
      session.name,
      session.task,
      session.state,
      session.result,
      session.error,
      JSON.stringify(session.toolCalls),
      session.turnsUsed,
      session.toolCallsUsed,
      session.tokensUsed ? JSON.stringify(session.tokensUsed) : null,
      session.durationMs,
      session.provider,
      session.model,
      session.spawnedAt.toISOString(),
      session.completedAt?.toISOString() ?? null,
    ]);
  }

  /**
   * Get execution history for a specific parent
   */
  async getHistory(
    parentId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: SubagentHistoryEntry[]; total: number }> {
    const countRows = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM subagent_history WHERE parent_id = $1',
      [parentId]
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const rows = await this.query<HistoryRow>(
      'SELECT * FROM subagent_history WHERE parent_id = $1 ORDER BY spawned_at DESC LIMIT $2 OFFSET $3',
      [parentId, limit, offset]
    );

    return { entries: rows.map(rowToHistoryEntry), total };
  }

  /**
   * Get execution history for a user (all parents)
   */
  async getByUser(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: SubagentHistoryEntry[]; total: number }> {
    const countRows = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM subagent_history WHERE user_id = $1',
      [userId]
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const rows = await this.query<HistoryRow>(
      'SELECT * FROM subagent_history WHERE user_id = $1 ORDER BY spawned_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );

    return { entries: rows.map(rowToHistoryEntry), total };
  }

  /**
   * Get sessions that appear orphaned — running (no completed_at) and older than threshold.
   */
  async getOrphanedSessions(
    thresholdMs: number,
  ): Promise<Array<{ id: string; parent_id: string; name: string }>> {
    const rows = await this.query<{ id: string; parent_id: string; name: string }>(
      `SELECT id, parent_id, name FROM subagent_history
       WHERE state = 'running'
         AND completed_at IS NULL
         AND EXTRACT(EPOCH FROM (NOW() - spawned_at)) * 1000 > $1`,
      [thresholdMs],
    );
    return rows;
  }

  /**
   * Mark a running session as aborted (used during orphan recovery).
   */
  async markAborted(id: string, reason: string): Promise<void> {
    await this.execute(
      `UPDATE subagent_history
       SET state = 'aborted', completed_at = NOW(), error = $2
       WHERE id = $1 AND state = 'running'`,
      [id, `orphan_recovery: ${reason}`],
    );
  }

  /**
   * Cleanup old history entries
   */
  async cleanupOld(retentionDays = 30): Promise<number> {
    const rows = await this.query<{ count: string }>(
      `DELETE FROM subagent_history
       WHERE spawned_at < NOW() - INTERVAL '1 day' * $1
       RETURNING id`,
      [retentionDays],
    );
    return rows.length;
  }
}

// Factory function
export function createSubagentsRepository(_userId = 'default'): SubagentsRepository {
  return new SubagentsRepository();
}

/**
 * Autonomy Log Repository
 *
 * Database operations for the Autonomy Engine pulse log.
 * Records each pulse cycle with signals, actions, and outcomes.
 */

import { BaseRepository, parseJsonField } from './base.js';
import { generateId } from '@ownpilot/core';
import type { PulseActionResult, AutonomyLogEntry, PulseStats } from '@ownpilot/core';

// ============================================================================
// Row type (DB shape)
// ============================================================================

interface AutonomyLogRow {
  id: string;
  user_id: string;
  pulsed_at: string | Date;
  duration_ms: number | null;
  signals_found: number;
  llm_called: boolean;
  actions_count: number;
  actions: string | PulseActionResult[];
  report_msg: string | null;
  error: string | null;
  manual: boolean;
}

// ============================================================================
// Repository
// ============================================================================

export class AutonomyLogRepository extends BaseRepository {
  constructor(private userId: string) {
    super();
  }

  /**
   * Insert a new log entry
   */
  async insert(entry: Omit<AutonomyLogEntry, 'id'>): Promise<string> {
    const id = generateId('alog');
    await this.execute(
      `INSERT INTO autonomy_log (id, user_id, pulsed_at, duration_ms, signals_found, llm_called, actions_count, actions, report_msg, error, manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        this.userId,
        entry.pulsedAt,
        entry.durationMs,
        entry.signalsFound,
        entry.llmCalled,
        entry.actionsCount,
        JSON.stringify(entry.actions),
        entry.reportMsg,
        entry.error,
        entry.manual,
      ]
    );
    return id;
  }

  /**
   * Get recent log entries
   */
  async getRecent(limit = 20): Promise<AutonomyLogEntry[]> {
    const rows = await this.query<AutonomyLogRow>(
      `SELECT * FROM autonomy_log WHERE user_id = $1 ORDER BY pulsed_at DESC LIMIT $2`,
      [this.userId, limit]
    );
    return rows.map((r) => this.toEntry(r));
  }

  /**
   * Get aggregate statistics
   */
  async getStats(): Promise<PulseStats> {
    const row = await this.queryOne<{
      total: string;
      llm_count: string;
      avg_duration: string | null;
      total_actions: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE llm_called = true) as llm_count,
        AVG(duration_ms) as avg_duration,
        SUM(actions_count) as total_actions
       FROM autonomy_log WHERE user_id = $1`,
      [this.userId]
    );

    const total = Number(row?.total ?? 0);
    const llmCount = Number(row?.llm_count ?? 0);

    return {
      totalPulses: total,
      llmCallRate: total > 0 ? llmCount / total : 0,
      avgDurationMs: Number(row?.avg_duration ?? 0),
      actionsExecuted: Number(row?.total_actions ?? 0),
    };
  }

  /**
   * Delete entries older than the specified number of days
   */
  async cleanup(olderThanDays: number): Promise<number> {
    const result = await this.execute(
      `DELETE FROM autonomy_log WHERE user_id = $1 AND pulsed_at < NOW() - INTERVAL '1 day' * $2`,
      [this.userId, olderThanDays]
    );
    return result.changes;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private toEntry(row: AutonomyLogRow): AutonomyLogEntry {
    return {
      id: row.id,
      userId: row.user_id,
      pulsedAt: new Date(row.pulsed_at),
      durationMs: row.duration_ms ?? 0,
      signalsFound: row.signals_found,
      llmCalled: this.parseBoolean(row.llm_called),
      actionsCount: row.actions_count,
      actions: parseJsonField<PulseActionResult[]>(row.actions, []),
      reportMsg: row.report_msg,
      error: row.error,
      manual: this.parseBoolean(row.manual),
    };
  }
}

/**
 * Factory function (scoped per user)
 */
export function createAutonomyLogRepo(userId: string): AutonomyLogRepository {
  return new AutonomyLogRepository(userId);
}

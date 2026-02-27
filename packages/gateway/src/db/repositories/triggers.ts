/**
 * Triggers Repository
 *
 * Database operations for proactive triggers.
 * Supports scheduled, event-based, condition-based, and webhook triggers.
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';
import { buildUpdateStatement } from './query-helpers.js';
import { getNextRunTime, generateId } from '@ownpilot/core';
import { getLog } from '../../services/log.js';

const log = getLog('TriggersRepo');

// ============================================================================
// Types
// ============================================================================

export type TriggerType = 'schedule' | 'event' | 'condition' | 'webhook';
export type TriggerStatus = 'success' | 'failure' | 'skipped';

export interface ScheduleConfig {
  cron: string; // Cron expression
  timezone?: string;
}

export interface EventConfig {
  eventType: string; // e.g., 'goal_completed', 'memory_added', 'message_received'
  filters?: Record<string, unknown>;
}

export interface ConditionConfig {
  condition: string; // e.g., 'stale_goals', 'upcoming_deadline', 'memory_threshold'
  threshold?: number;
  checkInterval?: number; // minutes
}

export interface WebhookConfig {
  secret?: string;
  allowedSources?: string[];
}

export type TriggerConfig = ScheduleConfig | EventConfig | ConditionConfig | WebhookConfig;

export interface TriggerAction {
  type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary' | 'workflow';
  payload: Record<string, unknown>;
}

export interface Trigger {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  type: TriggerType;
  config: TriggerConfig;
  action: TriggerAction;
  enabled: boolean;
  priority: number;
  lastFired: Date | null;
  nextFire: Date | null;
  fireCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TriggerHistory {
  id: string;
  triggerId: string | null;
  triggerName: string | null;
  firedAt: Date;
  status: TriggerStatus;
  result: unknown | null;
  error: string | null;
  durationMs: number | null;
}

export interface HistoryQuery {
  status?: TriggerStatus;
  triggerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTriggerInput {
  name: string;
  description?: string;
  type: TriggerType;
  config: TriggerConfig;
  action: TriggerAction;
  enabled?: boolean;
  priority?: number;
}

export interface UpdateTriggerInput {
  name?: string;
  description?: string;
  config?: TriggerConfig;
  action?: TriggerAction;
  enabled?: boolean;
  priority?: number;
}

export interface TriggerQuery {
  type?: TriggerType | TriggerType[];
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

interface TriggerRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  type: TriggerType;
  config: string;
  action: string;
  enabled: boolean;
  priority: number;
  last_fired: string | null;
  next_fire: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  trigger_id: string | null;
  trigger_name: string | null;
  fired_at: string;
  status: TriggerStatus;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
}

// ============================================================================
// Repository
// ============================================================================

export class TriggersRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ==========================================================================
  // Trigger CRUD
  // ==========================================================================

  /**
   * Create a new trigger
   */
  async create(input: CreateTriggerInput): Promise<Trigger> {
    const id = generateId('trigger');
    const now = new Date().toISOString();

    // Calculate next fire time for schedule triggers
    let nextFire: string | null = null;
    if (input.type === 'schedule' && input.enabled !== false) {
      nextFire = this.calculateNextFire(input.config as ScheduleConfig);
      if (!nextFire) {
        const cron = (input.config as ScheduleConfig).cron;
        throw new Error(
          `Cannot create schedule trigger: cron expression "${cron ?? '(empty)'}" did not produce a valid next fire time`
        );
      }
    }

    await this.execute(
      `INSERT INTO triggers (id, user_id, name, description, type, config, action, enabled, priority, next_fire, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        this.userId,
        input.name,
        input.description ?? null,
        input.type,
        JSON.stringify(input.config),
        JSON.stringify(input.action),
        input.enabled !== false,
        input.priority ?? 5,
        nextFire,
        now,
        now,
      ]
    );

    const trigger = await this.get(id);
    if (!trigger) throw new Error('Failed to create trigger');
    return trigger;
  }

  /**
   * Get a trigger by ID (scoped to this user)
   */
  async get(id: string): Promise<Trigger | null> {
    const row = await this.queryOne<TriggerRow>(
      'SELECT * FROM triggers WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? this.mapTrigger(row) : null;
  }

  /**
   * Get a trigger by ID without user scope (for webhook lookups).
   */
  async getByIdGlobal(id: string): Promise<Trigger | null> {
    const row = await this.queryOne<TriggerRow>(
      'SELECT * FROM triggers WHERE id = $1',
      [id]
    );
    return row ? this.mapTrigger(row) : null;
  }

  /**
   * Update a trigger
   */
  async update(id: string, input: UpdateTriggerInput): Promise<Trigger | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    // Recalculate next fire if config or enabled changed (may throw)
    let nextFireValue: string | undefined;
    if (input.config !== undefined || input.enabled !== undefined) {
      const config = input.config ?? existing.config;
      const enabled = input.enabled ?? existing.enabled;
      if (existing.type === 'schedule' && enabled) {
        const newNextFire = this.calculateNextFire(config as ScheduleConfig);
        if (!newNextFire) {
          const cron = (config as ScheduleConfig).cron;
          throw new Error(
            `Cannot update schedule trigger: cron expression "${cron ?? '(empty)'}" did not produce a valid next fire time`
          );
        }
        nextFireValue = newNextFire;
      }
    }

    const fields = [
      { column: 'updated_at', value: new Date().toISOString() },
      { column: 'name', value: input.name },
      { column: 'description', value: input.description },
      {
        column: 'config',
        value: input.config !== undefined ? JSON.stringify(input.config) : undefined,
      },
      {
        column: 'action',
        value: input.action !== undefined ? JSON.stringify(input.action) : undefined,
      },
      { column: 'enabled', value: input.enabled },
      {
        column: 'priority',
        value: input.priority !== undefined ? Math.max(1, Math.min(10, input.priority)) : undefined,
      },
      { column: 'next_fire', value: nextFireValue },
    ];

    const stmt = buildUpdateStatement('triggers', fields, [
      { column: 'id', value: id },
      { column: 'user_id', value: this.userId },
    ]);

    // stmt is always non-null because updated_at is always provided,
    // but guard defensively.
    if (!stmt) return existing;

    await this.execute(stmt.sql, stmt.params);

    return this.get(id);
  }

  /**
   * Delete a trigger (preserves history by detaching rows first)
   */
  async delete(id: string): Promise<boolean> {
    // Detach history rows: preserve trigger name, set trigger_id = NULL
    const trigger = await this.get(id);
    if (trigger) {
      await this.execute(
        `UPDATE trigger_history SET trigger_name = COALESCE(trigger_name, $1), trigger_id = NULL WHERE trigger_id = $2`,
        [trigger.name, id]
      );
    }

    const result = await this.execute('DELETE FROM triggers WHERE id = $1 AND user_id = $2', [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  /**
   * List triggers with filters
   */
  async list(query: TriggerQuery = {}): Promise<Trigger[]> {
    let sql = 'SELECT * FROM triggers WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      const placeholders = types.map(() => `$${paramIndex++}`).join(', ');
      sql += ` AND type IN (${placeholders})`;
      params.push(...types);
    }

    if (query.enabled !== undefined) {
      sql += ` AND enabled = $${paramIndex++}`;
      params.push(query.enabled);
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<TriggerRow>(sql, params);
    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Get triggers due to fire
   */
  async getDueTriggers(): Promise<Trigger[]> {
    const now = new Date().toISOString();

    const rows = await this.query<TriggerRow>(
      `SELECT * FROM triggers
       WHERE user_id = $1
         AND enabled = true
         AND type = 'schedule'
         AND next_fire IS NOT NULL
         AND next_fire <= $2
       ORDER BY priority DESC, next_fire ASC`,
      [this.userId, now]
    );

    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Get triggers by event type
   */
  async getByEventType(eventType: string): Promise<Trigger[]> {
    const rows = await this.query<TriggerRow>(
      `SELECT * FROM triggers
       WHERE user_id = $1
         AND enabled = true
         AND type = 'event'
       ORDER BY priority DESC`,
      [this.userId]
    );

    return rows
      .map((row) => this.mapTrigger(row))
      .filter((t) => (t.config as EventConfig).eventType === eventType);
  }

  /**
   * Get condition-based triggers
   */
  async getConditionTriggers(): Promise<Trigger[]> {
    const rows = await this.query<TriggerRow>(
      `SELECT * FROM triggers
       WHERE user_id = $1
         AND enabled = true
         AND type = 'condition'
       ORDER BY priority DESC`,
      [this.userId]
    );

    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Mark trigger as fired
   */
  async markFired(id: string, nextFire?: string): Promise<void> {
    const now = new Date().toISOString();

    await this.execute(
      `UPDATE triggers
       SET last_fired = $1, next_fire = $2, fire_count = fire_count + 1, updated_at = $3
       WHERE id = $4 AND user_id = $5`,
      [now, nextFire ?? null, now, id, this.userId]
    );
  }

  // ==========================================================================
  // Trigger History
  // ==========================================================================

  /**
   * Log trigger execution
   */
  async logExecution(
    triggerId: string,
    triggerName: string,
    status: TriggerStatus,
    result?: unknown,
    error?: string,
    durationMs?: number
  ): Promise<TriggerHistory> {
    const id = generateId('hist');

    await this.execute(
      `INSERT INTO trigger_history (id, trigger_id, trigger_name, status, result, error, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        triggerId,
        triggerName,
        status,
        result ? JSON.stringify(result) : null,
        error ?? null,
        durationMs ?? null,
      ]
    );

    const history = await this.getHistory(id);
    if (!history) throw new Error('Failed to create trigger history');
    return history;
  }

  /**
   * Get history entry by ID (scoped to current user's triggers)
   */
  async getHistory(id: string): Promise<TriggerHistory | null> {
    const row = await this.queryOne<HistoryRow>(
      `SELECT h.*, COALESCE(h.trigger_name, t.name) as trigger_name FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE h.id = $1 AND t.user_id = $2`,
      [id, this.userId]
    );
    return row ? this.mapHistory(row) : null;
  }

  /**
   * Get history for a trigger (with optional filters + pagination)
   */
  async getHistoryForTrigger(
    triggerId: string,
    query: HistoryQuery = {}
  ): Promise<{ rows: TriggerHistory[]; total: number }> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    let whereSql = 'WHERE h.trigger_id = $1';
    const params: unknown[] = [triggerId];
    let paramIndex = 2;

    if (query.status) {
      whereSql += ` AND h.status = $${paramIndex++}`;
      params.push(query.status);
    }
    if (query.from) {
      whereSql += ` AND h.fired_at >= $${paramIndex++}`;
      params.push(query.from);
    }
    if (query.to) {
      whereSql += ` AND h.fired_at <= $${paramIndex++}`;
      params.push(query.to);
    }

    const countResult = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trigger_history h ${whereSql}`,
      params
    );
    const total = parseInt(countResult?.count ?? '0', 10);

    const dataParams = [...params, limit, offset];
    const rows = await this.query<HistoryRow>(
      `SELECT h.*, COALESCE(h.trigger_name, t.name) as trigger_name FROM trigger_history h
       LEFT JOIN triggers t ON h.trigger_id = t.id
       ${whereSql}
       ORDER BY h.fired_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataParams
    );

    return { rows: rows.map((row) => this.mapHistory(row)), total };
  }

  /**
   * Get recent history across all triggers (with optional filters + pagination)
   */
  async getRecentHistory(
    query: HistoryQuery = {}
  ): Promise<{ rows: TriggerHistory[]; total: number }> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    // INNER JOIN so only history for existing triggers owned by this user is returned.
    // Detached rows (deleted triggers) are excluded to prevent cross-user leaks.
    let whereSql = 'WHERE t.user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.status) {
      whereSql += ` AND h.status = $${paramIndex++}`;
      params.push(query.status);
    }
    if (query.triggerId) {
      whereSql += ` AND h.trigger_id = $${paramIndex++}`;
      params.push(query.triggerId);
    }
    if (query.from) {
      whereSql += ` AND h.fired_at >= $${paramIndex++}`;
      params.push(query.from);
    }
    if (query.to) {
      whereSql += ` AND h.fired_at <= $${paramIndex++}`;
      params.push(query.to);
    }

    const countResult = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       ${whereSql}`,
      params
    );
    const total = parseInt(countResult?.count ?? '0', 10);

    const dataParams = [...params, limit, offset];
    const rows = await this.query<HistoryRow>(
      `SELECT h.*, COALESCE(h.trigger_name, t.name) as trigger_name FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       ${whereSql}
       ORDER BY h.fired_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataParams
    );

    return { rows: rows.map((row) => this.mapHistory(row)), total };
  }

  /**
   * Clean up old history for this user's triggers, plus orphaned rows with no trigger.
   */
  async cleanupHistory(maxAgeDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    // Delete old history for user's triggers
    const result = await this.execute(
      `DELETE FROM trigger_history
       WHERE fired_at < $1
         AND trigger_id IN (SELECT id FROM triggers WHERE user_id = $2)`,
      [cutoff.toISOString(), this.userId]
    );

    // Also clean up orphaned rows (deleted triggers) older than cutoff
    const orphaned = await this.execute(
      `DELETE FROM trigger_history
       WHERE fired_at < $1 AND trigger_id IS NULL`,
      [cutoff.toISOString()]
    );

    return result.changes + orphaned.changes;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get trigger statistics
   */
  async getStats(): Promise<{
    total: number;
    enabled: number;
    byType: Record<TriggerType, number>;
    totalFires: number;
    firesThisWeek: number;
    successRate: number;
  }> {
    const total = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM triggers WHERE user_id = $1',
      [this.userId]
    );

    const enabled = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM triggers WHERE user_id = $1 AND enabled = true',
      [this.userId]
    );

    const byType = await this.query<{ type: TriggerType; count: string }>(
      'SELECT type, COUNT(*) as count FROM triggers WHERE user_id = $1 GROUP BY type',
      [this.userId]
    );

    const totalFires = await this.queryOne<{ total: string | null }>(
      'SELECT SUM(fire_count) as total FROM triggers WHERE user_id = $1',
      [this.userId]
    );

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const firesThisWeek = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE t.user_id = $1 AND h.fired_at >= $2`,
      [this.userId, weekAgo.toISOString()]
    );

    const successCount = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE t.user_id = $1 AND h.status = 'success'`,
      [this.userId]
    );

    const totalHistory = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE t.user_id = $1`,
      [this.userId]
    );

    const typeMap: Record<TriggerType, number> = {
      schedule: 0,
      event: 0,
      condition: 0,
      webhook: 0,
    };
    for (const row of byType) {
      typeMap[row.type] = parseInt(row.count, 10);
    }

    const totalHistoryCount = parseInt(totalHistory?.count ?? '0', 10);
    const successCountNum = parseInt(successCount?.count ?? '0', 10);

    return {
      total: parseInt(total?.count ?? '0', 10),
      enabled: parseInt(enabled?.count ?? '0', 10),
      byType: typeMap,
      totalFires: parseInt(totalFires?.total ?? '0', 10),
      firesThisWeek: parseInt(firesThisWeek?.count ?? '0', 10),
      successRate:
        totalHistoryCount > 0 ? Math.round((successCountNum / totalHistoryCount) * 100) : 100,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Calculate next fire time from cron expression using core's production cron parser.
   * Throws on invalid cron so callers can handle the error explicitly.
   */
  private calculateNextFire(config: ScheduleConfig): string | null {
    if (!config.cron) {
      log.warn('[TriggersRepo] calculateNextFire called with empty cron expression');
      return null;
    }
    const nextRun = getNextRunTime(config.cron);
    if (!nextRun) {
      log.warn(
        `[TriggersRepo] No next fire time found for cron "${config.cron}" — trigger will not auto-fire`
      );
    }
    return nextRun ? nextRun.toISOString() : null;
  }

  private mapTrigger(row: TriggerRow): Trigger {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      type: row.type,
      config: parseJsonField(row.config, {}),
      action: parseJsonField<TriggerAction>(row.action, { type: 'chat', payload: {} }),
      enabled: row.enabled,
      priority: row.priority,
      lastFired: row.last_fired ? new Date(row.last_fired) : null,
      nextFire: row.next_fire ? new Date(row.next_fire) : null,
      fireCount: row.fire_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapHistory(row: HistoryRow): TriggerHistory {
    return {
      id: row.id,
      triggerId: row.trigger_id,
      triggerName: row.trigger_name,
      firedAt: new Date(row.fired_at),
      status: row.status,
      result: parseJsonFieldNullable(row.result),
      error: row.error,
      durationMs: row.duration_ms,
    };
  }
}

// Factory function for creating repository instances
export function createTriggersRepository(userId = 'default'): TriggersRepository {
  return new TriggersRepository(userId);
}

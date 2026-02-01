/**
 * Triggers Repository
 *
 * Database operations for proactive triggers.
 * Supports scheduled, event-based, condition-based, and webhook triggers.
 */

import { BaseRepository } from './base.js';
import { getNextRunTime } from '@ownpilot/core';
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
  type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary';
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
  triggerId: string;
  firedAt: Date;
  status: TriggerStatus;
  result: unknown | null;
  error: string | null;
  durationMs: number | null;
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
  trigger_id: string;
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
    const id = `trigger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

    return (await this.get(id))!;
  }

  /**
   * Get a trigger by ID
   */
  async get(id: string): Promise<Trigger | null> {
    const row = await this.queryOne<TriggerRow>(
      'SELECT * FROM triggers WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? this.mapTrigger(row) : null;
  }

  /**
   * Update a trigger
   */
  async update(id: string, input: UpdateTriggerInput): Promise<Trigger | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = $1'];
    const values: unknown[] = [new Date().toISOString()];
    let paramIndex = 2;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(input.config));
    }
    if (input.action !== undefined) {
      updates.push(`action = $${paramIndex++}`);
      values.push(JSON.stringify(input.action));
    }
    if (input.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(Math.max(1, Math.min(10, input.priority)));
    }

    // Recalculate next fire if config or enabled changed
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
        updates.push(`next_fire = $${paramIndex++}`);
        values.push(newNextFire);
      }
    }

    values.push(id, this.userId);

    await this.execute(
      `UPDATE triggers SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  /**
   * Delete a trigger
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM triggers WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
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
    status: TriggerStatus,
    result?: unknown,
    error?: string,
    durationMs?: number
  ): Promise<TriggerHistory> {
    const id = `hist_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await this.execute(
      `INSERT INTO trigger_history (id, trigger_id, status, result, error, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        triggerId,
        status,
        result ? JSON.stringify(result) : null,
        error ?? null,
        durationMs ?? null,
      ]
    );

    return (await this.getHistory(id))!;
  }

  /**
   * Get history entry by ID
   */
  async getHistory(id: string): Promise<TriggerHistory | null> {
    const row = await this.queryOne<HistoryRow>(
      `SELECT h.* FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE h.id = $1 AND t.user_id = $2`,
      [id, this.userId]
    );
    return row ? this.mapHistory(row) : null;
  }

  /**
   * Get history for a trigger
   */
  async getHistoryForTrigger(triggerId: string, limit = 20): Promise<TriggerHistory[]> {
    const rows = await this.query<HistoryRow>(
      `SELECT h.* FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE h.trigger_id = $1 AND t.user_id = $2
       ORDER BY h.fired_at DESC
       LIMIT $3`,
      [triggerId, this.userId, limit]
    );
    return rows.map((row) => this.mapHistory(row));
  }

  /**
   * Get recent history across all triggers
   */
  async getRecentHistory(limit = 50): Promise<Array<TriggerHistory & { triggerName: string }>> {
    const rows = await this.query<HistoryRow & { trigger_name: string }>(
      `SELECT h.*, t.name as trigger_name FROM trigger_history h
       JOIN triggers t ON h.trigger_id = t.id
       WHERE t.user_id = $1
       ORDER BY h.fired_at DESC
       LIMIT $2`,
      [this.userId, limit]
    );
    return rows.map((row) => ({
      ...this.mapHistory(row),
      triggerName: row.trigger_name,
    }));
  }

  /**
   * Clean up old history
   */
  async cleanupHistory(maxAgeDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const result = await this.execute(
      `DELETE FROM trigger_history
       WHERE trigger_id IN (SELECT id FROM triggers WHERE user_id = $1)
         AND fired_at < $2`,
      [this.userId, cutoff.toISOString()]
    );

    return result.changes;
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
      successRate: totalHistoryCount > 0
        ? Math.round((successCountNum / totalHistoryCount) * 100)
        : 100,
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
      log.warn(`[TriggersRepo] No next fire time found for cron "${config.cron}" — trigger will not auto-fire`);
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
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      action: typeof row.action === 'string' ? JSON.parse(row.action) : row.action,
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
      firedAt: new Date(row.fired_at),
      status: row.status,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
      error: row.error,
      durationMs: row.duration_ms,
    };
  }
}

// Factory function for creating repository instances
export function createTriggersRepository(userId = 'default'): TriggersRepository {
  return new TriggersRepository(userId);
}

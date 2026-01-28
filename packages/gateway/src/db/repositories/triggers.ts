/**
 * Triggers Repository
 *
 * Database operations for proactive triggers.
 * Supports scheduled, event-based, condition-based, and webhook triggers.
 */

import { getDatabase } from '../connection.js';
import type Database from 'better-sqlite3';

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
  enabled: number;
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

export class TriggersRepository {
  private db: Database.Database;
  private userId: string;

  constructor(userId = 'default') {
    this.db = getDatabase();
    this.userId = userId;
  }

  // ==========================================================================
  // Trigger CRUD
  // ==========================================================================

  /**
   * Create a new trigger
   */
  create(input: CreateTriggerInput): Trigger {
    const id = `trigger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    // Calculate next fire time for schedule triggers
    let nextFire: string | null = null;
    if (input.type === 'schedule' && input.enabled !== false) {
      nextFire = this.calculateNextFire(input.config as ScheduleConfig);
    }

    const stmt = this.db.prepare(`
      INSERT INTO triggers (id, user_id, name, description, type, config, action, enabled, priority, next_fire, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.name,
      input.description ?? null,
      input.type,
      JSON.stringify(input.config),
      JSON.stringify(input.action),
      input.enabled !== false ? 1 : 0,
      input.priority ?? 5,
      nextFire,
      now,
      now
    );

    return this.get(id)!;
  }

  /**
   * Get a trigger by ID
   */
  get(id: string): Trigger | null {
    const stmt = this.db.prepare(`
      SELECT * FROM triggers WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId) as TriggerRow | undefined;
    return row ? this.mapTrigger(row) : null;
  }

  /**
   * Update a trigger
   */
  update(id: string, input: UpdateTriggerInput): Trigger | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [new Date().toISOString()];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(input.config));
    }
    if (input.action !== undefined) {
      updates.push('action = ?');
      values.push(JSON.stringify(input.action));
    }
    if (input.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      values.push(Math.max(1, Math.min(10, input.priority)));
    }

    // Recalculate next fire if config or enabled changed
    if (input.config !== undefined || input.enabled !== undefined) {
      const config = input.config ?? existing.config;
      const enabled = input.enabled ?? existing.enabled;
      if (existing.type === 'schedule' && enabled) {
        updates.push('next_fire = ?');
        values.push(this.calculateNextFire(config as ScheduleConfig));
      }
    }

    values.push(id, this.userId);

    const stmt = this.db.prepare(`
      UPDATE triggers SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
    `);

    stmt.run(...values);
    return this.get(id);
  }

  /**
   * Delete a trigger
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM triggers WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  /**
   * List triggers with filters
   */
  list(query: TriggerQuery = {}): Trigger[] {
    let sql = 'SELECT * FROM triggers WHERE user_id = ?';
    const params: unknown[] = [this.userId];

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      sql += ` AND type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }

    if (query.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(query.enabled ? 1 : 0);
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TriggerRow[];
    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Get triggers due to fire
   */
  getDueTriggers(): Trigger[] {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      SELECT * FROM triggers
      WHERE user_id = ?
        AND enabled = 1
        AND type = 'schedule'
        AND next_fire IS NOT NULL
        AND next_fire <= ?
      ORDER BY priority DESC, next_fire ASC
    `);

    const rows = stmt.all(this.userId, now) as TriggerRow[];
    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Get triggers by event type
   */
  getByEventType(eventType: string): Trigger[] {
    const stmt = this.db.prepare(`
      SELECT * FROM triggers
      WHERE user_id = ?
        AND enabled = 1
        AND type = 'event'
      ORDER BY priority DESC
    `);

    const rows = stmt.all(this.userId) as TriggerRow[];
    return rows
      .map((row) => this.mapTrigger(row))
      .filter((t) => (t.config as EventConfig).eventType === eventType);
  }

  /**
   * Get condition-based triggers
   */
  getConditionTriggers(): Trigger[] {
    const stmt = this.db.prepare(`
      SELECT * FROM triggers
      WHERE user_id = ?
        AND enabled = 1
        AND type = 'condition'
      ORDER BY priority DESC
    `);

    const rows = stmt.all(this.userId) as TriggerRow[];
    return rows.map((row) => this.mapTrigger(row));
  }

  /**
   * Mark trigger as fired
   */
  markFired(id: string, nextFire?: string): void {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE triggers
      SET last_fired = ?, next_fire = ?, fire_count = fire_count + 1, updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(now, nextFire ?? null, now, id, this.userId);
  }

  // ==========================================================================
  // Trigger History
  // ==========================================================================

  /**
   * Log trigger execution
   */
  logExecution(
    triggerId: string,
    status: TriggerStatus,
    result?: unknown,
    error?: string,
    durationMs?: number
  ): TriggerHistory {
    const id = `hist_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO trigger_history (id, trigger_id, status, result, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      triggerId,
      status,
      result ? JSON.stringify(result) : null,
      error ?? null,
      durationMs ?? null
    );

    return this.getHistory(id)!;
  }

  /**
   * Get history entry by ID
   */
  getHistory(id: string): TriggerHistory | null {
    const stmt = this.db.prepare(`
      SELECT h.* FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE h.id = ? AND t.user_id = ?
    `);

    const row = stmt.get(id, this.userId) as HistoryRow | undefined;
    return row ? this.mapHistory(row) : null;
  }

  /**
   * Get history for a trigger
   */
  getHistoryForTrigger(triggerId: string, limit = 20): TriggerHistory[] {
    const stmt = this.db.prepare(`
      SELECT h.* FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE h.trigger_id = ? AND t.user_id = ?
      ORDER BY h.fired_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(triggerId, this.userId, limit) as HistoryRow[];
    return rows.map((row) => this.mapHistory(row));
  }

  /**
   * Get recent history across all triggers
   */
  getRecentHistory(limit = 50): Array<TriggerHistory & { triggerName: string }> {
    const stmt = this.db.prepare(`
      SELECT h.*, t.name as trigger_name FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE t.user_id = ?
      ORDER BY h.fired_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(this.userId, limit) as Array<HistoryRow & { trigger_name: string }>;
    return rows.map((row) => ({
      ...this.mapHistory(row),
      triggerName: row.trigger_name,
    }));
  }

  /**
   * Clean up old history
   */
  cleanupHistory(maxAgeDays = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const stmt = this.db.prepare(`
      DELETE FROM trigger_history
      WHERE trigger_id IN (SELECT id FROM triggers WHERE user_id = ?)
        AND fired_at < ?
    `);

    const result = stmt.run(this.userId, cutoff.toISOString());
    return result.changes;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get trigger statistics
   */
  getStats(): {
    total: number;
    enabled: number;
    byType: Record<TriggerType, number>;
    totalFires: number;
    firesThisWeek: number;
    successRate: number;
  } {
    const total = this.db.prepare(`
      SELECT COUNT(*) as count FROM triggers WHERE user_id = ?
    `).get(this.userId) as { count: number };

    const enabled = this.db.prepare(`
      SELECT COUNT(*) as count FROM triggers WHERE user_id = ? AND enabled = 1
    `).get(this.userId) as { count: number };

    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM triggers WHERE user_id = ? GROUP BY type
    `).all(this.userId) as Array<{ type: TriggerType; count: number }>;

    const totalFires = this.db.prepare(`
      SELECT SUM(fire_count) as total FROM triggers WHERE user_id = ?
    `).get(this.userId) as { total: number | null };

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const firesThisWeek = this.db.prepare(`
      SELECT COUNT(*) as count FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE t.user_id = ? AND h.fired_at >= ?
    `).get(this.userId, weekAgo.toISOString()) as { count: number };

    const successCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE t.user_id = ? AND h.status = 'success'
    `).get(this.userId) as { count: number };

    const totalHistory = this.db.prepare(`
      SELECT COUNT(*) as count FROM trigger_history h
      JOIN triggers t ON h.trigger_id = t.id
      WHERE t.user_id = ?
    `).get(this.userId) as { count: number };

    const typeMap: Record<TriggerType, number> = {
      schedule: 0,
      event: 0,
      condition: 0,
      webhook: 0,
    };
    for (const row of byType) {
      typeMap[row.type] = row.count;
    }

    return {
      total: total.count,
      enabled: enabled.count,
      byType: typeMap,
      totalFires: totalFires.total ?? 0,
      firesThisWeek: firesThisWeek.count,
      successRate: totalHistory.count > 0
        ? Math.round((successCount.count / totalHistory.count) * 100)
        : 100,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Calculate next fire time from cron expression
   * Simple implementation - for production use a proper cron library
   */
  private calculateNextFire(config: ScheduleConfig): string | null {
    // This is a simplified implementation
    // In production, use a library like 'cron-parser'
    try {
      const now = new Date();
      // Default: add 1 hour for demo purposes
      // Real implementation would parse the cron expression
      now.setHours(now.getHours() + 1);
      return now.toISOString();
    } catch {
      return null;
    }
  }

  private mapTrigger(row: TriggerRow): Trigger {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      type: row.type,
      config: JSON.parse(row.config),
      action: JSON.parse(row.action),
      enabled: row.enabled === 1,
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
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
      durationMs: row.duration_ms,
    };
  }
}

// Singleton instance for default user
export const triggersRepo = new TriggersRepository();

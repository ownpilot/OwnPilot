/**
 * Heartbeats Repository
 *
 * Database operations for heartbeat entries (NL-to-cron periodic tasks).
 * Each heartbeat owns one backing trigger and keeps it in sync.
 */

import { BaseRepository, parseJsonField } from './base.js';
import { generateId } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export interface Heartbeat {
  id: string;
  userId: string;
  name: string;
  scheduleText: string;
  cron: string;
  taskDescription: string;
  triggerId: string | null;
  enabled: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateHeartbeatInput {
  name: string;
  scheduleText: string;
  cron: string;
  taskDescription: string;
  triggerId?: string;
  enabled?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateHeartbeatInput {
  name?: string;
  scheduleText?: string;
  cron?: string;
  taskDescription?: string;
  triggerId?: string | null;
  enabled?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface HeartbeatQuery {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

interface HeartbeatRow {
  id: string;
  user_id: string;
  name: string;
  schedule_text: string;
  cron: string;
  task_description: string;
  trigger_id: string | null;
  enabled: boolean;
  tags: string | string[];
  metadata: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Repository
// ============================================================================

export class HeartbeatsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateHeartbeatInput): Promise<Heartbeat> {
    const id = generateId('hb');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO heartbeats (id, user_id, name, schedule_text, cron, task_description, trigger_id, enabled, tags, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        this.userId,
        input.name,
        input.scheduleText,
        input.cron,
        input.taskDescription,
        input.triggerId ?? null,
        input.enabled !== false,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ],
    );

    const heartbeat = await this.get(id);
    if (!heartbeat) throw new Error('Failed to create heartbeat');
    return heartbeat;
  }

  async get(id: string): Promise<Heartbeat | null> {
    const row = await this.queryOne<HeartbeatRow>(
      'SELECT * FROM heartbeats WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    );
    return row ? this.mapRow(row) : null;
  }

  async update(id: string, input: UpdateHeartbeatInput): Promise<Heartbeat | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = $1'];
    const values: unknown[] = [new Date().toISOString()];
    let paramIndex = 2;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.scheduleText !== undefined) {
      updates.push(`schedule_text = $${paramIndex++}`);
      values.push(input.scheduleText);
    }
    if (input.cron !== undefined) {
      updates.push(`cron = $${paramIndex++}`);
      values.push(input.cron);
    }
    if (input.taskDescription !== undefined) {
      updates.push(`task_description = $${paramIndex++}`);
      values.push(input.taskDescription);
    }
    if (input.triggerId !== undefined) {
      updates.push(`trigger_id = $${paramIndex++}`);
      values.push(input.triggerId);
    }
    if (input.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id, this.userId);

    await this.execute(
      `UPDATE heartbeats SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values,
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM heartbeats WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    );
    return result.changes > 0;
  }

  async list(query: HeartbeatQuery = {}): Promise<Heartbeat[]> {
    let sql = 'SELECT * FROM heartbeats WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.enabled !== undefined) {
      sql += ` AND enabled = $${paramIndex++}`;
      params.push(query.enabled);
    }

    sql += ' ORDER BY created_at DESC';

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<HeartbeatRow>(sql, params);
    return rows.map((row) => this.mapRow(row));
  }

  async getByTriggerId(triggerId: string): Promise<Heartbeat | null> {
    const row = await this.queryOne<HeartbeatRow>(
      'SELECT * FROM heartbeats WHERE trigger_id = $1 AND user_id = $2',
      [triggerId, this.userId],
    );
    return row ? this.mapRow(row) : null;
  }

  async count(enabled?: boolean): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM heartbeats WHERE user_id = $1';
    const params: unknown[] = [this.userId];

    if (enabled !== undefined) {
      sql += ' AND enabled = $2';
      params.push(enabled);
    }

    const row = await this.queryOne<{ count: string }>(sql, params);
    return parseInt(row?.count ?? '0', 10);
  }

  private mapRow(row: HeartbeatRow): Heartbeat {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      scheduleText: row.schedule_text,
      cron: row.cron,
      taskDescription: row.task_description,
      triggerId: row.trigger_id,
      enabled: row.enabled,
      tags: parseJsonField<string[]>(row.tags, []),
      metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export function createHeartbeatsRepository(userId = 'default'): HeartbeatsRepository {
  return new HeartbeatsRepository(userId);
}

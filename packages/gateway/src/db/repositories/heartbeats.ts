/**
 * Heartbeats Repository
 *
 * Database operations for heartbeat entries (NL-to-cron periodic tasks).
 * Each heartbeat owns one backing trigger and keeps it in sync.
 * Extends CrudRepository for standard create/get/update/delete/count.
 */

import { parseJsonField } from './base.js';
import { CrudRepository, type CreateFields } from './crud-base.js';
import type { UpdateField } from './query-helpers.js';
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

interface HeartbeatRow extends Record<string, unknown> {
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

export class HeartbeatsRepository extends CrudRepository<
  HeartbeatRow,
  Heartbeat,
  CreateHeartbeatInput,
  UpdateHeartbeatInput
> {
  readonly tableName = 'heartbeats';

  protected override generateId(): string {
    return generateId('hb');
  }

  mapRow(row: HeartbeatRow): Heartbeat {
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

  buildCreateFields(input: CreateHeartbeatInput): CreateFields {
    const now = new Date().toISOString();
    return {
      name: input.name,
      schedule_text: input.scheduleText,
      cron: input.cron,
      task_description: input.taskDescription,
      trigger_id: input.triggerId ?? null,
      enabled: input.enabled !== false,
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      created_at: now,
      updated_at: now,
    };
  }

  buildUpdateFields(input: UpdateHeartbeatInput): UpdateField[] {
    return [
      { column: 'name', value: input.name },
      { column: 'schedule_text', value: input.scheduleText },
      { column: 'cron', value: input.cron },
      { column: 'task_description', value: input.taskDescription },
      { column: 'trigger_id', value: input.triggerId },
      { column: 'enabled', value: input.enabled },
      { column: 'tags', value: input.tags !== undefined ? JSON.stringify(input.tags) : undefined },
      {
        column: 'metadata',
        value: input.metadata !== undefined ? JSON.stringify(input.metadata) : undefined,
      },
    ];
  }

  // --- Alias: keep backward-compatible `get` method ---

  async get(id: string): Promise<Heartbeat | null> {
    return this.getById(id);
  }

  // --- Override update to use updated_at timestamp string instead of NOW() ---

  override async update(id: string, input: UpdateHeartbeatInput): Promise<Heartbeat | null> {
    const existing = await this.getById(id);
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

  // --- Domain-specific methods ---

  async getByTriggerId(triggerId: string): Promise<Heartbeat | null> {
    const row = await this.queryOne<HeartbeatRow>(
      'SELECT * FROM heartbeats WHERE trigger_id = $1 AND user_id = $2',
      [triggerId, this.userId],
    );
    return row ? this.mapRow(row) : null;
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

  override async count(enabled?: boolean): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM heartbeats WHERE user_id = $1';
    const params: unknown[] = [this.userId];

    if (enabled !== undefined) {
      sql += ' AND enabled = $2';
      params.push(enabled);
    }

    const row = await this.queryOne<{ count: string }>(sql, params);
    return parseInt(row?.count ?? '0', 10);
  }
}

export function createHeartbeatsRepository(userId = 'default'): HeartbeatsRepository {
  return new HeartbeatsRepository(userId);
}

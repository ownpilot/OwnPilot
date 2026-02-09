/**
 * Tasks Repository (PostgreSQL)
 *
 * CRUD operations for personal tasks/todos
 */

import { BaseRepository, parseJsonField } from './base.js';
import { MS_PER_DAY } from '../../config/defaults.js';
import type { StandardQuery } from './interfaces.js';
import {
  getEventBus,
  createEvent,
  EventTypes,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';

export interface Task {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string;
  dueTime?: string;
  reminderAt?: string;
  category?: string;
  tags: string[];
  parentId?: string;
  projectId?: string;
  recurrence?: string;
  completedAt?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: Task['priority'];
  dueDate?: string;
  dueTime?: string;
  reminderAt?: string;
  category?: string;
  tags?: string[];
  parentId?: string;
  projectId?: string;
  recurrence?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  dueDate?: string;
  dueTime?: string;
  reminderAt?: string;
  category?: string;
  tags?: string[];
  parentId?: string;
  projectId?: string;
  recurrence?: string;
}

export interface TaskQuery extends StandardQuery {
  status?: Task['status'] | Task['status'][];
  priority?: Task['priority'] | Task['priority'][];
  category?: string;
  projectId?: string;
  parentId?: string | null;
  dueBefore?: string;
  dueAfter?: string;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  reminder_at: string | null;
  category: string | null;
  tags: string;
  parent_id: string | null;
  project_id: string | null;
  recurrence: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    dueDate: row.due_date ?? undefined,
    dueTime: row.due_time ?? undefined,
    reminderAt: row.reminder_at ?? undefined,
    category: row.category ?? undefined,
    tags: parseJsonField(row.tags, []),
    parentId: row.parent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    recurrence: row.recurrence ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class TasksRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  /**
   * Get a task by ID (standard interface alias)
   */
  async getById(id: string): Promise<Task | null> {
    return this.get(id);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();

    await this.execute(
      `INSERT INTO tasks (id, user_id, title, description, priority, due_date, due_time,
        reminder_at, category, tags, parent_id, project_id, recurrence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        this.userId,
        input.title,
        input.description ?? null,
        input.priority ?? 'normal',
        input.dueDate ?? null,
        input.dueTime ?? null,
        input.reminderAt ?? null,
        input.category ?? null,
        JSON.stringify(input.tags ?? []),
        input.parentId ?? null,
        input.projectId ?? null,
        input.recurrence ?? null,
      ]
    );

    const task = await this.get(id);
    if (!task) throw new Error('Failed to create task');

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'tasks-repository',
      { resourceType: 'task', id },
    ));

    return task;
  }

  async get(id: string): Promise<Task | null> {
    const row = await this.queryOne<TaskRow>(
      `SELECT * FROM tasks WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToTask(row) : null;
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);

      // Handle completed_at timestamp
      if (input.status === 'completed' && existing.status !== 'completed') {
        updates.push(`completed_at = NOW()`);
      } else if (input.status !== 'completed') {
        updates.push(`completed_at = NULL`);
      }
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(input.priority);
    }
    if (input.dueDate !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(input.dueDate);
    }
    if (input.dueTime !== undefined) {
      updates.push(`due_time = $${paramIndex++}`);
      values.push(input.dueTime);
    }
    if (input.reminderAt !== undefined) {
      updates.push(`reminder_at = $${paramIndex++}`);
      values.push(input.reminderAt);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.parentId !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(input.parentId);
    }
    if (input.projectId !== undefined) {
      updates.push(`project_id = $${paramIndex++}`);
      values.push(input.projectId);
    }
    if (input.recurrence !== undefined) {
      updates.push(`recurrence = $${paramIndex++}`);
      values.push(input.recurrence);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = NOW()');
    values.push(id, this.userId);

    await this.execute(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    const updated = await this.get(id);

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'tasks-repository',
        { resourceType: 'task', id, changes: input },
      ));
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM tasks WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    const deleted = result.changes > 0;

    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'tasks-repository',
        { resourceType: 'task', id },
      ));
    }

    return deleted;
  }

  async complete(id: string): Promise<Task | null> {
    return this.update(id, { status: 'completed' });
  }

  async list(query: TaskQuery = {}): Promise<Task[]> {
    let sql = `SELECT * FROM tasks WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sql += ` AND status IN (${statuses.map(() => `$${paramIndex++}`).join(',')})`;
      params.push(...statuses);
    }

    if (query.priority) {
      const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
      sql += ` AND priority IN (${priorities.map(() => `$${paramIndex++}`).join(',')})`;
      params.push(...priorities);
    }

    if (query.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(query.category);
    }

    if (query.projectId) {
      sql += ` AND project_id = $${paramIndex++}`;
      params.push(query.projectId);
    }

    if (query.parentId === null) {
      sql += ` AND parent_id IS NULL`;
    } else if (query.parentId) {
      sql += ` AND parent_id = $${paramIndex++}`;
      params.push(query.parentId);
    }

    if (query.dueBefore) {
      sql += ` AND due_date <= $${paramIndex++}`;
      params.push(query.dueBefore);
    }

    if (query.dueAfter) {
      sql += ` AND due_date >= $${paramIndex++}`;
      params.push(query.dueAfter);
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    sql += ` ORDER BY
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
      END,
      due_date ASC NULLS LAST,
      created_at DESC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<TaskRow>(sql, params);
    return rows.map(rowToTask);
  }

  async getSubtasks(parentId: string): Promise<Task[]> {
    return this.list({ parentId });
  }

  async getByProject(projectId: string): Promise<Task[]> {
    return this.list({ projectId });
  }

  async getDueToday(): Promise<Task[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.list({ dueAfter: today, dueBefore: today, status: ['pending', 'in_progress'] });
  }

  async getOverdue(): Promise<Task[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.list({ dueBefore: today, status: ['pending', 'in_progress'] });
  }

  async getUpcoming(days = 7): Promise<Task[]> {
    const today = new Date();
    const futureDate = new Date(today.getTime() + days * MS_PER_DAY);
    return this.list({
      dueAfter: today.toISOString().split('T')[0],
      dueBefore: futureDate.toISOString().split('T')[0],
      status: ['pending', 'in_progress'],
    });
  }

  async count(query: TaskQuery = {}): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM tasks WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sql += ` AND status IN (${statuses.map(() => `$${paramIndex++}`).join(',')})`;
      params.push(...statuses);
    }

    if (query.projectId) {
      sql += ` AND project_id = $${paramIndex++}`;
      params.push(query.projectId);
    }

    const row = await this.queryOne<{ count: string }>(sql, params);
    return parseInt(row?.count ?? '0', 10);
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM tasks WHERE user_id = $1 AND category IS NOT NULL ORDER BY category`,
      [this.userId]
    );
    return rows.map(r => r.category);
  }

  async search(searchQuery: string, limit = 20): Promise<Task[]> {
    return this.list({ search: searchQuery, limit });
  }
}

export const tasksRepo = new TasksRepository();

// Factory function
export function createTasksRepository(userId = 'default'): TasksRepository {
  return new TasksRepository(userId);
}

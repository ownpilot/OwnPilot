/**
 * Tasks Repository
 *
 * CRUD operations for personal tasks/todos
 */

import { getDatabase } from '../connection.js';

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

export interface TaskQuery {
  status?: Task['status'] | Task['status'][];
  priority?: Task['priority'] | Task['priority'][];
  category?: string;
  projectId?: string;
  parentId?: string | null;
  dueBefore?: string;
  dueAfter?: string;
  search?: string;
  limit?: number;
  offset?: number;
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
    tags: JSON.parse(row.tags || '[]'),
    parentId: row.parent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    recurrence: row.recurrence ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class TasksRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateTaskInput): Task {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, user_id, title, description, priority, due_date, due_time,
        reminder_at, category, tags, parent_id, project_id, recurrence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): Task | null {
    const stmt = this.db.prepare<[string, string], TaskRow>(`
      SELECT * FROM tasks WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToTask(row) : null;
  }

  update(id: string, input: UpdateTaskInput): Task | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const completedAt = input.status === 'completed' && existing.status !== 'completed'
      ? now
      : input.status !== 'completed' ? null : existing.completedAt;

    const stmt = this.db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        due_date = COALESCE(?, due_date),
        due_time = COALESCE(?, due_time),
        reminder_at = COALESCE(?, reminder_at),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        parent_id = COALESCE(?, parent_id),
        project_id = COALESCE(?, project_id),
        recurrence = COALESCE(?, recurrence),
        completed_at = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.title ?? null,
      input.description ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.dueDate ?? null,
      input.dueTime ?? null,
      input.reminderAt ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.parentId ?? null,
      input.projectId ?? null,
      input.recurrence ?? null,
      completedAt,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  complete(id: string): Task | null {
    return this.update(id, { status: 'completed' });
  }

  list(query: TaskQuery = {}): Task[] {
    let sql = `SELECT * FROM tasks WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (query.priority) {
      const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
      sql += ` AND priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }

    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }

    if (query.projectId) {
      sql += ` AND project_id = ?`;
      params.push(query.projectId);
    }

    if (query.parentId === null) {
      sql += ` AND parent_id IS NULL`;
    } else if (query.parentId) {
      sql += ` AND parent_id = ?`;
      params.push(query.parentId);
    }

    if (query.dueBefore) {
      sql += ` AND due_date <= ?`;
      params.push(query.dueBefore);
    }

    if (query.dueAfter) {
      sql += ` AND due_date >= ?`;
      params.push(query.dueAfter);
    }

    if (query.search) {
      sql += ` AND (title LIKE ? OR description LIKE ?)`;
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm);
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
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], TaskRow>(sql);
    return stmt.all(...params).map(rowToTask);
  }

  getSubtasks(parentId: string): Task[] {
    return this.list({ parentId });
  }

  getByProject(projectId: string): Task[] {
    return this.list({ projectId });
  }

  getDueToday(): Task[] {
    const today = new Date().toISOString().split('T')[0];
    return this.list({ dueAfter: today, dueBefore: today, status: ['pending', 'in_progress'] });
  }

  getOverdue(): Task[] {
    const today = new Date().toISOString().split('T')[0];
    return this.list({ dueBefore: today, status: ['pending', 'in_progress'] });
  }

  getUpcoming(days = 7): Task[] {
    const today = new Date();
    const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    return this.list({
      dueAfter: today.toISOString().split('T')[0],
      dueBefore: futureDate.toISOString().split('T')[0],
      status: ['pending', 'in_progress'],
    });
  }

  count(query: TaskQuery = {}): number {
    let sql = `SELECT COUNT(*) as count FROM tasks WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (query.projectId) {
      sql += ` AND project_id = ?`;
      params.push(query.projectId);
    }

    const stmt = this.db.prepare<unknown[], { count: number }>(sql);
    return stmt.get(...params)?.count ?? 0;
  }

  getCategories(): string[] {
    const stmt = this.db.prepare<string, { category: string }>(`
      SELECT DISTINCT category FROM tasks
      WHERE user_id = ? AND category IS NOT NULL
      ORDER BY category
    `);

    return stmt.all(this.userId).map(r => r.category);
  }

  search(query: string, limit = 20): Task[] {
    return this.list({ search: query, limit });
  }
}

export const tasksRepo = new TasksRepository();

/**
 * Goals Repository
 *
 * Database operations for goals and goal steps.
 * Supports long-term objectives tracking with decomposition into steps.
 */

import { getDatabase } from '../connection.js';
import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: number;
  parentId: string | null;
  dueDate: string | null;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface GoalStep {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  status: StepStatus;
  orderNum: number;
  dependencies: string[];
  result: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  status?: GoalStatus;
  priority?: number;
  parentId?: string;
  dueDate?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string;
  status?: GoalStatus;
  priority?: number;
  dueDate?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateStepInput {
  title: string;
  description?: string;
  orderNum?: number;
  dependencies?: string[];
}

export interface UpdateStepInput {
  title?: string;
  description?: string;
  status?: StepStatus;
  orderNum?: number;
  dependencies?: string[];
  result?: string;
}

export interface GoalQuery {
  status?: GoalStatus | GoalStatus[];
  parentId?: string | null;
  minPriority?: number;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'priority' | 'created' | 'due_date' | 'progress';
}

interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: number;
  parent_id: string | null;
  due_date: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: string;
}

interface StepRow {
  id: string;
  goal_id: string;
  title: string;
  description: string | null;
  status: StepStatus;
  order_num: number;
  dependencies: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

// ============================================================================
// Repository
// ============================================================================

export class GoalsRepository {
  private db: Database.Database;
  private userId: string;

  constructor(userId = 'default') {
    this.db = getDatabase();
    this.userId = userId;
  }

  // ==========================================================================
  // Goal CRUD
  // ==========================================================================

  /**
   * Create a new goal
   */
  create(input: CreateGoalInput): Goal {
    const id = `goal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO goals (id, user_id, title, description, status, priority, parent_id, due_date, progress, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.title,
      input.description ?? null,
      input.status ?? 'active',
      input.priority ?? 5,
      input.parentId ?? null,
      input.dueDate ?? null,
      0,
      now,
      now,
      JSON.stringify(input.metadata ?? {})
    );

    return this.get(id)!;
  }

  /**
   * Get a goal by ID
   */
  get(id: string): Goal | null {
    const stmt = this.db.prepare(`
      SELECT * FROM goals WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId) as GoalRow | undefined;
    return row ? this.mapGoal(row) : null;
  }

  /**
   * Update a goal
   */
  update(id: string, input: UpdateGoalInput): Goal | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [new Date().toISOString()];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
      if (input.status === 'completed') {
        updates.push('completed_at = ?');
        values.push(new Date().toISOString());
      }
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      values.push(Math.max(1, Math.min(10, input.priority)));
    }
    if (input.dueDate !== undefined) {
      updates.push('due_date = ?');
      values.push(input.dueDate);
    }
    if (input.progress !== undefined) {
      updates.push('progress = ?');
      values.push(Math.max(0, Math.min(100, input.progress)));
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id, this.userId);

    const stmt = this.db.prepare(`
      UPDATE goals SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
    `);

    stmt.run(...values);
    return this.get(id);
  }

  /**
   * Delete a goal
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM goals WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  /**
   * List goals with filters
   */
  list(query: GoalQuery = {}): Goal[] {
    let sql = 'SELECT * FROM goals WHERE user_id = ?';
    const params: unknown[] = [this.userId];

    // Status filter
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
      params.push(...statuses);
    }

    // Parent filter
    if (query.parentId !== undefined) {
      if (query.parentId === null) {
        sql += ' AND parent_id IS NULL';
      } else {
        sql += ' AND parent_id = ?';
        params.push(query.parentId);
      }
    }

    // Priority filter
    if (query.minPriority !== undefined) {
      sql += ' AND priority >= ?';
      params.push(query.minPriority);
    }

    // Search
    if (query.search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm);
    }

    // Order by
    switch (query.orderBy) {
      case 'priority':
        sql += ' ORDER BY priority DESC, created_at DESC';
        break;
      case 'due_date':
        sql += ' ORDER BY due_date ASC NULLS LAST, priority DESC';
        break;
      case 'progress':
        sql += ' ORDER BY progress DESC, priority DESC';
        break;
      default:
        sql += ' ORDER BY created_at DESC';
    }

    // Pagination
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as GoalRow[];
    return rows.map((row) => this.mapGoal(row));
  }

  /**
   * Get active goals (for AI context)
   */
  getActive(limit = 10): Goal[] {
    return this.list({
      status: 'active',
      orderBy: 'priority',
      limit,
    });
  }

  /**
   * Get goals with upcoming due dates
   */
  getUpcoming(days = 7): Goal[] {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const stmt = this.db.prepare(`
      SELECT * FROM goals
      WHERE user_id = ?
        AND status = 'active'
        AND due_date IS NOT NULL
        AND due_date <= ?
      ORDER BY due_date ASC
    `);

    const rows = stmt.all(this.userId, futureDate.toISOString()) as GoalRow[];
    return rows.map((row) => this.mapGoal(row));
  }

  /**
   * Update goal progress based on completed steps
   */
  recalculateProgress(goalId: string): number {
    const steps = this.getSteps(goalId);
    if (steps.length === 0) return 0;

    const completedSteps = steps.filter((s) => s.status === 'completed').length;
    const progress = Math.round((completedSteps / steps.length) * 100);

    this.update(goalId, { progress });
    return progress;
  }

  // ==========================================================================
  // Goal Steps
  // ==========================================================================

  /**
   * Add a step to a goal
   */
  addStep(goalId: string, input: CreateStepInput): GoalStep | null {
    const goal = this.get(goalId);
    if (!goal) return null;

    const id = `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    // Get max order num if not provided
    let orderNum = input.orderNum;
    if (orderNum === undefined) {
      const maxStmt = this.db.prepare(`
        SELECT MAX(order_num) as max_order FROM goal_steps WHERE goal_id = ?
      `);
      const result = maxStmt.get(goalId) as { max_order: number | null };
      orderNum = (result?.max_order ?? -1) + 1;
    }

    const stmt = this.db.prepare(`
      INSERT INTO goal_steps (id, goal_id, title, description, status, order_num, dependencies, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      goalId,
      input.title,
      input.description ?? null,
      'pending',
      orderNum,
      JSON.stringify(input.dependencies ?? []),
      now
    );

    return this.getStep(id);
  }

  /**
   * Get a step by ID
   */
  getStep(id: string): GoalStep | null {
    const stmt = this.db.prepare(`
      SELECT s.* FROM goal_steps s
      JOIN goals g ON s.goal_id = g.id
      WHERE s.id = ? AND g.user_id = ?
    `);

    const row = stmt.get(id, this.userId) as StepRow | undefined;
    return row ? this.mapStep(row) : null;
  }

  /**
   * Update a step
   */
  updateStep(id: string, input: UpdateStepInput): GoalStep | null {
    const existing = this.getStep(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
      if (input.status === 'completed') {
        updates.push('completed_at = ?');
        values.push(new Date().toISOString());
      }
    }
    if (input.orderNum !== undefined) {
      updates.push('order_num = ?');
      values.push(input.orderNum);
    }
    if (input.dependencies !== undefined) {
      updates.push('dependencies = ?');
      values.push(JSON.stringify(input.dependencies));
    }
    if (input.result !== undefined) {
      updates.push('result = ?');
      values.push(input.result);
    }

    if (updates.length === 0) return existing;

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE goal_steps SET ${updates.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);

    // Recalculate goal progress
    this.recalculateProgress(existing.goalId);

    return this.getStep(id);
  }

  /**
   * Delete a step
   */
  deleteStep(id: string): boolean {
    const step = this.getStep(id);
    if (!step) return false;

    const stmt = this.db.prepare(`
      DELETE FROM goal_steps WHERE id = ?
    `);

    const result = stmt.run(id);

    // Recalculate goal progress
    if (result.changes > 0) {
      this.recalculateProgress(step.goalId);
    }

    return result.changes > 0;
  }

  /**
   * Get all steps for a goal
   */
  getSteps(goalId: string): GoalStep[] {
    const stmt = this.db.prepare(`
      SELECT s.* FROM goal_steps s
      JOIN goals g ON s.goal_id = g.id
      WHERE s.goal_id = ? AND g.user_id = ?
      ORDER BY s.order_num ASC
    `);

    const rows = stmt.all(goalId, this.userId) as StepRow[];
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Get next actionable steps across all goals
   */
  getNextActions(limit = 5): Array<GoalStep & { goalTitle: string }> {
    const stmt = this.db.prepare(`
      SELECT s.*, g.title as goal_title FROM goal_steps s
      JOIN goals g ON s.goal_id = g.id
      WHERE g.user_id = ?
        AND g.status = 'active'
        AND s.status IN ('pending', 'in_progress')
        AND NOT EXISTS (
          SELECT 1 FROM goal_steps dep
          WHERE dep.id IN (SELECT value FROM json_each(s.dependencies))
            AND dep.status != 'completed'
        )
      ORDER BY g.priority DESC, s.order_num ASC
      LIMIT ?
    `);

    const rows = stmt.all(this.userId, limit) as Array<StepRow & { goal_title: string }>;
    return rows.map((row) => ({
      ...this.mapStep(row),
      goalTitle: row.goal_title,
    }));
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get goal statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<GoalStatus, number>;
    completedThisWeek: number;
    averageProgress: number;
    overdueCount: number;
  } {
    const total = this.db.prepare(`
      SELECT COUNT(*) as count FROM goals WHERE user_id = ?
    `).get(this.userId) as { count: number };

    const byStatus = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM goals WHERE user_id = ? GROUP BY status
    `).all(this.userId) as Array<{ status: GoalStatus; count: number }>;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const completedThisWeek = this.db.prepare(`
      SELECT COUNT(*) as count FROM goals
      WHERE user_id = ? AND status = 'completed' AND completed_at >= ?
    `).get(this.userId, weekAgo.toISOString()) as { count: number };

    const avgProgress = this.db.prepare(`
      SELECT AVG(progress) as avg FROM goals WHERE user_id = ? AND status = 'active'
    `).get(this.userId) as { avg: number | null };

    const now = new Date().toISOString();
    const overdue = this.db.prepare(`
      SELECT COUNT(*) as count FROM goals
      WHERE user_id = ? AND status = 'active' AND due_date IS NOT NULL AND due_date < ?
    `).get(this.userId, now) as { count: number };

    const statusMap: Record<GoalStatus, number> = {
      active: 0,
      paused: 0,
      completed: 0,
      abandoned: 0,
    };
    for (const row of byStatus) {
      statusMap[row.status] = row.count;
    }

    return {
      total: total.count,
      byStatus: statusMap,
      completedThisWeek: completedThisWeek.count,
      averageProgress: Math.round(avgProgress.avg ?? 0),
      overdueCount: overdue.count,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private mapGoal(row: GoalRow): Goal {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id,
      dueDate: row.due_date,
      progress: row.progress,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      metadata: JSON.parse(row.metadata),
    };
  }

  private mapStep(row: StepRow): GoalStep {
    return {
      id: row.id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description,
      status: row.status,
      orderNum: row.order_num,
      dependencies: JSON.parse(row.dependencies),
      result: row.result,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
  }
}

// Singleton instance for default user
export const goalsRepo = new GoalsRepository();

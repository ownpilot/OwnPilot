/**
 * Goals Repository
 *
 * Database operations for goals and goal steps.
 * Supports long-term objectives tracking with decomposition into steps.
 */

import { BaseRepository } from './base.js';
import type { StandardQuery } from './interfaces.js';
import {
  getEventBus,
  createEvent,
  EventTypes,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';

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

export interface GoalQuery extends StandardQuery {
  status?: GoalStatus | GoalStatus[];
  parentId?: string | null;
  minPriority?: number;
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

export class GoalsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  /**
   * Get a goal by ID (standard interface alias)
   */
  async getById(id: string): Promise<Goal | null> {
    return this.get(id);
  }

  // ==========================================================================
  // Goal CRUD
  // ==========================================================================

  /**
   * Create a new goal
   */
  async create(input: CreateGoalInput): Promise<Goal> {
    const id = `goal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO goals (id, user_id, title, description, status, priority, parent_id, due_date, progress, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
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
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    const goal = await this.get(id);
    if (!goal) throw new Error('Failed to create goal');

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'goals-repository',
      { resourceType: 'goal', id },
    ));

    return goal;
  }

  /**
   * Get a goal by ID
   */
  async get(id: string): Promise<Goal | null> {
    const row = await this.queryOne<GoalRow>(
      'SELECT * FROM goals WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? this.mapGoal(row) : null;
  }

  /**
   * Update a goal
   */
  async update(id: string, input: UpdateGoalInput): Promise<Goal | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = $1'];
    const values: unknown[] = [new Date().toISOString()];
    let paramIndex = 2;

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
      if (input.status === 'completed') {
        updates.push(`completed_at = $${paramIndex++}`);
        values.push(new Date().toISOString());
      }
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(Math.max(1, Math.min(10, input.priority)));
    }
    if (input.dueDate !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(input.dueDate);
    }
    if (input.progress !== undefined) {
      updates.push(`progress = $${paramIndex++}`);
      values.push(Math.max(0, Math.min(100, input.progress)));
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id, this.userId);

    await this.execute(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    const updated = await this.get(id);

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'goals-repository',
        { resourceType: 'goal', id, changes: input },
      ));
    }

    return updated;
  }

  /**
   * Delete a goal
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM goals WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    const deleted = result.changes > 0;

    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'goals-repository',
        { resourceType: 'goal', id },
      ));
    }

    return deleted;
  }

  /**
   * List goals with filters
   */
  async list(query: GoalQuery = {}): Promise<Goal[]> {
    let sql = 'SELECT * FROM goals WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    // Status filter
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      const placeholders = statuses.map(() => `$${paramIndex++}`).join(', ');
      sql += ` AND status IN (${placeholders})`;
      params.push(...statuses);
    }

    // Parent filter
    if (query.parentId !== undefined) {
      if (query.parentId === null) {
        sql += ' AND parent_id IS NULL';
      } else {
        sql += ` AND parent_id = $${paramIndex++}`;
        params.push(query.parentId);
      }
    }

    // Priority filter
    if (query.minPriority !== undefined) {
      sql += ` AND priority >= $${paramIndex++}`;
      params.push(query.minPriority);
    }

    // Search (using ILIKE for PostgreSQL)
    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
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
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<GoalRow>(sql, params);
    return rows.map((row) => this.mapGoal(row));
  }

  /**
   * Get active goals (for AI context)
   */
  async getActive(limit = 10): Promise<Goal[]> {
    return this.list({
      status: 'active',
      orderBy: 'priority',
      limit,
    });
  }

  /**
   * Get goals with upcoming due dates
   */
  async getUpcoming(days = 7): Promise<Goal[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const rows = await this.query<GoalRow>(
      `SELECT * FROM goals
       WHERE user_id = $1
         AND status = 'active'
         AND due_date IS NOT NULL
         AND due_date <= $2
       ORDER BY due_date ASC`,
      [this.userId, futureDate.toISOString()]
    );

    return rows.map((row) => this.mapGoal(row));
  }

  /**
   * Update goal progress based on completed steps
   */
  async recalculateProgress(goalId: string): Promise<number> {
    const steps = await this.getSteps(goalId);
    if (steps.length === 0) return 0;

    const completedSteps = steps.filter((s) => s.status === 'completed').length;
    const progress = Math.round((completedSteps / steps.length) * 100);

    await this.update(goalId, { progress });
    return progress;
  }

  // ==========================================================================
  // Goal Steps
  // ==========================================================================

  /**
   * Add a step to a goal
   */
  async addStep(goalId: string, input: CreateStepInput): Promise<GoalStep | null> {
    const goal = await this.get(goalId);
    if (!goal) return null;

    const id = `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    // Get max order num if not provided
    let orderNum = input.orderNum;
    if (orderNum === undefined) {
      const result = await this.queryOne<{ max_order: number | null }>(
        'SELECT MAX(order_num) as max_order FROM goal_steps WHERE goal_id = $1',
        [goalId]
      );
      orderNum = (result?.max_order ?? -1) + 1;
    }

    await this.execute(
      `INSERT INTO goal_steps (id, goal_id, title, description, status, order_num, dependencies, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        goalId,
        input.title,
        input.description ?? null,
        'pending',
        orderNum,
        JSON.stringify(input.dependencies ?? []),
        now,
      ]
    );

    return this.getStep(id);
  }

  /**
   * Get a step by ID
   */
  async getStep(id: string): Promise<GoalStep | null> {
    const row = await this.queryOne<StepRow>(
      `SELECT s.* FROM goal_steps s
       JOIN goals g ON s.goal_id = g.id
       WHERE s.id = $1 AND g.user_id = $2`,
      [id, this.userId]
    );
    return row ? this.mapStep(row) : null;
  }

  /**
   * Update a step
   */
  async updateStep(id: string, input: UpdateStepInput): Promise<GoalStep | null> {
    const existing = await this.getStep(id);
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
      if (input.status === 'completed') {
        updates.push(`completed_at = $${paramIndex++}`);
        values.push(new Date().toISOString());
      }
    }
    if (input.orderNum !== undefined) {
      updates.push(`order_num = $${paramIndex++}`);
      values.push(input.orderNum);
    }
    if (input.dependencies !== undefined) {
      updates.push(`dependencies = $${paramIndex++}`);
      values.push(JSON.stringify(input.dependencies));
    }
    if (input.result !== undefined) {
      updates.push(`result = $${paramIndex++}`);
      values.push(input.result);
    }

    if (updates.length === 0) return existing;

    values.push(id);

    await this.execute(
      `UPDATE goal_steps SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    // Recalculate goal progress
    await this.recalculateProgress(existing.goalId);

    return this.getStep(id);
  }

  /**
   * Delete a step
   */
  async deleteStep(id: string): Promise<boolean> {
    const step = await this.getStep(id);
    if (!step) return false;

    const result = await this.execute('DELETE FROM goal_steps WHERE id = $1', [id]);
    const deleted = result.changes > 0;

    // Recalculate goal progress
    if (deleted) {
      await this.recalculateProgress(step.goalId);
    }

    return deleted;
  }

  /**
   * Get all steps for a goal
   */
  async getSteps(goalId: string): Promise<GoalStep[]> {
    const rows = await this.query<StepRow>(
      `SELECT s.* FROM goal_steps s
       JOIN goals g ON s.goal_id = g.id
       WHERE s.goal_id = $1 AND g.user_id = $2
       ORDER BY s.order_num ASC`,
      [goalId, this.userId]
    );
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Get next actionable steps across all goals
   */
  async getNextActions(limit = 5): Promise<Array<GoalStep & { goalTitle: string }>> {
    // Note: PostgreSQL doesn't have json_each like SQLite
    // Using a different approach with array containment
    const rows = await this.query<StepRow & { goal_title: string }>(
      `SELECT s.*, g.title as goal_title FROM goal_steps s
       JOIN goals g ON s.goal_id = g.id
       WHERE g.user_id = $1
         AND g.status = 'active'
         AND s.status IN ('pending', 'in_progress')
         AND NOT EXISTS (
           SELECT 1 FROM goal_steps dep
           WHERE dep.id = ANY(
             SELECT jsonb_array_elements_text(s.dependencies::jsonb)
           )
           AND dep.status != 'completed'
         )
       ORDER BY g.priority DESC, s.order_num ASC
       LIMIT $2`,
      [this.userId, limit]
    );

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
  async getStats(): Promise<{
    total: number;
    byStatus: Record<GoalStatus, number>;
    completedThisWeek: number;
    averageProgress: number;
    overdueCount: number;
  }> {
    const total = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM goals WHERE user_id = $1',
      [this.userId]
    );

    const byStatus = await this.query<{ status: GoalStatus; count: string }>(
      'SELECT status, COUNT(*) as count FROM goals WHERE user_id = $1 GROUP BY status',
      [this.userId]
    );

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const completedThisWeek = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM goals
       WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2`,
      [this.userId, weekAgo.toISOString()]
    );

    const avgProgress = await this.queryOne<{ avg: string | null }>(
      `SELECT AVG(progress) as avg FROM goals WHERE user_id = $1 AND status = 'active'`,
      [this.userId]
    );

    const now = new Date().toISOString();
    const overdue = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM goals
       WHERE user_id = $1 AND status = 'active' AND due_date IS NOT NULL AND due_date < $2`,
      [this.userId, now]
    );

    const statusMap: Record<GoalStatus, number> = {
      active: 0,
      paused: 0,
      completed: 0,
      abandoned: 0,
    };
    for (const row of byStatus) {
      statusMap[row.status] = parseInt(row.count, 10);
    }

    return {
      total: parseInt(total?.count ?? '0', 10),
      byStatus: statusMap,
      completedThisWeek: parseInt(completedThisWeek?.count ?? '0', 10),
      averageProgress: Math.round(parseFloat(avgProgress?.avg ?? '0')),
      overdueCount: parseInt(overdue?.count ?? '0', 10),
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
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
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
      dependencies: typeof row.dependencies === 'string' ? JSON.parse(row.dependencies) : row.dependencies,
      result: row.result,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
  }
}

// Factory function for creating repository instances
export function createGoalsRepository(userId = 'default'): GoalsRepository {
  return new GoalsRepository(userId);
}

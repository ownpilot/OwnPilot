/**
 * Plans Repository
 *
 * Database operations for autonomous plan execution.
 */

import { getDatabase } from '../connection.js';
import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export type PlanStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepType = 'tool_call' | 'llm_decision' | 'user_input' | 'condition' | 'parallel' | 'loop' | 'sub_plan';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'waiting';
export type PlanEventType = 'started' | 'step_started' | 'step_completed' | 'step_failed' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cancelled' | 'checkpoint';

export interface Plan {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  goal: string;
  status: PlanStatus;
  currentStep: number;
  totalSteps: number;
  progress: number;
  priority: number;
  source: string | null;
  sourceId: string | null;
  triggerId: string | null;
  goalId: string | null;
  autonomyLevel: number;
  maxRetries: number;
  retryCount: number;
  timeoutMs: number | null;
  checkpoint: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  planId: string;
  orderNum: number;
  type: StepType;
  name: string;
  description: string | null;
  config: StepConfig;
  status: StepStatus;
  dependencies: string[];
  result: unknown;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  onSuccess: string | null;
  onFailure: string | null;
  metadata: Record<string, unknown>;
}

export interface StepConfig {
  // For tool_call
  toolName?: string;
  toolArgs?: Record<string, unknown>;

  // For llm_decision
  prompt?: string;
  choices?: string[];

  // For user_input
  question?: string;
  inputType?: 'text' | 'choice' | 'confirm';
  options?: string[];
  timeout?: number;

  // For condition
  condition?: string;
  trueStep?: string;
  falseStep?: string;

  // For parallel
  steps?: string[];
  waitAll?: boolean;

  // For loop
  maxIterations?: number;
  loopCondition?: string;
  loopStep?: string;

  // For sub_plan
  subPlanId?: string;
}

export interface PlanHistory {
  id: string;
  planId: string;
  stepId: string | null;
  eventType: PlanEventType;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface CreatePlanInput {
  name: string;
  description?: string;
  goal: string;
  priority?: number;
  source?: string;
  sourceId?: string;
  triggerId?: string;
  goalId?: string;
  autonomyLevel?: number;
  maxRetries?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateStepInput {
  orderNum: number;
  type: StepType;
  name: string;
  description?: string;
  config: StepConfig;
  dependencies?: string[];
  maxRetries?: number;
  timeoutMs?: number;
  onSuccess?: string;
  onFailure?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  status?: PlanStatus;
  currentStep?: number;
  progress?: number;
  priority?: number;
  autonomyLevel?: number;
  checkpoint?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateStepInput {
  status?: StepStatus;
  result?: unknown;
  error?: string;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Repository
// ============================================================================

export class PlansRepository {
  private db: Database.Database;
  private userId: string;

  constructor(userId = 'default') {
    this.db = getDatabase();
    this.userId = userId;
  }

  // ============================================================================
  // Plan CRUD
  // ============================================================================

  /**
   * Create a new plan
   */
  create(input: CreatePlanInput): Plan {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO plans (
        id, user_id, name, description, goal, priority,
        source, source_id, trigger_id, goal_id,
        autonomy_level, max_retries, timeout_ms, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.name,
      input.description ?? null,
      input.goal,
      input.priority ?? 5,
      input.source ?? null,
      input.sourceId ?? null,
      input.triggerId ?? null,
      input.goalId ?? null,
      input.autonomyLevel ?? 1,
      input.maxRetries ?? 3,
      input.timeoutMs ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    );

    return this.get(id)!;
  }

  /**
   * Get a plan by ID
   */
  get(id: string): Plan | null {
    const stmt = this.db.prepare(`
      SELECT * FROM plans WHERE id = ? AND user_id = ?
    `);
    const row = stmt.get(id, this.userId) as PlanRow | undefined;
    return row ? this.mapPlan(row) : null;
  }

  /**
   * Update a plan
   */
  update(id: string, input: UpdatePlanInput): Plan | null {
    const plan = this.get(id);
    if (!plan) return null;

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
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);

      if (input.status === 'running' && !plan.startedAt) {
        updates.push('started_at = ?');
        values.push(new Date().toISOString());
      }
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        updates.push('completed_at = ?');
        values.push(new Date().toISOString());
      }
    }
    if (input.currentStep !== undefined) {
      updates.push('current_step = ?');
      values.push(input.currentStep);
    }
    if (input.progress !== undefined) {
      updates.push('progress = ?');
      values.push(input.progress);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      values.push(input.priority);
    }
    if (input.autonomyLevel !== undefined) {
      updates.push('autonomy_level = ?');
      values.push(input.autonomyLevel);
    }
    if (input.checkpoint !== undefined) {
      updates.push('checkpoint = ?');
      values.push(input.checkpoint);
    }
    if (input.error !== undefined) {
      updates.push('error = ?');
      values.push(input.error);
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id, this.userId);

    const stmt = this.db.prepare(`
      UPDATE plans SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(...values);

    return this.get(id);
  }

  /**
   * Delete a plan
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM plans WHERE id = ? AND user_id = ?
    `);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  /**
   * List plans
   */
  list(options: {
    status?: PlanStatus;
    goalId?: string;
    triggerId?: string;
    limit?: number;
    offset?: number;
  } = {}): Plan[] {
    const conditions = ['user_id = ?'];
    const values: unknown[] = [this.userId];

    if (options.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }
    if (options.goalId) {
      conditions.push('goal_id = ?');
      values.push(options.goalId);
    }
    if (options.triggerId) {
      conditions.push('trigger_id = ?');
      values.push(options.triggerId);
    }

    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const stmt = this.db.prepare(`
      SELECT * FROM plans
      WHERE ${conditions.join(' AND ')}
      ORDER BY priority DESC, created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...values, limit, offset) as PlanRow[];
    return rows.map((row) => this.mapPlan(row));
  }

  /**
   * Get active (running or paused) plans
   */
  getActive(): Plan[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plans
      WHERE user_id = ? AND status IN ('running', 'paused')
      ORDER BY priority DESC
    `);
    const rows = stmt.all(this.userId) as PlanRow[];
    return rows.map((row) => this.mapPlan(row));
  }

  /**
   * Get pending plans
   */
  getPending(): Plan[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plans
      WHERE user_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
    `);
    const rows = stmt.all(this.userId) as PlanRow[];
    return rows.map((row) => this.mapPlan(row));
  }

  // ============================================================================
  // Step Operations
  // ============================================================================

  /**
   * Add a step to a plan
   */
  addStep(planId: string, input: CreateStepInput): PlanStep {
    const plan = this.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const id = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const stmt = this.db.prepare(`
      INSERT INTO plan_steps (
        id, plan_id, order_num, type, name, description,
        config, dependencies, max_retries, timeout_ms,
        on_success, on_failure, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      planId,
      input.orderNum,
      input.type,
      input.name,
      input.description ?? null,
      JSON.stringify(input.config),
      JSON.stringify(input.dependencies ?? []),
      input.maxRetries ?? 3,
      input.timeoutMs ?? null,
      input.onSuccess ?? null,
      input.onFailure ?? null,
      JSON.stringify(input.metadata ?? {})
    );

    // Update total steps count
    this.db.prepare(`
      UPDATE plans SET total_steps = (
        SELECT COUNT(*) FROM plan_steps WHERE plan_id = ?
      ), updated_at = ? WHERE id = ?
    `).run(planId, new Date().toISOString(), planId);

    return this.getStep(id)!;
  }

  /**
   * Get a step by ID
   */
  getStep(id: string): PlanStep | null {
    const stmt = this.db.prepare(`
      SELECT ps.* FROM plan_steps ps
      JOIN plans p ON ps.plan_id = p.id
      WHERE ps.id = ? AND p.user_id = ?
    `);
    const row = stmt.get(id, this.userId) as StepRow | undefined;
    return row ? this.mapStep(row) : null;
  }

  /**
   * Update a step
   */
  updateStep(id: string, input: UpdateStepInput): PlanStep | null {
    const step = this.getStep(id);
    if (!step) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);

      if (input.status === 'running' && !step.startedAt) {
        updates.push('started_at = ?');
        values.push(new Date().toISOString());
      }
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'skipped') {
        const now = new Date();
        updates.push('completed_at = ?');
        values.push(now.toISOString());
        if (step.startedAt) {
          updates.push('duration_ms = ?');
          values.push(now.getTime() - step.startedAt.getTime());
        }
      }
    }
    if (input.result !== undefined) {
      updates.push('result = ?');
      values.push(JSON.stringify(input.result));
    }
    if (input.error !== undefined) {
      updates.push('error = ?');
      values.push(input.error);
    }
    if (input.retryCount !== undefined) {
      updates.push('retry_count = ?');
      values.push(input.retryCount);
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) return step;

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE plan_steps SET ${updates.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);

    return this.getStep(id);
  }

  /**
   * Get all steps for a plan
   */
  getSteps(planId: string): PlanStep[] {
    const stmt = this.db.prepare(`
      SELECT ps.* FROM plan_steps ps
      JOIN plans p ON ps.plan_id = p.id
      WHERE ps.plan_id = ? AND p.user_id = ?
      ORDER BY ps.order_num ASC
    `);
    const rows = stmt.all(planId, this.userId) as StepRow[];
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Get next pending step
   */
  getNextStep(planId: string): PlanStep | null {
    const steps = this.getSteps(planId);
    return steps.find((s) => s.status === 'pending') ?? null;
  }

  /**
   * Get steps by status
   */
  getStepsByStatus(planId: string, status: StepStatus): PlanStep[] {
    const stmt = this.db.prepare(`
      SELECT ps.* FROM plan_steps ps
      JOIN plans p ON ps.plan_id = p.id
      WHERE ps.plan_id = ? AND p.user_id = ? AND ps.status = ?
      ORDER BY ps.order_num ASC
    `);
    const rows = stmt.all(planId, this.userId, status) as StepRow[];
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Check if all dependencies are met for a step
   */
  areDependenciesMet(stepId: string): boolean {
    const step = this.getStep(stepId);
    if (!step || step.dependencies.length === 0) return true;

    const completedIds = new Set(
      this.getStepsByStatus(step.planId, 'completed').map((s) => s.id)
    );

    return step.dependencies.every((depId) => completedIds.has(depId));
  }

  // ============================================================================
  // History Operations
  // ============================================================================

  /**
   * Log a plan event
   */
  logEvent(planId: string, eventType: PlanEventType, stepId?: string, details: Record<string, unknown> = {}): void {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const stmt = this.db.prepare(`
      INSERT INTO plan_history (id, plan_id, step_id, event_type, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, planId, stepId ?? null, eventType, JSON.stringify(details), new Date().toISOString());
  }

  /**
   * Get history for a plan
   */
  getHistory(planId: string, limit = 50): PlanHistory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plan_history
      WHERE plan_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(planId, limit) as HistoryRow[];
    return rows.map((row) => this.mapHistory(row));
  }

  // ============================================================================
  // Progress Calculation
  // ============================================================================

  /**
   * Recalculate plan progress based on completed steps
   */
  recalculateProgress(planId: string): number {
    const steps = this.getSteps(planId);
    if (steps.length === 0) return 0;

    const completed = steps.filter((s) => s.status === 'completed').length;
    const progress = (completed / steps.length) * 100;

    this.update(planId, { progress, currentStep: completed });

    return progress;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get plan statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<PlanStatus, number>;
    completionRate: number;
    avgStepsPerPlan: number;
    avgDurationMs: number;
  } {
    const plans = this.list({ limit: 1000 });
    const total = plans.length;

    const byStatus: Record<PlanStatus, number> = {
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let completedCount = 0;
    let totalSteps = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const plan of plans) {
      byStatus[plan.status]++;
      totalSteps += plan.totalSteps;

      if (plan.status === 'completed') {
        completedCount++;
        if (plan.startedAt && plan.completedAt) {
          totalDuration += plan.completedAt.getTime() - plan.startedAt.getTime();
          durationCount++;
        }
      }
    }

    return {
      total,
      byStatus,
      completionRate: total > 0 ? (completedCount / total) * 100 : 0,
      avgStepsPerPlan: total > 0 ? totalSteps / total : 0,
      avgDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private mapPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      goal: row.goal,
      status: row.status as PlanStatus,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      progress: row.progress,
      priority: row.priority,
      source: row.source,
      sourceId: row.source_id,
      triggerId: row.trigger_id,
      goalId: row.goal_id,
      autonomyLevel: row.autonomy_level,
      maxRetries: row.max_retries,
      retryCount: row.retry_count,
      timeoutMs: row.timeout_ms,
      checkpoint: row.checkpoint,
      error: row.error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  private mapStep(row: StepRow): PlanStep {
    return {
      id: row.id,
      planId: row.plan_id,
      orderNum: row.order_num,
      type: row.type as StepType,
      name: row.name,
      description: row.description,
      config: JSON.parse(row.config || '{}'),
      status: row.status as StepStatus,
      dependencies: JSON.parse(row.dependencies || '[]'),
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      durationMs: row.duration_ms,
      onSuccess: row.on_success,
      onFailure: row.on_failure,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  private mapHistory(row: HistoryRow): PlanHistory {
    return {
      id: row.id,
      planId: row.plan_id,
      stepId: row.step_id,
      eventType: row.event_type as PlanEventType,
      details: JSON.parse(row.details || '{}'),
      createdAt: new Date(row.created_at),
    };
  }
}

// ============================================================================
// Row Types
// ============================================================================

interface PlanRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  goal: string;
  status: string;
  current_step: number;
  total_steps: number;
  progress: number;
  priority: number;
  source: string | null;
  source_id: string | null;
  trigger_id: string | null;
  goal_id: string | null;
  autonomy_level: number;
  max_retries: number;
  retry_count: number;
  timeout_ms: number | null;
  checkpoint: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string;
}

interface StepRow {
  id: string;
  plan_id: string;
  order_num: number;
  type: string;
  name: string;
  description: string | null;
  config: string;
  status: string;
  dependencies: string;
  result: string | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  timeout_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  on_success: string | null;
  on_failure: string | null;
  metadata: string;
}

interface HistoryRow {
  id: string;
  plan_id: string;
  step_id: string | null;
  event_type: string;
  details: string;
  created_at: string;
}

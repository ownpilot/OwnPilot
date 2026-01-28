/**
 * Plans Repository
 *
 * Database operations for autonomous plan execution.
 */

import { BaseRepository } from './base.js';

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

// ============================================================================
// Repository
// ============================================================================

export class PlansRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ============================================================================
  // Plan CRUD
  // ============================================================================

  /**
   * Create a new plan
   */
  async create(input: CreatePlanInput): Promise<Plan> {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO plans (
        id, user_id, name, description, goal, priority,
        source, source_id, trigger_id, goal_id,
        autonomy_level, max_retries, timeout_ms, metadata,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
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
        now,
      ]
    );

    return (await this.get(id))!;
  }

  /**
   * Get a plan by ID
   */
  async get(id: string): Promise<Plan | null> {
    const row = await this.queryOne<PlanRow>(
      'SELECT * FROM plans WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? this.mapPlan(row) : null;
  }

  /**
   * Update a plan
   */
  async update(id: string, input: UpdatePlanInput): Promise<Plan | null> {
    const plan = await this.get(id);
    if (!plan) return null;

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
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);

      if (input.status === 'running' && !plan.startedAt) {
        updates.push(`started_at = $${paramIndex++}`);
        values.push(new Date().toISOString());
      }
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        updates.push(`completed_at = $${paramIndex++}`);
        values.push(new Date().toISOString());
      }
    }
    if (input.currentStep !== undefined) {
      updates.push(`current_step = $${paramIndex++}`);
      values.push(input.currentStep);
    }
    if (input.progress !== undefined) {
      updates.push(`progress = $${paramIndex++}`);
      values.push(input.progress);
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(input.priority);
    }
    if (input.autonomyLevel !== undefined) {
      updates.push(`autonomy_level = $${paramIndex++}`);
      values.push(input.autonomyLevel);
    }
    if (input.checkpoint !== undefined) {
      updates.push(`checkpoint = $${paramIndex++}`);
      values.push(input.checkpoint);
    }
    if (input.error !== undefined) {
      updates.push(`error = $${paramIndex++}`);
      values.push(input.error);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    values.push(id, this.userId);

    await this.execute(
      `UPDATE plans SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  /**
   * Delete a plan
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM plans WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return result.changes > 0;
  }

  /**
   * List plans
   */
  async list(options: {
    status?: PlanStatus;
    goalId?: string;
    triggerId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Plan[]> {
    const conditions = ['user_id = $1'];
    const values: unknown[] = [this.userId];
    let paramIndex = 2;

    if (options.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(options.status);
    }
    if (options.goalId) {
      conditions.push(`goal_id = $${paramIndex++}`);
      values.push(options.goalId);
    }
    if (options.triggerId) {
      conditions.push(`trigger_id = $${paramIndex++}`);
      values.push(options.triggerId);
    }

    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const rows = await this.query<PlanRow>(
      `SELECT * FROM plans
       WHERE ${conditions.join(' AND ')}
       ORDER BY priority DESC, created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...values, limit, offset]
    );

    return rows.map((row) => this.mapPlan(row));
  }

  /**
   * Get active (running or paused) plans
   */
  async getActive(): Promise<Plan[]> {
    const rows = await this.query<PlanRow>(
      `SELECT * FROM plans
       WHERE user_id = $1 AND status IN ('running', 'paused')
       ORDER BY priority DESC`,
      [this.userId]
    );
    return rows.map((row) => this.mapPlan(row));
  }

  /**
   * Get pending plans
   */
  async getPending(): Promise<Plan[]> {
    const rows = await this.query<PlanRow>(
      `SELECT * FROM plans
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY priority DESC, created_at ASC`,
      [this.userId]
    );
    return rows.map((row) => this.mapPlan(row));
  }

  // ============================================================================
  // Step Operations
  // ============================================================================

  /**
   * Add a step to a plan
   */
  async addStep(planId: string, input: CreateStepInput): Promise<PlanStep> {
    const plan = await this.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const id = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await this.execute(
      `INSERT INTO plan_steps (
        id, plan_id, order_num, type, name, description,
        config, dependencies, max_retries, timeout_ms,
        on_success, on_failure, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    // Update total steps count
    await this.execute(
      `UPDATE plans SET total_steps = (
        SELECT COUNT(*) FROM plan_steps WHERE plan_id = $1
      ), updated_at = $2 WHERE id = $1`,
      [planId, new Date().toISOString()]
    );

    return (await this.getStep(id))!;
  }

  /**
   * Get a step by ID
   */
  async getStep(id: string): Promise<PlanStep | null> {
    const row = await this.queryOne<StepRow>(
      `SELECT ps.* FROM plan_steps ps
       JOIN plans p ON ps.plan_id = p.id
       WHERE ps.id = $1 AND p.user_id = $2`,
      [id, this.userId]
    );
    return row ? this.mapStep(row) : null;
  }

  /**
   * Update a step
   */
  async updateStep(id: string, input: UpdateStepInput): Promise<PlanStep | null> {
    const step = await this.getStep(id);
    if (!step) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);

      if (input.status === 'running' && !step.startedAt) {
        updates.push(`started_at = $${paramIndex++}`);
        values.push(new Date().toISOString());
      }
      if (input.status === 'completed' || input.status === 'failed' || input.status === 'skipped') {
        const now = new Date();
        updates.push(`completed_at = $${paramIndex++}`);
        values.push(now.toISOString());
        if (step.startedAt) {
          updates.push(`duration_ms = $${paramIndex++}`);
          values.push(now.getTime() - step.startedAt.getTime());
        }
      }
    }
    if (input.result !== undefined) {
      updates.push(`result = $${paramIndex++}`);
      values.push(JSON.stringify(input.result));
    }
    if (input.error !== undefined) {
      updates.push(`error = $${paramIndex++}`);
      values.push(input.error);
    }
    if (input.retryCount !== undefined) {
      updates.push(`retry_count = $${paramIndex++}`);
      values.push(input.retryCount);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) return step;

    values.push(id);

    await this.execute(
      `UPDATE plan_steps SET ${updates.join(', ')}
       WHERE id = $${paramIndex}`,
      values
    );

    return this.getStep(id);
  }

  /**
   * Get all steps for a plan
   */
  async getSteps(planId: string): Promise<PlanStep[]> {
    const rows = await this.query<StepRow>(
      `SELECT ps.* FROM plan_steps ps
       JOIN plans p ON ps.plan_id = p.id
       WHERE ps.plan_id = $1 AND p.user_id = $2
       ORDER BY ps.order_num ASC`,
      [planId, this.userId]
    );
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Get next pending step
   */
  async getNextStep(planId: string): Promise<PlanStep | null> {
    const steps = await this.getSteps(planId);
    return steps.find((s) => s.status === 'pending') ?? null;
  }

  /**
   * Get steps by status
   */
  async getStepsByStatus(planId: string, status: StepStatus): Promise<PlanStep[]> {
    const rows = await this.query<StepRow>(
      `SELECT ps.* FROM plan_steps ps
       JOIN plans p ON ps.plan_id = p.id
       WHERE ps.plan_id = $1 AND p.user_id = $2 AND ps.status = $3
       ORDER BY ps.order_num ASC`,
      [planId, this.userId, status]
    );
    return rows.map((row) => this.mapStep(row));
  }

  /**
   * Check if all dependencies are met for a step
   */
  async areDependenciesMet(stepId: string): Promise<boolean> {
    const step = await this.getStep(stepId);
    if (!step || step.dependencies.length === 0) return true;

    const completedSteps = await this.getStepsByStatus(step.planId, 'completed');
    const completedIds = new Set(completedSteps.map((s) => s.id));

    return step.dependencies.every((depId) => completedIds.has(depId));
  }

  // ============================================================================
  // History Operations
  // ============================================================================

  /**
   * Log a plan event
   */
  async logEvent(planId: string, eventType: PlanEventType, stepId?: string, details: Record<string, unknown> = {}): Promise<void> {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await this.execute(
      `INSERT INTO plan_history (id, plan_id, step_id, event_type, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, planId, stepId ?? null, eventType, JSON.stringify(details), new Date().toISOString()]
    );
  }

  /**
   * Get history for a plan
   */
  async getHistory(planId: string, limit = 50): Promise<PlanHistory[]> {
    const rows = await this.query<HistoryRow>(
      `SELECT * FROM plan_history
       WHERE plan_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [planId, limit]
    );
    return rows.map((row) => this.mapHistory(row));
  }

  // ============================================================================
  // Progress Calculation
  // ============================================================================

  /**
   * Recalculate plan progress based on completed steps
   */
  async recalculateProgress(planId: string): Promise<number> {
    const steps = await this.getSteps(planId);
    if (steps.length === 0) return 0;

    const completed = steps.filter((s) => s.status === 'completed').length;
    const progress = (completed / steps.length) * 100;

    await this.update(planId, { progress, currentStep: completed });

    return progress;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get plan statistics
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<PlanStatus, number>;
    completionRate: number;
    avgStepsPerPlan: number;
    avgDurationMs: number;
  }> {
    const plans = await this.list({ limit: 1000 });
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
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {}),
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
      config: typeof row.config === 'string' ? JSON.parse(row.config || '{}') : (row.config || {}),
      status: row.status as StepStatus,
      dependencies: typeof row.dependencies === 'string' ? JSON.parse(row.dependencies || '[]') : (row.dependencies || []),
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
      error: row.error,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      timeoutMs: row.timeout_ms,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      durationMs: row.duration_ms,
      onSuccess: row.on_success,
      onFailure: row.on_failure,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {}),
    };
  }

  private mapHistory(row: HistoryRow): PlanHistory {
    return {
      id: row.id,
      planId: row.plan_id,
      stepId: row.step_id,
      eventType: row.event_type as PlanEventType,
      details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : (row.details || {}),
      createdAt: new Date(row.created_at),
    };
  }
}

// Factory function for creating repository instances
export function createPlansRepository(userId = 'default'): PlansRepository {
  return new PlansRepository(userId);
}

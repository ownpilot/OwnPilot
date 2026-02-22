/**
 * IPlanService - Plan Management Interface
 *
 * Provides access to plan CRUD, step operations, history, and statistics.
 * Plans support autonomous execution with steps, dependencies, and retries.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const plans = registry.get(Services.Plan);
 *   const plan = await plans.createPlan('user-1', { name: 'Deploy v2', goal: 'Ship new version' });
 */

// ============================================================================
// Plan Types
// ============================================================================

export type PlanStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepType =
  | 'tool_call'
  | 'llm_decision'
  | 'user_input'
  | 'condition'
  | 'parallel'
  | 'loop'
  | 'sub_plan';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'waiting';
export type PlanEventType =
  | 'started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'checkpoint'
  | 'rollback';

export interface Plan {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly goal: string;
  readonly status: PlanStatus;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly progress: number;
  readonly priority: number;
  readonly source: string | null;
  readonly sourceId: string | null;
  readonly triggerId: string | null;
  readonly goalId: string | null;
  readonly autonomyLevel: number;
  readonly maxRetries: number;
  readonly retryCount: number;
  readonly timeoutMs: number | null;
  readonly checkpoint: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

export interface StepConfig {
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly prompt?: string;
  readonly choices?: string[];
  readonly question?: string;
  readonly inputType?: 'text' | 'choice' | 'confirm';
  readonly options?: string[];
  readonly timeout?: number;
  readonly condition?: string;
  readonly trueStep?: string;
  readonly falseStep?: string;
  readonly steps?: string[];
  readonly waitAll?: boolean;
  readonly maxIterations?: number;
  readonly loopCondition?: string;
  readonly loopStep?: string;
  readonly subPlanId?: string;
}

export interface PlanStep {
  readonly id: string;
  readonly planId: string;
  readonly orderNum: number;
  readonly type: StepType;
  readonly name: string;
  readonly description: string | null;
  readonly config: StepConfig;
  readonly status: StepStatus;
  readonly dependencies: string[];
  readonly result: unknown;
  readonly error: string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly timeoutMs: number | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly durationMs: number | null;
  readonly onSuccess: string | null;
  readonly onFailure: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface PlanHistory {
  readonly id: string;
  readonly planId: string;
  readonly stepId: string | null;
  readonly eventType: PlanEventType;
  readonly details: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface PlanWithSteps extends Plan {
  readonly steps: PlanStep[];
}

export interface PlanStats {
  readonly total: number;
  readonly byStatus: Record<string, number>;
  readonly completionRate: number;
  readonly avgStepsPerPlan: number;
  readonly avgDurationMs: number;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreatePlanInput {
  readonly name: string;
  readonly description?: string;
  readonly goal: string;
  readonly priority?: number;
  readonly source?: string;
  readonly sourceId?: string;
  readonly triggerId?: string;
  readonly goalId?: string;
  readonly autonomyLevel?: number;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateStepInput {
  readonly orderNum: number;
  readonly type: StepType;
  readonly name: string;
  readonly description?: string;
  readonly config: StepConfig;
  readonly dependencies?: string[];
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly onSuccess?: string;
  readonly onFailure?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdatePlanInput {
  readonly name?: string;
  readonly description?: string;
  readonly status?: PlanStatus;
  readonly currentStep?: number;
  readonly progress?: number;
  readonly priority?: number;
  readonly autonomyLevel?: number;
  readonly checkpoint?: string;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateStepInput {
  readonly status?: StepStatus;
  readonly result?: unknown;
  readonly error?: string;
  readonly retryCount?: number;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// IPlanService
// ============================================================================

export interface IPlanService {
  // Plan CRUD
  createPlan(userId: string, input: CreatePlanInput): Promise<Plan>;
  getPlan(userId: string, id: string): Promise<Plan | null>;
  getPlanWithDetails(
    userId: string,
    id: string
  ): Promise<(PlanWithSteps & { history: PlanHistory[] }) | null>;
  listPlans(
    userId: string,
    options?: {
      status?: PlanStatus;
      goalId?: string;
      triggerId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Plan[]>;
  countPlans(
    userId: string,
    options?: {
      status?: PlanStatus;
      goalId?: string;
      triggerId?: string;
    }
  ): Promise<number>;
  updatePlan(userId: string, id: string, input: UpdatePlanInput): Promise<Plan | null>;
  deletePlan(userId: string, id: string): Promise<boolean>;

  // Queries
  getActive(userId: string): Promise<Plan[]>;
  getPending(userId: string): Promise<Plan[]>;

  // Step Operations
  addStep(userId: string, planId: string, input: CreateStepInput): Promise<PlanStep>;
  getSteps(userId: string, planId: string): Promise<PlanStep[]>;
  getStep(userId: string, stepId: string): Promise<PlanStep | null>;
  updateStep(userId: string, stepId: string, input: UpdateStepInput): Promise<PlanStep | null>;
  getNextStep(userId: string, planId: string): Promise<PlanStep | null>;
  getStepsByStatus(userId: string, planId: string, status: StepStatus): Promise<PlanStep[]>;
  areDependenciesMet(userId: string, stepId: string): Promise<boolean>;

  // History & Progress
  logEvent(
    userId: string,
    planId: string,
    eventType: PlanEventType,
    stepId?: string,
    details?: Record<string, unknown>
  ): Promise<void>;
  getHistory(userId: string, planId: string, limit?: number): Promise<PlanHistory[]>;
  recalculateProgress(userId: string, planId: string): Promise<void>;

  // Stats
  getStats(userId: string): Promise<PlanStats>;
}

/**
 * IGoalService - Goal Management Interface
 *
 * Provides access to goal CRUD, step operations, and statistics.
 * All methods accept userId as first parameter for per-user isolation.
 *
 * Usage:
 *   const goals = registry.get(Services.Goal);
 *   const goal = await goals.createGoal('user-1', { title: 'Learn TypeScript' });
 */

// ============================================================================
// Goal Types
// ============================================================================

export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';

export interface Goal {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: GoalStatus;
  readonly priority: number;
  readonly parentId: string | null;
  readonly dueDate: string | null;
  readonly progress: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

export interface GoalStep {
  readonly id: string;
  readonly goalId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: StepStatus;
  readonly orderNum: number;
  readonly dependencies: string[];
  readonly result: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface GoalWithSteps extends Goal {
  readonly steps: GoalStep[];
}

export interface GoalNextAction extends GoalStep {
  readonly goalTitle: string;
}

export interface GoalStats {
  readonly total: number;
  readonly byStatus: Record<GoalStatus, number>;
  readonly completedThisWeek: number;
  readonly averageProgress: number;
  readonly overdueCount: number;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateGoalInput {
  readonly title: string;
  readonly description?: string;
  readonly status?: GoalStatus;
  readonly priority?: number;
  readonly parentId?: string;
  readonly dueDate?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateGoalInput {
  readonly title?: string;
  readonly description?: string;
  readonly status?: GoalStatus;
  readonly priority?: number;
  readonly dueDate?: string;
  readonly progress?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateStepInput {
  readonly title: string;
  readonly description?: string;
  readonly orderNum?: number;
  readonly dependencies?: string[];
}

export interface UpdateStepInput {
  readonly title?: string;
  readonly description?: string;
  readonly status?: StepStatus;
  readonly orderNum?: number;
  readonly dependencies?: string[];
  readonly result?: string;
}

export interface DecomposeStepInput {
  readonly title: string;
  readonly description?: string;
}

export interface GoalQuery {
  readonly status?: GoalStatus | GoalStatus[];
  readonly parentId?: string | null;
  readonly minPriority?: number;
  readonly orderBy?: 'priority' | 'created' | 'due_date' | 'progress';
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// IGoalService
// ============================================================================

export interface IGoalService {
  // Goal CRUD
  createGoal(userId: string, input: CreateGoalInput): Promise<Goal>;
  getGoal(userId: string, goalId: string): Promise<Goal | null>;
  getGoalWithSteps(userId: string, goalId: string): Promise<GoalWithSteps | null>;
  listGoals(userId: string, query?: GoalQuery): Promise<Goal[]>;
  updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<Goal | null>;
  deleteGoal(userId: string, goalId: string): Promise<boolean>;

  // Stats & Queries
  getStats(userId: string): Promise<GoalStats>;
  getNextActions(userId: string, limit?: number): Promise<GoalNextAction[]>;
  getUpcoming(userId: string, days?: number): Promise<Goal[]>;
  getActive(userId: string, limit?: number): Promise<Goal[]>;

  // Step Operations
  addStep(userId: string, goalId: string, input: CreateStepInput): Promise<GoalStep>;
  decomposeGoal(userId: string, goalId: string, steps: DecomposeStepInput[]): Promise<GoalStep[]>;
  getSteps(userId: string, goalId: string): Promise<GoalStep[]>;
  updateStep(userId: string, stepId: string, input: UpdateStepInput): Promise<GoalStep | null>;
  completeStep(userId: string, stepId: string, result?: string): Promise<GoalStep | null>;
  deleteStep(userId: string, stepId: string): Promise<boolean>;
}

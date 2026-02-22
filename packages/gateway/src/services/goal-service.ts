/**
 * Goal Service
 *
 * Central business logic for goals and goal steps.
 * Both HTTP routes and tool executors delegate here,
 * eliminating duplicated validation and logic.
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  type IGoalService,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  GoalsRepository,
  createGoalsRepository,
  type Goal,
  type GoalStep,
  type GoalQuery,
  type CreateGoalInput,
  type UpdateGoalInput,
  type CreateStepInput,
  type UpdateStepInput,
  type GoalStatus,
} from '../db/repositories/goals.js';

// ============================================================================
// Types
// ============================================================================

export interface GoalWithSteps extends Goal {
  steps: GoalStep[];
}

export interface GoalStats {
  total: number;
  byStatus: Record<GoalStatus, number>;
  completedThisWeek: number;
  averageProgress: number;
  overdueCount: number;
}

export interface DecomposeStepInput {
  title: string;
  description?: string;
}

// ============================================================================
// GoalService
// ============================================================================

export class GoalService implements IGoalService {
  private getRepo(userId: string): GoalsRepository {
    return createGoalsRepository(userId);
  }

  // --------------------------------------------------------------------------
  // Goal CRUD
  // --------------------------------------------------------------------------

  async createGoal(userId: string, input: CreateGoalInput): Promise<Goal> {
    if (!input.title?.trim()) {
      throw new GoalServiceError('Title is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    const goal = await repo.create(input);
    getEventBus().emit(
      createEvent<ResourceCreatedData>(EventTypes.RESOURCE_CREATED, 'resource', 'goal-service', {
        resourceType: 'goal',
        id: goal.id,
      })
    );
    return goal;
  }

  async getGoal(userId: string, goalId: string): Promise<Goal | null> {
    const repo = this.getRepo(userId);
    return repo.get(goalId);
  }

  async getGoalWithSteps(userId: string, goalId: string): Promise<GoalWithSteps | null> {
    const repo = this.getRepo(userId);
    const goal = await repo.get(goalId);
    if (!goal) return null;

    const steps = await repo.getSteps(goalId);
    return { ...goal, steps };
  }

  async listGoals(userId: string, query: GoalQuery = {}): Promise<Goal[]> {
    const repo = this.getRepo(userId);
    return repo.list(query);
  }

  async updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<Goal | null> {
    const repo = this.getRepo(userId);
    const updated = await repo.update(goalId, input);
    if (updated) {
      getEventBus().emit(
        createEvent<ResourceUpdatedData>(EventTypes.RESOURCE_UPDATED, 'resource', 'goal-service', {
          resourceType: 'goal',
          id: goalId,
          changes: input,
        })
      );
    }
    return updated;
  }

  async deleteGoal(userId: string, goalId: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const deleted = await repo.delete(goalId);
    if (deleted) {
      getEventBus().emit(
        createEvent<ResourceDeletedData>(EventTypes.RESOURCE_DELETED, 'resource', 'goal-service', {
          resourceType: 'goal',
          id: goalId,
        })
      );
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Stats & Queries
  // --------------------------------------------------------------------------

  async getStats(userId: string): Promise<GoalStats> {
    const repo = this.getRepo(userId);
    return repo.getStats();
  }

  async getNextActions(
    userId: string,
    limit = 5
  ): Promise<Array<GoalStep & { goalTitle: string }>> {
    const repo = this.getRepo(userId);
    return repo.getNextActions(limit);
  }

  async getUpcoming(userId: string, days = 7): Promise<Goal[]> {
    const repo = this.getRepo(userId);
    return repo.getUpcoming(days);
  }

  async getActive(userId: string, limit?: number): Promise<Goal[]> {
    const repo = this.getRepo(userId);
    return repo.getActive(limit);
  }

  // --------------------------------------------------------------------------
  // Step Operations
  // --------------------------------------------------------------------------

  async addStep(userId: string, goalId: string, input: CreateStepInput): Promise<GoalStep> {
    if (!input.title?.trim()) {
      throw new GoalServiceError('Step title is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    const goal = await repo.get(goalId);
    if (!goal) {
      throw new GoalServiceError(`Goal not found: ${goalId}`, 'NOT_FOUND');
    }

    const step = await repo.addStep(goalId, input);
    if (!step) {
      throw new GoalServiceError('Failed to create step', 'INTERNAL_ERROR');
    }

    return step;
  }

  /**
   * Add multiple steps to a goal at once (decompose).
   * Returns all created steps and recalculates progress.
   */
  async decomposeGoal(
    userId: string,
    goalId: string,
    steps: DecomposeStepInput[]
  ): Promise<GoalStep[]> {
    if (!steps.length) {
      throw new GoalServiceError('At least one step is required', 'VALIDATION_ERROR');
    }

    const repo = this.getRepo(userId);
    const goal = await repo.get(goalId);
    if (!goal) {
      throw new GoalServiceError(`Goal not found: ${goalId}`, 'NOT_FOUND');
    }

    return repo.transaction(async () => {
      const createdSteps: GoalStep[] = [];
      for (const stepInput of steps) {
        const step = await repo.addStep(goalId, {
          title: stepInput.title,
          description: stepInput.description,
        });
        if (!step) {
          throw new GoalServiceError('Failed to create step during decompose', 'INTERNAL_ERROR');
        }
        createdSteps.push(step);
      }

      // Recalculate progress
      await repo.recalculateProgress(goalId);

      return createdSteps;
    });
  }

  async getSteps(userId: string, goalId: string): Promise<GoalStep[]> {
    const repo = this.getRepo(userId);
    return repo.getSteps(goalId);
  }

  async updateStep(
    userId: string,
    stepId: string,
    input: UpdateStepInput
  ): Promise<GoalStep | null> {
    const repo = this.getRepo(userId);
    const step = await repo.getStep(stepId);
    if (!step) return null;

    const updated = await repo.updateStep(stepId, input);

    // Recalculate progress if status changed
    if (input.status && updated) {
      await repo.recalculateProgress(step.goalId);
    }

    return updated;
  }

  async completeStep(userId: string, stepId: string, result?: string): Promise<GoalStep | null> {
    const repo = this.getRepo(userId);
    const step = await repo.getStep(stepId);
    if (!step) return null;

    const updated = await repo.updateStep(stepId, {
      status: 'completed',
      result: result ?? undefined,
    });

    if (updated) {
      await repo.recalculateProgress(step.goalId);
    }

    return updated;
  }

  async deleteStep(userId: string, stepId: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const step = await repo.getStep(stepId);
    if (!step) return false;

    const deleted = await repo.deleteStep(stepId);

    if (deleted) {
      await repo.recalculateProgress(step.goalId);
    }

    return deleted;
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type GoalServiceErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export class GoalServiceError extends Error {
  constructor(
    message: string,
    public readonly code: GoalServiceErrorCode
  ) {
    super(message);
    this.name = 'GoalServiceError';
  }
}

// ============================================================================
// Singleton (internal — use ServiceRegistry instead)
// ============================================================================

let instance: GoalService | null = null;

export function getGoalService(): GoalService {
  if (!instance) {
    instance = new GoalService();
  }
  return instance;
}

/**
 * GoalService Implementation
 *
 * Wraps the existing GoalService to provide IGoalService interface.
 * Direct pass-through adapter since gateway types are compatible.
 *
 * Usage:
 *   const goals = registry.get(Services.Goal);
 *   const goal = await goals.createGoal('user-1', { title: 'Learn TypeScript' });
 */

import type {
  IGoalService,
  CreateGoalInput,
  UpdateGoalInput,
  CreateGoalStepInput as CreateStepInput,
  UpdateGoalStepInput as UpdateStepInput,
  GoalDecomposeInput as DecomposeStepInput,
  GoalQuery,
  ServiceGoal as Goal,
  ServiceGoalStep as GoalStep,
  ServiceGoalWithSteps as GoalWithSteps,
  GoalNextAction,
  GoalServiceStats as GoalStats,
} from '@ownpilot/core';
import { getGoalService } from './goal-service.js';

// ============================================================================
// GoalServiceImpl Adapter
// ============================================================================

export class GoalServiceImpl implements IGoalService {
  private get service() {
    return getGoalService();
  }

  // ---- Goal CRUD ----

  async createGoal(userId: string, input: CreateGoalInput): Promise<Goal> {
    return this.service.createGoal(userId, input);
  }

  async getGoal(userId: string, goalId: string): Promise<Goal | null> {
    return this.service.getGoal(userId, goalId);
  }

  async getGoalWithSteps(userId: string, goalId: string): Promise<GoalWithSteps | null> {
    return this.service.getGoalWithSteps(userId, goalId);
  }

  async listGoals(userId: string, query?: GoalQuery): Promise<Goal[]> {
    return this.service.listGoals(userId, query);
  }

  async updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<Goal | null> {
    return this.service.updateGoal(userId, goalId, input);
  }

  async deleteGoal(userId: string, goalId: string): Promise<boolean> {
    return this.service.deleteGoal(userId, goalId);
  }

  // ---- Stats & Queries ----

  async getStats(userId: string): Promise<GoalStats> {
    return this.service.getStats(userId);
  }

  async getNextActions(userId: string, limit?: number): Promise<GoalNextAction[]> {
    return this.service.getNextActions(userId, limit);
  }

  async getUpcoming(userId: string, days?: number): Promise<Goal[]> {
    return this.service.getUpcoming(userId, days);
  }

  async getActive(userId: string, limit?: number): Promise<Goal[]> {
    return this.service.getActive(userId, limit);
  }

  // ---- Step Operations ----

  async addStep(userId: string, goalId: string, input: CreateStepInput): Promise<GoalStep> {
    return this.service.addStep(userId, goalId, input);
  }

  async decomposeGoal(
    userId: string,
    goalId: string,
    steps: DecomposeStepInput[],
  ): Promise<GoalStep[]> {
    return this.service.decomposeGoal(userId, goalId, steps);
  }

  async getSteps(userId: string, goalId: string): Promise<GoalStep[]> {
    return this.service.getSteps(userId, goalId);
  }

  async updateStep(userId: string, stepId: string, input: UpdateStepInput): Promise<GoalStep | null> {
    return this.service.updateStep(userId, stepId, input);
  }

  async completeStep(userId: string, stepId: string, result?: string): Promise<GoalStep | null> {
    return this.service.completeStep(userId, stepId, result);
  }

  async deleteStep(userId: string, stepId: string): Promise<boolean> {
    return this.service.deleteStep(userId, stepId);
  }
}

/**
 * Create a new GoalServiceImpl instance.
 */
export function createGoalServiceImpl(): IGoalService {
  return new GoalServiceImpl();
}

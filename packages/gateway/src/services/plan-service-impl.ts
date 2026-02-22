/**
 * PlanService Implementation
 *
 * Wraps the existing PlanService to provide IPlanService interface.
 * Direct pass-through adapter since gateway types are compatible.
 *
 * Usage:
 *   const plans = registry.get(Services.Plan);
 *   const plan = await plans.createPlan('user-1', { name: 'Deploy v2', goal: 'Ship new version' });
 */

import type {
  IPlanService,
  CreatePlanInput,
  UpdatePlanInput,
  CreatePlanStepInput as CreateStepInput,
  UpdatePlanStepInput as UpdateStepInput,
  PlanStatus,
  PlanStepStatus as StepStatus,
  PlanEventType,
  ServicePlan as Plan,
  ServicePlanStep as PlanStep,
  ServicePlanWithSteps as PlanWithSteps,
  ServicePlanHistory as PlanHistory,
  PlanServiceStats as PlanStats,
} from '@ownpilot/core';
import { getPlanService } from './plan-service.js';

// ============================================================================
// PlanServiceImpl Adapter
// ============================================================================

export class PlanServiceImpl implements IPlanService {
  private get service() {
    return getPlanService();
  }

  // ---- Plan CRUD ----

  async createPlan(userId: string, input: CreatePlanInput): Promise<Plan> {
    return this.service.createPlan(userId, input);
  }

  async getPlan(userId: string, id: string): Promise<Plan | null> {
    return this.service.getPlan(userId, id);
  }

  async getPlanWithDetails(
    userId: string,
    id: string,
  ): Promise<(PlanWithSteps & { history: PlanHistory[] }) | null> {
    return this.service.getPlanWithDetails(userId, id);
  }

  async listPlans(
    userId: string,
    options?: {
      status?: PlanStatus;
      goalId?: string;
      triggerId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<Plan[]> {
    return this.service.listPlans(userId, options);
  }

  async countPlans(
    userId: string,
    options?: { status?: PlanStatus; goalId?: string; triggerId?: string },
  ): Promise<number> {
    return this.service.countPlans(userId, options);
  }

  async updatePlan(userId: string, id: string, input: UpdatePlanInput): Promise<Plan | null> {
    return this.service.updatePlan(userId, id, input);
  }

  async deletePlan(userId: string, id: string): Promise<boolean> {
    return this.service.deletePlan(userId, id);
  }

  // ---- Queries ----

  async getActive(userId: string): Promise<Plan[]> {
    return this.service.getActive(userId);
  }

  async getPending(userId: string): Promise<Plan[]> {
    return this.service.getPending(userId);
  }

  // ---- Step Operations ----

  async addStep(userId: string, planId: string, input: CreateStepInput): Promise<PlanStep> {
    return this.service.addStep(userId, planId, input);
  }

  async getSteps(userId: string, planId: string): Promise<PlanStep[]> {
    return this.service.getSteps(userId, planId);
  }

  async getStep(userId: string, stepId: string): Promise<PlanStep | null> {
    return this.service.getStep(userId, stepId);
  }

  async updateStep(userId: string, stepId: string, input: UpdateStepInput): Promise<PlanStep | null> {
    return this.service.updateStep(userId, stepId, input);
  }

  async getNextStep(userId: string, planId: string): Promise<PlanStep | null> {
    return this.service.getNextStep(userId, planId);
  }

  async getStepsByStatus(userId: string, planId: string, status: StepStatus): Promise<PlanStep[]> {
    return this.service.getStepsByStatus(userId, planId, status);
  }

  async areDependenciesMet(userId: string, stepId: string): Promise<boolean> {
    return this.service.areDependenciesMet(userId, stepId);
  }

  // ---- History & Progress ----

  async logEvent(
    userId: string,
    planId: string,
    eventType: PlanEventType,
    stepId?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    return this.service.logEvent(userId, planId, eventType, stepId, details);
  }

  async getHistory(userId: string, planId: string, limit?: number): Promise<PlanHistory[]> {
    return this.service.getHistory(userId, planId, limit);
  }

  async recalculateProgress(userId: string, planId: string): Promise<void> {
    return this.service.recalculateProgress(userId, planId);
  }

  // ---- Stats ----

  async getStats(userId: string): Promise<PlanStats> {
    return this.service.getStats(userId);
  }
}

/**
 * Create a new PlanServiceImpl instance.
 */
export function createPlanServiceImpl(): IPlanService {
  return new PlanServiceImpl();
}

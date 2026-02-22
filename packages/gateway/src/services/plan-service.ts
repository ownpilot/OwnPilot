/**
 * Plan Service
 *
 * Central business logic for plan CRUD and queries.
 * Wraps PlansRepository with event emission and validation.
 * Complex execution logic (step orchestration, retries, dependencies)
 * lives in PlanExecutor.
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  PlansRepository,
  createPlansRepository,
  type Plan,
  type PlanStep,
  type PlanHistory,
  type PlanStatus,
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateStepInput,
  type UpdateStepInput,
  type PlanEventType,
  type StepStatus,
} from '../db/repositories/plans.js';

// ============================================================================
// Types
// ============================================================================

export interface PlanWithSteps extends Plan {
  steps: PlanStep[];
}

export interface PlanStats {
  total: number;
  byStatus: Record<string, number>;
  completionRate: number;
  avgStepsPerPlan: number;
  avgDurationMs: number;
}

// ============================================================================
// PlanService
// ============================================================================

export class PlanService {
  private getRepo(userId: string): PlansRepository {
    return createPlansRepository(userId);
  }

  // --------------------------------------------------------------------------
  // Plan CRUD
  // --------------------------------------------------------------------------

  async createPlan(userId: string, input: CreatePlanInput): Promise<Plan> {
    if (!input.name?.trim()) {
      throw new PlanServiceError('Name is required', 'VALIDATION_ERROR');
    }
    if (!input.goal?.trim()) {
      throw new PlanServiceError('Goal is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    const plan = await repo.create(input);
    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'plan-service',
      { resourceType: 'plan', id: plan.id },
    ));
    return plan;
  }

  async getPlan(userId: string, id: string): Promise<Plan | null> {
    const repo = this.getRepo(userId);
    return repo.get(id);
  }

  async getPlanWithDetails(userId: string, id: string): Promise<(PlanWithSteps & { history: PlanHistory[] }) | null> {
    const repo = this.getRepo(userId);
    const plan = await repo.get(id);
    if (!plan) return null;

    const [steps, history] = await Promise.all([
      repo.getSteps(id),
      repo.getHistory(id),
    ]);

    return { ...plan, steps, history };
  }

  async listPlans(userId: string, options?: { status?: PlanStatus; goalId?: string; triggerId?: string; limit?: number; offset?: number }): Promise<Plan[]> {
    const repo = this.getRepo(userId);
    return repo.list(options);
  }

  async countPlans(userId: string, options?: { status?: PlanStatus; goalId?: string; triggerId?: string }): Promise<number> {
    const repo = this.getRepo(userId);
    return repo.count(options);
  }

  async updatePlan(userId: string, id: string, input: UpdatePlanInput): Promise<Plan | null> {
    const repo = this.getRepo(userId);
    const updated = await repo.update(id, input);
    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'plan-service',
        { resourceType: 'plan', id, changes: input },
      ));
    }
    return updated;
  }

  async deletePlan(userId: string, id: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const deleted = await repo.delete(id);
    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'plan-service',
        { resourceType: 'plan', id },
      ));
    }
    return deleted;
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getActive(userId: string): Promise<Plan[]> {
    const repo = this.getRepo(userId);
    return repo.getActive();
  }

  async getPending(userId: string): Promise<Plan[]> {
    const repo = this.getRepo(userId);
    return repo.getPending();
  }

  // --------------------------------------------------------------------------
  // Step Operations
  // --------------------------------------------------------------------------

  async addStep(userId: string, planId: string, input: CreateStepInput): Promise<PlanStep> {
    if (!input.name?.trim()) {
      throw new PlanServiceError('Step name is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo(userId);
    const plan = await repo.get(planId);
    if (!plan) {
      throw new PlanServiceError(`Plan not found: ${planId}`, 'NOT_FOUND');
    }
    return repo.addStep(planId, input);
  }

  async getSteps(userId: string, planId: string): Promise<PlanStep[]> {
    const repo = this.getRepo(userId);
    return repo.getSteps(planId);
  }

  async getStep(userId: string, stepId: string): Promise<PlanStep | null> {
    const repo = this.getRepo(userId);
    return repo.getStep(stepId);
  }

  async updateStep(userId: string, stepId: string, input: UpdateStepInput): Promise<PlanStep | null> {
    const repo = this.getRepo(userId);
    return repo.updateStep(stepId, input);
  }

  async getNextStep(userId: string, planId: string): Promise<PlanStep | null> {
    const repo = this.getRepo(userId);
    return repo.getNextStep(planId);
  }

  async getStepsByStatus(userId: string, planId: string, status: StepStatus): Promise<PlanStep[]> {
    const repo = this.getRepo(userId);
    return repo.getStepsByStatus(planId, status);
  }

  async areDependenciesMet(userId: string, stepId: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    return repo.areDependenciesMet(stepId);
  }

  // --------------------------------------------------------------------------
  // History & Progress
  // --------------------------------------------------------------------------

  async logEvent(
    userId: string,
    planId: string,
    eventType: PlanEventType,
    stepId?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const repo = this.getRepo(userId);
    await repo.logEvent(planId, eventType, stepId, details);
  }

  async getHistory(userId: string, planId: string, limit = 50): Promise<PlanHistory[]> {
    const repo = this.getRepo(userId);
    return repo.getHistory(planId, limit);
  }

  async recalculateProgress(userId: string, planId: string): Promise<void> {
    const repo = this.getRepo(userId);
    await repo.recalculateProgress(planId);
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getStats(userId: string): Promise<PlanStats> {
    const repo = this.getRepo(userId);
    return repo.getStats();
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type PlanServiceErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export class PlanServiceError extends Error {
  constructor(
    message: string,
    public readonly code: PlanServiceErrorCode,
  ) {
    super(message);
    this.name = 'PlanServiceError';
  }
}

// ============================================================================
// Singleton (internal — use ServiceRegistry instead)
// ============================================================================

let instance: PlanService | null = null;

/**
 * @internal Used only by PlanServiceImpl adapter.
 * @deprecated Use `getServiceRegistry().get(Services.Plan)` instead.
 */
export function getPlanService(): PlanService {
  if (!instance) {
    instance = new PlanService();
  }
  return instance;
}

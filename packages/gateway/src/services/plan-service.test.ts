/**
 * PlanService Tests
 *
 * Tests for business logic, validation, event emission,
 * step operations, history, and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanService, PlanServiceError } from './plan-service.js';
import type { Plan, PlanStep, PlanHistory } from '../db/repositories/plans.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn(
    (type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
      timestamp: new Date().toISOString(),
    }),
  ),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

const mockRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getActive: vi.fn(),
  getPending: vi.fn(),
  addStep: vi.fn(),
  getSteps: vi.fn(),
  getStep: vi.fn(),
  updateStep: vi.fn(),
  getNextStep: vi.fn(),
  getStepsByStatus: vi.fn(),
  areDependenciesMet: vi.fn(),
  logEvent: vi.fn(),
  getHistory: vi.fn(),
  recalculateProgress: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/plans.js', () => ({
  PlansRepository: vi.fn(),
  createPlansRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    userId: 'user-1',
    name: 'Launch MVP',
    goal: 'Ship the first version',
    status: 'active',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Plan;
}

function fakeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step-1',
    planId: 'plan-1',
    title: 'Set up CI/CD',
    description: 'Configure GitHub Actions',
    status: 'pending',
    order: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PlanStep;
}

function fakeHistoryEntry(overrides: Partial<PlanHistory> = {}): PlanHistory {
  return {
    id: 'hist-1',
    planId: 'plan-1',
    eventType: 'step_completed',
    stepId: 'step-1',
    details: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as PlanHistory;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanService', () => {
  let service: PlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanService();
  });

  // ========================================================================
  // Plan CRUD
  // ========================================================================

  describe('createPlan', () => {
    it('creates a plan and emits resource.created', async () => {
      const plan = fakePlan();
      mockRepo.create.mockResolvedValue(plan);

      const result = await service.createPlan('user-1', {
        name: 'Launch MVP',
        goal: 'Ship the first version',
      });

      expect(result).toBe(plan);
      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Launch MVP',
        goal: 'Ship the first version',
      });
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'plan', id: 'plan-1' },
        }),
      );
    });

    it('throws VALIDATION_ERROR when name is empty', async () => {
      await expect(
        service.createPlan('user-1', { name: '', goal: 'Something' }),
      ).rejects.toThrow(/Name is required/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when name is whitespace only', async () => {
      await expect(
        service.createPlan('user-1', { name: '   ', goal: 'Something' }),
      ).rejects.toThrow(PlanServiceError);
    });

    it('throws VALIDATION_ERROR when goal is empty', async () => {
      await expect(
        service.createPlan('user-1', { name: 'Valid', goal: '' }),
      ).rejects.toThrow(/Goal is required/);
    });

    it('throws VALIDATION_ERROR when goal is whitespace only', async () => {
      await expect(
        service.createPlan('user-1', { name: 'Valid', goal: '   ' }),
      ).rejects.toThrow(PlanServiceError);
    });
  });

  describe('getPlan', () => {
    it('returns plan when found', async () => {
      const plan = fakePlan();
      mockRepo.get.mockResolvedValue(plan);

      const result = await service.getPlan('user-1', 'plan-1');
      expect(result).toBe(plan);
      expect(mockRepo.get).toHaveBeenCalledWith('plan-1');
    });

    it('returns null when not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.getPlan('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('getPlanWithDetails', () => {
    it('returns plan with steps and history', async () => {
      const plan = fakePlan();
      const steps = [fakeStep(), fakeStep({ id: 'step-2', title: 'Deploy', order: 2 })];
      const history = [fakeHistoryEntry()];

      mockRepo.get.mockResolvedValue(plan);
      mockRepo.getSteps.mockResolvedValue(steps);
      mockRepo.getHistory.mockResolvedValue(history);

      const result = await service.getPlanWithDetails('user-1', 'plan-1');

      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
      expect(result!.history).toHaveLength(1);
      expect(result!.name).toBe('Launch MVP');
    });

    it('returns null when plan not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.getPlanWithDetails('user-1', 'missing');
      expect(result).toBeNull();
      expect(mockRepo.getSteps).not.toHaveBeenCalled();
      expect(mockRepo.getHistory).not.toHaveBeenCalled();
    });
  });

  describe('listPlans', () => {
    it('delegates to repo with options', async () => {
      mockRepo.list.mockResolvedValue([fakePlan()]);
      const result = await service.listPlans('user-1', { limit: 10, offset: 0 });
      expect(result).toHaveLength(1);
      expect(mockRepo.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });

    it('delegates without options', async () => {
      mockRepo.list.mockResolvedValue([]);
      await service.listPlans('user-1');
      expect(mockRepo.list).toHaveBeenCalledWith(undefined);
    });
  });

  describe('updatePlan', () => {
    it('updates and emits resource.updated', async () => {
      const updated = fakePlan({ name: 'Updated Plan' });
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updatePlan('user-1', 'plan-1', { name: 'Updated Plan' });

      expect(result).toBe(updated);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'plan', id: 'plan-1' }),
        }),
      );
    });

    it('does not emit when plan not found', async () => {
      mockRepo.update.mockResolvedValue(null);
      const result = await service.updatePlan('user-1', 'missing', { name: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deletePlan', () => {
    it('deletes and emits resource.deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deletePlan('user-1', 'plan-1');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'plan', id: 'plan-1' },
        }),
      );
    });

    it('does not emit when plan not found', async () => {
      mockRepo.delete.mockResolvedValue(false);
      const result = await service.deletePlan('user-1', 'missing');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Queries
  // ========================================================================

  describe('query methods', () => {
    it('getActive delegates to repo', async () => {
      mockRepo.getActive.mockResolvedValue([fakePlan()]);
      const result = await service.getActive('user-1');
      expect(result).toHaveLength(1);
      expect(mockRepo.getActive).toHaveBeenCalled();
    });

    it('getPending delegates to repo', async () => {
      mockRepo.getPending.mockResolvedValue([]);
      await service.getPending('user-1');
      expect(mockRepo.getPending).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Step Operations
  // ========================================================================

  describe('addStep', () => {
    it('adds step to existing plan', async () => {
      const plan = fakePlan();
      const step = fakeStep();
      mockRepo.get.mockResolvedValue(plan);
      mockRepo.addStep.mockResolvedValue(step);

      const result = await service.addStep('user-1', 'plan-1', {
        title: 'Set up CI/CD',
        order: 1,
      });

      expect(result).toBe(step);
      expect(mockRepo.addStep).toHaveBeenCalledWith('plan-1', {
        title: 'Set up CI/CD',
        order: 1,
      });
    });

    it('throws NOT_FOUND when plan does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);

      await expect(
        service.addStep('user-1', 'missing', { title: 'Step', order: 1 }),
      ).rejects.toThrow(/Plan not found/);

      const error = await service
        .addStep('user-1', 'missing', { title: 'Step', order: 1 })
        .catch((e) => e);
      expect(error).toBeInstanceOf(PlanServiceError);
      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('getSteps', () => {
    it('delegates to repo', async () => {
      const steps = [fakeStep(), fakeStep({ id: 'step-2' })];
      mockRepo.getSteps.mockResolvedValue(steps);

      const result = await service.getSteps('user-1', 'plan-1');
      expect(result).toHaveLength(2);
      expect(mockRepo.getSteps).toHaveBeenCalledWith('plan-1');
    });
  });

  describe('getStep', () => {
    it('returns step when found', async () => {
      const step = fakeStep();
      mockRepo.getStep.mockResolvedValue(step);

      const result = await service.getStep('user-1', 'step-1');
      expect(result).toBe(step);
    });

    it('returns null when not found', async () => {
      mockRepo.getStep.mockResolvedValue(null);
      const result = await service.getStep('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('updateStep', () => {
    it('delegates to repo', async () => {
      const updated = fakeStep({ status: 'completed' });
      mockRepo.updateStep.mockResolvedValue(updated);

      const result = await service.updateStep('user-1', 'step-1', { status: 'completed' });
      expect(result).toBe(updated);
      expect(mockRepo.updateStep).toHaveBeenCalledWith('step-1', { status: 'completed' });
    });

    it('returns null when step not found', async () => {
      mockRepo.updateStep.mockResolvedValue(null);
      const result = await service.updateStep('user-1', 'missing', { status: 'completed' });
      expect(result).toBeNull();
    });
  });

  describe('getNextStep', () => {
    it('delegates to repo', async () => {
      const step = fakeStep();
      mockRepo.getNextStep.mockResolvedValue(step);

      const result = await service.getNextStep('user-1', 'plan-1');
      expect(result).toBe(step);
      expect(mockRepo.getNextStep).toHaveBeenCalledWith('plan-1');
    });

    it('returns null when no next step', async () => {
      mockRepo.getNextStep.mockResolvedValue(null);
      const result = await service.getNextStep('user-1', 'plan-1');
      expect(result).toBeNull();
    });
  });

  describe('getStepsByStatus', () => {
    it('delegates to repo with planId and status', async () => {
      const steps = [fakeStep({ status: 'completed' }), fakeStep({ id: 'step-2', status: 'completed' })];
      mockRepo.getStepsByStatus.mockResolvedValue(steps);

      const result = await service.getStepsByStatus('user-1', 'plan-1', 'completed');
      expect(result).toHaveLength(2);
      expect(mockRepo.getStepsByStatus).toHaveBeenCalledWith('plan-1', 'completed');
    });

    it('returns empty array when no steps match status', async () => {
      mockRepo.getStepsByStatus.mockResolvedValue([]);
      const result = await service.getStepsByStatus('user-1', 'plan-1', 'failed');
      expect(result).toHaveLength(0);
    });
  });

  describe('areDependenciesMet', () => {
    it('returns true when all dependencies are met', async () => {
      mockRepo.areDependenciesMet.mockResolvedValue(true);

      const result = await service.areDependenciesMet('user-1', 'step-1');
      expect(result).toBe(true);
      expect(mockRepo.areDependenciesMet).toHaveBeenCalledWith('step-1');
    });

    it('returns false when dependencies are not met', async () => {
      mockRepo.areDependenciesMet.mockResolvedValue(false);

      const result = await service.areDependenciesMet('user-1', 'step-2');
      expect(result).toBe(false);
      expect(mockRepo.areDependenciesMet).toHaveBeenCalledWith('step-2');
    });
  });

  // ========================================================================
  // History & Progress
  // ========================================================================

  describe('logEvent', () => {
    it('delegates to repo with all params', async () => {
      mockRepo.logEvent.mockResolvedValue(undefined);

      await service.logEvent('user-1', 'plan-1', 'step_completed', 'step-1', { note: 'done' });

      expect(mockRepo.logEvent).toHaveBeenCalledWith(
        'plan-1',
        'step_completed',
        'step-1',
        { note: 'done' },
      );
    });

    it('delegates without optional params', async () => {
      mockRepo.logEvent.mockResolvedValue(undefined);
      await service.logEvent('user-1', 'plan-1', 'plan_started');
      expect(mockRepo.logEvent).toHaveBeenCalledWith(
        'plan-1',
        'plan_started',
        undefined,
        undefined,
      );
    });
  });

  describe('getHistory', () => {
    it('delegates with default limit', async () => {
      mockRepo.getHistory.mockResolvedValue([fakeHistoryEntry()]);
      const result = await service.getHistory('user-1', 'plan-1');
      expect(result).toHaveLength(1);
      expect(mockRepo.getHistory).toHaveBeenCalledWith('plan-1', 50);
    });

    it('delegates with custom limit', async () => {
      mockRepo.getHistory.mockResolvedValue([]);
      await service.getHistory('user-1', 'plan-1', 10);
      expect(mockRepo.getHistory).toHaveBeenCalledWith('plan-1', 10);
    });
  });

  describe('recalculateProgress', () => {
    it('delegates to repo', async () => {
      mockRepo.recalculateProgress.mockResolvedValue(undefined);
      await service.recalculateProgress('user-1', 'plan-1');
      expect(mockRepo.recalculateProgress).toHaveBeenCalledWith('plan-1');
    });
  });

  // ========================================================================
  // Stats
  // ========================================================================

  describe('getStats', () => {
    it('delegates to repo', async () => {
      const stats = {
        total: 5,
        byStatus: { active: 2, completed: 3 },
        completionRate: 0.6,
        avgStepsPerPlan: 4.2,
        avgDurationMs: 86400000,
      };
      mockRepo.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result).toEqual(stats);
      expect(mockRepo.getStats).toHaveBeenCalled();
    });
  });
});

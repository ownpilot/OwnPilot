/**
 * PlanServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPlanService = vi.hoisted(() => ({
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  getPlanWithDetails: vi.fn(),
  listPlans: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
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
}));

vi.mock('./plan-service.js', () => ({
  getPlanService: () => mockPlanService,
}));

import { PlanServiceImpl } from './plan-service-impl.js';

const mockPlan = {
  id: 'plan-1',
  userId: 'user-1',
  name: 'Deploy v2',
  description: 'Deploy version 2 to production',
  goal: 'Ship new version',
  status: 'pending' as const,
  currentStep: 0,
  totalSteps: 3,
  progress: 0,
  priority: 8,
  source: null,
  sourceId: null,
  triggerId: null,
  goalId: null,
  autonomyLevel: 3,
  maxRetries: 2,
  retryCount: 0,
  timeoutMs: null,
  checkpoint: null,
  error: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  startedAt: null,
  completedAt: null,
  metadata: {},
};

const mockStep = {
  id: 'step-1',
  planId: 'plan-1',
  orderNum: 1,
  type: 'tool_call' as const,
  name: 'Run tests',
  description: null,
  config: { toolName: 'run_tests', toolArgs: {} },
  status: 'pending' as const,
  dependencies: [],
  result: null,
  error: null,
  retryCount: 0,
  maxRetries: 2,
  timeoutMs: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  onSuccess: null,
  onFailure: null,
  metadata: {},
};

const mockHistory = {
  id: 'hist-1',
  planId: 'plan-1',
  stepId: null,
  eventType: 'started' as const,
  details: {},
  createdAt: new Date('2024-01-01'),
};

describe('PlanServiceImpl', () => {
  let service: PlanServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanServiceImpl();
  });

  describe('createPlan', () => {
    it('creates a plan', async () => {
      mockPlanService.createPlan.mockResolvedValue(mockPlan);

      const result = await service.createPlan('user-1', {
        name: 'Deploy v2',
        goal: 'Ship new version',
      });

      expect(result.id).toBe('plan-1');
      expect(result.name).toBe('Deploy v2');
      expect(result.goal).toBe('Ship new version');
    });
  });

  describe('getPlan', () => {
    it('returns plan by ID', async () => {
      mockPlanService.getPlan.mockResolvedValue(mockPlan);

      const result = await service.getPlan('user-1', 'plan-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('plan-1');
    });

    it('returns null for unknown plan', async () => {
      mockPlanService.getPlan.mockResolvedValue(null);
      expect(await service.getPlan('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('getPlanWithDetails', () => {
    it('returns plan with steps and history', async () => {
      mockPlanService.getPlanWithDetails.mockResolvedValue({
        ...mockPlan,
        steps: [mockStep],
        history: [mockHistory],
      });

      const result = await service.getPlanWithDetails('user-1', 'plan-1');
      expect(result).toBeDefined();
      expect(result!.steps).toHaveLength(1);
      expect(result!.history).toHaveLength(1);
    });

    it('returns null when plan not found', async () => {
      mockPlanService.getPlanWithDetails.mockResolvedValue(null);
      expect(await service.getPlanWithDetails('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('listPlans', () => {
    it('lists plans with options', async () => {
      mockPlanService.listPlans.mockResolvedValue([mockPlan]);

      const result = await service.listPlans('user-1', { status: 'pending', limit: 10 });
      expect(result).toHaveLength(1);
      expect(mockPlanService.listPlans).toHaveBeenCalledWith('user-1', {
        status: 'pending',
        limit: 10,
      });
    });
  });

  describe('updatePlan', () => {
    it('updates and returns plan', async () => {
      const updated = { ...mockPlan, status: 'running' as const };
      mockPlanService.updatePlan.mockResolvedValue(updated);

      const result = await service.updatePlan('user-1', 'plan-1', { status: 'running' });
      expect(result!.status).toBe('running');
    });

    it('returns null for unknown plan', async () => {
      mockPlanService.updatePlan.mockResolvedValue(null);
      expect(await service.updatePlan('user-1', 'nonexistent', { name: 'x' })).toBeNull();
    });
  });

  describe('deletePlan', () => {
    it('deletes a plan', async () => {
      mockPlanService.deletePlan.mockResolvedValue(true);
      expect(await service.deletePlan('user-1', 'plan-1')).toBe(true);
    });

    it('returns false for unknown plan', async () => {
      mockPlanService.deletePlan.mockResolvedValue(false);
      expect(await service.deletePlan('user-1', 'nonexistent')).toBe(false);
    });
  });

  describe('getActive', () => {
    it('returns active plans', async () => {
      const active = { ...mockPlan, status: 'running' as const };
      mockPlanService.getActive.mockResolvedValue([active]);

      const result = await service.getActive('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('running');
    });
  });

  describe('getPending', () => {
    it('returns pending plans', async () => {
      mockPlanService.getPending.mockResolvedValue([mockPlan]);

      const result = await service.getPending('user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('addStep', () => {
    it('adds a step to a plan', async () => {
      mockPlanService.addStep.mockResolvedValue(mockStep);

      const result = await service.addStep('user-1', 'plan-1', {
        orderNum: 1,
        type: 'tool_call',
        name: 'Run tests',
        config: { toolName: 'run_tests' },
      });

      expect(result.id).toBe('step-1');
      expect(result.name).toBe('Run tests');
    });
  });

  describe('getSteps', () => {
    it('returns steps for a plan', async () => {
      mockPlanService.getSteps.mockResolvedValue([mockStep]);

      const result = await service.getSteps('user-1', 'plan-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getStep', () => {
    it('returns step by ID', async () => {
      mockPlanService.getStep.mockResolvedValue(mockStep);

      const result = await service.getStep('user-1', 'step-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('step-1');
    });

    it('returns null for unknown step', async () => {
      mockPlanService.getStep.mockResolvedValue(null);
      expect(await service.getStep('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('updateStep', () => {
    it('updates a step', async () => {
      const updated = { ...mockStep, status: 'running' as const };
      mockPlanService.updateStep.mockResolvedValue(updated);

      const result = await service.updateStep('user-1', 'step-1', { status: 'running' });
      expect(result!.status).toBe('running');
    });
  });

  describe('getNextStep', () => {
    it('returns next pending step', async () => {
      mockPlanService.getNextStep.mockResolvedValue(mockStep);

      const result = await service.getNextStep('user-1', 'plan-1');
      expect(result).toBeDefined();
      expect(result!.status).toBe('pending');
    });

    it('returns null when no next step', async () => {
      mockPlanService.getNextStep.mockResolvedValue(null);
      expect(await service.getNextStep('user-1', 'plan-1')).toBeNull();
    });
  });

  describe('getStepsByStatus', () => {
    it('returns steps filtered by status', async () => {
      mockPlanService.getStepsByStatus.mockResolvedValue([mockStep]);

      const result = await service.getStepsByStatus('user-1', 'plan-1', 'pending');
      expect(result).toHaveLength(1);
      expect(mockPlanService.getStepsByStatus).toHaveBeenCalledWith('user-1', 'plan-1', 'pending');
    });
  });

  describe('areDependenciesMet', () => {
    it('checks if dependencies are met', async () => {
      mockPlanService.areDependenciesMet.mockResolvedValue(true);

      const result = await service.areDependenciesMet('user-1', 'step-1');
      expect(result).toBe(true);
    });

    it('returns false when dependencies not met', async () => {
      mockPlanService.areDependenciesMet.mockResolvedValue(false);

      const result = await service.areDependenciesMet('user-1', 'step-2');
      expect(result).toBe(false);
    });
  });

  describe('logEvent', () => {
    it('logs plan event', async () => {
      mockPlanService.logEvent.mockResolvedValue(undefined);

      await service.logEvent('user-1', 'plan-1', 'started');
      expect(mockPlanService.logEvent).toHaveBeenCalledWith(
        'user-1',
        'plan-1',
        'started',
        undefined,
        undefined,
      );
    });

    it('logs step event with details', async () => {
      mockPlanService.logEvent.mockResolvedValue(undefined);

      await service.logEvent('user-1', 'plan-1', 'step_completed', 'step-1', { result: 'ok' });
      expect(mockPlanService.logEvent).toHaveBeenCalledWith(
        'user-1',
        'plan-1',
        'step_completed',
        'step-1',
        { result: 'ok' },
      );
    });
  });

  describe('getHistory', () => {
    it('returns plan history', async () => {
      mockPlanService.getHistory.mockResolvedValue([mockHistory]);

      const result = await service.getHistory('user-1', 'plan-1', 20);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('started');
      expect(mockPlanService.getHistory).toHaveBeenCalledWith('user-1', 'plan-1', 20);
    });
  });

  describe('recalculateProgress', () => {
    it('delegates to service', async () => {
      mockPlanService.recalculateProgress.mockResolvedValue(undefined);

      await service.recalculateProgress('user-1', 'plan-1');
      expect(mockPlanService.recalculateProgress).toHaveBeenCalledWith('user-1', 'plan-1');
    });
  });

  describe('getStats', () => {
    it('returns plan statistics', async () => {
      const stats = {
        total: 8,
        byStatus: { pending: 2, running: 1, completed: 4, failed: 1 },
        completionRate: 0.8,
        avgStepsPerPlan: 4.5,
        avgDurationMs: 30000,
      };
      mockPlanService.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result.total).toBe(8);
      expect(result.completionRate).toBe(0.8);
      expect(result.avgStepsPerPlan).toBe(4.5);
    });
  });
});

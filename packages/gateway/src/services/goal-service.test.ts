/**
 * GoalService Tests
 *
 * Tests for business logic, validation, event emission, and delegation.
 * Repository and EventBus are mocked to isolate service behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoalService, GoalServiceError } from './goal-service.js';
import type { Goal, GoalStep } from '../db/repositories/goals.js';

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
  getUpcoming: vi.fn(),
  getNextActions: vi.fn(),
  getStats: vi.fn(),
  addStep: vi.fn(),
  getStep: vi.fn(),
  getSteps: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  recalculateProgress: vi.fn(),
};

vi.mock('../db/repositories/goals.js', () => ({
  GoalsRepository: vi.fn(),
  createGoalsRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Test Goal',
    description: '',
    status: 'active',
    priority: 5,
    progress: 0,
    parentId: null,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

function fakeStep(overrides: Partial<GoalStep> = {}): GoalStep {
  return {
    id: 'step-1',
    goalId: 'goal-1',
    title: 'Step 1',
    description: '',
    status: 'pending',
    orderNum: 1,
    dependencies: [],
    result: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoalService', () => {
  let service: GoalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GoalService();
  });

  // ========================================================================
  // createGoal
  // ========================================================================

  describe('createGoal', () => {
    it('creates a goal and emits resource.created', async () => {
      const goal = fakeGoal();
      mockRepo.create.mockResolvedValue(goal);

      const result = await service.createGoal('user-1', { title: 'Test Goal' });

      expect(result).toBe(goal);
      expect(mockRepo.create).toHaveBeenCalledWith({ title: 'Test Goal' });
      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'goal', id: 'goal-1' },
        }),
      );
    });

    it('throws VALIDATION_ERROR when title is empty', async () => {
      await expect(service.createGoal('user-1', { title: '' })).rejects.toThrow(GoalServiceError);
      await expect(service.createGoal('user-1', { title: '   ' })).rejects.toThrow(
        /Title is required/,
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when title is undefined', async () => {
      await expect(
        service.createGoal('user-1', { title: undefined as unknown as string }),
      ).rejects.toThrow(/Title is required/);
    });
  });

  // ========================================================================
  // getGoal / getGoalWithSteps
  // ========================================================================

  describe('getGoal', () => {
    it('returns goal from repo', async () => {
      const goal = fakeGoal();
      mockRepo.get.mockResolvedValue(goal);

      const result = await service.getGoal('user-1', 'goal-1');
      expect(result).toBe(goal);
    });

    it('returns null when not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.getGoal('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('getGoalWithSteps', () => {
    it('returns goal with steps attached', async () => {
      const goal = fakeGoal();
      const steps = [fakeStep(), fakeStep({ id: 'step-2', title: 'Step 2' })];
      mockRepo.get.mockResolvedValue(goal);
      mockRepo.getSteps.mockResolvedValue(steps);

      const result = await service.getGoalWithSteps('user-1', 'goal-1');
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
      expect(result!.title).toBe('Test Goal');
    });

    it('returns null when goal not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.getGoalWithSteps('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // updateGoal
  // ========================================================================

  describe('updateGoal', () => {
    it('updates and emits resource.updated', async () => {
      const updated = fakeGoal({ title: 'Updated' });
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateGoal('user-1', 'goal-1', { title: 'Updated' });

      expect(result).toBe(updated);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'goal', id: 'goal-1' }),
        }),
      );
    });

    it('does not emit event when goal not found', async () => {
      mockRepo.update.mockResolvedValue(null);

      const result = await service.updateGoal('user-1', 'missing', { title: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // deleteGoal
  // ========================================================================

  describe('deleteGoal', () => {
    it('deletes and emits resource.deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deleteGoal('user-1', 'goal-1');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'goal', id: 'goal-1' },
        }),
      );
    });

    it('does not emit event when goal not found', async () => {
      mockRepo.delete.mockResolvedValue(false);

      const result = await service.deleteGoal('user-1', 'missing');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Step operations
  // ========================================================================

  describe('addStep', () => {
    it('adds step to existing goal', async () => {
      const goal = fakeGoal();
      const step = fakeStep();
      mockRepo.get.mockResolvedValue(goal);
      mockRepo.addStep.mockResolvedValue(step);

      const result = await service.addStep('user-1', 'goal-1', { title: 'Step 1' });
      expect(result).toBe(step);
    });

    it('throws NOT_FOUND when goal does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);

      await expect(service.addStep('user-1', 'missing', { title: 'x' })).rejects.toThrow(
        /Goal not found/,
      );
    });

    it('throws INTERNAL_ERROR when repo fails to create step', async () => {
      mockRepo.get.mockResolvedValue(fakeGoal());
      mockRepo.addStep.mockResolvedValue(null);

      await expect(service.addStep('user-1', 'goal-1', { title: 'x' })).rejects.toThrow(
        /Failed to create step/,
      );
    });
  });

  describe('decomposeGoal', () => {
    it('creates multiple steps and recalculates progress', async () => {
      mockRepo.get.mockResolvedValue(fakeGoal());
      mockRepo.addStep
        .mockResolvedValueOnce(fakeStep({ id: 's1' }))
        .mockResolvedValueOnce(fakeStep({ id: 's2' }));

      const result = await service.decomposeGoal('user-1', 'goal-1', [
        { title: 'A' },
        { title: 'B' },
      ]);

      expect(result).toHaveLength(2);
      expect(mockRepo.addStep).toHaveBeenCalledTimes(2);
      expect(mockRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('throws VALIDATION_ERROR when steps array is empty', async () => {
      await expect(service.decomposeGoal('user-1', 'goal-1', [])).rejects.toThrow(
        /At least one step/,
      );
    });

    it('throws NOT_FOUND when goal does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);

      await expect(
        service.decomposeGoal('user-1', 'missing', [{ title: 'x' }]),
      ).rejects.toThrow(/Goal not found/);
    });
  });

  describe('completeStep', () => {
    it('marks step as completed and recalculates progress', async () => {
      const step = fakeStep();
      const updated = fakeStep({ status: 'completed' });
      mockRepo.getStep.mockResolvedValue(step);
      mockRepo.updateStep.mockResolvedValue(updated);

      const result = await service.completeStep('user-1', 'step-1', 'Done!');

      expect(result).toBe(updated);
      expect(mockRepo.updateStep).toHaveBeenCalledWith('step-1', {
        status: 'completed',
        result: 'Done!',
      });
      expect(mockRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('returns null when step not found', async () => {
      mockRepo.getStep.mockResolvedValue(null);
      const result = await service.completeStep('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('deleteStep', () => {
    it('deletes step and recalculates progress', async () => {
      mockRepo.getStep.mockResolvedValue(fakeStep());
      mockRepo.deleteStep.mockResolvedValue(true);

      const result = await service.deleteStep('user-1', 'step-1');

      expect(result).toBe(true);
      expect(mockRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('returns false when step not found', async () => {
      mockRepo.getStep.mockResolvedValue(null);
      const result = await service.deleteStep('user-1', 'missing');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // Queries
  // ========================================================================

  describe('query methods', () => {
    it('listGoals delegates to repo', async () => {
      mockRepo.list.mockResolvedValue([]);
      await service.listGoals('user-1', { status: 'active' });
      expect(mockRepo.list).toHaveBeenCalledWith({ status: 'active' });
    });

    it('getActive passes limit', async () => {
      mockRepo.getActive.mockResolvedValue([]);
      await service.getActive('user-1', 3);
      expect(mockRepo.getActive).toHaveBeenCalledWith(3);
    });

    it('getStats delegates to repo', async () => {
      const stats = { total: 5, byStatus: {}, completedThisWeek: 1, averageProgress: 50, overdueCount: 0 };
      mockRepo.getStats.mockResolvedValue(stats);
      const result = await service.getStats('user-1');
      expect(result).toBe(stats);
    });

    it('getNextActions delegates to repo', async () => {
      mockRepo.getNextActions.mockResolvedValue([]);
      await service.getNextActions('user-1', 10);
      expect(mockRepo.getNextActions).toHaveBeenCalledWith(10);
    });

    it('getUpcoming delegates to repo', async () => {
      mockRepo.getUpcoming.mockResolvedValue([]);
      await service.getUpcoming('user-1', 14);
      expect(mockRepo.getUpcoming).toHaveBeenCalledWith(14);
    });
  });
});

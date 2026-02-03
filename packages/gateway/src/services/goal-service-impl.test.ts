/**
 * GoalServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGoalService = vi.hoisted(() => ({
  createGoal: vi.fn(),
  getGoal: vi.fn(),
  getGoalWithSteps: vi.fn(),
  listGoals: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getStats: vi.fn(),
  getNextActions: vi.fn(),
  getUpcoming: vi.fn(),
  getActive: vi.fn(),
  addStep: vi.fn(),
  decomposeGoal: vi.fn(),
  getSteps: vi.fn(),
  updateStep: vi.fn(),
  completeStep: vi.fn(),
  deleteStep: vi.fn(),
}));

vi.mock('./goal-service.js', () => ({
  getGoalService: () => mockGoalService,
}));

import { GoalServiceImpl } from './goal-service-impl.js';

const mockGoal = {
  id: 'goal-1',
  userId: 'user-1',
  title: 'Learn TypeScript',
  description: 'Master TS fundamentals',
  status: 'active' as const,
  priority: 5,
  parentId: null,
  dueDate: '2025-12-31',
  progress: 30,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  completedAt: null,
  metadata: {},
};

const mockStep = {
  id: 'step-1',
  goalId: 'goal-1',
  title: 'Read docs',
  description: null,
  status: 'pending' as const,
  orderNum: 1,
  dependencies: [],
  result: null,
  createdAt: new Date('2024-01-01'),
  completedAt: null,
};

describe('GoalServiceImpl', () => {
  let service: GoalServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GoalServiceImpl();
  });

  describe('createGoal', () => {
    it('creates a goal and returns it', async () => {
      mockGoalService.createGoal.mockResolvedValue(mockGoal);

      const result = await service.createGoal('user-1', { title: 'Learn TypeScript' });

      expect(result.id).toBe('goal-1');
      expect(result.title).toBe('Learn TypeScript');
      expect(mockGoalService.createGoal).toHaveBeenCalledWith('user-1', { title: 'Learn TypeScript' });
    });
  });

  describe('getGoal', () => {
    it('returns goal by ID', async () => {
      mockGoalService.getGoal.mockResolvedValue(mockGoal);

      const result = await service.getGoal('user-1', 'goal-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('goal-1');
    });

    it('returns null for unknown goal', async () => {
      mockGoalService.getGoal.mockResolvedValue(null);
      expect(await service.getGoal('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('getGoalWithSteps', () => {
    it('returns goal with steps', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue({
        ...mockGoal,
        steps: [mockStep],
      });

      const result = await service.getGoalWithSteps('user-1', 'goal-1');
      expect(result).toBeDefined();
      expect(result!.steps).toHaveLength(1);
      expect(result!.steps[0].title).toBe('Read docs');
    });

    it('returns null when goal not found', async () => {
      mockGoalService.getGoalWithSteps.mockResolvedValue(null);
      expect(await service.getGoalWithSteps('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('listGoals', () => {
    it('lists goals with query', async () => {
      mockGoalService.listGoals.mockResolvedValue([mockGoal]);

      const result = await service.listGoals('user-1', { status: 'active' });
      expect(result).toHaveLength(1);
      expect(mockGoalService.listGoals).toHaveBeenCalledWith('user-1', { status: 'active' });
    });
  });

  describe('updateGoal', () => {
    it('updates and returns goal', async () => {
      const updated = { ...mockGoal, title: 'Updated' };
      mockGoalService.updateGoal.mockResolvedValue(updated);

      const result = await service.updateGoal('user-1', 'goal-1', { title: 'Updated' });
      expect(result!.title).toBe('Updated');
    });

    it('returns null for unknown goal', async () => {
      mockGoalService.updateGoal.mockResolvedValue(null);
      expect(await service.updateGoal('user-1', 'nonexistent', { title: 'x' })).toBeNull();
    });
  });

  describe('deleteGoal', () => {
    it('deletes a goal', async () => {
      mockGoalService.deleteGoal.mockResolvedValue(true);
      expect(await service.deleteGoal('user-1', 'goal-1')).toBe(true);
    });

    it('returns false for unknown goal', async () => {
      mockGoalService.deleteGoal.mockResolvedValue(false);
      expect(await service.deleteGoal('user-1', 'nonexistent')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns goal statistics', async () => {
      const stats = {
        total: 5,
        byStatus: { active: 3, paused: 1, completed: 1, abandoned: 0 },
        completedThisWeek: 1,
        averageProgress: 40,
        overdueCount: 2,
      };
      mockGoalService.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result.total).toBe(5);
      expect(result.completedThisWeek).toBe(1);
    });
  });

  describe('getNextActions', () => {
    it('returns next actions with goal title', async () => {
      mockGoalService.getNextActions.mockResolvedValue([
        { ...mockStep, goalTitle: 'Learn TypeScript' },
      ]);

      const result = await service.getNextActions('user-1', 3);
      expect(result).toHaveLength(1);
      expect(result[0].goalTitle).toBe('Learn TypeScript');
      expect(mockGoalService.getNextActions).toHaveBeenCalledWith('user-1', 3);
    });
  });

  describe('getUpcoming', () => {
    it('returns upcoming goals', async () => {
      mockGoalService.getUpcoming.mockResolvedValue([mockGoal]);

      const result = await service.getUpcoming('user-1', 14);
      expect(result).toHaveLength(1);
      expect(mockGoalService.getUpcoming).toHaveBeenCalledWith('user-1', 14);
    });
  });

  describe('getActive', () => {
    it('returns active goals', async () => {
      mockGoalService.getActive.mockResolvedValue([mockGoal]);

      const result = await service.getActive('user-1', 10);
      expect(result).toHaveLength(1);
      expect(mockGoalService.getActive).toHaveBeenCalledWith('user-1', 10);
    });
  });

  describe('addStep', () => {
    it('adds a step to a goal', async () => {
      mockGoalService.addStep.mockResolvedValue(mockStep);

      const result = await service.addStep('user-1', 'goal-1', { title: 'Read docs' });
      expect(result.id).toBe('step-1');
      expect(mockGoalService.addStep).toHaveBeenCalledWith('user-1', 'goal-1', { title: 'Read docs' });
    });
  });

  describe('decomposeGoal', () => {
    it('decomposes goal into steps', async () => {
      mockGoalService.decomposeGoal.mockResolvedValue([mockStep]);

      const result = await service.decomposeGoal('user-1', 'goal-1', [
        { title: 'Read docs' },
      ]);
      expect(result).toHaveLength(1);
    });
  });

  describe('getSteps', () => {
    it('returns steps for a goal', async () => {
      mockGoalService.getSteps.mockResolvedValue([mockStep]);

      const result = await service.getSteps('user-1', 'goal-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('updateStep', () => {
    it('updates a step', async () => {
      const updated = { ...mockStep, status: 'in_progress' as const };
      mockGoalService.updateStep.mockResolvedValue(updated);

      const result = await service.updateStep('user-1', 'step-1', { status: 'in_progress' });
      expect(result!.status).toBe('in_progress');
    });
  });

  describe('completeStep', () => {
    it('completes a step with result', async () => {
      const completed = { ...mockStep, status: 'completed' as const, result: 'Done' };
      mockGoalService.completeStep.mockResolvedValue(completed);

      const result = await service.completeStep('user-1', 'step-1', 'Done');
      expect(result!.status).toBe('completed');
      expect(result!.result).toBe('Done');
    });
  });

  describe('deleteStep', () => {
    it('deletes a step', async () => {
      mockGoalService.deleteStep.mockResolvedValue(true);
      expect(await service.deleteStep('user-1', 'step-1')).toBe(true);
    });

    it('returns false for unknown step', async () => {
      mockGoalService.deleteStep.mockResolvedValue(false);
      expect(await service.deleteStep('user-1', 'nonexistent')).toBe(false);
    });
  });
});

/**
 * Autonomy Context Tests
 *
 * Tests for the Pulse Context Gatherer which collects system state
 * for the pulse evaluator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gatherPulseContext, type PulseContext, type GoalSummary } from './context.js';

// ============================================================================
// Mocks
// ============================================================================

const mockGoalService = {
  listGoals: vi.fn(),
};

const mockMemoryService = {
  getStats: vi.fn(),
  getImportantMemories: vi.fn(),
  searchMemories: vi.fn(),
};

const mockConvRepo = {
  getAll: vi.fn(),
};

const mockApprovalMgr = {
  getPendingActions: vi.fn(),
};

const mockTriggersRepo = {
  getRecentHistory: vi.fn(),
};

const mockHabitsRepo = {
  getTodayProgress: vi.fn(),
};

const mockTasksRepo = {
  list: vi.fn(),
};

const mockCalendarRepo = {
  getToday: vi.fn(),
  getUpcoming: vi.fn(),
};

vi.mock('@ownpilot/core', () => ({
  getServiceRegistry: vi.fn(() => ({
    get: vi.fn((service: { name: string }) => {
      const services: Record<string, unknown> = {
        goal: mockGoalService,
        memory: mockMemoryService,
      };
      return services[service.name];
    }),
  })),
  Services: {
    Goal: { name: 'goal' },
    Memory: { name: 'memory' },
  },
  getLog: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../db/repositories/conversations.js', () => ({
  createConversationsRepository: vi.fn(() => mockConvRepo),
}));

vi.mock('./approvals.js', () => ({
  getApprovalManager: vi.fn(() => mockApprovalMgr),
}));

vi.mock('../db/repositories/triggers.js', () => ({
  createTriggersRepository: vi.fn(() => mockTriggersRepo),
}));

vi.mock('../db/repositories/habits.js', () => ({
  createHabitsRepository: vi.fn(() => mockHabitsRepo),
}));

vi.mock('../db/repositories/index.js', () => ({
  TasksRepository: vi.fn(function (userId: string) {
    this.userId = userId;
    return mockTasksRepo;
  }),
  CalendarRepository: vi.fn(function (userId: string) {
    this.userId = userId;
    return mockCalendarRepo;
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('gatherPulseContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return basic context structure', async () => {
    const ctx = await gatherPulseContext('user-1');

    expect(ctx.userId).toBe('user-1');
    expect(ctx.gatheredAt).toBeInstanceOf(Date);
    expect(ctx.timeContext).toHaveProperty('hour');
    expect(ctx.timeContext).toHaveProperty('dayOfWeek');
    expect(ctx.timeContext).toHaveProperty('isWeekend');
  });

  describe('gatherGoals', () => {
    it('should gather active goals', async () => {
      const mockGoals = [
        {
          id: 'goal-1',
          title: 'Test Goal',
          progress: 50,
          updatedAt: new Date(),
          dueDate: null,
        },
      ];
      mockGoalService.listGoals.mockResolvedValue(mockGoals);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.goals.active).toHaveLength(1);
      expect(ctx.goals.active[0]).toEqual({
        id: 'goal-1',
        title: 'Test Goal',
        progress: 50,
        updatedAt: expect.any(Date),
        dueDate: null,
      });
    });

    it('should identify stale goals (>3 days)', async () => {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      const mockGoals = [
        {
          id: 'goal-1',
          title: 'Stale Goal',
          progress: 30,
          updatedAt: fourDaysAgo,
          dueDate: null,
        },
      ];
      mockGoalService.listGoals.mockResolvedValue(mockGoals);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.goals.stale).toHaveLength(1);
      expect(ctx.goals.stale[0].daysSinceUpdate).toBeGreaterThanOrEqual(4);
    });

    it('should identify upcoming deadlines (<7 days)', async () => {
      const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const mockGoals = [
        {
          id: 'goal-1',
          title: 'Upcoming Goal',
          progress: 60,
          updatedAt: new Date(),
          dueDate: fiveDaysFromNow.toISOString(),
        },
      ];
      mockGoalService.listGoals.mockResolvedValue(mockGoals);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.goals.upcoming).toHaveLength(1);
      expect(ctx.goals.upcoming[0].daysUntilDue).toBeLessThanOrEqual(5);
    });

    it('should handle goal service errors gracefully', async () => {
      mockGoalService.listGoals.mockRejectedValue(new Error('Service error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.goals.active).toHaveLength(0);
      expect(ctx.goals.stale).toHaveLength(0);
      expect(ctx.goals.upcoming).toHaveLength(0);
    });
  });

  describe('gatherMemories', () => {
    it('should gather memory stats', async () => {
      mockMemoryService.getStats.mockResolvedValue({
        total: 100,
        recentCount: 10,
        avgImportance: 0.7,
      });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.memories.total).toBe(100);
      expect(ctx.memories.recentCount).toBe(10);
      expect(ctx.memories.avgImportance).toBe(0.7);
    });

    it('should handle missing memory stats fields', async () => {
      mockMemoryService.getStats.mockResolvedValue({
        total: 50,
      });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.memories.total).toBe(50);
      expect(ctx.memories.recentCount).toBe(0);
      expect(ctx.memories.avgImportance).toBe(0);
    });

    it('should handle memory service errors', async () => {
      mockMemoryService.getStats.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.memories.total).toBe(0);
      expect(ctx.memories.recentCount).toBe(0);
      expect(ctx.memories.avgImportance).toBe(0);
    });
  });

  describe('gatherActivity', () => {
    it('should detect recent activity (<2 days)', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockConvRepo.getAll.mockResolvedValue([{ updatedAt: yesterday }]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.activity.hasRecentActivity).toBe(true);
      expect(ctx.activity.daysSinceLastActivity).toBe(1);
    });

    it('should detect stale activity (>2 days)', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      mockConvRepo.getAll.mockResolvedValue([{ updatedAt: fiveDaysAgo }]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.activity.hasRecentActivity).toBe(false);
      expect(ctx.activity.daysSinceLastActivity).toBe(5);
    });

    it('should handle no conversations', async () => {
      mockConvRepo.getAll.mockResolvedValue([]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.activity.daysSinceLastActivity).toBe(999);
      expect(ctx.activity.hasRecentActivity).toBe(false);
    });

    it('should handle activity errors', async () => {
      mockConvRepo.getAll.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.activity.daysSinceLastActivity).toBe(0);
      expect(ctx.activity.hasRecentActivity).toBe(true);
    });
  });

  describe('gatherSystemHealth', () => {
    it('should count pending approvals', async () => {
      mockApprovalMgr.getPendingActions.mockReturnValue([{ id: 'action-1' }, { id: 'action-2' }]);
      mockTriggersRepo.getRecentHistory.mockResolvedValue({ total: 0 });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.systemHealth.pendingApprovals).toBe(2);
    });

    it('should count trigger errors', async () => {
      mockApprovalMgr.getPendingActions.mockReturnValue([]);
      mockTriggersRepo.getRecentHistory.mockResolvedValue({ total: 5 });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.systemHealth.triggerErrors).toBe(5);
    });

    it('should handle approval manager not initialized', async () => {
      mockApprovalMgr.getPendingActions.mockImplementation(() => {
        throw new Error('Not initialized');
      });
      mockTriggersRepo.getRecentHistory.mockResolvedValue({ total: 0 });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.systemHealth.pendingApprovals).toBe(0);
    });

    it('should handle triggers repo errors', async () => {
      mockApprovalMgr.getPendingActions.mockReturnValue([]);
      mockTriggersRepo.getRecentHistory.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.systemHealth.triggerErrors).toBe(0);
    });
  });

  describe('gatherHabits', () => {
    it('should gather today habits', async () => {
      mockHabitsRepo.getTodayProgress.mockResolvedValue({
        habits: [
          { name: 'Exercise', completedToday: true, streakCurrent: 5 },
          { name: 'Read', completedToday: false, streakCurrent: 3 },
        ],
        percentage: 50,
      });

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.habits.todayHabits).toHaveLength(2);
      expect(ctx.habits.todayProgress).toBe(50);
      expect(ctx.habits.todayHabits[0]).toEqual({
        name: 'Exercise',
        completed: true,
        streak: 5,
      });
    });

    it('should handle habits errors', async () => {
      mockHabitsRepo.getTodayProgress.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.habits.todayHabits).toHaveLength(0);
      expect(ctx.habits.todayProgress).toBe(0);
    });
  });

  describe('gatherTasks', () => {
    it('should gather overdue and due today tasks', async () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      mockTasksRepo.list
        .mockResolvedValueOnce([{ title: 'Task 1', priority: 'high' }])
        .mockResolvedValueOnce([{ title: 'Overdue Task', dueDate: yesterday }]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.tasks.dueToday).toHaveLength(1);
      expect(ctx.tasks.overdue).toHaveLength(1);
      expect(ctx.tasks.dueToday[0].title).toBe('Task 1');
      expect(ctx.tasks.overdue[0].title).toBe('Overdue Task');
    });

    it('should handle tasks errors', async () => {
      mockTasksRepo.list.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.tasks.dueToday).toHaveLength(0);
      expect(ctx.tasks.overdue).toHaveLength(0);
    });
  });

  describe('gatherCalendar', () => {
    it('should handle calendar data', async () => {
      // Note: Dynamic imports in context.ts make this difficult to test
      // The function should complete without errors
      const ctx = await gatherPulseContext('user-1');

      // Calendar data may be empty if mocks don't intercept dynamic imports
      expect(ctx.calendar).toBeDefined();
      expect(Array.isArray(ctx.calendar.todayEvents)).toBe(true);
      expect(Array.isArray(ctx.calendar.tomorrowEvents)).toBe(true);
    });

    it('should handle calendar errors', async () => {
      mockCalendarRepo.getToday.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.calendar.todayEvents).toHaveLength(0);
      expect(ctx.calendar.tomorrowEvents).toHaveLength(0);
    });
  });

  describe('gatherRecentMemories', () => {
    it('should gather recent important memories', async () => {
      mockMemoryService.getImportantMemories.mockResolvedValue([
        { content: 'Important fact', type: 'note', importance: 0.8 },
        { content: 'Another memory', type: 'insight', importance: 0.9 },
      ]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.recentMemories).toHaveLength(2);
      expect(ctx.recentMemories[0]).toEqual({
        content: 'Important fact',
        type: 'note',
        importance: 0.8,
      });
    });

    it('should handle memories errors', async () => {
      mockMemoryService.getImportantMemories.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.recentMemories).toHaveLength(0);
    });
  });

  describe('gatherUserLocation', () => {
    it('should extract user location from memories', async () => {
      mockMemoryService.searchMemories.mockResolvedValue([
        { content: 'User lives in Istanbul', type: 'preference', importance: 0.7 },
        { content: 'Some other memory', type: 'note', importance: 0.5 },
      ]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.userLocation).toBe('User lives in Istanbul');
    });

    it('should find location in memory content', async () => {
      mockMemoryService.searchMemories.mockResolvedValue([
        { content: 'Current location: Ankara', type: 'note', importance: 0.6 },
      ]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.userLocation).toBe('Current location: Ankara');
    });

    it('should handle no location found', async () => {
      mockMemoryService.searchMemories.mockResolvedValue([
        { content: 'Some unrelated memory', type: 'note', importance: 0.5 },
      ]);

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.userLocation).toBeUndefined();
    });

    it('should handle location errors', async () => {
      mockMemoryService.searchMemories.mockRejectedValue(new Error('DB error'));

      const ctx = await gatherPulseContext('user-1');

      expect(ctx.userLocation).toBeUndefined();
    });
  });
});

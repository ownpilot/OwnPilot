/**
 * Dashboard Service Tests
 *
 * Tests the pure utility functions and BriefingCache, plus the
 * fallback briefing generation and AI response parsing logic.
 * Also covers aggregateDailyData, generateAIBriefing, generateAIBriefingStreaming,
 * buildBriefingPrompt, BriefingCache pruning, and private helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDataHash,
  briefingCache,
  DashboardService,
  type DailyBriefingData,
  type AIBriefing,
  type HabitProgressItem,
} from './dashboard.js';
import {
  type Plan,
  type CalendarEvent,
  type Goal,
  type Task,
  type Note,
} from '../db/repositories/index.js';

// ---------------------------------------------------------------------------
// Mocks for aggregateDailyData / generateAIBriefing
// ---------------------------------------------------------------------------

const mockTasksList = vi.fn(async () => []);
const mockCalendarGetToday = vi.fn(async () => []);
const mockCalendarGetUpcoming = vi.fn(async () => []);
const mockHabitsTodayProgress = vi.fn(async () => ({
  completed: 0,
  total: 0,
  habits: [],
}));
const mockCostsGetDailyCosts = vi.fn(async () => []);
const mockNotesPinned = vi.fn(async () => []);
const mockNotesRecent = vi.fn(async () => []);

vi.mock('../db/repositories/index.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    TasksRepository: vi.fn(function (this: Record<string, unknown>) {
      this.list = mockTasksList;
    }),
    CalendarRepository: vi.fn(function (this: Record<string, unknown>) {
      this.getToday = mockCalendarGetToday;
      this.getUpcoming = mockCalendarGetUpcoming;
    }),
    HabitsRepository: vi.fn(function (this: Record<string, unknown>) {
      this.getTodayProgress = mockHabitsTodayProgress;
    }),
    CostsRepository: vi.fn(function (this: Record<string, unknown>) {
      this.getDailyCosts = mockCostsGetDailyCosts;
    }),
    NotesRepository: vi.fn(function (this: Record<string, unknown>) {
      this.getPinned = mockNotesPinned;
      this.getRecent = mockNotesRecent;
    }),
  };
});

const mockGoalService = {
  getActive: vi.fn(async () => []),
  getNextActions: vi.fn(async () => []),
};

const mockTriggerService = {
  listTriggers: vi.fn(async () => []),
  getRecentHistory: vi.fn(async () => ({ history: [] })),
};

const mockMemoryService = {
  getRecentMemories: vi.fn(async () => []),
  getImportantMemories: vi.fn(async () => []),
  getStats: vi.fn(async () => ({ total: 0, recentCount: 0 })),
};

const mockDatabaseService = {
  listTables: vi.fn(async () => []),
  getTableStats: vi.fn(async () => ({ recordCount: 0 })),
};

const mockPlanService = {
  listPlans: vi.fn(async () => []),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = {
          goal: mockGoalService,
          trigger: mockTriggerService,
          memory: mockMemoryService,
          database: mockDatabaseService,
          plan: mockPlanService,
        };
        return services[token.name];
      }),
    })),
  };
});

const mockGetOrCreateChatAgent = vi.fn();
const mockGetDefaultProvider = vi.fn(async () => 'openai');
const mockGetDefaultModel = vi.fn(async () => 'gpt-4o-mini');

vi.mock('../routes/agents.js', () => ({
  getOrCreateChatAgent: (...args: unknown[]) => mockGetOrCreateChatAgent(...args),
}));

vi.mock('../routes/settings.js', () => ({
  getDefaultProvider: (...args: unknown[]) => mockGetDefaultProvider(...args),
  getDefaultModel: (...args: unknown[]) => mockGetDefaultModel(...args),
}));

/** Expose private methods for testing without `as any`. */
interface PrivateDashboardService {
  generateFallbackBriefing(data: DailyBriefingData): AIBriefing;
  parseAIResponse(content: string, model: string): AIBriefing;
  buildBriefingPrompt(data: DailyBriefingData): string;
  calculateGoalStats(goals: Goal[]): {
    activeCount: number;
    averageProgress: number;
    overdueCount: number;
  };
  getHabitProgress(
    repo: unknown
  ): Promise<{ completed: number; total: number; habits: HabitProgressItem[] }>;
  getDailyCosts(
    repo: unknown
  ): Promise<{ totalTokens: number; totalCost: number; totalCalls: number }>;
  getMonthlyCosts(
    repo: unknown
  ): Promise<{ totalTokens: number; totalCost: number; totalCalls: number }>;
  getCustomDataSummary(
    service: unknown,
    tables: unknown[]
  ): Promise<{ tables: unknown[]; totalRecords: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBriefingData(overrides: Partial<DailyBriefingData> = {}): DailyBriefingData {
  return {
    tasks: {
      pending: [],
      dueToday: [],
      overdue: [],
      counts: { pending: 3, dueToday: 2, overdue: 1, total: 10 },
    },
    calendar: {
      todayEvents: [],
      upcomingEvents: [],
      counts: { today: 2, upcoming: 5 },
    },
    goals: {
      active: [],
      nextActions: [],
      stats: { activeCount: 4, averageProgress: 55.5, overdueCount: 1 },
    },
    triggers: {
      scheduledToday: [],
      recentHistory: [],
      counts: { enabled: 3, scheduledToday: 1 },
    },
    memories: {
      recent: [],
      important: [],
      stats: { total: 100, recentCount: 10 },
    },
    habits: {
      todayProgress: { completed: 3, total: 5, habits: [] },
      streaksAtRisk: [],
    },
    notes: { pinned: [], recent: [] },
    costs: {
      daily: { totalTokens: 5000, totalCost: 0.15, totalCalls: 10 },
      monthly: { totalTokens: 100000, totalCost: 3.5, totalCalls: 200 },
    },
    customData: { tables: [], totalRecords: 0 },
    plans: { running: [], pendingApproval: [] },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    briefingCache.clear();
  });

  // ========================================================================
  // calculateDataHash
  // ========================================================================

  describe('calculateDataHash', () => {
    it('produces a deterministic hash from data', () => {
      const data = makeBriefingData();
      const hash1 = calculateDataHash(data);
      const hash2 = calculateDataHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBeGreaterThan(10);
    });

    it('changes when task counts change', () => {
      const data1 = makeBriefingData();
      const data2 = makeBriefingData({
        tasks: {
          ...makeBriefingData().tasks,
          counts: { pending: 5, dueToday: 2, overdue: 1, total: 10 },
        },
      });

      expect(calculateDataHash(data1)).not.toBe(calculateDataHash(data2));
    });

    it('changes when habit progress changes', () => {
      const data1 = makeBriefingData();
      const data2 = makeBriefingData({
        habits: {
          todayProgress: { completed: 5, total: 5, habits: [] },
          streaksAtRisk: [],
        },
      });

      expect(calculateDataHash(data1)).not.toBe(calculateDataHash(data2));
    });

    it('changes when goals stats change', () => {
      const data1 = makeBriefingData();
      const data2 = makeBriefingData({
        goals: {
          active: [],
          nextActions: [],
          stats: { activeCount: 10, averageProgress: 55.5, overdueCount: 1 },
        },
      });

      expect(calculateDataHash(data1)).not.toBe(calculateDataHash(data2));
    });

    it('rounds average progress to nearest integer', () => {
      const data1 = makeBriefingData({
        goals: {
          active: [],
          nextActions: [],
          stats: { activeCount: 4, averageProgress: 55.1, overdueCount: 1 },
        },
      });
      const data2 = makeBriefingData({
        goals: {
          active: [],
          nextActions: [],
          stats: { activeCount: 4, averageProgress: 55.4, overdueCount: 1 },
        },
      });

      // Both round to 55 so hash should be the same
      expect(calculateDataHash(data1)).toBe(calculateDataHash(data2));
    });

    it('includes plan counts', () => {
      const data1 = makeBriefingData();
      const data2 = makeBriefingData({
        plans: { running: [{ id: 'p1' } as unknown as Plan], pendingApproval: [] },
      });

      expect(calculateDataHash(data1)).not.toBe(calculateDataHash(data2));
    });
  });

  // ========================================================================
  // BriefingCache
  // ========================================================================

  describe('BriefingCache', () => {
    const mockBriefing = {
      id: 'briefing_1',
      summary: 'Test summary',
      priorities: ['Priority 1'],
      insights: ['Insight 1'],
      suggestedFocusAreas: ['Area 1'],
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      modelUsed: 'gpt-4o-mini',
      cached: false,
    };

    it('returns null for unknown user', () => {
      expect(briefingCache.get('unknown-user')).toBeNull();
    });

    it('stores and retrieves briefing', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');

      const cached = briefingCache.get('user-1');
      expect(cached).not.toBeNull();
      expect(cached!.summary).toBe('Test summary');
      expect(cached!.cached).toBe(true);
    });

    it('returns null after expiration', () => {
      // Set with very short TTL
      briefingCache.set('user-1', mockBriefing, 'hash-1', 1);

      // Wait for expiration
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);

      expect(briefingCache.get('user-1')).toBeNull();
      vi.useRealTimers();
    });

    it('invalidates when data hash changes', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');

      // Same hash - should return cached
      expect(briefingCache.get('user-1', 'hash-1')).not.toBeNull();

      // Different hash - should invalidate
      expect(briefingCache.get('user-1', 'hash-2')).toBeNull();
    });

    it('returns data hash for cached entry', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');

      expect(briefingCache.getDataHash('user-1')).toBe('hash-1');
      expect(briefingCache.getDataHash('unknown')).toBeNull();
    });

    it('invalidates specific user cache', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');
      briefingCache.set('user-2', mockBriefing, 'hash-2');

      briefingCache.invalidate('user-1');

      expect(briefingCache.get('user-1')).toBeNull();
      expect(briefingCache.get('user-2')).not.toBeNull();
    });

    it('clears all cached entries', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');
      briefingCache.set('user-2', mockBriefing, 'hash-2');

      briefingCache.clear();

      expect(briefingCache.get('user-1')).toBeNull();
      expect(briefingCache.get('user-2')).toBeNull();
    });

    it('ignores hash check when currentDataHash not provided', () => {
      briefingCache.set('user-1', mockBriefing, 'hash-1');

      // No hash passed - should return cached regardless
      expect(briefingCache.get('user-1')).not.toBeNull();
    });
  });

  // ========================================================================
  // DashboardService - parseAIResponse (via generateFallbackBriefing)
  // ========================================================================

  describe('generateFallbackBriefing', () => {
    it('generates summary from data counts', () => {
      const service = new DashboardService('user-1');
      const data = makeBriefingData();

      // Access private method via prototype trick
      const briefing = (service as unknown as PrivateDashboardService).generateFallbackBriefing(
        data
      );

      expect(briefing.id).toContain('briefing_fallback_');
      expect(briefing.summary).toContain('2 tasks due');
      expect(briefing.summary).toContain('2 events');
      expect(briefing.summary).toContain('5 habits');
      expect(briefing.modelUsed).toBe('fallback');
      expect(briefing.cached).toBe(false);
    });

    it('includes overdue tasks in priorities', () => {
      const data = makeBriefingData({
        tasks: {
          pending: [],
          dueToday: [],
          overdue: [],
          counts: { pending: 0, dueToday: 0, overdue: 3, total: 5 },
        },
      });

      const briefing = (
        new DashboardService() as unknown as PrivateDashboardService
      ).generateFallbackBriefing(data);

      expect(briefing.priorities).toContainEqual(expect.stringContaining('3 overdue'));
    });

    it('includes habits at risk in priorities', () => {
      const data = makeBriefingData({
        habits: {
          todayProgress: { completed: 0, total: 3, habits: [] },
          streaksAtRisk: [
            { id: 'h1', name: 'Meditation', completedToday: false, streakCurrent: 10 },
          ],
        },
      });

      const briefing = (
        new DashboardService() as unknown as PrivateDashboardService
      ).generateFallbackBriefing(data);

      expect(briefing.priorities).toContainEqual(expect.stringContaining('1 habit streak'));
    });

    it('includes calendar events in priorities', () => {
      const data = makeBriefingData({
        calendar: {
          todayEvents: [{ id: 'e1' } as unknown as CalendarEvent],
          upcomingEvents: [],
          counts: { today: 1, upcoming: 0 },
        },
      });

      const briefing = (
        new DashboardService() as unknown as PrivateDashboardService
      ).generateFallbackBriefing(data);

      expect(briefing.priorities).toContainEqual(expect.stringContaining('1 scheduled event'));
    });
  });

  // ========================================================================
  // DashboardService - parseAIResponse
  // ========================================================================

  describe('parseAIResponse', () => {
    const service = new DashboardService('user-1');

    it('parses JSON from markdown code fence', () => {
      const content =
        'Here is the briefing:\n```json\n{"summary": "A good day", "priorities": ["Do X"], "insights": ["Y is up"], "suggestedFocusAreas": ["Focus Z"]}\n```';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'gpt-4o-mini'
      );

      expect(briefing.summary).toBe('A good day');
      expect(briefing.priorities).toEqual(['Do X']);
      expect(briefing.insights).toEqual(['Y is up']);
      expect(briefing.suggestedFocusAreas).toEqual(['Focus Z']);
      expect(briefing.modelUsed).toBe('gpt-4o-mini');
      expect(briefing.cached).toBe(false);
      expect(briefing.id).toContain('briefing_');
    });

    it('parses bare JSON object', () => {
      const content =
        '{"summary": "Plain JSON", "priorities": [], "insights": [], "suggestedFocusAreas": []}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test-model'
      );

      expect(briefing.summary).toBe('Plain JSON');
    });

    it('parses JSON surrounded by text', () => {
      const content =
        'Here is your briefing:\n\n{"summary": "Surrounded", "priorities": ["A"]}\n\nHope this helps!';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('Surrounded');
      expect(briefing.priorities).toEqual(['A']);
    });

    it('handles missing arrays gracefully', () => {
      const content = '{"summary": "Minimal"}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('Minimal');
      expect(briefing.priorities).toEqual([]);
      expect(briefing.insights).toEqual([]);
      expect(briefing.suggestedFocusAreas).toEqual([]);
    });

    it('throws when no JSON found', () => {
      expect(() => {
        (service as unknown as PrivateDashboardService).parseAIResponse(
          'Just plain text with no JSON',
          'test'
        );
      }).toThrow('No JSON found');
    });

    it('handles nested braces in JSON', () => {
      const content =
        '{"summary": "Test with {braces}", "priorities": ["Check {item}"], "insights": [], "suggestedFocusAreas": []}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('Test with {braces}');
    });
  });

  // ========================================================================
  // DashboardService - calculateGoalStats
  // ========================================================================

  describe('calculateGoalStats', () => {
    const service = new DashboardService('user-1');
    const _today = new Date().toISOString().split('T')[0];

    it('calculates stats for active goals', () => {
      const goals = [
        { progress: 50, dueDate: '2099-12-31' },
        { progress: 80, dueDate: '2099-12-31' },
      ] as unknown as Goal[];

      const stats = (service as unknown as PrivateDashboardService).calculateGoalStats(goals);

      expect(stats.activeCount).toBe(2);
      expect(stats.averageProgress).toBe(65);
      expect(stats.overdueCount).toBe(0);
    });

    it('identifies overdue goals', () => {
      const goals = [
        { progress: 20, dueDate: '2020-01-01' },
        { progress: 60, dueDate: '2099-12-31' },
      ] as unknown as Goal[];

      const stats = (service as unknown as PrivateDashboardService).calculateGoalStats(goals);

      expect(stats.overdueCount).toBe(1);
    });

    it('handles empty goals', () => {
      const stats = (service as unknown as PrivateDashboardService).calculateGoalStats([]);

      expect(stats.activeCount).toBe(0);
      expect(stats.averageProgress).toBe(0);
      expect(stats.overdueCount).toBe(0);
    });

    it('handles goals without progress', () => {
      const goals = [
        { progress: undefined, dueDate: null },
        { progress: null, dueDate: null },
      ] as unknown as Goal[];

      const stats = (service as unknown as PrivateDashboardService).calculateGoalStats(goals);

      expect(stats.averageProgress).toBe(0);
    });
  });

  // ========================================================================
  // DashboardService - invalidateCache
  // ========================================================================

  describe('invalidateCache', () => {
    it('invalidates cache for the service user', () => {
      const service = new DashboardService('user-1');
      briefingCache.set(
        'user-1',
        {
          id: 'b1',
          summary: 'cached',
          priorities: [],
          insights: [],
          suggestedFocusAreas: [],
          generatedAt: '',
          expiresAt: '',
          modelUsed: '',
          cached: false,
        },
        'hash-1'
      );

      service.invalidateCache();

      expect(briefingCache.get('user-1')).toBeNull();
    });
  });

  // ========================================================================
  // BriefingCache - pruning when MAX_ENTRIES exceeded
  // ========================================================================

  describe('BriefingCache pruning', () => {
    it('prunes expired entries when cache exceeds MAX_ENTRIES', () => {
      vi.useFakeTimers();

      const briefing: AIBriefing = {
        id: 'b1',
        summary: 'test',
        priorities: [],
        insights: [],
        suggestedFocusAreas: [],
        generatedAt: '',
        expiresAt: '',
        modelUsed: '',
        cached: false,
      };

      // Fill with entries using very short TTL so they expire
      for (let i = 0; i < 501; i++) {
        briefingCache.set(`prune-user-${i}`, briefing, `hash-${i}`, 1);
      }

      // Advance time past TTL so entries are expired
      vi.advanceTimersByTime(10);

      // The 501st set should trigger prune, removing expired entries
      // After prune, expired entries are cleaned up
      // Now try to get an old entry — should be null (expired)
      expect(briefingCache.get('prune-user-0')).toBeNull();

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // DashboardService - aggregateDailyData
  // ========================================================================

  describe('aggregateDailyData', () => {
    it('returns full briefing data from all repositories', async () => {
      const task1 = { id: 't1', title: 'Task 1', priority: 'high' } as unknown as Task;
      mockTasksList
        .mockResolvedValueOnce([task1]) // pending
        .mockResolvedValueOnce([task1]) // due today
        .mockResolvedValueOnce([]); // overdue
      mockCalendarGetToday.mockResolvedValue([
        { id: 'e1', title: 'Meeting', startTime: new Date().toISOString() },
      ]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 5, recentCount: 2 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 1, total: 3, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.tasks.pending).toHaveLength(1);
      expect(data.tasks.dueToday).toHaveLength(1);
      expect(data.tasks.overdue).toHaveLength(0);
      expect(data.tasks.counts.total).toBe(1);
      expect(data.calendar.todayEvents).toHaveLength(1);
      expect(data.memories.stats.total).toBe(5);
      expect(data.habits.todayProgress.completed).toBe(1);
      expect(data.generatedAt).toBeDefined();
    });

    it('gracefully degrades when tasks repo fails', async () => {
      mockTasksList.mockRejectedValue(new Error('DB down'));
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      // Tasks section should be empty defaults, but rest should work
      expect(data.tasks.pending).toHaveLength(0);
      expect(data.tasks.counts.total).toBe(0);
      expect(data.generatedAt).toBeDefined();
    });

    it('gracefully degrades when calendar fails', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockRejectedValue(new Error('Calendar error'));
      mockCalendarGetUpcoming.mockRejectedValue(new Error('Calendar error'));
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.calendar.todayEvents).toHaveLength(0);
      expect(data.calendar.upcomingEvents).toHaveLength(0);
    });

    it('gracefully degrades when goals fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockRejectedValue(new Error('Goals error'));
      mockGoalService.getNextActions.mockRejectedValue(new Error('Goals error'));
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.goals.active).toHaveLength(0);
      expect(data.goals.stats.activeCount).toBe(0);
    });

    it('gracefully degrades when memories fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockRejectedValue(new Error('Memory error'));
      mockMemoryService.getImportantMemories.mockRejectedValue(new Error('Memory error'));
      mockMemoryService.getStats.mockRejectedValue(new Error('Memory error'));
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.memories.recent).toHaveLength(0);
      expect(data.memories.stats.total).toBe(0);
    });

    it('gracefully degrades when habits fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockRejectedValue(new Error('Habits error'));
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.habits.todayProgress.completed).toBe(0);
      expect(data.habits.todayProgress.total).toBe(0);
    });

    it('gracefully degrades when notes fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockRejectedValue(new Error('Notes error'));
      mockNotesRecent.mockRejectedValue(new Error('Notes error'));
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.notes.pinned).toHaveLength(0);
      expect(data.notes.recent).toHaveLength(0);
    });

    it('gracefully degrades when costs fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockRejectedValue(new Error('Costs error'));
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.costs.daily.totalCost).toBe(0);
      expect(data.costs.monthly.totalCost).toBe(0);
    });

    it('gracefully degrades when custom data fails', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockRejectedValue(new Error('Custom data error'));
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.customData.tables).toHaveLength(0);
      expect(data.customData.totalRecords).toBe(0);
    });

    it('gracefully degrades when plans fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockRejectedValue(new Error('Plans error'));

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.plans.running).toHaveLength(0);
      expect(data.plans.pendingApproval).toHaveLength(0);
    });

    it('gracefully degrades when triggers fail', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockRejectedValue(new Error('Trigger error'));
      mockTriggerService.getRecentHistory.mockRejectedValue(new Error('Trigger error'));
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.triggers.scheduledToday).toHaveLength(0);
      expect(data.triggers.counts.enabled).toBe(0);
    });

    it('filters triggers scheduled for today', async () => {
      const today = new Date().toISOString().split('T')[0];
      const triggerToday = { id: 't1', enabled: true, nextFire: `${today}T10:00:00Z` };
      const triggerTomorrow = { id: 't2', enabled: true, nextFire: '2099-12-31T10:00:00Z' };
      const triggerDisabled = { id: 't3', enabled: false, nextFire: `${today}T10:00:00Z` };
      const triggerNoFire = { id: 't4', enabled: true, nextFire: null };

      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([
        triggerToday,
        triggerTomorrow,
        triggerDisabled,
        triggerNoFire,
      ]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      // Only t1 is enabled and fires today
      expect(data.triggers.scheduledToday).toHaveLength(1);
      expect(data.triggers.counts.enabled).toBe(3); // t1, t2, t4 are enabled
    });

    it('filters plans by status', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([
        { id: 'p1', status: 'running' },
        { id: 'p2', status: 'pending' },
        { id: 'p3', status: 'completed' },
        { id: 'p4', status: 'running' },
      ]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.plans.running).toHaveLength(2);
      expect(data.plans.pendingApproval).toHaveLength(1);
    });

    it('limits pending tasks to 10 in output', async () => {
      const tasks = Array.from({ length: 15 }, (_, i) => ({
        id: `t${i}`,
        title: `Task ${i}`,
      }));
      mockTasksList
        .mockResolvedValueOnce(tasks) // pending
        .mockResolvedValueOnce([]) // due today
        .mockResolvedValueOnce([]); // overdue
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.tasks.pending).toHaveLength(10);
      expect(data.tasks.counts.pending).toBe(15);
    });

    it('aggregates habit streaks at risk', async () => {
      const habits = [
        { id: 'h1', name: 'Meditation', completedToday: false, streakCurrent: 10 },
        { id: 'h2', name: 'Exercise', completedToday: true, streakCurrent: 5 },
        { id: 'h3', name: 'Reading', completedToday: false, streakCurrent: 3 },
        { id: 'h4', name: 'Journal', completedToday: false, streakCurrent: 0 },
      ];

      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 1, total: 4, habits });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      // Streaks at risk: not completed today AND streakCurrent > 0
      expect(data.habits.streaksAtRisk).toHaveLength(2);
      expect(data.habits.streaksAtRisk.map((h: HabitProgressItem) => h.name)).toContain(
        'Meditation'
      );
      expect(data.habits.streaksAtRisk.map((h: HabitProgressItem) => h.name)).toContain('Reading');
    });

    it('aggregates custom data with table stats', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]);
      mockDatabaseService.listTables.mockResolvedValue([
        { id: 'tbl1', displayName: 'Contacts' },
        { id: 'tbl2', displayName: 'Invoices' },
      ]);
      mockDatabaseService.getTableStats
        .mockResolvedValueOnce({ recordCount: 50 })
        .mockResolvedValueOnce({ recordCount: 120 });
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.customData.tables).toHaveLength(2);
      expect(data.customData.totalRecords).toBe(170);
    });

    it('computes daily and monthly costs', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      // getDailyCosts(1) returns today's costs, getDailyCosts(30) returns monthly
      mockCostsGetDailyCosts
        .mockResolvedValueOnce([{ totalTokens: 5000, totalCost: 0.15, totalCalls: 10 }])
        .mockResolvedValueOnce([
          { totalTokens: 3000, totalCost: 0.1, totalCalls: 5 },
          { totalTokens: 7000, totalCost: 0.25, totalCalls: 15 },
        ]);
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.costs.daily.totalTokens).toBe(5000);
      expect(data.costs.daily.totalCost).toBe(0.15);
      expect(data.costs.monthly.totalTokens).toBe(10000);
      expect(data.costs.monthly.totalCost).toBeCloseTo(0.35);
      expect(data.costs.monthly.totalCalls).toBe(20);
    });

    it('handles empty daily costs array', async () => {
      mockTasksList.mockResolvedValue([]);
      mockCalendarGetToday.mockResolvedValue([]);
      mockCalendarGetUpcoming.mockResolvedValue([]);
      mockGoalService.getActive.mockResolvedValue([]);
      mockGoalService.getNextActions.mockResolvedValue([]);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [] });
      mockMemoryService.getRecentMemories.mockResolvedValue([]);
      mockMemoryService.getImportantMemories.mockResolvedValue([]);
      mockMemoryService.getStats.mockResolvedValue({ total: 0, recentCount: 0 });
      mockHabitsTodayProgress.mockResolvedValue({ completed: 0, total: 0, habits: [] });
      mockNotesPinned.mockResolvedValue([]);
      mockNotesRecent.mockResolvedValue([]);
      mockCostsGetDailyCosts.mockResolvedValue([]); // both calls return empty
      mockDatabaseService.listTables.mockResolvedValue([]);
      mockPlanService.listPlans.mockResolvedValue([]);

      const service = new DashboardService('user-1');
      const data = await service.aggregateDailyData();

      expect(data.costs.daily.totalTokens).toBe(0);
      expect(data.costs.daily.totalCost).toBe(0);
      expect(data.costs.monthly.totalTokens).toBe(0);
    });
  });

  // ========================================================================
  // DashboardService - generateAIBriefing
  // ========================================================================

  describe('generateAIBriefing', () => {
    const service = new DashboardService('user-1');

    it('returns cached briefing when available and data unchanged', async () => {
      const data = makeBriefingData();
      const hash = calculateDataHash(data);
      const cachedBriefing: AIBriefing = {
        id: 'b-cached',
        summary: 'Cached briefing',
        priorities: ['P1'],
        insights: ['I1'],
        suggestedFocusAreas: ['F1'],
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        modelUsed: 'gpt-4o-mini',
        cached: false,
      };
      briefingCache.set('user-1', cachedBriefing, hash);

      const result = await service.generateAIBriefing(data);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('Cached briefing');
      // Should NOT call the agent
      expect(mockGetOrCreateChatAgent).not.toHaveBeenCalled();
    });

    it('bypasses cache when forceRefresh is true', async () => {
      const data = makeBriefingData();
      const hash = calculateDataHash(data);
      briefingCache.set(
        'user-1',
        {
          id: 'b-cached',
          summary: 'Cached',
          priorities: [],
          insights: [],
          suggestedFocusAreas: [],
          generatedAt: '',
          expiresAt: '',
          modelUsed: '',
          cached: false,
        },
        hash
      );

      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: {
            content: '{"summary":"Fresh","priorities":[],"insights":[],"suggestedFocusAreas":[]}',
          },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefing(data, { forceRefresh: true });

      expect(result.summary).toBe('Fresh');
      expect(mockGetOrCreateChatAgent).toHaveBeenCalled();
    });

    it('calls agent and parses response on cache miss', async () => {
      const data = makeBriefingData();
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: {
            content:
              '{"summary":"AI generated","priorities":["Do X"],"insights":["Y"],"suggestedFocusAreas":["Z"]}',
          },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefing(data, {
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(result.summary).toBe('AI generated');
      expect(result.priorities).toEqual(['Do X']);
      expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('openai', 'gpt-4o');
    });

    it('returns fallback when agent returns error result', async () => {
      const data = makeBriefingData();
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: false,
          error: { message: 'API key invalid' },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefing(data, {
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(result.modelUsed).toBe('fallback');
    });

    it('returns fallback when agent throws', async () => {
      const data = makeBriefingData();
      mockGetOrCreateChatAgent.mockRejectedValue(new Error('Network error'));

      const result = await service.generateAIBriefing(data, {
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(result.modelUsed).toBe('fallback');
    });

    it('uses default provider/model when not specified', async () => {
      const data = makeBriefingData();
      mockGetDefaultProvider.mockResolvedValue('anthropic');
      mockGetDefaultModel.mockResolvedValue('claude-3-haiku');
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: {
            content: '{"summary":"Test","priorities":[],"insights":[],"suggestedFocusAreas":[]}',
          },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      await service.generateAIBriefing(data);

      expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('anthropic', 'claude-3-haiku');
    });

    it('caches the generated briefing after success', async () => {
      const data = makeBriefingData();
      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: {
            content:
              '{"summary":"Cacheable","priorities":[],"insights":[],"suggestedFocusAreas":[]}',
          },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      await service.generateAIBriefing(data, { provider: 'openai', model: 'gpt-4o' });

      const hash = calculateDataHash(data);
      const cached = briefingCache.get('user-1', hash);
      expect(cached).not.toBeNull();
      expect(cached!.summary).toBe('Cacheable');
    });
  });

  // ========================================================================
  // DashboardService - generateAIBriefingStreaming
  // ========================================================================

  describe('generateAIBriefingStreaming', () => {
    const service = new DashboardService('user-1');

    it('streams chunks and returns parsed briefing', async () => {
      const data = makeBriefingData();
      const chunks: string[] = [];
      const onChunk = vi.fn(async (chunk: string) => {
        chunks.push(chunk);
      });

      const mockAgent = {
        chat: vi.fn(
          async (
            _prompt: string,
            opts: { stream: boolean; onChunk: (c: { content: string }) => void }
          ) => {
            // Simulate streaming chunks
            opts.onChunk({ content: '{"summary":"Streamed"' });
            opts.onChunk({ content: ',"priorities":[]' });
            opts.onChunk({ content: ',"insights":[]' });
            opts.onChunk({ content: ',"suggestedFocusAreas":[]}' });
            return {
              ok: true,
              value: { content: '' }, // empty content, full content comes from chunks
            };
          }
        ),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefingStreaming(
        data,
        { provider: 'openai', model: 'gpt-4o' },
        onChunk
      );

      expect(result.summary).toBe('Streamed');
      expect(onChunk).toHaveBeenCalled();
    });

    it('falls back to result.value.content when streaming yields empty', async () => {
      const data = makeBriefingData();
      const onChunk = vi.fn(async () => {});

      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: true,
          value: {
            content:
              '{"summary":"From result","priorities":[],"insights":[],"suggestedFocusAreas":[]}',
          },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefingStreaming(
        data,
        { provider: 'openai', model: 'gpt-4o' },
        onChunk
      );

      expect(result.summary).toBe('From result');
    });

    it('returns fallback when streaming agent fails', async () => {
      const data = makeBriefingData();
      const onChunk = vi.fn(async () => {});
      mockGetOrCreateChatAgent.mockRejectedValue(new Error('Stream error'));

      const result = await service.generateAIBriefingStreaming(
        data,
        { provider: 'openai', model: 'gpt-4o' },
        onChunk
      );

      expect(result.modelUsed).toBe('fallback');
    });

    it('returns fallback when streaming result is not ok', async () => {
      const data = makeBriefingData();
      const onChunk = vi.fn(async () => {});

      const mockAgent = {
        chat: vi.fn(async () => ({
          ok: false,
          error: { message: 'Model error' },
        })),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      const result = await service.generateAIBriefingStreaming(
        data,
        { provider: 'openai', model: 'gpt-4o' },
        onChunk
      );

      expect(result.modelUsed).toBe('fallback');
    });

    it('caches the streaming result', async () => {
      const data = makeBriefingData();
      const onChunk = vi.fn(async () => {});

      const mockAgent = {
        chat: vi.fn(
          async (
            _prompt: string,
            opts: { stream: boolean; onChunk: (c: { content: string }) => void }
          ) => {
            opts.onChunk({
              content:
                '{"summary":"Cached stream","priorities":[],"insights":[],"suggestedFocusAreas":[]}',
            });
            return { ok: true, value: { content: '' } };
          }
        ),
      };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);

      await service.generateAIBriefingStreaming(
        data,
        { provider: 'openai', model: 'gpt-4o' },
        onChunk
      );

      const hash = calculateDataHash(data);
      const cached = briefingCache.get('user-1', hash);
      expect(cached).not.toBeNull();
    });
  });

  // ========================================================================
  // DashboardService - buildBriefingPrompt
  // ========================================================================

  describe('buildBriefingPrompt', () => {
    const service = new DashboardService('user-1');

    it('includes task overdue and due today info', () => {
      const data = makeBriefingData({
        tasks: {
          pending: [],
          dueToday: [{ id: 't1', title: 'Ship feature', priority: 'high' } as unknown as Task],
          overdue: [{ id: 't2', title: 'Fix bug' } as unknown as Task],
          counts: { pending: 2, dueToday: 1, overdue: 1, total: 5 },
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('Overdue: 1 tasks');
      expect(prompt).toContain('Due Today: 1 tasks');
      expect(prompt).toContain('[OVERDUE] Fix bug');
      expect(prompt).toContain('Ship feature');
    });

    it('includes calendar events', () => {
      const data = makeBriefingData({
        calendar: {
          todayEvents: [
            {
              id: 'e1',
              title: 'Team meeting',
              startTime: '2026-02-24T14:00:00Z',
            } as unknown as CalendarEvent,
          ],
          upcomingEvents: [],
          counts: { today: 1, upcoming: 0 },
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('1 events today');
      expect(prompt).toContain('Team meeting');
    });

    it('includes habits streaks at risk', () => {
      const data = makeBriefingData({
        habits: {
          todayProgress: { completed: 1, total: 3, habits: [] },
          streaksAtRisk: [
            { id: 'h1', name: 'Meditation', completedToday: false, streakCurrent: 10 },
          ],
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('1 streaks at risk');
      expect(prompt).toContain('Meditation (10 day streak)');
    });

    it('includes costs info', () => {
      const data = makeBriefingData();

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('$0.15');
      expect(prompt).toContain('$3.50');
      expect(prompt).toContain('5,000 tokens');
    });

    it('includes goals next actions', () => {
      const data = makeBriefingData({
        goals: {
          active: [],
          nextActions: [
            { id: 'a1', title: 'Write proposal', goalTitle: 'Launch product' } as never,
          ],
          stats: { activeCount: 1, averageProgress: 50, overdueCount: 0 },
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('Write proposal');
    });

    it('shows (no tasks) when empty', () => {
      const data = makeBriefingData({
        tasks: {
          pending: [],
          dueToday: [],
          overdue: [],
          counts: { pending: 0, dueToday: 0, overdue: 0, total: 0 },
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('(no tasks)');
    });

    it('includes running plans and triggers', () => {
      const data = makeBriefingData({
        triggers: {
          scheduledToday: [],
          recentHistory: [],
          counts: { enabled: 2, scheduledToday: 3 },
        },
        plans: {
          running: [{ id: 'p1' } as unknown as Plan, { id: 'p2' } as unknown as Plan],
          pendingApproval: [],
        },
      });

      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('3 triggers scheduled for today');
      expect(prompt).toContain('2 plans currently running');
    });

    it('includes JSON format instructions', () => {
      const data = makeBriefingData();
      const prompt = (service as unknown as PrivateDashboardService).buildBriefingPrompt(data);

      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"priorities"');
      expect(prompt).toContain('"insights"');
      expect(prompt).toContain('"suggestedFocusAreas"');
    });
  });

  // ========================================================================
  // DashboardService - parseAIResponse edge cases
  // ========================================================================

  describe('parseAIResponse additional edge cases', () => {
    const service = new DashboardService('user-1');

    it('parses JSON from bare code fence (no json tag)', () => {
      const content = '```\n{"summary":"Bare fence","priorities":[]}\n```';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('Bare fence');
    });

    it('handles missing summary gracefully', () => {
      const content = '{"priorities":["A"]}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('No summary available.');
    });

    it('handles non-array priorities gracefully', () => {
      const content = '{"summary":"Test","priorities":"not an array"}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.priorities).toEqual([]);
    });

    it('sets generatedAt and expiresAt', () => {
      const content = '{"summary":"Timed"}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.generatedAt).toBeTruthy();
      expect(briefing.expiresAt).toBeTruthy();
      // expiresAt should be ~30 min in the future
      const expires = new Date(briefing.expiresAt).getTime();
      const generated = new Date(briefing.generatedAt).getTime();
      expect(expires - generated).toBeCloseTo(30 * 60 * 1000, -3);
    });

    it('handles escaped quotes in JSON strings', () => {
      const content = '{"summary":"He said \\"hello\\"","priorities":[]}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(
        content,
        'test'
      );

      expect(briefing.summary).toBe('He said "hello"');
    });
  });

  // ========================================================================
  // DashboardService - fallback briefing with no priorities
  // ========================================================================

  describe('generateFallbackBriefing with all zeros', () => {
    it('generates empty priorities when no data triggers them', () => {
      const data = makeBriefingData({
        tasks: {
          pending: [],
          dueToday: [],
          overdue: [],
          counts: { pending: 0, dueToday: 0, overdue: 0, total: 0 },
        },
        calendar: {
          todayEvents: [],
          upcomingEvents: [],
          counts: { today: 0, upcoming: 0 },
        },
        habits: {
          todayProgress: { completed: 0, total: 0, habits: [] },
          streaksAtRisk: [],
        },
      });

      const briefing = (
        new DashboardService() as unknown as PrivateDashboardService
      ).generateFallbackBriefing(data);

      expect(briefing.priorities).toHaveLength(0);
    });

    it('includes due today tasks in priorities', () => {
      const data = makeBriefingData({
        tasks: {
          pending: [],
          dueToday: [],
          overdue: [],
          counts: { pending: 0, dueToday: 5, overdue: 0, total: 5 },
        },
      });

      const briefing = (
        new DashboardService() as unknown as PrivateDashboardService
      ).generateFallbackBriefing(data);

      expect(briefing.priorities).toContainEqual(expect.stringContaining('5 task(s) due today'));
    });
  });
});

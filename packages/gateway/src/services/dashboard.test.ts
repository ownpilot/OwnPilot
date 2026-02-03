/**
 * Dashboard Service Tests
 *
 * Tests the pure utility functions and BriefingCache, plus the
 * fallback briefing generation and AI response parsing logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDataHash,
  briefingCache,
  DashboardService,
  type DailyBriefingData,
  type AIBriefing,
} from './dashboard.js';
import { type Plan, type CalendarEvent, type Goal } from '../db/repositories/index.js';

/** Expose private methods for testing without `as any`. */
interface PrivateDashboardService {
  generateFallbackBriefing(data: DailyBriefingData): AIBriefing;
  parseAIResponse(content: string, model: string): AIBriefing;
  calculateGoalStats(goals: Goal[]): { activeCount: number; averageProgress: number; overdueCount: number };
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
      monthly: { totalTokens: 100000, totalCost: 3.50, totalCalls: 200 },
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
      const briefing = (service as unknown as PrivateDashboardService).generateFallbackBriefing(data);

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

      const briefing = (new DashboardService() as unknown as PrivateDashboardService).generateFallbackBriefing(data);

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

      const briefing = (new DashboardService() as unknown as PrivateDashboardService).generateFallbackBriefing(data);

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

      const briefing = (new DashboardService() as unknown as PrivateDashboardService).generateFallbackBriefing(data);

      expect(briefing.priorities).toContainEqual(expect.stringContaining('1 scheduled event'));
    });
  });

  // ========================================================================
  // DashboardService - parseAIResponse
  // ========================================================================

  describe('parseAIResponse', () => {
    const service = new DashboardService('user-1');

    it('parses JSON from markdown code fence', () => {
      const content = 'Here is the briefing:\n```json\n{"summary": "A good day", "priorities": ["Do X"], "insights": ["Y is up"], "suggestedFocusAreas": ["Focus Z"]}\n```';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(content, 'gpt-4o-mini');

      expect(briefing.summary).toBe('A good day');
      expect(briefing.priorities).toEqual(['Do X']);
      expect(briefing.insights).toEqual(['Y is up']);
      expect(briefing.suggestedFocusAreas).toEqual(['Focus Z']);
      expect(briefing.modelUsed).toBe('gpt-4o-mini');
      expect(briefing.cached).toBe(false);
      expect(briefing.id).toContain('briefing_');
    });

    it('parses bare JSON object', () => {
      const content = '{"summary": "Plain JSON", "priorities": [], "insights": [], "suggestedFocusAreas": []}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(content, 'test-model');

      expect(briefing.summary).toBe('Plain JSON');
    });

    it('parses JSON surrounded by text', () => {
      const content = 'Here is your briefing:\n\n{"summary": "Surrounded", "priorities": ["A"]}\n\nHope this helps!';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(content, 'test');

      expect(briefing.summary).toBe('Surrounded');
      expect(briefing.priorities).toEqual(['A']);
    });

    it('handles missing arrays gracefully', () => {
      const content = '{"summary": "Minimal"}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(content, 'test');

      expect(briefing.summary).toBe('Minimal');
      expect(briefing.priorities).toEqual([]);
      expect(briefing.insights).toEqual([]);
      expect(briefing.suggestedFocusAreas).toEqual([]);
    });

    it('throws when no JSON found', () => {
      expect(() => {
        (service as unknown as PrivateDashboardService).parseAIResponse('Just plain text with no JSON', 'test');
      }).toThrow('No JSON found');
    });

    it('handles nested braces in JSON', () => {
      const content = '{"summary": "Test with {braces}", "priorities": ["Check {item}"], "insights": [], "suggestedFocusAreas": []}';

      const briefing = (service as unknown as PrivateDashboardService).parseAIResponse(content, 'test');

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
      briefingCache.set('user-1', {
        id: 'b1',
        summary: 'cached',
        priorities: [],
        insights: [],
        suggestedFocusAreas: [],
        generatedAt: '',
        expiresAt: '',
        modelUsed: '',
        cached: false,
      }, 'hash-1');

      service.invalidateCache();

      expect(briefingCache.get('user-1')).toBeNull();
    });
  });
});

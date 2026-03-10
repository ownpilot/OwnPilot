/**
 * Dashboard Briefing Tests
 *
 * Tests the briefing cache, data hash calculation, prompt building,
 * AI response parsing, and fallback generation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calculateDataHash,
  briefingCache,
  buildBriefingPrompt,
  parseAIResponse,
  generateFallbackBriefing,
} from './dashboard-briefing.js';
import type { DailyBriefingData } from './dashboard-types.js';

// Mock the log module
vi.mock('./log.js', () => ({
  getLog: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockBriefingData(overrides: Partial<DailyBriefingData> = {}): DailyBriefingData {
  return {
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
    goals: {
      active: [],
      nextActions: [],
      stats: { activeCount: 0, averageProgress: 0, overdueCount: 0 },
    },
    triggers: {
      scheduledToday: [],
      recentHistory: [],
      counts: { enabled: 0, scheduledToday: 0 },
    },
    memories: {
      recent: [],
      important: [],
      stats: { total: 0, recentCount: 0 },
    },
    habits: {
      todayProgress: { completed: 0, total: 0, habits: [] },
      streaksAtRisk: [],
    },
    notes: {
      pinned: [],
      recent: [],
    },
    costs: {
      daily: { totalTokens: 0, totalCost: 0, totalCalls: 0 },
      monthly: { totalTokens: 0, totalCost: 0, totalCalls: 0 },
    },
    customData: {
      tables: [],
      totalRecords: 0,
    },
    plans: {
      running: [],
      pendingApproval: [],
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateDataHash', () => {
  it('returns consistent hash for same data', () => {
    const data = createMockBriefingData();
    const hash1 = calculateDataHash(data);
    const hash2 = calculateDataHash(data);
    expect(hash1).toBe(hash2);
  });

  it('includes task counts in hash', () => {
    const data1 = createMockBriefingData();
    const data2 = createMockBriefingData({
      tasks: {
        ...data1.tasks,
        counts: { pending: 5, dueToday: 3, overdue: 1, total: 9 },
      },
    });

    const hash1 = calculateDataHash(data1);
    const hash2 = calculateDataHash(data2);
    expect(hash1).not.toBe(hash2);
    expect(hash2).toContain('t:5,3,1');
  });

  it('includes calendar count in hash', () => {
    const data1 = createMockBriefingData();
    const data2 = createMockBriefingData({
      calendar: {
        ...data1.calendar,
        counts: { today: 3, upcoming: 5 },
      },
    });

    const hash1 = calculateDataHash(data1);
    const hash2 = calculateDataHash(data2);
    expect(hash1).not.toBe(hash2);
    expect(hash2).toContain('c:3');
  });

  it('includes goal stats in hash', () => {
    const data1 = createMockBriefingData();
    const data2 = createMockBriefingData({
      goals: {
        ...data1.goals,
        stats: { activeCount: 5, averageProgress: 67.5, overdueCount: 1 },
      },
    });

    const hash1 = calculateDataHash(data1);
    const hash2 = calculateDataHash(data2);
    expect(hash1).not.toBe(hash2);
    expect(hash2).toContain('g:5,68');
  });

  it('rounds average progress to integer', () => {
    const data = createMockBriefingData({
      goals: {
        ...createMockBriefingData().goals,
        stats: { activeCount: 3, averageProgress: 66.6, overdueCount: 0 },
      },
    });

    const hash = calculateDataHash(data);
    expect(hash).toContain('g:3,67');
  });

  it('includes habit progress in hash', () => {
    const data = createMockBriefingData({
      habits: {
        ...createMockBriefingData().habits,
        todayProgress: { completed: 3, total: 5, habits: [] },
      },
    });

    const hash = calculateDataHash(data);
    expect(hash).toContain('h:3/5');
  });

  it('includes trigger counts in hash', () => {
    const data = createMockBriefingData({
      triggers: {
        ...createMockBriefingData().triggers,
        counts: { enabled: 10, scheduledToday: 3 },
      },
    });

    const hash = calculateDataHash(data);
    expect(hash).toContain('tr:3');
  });

  it('includes plan counts in hash', () => {
    const data = createMockBriefingData({
      plans: {
        running: [{ id: '1' }, { id: '2' }] as DailyBriefingData['plans']['running'],
        pendingApproval: [{ id: '3' }] as DailyBriefingData['plans']['pendingApproval'],
      },
    });

    const hash = calculateDataHash(data);
    expect(hash).toContain('p:2,1');
  });

  it('produces different hashes for different data', () => {
    const data1 = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 1, dueToday: 0, overdue: 0, total: 1 },
      },
    });
    const data2 = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 2, dueToday: 0, overdue: 0, total: 2 },
      },
    });

    expect(calculateDataHash(data1)).not.toBe(calculateDataHash(data2));
  });
});

describe('BriefingCache', () => {
  beforeEach(() => {
    briefingCache.clear();
  });

  describe('get', () => {
    it('returns null when cache is empty', () => {
      const result = briefingCache.get('user-123');
      expect(result).toBeNull();
    });

    it('returns null when entry is expired', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1', -1000); // Already expired

      const result = briefingCache.get('user-123');
      expect(result).toBeNull();
    });

    it('returns null when data hash does not match', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1');

      const result = briefingCache.get('user-123', 'different-hash');
      expect(result).toBeNull();
    });

    it('returns cached briefing with cached=true flag', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1');

      const result = briefingCache.get('user-123', 'hash-1');
      expect(result).not.toBeNull();
      expect(result?.cached).toBe(true);
      expect(result?.id).toBe(briefing.id);
      expect(result?.summary).toBe(briefing.summary);
    });

    it('returns briefing without hash check when hash not provided', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1');

      const result = briefingCache.get('user-123');
      expect(result).not.toBeNull();
      expect(result?.cached).toBe(true);
    });
  });

  describe('set', () => {
    it('stores briefing in cache', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1');

      const retrieved = briefingCache.get('user-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(briefing.id);
    });

    it('uses custom TTL when provided', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1', 60000); // 1 minute

      // Should still be available
      const retrieved = briefingCache.get('user-123');
      expect(retrieved).not.toBeNull();
    });
  });

  describe('invalidate', () => {
    it('removes entry from cache', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'hash-1');
      expect(briefingCache.get('user-123')).not.toBeNull();

      briefingCache.invalidate('user-123');
      expect(briefingCache.get('user-123')).toBeNull();
    });

    it('does nothing for non-existent user', () => {
      briefingCache.invalidate('non-existent');
      expect(briefingCache.get('non-existent')).toBeNull();
    });
  });

  describe('getDataHash', () => {
    it('returns stored data hash', () => {
      const briefing = createMockAIBriefing();
      briefingCache.set('user-123', briefing, 'my-hash');

      const hash = briefingCache.getDataHash('user-123');
      expect(hash).toBe('my-hash');
    });

    it('returns null when no entry exists', () => {
      const hash = briefingCache.getDataHash('non-existent');
      expect(hash).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      briefingCache.set('user-1', createMockAIBriefing(), 'hash-1');
      briefingCache.set('user-2', createMockAIBriefing(), 'hash-2');

      briefingCache.clear();

      expect(briefingCache.get('user-1')).toBeNull();
      expect(briefingCache.get('user-2')).toBeNull();
    });
  });
});

describe('buildBriefingPrompt', () => {
  it('includes today\'s date in the prompt', () => {
    const data = createMockBriefingData();
    const prompt = buildBriefingPrompt(data);

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    expect(prompt).toContain(today);
  });

  it('includes task counts', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 10, dueToday: 5, overdue: 2, total: 17 },
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('Overdue: 2 tasks');
    expect(prompt).toContain('Due Today: 5 tasks');
    expect(prompt).toContain('Pending: 10 tasks');
  });

  it('includes overdue tasks with [OVERDUE] marker', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        overdue: [{ id: '1', title: 'Urgent task' }] as DailyBriefingData['tasks']['overdue'],
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('[OVERDUE] Urgent task');
  });

  it('includes due today tasks with priority', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        dueToday: [
          { id: '1', title: 'Task 1', priority: 'high' },
          { id: '2', title: 'Task 2', priority: 'medium' },
        ] as DailyBriefingData['tasks']['dueToday'],
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('Task 1 (high priority)');
    expect(prompt).toContain('Task 2 (medium priority)');
  });

  it('includes calendar events with times', () => {
    const data = createMockBriefingData({
      calendar: {
        todayEvents: [
          { id: '1', title: 'Meeting', startTime: '2026-03-10T10:30:00Z' },
        ] as DailyBriefingData['calendar']['todayEvents'],
        upcomingEvents: [],
        counts: { today: 1, upcoming: 0 },
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('1 events today');
    expect(prompt).toContain('Meeting');
  });

  it('includes goal statistics', () => {
    const data = createMockBriefingData({
      goals: {
        ...createMockBriefingData().goals,
        stats: { activeCount: 5, averageProgress: 75.5, overdueCount: 1 },
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('5 active goals');
    expect(prompt).toContain('Average progress: 76%');
    expect(prompt).toContain('1 overdue goals');
  });

  it('includes habit progress', () => {
    const data = createMockBriefingData({
      habits: {
        ...createMockBriefingData().habits,
        todayProgress: { completed: 3, total: 5, habits: [] },
        streaksAtRisk: [{ id: '1', name: 'Exercise', streakCurrent: 10, completedToday: false }],
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('Progress: 3/5 completed');
    expect(prompt).toContain('1 streaks at risk');
    expect(prompt).toContain('Exercise (10 day streak)');
  });

  it('includes cost information', () => {
    const data = createMockBriefingData({
      costs: {
        daily: { totalTokens: 1500, totalCost: 0.05, totalCalls: 10 },
        monthly: { totalTokens: 45000, totalCost: 1.5, totalCalls: 300 },
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('Today: $0.05 (1,500 tokens)');
    expect(prompt).toContain('This month: $1.50');
  });

  it('includes trigger and plan counts', () => {
    const data = createMockBriefingData({
      triggers: {
        ...createMockBriefingData().triggers,
        counts: { enabled: 10, scheduledToday: 3 },
      },
      plans: {
        running: [{ id: '1' }] as DailyBriefingData['plans']['running'],
        pendingApproval: [{ id: '2' }] as DailyBriefingData['plans']['pendingApproval'],
      },
    });
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('3 triggers scheduled for today');
    expect(prompt).toContain('1 plans currently running');
  });

  it('includes JSON format instructions', () => {
    const data = createMockBriefingData();
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('Format your response as JSON');
    expect(prompt).toContain('"summary": "..."');
    expect(prompt).toContain('"priorities":');
    expect(prompt).toContain('"insights":');
    expect(prompt).toContain('"suggestedFocusAreas":');
  });

  it('shows placeholder when no tasks', () => {
    const data = createMockBriefingData();
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('(no tasks)');
  });

  it('shows placeholder when no events', () => {
    const data = createMockBriefingData();
    const prompt = buildBriefingPrompt(data);

    expect(prompt).toContain('(no events)');
  });
});

describe('parseAIResponse', () => {
  it('parses JSON from markdown code fences', () => {
    const content = `
Some text before
\`\`\`json
{
  "summary": "Test summary",
  "priorities": ["p1", "p2"],
  "insights": ["i1"],
  "suggestedFocusAreas": ["f1", "f2"]
}
\`\`\`
Some text after
    `;

    const result = parseAIResponse(content, 'gpt-4');

    expect(result.summary).toBe('Test summary');
    expect(result.priorities).toEqual(['p1', 'p2']);
    expect(result.insights).toEqual(['i1']);
    expect(result.suggestedFocusAreas).toEqual(['f1', 'f2']);
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.cached).toBe(false);
    expect(result.id).toMatch(/^briefing_\d+$/);
  });

  it('parses JSON without language specifier in code fence', () => {
    const content = `
\`\`\`
{
  "summary": "Summary text",
  "priorities": [],
  "insights": [],
  "suggestedFocusAreas": []
}
\`\`\`
    `;

    const result = parseAIResponse(content, 'claude');

    expect(result.summary).toBe('Summary text');
    expect(result.modelUsed).toBe('claude');
  });

  it('parses JSON without code fences using brace balancing', () => {
    const content = `
Here's your briefing:
{
  "summary": "Brace balanced summary",
  "priorities": ["Priority 1"],
  "insights": ["Insight with {nested} braces"],
  "suggestedFocusAreas": ["Focus area"]
}
Hope this helps!
    `;

    const result = parseAIResponse(content, 'model-x');

    expect(result.summary).toBe('Brace balanced summary');
    expect(result.priorities).toEqual(['Priority 1']);
  });

  it('handles escaped quotes in JSON strings', () => {
    const content = `
\`\`\`json
{
  "summary": "Summary with \\"quotes\\"",
  "priorities": [],
  "insights": [],
  "suggestedFocusAreas": []
}
\`\`\`
    `;

    const result = parseAIResponse(content, 'model');

    expect(result.summary).toBe('Summary with "quotes"');
  });

  it('uses default values for missing fields', () => {
    const content = `
\`\`\`json
{
  "summary": "Only summary"
}
\`\`\`
    `;

    const result = parseAIResponse(content, 'model');

    expect(result.summary).toBe('Only summary');
    expect(result.priorities).toEqual([]);
    expect(result.insights).toEqual([]);
    expect(result.suggestedFocusAreas).toEqual([]);
  });

  it('sets expiresAt 30 minutes from generation', () => {
    const before = Date.now();
    const content = `
\`\`\`json
{
  "summary": "Test"
}
\`\`\`
    `;

    const result = parseAIResponse(content, 'model');
    const after = Date.now();

    const generatedAt = new Date(result.generatedAt).getTime();
    const expiresAt = new Date(result.expiresAt).getTime();

    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);
    expect(expiresAt - generatedAt).toBe(30 * 60 * 1000); // 30 minutes
  });

  it('throws error when no JSON found', () => {
    const content = 'Just plain text without any JSON';

    expect(() => parseAIResponse(content, 'model')).toThrow('No JSON found in response');
  });

  it('throws error for invalid JSON', () => {
    const content = `
\`\`\`json
{ invalid json }
\`\`\`
    `;

    expect(() => parseAIResponse(content, 'model')).toThrow();
  });
});

describe('generateFallbackBriefing', () => {
  it('creates fallback with basic counts', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 5, dueToday: 3, overdue: 1, total: 9 },
      },
      calendar: {
        ...createMockBriefingData().calendar,
        counts: { today: 2, upcoming: 5 },
      },
      habits: {
        ...createMockBriefingData().habits,
        todayProgress: { completed: 2, total: 4, habits: [] },
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.summary).toContain('3 tasks due');
    expect(result.summary).toContain('2 events');
    expect(result.summary).toContain('4 habits');
    expect(result.modelUsed).toBe('fallback');
    expect(result.cached).toBe(false);
    expect(result.id).toContain('fallback');
  });

  it('includes overdue tasks in priorities', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 0, dueToday: 0, overdue: 3, total: 3 },
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.priorities).toContain('Address 3 overdue task(s)');
  });

  it('includes due today tasks in priorities', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 0, dueToday: 5, overdue: 0, total: 5 },
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.priorities).toContain('Complete 5 task(s) due today');
  });

  it('includes calendar events in priorities', () => {
    const data = createMockBriefingData({
      calendar: {
        ...createMockBriefingData().calendar,
        counts: { today: 4, upcoming: 0 },
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.priorities).toContain('Attend 4 scheduled event(s)');
  });

  it('includes streaks at risk in priorities', () => {
    const data = createMockBriefingData({
      habits: {
        ...createMockBriefingData().habits,
        streaksAtRisk: [
          { id: '1', name: 'Habit 1', streakCurrent: 5, completedToday: false },
          { id: '2', name: 'Habit 2', streakCurrent: 10, completedToday: false },
        ],
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.priorities).toContain('Maintain 2 habit streak(s) at risk');
  });

  it('includes all priority types when all conditions met', () => {
    const data = createMockBriefingData({
      tasks: {
        ...createMockBriefingData().tasks,
        counts: { pending: 0, dueToday: 1, overdue: 2, total: 3 },
      },
      calendar: {
        ...createMockBriefingData().calendar,
        counts: { today: 3, upcoming: 0 },
      },
      habits: {
        ...createMockBriefingData().habits,
        streaksAtRisk: [{ id: '1', name: 'Habit', streakCurrent: 5, completedToday: false }],
      },
    });

    const result = generateFallbackBriefing(data);

    expect(result.priorities).toHaveLength(4);
    expect(result.priorities).toContain('Address 2 overdue task(s)');
    expect(result.priorities).toContain('Complete 1 task(s) due today');
    expect(result.priorities).toContain('Attend 3 scheduled event(s)');
    expect(result.priorities).toContain('Maintain 1 habit streak(s) at risk');
  });

  it('has AI unavailable insight', () => {
    const data = createMockBriefingData();
    const result = generateFallbackBriefing(data);

    expect(result.insights).toEqual(['AI briefing generation is currently unavailable.']);
  });

  it('has focus area suggestion', () => {
    const data = createMockBriefingData();
    const result = generateFallbackBriefing(data);

    expect(result.suggestedFocusAreas).toEqual(['Complete your most urgent tasks first.']);
  });

  it('sets expiresAt 5 minutes from generation', () => {
    const before = Date.now();
    const data = createMockBriefingData();
    const result = generateFallbackBriefing(data);
    const after = Date.now();

    const generatedAt = new Date(result.generatedAt).getTime();
    const expiresAt = new Date(result.expiresAt).getTime();

    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);
    expect(expiresAt - generatedAt).toBe(5 * 60 * 1000); // 5 minutes
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function createMockAIBriefing() {
  return {
    id: `briefing_${Date.now()}`,
    summary: 'Test summary',
    priorities: ['Priority 1'],
    insights: ['Insight 1'],
    suggestedFocusAreas: ['Focus 1'],
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    modelUsed: 'test-model',
    cached: false,
  };
}

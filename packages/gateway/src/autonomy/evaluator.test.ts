/**
 * Tests for the Pulse Evaluator
 *
 * Pure-function tests — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePulseContext, calculateNextInterval, RULE_DEFINITIONS, DEFAULT_RULE_THRESHOLDS } from './evaluator.js';
import type { RuleThresholds } from './evaluator.js';
import type { PulseContext } from './context.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides: Partial<PulseContext> = {}): PulseContext {
  return {
    userId: 'test-user',
    gatheredAt: new Date(),
    timeContext: { hour: 10, dayOfWeek: 1, isWeekend: false },
    goals: { active: [], stale: [], upcoming: [] },
    memories: { total: 0, recentCount: 0, avgImportance: 0.5 },
    activity: { daysSinceLastActivity: 0, hasRecentActivity: true },
    systemHealth: { pendingApprovals: 0, triggerErrors: 0 },
    ...overrides,
  };
}

// ============================================================================
// evaluatePulseContext
// ============================================================================

describe('evaluatePulseContext', () => {
  it('returns no signals for clean context', () => {
    const ctx = makeContext();
    const result = evaluatePulseContext(ctx);

    expect(result.shouldCallLLM).toBe(true);
    expect(result.signals).toHaveLength(0);
    expect(result.urgencyScore).toBe(0);
  });

  it('detects stale goals', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [{ id: 'g1', title: 'Learn TypeScript', daysSinceUpdate: 5 }],
        upcoming: [],
      },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.shouldCallLLM).toBe(true);
    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'stale_goals', severity: 'warning' })
    );
  });

  it('detects upcoming deadlines (critical severity)', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [],
        upcoming: [{ id: 'g1', title: 'Ship v1', daysUntilDue: 2 }],
      },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.shouldCallLLM).toBe(true);
    const signal = result.signals.find((s) => s.id === 'upcoming_deadline');
    expect(signal).toBeDefined();
    expect(signal!.severity).toBe('critical');
  });

  it('does NOT detect deadlines more than 3 days out', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [],
        upcoming: [{ id: 'g1', title: 'Ship v2', daysUntilDue: 5 }],
      },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals.find((s) => s.id === 'upcoming_deadline')).toBeUndefined();
  });

  it('detects no user activity', () => {
    const ctx = makeContext({
      activity: { daysSinceLastActivity: 3, hasRecentActivity: false },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.shouldCallLLM).toBe(true);
    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'no_activity', severity: 'info' })
    );
  });

  it('detects low progress goals', () => {
    const ctx = makeContext({
      goals: {
        active: [
          { id: 'g1', title: 'Learn Rust', progress: 5, updatedAt: new Date(), dueDate: null },
        ],
        stale: [],
        upcoming: [],
      },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'low_progress', severity: 'warning' })
    );
  });

  it('detects memory cleanup need', () => {
    const ctx = makeContext({
      memories: { total: 600, recentCount: 10, avgImportance: 0.2 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'memory_cleanup', severity: 'info' })
    );
  });

  it('does NOT flag memory cleanup when importance is fine', () => {
    const ctx = makeContext({
      memories: { total: 600, recentCount: 10, avgImportance: 0.5 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals.find((s) => s.id === 'memory_cleanup')).toBeUndefined();
  });

  it('detects pending approvals', () => {
    const ctx = makeContext({
      systemHealth: { pendingApprovals: 3, triggerErrors: 0 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'pending_approvals', severity: 'warning' })
    );
  });

  it('detects trigger errors above threshold', () => {
    const ctx = makeContext({
      systemHealth: { pendingApprovals: 0, triggerErrors: 5 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: 'trigger_errors', severity: 'warning' })
    );
  });

  it('does NOT flag trigger errors at or below threshold', () => {
    const ctx = makeContext({
      systemHealth: { pendingApprovals: 0, triggerErrors: 2 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.signals.find((s) => s.id === 'trigger_errors')).toBeUndefined();
  });

  it('accumulates urgency score from multiple signals', () => {
    const ctx = makeContext({
      goals: {
        active: [
          { id: 'g1', title: 'Goal', progress: 5, updatedAt: new Date(), dueDate: null },
        ],
        stale: [{ id: 'g2', title: 'Stale Goal', daysSinceUpdate: 5 }],
        upcoming: [{ id: 'g3', title: 'Urgent Goal', daysUntilDue: 1 }],
      },
      systemHealth: { pendingApprovals: 1, triggerErrors: 5 },
    });
    const result = evaluatePulseContext(ctx);

    // Should have multiple signals — stale_goals + upcoming_deadline + low_progress + pending_approvals + trigger_errors
    expect(result.signals.length).toBeGreaterThanOrEqual(4);
    expect(result.urgencyScore).toBeGreaterThan(50);
    expect(result.shouldCallLLM).toBe(true);
  });

  it('caps urgency score at 100', () => {
    // Create a context that would generate a very high raw score
    const ctx = makeContext({
      goals: {
        active: [
          { id: 'g1', title: 'G1', progress: 0, updatedAt: new Date(), dueDate: null },
        ],
        stale: [{ id: 'g2', title: 'G2', daysSinceUpdate: 10 }],
        upcoming: [{ id: 'g3', title: 'G3', daysUntilDue: 1 }],
      },
      activity: { daysSinceLastActivity: 5, hasRecentActivity: false },
      memories: { total: 1000, recentCount: 0, avgImportance: 0.1 },
      systemHealth: { pendingApprovals: 5, triggerErrors: 10 },
    });
    const result = evaluatePulseContext(ctx);

    expect(result.urgencyScore).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// RULE_DEFINITIONS
// ============================================================================

describe('RULE_DEFINITIONS', () => {
  it('exports 8 rule definitions', () => {
    expect(RULE_DEFINITIONS).toHaveLength(8);
  });

  it('each definition has id, label, description, and thresholdKey', () => {
    for (const def of RULE_DEFINITIONS) {
      expect(def.id).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect('thresholdKey' in def).toBe(true);
    }
  });

  it('ids match the signal ids produced by rules', () => {
    const expectedIds = [
      'stale_goals',
      'upcoming_deadline',
      'no_activity',
      'low_progress',
      'memory_cleanup',
      'pending_approvals',
      'trigger_errors',
      'routine_checkin',
    ];
    expect(RULE_DEFINITIONS.map((r) => r.id)).toEqual(expectedIds);
  });

  it('thresholdKey is null for rules without configurable thresholds', () => {
    const noActivity = RULE_DEFINITIONS.find((r) => r.id === 'no_activity');
    const pending = RULE_DEFINITIONS.find((r) => r.id === 'pending_approvals');
    expect(noActivity!.thresholdKey).toBeNull();
    expect(pending!.thresholdKey).toBeNull();
  });

  it('thresholdKey matches RuleThresholds keys for configurable rules', () => {
    const configurable = RULE_DEFINITIONS.filter((r) => r.thresholdKey !== null);
    const validKeys = Object.keys(DEFAULT_RULE_THRESHOLDS);
    for (const def of configurable) {
      expect(validKeys).toContain(def.thresholdKey);
    }
  });
});

// ============================================================================
// disabledRules
// ============================================================================

describe('evaluatePulseContext with disabledRules', () => {
  it('skips disabled rules', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [{ id: 'g1', title: 'Stale', daysSinceUpdate: 5 }],
        upcoming: [],
      },
    });

    // Without disabling — stale_goals should fire
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'stale_goals')).toBeDefined();

    // With disabling — stale_goals should NOT fire
    const result2 = evaluatePulseContext(ctx, ['stale_goals']);
    expect(result2.signals.find((s) => s.id === 'stale_goals')).toBeUndefined();
  });

  it('can disable multiple rules', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [{ id: 'g1', title: 'Stale', daysSinceUpdate: 5 }],
        upcoming: [],
      },
      activity: { daysSinceLastActivity: 3, hasRecentActivity: false },
      memories: { total: 600, recentCount: 10, avgImportance: 0.2 },
    });

    const result = evaluatePulseContext(ctx, ['stale_goals', 'no_activity', 'memory_cleanup']);
    expect(result.signals.find((s) => s.id === 'stale_goals')).toBeUndefined();
    expect(result.signals.find((s) => s.id === 'no_activity')).toBeUndefined();
    expect(result.signals.find((s) => s.id === 'memory_cleanup')).toBeUndefined();
    expect(result.shouldCallLLM).toBe(true);
  });

  it('only disables specified rules, others still fire', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [{ id: 'g1', title: 'Stale', daysSinceUpdate: 5 }],
        upcoming: [{ id: 'g2', title: 'Urgent', daysUntilDue: 1 }],
      },
    });

    const result = evaluatePulseContext(ctx, ['stale_goals']);
    expect(result.signals.find((s) => s.id === 'stale_goals')).toBeUndefined();
    expect(result.signals.find((s) => s.id === 'upcoming_deadline')).toBeDefined();
    expect(result.shouldCallLLM).toBe(true);
  });

  it('empty disabledRules array has no effect', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [{ id: 'g1', title: 'Stale', daysSinceUpdate: 5 }],
        upcoming: [],
      },
    });

    const result = evaluatePulseContext(ctx, []);
    expect(result.signals.find((s) => s.id === 'stale_goals')).toBeDefined();
  });
});

// ============================================================================
// Custom thresholds
// ============================================================================

describe('evaluatePulseContext with custom thresholds', () => {
  it('respects custom deadlineDays threshold', () => {
    const ctx = makeContext({
      goals: {
        active: [],
        stale: [],
        upcoming: [{ id: 'g1', title: 'Ship v1', daysUntilDue: 5 }],
      },
    });

    // Default threshold (3 days) should NOT fire for daysUntilDue=5
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'upcoming_deadline')).toBeUndefined();

    // Custom threshold (7 days) SHOULD fire for daysUntilDue=5
    const custom: RuleThresholds = { ...DEFAULT_RULE_THRESHOLDS, deadlineDays: 7 };
    const result2 = evaluatePulseContext(ctx, [], custom);
    expect(result2.signals.find((s) => s.id === 'upcoming_deadline')).toBeDefined();
  });

  it('respects custom lowProgressPct threshold', () => {
    const ctx = makeContext({
      goals: {
        active: [
          { id: 'g1', title: 'Goal', progress: 15, updatedAt: new Date(), dueDate: null },
        ],
        stale: [],
        upcoming: [],
      },
    });

    // Default threshold (10%) should NOT fire for progress=15
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'low_progress')).toBeUndefined();

    // Custom threshold (20%) SHOULD fire for progress=15
    const custom: RuleThresholds = { ...DEFAULT_RULE_THRESHOLDS, lowProgressPct: 20 };
    const result2 = evaluatePulseContext(ctx, [], custom);
    expect(result2.signals.find((s) => s.id === 'low_progress')).toBeDefined();
  });

  it('respects custom memoryMaxCount threshold', () => {
    const ctx = makeContext({
      memories: { total: 300, recentCount: 10, avgImportance: 0.2 },
    });

    // Default threshold (500) should NOT fire for total=300
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'memory_cleanup')).toBeUndefined();

    // Custom threshold (200) SHOULD fire for total=300
    const custom: RuleThresholds = { ...DEFAULT_RULE_THRESHOLDS, memoryMaxCount: 200 };
    const result2 = evaluatePulseContext(ctx, [], custom);
    expect(result2.signals.find((s) => s.id === 'memory_cleanup')).toBeDefined();
  });

  it('respects custom memoryMinImportance threshold', () => {
    const ctx = makeContext({
      memories: { total: 600, recentCount: 10, avgImportance: 0.25 },
    });

    // Default threshold (0.3) SHOULD fire for avgImportance=0.25
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'memory_cleanup')).toBeDefined();

    // Custom threshold (0.2) should NOT fire for avgImportance=0.25
    const custom: RuleThresholds = { ...DEFAULT_RULE_THRESHOLDS, memoryMinImportance: 0.2 };
    const result2 = evaluatePulseContext(ctx, [], custom);
    expect(result2.signals.find((s) => s.id === 'memory_cleanup')).toBeUndefined();
  });

  it('respects custom triggerErrorMin threshold', () => {
    const ctx = makeContext({
      systemHealth: { pendingApprovals: 0, triggerErrors: 4 },
    });

    // Default threshold (3) SHOULD fire for triggerErrors=4 (>= 3)
    const result1 = evaluatePulseContext(ctx);
    expect(result1.signals.find((s) => s.id === 'trigger_errors')).toBeDefined();

    // Custom threshold (5) should NOT fire for triggerErrors=4
    const custom: RuleThresholds = { ...DEFAULT_RULE_THRESHOLDS, triggerErrorMin: 5 };
    const result2 = evaluatePulseContext(ctx, [], custom);
    expect(result2.signals.find((s) => s.id === 'trigger_errors')).toBeUndefined();
  });
});

// ============================================================================
// calculateNextInterval
// ============================================================================

describe('calculateNextInterval', () => {
  const MIN = 5 * 60_000; // 5 min
  const MAX = 15 * 60_000; // 15 min

  it('returns max interval for urgency 0', () => {
    expect(calculateNextInterval(0, MIN, MAX)).toBe(MAX);
  });

  it('returns min interval for urgency 100', () => {
    expect(calculateNextInterval(100, MIN, MAX)).toBe(MIN);
  });

  it('returns midpoint for urgency 50', () => {
    const mid = calculateNextInterval(50, MIN, MAX);
    expect(mid).toBe(Math.round((MIN + MAX) / 2));
  });

  it('clamps negative urgency to 0', () => {
    expect(calculateNextInterval(-10, MIN, MAX)).toBe(MAX);
  });

  it('clamps urgency above 100', () => {
    expect(calculateNextInterval(150, MIN, MAX)).toBe(MIN);
  });
});

/**
 * Tests for ClawMetricsCollector
 *
 * Covers: recording cycles, rolling averages, buildMetrics,
 * getRollingAverages, reset, and edge cases (empty windows,
 * zero/missing values).
 */

import { describe, it, expect, vi } from 'vitest';
import { GET_LOG_MOCK } from '../../test-helpers.js';

vi.mock('../../services/get-log.js', () => GET_LOG_MOCK);

// Need to mock safe-value since it uses crypto.randomInt
vi.mock('../../utils/safe-value.js', () => ({
  safeDuration: (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
    return Math.floor(v);
  },
  safeCost: (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
    return v;
  },
}));

const { ClawMetricsCollector } = await import('./claw-metrics.js');

import type { ClawCycleSummary, ClawCircuitSnapshot } from './claw-types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeSummary(overrides: Partial<ClawCycleSummary> = {}): ClawCycleSummary {
  return {
    clawId: 'claw-1',
    cycleNumber: 1,
    success: true,
    durationMs: 1000,
    costUsd: 0.005,
    toolCallsCount: 3,
    consecutiveErrors: 0,
    totalCostUsd: 0.05,
    state: 'running' as const,
    error: null,
    ...overrides,
  };
}

function makeCircuitSnap(overrides: Partial<ClawCircuitSnapshot> = {}): ClawCircuitSnapshot {
  return {
    state: 'closed',
    failureCount: 0,
    lastFailureAt: 0,
    nextAttemptAt: 0,
    consecutiveSuccesses: 0,
    ...overrides,
  };
}

// ============================================================================
// Constructor
// ============================================================================

describe('ClawMetricsCollector constructor', () => {
  it('defaults rollingWindowSize to 10', () => {
    const c = new ClawMetricsCollector();
    expect(c['windowSize']).toBe(10);
  });

  it('accepts custom rollingWindowSize', () => {
    const c = new ClawMetricsCollector({ rollingWindowSize: 5 });
    expect(c['windowSize']).toBe(5);
  });
});

// ============================================================================
// recordCycle
// ============================================================================

describe('ClawMetricsCollector.recordCycle()', () => {
  it('records a cycle duration', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 500 }));
    expect(c['cycleDurations']).toEqual([500]);
  });

  it('records a cycle cost', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ costUsd: 0.01 }));
    expect(c['cycleCosts']).toEqual([0.01]);
  });

  it('skips duration when value is 0', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 0 }));
    expect(c['cycleDurations']).toHaveLength(0);
  });

  it('skips duration when value is negative', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: -100 }));
    expect(c['cycleDurations']).toHaveLength(0);
  });

  it('skips cost when value is 0', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ costUsd: 0 }));
    expect(c['cycleCosts']).toHaveLength(0);
  });

  it('skips cost when value is negative', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ costUsd: -0.01 }));
    expect(c['cycleCosts']).toHaveLength(0);
  });

  it('respects rolling window size (duration)', () => {
    const c = new ClawMetricsCollector({ rollingWindowSize: 3 });
    for (let i = 0; i < 5; i++) {
      c.recordCycle(makeSummary({ durationMs: 100 * (i + 1) }));
    }
    expect(c['cycleDurations']).toHaveLength(3);
    // Oldest entries have been shifted out
    expect(c['cycleDurations']).toEqual([300, 400, 500]);
  });

  it('respects rolling window size (cost)', () => {
    const c = new ClawMetricsCollector({ rollingWindowSize: 2 });
    for (let i = 0; i < 4; i++) {
      c.recordCycle(makeSummary({ costUsd: 0.01 * (i + 1) }));
    }
    expect(c['cycleCosts']).toHaveLength(2);
    expect(c['cycleCosts']).toEqual([0.03, 0.04]);
  });
});

// ============================================================================
// buildMetrics
// ============================================================================

describe('ClawMetricsCollector.buildMetrics()', () => {
  it('builds metrics with zero averages when no cycles recorded', () => {
    const c = new ClawMetricsCollector();
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary());
    expect(m.clawId).toBe('claw-1');
    expect(m.avgCycleDurationMs).toBe(0);
    expect(m.avgCycleCost).toBe(0);
    expect(m.cycleCost).toBe(0.005);
  });

  it('computes rolling average duration', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 200 }));
    c.recordCycle(makeSummary({ durationMs: 400 }));
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary());
    expect(m.avgCycleDurationMs).toBe(300); // (200 + 400) / 2
  });

  it('computes rolling average cost', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ costUsd: 0.01 }));
    c.recordCycle(makeSummary({ costUsd: 0.03 }));
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary({ costUsd: 0.02 }));
    expect(m.avgCycleCost).toBe(0.02); // (0.01 + 0.03) / 2
  });

  it('includes circuit snapshot', () => {
    const c = new ClawMetricsCollector();
    const circ = makeCircuitSnap({ state: 'open', failureCount: 3 });
    const m = c.buildMetrics('claw-1', circ, makeSummary());
    expect(m.circuitState.state).toBe('open');
    expect(m.circuitState.failureCount).toBe(3);
  });

  it('includes cycle summary fields', () => {
    const c = new ClawMetricsCollector();
    const summary = makeSummary({
      state: 'completed',
      consecutiveErrors: 2,
      costUsd: 0.015,
      totalCostUsd: 0.1,
    });
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), summary);
    expect(m.state).toBe('completed');
    expect(m.consecutiveErrors).toBe(2);
    expect(m.cycleCost).toBe(0.015);
    expect(m.totalCostUsd).toBe(0.1);
  });

  it('sets lastCycleAt to current date', () => {
    const c = new ClawMetricsCollector();
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary());
    expect(m.lastCycleAt).toBeInstanceOf(Date);
  });

  it('sets lastCycleError to null', () => {
    const c = new ClawMetricsCollector();
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary());
    expect(m.lastCycleError).toBeNull();
  });

  it('cyclesCompleted is always 0 (filled by PulseMetricsService)', () => {
    const c = new ClawMetricsCollector();
    const m = c.buildMetrics('claw-1', makeCircuitSnap(), makeSummary());
    expect(m.cyclesCompleted).toBe(0);
  });
});

// ============================================================================
// getRollingAverages
// ============================================================================

describe('ClawMetricsCollector.getRollingAverages()', () => {
  it('returns zero averages when no cycles recorded', () => {
    const c = new ClawMetricsCollector();
    const avg = c.getRollingAverages();
    expect(avg.avgDurationMs).toBe(0);
    expect(avg.avgCost).toBe(0);
  });

  it('returns computed averages', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 100, costUsd: 0.01 }));
    c.recordCycle(makeSummary({ durationMs: 300, costUsd: 0.03 }));
    const avg = c.getRollingAverages();
    expect(avg.avgDurationMs).toBe(200);
    expect(avg.avgCost).toBe(0.02);
  });

  it('works after reset', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 100 }));
    c.reset();
    const avg = c.getRollingAverages();
    expect(avg.avgDurationMs).toBe(0);
    expect(avg.avgCost).toBe(0);
  });
});

// ============================================================================
// reset
// ============================================================================

describe('ClawMetricsCollector.reset()', () => {
  it('clears all recorded cycles', () => {
    const c = new ClawMetricsCollector();
    c.recordCycle(makeSummary({ durationMs: 100, costUsd: 0.01 }));
    c.recordCycle(makeSummary({ durationMs: 200, costUsd: 0.02 }));
    c.reset();
    expect(c['cycleDurations']).toHaveLength(0);
    expect(c['cycleCosts']).toHaveLength(0);
  });
});

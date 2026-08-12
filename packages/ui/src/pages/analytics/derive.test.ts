/**
 * Tests for the analytics chart-series derivations and formatters.
 *
 * All of this was inline in AnalyticsPage.tsx, reachable only by rendering the
 * page. The caps (top 8 providers, top 6 models), the "> 0" filters and the
 * rounding rules are product decisions that were previously unpinned.
 */

import { describe, it, expect } from 'vitest';
import { fmtCost, fmtTokens, shortDate } from './format';
import {
  toDailySeries,
  toProviderDonut,
  toProviderRequests,
  toModelCostSeries,
  toCountSeries,
  toAgentBars,
  toTaskProgress,
  type CostsBreakdown,
} from './derive';

function breakdown(over: Partial<CostsBreakdown> = {}): CostsBreakdown {
  return { byProvider: [], byModel: [], daily: [], totalCost: 0, ...over } as CostsBreakdown;
}

const provider = (name: string, cost: number, requests = 1) =>
  ({ provider: name, cost, requests, inputTokens: 10, outputTokens: 20 }) as never;

describe('format', () => {
  describe('fmtCost', () => {
    it('uses two decimals at or above $1', () => {
      expect(fmtCost(12.345)).toBe('$12.35');
      expect(fmtCost(1)).toBe('$1.00');
    });

    it('uses three decimals between 1c and $1', () => {
      expect(fmtCost(0.5)).toBe('$0.500');
      expect(fmtCost(0.01)).toBe('$0.010');
    });

    it('uses four decimals below a cent, where most per-model spend lands', () => {
      expect(fmtCost(0.0001)).toBe('$0.0001');
      expect(fmtCost(0)).toBe('$0.0000');
    });
  });

  describe('fmtTokens', () => {
    it('abbreviates millions and thousands', () => {
      expect(fmtTokens(2_500_000)).toBe('2.5M');
      expect(fmtTokens(1_500)).toBe('1.5K');
    });

    it('leaves small counts alone', () => {
      expect(fmtTokens(999)).toBe('999');
      expect(fmtTokens(0)).toBe('0');
    });

    it('switches unit exactly at the boundary', () => {
      expect(fmtTokens(1_000)).toBe('1.0K');
      expect(fmtTokens(1_000_000)).toBe('1.0M');
    });
  });

  it('shortDate renders month/day', () => {
    expect(shortDate('2026-08-12T10:00:00Z')).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });
});

describe('toDailySeries', () => {
  it('sums input and output into a tokens field', () => {
    const out = toDailySeries(
      breakdown({
        daily: [{ date: '2026-08-12T00:00:00Z', inputTokens: 100, outputTokens: 50 }] as never,
      })
    );
    expect(out[0]!.tokens).toBe(150);
  });

  it('is empty for null', () => {
    expect(toDailySeries(null)).toEqual([]);
  });
});

describe('toProviderDonut', () => {
  it('drops zero-cost providers and rounds to cents', () => {
    const out = toProviderDonut(
      breakdown({ byProvider: [provider('a', 1.239), provider('b', 0)] })
    );
    expect(out).toEqual([{ name: 'a', value: 1.24 }]);
  });
});

describe('toProviderRequests', () => {
  it('caps at 8 providers', () => {
    const many = Array.from({ length: 12 }, (_, i) => provider(`p${i}`, 1, 5));
    expect(toProviderRequests(breakdown({ byProvider: many }))).toHaveLength(8);
  });

  it('drops providers with no requests', () => {
    const out = toProviderRequests(
      breakdown({ byProvider: [provider('a', 1, 0), provider('b', 1, 3)] })
    );
    expect(out.map((p) => p.name)).toEqual(['b']);
  });
});

describe('toModelCostSeries', () => {
  it('caps at 6 models and keeps four decimals', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...(provider(`m${i}`, 0.00012345) as object),
      model: `model-${i}`,
    }));
    const out = toModelCostSeries(breakdown({ byModel: many as never }));
    expect(out).toHaveLength(6);
    expect(out[0]!.cost).toBe(0.0001);
  });

  it('falls back to the provider name when the model is unnamed', () => {
    const out = toModelCostSeries(breakdown({ byModel: [provider('anthropic', 1)] as never }));
    expect(out[0]!.name).toBe('anthropic');
  });
});

describe('toCountSeries', () => {
  it('drops zero counts', () => {
    expect(toCountSeries({ running: 2, idle: 0 })).toEqual([{ name: 'running', value: 2 }]);
  });

  it('is empty when undefined', () => {
    expect(toCountSeries(undefined)).toEqual([]);
  });
});

describe('toAgentBars', () => {
  it('emits one bar per agent kind', () => {
    const out = toAgentBars({ souls: 1, claws: 2, workflows: 3 });
    expect(out.map((b) => b.count)).toEqual([1, 2, 3]);
  });
});

describe('toTaskProgress', () => {
  it('computes a rounded completion percentage', () => {
    const out = toTaskProgress({
      tasks: { completed: 1, pending: 2, overdue: 0, total: 3 },
    } as never);
    expect(out!.pct).toBe(33);
  });

  it('reports 0% rather than NaN when there are no tasks', () => {
    // A fresh install has an empty task list; completed/total would divide by zero.
    const out = toTaskProgress({
      tasks: { completed: 0, pending: 0, overdue: 0, total: 0 },
    } as never);
    expect(out!.pct).toBe(0);
  });

  it('is null without a summary', () => {
    expect(toTaskProgress(null)).toBeNull();
  });
});

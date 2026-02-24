import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

import { GET_LOG_MOCK } from '../test-helpers.js';

vi.mock('../services/get-log.js', () => GET_LOG_MOCK);

let idCounter = 0;
vi.mock('../services/id-utils.js', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test_${++idCounter}`),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  MODEL_PRICING,
  getModelPricing,
  calculateCost,
  estimateCost,
  formatCost,
  formatTokens,
  UsageTracker,
  BudgetManager,
  generateRecommendations,
  createUsageTracker,
  createBudgetManager,
  getUsageTracker,
  getBudgetManager,
} from './index.js';
import type {
  AIProvider,
  UsageRecord,
  BudgetConfig as _BudgetConfig,
  ModelPricing as _ModelPricing,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsage(
  overrides: Partial<Omit<UsageRecord, 'id' | 'timestamp' | 'cost'>> = {}
): Omit<UsageRecord, 'id' | 'timestamp' | 'cost'> {
  return {
    userId: 'user-1',
    provider: 'openai' as AIProvider,
    model: 'gpt-4o',
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    latencyMs: 200,
    requestType: 'chat' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MODEL_PRICING
// ---------------------------------------------------------------------------

describe('MODEL_PRICING', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(MODEL_PRICING)).toBe(true);
    expect(MODEL_PRICING.length).toBeGreaterThanOrEqual(30);
  });

  it('contains all expected providers', () => {
    const providers = new Set(MODEL_PRICING.map((p) => p.provider));
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('google');
    expect(providers).toContain('deepseek');
    expect(providers).toContain('groq');
    expect(providers).toContain('mistral');
    expect(providers).toContain('xai');
    expect(providers).toContain('local');
  });

  it('all entries have required fields', () => {
    for (const entry of MODEL_PRICING) {
      expect(entry.provider).toBeTruthy();
      expect(typeof entry.modelId).toBe('string');
      expect(entry.modelId.length).toBeGreaterThan(0);
      expect(typeof entry.displayName).toBe('string');
      expect(typeof entry.inputPricePerMillion).toBe('number');
      expect(typeof entry.outputPricePerMillion).toBe('number');
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.maxOutput).toBeGreaterThan(0);
      expect(typeof entry.updatedAt).toBe('string');
    }
  });

  it('local model has zero pricing', () => {
    const local = MODEL_PRICING.find((p) => p.provider === 'local');
    expect(local).toBeDefined();
    expect(local!.inputPricePerMillion).toBe(0);
    expect(local!.outputPricePerMillion).toBe(0);
  });

  it('contains specific expected models', () => {
    const modelIds = MODEL_PRICING.map((p) => p.modelId);
    expect(modelIds).toContain('gpt-5');
    expect(modelIds).toContain('gpt-4o');
    expect(modelIds).toContain('claude-4.5-opus');
    expect(modelIds).toContain('claude-4.5-sonnet');
    expect(modelIds).toContain('gemini-2.5-pro');
    expect(modelIds).toContain('deepseek-r1');
    expect(modelIds).toContain('grok-4');
    expect(modelIds).toContain('mistral-large-3');
  });

  it('non-local models have positive pricing', () => {
    const nonLocal = MODEL_PRICING.filter((p) => p.provider !== 'local');
    for (const entry of nonLocal) {
      expect(entry.inputPricePerMillion).toBeGreaterThan(0);
      expect(entry.outputPricePerMillion).toBeGreaterThan(0);
    }
  });

  it('output price is >= input price for all models', () => {
    for (const entry of MODEL_PRICING) {
      expect(entry.outputPricePerMillion).toBeGreaterThanOrEqual(entry.inputPricePerMillion);
    }
  });
});

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe('getModelPricing', () => {
  it('returns exact match for known model', () => {
    const result = getModelPricing('openai', 'gpt-5');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('gpt-5');
    expect(result!.provider).toBe('openai');
  });

  it('returns exact match for gpt-4o', () => {
    const result = getModelPricing('openai', 'gpt-4o');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('gpt-4o');
    expect(result!.inputPricePerMillion).toBe(2.5);
    expect(result!.outputPricePerMillion).toBe(10.0);
  });

  it('returns exact match for claude-4.5-opus', () => {
    const result = getModelPricing('anthropic', 'claude-4.5-opus');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('claude-4.5-opus');
  });

  it('returns partial match for versioned models', () => {
    // claude-3-5-sonnet-20241022 should match claude-3-5-sonnet
    const result = getModelPricing('anthropic', 'claude-3-5-sonnet-20241022');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('claude-3-5-sonnet');
  });

  it('falls back to provider first model for unknown model', () => {
    const result = getModelPricing('openai', 'unknown-future-model');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('openai');
    // Should be the first openai entry (gpt-5)
    expect(result!.modelId).toBe('gpt-5');
  });

  it('returns null for unknown provider with no entries', () => {
    const result = getModelPricing('custom' as AIProvider, 'anything');
    expect(result).toBeNull();
  });

  it('returns correct pricing for local model', () => {
    const result = getModelPricing('local', 'local-model');
    expect(result).not.toBeNull();
    expect(result!.inputPricePerMillion).toBe(0);
    expect(result!.outputPricePerMillion).toBe(0);
  });

  it('returns correct pricing for deepseek models', () => {
    const result = getModelPricing('deepseek', 'deepseek-r1');
    expect(result).not.toBeNull();
    expect(result!.inputPricePerMillion).toBe(3.0);
    expect(result!.outputPricePerMillion).toBe(7.0);
  });

  it('returns correct pricing for groq models', () => {
    const result = getModelPricing('groq', 'llama-3.3-70b-versatile');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('groq');
  });

  it('returns correct pricing for xai models', () => {
    const result = getModelPricing('xai', 'grok-4');
    expect(result).not.toBeNull();
    expect(result!.inputPricePerMillion).toBe(3.0);
  });

  it('returns correct pricing for mistral models', () => {
    const result = getModelPricing('mistral', 'mistral-large-3');
    expect(result).not.toBeNull();
    expect(result!.inputPricePerMillion).toBe(2.0);
  });

  it('falls back to provider for unknown google model', () => {
    const result = getModelPricing('google', 'gemini-99-turbo');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('google');
  });
});

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe('calculateCost', () => {
  it('returns 0 for zero tokens', () => {
    expect(calculateCost('openai', 'gpt-4o', 0, 0)).toBe(0);
  });

  it('calculates correct cost for known model', () => {
    // gpt-4o: input $2.50/M, output $10.00/M
    const cost = calculateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 10.0, 6);
  });

  it('calculates correct cost for fractional token counts', () => {
    // gpt-4o: input $2.50/M, output $10.00/M
    // 1000 input = $0.0025, 500 output = $0.005
    const cost = calculateCost('openai', 'gpt-4o', 1000, 500);
    expect(cost).toBeCloseTo(0.0025 + 0.005, 8);
  });

  it('returns 0 for unknown provider with no pricing', () => {
    const cost = calculateCost('custom' as AIProvider, 'anything', 1000, 1000);
    expect(cost).toBe(0);
  });

  it('returns 0 cost for local model', () => {
    const cost = calculateCost('local', 'local-model', 100_000, 50_000);
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    const cost = calculateCost('openai', 'gpt-4o', 10_000_000, 5_000_000);
    // input: 10M * 2.5/M = 25, output: 5M * 10/M = 50
    expect(cost).toBeCloseTo(75, 4);
  });

  it('handles only input tokens', () => {
    const cost = calculateCost('openai', 'gpt-4o', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 6);
  });

  it('handles only output tokens', () => {
    const cost = calculateCost('openai', 'gpt-4o', 0, 1_000_000);
    expect(cost).toBeCloseTo(10.0, 6);
  });

  it('calculates correct cost for anthropic model', () => {
    // claude-4.5-opus: input $5.00/M, output $25.00/M
    const cost = calculateCost('anthropic', 'claude-4.5-opus', 2000, 1000);
    expect(cost).toBeCloseTo((2000 / 1_000_000) * 5.0 + (1000 / 1_000_000) * 25.0, 8);
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe('estimateCost', () => {
  it('estimates cost from text length', () => {
    const text = 'a'.repeat(4000); // 4000 chars ≈ 1000 tokens
    const estimate = estimateCost('openai', 'gpt-4o', text);

    expect(estimate.provider).toBe('openai');
    expect(estimate.model).toBe('gpt-4o');
    expect(estimate.estimatedInputTokens).toBe(1000);
    expect(estimate.estimatedOutputTokens).toBe(500); // default
    expect(estimate.withinBudget).toBe(true);
  });

  it('uses custom output token estimate', () => {
    const text = 'a'.repeat(400); // 100 tokens
    const estimate = estimateCost('openai', 'gpt-4o', text, 1000);

    expect(estimate.estimatedInputTokens).toBe(100);
    expect(estimate.estimatedOutputTokens).toBe(1000);
  });

  it('calculates correct estimated cost', () => {
    // gpt-4o: input $2.50/M, output $10.00/M
    const text = 'a'.repeat(4_000_000); // 1M input tokens
    const estimate = estimateCost('openai', 'gpt-4o', text, 1_000_000);

    // 1M * 2.5/M + 1M * 10/M = 12.5
    expect(estimate.estimatedCost).toBeCloseTo(12.5, 4);
  });

  it('rounds up input tokens', () => {
    const text = 'abc'; // 3 chars → ceil(3/4) = 1 token
    const estimate = estimateCost('openai', 'gpt-4o', text);
    expect(estimate.estimatedInputTokens).toBe(1);
  });

  it('handles empty text', () => {
    const estimate = estimateCost('openai', 'gpt-4o', '');
    expect(estimate.estimatedInputTokens).toBe(0);
  });

  it('returns correct fields', () => {
    const estimate = estimateCost('anthropic', 'claude-4.5-sonnet', 'Hello world');
    expect(estimate).toHaveProperty('provider');
    expect(estimate).toHaveProperty('model');
    expect(estimate).toHaveProperty('estimatedInputTokens');
    expect(estimate).toHaveProperty('estimatedOutputTokens');
    expect(estimate).toHaveProperty('estimatedCost');
    expect(estimate).toHaveProperty('withinBudget');
  });
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

describe('formatCost', () => {
  it('formats zero as $0.000000', () => {
    expect(formatCost(0)).toBe('$0.000000');
  });

  it('formats very small cost (< 0.01) with 6 decimal places', () => {
    expect(formatCost(0.001234)).toBe('$0.001234');
  });

  it('formats small cost (0.01 to <1) with 4 decimal places', () => {
    expect(formatCost(0.0123)).toBe('$0.0123');
    expect(formatCost(0.5)).toBe('$0.5000');
    expect(formatCost(0.99)).toBe('$0.9900');
  });

  it('formats cost >= 1 with 2 decimal places', () => {
    expect(formatCost(1.0)).toBe('$1.00');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(100)).toBe('$100.00');
  });

  it('formats exactly 0.01 with 4 decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.0100');
  });

  it('formats 0.009999 with 6 decimal places', () => {
    expect(formatCost(0.009999)).toBe('$0.009999');
  });

  it('handles non-USD currency via Intl', () => {
    const result = formatCost(10.5, 'EUR');
    // Intl formatting varies by locale, but should contain 10.50
    expect(result).toContain('10.50');
  });

  it('handles non-USD currency for small amounts', () => {
    const result = formatCost(0.001, 'GBP');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

describe('formatTokens', () => {
  it('formats 0 as "0"', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('formats small numbers raw', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats exactly 1000 as "1.0K"', () => {
    expect(formatTokens(1000)).toBe('1.0K');
  });

  it('formats thousands with one decimal', () => {
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(10000)).toBe('10.0K');
    expect(formatTokens(999999)).toBe('1000.0K');
  });

  it('formats 1M as "1.00M"', () => {
    expect(formatTokens(1_000_000)).toBe('1.00M');
  });

  it('formats large numbers in millions', () => {
    expect(formatTokens(1_500_000)).toBe('1.50M');
    expect(formatTokens(10_000_000)).toBe('10.00M');
  });

  it('formats 2500 as "2.5K"', () => {
    expect(formatTokens(2500)).toBe('2.5K');
  });
});

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    idCounter = 0;
    tracker = new UsageTracker();
  });

  describe('initialize', () => {
    it('sets initialized flag', async () => {
      await tracker.initialize();
      // Should not throw on subsequent operations
      const records = await tracker.getUsage(new Date(0));
      expect(records).toEqual([]);
    });
  });

  describe('record', () => {
    it('returns a record with auto-generated id, timestamp, and cost', async () => {
      const usage = makeUsage();
      const record = await tracker.record(usage);

      expect(record.id).toMatch(/^usage_test_/);
      expect(record.timestamp).toBeTruthy();
      expect(typeof record.cost).toBe('number');
      expect(record.userId).toBe('user-1');
      expect(record.provider).toBe('openai');
      expect(record.model).toBe('gpt-4o');
    });

    it('calculates cost correctly', async () => {
      // gpt-4o: input $2.50/M, output $10.00/M
      const record = await tracker.record(
        makeUsage({
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        })
      );
      expect(record.cost).toBeCloseTo(12.5, 4);
    });

    it('emits usage event', async () => {
      const spy = vi.fn();
      tracker.on('usage', spy);

      const record = await tracker.record(makeUsage());

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(record);
    });

    it('auto-initializes on first record', async () => {
      // Do not call initialize() first
      const record = await tracker.record(makeUsage());
      expect(record.id).toBeTruthy();
    });

    it('preserves optional fields', async () => {
      const record = await tracker.record(
        makeUsage({
          sessionId: 'session-1',
          cached: true,
          error: 'timeout',
          metadata: { foo: 'bar' },
        })
      );
      expect(record.sessionId).toBe('session-1');
      expect(record.cached).toBe(true);
      expect(record.error).toBe('timeout');
      expect(record.metadata).toEqual({ foo: 'bar' });
    });

    it('caps records at MAX_RECORDS (10000)', async () => {
      // Push 10001 records
      const promises: Promise<UsageRecord>[] = [];
      for (let i = 0; i < 10_001; i++) {
        promises.push(tracker.record(makeUsage()));
      }
      await Promise.all(promises);

      // Access all records via getUsage from epoch
      const all = await tracker.getUsage(new Date(0));
      expect(all.length).toBeLessThanOrEqual(10_000);
    });
  });

  describe('getUsage', () => {
    it('returns empty array when no records', async () => {
      const records = await tracker.getUsage(new Date(0));
      expect(records).toEqual([]);
    });

    it('filters by date range', async () => {
      const now = new Date();
      await tracker.record(makeUsage());

      const pastDate = new Date(now.getTime() - 60_000);
      const futureDate = new Date(now.getTime() + 60_000);

      const inRange = await tracker.getUsage(pastDate, futureDate);
      expect(inRange.length).toBe(1);

      const outOfRange = await tracker.getUsage(new Date('2020-01-01'), new Date('2020-12-31'));
      expect(outOfRange.length).toBe(0);
    });

    it('filters by userId', async () => {
      await tracker.record(makeUsage({ userId: 'alice' }));
      await tracker.record(makeUsage({ userId: 'bob' }));

      const aliceRecords = await tracker.getUsage(new Date(0), new Date(), { userId: 'alice' });
      expect(aliceRecords.length).toBe(1);
      expect(aliceRecords[0]!.userId).toBe('alice');
    });

    it('filters by provider', async () => {
      await tracker.record(makeUsage({ provider: 'openai' }));
      await tracker.record(makeUsage({ provider: 'anthropic', model: 'claude-4.5-sonnet' }));

      const openaiRecords = await tracker.getUsage(new Date(0), new Date(), { provider: 'openai' });
      expect(openaiRecords.length).toBe(1);
      expect(openaiRecords[0]!.provider).toBe('openai');
    });

    it('filters by model', async () => {
      await tracker.record(makeUsage({ model: 'gpt-4o' }));
      await tracker.record(makeUsage({ model: 'gpt-5' }));

      const records = await tracker.getUsage(new Date(0), new Date(), { model: 'gpt-5' });
      expect(records.length).toBe(1);
      expect(records[0]!.model).toBe('gpt-5');
    });

    it('combines multiple filters', async () => {
      await tracker.record(makeUsage({ userId: 'alice', provider: 'openai', model: 'gpt-4o' }));
      await tracker.record(
        makeUsage({ userId: 'alice', provider: 'anthropic', model: 'claude-4.5-sonnet' })
      );
      await tracker.record(makeUsage({ userId: 'bob', provider: 'openai', model: 'gpt-4o' }));

      const records = await tracker.getUsage(new Date(0), new Date(), {
        userId: 'alice',
        provider: 'openai',
      });
      expect(records.length).toBe(1);
      expect(records[0]!.userId).toBe('alice');
      expect(records[0]!.provider).toBe('openai');
    });

    it('defaults endDate to now', async () => {
      await tracker.record(makeUsage());

      const records = await tracker.getUsage(new Date(0));
      expect(records.length).toBe(1);
    });
  });

  describe('getSummary', () => {
    it('returns all-zero summary for empty records', async () => {
      const summary = await tracker.getSummary(new Date(0));

      expect(summary.totalRequests).toBe(0);
      expect(summary.successfulRequests).toBe(0);
      expect(summary.failedRequests).toBe(0);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.averageLatencyMs).toBe(0);
      expect(summary.daily).toEqual([]);
    });

    it('computes totals correctly', async () => {
      await tracker.record(makeUsage({ inputTokens: 1000, outputTokens: 500, latencyMs: 100 }));
      await tracker.record(makeUsage({ inputTokens: 2000, outputTokens: 1000, latencyMs: 300 }));

      const summary = await tracker.getSummary(new Date(0));

      expect(summary.totalRequests).toBe(2);
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.averageLatencyMs).toBe(200);
    });

    it('counts successful and failed requests', async () => {
      await tracker.record(makeUsage());
      await tracker.record(makeUsage({ error: 'rate_limit' }));
      await tracker.record(makeUsage({ error: 'timeout' }));

      const summary = await tracker.getSummary(new Date(0));
      expect(summary.successfulRequests).toBe(1);
      expect(summary.failedRequests).toBe(2);
    });

    it('builds byProvider breakdown', async () => {
      await tracker.record(makeUsage({ provider: 'openai', model: 'gpt-4o', latencyMs: 100 }));
      await tracker.record(makeUsage({ provider: 'openai', model: 'gpt-4o', latencyMs: 200 }));
      await tracker.record(
        makeUsage({
          provider: 'anthropic',
          model: 'claude-4.5-sonnet',
          latencyMs: 300,
        })
      );

      const summary = await tracker.getSummary(new Date(0));

      expect(summary.byProvider['openai']).toBeDefined();
      expect(summary.byProvider['openai']!.requests).toBe(2);
      expect(summary.byProvider['openai']!.averageLatencyMs).toBe(150);

      expect(summary.byProvider['anthropic']).toBeDefined();
      expect(summary.byProvider['anthropic']!.requests).toBe(1);
    });

    it('builds byModel breakdown', async () => {
      await tracker.record(makeUsage({ model: 'gpt-4o', inputTokens: 500 }));
      await tracker.record(makeUsage({ model: 'gpt-4o', inputTokens: 700 }));
      await tracker.record(makeUsage({ model: 'gpt-5', inputTokens: 1000 }));

      const summary = await tracker.getSummary(new Date(0));

      expect(summary.byModel['gpt-4o']).toBeDefined();
      expect(summary.byModel['gpt-4o']!.requests).toBe(2);
      expect(summary.byModel['gpt-4o']!.inputTokens).toBe(1200);
      expect(summary.byModel['gpt-4o']!.provider).toBe('openai');

      expect(summary.byModel['gpt-5']).toBeDefined();
      expect(summary.byModel['gpt-5']!.requests).toBe(1);
    });

    it('builds byUser breakdown', async () => {
      await tracker.record(makeUsage({ userId: 'alice', inputTokens: 1000, outputTokens: 500 }));
      await tracker.record(makeUsage({ userId: 'bob', inputTokens: 2000, outputTokens: 1000 }));

      const summary = await tracker.getSummary(new Date(0));

      expect(summary.byUser['alice']).toBeDefined();
      expect(summary.byUser['bob']).toBeDefined();
      expect(typeof summary.byUser['alice']).toBe('number');
      expect(summary.byUser['bob']! > summary.byUser['alice']!).toBe(true);
    });

    it('builds daily breakdown sorted by date', async () => {
      await tracker.record(makeUsage());
      await tracker.record(makeUsage());

      const summary = await tracker.getSummary(new Date(0));

      expect(summary.daily.length).toBeGreaterThanOrEqual(1);
      const today = new Date().toISOString().split('T')[0]!;
      expect(summary.daily[0]!.date).toBe(today);
      expect(summary.daily[0]!.requests).toBe(2);
    });

    it('filters by userId', async () => {
      await tracker.record(makeUsage({ userId: 'alice' }));
      await tracker.record(makeUsage({ userId: 'bob' }));

      const summary = await tracker.getSummary(new Date(0), new Date(), 'alice');
      expect(summary.totalRequests).toBe(1);
    });

    it('sets periodStart and periodEnd', async () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-12-31');
      const summary = await tracker.getSummary(start, end);

      expect(summary.periodStart).toBe(start.toISOString());
      expect(summary.periodEnd).toBe(end.toISOString());
    });
  });

  describe('getTodayUsage', () => {
    it('returns summary for today', async () => {
      await tracker.record(makeUsage());

      const summary = await tracker.getTodayUsage();
      expect(summary.totalRequests).toBe(1);

      // periodStart should be midnight today
      const periodStart = new Date(summary.periodStart);
      expect(periodStart.getHours()).toBe(0);
      expect(periodStart.getMinutes()).toBe(0);
      expect(periodStart.getSeconds()).toBe(0);
    });

    it('filters by userId', async () => {
      await tracker.record(makeUsage({ userId: 'alice' }));
      await tracker.record(makeUsage({ userId: 'bob' }));

      const summary = await tracker.getTodayUsage('alice');
      expect(summary.totalRequests).toBe(1);
    });
  });

  describe('getWeekUsage', () => {
    it('returns summary for this week', async () => {
      await tracker.record(makeUsage());

      const summary = await tracker.getWeekUsage();
      expect(summary.totalRequests).toBe(1);
    });

    it('filters by userId', async () => {
      await tracker.record(makeUsage({ userId: 'alice' }));
      await tracker.record(makeUsage({ userId: 'bob' }));

      const summary = await tracker.getWeekUsage('alice');
      expect(summary.totalRequests).toBe(1);
    });
  });

  describe('getMonthUsage', () => {
    it('returns summary for this month', async () => {
      await tracker.record(makeUsage());

      const summary = await tracker.getMonthUsage();
      expect(summary.totalRequests).toBe(1);
    });

    it('filters by userId', async () => {
      await tracker.record(makeUsage({ userId: 'alice' }));
      await tracker.record(makeUsage({ userId: 'bob' }));

      const summary = await tracker.getMonthUsage('alice');
      expect(summary.totalRequests).toBe(1);
    });
  });

  describe('getMostExpensiveRequests', () => {
    it('returns records sorted by cost descending', async () => {
      await tracker.record(makeUsage({ inputTokens: 100, outputTokens: 50 }));
      await tracker.record(makeUsage({ inputTokens: 10_000, outputTokens: 5_000 }));
      await tracker.record(makeUsage({ inputTokens: 1_000, outputTokens: 500 }));

      const expensive = await tracker.getMostExpensiveRequests();

      expect(expensive.length).toBe(3);
      expect(expensive[0]!.cost).toBeGreaterThanOrEqual(expensive[1]!.cost);
      expect(expensive[1]!.cost).toBeGreaterThanOrEqual(expensive[2]!.cost);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await tracker.record(makeUsage());
      }

      const expensive = await tracker.getMostExpensiveRequests(2);
      expect(expensive.length).toBe(2);
    });

    it('defaults limit to 10', async () => {
      for (let i = 0; i < 15; i++) {
        await tracker.record(makeUsage());
      }

      const expensive = await tracker.getMostExpensiveRequests();
      expect(expensive.length).toBe(10);
    });

    it('filters by startDate', async () => {
      await tracker.record(makeUsage());
      const expensive = await tracker.getMostExpensiveRequests(10, new Date(0));
      expect(expensive.length).toBe(1);

      const futureStart = new Date(Date.now() + 86_400_000);
      const noResults = await tracker.getMostExpensiveRequests(10, futureStart);
      expect(noResults.length).toBe(0);
    });

    it('returns empty array when no records', async () => {
      const expensive = await tracker.getMostExpensiveRequests();
      expect(expensive).toEqual([]);
    });
  });

  describe('exportUsage', () => {
    it('exports as JSON by default', async () => {
      await tracker.record(makeUsage());

      const result = await tracker.exportUsage(new Date(0), new Date());
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].userId).toBe('user-1');
    });

    it('exports valid JSON', async () => {
      await tracker.record(makeUsage());
      await tracker.record(makeUsage({ userId: 'user-2' }));

      const result = await tracker.exportUsage(new Date(0), new Date(), 'json');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('exports as CSV with headers', async () => {
      await tracker.record(makeUsage());

      const csv = await tracker.exportUsage(new Date(0), new Date(), 'csv');
      const lines = csv.split('\n');

      expect(lines.length).toBe(2); // header + 1 row
      expect(lines[0]).toBe(
        'id,timestamp,userId,provider,model,inputTokens,outputTokens,cost,latencyMs,requestType'
      );
    });

    it('CSV has correct column count', async () => {
      await tracker.record(makeUsage());

      const csv = await tracker.exportUsage(new Date(0), new Date(), 'csv');
      const lines = csv.split('\n');

      const headerCols = lines[0]!.split(',').length;
      const dataCols = lines[1]!.split(',').length;
      expect(dataCols).toBe(headerCols);
    });

    it('CSV contains correct data', async () => {
      await tracker.record(
        makeUsage({
          userId: 'alice',
          provider: 'anthropic',
          model: 'claude-4.5-sonnet',
          inputTokens: 2000,
          outputTokens: 1000,
          latencyMs: 150,
          requestType: 'completion',
        })
      );

      const csv = await tracker.exportUsage(new Date(0), new Date(), 'csv');
      const lines = csv.split('\n');
      const values = lines[1]!.split(',');

      expect(values[2]).toBe('alice');
      expect(values[3]).toBe('anthropic');
      expect(values[4]).toBe('claude-4.5-sonnet');
      expect(values[5]).toBe('2000');
      expect(values[6]).toBe('1000');
      expect(values[8]).toBe('150');
      expect(values[9]).toBe('completion');
    });

    it('exports empty result when no records in range', async () => {
      const result = await tracker.exportUsage(new Date('2020-01-01'), new Date('2020-12-31'));
      expect(JSON.parse(result)).toEqual([]);
    });

    it('CSV exports multiple rows', async () => {
      await tracker.record(makeUsage());
      await tracker.record(makeUsage());
      await tracker.record(makeUsage());

      const csv = await tracker.exportUsage(new Date(0), new Date(), 'csv');
      const lines = csv.split('\n');
      expect(lines.length).toBe(4); // header + 3 rows
    });
  });
});

// ---------------------------------------------------------------------------
// BudgetManager
// ---------------------------------------------------------------------------

describe('BudgetManager', () => {
  let tracker: UsageTracker;
  let manager: BudgetManager;

  beforeEach(() => {
    idCounter = 0;
    tracker = new UsageTracker();
  });

  afterEach(() => {
    tracker.removeAllListeners();
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      manager = new BudgetManager(tracker);
      // Should not throw
      expect(manager).toBeInstanceOf(BudgetManager);
    });

    it('merges custom config with defaults', () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 10,
        limitAction: 'block',
      });
      expect(manager).toBeInstanceOf(BudgetManager);
    });

    it('listens to tracker usage events', async () => {
      manager = new BudgetManager(tracker, { dailyLimit: 100 });

      // Recording usage on tracker should trigger budget check (no error)
      await tracker.record(makeUsage());
      // Just verify it doesn't throw
    });
  });

  describe('configure', () => {
    it('updates config', async () => {
      manager = new BudgetManager(tracker, { dailyLimit: 100 });
      manager.configure({ dailyLimit: 50 });

      const status = await manager.getStatus();
      expect(status.daily.limit).toBe(50);
    });

    it('preserves existing config fields not in update', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 100,
        weeklyLimit: 500,
      });
      manager.configure({ dailyLimit: 50 });

      const status = await manager.getStatus();
      expect(status.daily.limit).toBe(50);
      expect(status.weekly.limit).toBe(500);
    });
  });

  describe('getStatus', () => {
    it('returns zero spent when no usage', async () => {
      manager = new BudgetManager(tracker, { dailyLimit: 10 });

      const status = await manager.getStatus();
      expect(status.daily.spent).toBe(0);
      expect(status.weekly.spent).toBe(0);
      expect(status.monthly.spent).toBe(0);
    });

    it('computes daily percentage correctly', async () => {
      manager = new BudgetManager(tracker, { dailyLimit: 1.0 });

      // gpt-4o: 1000 input ($0.0025) + 500 output ($0.005) = $0.0075
      await tracker.record(makeUsage());

      const status = await manager.getStatus();
      expect(status.daily.spent).toBeGreaterThan(0);
      expect(status.daily.percentage).toBeCloseTo((status.daily.spent / 1.0) * 100, 2);
      expect(status.daily.remaining).toBeCloseTo(1.0 - status.daily.spent, 6);
    });

    it('returns 0 percentage when no limit set', async () => {
      manager = new BudgetManager(tracker);

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      expect(status.daily.percentage).toBe(0);
      expect(status.daily.remaining).toBeUndefined();
      expect(status.daily.limit).toBeUndefined();
    });

    it('remaining does not go below 0', async () => {
      manager = new BudgetManager(tracker, { dailyLimit: 0.000001 });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      expect(status.daily.remaining).toBe(0);
    });

    it('generates alerts when thresholds exceeded', async () => {
      // Very small daily limit so a single request exceeds all thresholds
      manager = new BudgetManager(tracker, {
        dailyLimit: 0.0001,
        alertThresholds: [50, 75, 100],
      });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      const dailyAlerts = status.alerts.filter((a) => a.type === 'daily');
      expect(dailyAlerts.length).toBe(3); // 50%, 75%, 100%
    });

    it('generates weekly alerts', async () => {
      manager = new BudgetManager(tracker, {
        weeklyLimit: 0.0001,
        alertThresholds: [50, 100],
      });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      const weeklyAlerts = status.alerts.filter((a) => a.type === 'weekly');
      expect(weeklyAlerts.length).toBe(2);
    });

    it('generates monthly alerts', async () => {
      manager = new BudgetManager(tracker, {
        monthlyLimit: 0.0001,
        alertThresholds: [50, 100],
      });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      const monthlyAlerts = status.alerts.filter((a) => a.type === 'monthly');
      expect(monthlyAlerts.length).toBe(2);
    });

    it('no alerts when within all budgets', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 1000,
        weeklyLimit: 5000,
        monthlyLimit: 20000,
        alertThresholds: [50, 75, 100],
      });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();
      expect(status.alerts.length).toBe(0);
    });

    it('alert has correct fields', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 0.0001,
        alertThresholds: [100],
      });

      await tracker.record(makeUsage());
      const status = await manager.getStatus();

      const alert = status.alerts[0]!;
      expect(alert.type).toBe('daily');
      expect(alert.threshold).toBe(100);
      expect(alert.limit).toBe(0.0001);
      expect(typeof alert.currentSpend).toBe('number');
      expect(typeof alert.timestamp).toBe('string');
    });
  });

  describe('canSpend', () => {
    it('returns allowed=true when within all budgets', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 1000,
        perRequestLimit: 100,
      });

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('blocks per-request over limit when action is block', async () => {
      manager = new BudgetManager(tracker, {
        perRequestLimit: 0.001,
        limitAction: 'block',
      });

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per-request limit');
    });

    it('warns per-request over limit when action is warn', async () => {
      manager = new BudgetManager(tracker, {
        perRequestLimit: 0.001,
        limitAction: 'warn',
      });

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('per-request limit');
    });

    it('includes fallback model recommendation', async () => {
      manager = new BudgetManager(tracker, {
        perRequestLimit: 0.001,
        limitAction: 'block',
        fallbackModel: 'gpt-4o-mini',
      });

      const result = await manager.canSpend(0.01);
      expect(result.recommendation).toContain('gpt-4o-mini');
    });

    it('uses generic recommendation when no fallback model', async () => {
      manager = new BudgetManager(tracker, {
        perRequestLimit: 0.001,
        limitAction: 'block',
      });

      const result = await manager.canSpend(0.01);
      expect(result.recommendation).toContain('cheaper model');
    });

    it('blocks when daily limit would be exceeded', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 0.001,
        limitAction: 'block',
      });

      // Record some usage first to push near/over limit
      await tracker.record(makeUsage());

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily budget exceeded');
      expect(result.recommendation).toContain('tomorrow');
    });

    it('blocks when weekly limit would be exceeded', async () => {
      manager = new BudgetManager(tracker, {
        weeklyLimit: 0.001,
        limitAction: 'block',
      });

      await tracker.record(makeUsage());

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Weekly budget exceeded');
      expect(result.recommendation).toContain('next week');
    });

    it('blocks when monthly limit would be exceeded', async () => {
      manager = new BudgetManager(tracker, {
        monthlyLimit: 0.001,
        limitAction: 'block',
      });

      await tracker.record(makeUsage());

      const result = await manager.canSpend(0.01);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Monthly budget exceeded');
      expect(result.recommendation).toContain('next month');
    });

    it('allows when no limits configured', async () => {
      manager = new BudgetManager(tracker);

      const result = await manager.canSpend(1000);
      expect(result.allowed).toBe(true);
    });

    it('checks per-request limit before daily', async () => {
      manager = new BudgetManager(tracker, {
        perRequestLimit: 0.001,
        dailyLimit: 0.001,
        limitAction: 'block',
      });

      const result = await manager.canSpend(0.01);
      // Per-request should be checked first
      expect(result.reason).toContain('per-request limit');
    });
  });

  describe('checkBudget (via usage event)', () => {
    it('emits alert event when threshold exceeded', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 0.0001,
        alertThresholds: [100],
      });

      const alertSpy = vi.fn();
      manager.on('alert', alertSpy);

      await tracker.record(makeUsage());

      // checkBudget is async, give it a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(alertSpy).toHaveBeenCalled();
      const alert = alertSpy.mock.calls[0]![0];
      expect(alert.type).toBe('daily');
      expect(alert.threshold).toBe(100);
    });

    it('emits alert only once per day per alert type', async () => {
      manager = new BudgetManager(tracker, {
        dailyLimit: 0.0001,
        alertThresholds: [100],
      });

      const alertSpy = vi.fn();
      manager.on('alert', alertSpy);

      // Record usage twice
      await tracker.record(makeUsage());
      await new Promise((r) => setTimeout(r, 50));

      await tracker.record(makeUsage());
      await new Promise((r) => setTimeout(r, 50));

      // daily_100 should only be emitted once
      const dailyAlerts = alertSpy.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { type: string; threshold: number }).type === 'daily' &&
          (call[0] as { type: string; threshold: number }).threshold === 100
      );
      expect(dailyAlerts.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// generateRecommendations
// ---------------------------------------------------------------------------

describe('generateRecommendations', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    idCounter = 0;
    tracker = new UsageTracker();
  });

  it('returns empty array for zero usage', async () => {
    const recs = await generateRecommendations(tracker);
    expect(recs).toEqual([]);
  });

  it('returns model_switch recommendation when cheaper alternatives exist', async () => {
    // Record expensive model usage with cost > $1
    // gpt-4-turbo: input $10/M, output $30/M
    // To get cost > 1: need about 50K input + 25K output
    for (let i = 0; i < 20; i++) {
      await tracker.record(
        makeUsage({
          model: 'gpt-4-turbo',
          inputTokens: 10_000,
          outputTokens: 5_000,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    const modelSwitchRecs = recs.filter((r) => r.type === 'model_switch');
    expect(modelSwitchRecs.length).toBeGreaterThan(0);
    expect(modelSwitchRecs[0]!.estimatedSavings).toBeGreaterThan(0);
    expect(modelSwitchRecs[0]!.currentCost).toBeGreaterThan(0);
    expect(modelSwitchRecs[0]!.potentialCost).toBeLessThan(modelSwitchRecs[0]!.currentCost);
  });

  it('returns prompt_optimization when avg input tokens > 2000', async () => {
    // Record usage with high input tokens
    for (let i = 0; i < 5; i++) {
      await tracker.record(
        makeUsage({
          inputTokens: 5000,
          outputTokens: 500,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    const promptRecs = recs.filter((r) => r.type === 'prompt_optimization');
    expect(promptRecs.length).toBe(1);
    expect(promptRecs[0]!.title).toContain('prompt length');
    expect(promptRecs[0]!.estimatedSavings).toBeGreaterThan(0);
  });

  it('does not return prompt_optimization when avg input <= 2000', async () => {
    for (let i = 0; i < 5; i++) {
      await tracker.record(
        makeUsage({
          inputTokens: 1000,
          outputTokens: 500,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    const promptRecs = recs.filter((r) => r.type === 'prompt_optimization');
    expect(promptRecs.length).toBe(0);
  });

  it('sorts recommendations by estimatedSavings descending', async () => {
    // Generate enough usage for both model_switch and prompt_optimization
    for (let i = 0; i < 20; i++) {
      await tracker.record(
        makeUsage({
          model: 'gpt-4-turbo',
          inputTokens: 10_000,
          outputTokens: 5_000,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.estimatedSavings).toBeGreaterThanOrEqual(recs[i]!.estimatedSavings);
    }
  });

  it('respects days parameter', async () => {
    // Records with a fresh tracker are all "now", so days=0 should still find them
    await tracker.record(makeUsage({ inputTokens: 5000, outputTokens: 500 }));

    const recs = await generateRecommendations(tracker, 1);
    // Should still find the record recorded "now"
    const promptRecs = recs.filter((r) => r.type === 'prompt_optimization');
    expect(promptRecs.length).toBe(1);
  });

  it('does not recommend model_switch when cost <= $1', async () => {
    // Single cheap request
    await tracker.record(
      makeUsage({
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
      })
    );

    const recs = await generateRecommendations(tracker);
    const modelSwitchRecs = recs.filter((r) => r.type === 'model_switch');
    expect(modelSwitchRecs.length).toBe(0);
  });

  it('recommendation has correct fields', async () => {
    for (let i = 0; i < 20; i++) {
      await tracker.record(
        makeUsage({
          model: 'gpt-4-turbo',
          inputTokens: 10_000,
          outputTokens: 5_000,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    if (recs.length > 0) {
      const rec = recs[0]!;
      expect(rec).toHaveProperty('type');
      expect(rec).toHaveProperty('title');
      expect(rec).toHaveProperty('description');
      expect(rec).toHaveProperty('estimatedSavings');
      expect(rec).toHaveProperty('currentCost');
      expect(rec).toHaveProperty('potentialCost');
    }
  });

  it('does not recommend local models as alternatives', async () => {
    for (let i = 0; i < 20; i++) {
      await tracker.record(
        makeUsage({
          model: 'gpt-4-turbo',
          inputTokens: 10_000,
          outputTokens: 5_000,
        })
      );
    }

    const recs = await generateRecommendations(tracker);
    const modelSwitchRecs = recs.filter((r) => r.type === 'model_switch');
    for (const rec of modelSwitchRecs) {
      expect(rec.title).not.toContain('Local Model');
    }
  });
});

// ---------------------------------------------------------------------------
// Factory & Singleton Functions
// ---------------------------------------------------------------------------

describe('createUsageTracker', () => {
  it('returns a new UsageTracker instance', () => {
    const tracker = createUsageTracker();
    expect(tracker).toBeInstanceOf(UsageTracker);
  });

  it('returns distinct instances', () => {
    const t1 = createUsageTracker();
    const t2 = createUsageTracker();
    expect(t1).not.toBe(t2);
  });
});

describe('createBudgetManager', () => {
  it('returns a new BudgetManager instance', () => {
    const tracker = createUsageTracker();
    const manager = createBudgetManager(tracker);
    expect(manager).toBeInstanceOf(BudgetManager);
  });

  it('accepts optional config', () => {
    const tracker = createUsageTracker();
    const manager = createBudgetManager(tracker, { dailyLimit: 5 });
    expect(manager).toBeInstanceOf(BudgetManager);
  });
});

describe('getUsageTracker (singleton)', () => {
  it('returns a UsageTracker', async () => {
    const tracker = await getUsageTracker();
    expect(tracker).toBeInstanceOf(UsageTracker);
  });

  it('returns the same instance on subsequent calls', async () => {
    const t1 = await getUsageTracker();
    const t2 = await getUsageTracker();
    expect(t1).toBe(t2);
  });
});

describe('getBudgetManager (singleton)', () => {
  it('returns a BudgetManager', async () => {
    const manager = await getBudgetManager();
    expect(manager).toBeInstanceOf(BudgetManager);
  });

  it('returns the same instance on subsequent calls', async () => {
    const m1 = await getBudgetManager();
    const m2 = await getBudgetManager();
    expect(m1).toBe(m2);
  });

  it('accepts optional config on first call', async () => {
    // Already created from previous test, so this is a no-op config-wise
    const manager = await getBudgetManager({ dailyLimit: 99 });
    expect(manager).toBeInstanceOf(BudgetManager);
  });
});

// ---------------------------------------------------------------------------
// Integration: Tracker + BudgetManager together
// ---------------------------------------------------------------------------

describe('UsageTracker + BudgetManager integration', () => {
  let tracker: UsageTracker;
  let manager: BudgetManager;

  beforeEach(() => {
    idCounter = 0;
    tracker = new UsageTracker();
    manager = new BudgetManager(tracker, {
      dailyLimit: 1.0,
      weeklyLimit: 5.0,
      monthlyLimit: 20.0,
      perRequestLimit: 0.5,
      alertThresholds: [50, 90, 100],
      limitAction: 'block',
    });
  });

  afterEach(() => {
    tracker.removeAllListeners();
  });

  it('canSpend reflects recorded usage', async () => {
    // Before any usage, should be allowed
    const before = await manager.canSpend(0.01);
    expect(before.allowed).toBe(true);

    // Record a lot of usage to exceed daily limit ($1)
    // gpt-4o: 100K input = $0.25, 100K output = $1.0 → $1.25 per record
    await tracker.record(
      makeUsage({
        inputTokens: 100_000,
        outputTokens: 100_000,
      })
    );

    // Now should be blocked for daily
    const after = await manager.canSpend(0.01);
    expect(after.allowed).toBe(false);
  });

  it('getStatus reflects recorded usage', async () => {
    const statusBefore = await manager.getStatus();
    expect(statusBefore.daily.spent).toBe(0);

    await tracker.record(makeUsage());

    const statusAfter = await manager.getStatus();
    expect(statusAfter.daily.spent).toBeGreaterThan(0);
  });

  it('budget manager receives alerts from tracker', async () => {
    const alertSpy = vi.fn();
    manager.on('alert', alertSpy);

    // Exceed daily limit
    await tracker.record(
      makeUsage({
        inputTokens: 100_000,
        outputTokens: 100_000,
      })
    );

    // Wait for async checkBudget
    await new Promise((r) => setTimeout(r, 100));

    expect(alertSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('calculateCost with 1 input and 1 output token', () => {
    const cost = calculateCost('openai', 'gpt-4o', 1, 1);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  it('formatCost handles negative values', () => {
    // The function does not special-case negatives, but should not throw
    const result = formatCost(-0.5);
    expect(typeof result).toBe('string');
  });

  it('formatTokens handles negative values', () => {
    const result = formatTokens(-100);
    expect(typeof result).toBe('string');
  });

  it('estimateCost with 0 output tokens', () => {
    const estimate = estimateCost('openai', 'gpt-4o', 'Hello', 0);
    expect(estimate.estimatedOutputTokens).toBe(0);
    expect(estimate.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it('getModelPricing with empty string modelId falls back to provider', () => {
    const result = getModelPricing('openai', '');
    // Empty string won't match exact, won't match partial, falls back to provider
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('openai');
  });

  it('UsageTracker handles concurrent records', async () => {
    const tracker = new UsageTracker();
    const promises = Array.from({ length: 50 }, () => tracker.record(makeUsage()));
    const results = await Promise.all(promises);

    expect(results.length).toBe(50);
    // All should have unique IDs
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(50);
  });

  it('BudgetManager with all limits undefined allows everything', async () => {
    const tracker = new UsageTracker();
    const manager = new BudgetManager(tracker, {
      alertThresholds: [50, 100],
      limitAction: 'block',
    });

    const result = await manager.canSpend(999_999);
    expect(result.allowed).toBe(true);
  });

  it('formatCost with exactly 1.0', () => {
    expect(formatCost(1.0)).toBe('$1.00');
  });

  it('formatTokens at boundary 999', () => {
    expect(formatTokens(999)).toBe('999');
  });

  it('formatTokens at boundary 999999', () => {
    expect(formatTokens(999999)).toBe('1000.0K');
  });

  it('MODEL_PRICING entries all have updatedAt dates', () => {
    for (const entry of MODEL_PRICING) {
      expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

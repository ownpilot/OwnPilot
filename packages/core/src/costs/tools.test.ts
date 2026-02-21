import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '../agent/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./index.js', () => ({
  formatCost: vi.fn((v: number) => `$${v.toFixed(2)}`),
  formatTokens: vi.fn((v: number) => `${v}`),
  generateRecommendations: vi.fn(),
  MODEL_PRICING: [
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      displayName: 'GPT-4o',
      inputPricePerMillion: 5,
      outputPricePerMillion: 15,
      contextWindow: 128000,
      maxOutput: 16384,
      supportsVision: true,
      supportsFunctions: true,
      updatedAt: '2026-01-26',
    },
    {
      provider: 'anthropic',
      modelId: 'claude-3-sonnet',
      displayName: 'Claude 3 Sonnet',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      contextWindow: 200000,
      maxOutput: 8192,
      supportsVision: true,
      supportsFunctions: true,
      updatedAt: '2026-01-26',
    },
    {
      provider: 'google',
      modelId: 'gemini-pro',
      displayName: 'Gemini Pro',
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 1.5,
      contextWindow: 32000,
      maxOutput: 8192,
      supportsVision: false,
      supportsFunctions: true,
      updatedAt: '2026-01-26',
    },
    {
      provider: 'groq',
      modelId: 'mixtral-8x7b',
      displayName: 'Mixtral',
      inputPricePerMillion: 0.24,
      outputPricePerMillion: 0.24,
      contextWindow: 32000,
      maxOutput: 4096,
      supportsVision: false,
      supportsFunctions: false,
      updatedAt: '2026-01-26',
    },
  ],
}));

import {
  GET_COST_SUMMARY_TOOL,
  GET_BUDGET_STATUS_TOOL,
  SET_BUDGET_TOOL,
  GET_COST_BREAKDOWN_TOOL,
  GET_EXPENSIVE_REQUESTS_TOOL,
  GET_COST_RECOMMENDATIONS_TOOL,
  COMPARE_MODEL_COSTS_TOOL,
  EXPORT_USAGE_TOOL,
  COST_TRACKING_TOOLS,
  createCostToolExecutors,
  createCostTools,
} from './tools.js';
import { generateRecommendations } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyContext = {} as ToolContext;

function makeTracker() {
  return {
    getTodayUsage: vi.fn(),
    getWeekUsage: vi.fn(),
    getMonthUsage: vi.fn(),
    getSummary: vi.fn(),
    getMostExpensiveRequests: vi.fn(),
    exportUsage: vi.fn(),
  };
}

function makeBudgetMgr() {
  return {
    getStatus: vi.fn(),
    configure: vi.fn(),
  };
}

interface SummaryOverrides {
  totalCost?: number;
  totalRequests?: number;
  successfulRequests?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  averageLatencyMs?: number;
  periodStart?: string;
  periodEnd?: string;
  byProvider?: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }>;
  byModel?: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }>;
  daily?: Array<{ date: string; cost: number; requests: number; inputTokens: number; outputTokens: number }>;
}

function makeSummary(overrides: SummaryOverrides = {}) {
  return {
    totalCost: 5.5,
    totalRequests: 100,
    successfulRequests: 95,
    totalInputTokens: 50000,
    totalOutputTokens: 25000,
    averageLatencyMs: 350,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-21',
    byProvider: {
      openai: { cost: 3, requests: 60, inputTokens: 30000, outputTokens: 15000 },
      anthropic: { cost: 2.5, requests: 40, inputTokens: 20000, outputTokens: 10000 },
    },
    byModel: {
      'gpt-4o': { cost: 3, requests: 60, inputTokens: 30000, outputTokens: 15000 },
      'claude-3': { cost: 2.5, requests: 40, inputTokens: 20000, outputTokens: 10000 },
    },
    daily: [
      { date: '2026-02-20', cost: 3, requests: 60, inputTokens: 30000, outputTokens: 15000 },
      { date: '2026-02-21', cost: 2.5, requests: 40, inputTokens: 20000, outputTokens: 10000 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Tool Definitions
// =============================================================================

describe('Tool definitions', () => {
  const allTools = [
    { constant: GET_COST_SUMMARY_TOOL, expectedName: 'get_cost_summary' },
    { constant: GET_BUDGET_STATUS_TOOL, expectedName: 'get_budget_status' },
    { constant: SET_BUDGET_TOOL, expectedName: 'set_budget' },
    { constant: GET_COST_BREAKDOWN_TOOL, expectedName: 'get_cost_breakdown' },
    { constant: GET_EXPENSIVE_REQUESTS_TOOL, expectedName: 'get_expensive_requests' },
    { constant: GET_COST_RECOMMENDATIONS_TOOL, expectedName: 'get_cost_recommendations' },
    { constant: COMPARE_MODEL_COSTS_TOOL, expectedName: 'compare_model_costs' },
    { constant: EXPORT_USAGE_TOOL, expectedName: 'export_usage' },
  ];

  for (const { constant, expectedName } of allTools) {
    describe(expectedName, () => {
      it('has the correct name', () => {
        expect(constant.name).toBe(expectedName);
      });

      it('has a non-empty description', () => {
        expect(constant.description).toBeTruthy();
        expect(constant.description.length).toBeGreaterThan(0);
      });

      it('has parameters with type "object"', () => {
        expect(constant.parameters.type).toBe('object');
      });

      it('has a properties object', () => {
        expect(constant.parameters.properties).toBeDefined();
        expect(typeof constant.parameters.properties).toBe('object');
      });
    });
  }

  describe('GET_COST_SUMMARY_TOOL specifics', () => {
    it('requires "period"', () => {
      expect(GET_COST_SUMMARY_TOOL.parameters.required).toContain('period');
    });

    it('has period enum with four values', () => {
      const period = GET_COST_SUMMARY_TOOL.parameters.properties!['period'] as { enum: string[] };
      expect(period.enum).toEqual(['today', 'week', 'month', 'custom']);
    });

    it('has startDate and endDate properties', () => {
      expect(GET_COST_SUMMARY_TOOL.parameters.properties!['startDate']).toBeDefined();
      expect(GET_COST_SUMMARY_TOOL.parameters.properties!['endDate']).toBeDefined();
    });

    it('startDate and endDate are type string', () => {
      const start = GET_COST_SUMMARY_TOOL.parameters.properties!['startDate'] as { type: string };
      const end = GET_COST_SUMMARY_TOOL.parameters.properties!['endDate'] as { type: string };
      expect(start.type).toBe('string');
      expect(end.type).toBe('string');
    });
  });

  describe('GET_BUDGET_STATUS_TOOL specifics', () => {
    it('has no required fields', () => {
      expect(GET_BUDGET_STATUS_TOOL.parameters.required).toBeUndefined();
    });

    it('has empty properties', () => {
      expect(Object.keys(GET_BUDGET_STATUS_TOOL.parameters.properties!)).toHaveLength(0);
    });
  });

  describe('SET_BUDGET_TOOL specifics', () => {
    it('has no required fields', () => {
      expect(SET_BUDGET_TOOL.parameters.required).toBeUndefined();
    });

    it('has dailyLimit, weeklyLimit, monthlyLimit, perRequestLimit properties', () => {
      const props = SET_BUDGET_TOOL.parameters.properties!;
      expect(props['dailyLimit']).toBeDefined();
      expect(props['weeklyLimit']).toBeDefined();
      expect(props['monthlyLimit']).toBeDefined();
      expect(props['perRequestLimit']).toBeDefined();
    });

    it('all limit properties are type number', () => {
      const props = SET_BUDGET_TOOL.parameters.properties!;
      for (const key of ['dailyLimit', 'weeklyLimit', 'monthlyLimit', 'perRequestLimit']) {
        expect((props[key] as { type: string }).type).toBe('number');
      }
    });
  });

  describe('GET_COST_BREAKDOWN_TOOL specifics', () => {
    it('requires groupBy and period', () => {
      expect(GET_COST_BREAKDOWN_TOOL.parameters.required).toEqual(['groupBy', 'period']);
    });

    it('groupBy enum has provider, model, day', () => {
      const groupBy = GET_COST_BREAKDOWN_TOOL.parameters.properties!['groupBy'] as { enum: string[] };
      expect(groupBy.enum).toEqual(['provider', 'model', 'day']);
    });

    it('period enum has today, week, month', () => {
      const period = GET_COST_BREAKDOWN_TOOL.parameters.properties!['period'] as { enum: string[] };
      expect(period.enum).toEqual(['today', 'week', 'month']);
    });
  });

  describe('GET_EXPENSIVE_REQUESTS_TOOL specifics', () => {
    it('has no required fields', () => {
      expect(GET_EXPENSIVE_REQUESTS_TOOL.parameters.required).toBeUndefined();
    });

    it('limit is type number', () => {
      const limit = GET_EXPENSIVE_REQUESTS_TOOL.parameters.properties!['limit'] as { type: string };
      expect(limit.type).toBe('number');
    });

    it('period enum has today, week, month, all', () => {
      const period = GET_EXPENSIVE_REQUESTS_TOOL.parameters.properties!['period'] as { enum: string[] };
      expect(period.enum).toEqual(['today', 'week', 'month', 'all']);
    });
  });

  describe('GET_COST_RECOMMENDATIONS_TOOL specifics', () => {
    it('has no required fields', () => {
      expect(GET_COST_RECOMMENDATIONS_TOOL.parameters.required).toBeUndefined();
    });

    it('has empty properties', () => {
      expect(Object.keys(GET_COST_RECOMMENDATIONS_TOOL.parameters.properties!)).toHaveLength(0);
    });
  });

  describe('COMPARE_MODEL_COSTS_TOOL specifics', () => {
    it('has no required fields', () => {
      expect(COMPARE_MODEL_COSTS_TOOL.parameters.required).toBeUndefined();
    });

    it('providers is type array with string items', () => {
      const providers = COMPARE_MODEL_COSTS_TOOL.parameters.properties!['providers'] as {
        type: string;
        items: { type: string };
      };
      expect(providers.type).toBe('array');
      expect(providers.items.type).toBe('string');
    });

    it('minContextWindow is type number', () => {
      const ctx = COMPARE_MODEL_COSTS_TOOL.parameters.properties!['minContextWindow'] as { type: string };
      expect(ctx.type).toBe('number');
    });

    it('supportsFunctions is type boolean', () => {
      const sf = COMPARE_MODEL_COSTS_TOOL.parameters.properties!['supportsFunctions'] as { type: string };
      expect(sf.type).toBe('boolean');
    });
  });

  describe('EXPORT_USAGE_TOOL specifics', () => {
    it('requires format and period', () => {
      expect(EXPORT_USAGE_TOOL.parameters.required).toEqual(['format', 'period']);
    });

    it('format enum has json and csv', () => {
      const format = EXPORT_USAGE_TOOL.parameters.properties!['format'] as { enum: string[] };
      expect(format.enum).toEqual(['json', 'csv']);
    });

    it('period enum has week, month, all', () => {
      const period = EXPORT_USAGE_TOOL.parameters.properties!['period'] as { enum: string[] };
      expect(period.enum).toEqual(['week', 'month', 'all']);
    });
  });
});

// =============================================================================
// COST_TRACKING_TOOLS array
// =============================================================================

describe('COST_TRACKING_TOOLS', () => {
  it('has exactly 8 tools', () => {
    expect(COST_TRACKING_TOOLS).toHaveLength(8);
  });

  it('contains all 8 tool definitions', () => {
    expect(COST_TRACKING_TOOLS).toContain(GET_COST_SUMMARY_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(GET_BUDGET_STATUS_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(SET_BUDGET_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(GET_COST_BREAKDOWN_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(GET_EXPENSIVE_REQUESTS_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(GET_COST_RECOMMENDATIONS_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(COMPARE_MODEL_COSTS_TOOL);
    expect(COST_TRACKING_TOOLS).toContain(EXPORT_USAGE_TOOL);
  });

  it('has unique names', () => {
    const names = COST_TRACKING_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// =============================================================================
// createCostToolExecutors
// =============================================================================

describe('createCostToolExecutors', () => {
  it('returns a record with 8 executors', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    expect(Object.keys(executorMap)).toHaveLength(8);
  });

  it('each value is a function', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    for (const key of Object.keys(executorMap)) {
      expect(typeof executorMap[key]).toBe('function');
    }
  });

  it('has entries matching all tool names', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    for (const tool of COST_TRACKING_TOOLS) {
      expect(executorMap[tool.name]).toBeDefined();
    }
  });
});

// =============================================================================
// createCostTools
// =============================================================================

describe('createCostTools', () => {
  it('returns array of 8 { definition, executor } pairs', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const tools = createCostTools(
      () => tracker as never,
      () => budget as never,
    );
    expect(tools).toHaveLength(8);
  });

  it('each entry has a definition and a function executor', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const tools = createCostTools(
      () => tracker as never,
      () => budget as never,
    );
    for (const tool of tools) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTruthy();
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('definitions match COST_TRACKING_TOOLS order', () => {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const tools = createCostTools(
      () => tracker as never,
      () => budget as never,
    );
    for (let i = 0; i < tools.length; i++) {
      expect(tools[i]!.definition).toBe(COST_TRACKING_TOOLS[i]);
    }
  });
});

// =============================================================================
// get_cost_summary
// =============================================================================

describe('get_cost_summary', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { tracker, executorMap, run: executorMap['get_cost_summary']! };
  }

  it('calls getTodayUsage for period "today"', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    await run({ period: 'today' }, dummyContext);
    expect(tracker.getTodayUsage).toHaveBeenCalledOnce();
  });

  it('calls getWeekUsage for period "week"', async () => {
    const { tracker, run } = setup();
    tracker.getWeekUsage.mockResolvedValue(makeSummary());
    await run({ period: 'week' }, dummyContext);
    expect(tracker.getWeekUsage).toHaveBeenCalledOnce();
  });

  it('calls getMonthUsage for period "month"', async () => {
    const { tracker, run } = setup();
    tracker.getMonthUsage.mockResolvedValue(makeSummary());
    await run({ period: 'month' }, dummyContext);
    expect(tracker.getMonthUsage).toHaveBeenCalledOnce();
  });

  it('calls getSummary for period "custom" with startDate', async () => {
    const { tracker, run } = setup();
    tracker.getSummary.mockResolvedValue(makeSummary());
    await run({ period: 'custom', startDate: '2026-01-01' }, dummyContext);
    expect(tracker.getSummary).toHaveBeenCalledOnce();
    const [start] = tracker.getSummary.mock.calls[0]!;
    expect(start).toBeInstanceOf(Date);
    expect((start as Date).toISOString()).toContain('2026-01-01');
  });

  it('passes endDate to getSummary when provided', async () => {
    const { tracker, run } = setup();
    tracker.getSummary.mockResolvedValue(makeSummary());
    await run(
      { period: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' },
      dummyContext,
    );
    const [, end] = tracker.getSummary.mock.calls[0]!;
    expect(end).toBeInstanceOf(Date);
    expect((end as Date).toISOString()).toContain('2026-01-31');
  });

  it('uses current date as endDate when not provided for custom period', async () => {
    const { tracker, run } = setup();
    tracker.getSummary.mockResolvedValue(makeSummary());
    const before = Date.now();
    await run({ period: 'custom', startDate: '2026-01-01' }, dummyContext);
    const after = Date.now();
    const [, end] = tracker.getSummary.mock.calls[0]!;
    const endTime = (end as Date).getTime();
    expect(endTime).toBeGreaterThanOrEqual(before);
    expect(endTime).toBeLessThanOrEqual(after);
  });

  it('returns error for period "custom" without startDate', async () => {
    const { run } = setup();
    const result = await run({ period: 'custom' }, dummyContext);
    expect(result.content).toEqual({
      success: false,
      error: 'startDate required for custom period',
    });
  });

  it('returns formatted summary fields', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['period']).toBe('today');
    const s = c['summary'] as Record<string, unknown>;
    expect(s['totalCost']).toBe('$5.50');
    expect(s['totalCostRaw']).toBe(5.5);
    expect(s['totalRequests']).toBe(100);
    expect(s['periodStart']).toBe('2026-02-01');
    expect(s['periodEnd']).toBe('2026-02-21');
  });

  it('calculates successRate as percentage', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ period: 'today' }, dummyContext);
    const s = (result.content as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(s['successRate']).toBe('95.0%');
  });

  it('returns N/A for successRate when 0 requests', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ totalRequests: 0, successfulRequests: 0 }));
    const result = await run({ period: 'today' }, dummyContext);
    const s = (result.content as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(s['successRate']).toBe('N/A');
  });

  it('calculates correct successRate for different ratios', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ totalRequests: 200, successfulRequests: 150 }));
    const result = await run({ period: 'today' }, dummyContext);
    const s = (result.content as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(s['successRate']).toBe('75.0%');
  });

  it('formats averageLatency in ms', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ averageLatencyMs: 350.7 }));
    const result = await run({ period: 'today' }, dummyContext);
    const s = (result.content as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(s['averageLatency']).toBe('351ms');
  });

  it('formats totalTokens, inputTokens, outputTokens', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ period: 'today' }, dummyContext);
    const s = (result.content as Record<string, unknown>)['summary'] as Record<string, unknown>;
    // 50000 + 25000 = 75000
    expect(s['totalTokens']).toBe('75000');
    expect(s['inputTokens']).toBe('50000');
    expect(s['outputTokens']).toBe('25000');
  });

  it('returns topProviders sorted by cost desc, max 3', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    const providers = c['topProviders'] as Array<{ provider: string; cost: string; requests: number }>;
    expect(providers).toHaveLength(2);
    expect(providers[0]!.provider).toBe('openai');
    expect(providers[0]!.cost).toBe('$3.00');
    expect(providers[0]!.requests).toBe(60);
    expect(providers[1]!.provider).toBe('anthropic');
  });

  it('limits topProviders to 3', async () => {
    const { tracker, run } = setup();
    const summary = makeSummary({
      byProvider: {
        openai: { cost: 10, requests: 100, inputTokens: 50000, outputTokens: 25000 },
        anthropic: { cost: 8, requests: 80, inputTokens: 40000, outputTokens: 20000 },
        google: { cost: 5, requests: 50, inputTokens: 25000, outputTokens: 12000 },
        groq: { cost: 2, requests: 20, inputTokens: 10000, outputTokens: 5000 },
      },
    });
    tracker.getTodayUsage.mockResolvedValue(summary);
    const result = await run({ period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    const providers = c['topProviders'] as Array<{ provider: string }>;
    expect(providers).toHaveLength(3);
    expect(providers[0]!.provider).toBe('openai');
    expect(providers[1]!.provider).toBe('anthropic');
    expect(providers[2]!.provider).toBe('google');
  });

  it('returns topModels sorted by cost desc, max 5', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    const models = c['topModels'] as Array<{ model: string; cost: string; requests: number }>;
    expect(models).toHaveLength(2);
    expect(models[0]!.model).toBe('gpt-4o');
    expect(models[0]!.cost).toBe('$3.00');
    expect(models[1]!.model).toBe('claude-3');
  });

  it('limits topModels to 5', async () => {
    const { tracker, run } = setup();
    const byModel: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};
    for (let i = 0; i < 7; i++) {
      byModel[`model-${i}`] = { cost: 10 - i, requests: 10, inputTokens: 1000, outputTokens: 500 };
    }
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ byModel }));
    const result = await run({ period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    const models = c['topModels'] as Array<{ model: string }>;
    expect(models).toHaveLength(5);
  });
});

// =============================================================================
// get_budget_status
// =============================================================================

describe('get_budget_status', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { budget, executorMap, run: executorMap['get_budget_status']! };
  }

  it('calls budgetMgr.getStatus()', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 2, limit: 10, percentage: 20, remaining: 8 },
      weekly: { spent: 10, limit: 50, percentage: 20, remaining: 40 },
      monthly: { spent: 30, limit: 200, percentage: 15, remaining: 170 },
      alerts: [],
    });
    await run({}, dummyContext);
    expect(budget.getStatus).toHaveBeenCalledOnce();
  });

  it('returns formatted budget for all periods', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 2, limit: 10, percentage: 20, remaining: 8 },
      weekly: { spent: 10, limit: 50, percentage: 20, remaining: 40 },
      monthly: { spent: 30, limit: 200, percentage: 15, remaining: 170 },
      alerts: [],
    });
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    const b = c['budget'] as Record<string, Record<string, unknown>>;
    expect(b['daily']!['spent']).toBe('$2.00');
    expect(b['daily']!['limit']).toBe('$10.00');
    expect(b['daily']!['percentage']).toBe('20.0%');
    expect(b['daily']!['remaining']).toBe('$8.00');
  });

  it('shows "No limit" when limit is falsy', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 2, limit: 0, percentage: 0, remaining: undefined },
      weekly: { spent: 10, limit: undefined, percentage: 0, remaining: undefined },
      monthly: { spent: 30, limit: null, percentage: 0, remaining: undefined },
      alerts: [],
    });
    const result = await run({}, dummyContext);
    const b = (result.content as Record<string, unknown>)['budget'] as Record<string, Record<string, unknown>>;
    expect(b['daily']!['limit']).toBe('No limit');
    expect(b['weekly']!['limit']).toBe('No limit');
    expect(b['monthly']!['limit']).toBe('No limit');
  });

  it('shows "Unlimited" when remaining is undefined', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 2, limit: 10, percentage: 20, remaining: undefined },
      weekly: { spent: 10, limit: 50, percentage: 20, remaining: undefined },
      monthly: { spent: 30, limit: 200, percentage: 15, remaining: undefined },
      alerts: [],
    });
    const result = await run({}, dummyContext);
    const b = (result.content as Record<string, unknown>)['budget'] as Record<string, Record<string, unknown>>;
    expect(b['daily']!['remaining']).toBe('Unlimited');
    expect(b['weekly']!['remaining']).toBe('Unlimited');
    expect(b['monthly']!['remaining']).toBe('Unlimited');
  });

  it('maps alerts correctly', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 9, limit: 10, percentage: 90, remaining: 1 },
      weekly: { spent: 10, limit: 50, percentage: 20, remaining: 40 },
      monthly: { spent: 30, limit: 200, percentage: 15, remaining: 170 },
      alerts: [
        { type: 'daily', threshold: 90, currentSpend: 9, limit: 10, timestamp: '2026-02-21T12:00:00Z' },
      ],
    });
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    const alerts = c['alerts'] as Array<{ type: string; message: string }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe('daily');
    expect(alerts[0]!.message).toBe('daily budget at 90% ($9.00 / $10.00)');
  });

  it('returns empty alerts when none present', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 1, limit: 10, percentage: 10, remaining: 9 },
      weekly: { spent: 5, limit: 50, percentage: 10, remaining: 45 },
      monthly: { spent: 10, limit: 200, percentage: 5, remaining: 190 },
      alerts: [],
    });
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['alerts']).toEqual([]);
  });

  it('handles multiple alerts', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 9, limit: 10, percentage: 90, remaining: 1 },
      weekly: { spent: 45, limit: 50, percentage: 90, remaining: 5 },
      monthly: { spent: 30, limit: 200, percentage: 15, remaining: 170 },
      alerts: [
        { type: 'daily', threshold: 90, currentSpend: 9, limit: 10, timestamp: '2026-02-21T12:00:00Z' },
        { type: 'weekly', threshold: 90, currentSpend: 45, limit: 50, timestamp: '2026-02-21T12:00:00Z' },
      ],
    });
    const result = await run({}, dummyContext);
    const alerts = (result.content as Record<string, unknown>)['alerts'] as Array<{ type: string }>;
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.type).toBe('daily');
    expect(alerts[1]!.type).toBe('weekly');
  });

  it('formats percentage with one decimal place', async () => {
    const { budget, run } = setup();
    budget.getStatus.mockResolvedValue({
      daily: { spent: 3.33, limit: 10, percentage: 33.333, remaining: 6.67 },
      weekly: { spent: 0, limit: 50, percentage: 0, remaining: 50 },
      monthly: { spent: 0, limit: 200, percentage: 0, remaining: 200 },
      alerts: [],
    });
    const result = await run({}, dummyContext);
    const b = (result.content as Record<string, unknown>)['budget'] as Record<string, Record<string, unknown>>;
    expect(b['daily']!['percentage']).toBe('33.3%');
  });
});

// =============================================================================
// set_budget
// =============================================================================

describe('set_budget', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { budget, executorMap, run: executorMap['set_budget']! };
  }

  it('calls budgetMgr.configure with args', async () => {
    const { budget, run } = setup();
    const args = { dailyLimit: 10, weeklyLimit: 50, monthlyLimit: 200, perRequestLimit: 1 };
    await run(args, dummyContext);
    expect(budget.configure).toHaveBeenCalledWith(args);
  });

  it('returns success and formatted limits', async () => {
    const { run } = setup();
    const result = await run(
      { dailyLimit: 10, weeklyLimit: 50, monthlyLimit: 200, perRequestLimit: 1 },
      dummyContext,
    );
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['message']).toBe('Budget limits updated');
    const limits = c['newLimits'] as Record<string, string>;
    expect(limits['daily']).toBe('$10.00');
    expect(limits['weekly']).toBe('$50.00');
    expect(limits['monthly']).toBe('$200.00');
    expect(limits['perRequest']).toBe('$1.00');
  });

  it('shows "Not set" for unspecified limits', async () => {
    const { run } = setup();
    const result = await run({}, dummyContext);
    const limits = (result.content as Record<string, unknown>)['newLimits'] as Record<string, string>;
    expect(limits['daily']).toBe('Not set');
    expect(limits['weekly']).toBe('Not set');
    expect(limits['monthly']).toBe('Not set');
    expect(limits['perRequest']).toBe('Not set');
  });

  it('handles partial args (only dailyLimit)', async () => {
    const { budget, run } = setup();
    const result = await run({ dailyLimit: 5 }, dummyContext);
    expect(budget.configure).toHaveBeenCalledWith({ dailyLimit: 5 });
    const limits = (result.content as Record<string, unknown>)['newLimits'] as Record<string, string>;
    expect(limits['daily']).toBe('$5.00');
    expect(limits['weekly']).toBe('Not set');
    expect(limits['monthly']).toBe('Not set');
    expect(limits['perRequest']).toBe('Not set');
  });

  it('handles partial args (only monthlyLimit and perRequestLimit)', async () => {
    const { run } = setup();
    const result = await run({ monthlyLimit: 100, perRequestLimit: 0.5 }, dummyContext);
    const limits = (result.content as Record<string, unknown>)['newLimits'] as Record<string, string>;
    expect(limits['daily']).toBe('Not set');
    expect(limits['weekly']).toBe('Not set');
    expect(limits['monthly']).toBe('$100.00');
    expect(limits['perRequest']).toBe('$0.50');
  });

  it('shows "Not set" when limit is 0 (falsy)', async () => {
    const { run } = setup();
    const result = await run({ dailyLimit: 0 }, dummyContext);
    const limits = (result.content as Record<string, unknown>)['newLimits'] as Record<string, string>;
    expect(limits['daily']).toBe('Not set');
  });

  it('always calls configure even with empty args', async () => {
    const { budget, run } = setup();
    await run({}, dummyContext);
    expect(budget.configure).toHaveBeenCalledWith({});
  });
});

// =============================================================================
// get_cost_breakdown
// =============================================================================

describe('get_cost_breakdown', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { tracker, executorMap, run: executorMap['get_cost_breakdown']! };
  }

  it('calls getTodayUsage for period "today"', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    await run({ groupBy: 'provider', period: 'today' }, dummyContext);
    expect(tracker.getTodayUsage).toHaveBeenCalledOnce();
  });

  it('calls getWeekUsage for period "week"', async () => {
    const { tracker, run } = setup();
    tracker.getWeekUsage.mockResolvedValue(makeSummary());
    await run({ groupBy: 'provider', period: 'week' }, dummyContext);
    expect(tracker.getWeekUsage).toHaveBeenCalledOnce();
  });

  it('calls getMonthUsage for period "month"', async () => {
    const { tracker, run } = setup();
    tracker.getMonthUsage.mockResolvedValue(makeSummary());
    await run({ groupBy: 'provider', period: 'month' }, dummyContext);
    expect(tracker.getMonthUsage).toHaveBeenCalledOnce();
  });

  it('groupBy "provider" returns entries sorted by cost desc', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'provider', period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['period']).toBe('today');
    expect(c['groupBy']).toBe('provider');
    const bd = c['breakdown'] as Array<{ name: string; cost: string; costRaw: number; requests: number; tokens: string }>;
    expect(bd).toHaveLength(2);
    // openai cost 3 > anthropic cost 2.5
    expect(bd[0]!.name).toBe('openai');
    expect(bd[0]!.costRaw).toBe(3);
    expect(bd[1]!.name).toBe('anthropic');
    expect(bd[1]!.costRaw).toBe(2.5);
  });

  it('groupBy "model" returns entries sorted by cost desc', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'model', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<{ name: string; costRaw: number }>;
    expect(bd).toHaveLength(2);
    expect(bd[0]!.name).toBe('gpt-4o');
    expect(bd[0]!.costRaw).toBe(3);
    expect(bd[1]!.name).toBe('claude-3');
  });

  it('groupBy "day" returns daily entries in order', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'day', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<{ name: string; costRaw: number }>;
    expect(bd).toHaveLength(2);
    expect(bd[0]!.name).toBe('2026-02-20');
    expect(bd[1]!.name).toBe('2026-02-21');
  });

  it('breakdown entries have cost, costRaw, requests, tokens fields', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'provider', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<Record<string, unknown>>;
    const entry = bd[0]!;
    expect(entry['cost']).toBe('$3.00');
    expect(entry['costRaw']).toBe(3);
    expect(entry['requests']).toBe(60);
    // 30000 + 15000 = 45000
    expect(entry['tokens']).toBe('45000');
  });

  it('includes totalCost in response', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'provider', period: 'today' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['totalCost']).toBe('$5.50');
  });

  it('day breakdown computes tokens correctly', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary());
    const result = await run({ groupBy: 'day', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<{ tokens: string }>;
    // First day: 30000 + 15000 = 45000
    expect(bd[0]!.tokens).toBe('45000');
    // Second day: 20000 + 10000 = 30000
    expect(bd[1]!.tokens).toBe('30000');
  });

  it('handles empty providers', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ byProvider: {} }));
    const result = await run({ groupBy: 'provider', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<unknown>;
    expect(bd).toHaveLength(0);
  });

  it('handles empty models', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ byModel: {} }));
    const result = await run({ groupBy: 'model', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<unknown>;
    expect(bd).toHaveLength(0);
  });

  it('handles empty daily', async () => {
    const { tracker, run } = setup();
    tracker.getTodayUsage.mockResolvedValue(makeSummary({ daily: [] }));
    const result = await run({ groupBy: 'day', period: 'today' }, dummyContext);
    const bd = (result.content as Record<string, unknown>)['breakdown'] as Array<unknown>;
    expect(bd).toHaveLength(0);
  });
});

// =============================================================================
// get_expensive_requests
// =============================================================================

describe('get_expensive_requests', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { tracker, executorMap, run: executorMap['get_expensive_requests']! };
  }

  const makeExpensiveRecord = (cost: number) => ({
    timestamp: '2026-02-21T10:00:00Z',
    provider: 'openai',
    model: 'gpt-4o',
    cost,
    inputTokens: 5000,
    outputTokens: 2000,
    latencyMs: 500,
    requestType: 'chat',
  });

  it('uses default limit of 10 when not specified', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    await run({}, dummyContext);
    expect(tracker.getMostExpensiveRequests).toHaveBeenCalledWith(10, undefined);
  });

  it('uses custom limit when specified', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    await run({ limit: 5 }, dummyContext);
    expect(tracker.getMostExpensiveRequests).toHaveBeenCalledWith(5, undefined);
  });

  it('passes no startDate when period is "all"', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    await run({ period: 'all' }, dummyContext);
    expect(tracker.getMostExpensiveRequests).toHaveBeenCalledWith(10, undefined);
  });

  it('passes no startDate when period is not specified', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    await run({}, dummyContext);
    expect(tracker.getMostExpensiveRequests).toHaveBeenCalledWith(10, undefined);
  });

  it('passes startDate at midnight for period "today"', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    await run({ period: 'today' }, dummyContext);
    const [, startDate] = tracker.getMostExpensiveRequests.mock.calls[0]!;
    expect(startDate).toBeInstanceOf(Date);
    expect((startDate as Date).getHours()).toBe(0);
    expect((startDate as Date).getMinutes()).toBe(0);
    expect((startDate as Date).getSeconds()).toBe(0);
  });

  it('passes startDate 7 days ago for period "week"', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    const before = new Date();
    before.setDate(before.getDate() - 7);
    await run({ period: 'week' }, dummyContext);
    const [, startDate] = tracker.getMostExpensiveRequests.mock.calls[0]!;
    expect(startDate).toBeInstanceOf(Date);
    const diff = Math.abs((startDate as Date).getTime() - before.getTime());
    // Allow 2 second tolerance
    expect(diff).toBeLessThan(2000);
  });

  it('passes startDate 1 month ago for period "month"', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    const before = new Date();
    before.setMonth(before.getMonth() - 1);
    await run({ period: 'month' }, dummyContext);
    const [, startDate] = tracker.getMostExpensiveRequests.mock.calls[0]!;
    expect(startDate).toBeInstanceOf(Date);
    const diff = Math.abs((startDate as Date).getTime() - before.getTime());
    expect(diff).toBeLessThan(2000);
  });

  it('returns formatted request records', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([makeExpensiveRecord(0.5)]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    const requests = c['requests'] as Array<Record<string, unknown>>;
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r['timestamp']).toBe('2026-02-21T10:00:00Z');
    expect(r['provider']).toBe('openai');
    expect(r['model']).toBe('gpt-4o');
    expect(r['cost']).toBe('$0.50');
    expect(r['costRaw']).toBe(0.5);
    expect(r['inputTokens']).toBe('5000');
    expect(r['outputTokens']).toBe('2000');
    expect(r['latency']).toBe('500ms');
    expect(r['type']).toBe('chat');
  });

  it('returns empty array when no expensive requests', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    const requests = c['requests'] as Array<unknown>;
    expect(requests).toHaveLength(0);
  });

  it('returns multiple records', async () => {
    const { tracker, run } = setup();
    tracker.getMostExpensiveRequests.mockResolvedValue([
      makeExpensiveRecord(1.5),
      makeExpensiveRecord(0.8),
      makeExpensiveRecord(0.3),
    ]);
    const result = await run({ limit: 3 }, dummyContext);
    const requests = (result.content as Record<string, unknown>)['requests'] as Array<unknown>;
    expect(requests).toHaveLength(3);
  });
});

// =============================================================================
// get_cost_recommendations
// =============================================================================

describe('get_cost_recommendations', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { tracker, executorMap, run: executorMap['get_cost_recommendations']! };
  }

  it('calls generateRecommendations with tracker', async () => {
    const { tracker, run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([]);
    await run({}, dummyContext);
    expect(generateRecommendations).toHaveBeenCalledWith(tracker);
  });

  it('returns special message for empty recommendations', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['message']).toBe('No cost optimization recommendations at this time.');
    expect(c['recommendations']).toEqual([]);
  });

  it('does not include totalPotentialSavings for empty recommendations', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['totalPotentialSavings']).toBeUndefined();
  });

  it('maps non-empty recommendations correctly', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([
      {
        type: 'model_switch',
        title: 'Switch from GPT-4o to Gemini',
        description: 'Save by using Gemini',
        currentCost: 10,
        potentialCost: 3,
        estimatedSavings: 7,
      },
    ]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['message']).toBeUndefined();
    const recs = c['recommendations'] as Array<Record<string, unknown>>;
    expect(recs).toHaveLength(1);
    expect(recs[0]!['type']).toBe('model_switch');
    expect(recs[0]!['title']).toBe('Switch from GPT-4o to Gemini');
    expect(recs[0]!['description']).toBe('Save by using Gemini');
    expect(recs[0]!['currentCost']).toBe('$10.00');
    expect(recs[0]!['potentialCost']).toBe('$3.00');
    expect(recs[0]!['estimatedSavings']).toBe('$7.00');
  });

  it('calculates savingsPercent correctly', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([
      {
        type: 'model_switch',
        title: 'Switch',
        description: 'desc',
        currentCost: 10,
        potentialCost: 3,
        estimatedSavings: 7,
      },
    ]);
    const result = await run({}, dummyContext);
    const recs = (result.content as Record<string, unknown>)['recommendations'] as Array<Record<string, unknown>>;
    // (7/10)*100 = 70.0
    expect(recs[0]!['savingsPercent']).toBe('70.0%');
  });

  it('calculates savingsPercent for fractional savings', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([
      {
        type: 'prompt_optimization',
        title: 'Optimize',
        description: 'desc',
        currentCost: 3,
        potentialCost: 2,
        estimatedSavings: 1,
      },
    ]);
    const result = await run({}, dummyContext);
    const recs = (result.content as Record<string, unknown>)['recommendations'] as Array<Record<string, unknown>>;
    // (1/3)*100 = 33.3%
    expect(recs[0]!['savingsPercent']).toBe('33.3%');
  });

  it('computes totalPotentialSavings from all recommendations', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([
      {
        type: 'model_switch',
        title: 'A',
        description: 'desc',
        currentCost: 10,
        potentialCost: 3,
        estimatedSavings: 7,
      },
      {
        type: 'prompt_optimization',
        title: 'B',
        description: 'desc',
        currentCost: 5,
        potentialCost: 3.5,
        estimatedSavings: 1.5,
      },
    ]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    // 7 + 1.5 = 8.5
    expect(c['totalPotentialSavings']).toBe('$8.50');
  });

  it('handles single recommendation', async () => {
    const { run } = setup();
    vi.mocked(generateRecommendations).mockResolvedValue([
      {
        type: 'caching',
        title: 'Cache it',
        description: 'Use caching',
        currentCost: 20,
        potentialCost: 15,
        estimatedSavings: 5,
      },
    ]);
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['totalPotentialSavings']).toBe('$5.00');
    const recs = c['recommendations'] as Array<unknown>;
    expect(recs).toHaveLength(1);
  });
});

// =============================================================================
// compare_model_costs
// =============================================================================

describe('compare_model_costs', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { executorMap, run: executorMap['compare_model_costs']! };
  }

  it('returns all models when no filters', async () => {
    const { run } = setup();
    const result = await run({}, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    const models = c['models'] as Array<Record<string, unknown>>;
    expect(models).toHaveLength(4);
  });

  it('sorts models by inputPricePerMillion ascending', async () => {
    const { run } = setup();
    const result = await run({}, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ model: string }>;
    // groq 0.24, google 0.5, anthropic 3, openai 5
    expect(models[0]!.model).toBe('mixtral-8x7b');
    expect(models[1]!.model).toBe('gemini-pro');
    expect(models[2]!.model).toBe('claude-3-sonnet');
    expect(models[3]!.model).toBe('gpt-4o');
  });

  it('filters by providers', async () => {
    const { run } = setup();
    const result = await run({ providers: ['openai', 'anthropic'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ provider: string }>;
    expect(models).toHaveLength(2);
    for (const m of models) {
      expect(['openai', 'anthropic']).toContain(m.provider);
    }
  });

  it('filters by single provider', async () => {
    const { run } = setup();
    const result = await run({ providers: ['google'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ provider: string }>;
    expect(models).toHaveLength(1);
    expect(models[0]!.provider).toBe('google');
  });

  it('returns empty when providers filter matches none', async () => {
    const { run } = setup();
    const result = await run({ providers: ['nonexistent'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<unknown>;
    expect(models).toHaveLength(0);
  });

  it('does not filter when providers is empty array', async () => {
    const { run } = setup();
    const result = await run({ providers: [] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<unknown>;
    expect(models).toHaveLength(4);
  });

  it('filters by minContextWindow', async () => {
    const { run } = setup();
    const result = await run({ minContextWindow: 100000 }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ model: string }>;
    // openai 128000, anthropic 200000 qualify; google 32000 and groq 32000 do not
    expect(models).toHaveLength(2);
    const modelNames = models.map(m => m.model);
    expect(modelNames).toContain('gpt-4o');
    expect(modelNames).toContain('claude-3-sonnet');
  });

  it('filters by supportsFunctions true', async () => {
    const { run } = setup();
    const result = await run({ supportsFunctions: true }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ model: string }>;
    // groq has supportsFunctions: false
    expect(models).toHaveLength(3);
    const modelNames = models.map(m => m.model);
    expect(modelNames).not.toContain('mixtral-8x7b');
  });

  it('filters by supportsFunctions false', async () => {
    const { run } = setup();
    const result = await run({ supportsFunctions: false }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ model: string }>;
    expect(models).toHaveLength(1);
    expect(models[0]!.model).toBe('mixtral-8x7b');
  });

  it('combines multiple filters', async () => {
    const { run } = setup();
    const result = await run({
      providers: ['openai', 'anthropic', 'google'],
      minContextWindow: 100000,
      supportsFunctions: true,
    }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<{ model: string }>;
    // openai (128000, functions=true) and anthropic (200000, functions=true)
    // google (32000) excluded by context window
    expect(models).toHaveLength(2);
  });

  it('formats inputPrice and outputPrice correctly', async () => {
    const { run } = setup();
    const result = await run({ providers: ['openai'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<Record<string, unknown>>;
    expect(models[0]!['inputPrice']).toBe('$5.00/1M tokens');
    expect(models[0]!['outputPrice']).toBe('$15.00/1M tokens');
  });

  it('includes correct model properties', async () => {
    const { run } = setup();
    const result = await run({ providers: ['openai'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<Record<string, unknown>>;
    const m = models[0]!;
    expect(m['provider']).toBe('openai');
    expect(m['model']).toBe('gpt-4o');
    expect(m['displayName']).toBe('GPT-4o');
    expect(m['contextWindow']).toBe('128000');
    expect(m['maxOutput']).toBe('16384');
    expect(m['supportsVision']).toBe(true);
    expect(m['supportsFunctions']).toBe(true);
  });

  it('calculates costPer1000Requests correctly', async () => {
    const { run } = setup();
    const result = await run({ providers: ['openai'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<Record<string, unknown>>;
    // (1000 * 5 + 500 * 15) / 1_000_000 = (5000 + 7500) / 1_000_000 = 0.0125
    expect(models[0]!['costPer1000Requests']).toBe('$0.01');
  });

  it('handles model without supportsVision (defaults to false)', async () => {
    const { run } = setup();
    const result = await run({ providers: ['groq'] }, dummyContext);
    const models = (result.content as Record<string, unknown>)['models'] as Array<Record<string, unknown>>;
    expect(models[0]!['supportsVision']).toBe(false);
  });
});

// =============================================================================
// export_usage
// =============================================================================

describe('export_usage', () => {
  function setup() {
    const tracker = makeTracker();
    const budget = makeBudgetMgr();
    const executorMap = createCostToolExecutors(
      () => tracker as never,
      () => budget as never,
    );
    return { tracker, executorMap, run: executorMap['export_usage']! };
  }

  it('calls exportUsage with correct format for JSON', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('[]');
    await run({ format: 'json', period: 'week' }, dummyContext);
    const [, , format] = tracker.exportUsage.mock.calls[0]!;
    expect(format).toBe('json');
  });

  it('calls exportUsage with correct format for CSV', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('header\nrow1');
    await run({ format: 'csv', period: 'week' }, dummyContext);
    const [, , format] = tracker.exportUsage.mock.calls[0]!;
    expect(format).toBe('csv');
  });

  it('sets startDate 7 days ago for period "week"', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('[]');
    const before = new Date();
    before.setDate(before.getDate() - 7);
    await run({ format: 'json', period: 'week' }, dummyContext);
    const [start] = tracker.exportUsage.mock.calls[0]!;
    const diff = Math.abs((start as Date).getTime() - before.getTime());
    expect(diff).toBeLessThan(2000);
  });

  it('sets startDate 1 month ago for period "month"', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('[]');
    const before = new Date();
    before.setMonth(before.getMonth() - 1);
    await run({ format: 'json', period: 'month' }, dummyContext);
    const [start] = tracker.exportUsage.mock.calls[0]!;
    const diff = Math.abs((start as Date).getTime() - before.getTime());
    expect(diff).toBeLessThan(2000);
  });

  it('sets startDate to year 2000 for period "all"', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('[]');
    await run({ format: 'json', period: 'all' }, dummyContext);
    const [start] = tracker.exportUsage.mock.calls[0]!;
    expect((start as Date).getFullYear()).toBe(2000);
  });

  it('returns success with data and format', async () => {
    const { tracker, run } = setup();
    const csvData = 'header\nrow1\nrow2';
    tracker.exportUsage.mockResolvedValue(csvData);
    const result = await run({ format: 'csv', period: 'week' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['success']).toBe(true);
    expect(c['format']).toBe('csv');
    expect(c['period']).toBe('week');
    expect(c['data']).toBe(csvData);
  });

  it('computes recordCount from newline split (minus 1 for header)', async () => {
    const { tracker, run } = setup();
    // 1 header + 3 data lines = 4 lines total, split gives 4 elements, minus 1 = 3
    tracker.exportUsage.mockResolvedValue('header\nrow1\nrow2\nrow3');
    const result = await run({ format: 'csv', period: 'week' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['recordCount']).toBe(3);
  });

  it('recordCount is 0 for single line (header only)', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('header');
    const result = await run({ format: 'csv', period: 'week' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['recordCount']).toBe(0);
  });

  it('recordCount works for JSON format too', async () => {
    const { tracker, run } = setup();
    // JSON with 2 newlines: split gives 3 elements, minus 1 = 2
    tracker.exportUsage.mockResolvedValue('[\n{},\n{}]');
    const result = await run({ format: 'json', period: 'all' }, dummyContext);
    const c = result.content as Record<string, unknown>;
    expect(c['recordCount']).toBe(2);
  });

  it('endDate is approximately now', async () => {
    const { tracker, run } = setup();
    tracker.exportUsage.mockResolvedValue('[]');
    const before = Date.now();
    await run({ format: 'json', period: 'week' }, dummyContext);
    const after = Date.now();
    const [, end] = tracker.exportUsage.mock.calls[0]!;
    const endTime = (end as Date).getTime();
    expect(endTime).toBeGreaterThanOrEqual(before);
    expect(endTime).toBeLessThanOrEqual(after);
  });
});

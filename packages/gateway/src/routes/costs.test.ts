/**
 * Cost Tracking Routes Tests
 *
 * Integration tests for the costs API endpoints.
 * Mocks UsageTracker and BudgetManager from core.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSummary = {
  totalRequests: 100,
  successfulRequests: 95,
  failedRequests: 5,
  totalInputTokens: 50000,
  totalOutputTokens: 25000,
  totalCost: 1.25,
  averageLatencyMs: 450,
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  byProvider: {
    openai: {
      requests: 60,
      inputTokens: 30000,
      outputTokens: 15000,
      cost: 0.75,
      averageLatencyMs: 400,
    },
    anthropic: {
      requests: 40,
      inputTokens: 20000,
      outputTokens: 10000,
      cost: 0.5,
      averageLatencyMs: 500,
    },
  },
  byModel: {
    'gpt-4': {
      provider: 'openai',
      requests: 60,
      inputTokens: 30000,
      outputTokens: 15000,
      cost: 0.75,
      averageLatencyMs: 400,
    },
  },
  daily: [{ date: '2026-01-15', requests: 10, cost: 0.15, inputTokens: 5000, outputTokens: 2500 }],
};

const mockBudgetStatus = {
  daily: { limit: 10, used: 1.25, remaining: 8.75, percentage: 12.5 },
  weekly: { limit: 50, used: 5.0, remaining: 45.0, percentage: 10 },
  monthly: { limit: 200, used: 20.0, remaining: 180.0, percentage: 10 },
  alerts: [],
};

const mockUsageTracker = {
  initialize: vi.fn(),
  getSummary: vi.fn(async () => mockSummary),
  getUsage: vi.fn(async () => []),
  getMostExpensiveRequests: vi.fn(async () => []),
  record: vi.fn(async () => ({ id: 'rec-1', cost: 0.05 })),
  exportUsage: vi.fn(async () => '[]'),
};

const mockBudgetManager = {
  getStatus: vi.fn(async () => mockBudgetStatus),
  configure: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    UsageTracker: vi.fn(function () {
      return mockUsageTracker;
    }),
    BudgetManager: vi.fn(function () {
      return mockBudgetManager;
    }),
    formatCost: vi.fn((cost: number) => `$${cost.toFixed(2)}`),
    formatTokens: vi.fn((tokens: number) => `${tokens}`),
    estimateCost: vi.fn(
      (_provider: string, _model: string, _text: string, _outputTokens: number) => ({
        provider: 'openai',
        model: 'gpt-4',
        estimatedInputTokens: 100,
        estimatedOutputTokens: 500,
        estimatedCost: 0.02,
      })
    ),
    MODEL_PRICING: [
      {
        provider: 'openai',
        modelId: 'gpt-4',
        displayName: 'GPT-4',
        inputPricePerMillion: 30,
        outputPricePerMillion: 60,
        contextWindow: 8192,
        maxOutput: 4096,
        supportsVision: false,
        supportsFunctions: true,
        updatedAt: '2026-01-01',
      },
      {
        provider: 'anthropic',
        modelId: 'claude-3-opus',
        displayName: 'Claude 3 Opus',
        inputPricePerMillion: 15,
        outputPricePerMillion: 75,
        contextWindow: 200000,
        maxOutput: 4096,
        supportsVision: true,
        supportsFunctions: true,
        updatedAt: '2026-01-01',
      },
    ],
  };
});

// Import after mocks
const { costRoutes } = await import('./costs.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/costs', costRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cost Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /costs
  // ========================================================================

  describe('GET /costs', () => {
    it('returns cost summary with budget status', async () => {
      const res = await app.request('/costs');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.summary.totalRequests).toBe(100);
      expect(json.data.summary.totalCostFormatted).toBe('$1.25');
      expect(json.data.budget).toBeDefined();
    });

    it('accepts period parameter', async () => {
      const res = await app.request('/costs?period=week');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.period).toBe('week');
    });
  });

  // ========================================================================
  // GET /costs/usage
  // ========================================================================

  describe('GET /costs/usage', () => {
    it('returns daily and monthly usage stats', async () => {
      const res = await app.request('/costs/usage');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.daily).toBeDefined();
      expect(json.data.monthly).toBeDefined();
      expect(json.data.daily.totalCostFormatted).toBeDefined();
    });
  });

  // ========================================================================
  // GET /costs/breakdown
  // ========================================================================

  describe('GET /costs/breakdown', () => {
    it('returns cost breakdown by provider and model', async () => {
      const res = await app.request('/costs/breakdown');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.byProvider).toBeDefined();
      expect(json.data.byModel).toBeDefined();
      expect(json.data.daily).toBeDefined();
      expect(json.data.byProvider[0].percentOfTotal).toBeDefined();
    });
  });

  // ========================================================================
  // GET /costs/models
  // ========================================================================

  describe('GET /costs/models', () => {
    it('returns model pricing information', async () => {
      const res = await app.request('/costs/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.models).toHaveLength(2);
      expect(json.data.providers).toContain('openai');
    });

    it('filters by provider', async () => {
      const res = await app.request('/costs/models?provider=openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.models).toHaveLength(1);
      expect(json.data.models[0].provider).toBe('openai');
    });
  });

  // ========================================================================
  // POST /costs/estimate
  // ========================================================================

  describe('POST /costs/estimate', () => {
    it('estimates cost for a request', async () => {
      const res = await app.request('/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4', text: 'Hello world' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.estimatedCost).toBeDefined();
      expect(json.data.estimatedCostFormatted).toBeDefined();
    });

    it('returns 400 when provider or model is missing', async () => {
      const res = await app.request('/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /costs/budget
  // ========================================================================

  describe('GET /costs/budget', () => {
    it('returns budget configuration and status', async () => {
      const res = await app.request('/costs/budget');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status.daily).toBeDefined();
      expect(json.data.status.monthly).toBeDefined();
    });
  });

  // ========================================================================
  // POST /costs/budget
  // ========================================================================

  describe('POST /costs/budget', () => {
    it('configures budget limits', async () => {
      const res = await app.request('/costs/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyLimit: 5, monthlyLimit: 100 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('configured');
      expect(mockBudgetManager.configure).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // GET /costs/history
  // ========================================================================

  describe('GET /costs/history', () => {
    it('returns usage history records', async () => {
      mockUsageTracker.getUsage.mockResolvedValue([
        {
          id: 'r1',
          provider: 'openai',
          model: 'gpt-4',
          cost: 0.05,
          timestamp: '2026-01-15T10:00:00Z',
        },
      ]);

      const res = await app.request('/costs/history?limit=10&days=7');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.records).toHaveLength(1);
      expect(json.data.limit).toBe(10);
      expect(json.data.days).toBe(7);
    });
  });

  // ========================================================================
  // GET /costs/expensive
  // ========================================================================

  describe('GET /costs/expensive', () => {
    it('returns most expensive requests', async () => {
      mockUsageTracker.getMostExpensiveRequests.mockResolvedValue([
        { id: 'r1', cost: 0.5, provider: 'openai', model: 'gpt-4' },
      ]);

      const res = await app.request('/costs/expensive');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.records).toHaveLength(1);
    });
  });

  // ========================================================================
  // POST /costs/record
  // ========================================================================

  describe('POST /costs/record', () => {
    it('records a usage entry', async () => {
      const res = await app.request('/costs/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 1000,
          outputTokens: 500,
          latencyMs: 350,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.recordId).toBe('rec-1');
      expect(json.data.costFormatted).toBeDefined();
      expect(json.data.budgetStatus).toBeDefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.request('/costs/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /costs/export
  // ========================================================================

  describe('GET /costs/export', () => {
    it('returns JSON export by default', async () => {
      mockUsageTracker.exportUsage.mockResolvedValue('[]');

      const res = await app.request('/costs/export');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns CSV export when format=csv', async () => {
      mockUsageTracker.exportUsage.mockResolvedValue('provider,model,cost\nopenai,gpt-4,0.05');

      const res = await app.request('/costs/export?format=csv');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/csv');
    });
  });
});

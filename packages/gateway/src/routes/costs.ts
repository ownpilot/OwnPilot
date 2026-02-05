/**
 * Cost Tracking Routes
 *
 * REST API endpoints for LLM usage cost tracking and budget management
 */

import { Hono } from 'hono';
import {
  UsageTracker,
  BudgetManager,
  estimateCost,
  MODEL_PRICING,
  formatCost,
  type AIProvider,
  type BudgetConfig,
} from '@ownpilot/core';
import { getLog } from '../services/log.js';
import { apiResponse, apiError, getIntParam, getUserId, ERROR_CODES } from './helpers.js';

const log = getLog('Costs');

export const costRoutes = new Hono();

// Initialize usage tracker
const usageTracker = new UsageTracker();

// Initialize budget manager with tracker
const budgetManager = new BudgetManager(usageTracker);

// Initialize tracker
(async () => {
  try {
    await usageTracker.initialize();
  } catch (error) {
    log.error('Failed to initialize usage tracker', { error });
  }
})();

/**
 * Helper to get period start date
 */
function getPeriodStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  const now = new Date();
  switch (period) {
    case 'day':
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return today;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      return weekStart;
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

/**
 * GET /costs - Get cost summary
 */
costRoutes.get('/', async (c) => {
  const period = (c.req.query('period') ?? 'month') as 'day' | 'week' | 'month' | 'year';
  const userId = getUserId(c); // Use authenticated user, not arbitrary query param

  const startDate = getPeriodStart(period);
  const endDate = new Date();

  const summary = await usageTracker.getSummary(startDate, endDate, userId);
  const budgetStatus = await budgetManager.getStatus();

  return apiResponse(c, {
      period,
      userId: userId ?? 'all',
      summary: {
        totalRequests: summary.totalRequests,
        successfulRequests: summary.successfulRequests,
        failedRequests: summary.failedRequests,
        totalInputTokens: summary.totalInputTokens,
        totalOutputTokens: summary.totalOutputTokens,
        totalCost: summary.totalCost,
        totalCostFormatted: formatCost(summary.totalCost),
        averageLatencyMs: summary.averageLatencyMs,
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
      },
      budget: {
        daily: budgetStatus.daily,
        weekly: budgetStatus.weekly,
        monthly: budgetStatus.monthly,
        alerts: budgetStatus.alerts,
      },
    });
});

/**
 * GET /costs/usage - Get usage stats for UI dashboard
 */
costRoutes.get('/usage', async (c) => {
  const userId = getUserId(c);

  // Get daily stats
  const dailyStart = new Date();
  dailyStart.setHours(0, 0, 0, 0);
  const dailySummary = await usageTracker.getSummary(dailyStart, new Date(), userId);

  // Get monthly stats
  const monthlyStart = new Date();
  monthlyStart.setDate(1);
  monthlyStart.setHours(0, 0, 0, 0);
  const monthlySummary = await usageTracker.getSummary(monthlyStart, new Date(), userId);

  return apiResponse(c, {
      daily: {
        totalTokens: dailySummary.totalInputTokens + dailySummary.totalOutputTokens,
        totalInputTokens: dailySummary.totalInputTokens,
        totalOutputTokens: dailySummary.totalOutputTokens,
        totalCost: dailySummary.totalCost,
        totalCostFormatted: formatCost(dailySummary.totalCost),
        totalRequests: dailySummary.totalRequests,
      },
      monthly: {
        totalTokens: monthlySummary.totalInputTokens + monthlySummary.totalOutputTokens,
        totalInputTokens: monthlySummary.totalInputTokens,
        totalOutputTokens: monthlySummary.totalOutputTokens,
        totalCost: monthlySummary.totalCost,
        totalCostFormatted: formatCost(monthlySummary.totalCost),
        totalRequests: monthlySummary.totalRequests,
      },
    });
});

/**
 * GET /costs/breakdown - Get detailed cost breakdown
 */
costRoutes.get('/breakdown', async (c) => {
  const period = (c.req.query('period') ?? 'month') as 'day' | 'week' | 'month' | 'year';
  const userId = getUserId(c);

  const startDate = getPeriodStart(period);
  const endDate = new Date();

  const summary = await usageTracker.getSummary(startDate, endDate, userId);

  // Format provider breakdown
  const byProvider = Object.entries(summary.byProvider).map(([provider, stats]) => ({
    provider,
    requests: stats.requests,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cost: stats.cost,
    costFormatted: formatCost(stats.cost),
    averageLatencyMs: stats.averageLatencyMs,
    percentOfTotal: summary.totalCost > 0 ? (stats.cost / summary.totalCost) * 100 : 0,
  }));

  // Format model breakdown
  const byModel = Object.entries(summary.byModel).map(([model, stats]) => ({
    model,
    provider: stats.provider,
    requests: stats.requests,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cost: stats.cost,
    costFormatted: formatCost(stats.cost),
    averageLatencyMs: stats.averageLatencyMs,
    percentOfTotal: summary.totalCost > 0 ? (stats.cost / summary.totalCost) * 100 : 0,
  }));

  // Sort by cost descending
  byProvider.sort((a, b) => b.cost - a.cost);
  byModel.sort((a, b) => b.cost - a.cost);

  return apiResponse(c, {
      period,
      userId: userId ?? 'all',
      totalCost: summary.totalCost,
      totalCostFormatted: formatCost(summary.totalCost),
      byProvider,
      byModel,
      daily: summary.daily.map((d) => ({
        date: d.date,
        requests: d.requests,
        cost: d.cost,
        costFormatted: formatCost(d.cost),
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
      })),
    });
});

/**
 * GET /costs/models - Get model pricing information
 */
costRoutes.get('/models', (c) => {
  const provider = c.req.query('provider') as AIProvider | undefined;

  let models = MODEL_PRICING;

  if (provider) {
    models = models.filter((m) => m.provider === provider);
  }

  return apiResponse(c, {
      models: models.map((m) => ({
        provider: m.provider,
        modelId: m.modelId,
        displayName: m.displayName,
        inputPrice: m.inputPricePerMillion,
        outputPrice: m.outputPricePerMillion,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        supportsVision: m.supportsVision ?? false,
        supportsFunctions: m.supportsFunctions ?? false,
        updatedAt: m.updatedAt,
      })),
      providers: [...new Set(MODEL_PRICING.map((m) => m.provider))],
    });
});

/**
 * POST /costs/estimate - Estimate cost for a request
 */
costRoutes.post('/estimate', async (c) => {
  try {
    const body = await c.req.json<{
      provider: AIProvider;
      model: string;
      inputTokens?: number;
      outputTokens?: number;
      text?: string;
    }>();

    if (!body.provider || !body.model) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'provider and model are required' }, 400);
    }

    // Estimate tokens from text if provided
    const inputText = body.text ?? '';

    const estimate = estimateCost(
      body.provider,
      body.model,
      inputText,
      body.outputTokens ?? 500
    );

    return apiResponse(c, {
        provider: estimate.provider,
        model: estimate.model,
        estimatedInputTokens: estimate.estimatedInputTokens,
        estimatedOutputTokens: estimate.estimatedOutputTokens,
        estimatedCost: estimate.estimatedCost,
        estimatedCostFormatted: formatCost(estimate.estimatedCost),
        note: 'This is an estimate. Actual costs may vary.',
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.ESTIMATION_FAILED, message: error instanceof Error ? error.message : 'Failed to estimate cost' }, 500);
  }
});

/**
 * GET /costs/budget - Get budget configuration and status
 */
costRoutes.get('/budget', async (c) => {
  const status = await budgetManager.getStatus();

  return apiResponse(c, {
      status,
    });
});

/**
 * POST /costs/budget - Set budget configuration
 */
costRoutes.post('/budget', async (c) => {
  try {
    const body = await c.req.json<{
      dailyLimit?: number;
      weeklyLimit?: number;
      monthlyLimit?: number;
      alertThresholds?: number[];
      limitAction?: 'warn' | 'block';
    }>();

    const config: Partial<BudgetConfig> = {};

    const isPositiveFinite = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v > 0;

    if (isPositiveFinite(body.dailyLimit)) config.dailyLimit = body.dailyLimit;
    if (isPositiveFinite(body.weeklyLimit)) config.weeklyLimit = body.weeklyLimit;
    if (isPositiveFinite(body.monthlyLimit)) config.monthlyLimit = body.monthlyLimit;
    if (Array.isArray(body.alertThresholds)) {
      config.alertThresholds = body.alertThresholds
        .filter((v): v is number => typeof v === 'number' && v >= 0 && v <= 100)
        .slice(0, 10);
    }
    if (body.limitAction === 'warn' || body.limitAction === 'block') config.limitAction = body.limitAction;

    budgetManager.configure(config);

    const status = await budgetManager.getStatus();

    return apiResponse(c, {
        message: 'Budget configured successfully',
        status,
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.BUDGET_FAILED, message: error instanceof Error ? error.message : 'Failed to set budget' }, 500);
  }
});

/**
 * GET /costs/history - Get usage history records
 */
costRoutes.get('/history', async (c) => {
  const limit = getIntParam(c, 'limit', 100, 1, 1000);
  const days = getIntParam(c, 'days', 30, 1, 365);
  const userId = getUserId(c);
  const provider = c.req.query('provider') as AIProvider | undefined;
  const model = c.req.query('model');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const records = await usageTracker.getUsage(startDate, new Date(), {
    userId,
    provider,
    model,
  });

  // Limit and sort
  const limitedRecords = records
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return apiResponse(c, {
      records: limitedRecords.map((r) => ({
        ...r,
        costFormatted: formatCost(r.cost),
      })),
      total: records.length,
      limit,
      days,
    });
});

/**
 * GET /costs/expensive - Get most expensive requests
 */
costRoutes.get('/expensive', async (c) => {
  const limit = getIntParam(c, 'limit', 10, 1, 100);
  const days = getIntParam(c, 'days', 30, 1, 365);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const records = await usageTracker.getMostExpensiveRequests(limit, startDate);

  return apiResponse(c, {
      records: records.map((r) => ({
        ...r,
        costFormatted: formatCost(r.cost),
      })),
    });
});

/**
 * POST /costs/record - Record a usage (called internally after each API call)
 */
costRoutes.post('/record', async (c) => {
  try {
    const body = await c.req.json<{
      userId: string;
      sessionId?: string;
      provider: AIProvider;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      latencyMs: number;
      requestType?: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | 'tool';
      cached?: boolean;
      error?: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.provider || !body.model || !body.userId) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'provider, model, and userId are required' }, 400);
    }

    // Record usage
    const record = await usageTracker.record({
      userId: body.userId,
      sessionId: body.sessionId,
      provider: body.provider,
      model: body.model,
      inputTokens: body.inputTokens ?? 0,
      outputTokens: body.outputTokens ?? 0,
      totalTokens: body.totalTokens ?? (body.inputTokens ?? 0) + (body.outputTokens ?? 0),
      latencyMs: body.latencyMs ?? 0,
      requestType: body.requestType ?? 'chat',
      cached: body.cached,
      error: body.error,
      metadata: body.metadata,
    });

    // Check budget
    const budgetStatus = await budgetManager.getStatus();

    return apiResponse(c, {
        recordId: record.id,
        cost: record.cost,
        costFormatted: formatCost(record.cost),
        budgetStatus: {
          daily: budgetStatus.daily,
          alerts: budgetStatus.alerts,
        },
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.RECORD_FAILED, message: error instanceof Error ? error.message : 'Failed to record usage' }, 500);
  }
});

/**
 * GET /costs/export - Export usage data
 */
costRoutes.get('/export', async (c) => {
  const format = (c.req.query('format') ?? 'json') as 'json' | 'csv';
  const days = getIntParam(c, 'days', 30, 1, 365);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const exportData = await usageTracker.exportUsage(startDate, new Date(), format);

  if (format === 'csv') {
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="usage-${new Date().toISOString().split('T')[0]}.csv"`);
    return c.body(exportData);
  }

  return apiResponse(c, JSON.parse(exportData));
});

/**
 * Export tracker and budget manager for use in other routes
 */
export { usageTracker, budgetManager };

/**
 * Cost Tracking Tools
 *
 * Tools for the AI assistant to display and manage costs
 */

import type { ToolDefinition, ToolExecutor, ToolContext } from '../agent/types.js';
import type {
  UsageTracker,
  BudgetManager,
  UsageSummary,
  BudgetStatus,
  CostRecommendation,
  AIProvider,
} from './index.js';
import {
  formatCost,
  formatTokens,
  generateRecommendations,
  MODEL_PRICING,
} from './index.js';

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Get cost summary tool
 */
export const GET_COST_SUMMARY_TOOL: ToolDefinition = {
  name: 'get_cost_summary',
  description: 'Get AI usage cost summary for today, this week, or this month',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'week', 'month', 'custom'],
        description: 'Time period for the summary',
      },
      startDate: {
        type: 'string',
        description: 'Start date (ISO format) for custom period',
      },
      endDate: {
        type: 'string',
        description: 'End date (ISO format) for custom period',
      },
    },
    required: ['period'],
  },
};

/**
 * Get budget status tool
 */
export const GET_BUDGET_STATUS_TOOL: ToolDefinition = {
  name: 'get_budget_status',
  description: 'Check current spending against budget limits',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Set budget limit tool
 */
export const SET_BUDGET_TOOL: ToolDefinition = {
  name: 'set_budget',
  description: 'Set spending limits (daily, weekly, monthly)',
  parameters: {
    type: 'object',
    properties: {
      dailyLimit: {
        type: 'number',
        description: 'Daily spending limit in USD',
      },
      weeklyLimit: {
        type: 'number',
        description: 'Weekly spending limit in USD',
      },
      monthlyLimit: {
        type: 'number',
        description: 'Monthly spending limit in USD',
      },
      perRequestLimit: {
        type: 'number',
        description: 'Maximum cost per single request in USD',
      },
    },
  },
};

/**
 * Get cost breakdown tool
 */
export const GET_COST_BREAKDOWN_TOOL: ToolDefinition = {
  name: 'get_cost_breakdown',
  description: 'Get detailed cost breakdown by provider, model, or day',
  parameters: {
    type: 'object',
    properties: {
      groupBy: {
        type: 'string',
        enum: ['provider', 'model', 'day'],
        description: 'How to group the costs',
      },
      period: {
        type: 'string',
        enum: ['today', 'week', 'month'],
        description: 'Time period',
      },
    },
    required: ['groupBy', 'period'],
  },
};

/**
 * Get expensive requests tool
 */
export const GET_EXPENSIVE_REQUESTS_TOOL: ToolDefinition = {
  name: 'get_expensive_requests',
  description: 'Find the most expensive API requests',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of requests to return (default: 10)',
      },
      period: {
        type: 'string',
        enum: ['today', 'week', 'month', 'all'],
        description: 'Time period to search',
      },
    },
  },
};

/**
 * Get cost recommendations tool
 */
export const GET_COST_RECOMMENDATIONS_TOOL: ToolDefinition = {
  name: 'get_cost_recommendations',
  description: 'Get recommendations for reducing AI costs',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Compare model costs tool
 */
export const COMPARE_MODEL_COSTS_TOOL: ToolDefinition = {
  name: 'compare_model_costs',
  description: 'Compare pricing between different AI models',
  parameters: {
    type: 'object',
    properties: {
      providers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by providers (openai, anthropic, google, groq, mistral)',
      },
      minContextWindow: {
        type: 'number',
        description: 'Minimum context window size',
      },
      supportsFunctions: {
        type: 'boolean',
        description: 'Filter models that support function calling',
      },
    },
  },
};

/**
 * Export usage data tool
 */
export const EXPORT_USAGE_TOOL: ToolDefinition = {
  name: 'export_usage',
  description: 'Export usage data as JSON or CSV',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['json', 'csv'],
        description: 'Export format',
      },
      period: {
        type: 'string',
        enum: ['week', 'month', 'all'],
        description: 'Time period to export',
      },
    },
    required: ['format', 'period'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

/**
 * Create cost tracking tool executors
 */
export function createCostToolExecutors(
  getTracker: () => UsageTracker,
  getBudgetMgr: () => BudgetManager
): Record<string, ToolExecutor> {
  return {
    get_cost_summary: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        period: 'today' | 'week' | 'month' | 'custom';
        startDate?: string;
        endDate?: string;
      };

      const tracker = getTracker();
      let summary: UsageSummary;

      switch (args.period) {
        case 'today':
          summary = await tracker.getTodayUsage();
          break;
        case 'week':
          summary = await tracker.getWeekUsage();
          break;
        case 'month':
          summary = await tracker.getMonthUsage();
          break;
        case 'custom':
          if (!args.startDate) {
            return {
              content: { success: false, error: 'startDate required for custom period' },
            };
          }
          summary = await tracker.getSummary(
            new Date(args.startDate),
            args.endDate ? new Date(args.endDate) : new Date()
          );
          break;
      }

      return {
        content: {
          success: true,
          period: args.period,
          summary: {
            totalCost: formatCost(summary.totalCost),
            totalCostRaw: summary.totalCost,
            totalRequests: summary.totalRequests,
            successRate: summary.totalRequests > 0
              ? `${((summary.successfulRequests / summary.totalRequests) * 100).toFixed(1)}%`
              : 'N/A',
            totalTokens: formatTokens(summary.totalInputTokens + summary.totalOutputTokens),
            inputTokens: formatTokens(summary.totalInputTokens),
            outputTokens: formatTokens(summary.totalOutputTokens),
            averageLatency: `${Math.round(summary.averageLatencyMs)}ms`,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
          },
          topProviders: Object.entries(summary.byProvider)
            .sort((a, b) => b[1].cost - a[1].cost)
            .slice(0, 3)
            .map(([provider, stats]) => ({
              provider,
              cost: formatCost(stats.cost),
              requests: stats.requests,
            })),
          topModels: Object.entries(summary.byModel)
            .sort((a, b) => b[1].cost - a[1].cost)
            .slice(0, 5)
            .map(([model, stats]) => ({
              model,
              cost: formatCost(stats.cost),
              requests: stats.requests,
            })),
        },
      };
    },

    get_budget_status: async (
      _rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const budgetMgr = getBudgetMgr();
      const status = await budgetMgr.getStatus();

      return {
        content: {
          success: true,
          budget: {
            daily: {
              spent: formatCost(status.daily.spent),
              limit: status.daily.limit ? formatCost(status.daily.limit) : 'No limit',
              percentage: `${status.daily.percentage.toFixed(1)}%`,
              remaining: status.daily.remaining !== undefined
                ? formatCost(status.daily.remaining)
                : 'Unlimited',
            },
            weekly: {
              spent: formatCost(status.weekly.spent),
              limit: status.weekly.limit ? formatCost(status.weekly.limit) : 'No limit',
              percentage: `${status.weekly.percentage.toFixed(1)}%`,
              remaining: status.weekly.remaining !== undefined
                ? formatCost(status.weekly.remaining)
                : 'Unlimited',
            },
            monthly: {
              spent: formatCost(status.monthly.spent),
              limit: status.monthly.limit ? formatCost(status.monthly.limit) : 'No limit',
              percentage: `${status.monthly.percentage.toFixed(1)}%`,
              remaining: status.monthly.remaining !== undefined
                ? formatCost(status.monthly.remaining)
                : 'Unlimited',
            },
          },
          alerts: status.alerts.map(a => ({
            type: a.type,
            message: `${a.type} budget at ${a.threshold}% (${formatCost(a.currentSpend)} / ${formatCost(a.limit)})`,
          })),
        },
      };
    },

    set_budget: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        dailyLimit?: number;
        weeklyLimit?: number;
        monthlyLimit?: number;
        perRequestLimit?: number;
      };

      const budgetMgr = getBudgetMgr();
      budgetMgr.configure(args);

      return {
        content: {
          success: true,
          message: 'Budget limits updated',
          newLimits: {
            daily: args.dailyLimit ? formatCost(args.dailyLimit) : 'Not set',
            weekly: args.weeklyLimit ? formatCost(args.weeklyLimit) : 'Not set',
            monthly: args.monthlyLimit ? formatCost(args.monthlyLimit) : 'Not set',
            perRequest: args.perRequestLimit ? formatCost(args.perRequestLimit) : 'Not set',
          },
        },
      };
    },

    get_cost_breakdown: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        groupBy: 'provider' | 'model' | 'day';
        period: 'today' | 'week' | 'month';
      };

      const tracker = getTracker();
      let summary: UsageSummary;

      switch (args.period) {
        case 'today':
          summary = await tracker.getTodayUsage();
          break;
        case 'week':
          summary = await tracker.getWeekUsage();
          break;
        case 'month':
          summary = await tracker.getMonthUsage();
          break;
      }

      let breakdown: Array<{ name: string; cost: string; costRaw: number; requests: number; tokens: string }>;

      switch (args.groupBy) {
        case 'provider':
          breakdown = Object.entries(summary.byProvider)
            .sort((a, b) => b[1].cost - a[1].cost)
            .map(([name, stats]) => ({
              name,
              cost: formatCost(stats.cost),
              costRaw: stats.cost,
              requests: stats.requests,
              tokens: formatTokens(stats.inputTokens + stats.outputTokens),
            }));
          break;

        case 'model':
          breakdown = Object.entries(summary.byModel)
            .sort((a, b) => b[1].cost - a[1].cost)
            .map(([name, stats]) => ({
              name,
              cost: formatCost(stats.cost),
              costRaw: stats.cost,
              requests: stats.requests,
              tokens: formatTokens(stats.inputTokens + stats.outputTokens),
            }));
          break;

        case 'day':
          breakdown = summary.daily.map(d => ({
            name: d.date,
            cost: formatCost(d.cost),
            costRaw: d.cost,
            requests: d.requests,
            tokens: formatTokens(d.inputTokens + d.outputTokens),
          }));
          break;
      }

      return {
        content: {
          success: true,
          period: args.period,
          groupBy: args.groupBy,
          totalCost: formatCost(summary.totalCost),
          breakdown,
        },
      };
    },

    get_expensive_requests: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        limit?: number;
        period?: 'today' | 'week' | 'month' | 'all';
      };

      const tracker = getTracker();
      const limit = args.limit ?? 10;

      let startDate: Date | undefined;
      if (args.period && args.period !== 'all') {
        startDate = new Date();
        switch (args.period) {
          case 'today':
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'week':
            startDate.setDate(startDate.getDate() - 7);
            break;
          case 'month':
            startDate.setMonth(startDate.getMonth() - 1);
            break;
        }
      }

      const expensive = await tracker.getMostExpensiveRequests(limit, startDate);

      return {
        content: {
          success: true,
          requests: expensive.map(r => ({
            timestamp: r.timestamp,
            provider: r.provider,
            model: r.model,
            cost: formatCost(r.cost),
            costRaw: r.cost,
            inputTokens: formatTokens(r.inputTokens),
            outputTokens: formatTokens(r.outputTokens),
            latency: `${r.latencyMs}ms`,
            type: r.requestType,
          })),
        },
      };
    },

    get_cost_recommendations: async (
      _rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const tracker = getTracker();
      const recommendations = await generateRecommendations(tracker);

      if (recommendations.length === 0) {
        return {
          content: {
            success: true,
            message: 'No cost optimization recommendations at this time.',
            recommendations: [],
          },
        };
      }

      return {
        content: {
          success: true,
          recommendations: recommendations.map(r => ({
            type: r.type,
            title: r.title,
            description: r.description,
            currentCost: formatCost(r.currentCost),
            potentialCost: formatCost(r.potentialCost),
            estimatedSavings: formatCost(r.estimatedSavings),
            savingsPercent: `${((r.estimatedSavings / r.currentCost) * 100).toFixed(1)}%`,
          })),
          totalPotentialSavings: formatCost(
            recommendations.reduce((sum, r) => sum + r.estimatedSavings, 0)
          ),
        },
      };
    },

    compare_model_costs: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        providers?: string[];
        minContextWindow?: number;
        supportsFunctions?: boolean;
      };

      let models = [...MODEL_PRICING];

      // Filter by provider
      if (args.providers && args.providers.length > 0) {
        models = models.filter(m => args.providers!.includes(m.provider));
      }

      // Filter by context window
      if (args.minContextWindow) {
        models = models.filter(m => m.contextWindow >= args.minContextWindow!);
      }

      // Filter by function support
      if (args.supportsFunctions !== undefined) {
        models = models.filter(m => m.supportsFunctions === args.supportsFunctions);
      }

      // Sort by cost (cheapest first)
      models.sort((a, b) => a.inputPricePerMillion - b.inputPricePerMillion);

      return {
        content: {
          success: true,
          models: models.map(m => ({
            provider: m.provider,
            model: m.modelId,
            displayName: m.displayName,
            inputPrice: `$${m.inputPricePerMillion.toFixed(2)}/1M tokens`,
            outputPrice: `$${m.outputPricePerMillion.toFixed(2)}/1M tokens`,
            contextWindow: formatTokens(m.contextWindow),
            maxOutput: formatTokens(m.maxOutput),
            supportsVision: m.supportsVision ?? false,
            supportsFunctions: m.supportsFunctions ?? false,
            costPer1000Requests: formatCost(
              (1000 * m.inputPricePerMillion + 500 * m.outputPricePerMillion) / 1_000_000
            ),
          })),
        },
      };
    },

    export_usage: async (
      rawArgs: Record<string, unknown>,
      context: ToolContext
    ) => {
      const args = rawArgs as {
        format: 'json' | 'csv';
        period: 'week' | 'month' | 'all';
      };

      const tracker = getTracker();

      const startDate = new Date();
      switch (args.period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'all':
          startDate.setFullYear(2000); // Get everything
          break;
      }

      const data = await tracker.exportUsage(startDate, new Date(), args.format);

      return {
        content: {
          success: true,
          format: args.format,
          period: args.period,
          data,
          recordCount: data.split('\n').length - 1,
        },
      };
    },
  };
}

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * All cost tracking tools
 */
export const COST_TRACKING_TOOLS: ToolDefinition[] = [
  GET_COST_SUMMARY_TOOL,
  GET_BUDGET_STATUS_TOOL,
  SET_BUDGET_TOOL,
  GET_COST_BREAKDOWN_TOOL,
  GET_EXPENSIVE_REQUESTS_TOOL,
  GET_COST_RECOMMENDATIONS_TOOL,
  COMPARE_MODEL_COSTS_TOOL,
  EXPORT_USAGE_TOOL,
];

/**
 * Create all cost tracking tools
 */
export function createCostTools(
  getTracker: () => UsageTracker,
  getBudgetMgr: () => BudgetManager
): Array<{ definition: ToolDefinition; executor: ToolExecutor }> {
  const executors = createCostToolExecutors(getTracker, getBudgetMgr);

  return COST_TRACKING_TOOLS.map(definition => ({
    definition,
    executor: executors[definition.name]!,
  }));
}

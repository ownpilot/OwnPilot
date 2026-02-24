/**
 * Cost Tracking Types
 */

/**
 * AI Provider
 */
export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'zhipu'
  | 'cohere'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'openrouter'
  | 'xai'
  | 'local'
  | 'custom';

/**
 * Model pricing information
 */
export interface ModelPricing {
  /** Provider */
  provider: AIProvider;
  /** Model ID */
  modelId: string;
  /** Display name */
  displayName: string;
  /** Input price per 1M tokens (USD) */
  inputPricePerMillion: number;
  /** Output price per 1M tokens (USD) */
  outputPricePerMillion: number;
  /** Context window size */
  contextWindow: number;
  /** Max output tokens */
  maxOutput: number;
  /** Supports vision */
  supportsVision?: boolean;
  /** Supports function calling */
  supportsFunctions?: boolean;
  /** Last updated */
  updatedAt: string;
}

/**
 * Usage record for a single API call
 */
export interface UsageRecord {
  /** Unique record ID */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** User ID */
  userId: string;
  /** Session/Conversation ID */
  sessionId?: string;
  /** Provider */
  provider: AIProvider;
  /** Model used */
  model: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Calculated cost (USD) */
  cost: number;
  /** Request latency (ms) */
  latencyMs: number;
  /** Request type */
  requestType: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | 'tool';
  /** Was cached */
  cached?: boolean;
  /** Error if failed */
  error?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Usage summary for a time period
 */
export interface UsageSummary {
  /** Period start */
  periodStart: string;
  /** Period end */
  periodEnd: string;
  /** Total requests */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
  /** Total cost (USD) */
  totalCost: number;
  /** Average latency (ms) */
  averageLatencyMs: number;
  /** By provider */
  byProvider: Record<AIProvider, ProviderUsage>;
  /** By model */
  byModel: Record<string, ModelUsage>;
  /** By user */
  byUser: Record<string, number>;
  /** Daily breakdown */
  daily: DailyUsage[];
}

/**
 * Provider usage breakdown
 */
export interface ProviderUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  averageLatencyMs: number;
}

/**
 * Model usage breakdown
 */
export interface ModelUsage {
  provider: AIProvider;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  averageLatencyMs: number;
}

/**
 * Daily usage
 */
export interface DailyUsage {
  date: string;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Budget configuration
 */
export interface BudgetConfig {
  /** Daily budget (USD) */
  dailyLimit?: number;
  /** Weekly budget (USD) */
  weeklyLimit?: number;
  /** Monthly budget (USD) */
  monthlyLimit?: number;
  /** Per-request limit (USD) */
  perRequestLimit?: number;
  /** Alert thresholds (percentage) */
  alertThresholds: number[];
  /** Action when limit reached */
  limitAction: 'warn' | 'block' | 'downgrade';
  /** Fallback model when downgrading */
  fallbackModel?: string;
}

/**
 * Budget status
 */
export interface BudgetStatus {
  /** Daily spending */
  daily: {
    spent: number;
    limit?: number;
    percentage: number;
    remaining?: number;
  };
  /** Weekly spending */
  weekly: {
    spent: number;
    limit?: number;
    percentage: number;
    remaining?: number;
  };
  /** Monthly spending */
  monthly: {
    spent: number;
    limit?: number;
    percentage: number;
    remaining?: number;
  };
  /** Active alerts */
  alerts: BudgetAlert[];
}

/**
 * Budget alert
 */
export interface BudgetAlert {
  type: 'daily' | 'weekly' | 'monthly';
  threshold: number;
  currentSpend: number;
  limit: number;
  timestamp: string;
}

/**
 * Cost estimate for a request
 */
export interface CostEstimate {
  provider: AIProvider;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  withinBudget: boolean;
  budgetRemaining?: number;
}

/**
 * Cost optimization recommendations
 */
export interface CostRecommendation {
  type: 'model_switch' | 'caching' | 'batching' | 'prompt_optimization';
  title: string;
  description: string;
  estimatedSavings: number;
  currentCost: number;
  potentialCost: number;
}

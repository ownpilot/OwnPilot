/**
 * LLM Cost Tracking & Usage Analytics
 *
 * Comprehensive system for monitoring AI API costs:
 * - Real-time cost calculation per request
 * - Usage tracking by provider, model, user
 * - Budget management with alerts
 * - Historical analytics and reporting
 * - Cost optimization recommendations
 *
 * SUPPORTED PROVIDERS:
 * - OpenAI (GPT-4, GPT-4 Turbo, GPT-3.5, etc.)
 * - Anthropic (Claude 3.5, Claude 3, etc.)
 * - Google (Gemini Pro, Gemini Ultra)
 * - Groq, Mistral, Cohere, and more
 */

import { EventEmitter } from 'node:events';
import { getLog } from '../services/get-log.js';
import { generateId } from '../services/id-utils.js';

const costLog = getLog('Costs');

/** Maximum in-memory records to keep (prevents unbounded growth) */
const MAX_RECORDS = 10_000;

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Model Pricing Database
// =============================================================================

/**
 * Current model pricing (as of January 2026)
 * Prices in USD per 1 million tokens
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 * - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 */
export const MODEL_PRICING: ModelPricing[] = [
  // ==========================================================================
  // OpenAI Models (January 2026)
  // ==========================================================================

  // GPT-5 Series - Latest flagship
  {
    provider: 'openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    contextWindow: 400000,
    maxOutput: 128000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1.2,
    contextWindow: 400000,
    maxOutput: 128000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // GPT-4.1 Series
  {
    provider: 'openai',
    modelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    contextWindow: 1050000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 Nano',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // GPT-4o Series
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // O-Series Reasoning Models
  {
    provider: 'openai',
    modelId: 'o3',
    displayName: 'O3',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o3-mini',
    displayName: 'O3 Mini',
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o1',
    displayName: 'O1',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 60.0,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: false,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o1-mini',
    displayName: 'O1 Mini',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 12.0,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: false,
    updatedAt: '2026-01-26',
  },

  // Legacy OpenAI
  {
    provider: 'openai',
    modelId: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo (Legacy)',
    inputPricePerMillion: 10.0,
    outputPricePerMillion: 30.0,
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Anthropic Claude Models (January 2026)
  // ==========================================================================

  // Claude 4.5 Series - Current Generation
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-opus',
    displayName: 'Claude 4.5 Opus',
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    displayName: 'Claude 4.5 Sonnet',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-haiku',
    displayName: 'Claude 4.5 Haiku',
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 4 Series (Legacy)
  {
    provider: 'anthropic',
    modelId: 'claude-4-opus',
    displayName: 'Claude 4 Opus',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4-sonnet',
    displayName: 'Claude 4 Sonnet',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 3.5 Series
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    inputPricePerMillion: 6.0,
    outputPricePerMillion: 30.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku',
    displayName: 'Claude 3.5 Haiku',
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 3 Series (Budget)
  {
    provider: 'anthropic',
    modelId: 'claude-3-haiku',
    displayName: 'Claude 3 Haiku',
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    contextWindow: 200000,
    maxOutput: 4096,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Google Gemini Models (January 2026)
  // ==========================================================================

  // Gemini 3 Pro Preview
  {
    provider: 'google',
    modelId: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro Preview',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 12.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Gemini 2.5 Series
  {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Gemini 2.0 (Deprecating March 2026)
  {
    provider: 'google',
    modelId: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash (Deprecating)',
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // DeepSeek Models (January 2026) - Ultra Low Cost
  // ==========================================================================
  {
    provider: 'deepseek',
    modelId: 'deepseek-r1',
    displayName: 'DeepSeek R1 (Reasoner)',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 7.0,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-v3.2',
    displayName: 'DeepSeek V3.2',
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 0.4,
    contextWindow: 163840,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-v3.1',
    displayName: 'DeepSeek V3.1',
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
    contextWindow: 128000,
    maxOutput: 8192,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  // ==========================================================================
  // Groq Models (January 2026 - Fast inference)
  // ==========================================================================
  {
    provider: 'groq',
    modelId: 'llama-4-maverick-17b',
    displayName: 'Llama 4 Maverick 17B',
    inputPricePerMillion: 0.24,
    outputPricePerMillion: 0.97,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B',
    inputPricePerMillion: 0.59,
    outputPricePerMillion: 0.79,
    contextWindow: 131072,
    maxOutput: 32768,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'llama-3.1-8b-instant',
    displayName: 'Llama 3.1 8B Instant',
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.08,
    contextWindow: 131072,
    maxOutput: 131072,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'gpt-oss-120b',
    displayName: 'GPT OSS 120B',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 131072,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Mistral Models (January 2026)
  // ==========================================================================
  {
    provider: 'mistral',
    modelId: 'mistral-large-3',
    displayName: 'Mistral Large 3 (675B)',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 6.0,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'devstral-2',
    displayName: 'Devstral 2 (123B)',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 0.9,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'ministral-3-14b',
    displayName: 'Ministral 3 (14B)',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.3,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'codestral-latest',
    displayName: 'Codestral',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.6,
    contextWindow: 32000,
    maxOutput: 8192,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // xAI Grok Models (January 2026)
  // ==========================================================================
  {
    provider: 'xai',
    modelId: 'grok-4',
    displayName: 'Grok 4',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 256000,
    maxOutput: 64000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'xai',
    modelId: 'grok-4-fast',
    displayName: 'Grok 4 Fast',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
    contextWindow: 2000000,
    maxOutput: 30000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'xai',
    modelId: 'grok-3',
    displayName: 'Grok 3',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Local Models (free)
  // ==========================================================================
  {
    provider: 'local',
    modelId: 'local-model',
    displayName: 'Local Model',
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    contextWindow: 8192,
    maxOutput: 4096,
    updatedAt: '2026-01-26',
  },
];

// =============================================================================
// Cost Calculator
// =============================================================================

// Pre-built lookup maps for O(1) exact-match pricing (built once at module load)
const pricingByExactKey = new Map<string, ModelPricing>();
const pricingByProvider = new Map<string, ModelPricing>();
for (const p of MODEL_PRICING) {
  pricingByExactKey.set(`${p.provider}:${p.modelId}`, p);
  if (!pricingByProvider.has(p.provider)) {
    pricingByProvider.set(p.provider, p);
  }
}

/**
 * Get pricing for a model
 */
export function getModelPricing(provider: AIProvider, modelId: string): ModelPricing | null {
  // O(1) exact match
  const exact = pricingByExactKey.get(`${provider}:${modelId}`);
  if (exact) return exact;

  // Partial match for versioned models (e.g. claude-3-5-sonnet-20241022)
  const partial = MODEL_PRICING.find(
    (p) => p.provider === provider && modelId.includes(p.modelId.split('-').slice(0, 3).join('-'))
  );
  if (partial) return partial;

  // Fallback: any model from the same provider
  return pricingByProvider.get(provider) ?? null;
}

/**
 * Calculate cost for a request
 */
export function calculateCost(
  provider: AIProvider,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(provider, modelId);

  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  return inputCost + outputCost;
}

/**
 * Estimate cost for a prompt (before sending)
 */
export function estimateCost(
  provider: AIProvider,
  modelId: string,
  promptText: string,
  estimatedOutputTokens: number = 500
): CostEstimate {
  const _pricing = getModelPricing(provider, modelId);

  // Rough token estimation (1 token ≈ 4 characters for English)
  const estimatedInputTokens = Math.ceil(promptText.length / 4);
  const estimatedCost = calculateCost(
    provider,
    modelId,
    estimatedInputTokens,
    estimatedOutputTokens
  );

  return {
    provider,
    model: modelId,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCost,
    withinBudget: true, // Will be updated by budget manager
  };
}

// =============================================================================
// Usage Tracker
// =============================================================================

/**
 * Usage Tracker - Records and analyzes API usage
 */
export class UsageTracker extends EventEmitter {
  private records: UsageRecord[] = [];
  private initialized = false;

  /**
   * Initialize tracker (no-op, kept for backward compatibility)
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Record a usage event
   */
  async record(usage: Omit<UsageRecord, 'id' | 'timestamp' | 'cost'>): Promise<UsageRecord> {
    await this.ensureInitialized();

    const cost = calculateCost(usage.provider, usage.model, usage.inputTokens, usage.outputTokens);

    const record: UsageRecord = {
      ...usage,
      id: generateId('usage'),
      timestamp: new Date().toISOString(),
      cost,
    };

    this.records.push(record);

    // Cap in-memory records to prevent unbounded growth
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }

    // Emit event for real-time tracking
    this.emit('usage', record);

    return record;
  }

  /**
   * Get usage for a time period
   */
  async getUsage(
    startDate: Date,
    endDate: Date = new Date(),
    filters?: {
      userId?: string;
      provider?: AIProvider;
      model?: string;
    }
  ): Promise<UsageRecord[]> {
    await this.ensureInitialized();

    return this.records.filter((r) => {
      const timestamp = new Date(r.timestamp);
      if (timestamp < startDate || timestamp > endDate) return false;
      if (filters?.userId && r.userId !== filters.userId) return false;
      if (filters?.provider && r.provider !== filters.provider) return false;
      if (filters?.model && r.model !== filters.model) return false;
      return true;
    });
  }

  /**
   * Get usage summary
   */
  async getSummary(
    startDate: Date,
    endDate: Date = new Date(),
    userId?: string
  ): Promise<UsageSummary> {
    const records = await this.getUsage(startDate, endDate, { userId });

    const summary: UsageSummary = {
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      totalRequests: records.length,
      successfulRequests: records.filter((r) => !r.error).length,
      failedRequests: records.filter((r) => r.error).length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      averageLatencyMs: 0,
      byProvider: {} as Record<AIProvider, ProviderUsage>,
      byModel: {},
      byUser: {},
      daily: [],
    };

    // Daily buckets
    const dailyMap = new Map<string, DailyUsage>();

    // Process each record
    let totalLatency = 0;
    for (const record of records) {
      summary.totalInputTokens += record.inputTokens;
      summary.totalOutputTokens += record.outputTokens;
      summary.totalCost += record.cost;
      totalLatency += record.latencyMs;

      // By provider
      if (!summary.byProvider[record.provider]) {
        summary.byProvider[record.provider] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          averageLatencyMs: 0,
        };
      }
      const providerStats = summary.byProvider[record.provider];
      providerStats.requests++;
      providerStats.inputTokens += record.inputTokens;
      providerStats.outputTokens += record.outputTokens;
      providerStats.cost += record.cost;
      providerStats.averageLatencyMs += record.latencyMs;

      // By model
      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = {
          provider: record.provider,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          averageLatencyMs: 0,
        };
      }
      const modelStats = summary.byModel[record.model]!;
      modelStats.requests++;
      modelStats.inputTokens += record.inputTokens;
      modelStats.outputTokens += record.outputTokens;
      modelStats.cost += record.cost;
      modelStats.averageLatencyMs += record.latencyMs;

      // By user
      summary.byUser[record.userId] = (summary.byUser[record.userId] ?? 0) + record.cost;

      // Daily
      const dateKey = record.timestamp.split('T')[0]!;
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          requests: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
        });
      }
      const daily = dailyMap.get(dateKey)!;
      daily.requests++;
      daily.cost += record.cost;
      daily.inputTokens += record.inputTokens;
      daily.outputTokens += record.outputTokens;
    }

    // Calculate averages
    if (records.length > 0) {
      summary.averageLatencyMs = totalLatency / records.length;

      for (const provider of Object.keys(summary.byProvider) as AIProvider[]) {
        const stats = summary.byProvider[provider];
        stats.averageLatencyMs = stats.averageLatencyMs / stats.requests;
      }

      for (const model of Object.keys(summary.byModel)) {
        const stats = summary.byModel[model]!;
        stats.averageLatencyMs = stats.averageLatencyMs / stats.requests;
      }
    }

    // Sort daily by date
    summary.daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return summary;
  }

  /**
   * Get today's usage
   */
  async getTodayUsage(userId?: string): Promise<UsageSummary> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.getSummary(today, new Date(), userId);
  }

  /**
   * Get this week's usage
   */
  async getWeekUsage(userId?: string): Promise<UsageSummary> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    return this.getSummary(weekStart, now, userId);
  }

  /**
   * Get this month's usage
   */
  async getMonthUsage(userId?: string): Promise<UsageSummary> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getSummary(monthStart, now, userId);
  }

  /**
   * Get most expensive requests
   */
  async getMostExpensiveRequests(limit: number = 10, startDate?: Date): Promise<UsageRecord[]> {
    await this.ensureInitialized();

    let records = this.records;
    if (startDate) {
      records = records.filter((r) => new Date(r.timestamp) >= startDate);
    }

    return records.sort((a, b) => b.cost - a.cost).slice(0, limit);
  }

  /**
   * Export usage data
   */
  async exportUsage(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const records = await this.getUsage(startDate, endDate);

    if (format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'userId',
        'provider',
        'model',
        'inputTokens',
        'outputTokens',
        'cost',
        'latencyMs',
        'requestType',
      ].join(',');

      const rows = records.map((r) =>
        [
          r.id,
          r.timestamp,
          r.userId,
          r.provider,
          r.model,
          r.inputTokens,
          r.outputTokens,
          r.cost.toFixed(6),
          r.latencyMs,
          r.requestType,
        ].join(',')
      );

      return [headers, ...rows].join('\n');
    }

    return JSON.stringify(records, null, 2);
  }

  // Private methods

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// =============================================================================
// Budget Manager
// =============================================================================

/**
 * Budget Manager - Manages spending limits and alerts
 */
export class BudgetManager extends EventEmitter {
  private readonly tracker: UsageTracker;
  private config: BudgetConfig;
  private alertsSent: Set<string> = new Set();

  constructor(tracker: UsageTracker, config?: Partial<BudgetConfig>) {
    super();
    this.tracker = tracker;
    this.config = {
      alertThresholds: [50, 75, 90, 100],
      limitAction: 'warn',
      ...config,
    };

    // Listen for usage events
    this.tracker.on('usage', (record: UsageRecord) => {
      this.checkBudget(record).catch((e) => costLog.error('Budget check failed:', e));
    });
  }

  /**
   * Configure budget
   */
  configure(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current budget status
   */
  async getStatus(): Promise<BudgetStatus> {
    const daily = await this.tracker.getTodayUsage();
    const weekly = await this.tracker.getWeekUsage();
    const monthly = await this.tracker.getMonthUsage();

    const status: BudgetStatus = {
      daily: {
        spent: daily.totalCost,
        limit: this.config.dailyLimit,
        percentage: this.config.dailyLimit ? (daily.totalCost / this.config.dailyLimit) * 100 : 0,
        remaining: this.config.dailyLimit
          ? Math.max(0, this.config.dailyLimit - daily.totalCost)
          : undefined,
      },
      weekly: {
        spent: weekly.totalCost,
        limit: this.config.weeklyLimit,
        percentage: this.config.weeklyLimit
          ? (weekly.totalCost / this.config.weeklyLimit) * 100
          : 0,
        remaining: this.config.weeklyLimit
          ? Math.max(0, this.config.weeklyLimit - weekly.totalCost)
          : undefined,
      },
      monthly: {
        spent: monthly.totalCost,
        limit: this.config.monthlyLimit,
        percentage: this.config.monthlyLimit
          ? (monthly.totalCost / this.config.monthlyLimit) * 100
          : 0,
        remaining: this.config.monthlyLimit
          ? Math.max(0, this.config.monthlyLimit - monthly.totalCost)
          : undefined,
      },
      alerts: [],
    };

    // Check for active alerts
    for (const threshold of this.config.alertThresholds) {
      if (status.daily.percentage >= threshold && this.config.dailyLimit) {
        status.alerts.push({
          type: 'daily',
          threshold,
          currentSpend: status.daily.spent,
          limit: this.config.dailyLimit,
          timestamp: new Date().toISOString(),
        });
      }
      if (status.weekly.percentage >= threshold && this.config.weeklyLimit) {
        status.alerts.push({
          type: 'weekly',
          threshold,
          currentSpend: status.weekly.spent,
          limit: this.config.weeklyLimit,
          timestamp: new Date().toISOString(),
        });
      }
      if (status.monthly.percentage >= threshold && this.config.monthlyLimit) {
        status.alerts.push({
          type: 'monthly',
          threshold,
          currentSpend: status.monthly.spent,
          limit: this.config.monthlyLimit,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return status;
  }

  /**
   * Check if a request is within budget
   */
  async canSpend(estimatedCost: number): Promise<{
    allowed: boolean;
    reason?: string;
    recommendation?: string;
  }> {
    const status = await this.getStatus();

    // Check per-request limit
    if (this.config.perRequestLimit && estimatedCost > this.config.perRequestLimit) {
      return {
        allowed: this.config.limitAction === 'warn',
        reason: `Request cost ($${estimatedCost.toFixed(4)}) exceeds per-request limit ($${this.config.perRequestLimit.toFixed(4)})`,
        recommendation: this.config.fallbackModel
          ? `Consider using ${this.config.fallbackModel} instead`
          : 'Consider using a cheaper model',
      };
    }

    // Check daily limit
    if (this.config.dailyLimit) {
      const newDaily = status.daily.spent + estimatedCost;
      if (newDaily > this.config.dailyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Daily budget exceeded ($${newDaily.toFixed(4)} > $${this.config.dailyLimit.toFixed(4)})`,
          recommendation: 'Wait until tomorrow or increase daily limit',
        };
      }
    }

    // Check weekly limit
    if (this.config.weeklyLimit) {
      const newWeekly = status.weekly.spent + estimatedCost;
      if (newWeekly > this.config.weeklyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Weekly budget exceeded ($${newWeekly.toFixed(4)} > $${this.config.weeklyLimit.toFixed(4)})`,
          recommendation: 'Wait until next week or increase weekly limit',
        };
      }
    }

    // Check monthly limit
    if (this.config.monthlyLimit) {
      const newMonthly = status.monthly.spent + estimatedCost;
      if (newMonthly > this.config.monthlyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Monthly budget exceeded ($${newMonthly.toFixed(4)} > $${this.config.monthlyLimit.toFixed(4)})`,
          recommendation: 'Wait until next month or increase monthly limit',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check budget after usage and emit alerts
   */
  private async checkBudget(_record: UsageRecord): Promise<void> {
    const status = await this.getStatus();

    for (const alert of status.alerts) {
      const alertKey = `${alert.type}_${alert.threshold}`;

      // Only emit each alert once per day
      const today = new Date().toISOString().split('T')[0];
      const fullKey = `${alertKey}_${today}`;

      if (!this.alertsSent.has(fullKey)) {
        this.alertsSent.add(fullKey);
        this.emit('alert', alert);
      }
    }
  }
}

// =============================================================================
// Cost Analytics
// =============================================================================

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

/**
 * Generate cost optimization recommendations
 */
export async function generateRecommendations(
  tracker: UsageTracker,
  days: number = 30
): Promise<CostRecommendation[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const summary = await tracker.getSummary(startDate);
  const recommendations: CostRecommendation[] = [];

  // Check for expensive model usage
  for (const [model, stats] of Object.entries(summary.byModel)) {
    const pricing = MODEL_PRICING.find((p) => p.modelId === model);
    if (!pricing) continue;

    // Find cheaper alternatives
    const cheaper = MODEL_PRICING.filter(
      (p) =>
        p.provider !== 'local' &&
        p.inputPricePerMillion < pricing.inputPricePerMillion * 0.5 &&
        p.contextWindow >= pricing.contextWindow * 0.5
    );

    if (cheaper.length > 0 && stats.cost > 1) {
      const cheapestAlt = cheaper.sort(
        (a, b) => a.inputPricePerMillion - b.inputPricePerMillion
      )[0]!;
      const potentialCost =
        stats.cost * (cheapestAlt.inputPricePerMillion / pricing.inputPricePerMillion);

      recommendations.push({
        type: 'model_switch',
        title: `Switch from ${pricing.displayName} to ${cheapestAlt.displayName}`,
        description:
          `You've spent $${stats.cost.toFixed(2)} on ${pricing.displayName}. ` +
          `Consider ${cheapestAlt.displayName} for simpler tasks.`,
        currentCost: stats.cost,
        potentialCost,
        estimatedSavings: stats.cost - potentialCost,
      });
    }
  }

  // Check for high token usage (prompt optimization)
  const avgInputPerRequest = summary.totalInputTokens / summary.totalRequests;
  if (avgInputPerRequest > 2000) {
    const optimizedCost = summary.totalCost * 0.7; // Assume 30% reduction possible
    recommendations.push({
      type: 'prompt_optimization',
      title: 'Optimize prompt length',
      description:
        `Your average prompt is ${Math.round(avgInputPerRequest)} tokens. ` +
        `Consider shorter system prompts or using summarization.`,
      currentCost: summary.totalCost,
      potentialCost: optimizedCost,
      estimatedSavings: summary.totalCost - optimizedCost,
    });
  }

  return recommendations.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

// =============================================================================
// Factory & Singleton
// =============================================================================

/**
 * Create usage tracker
 */
export function createUsageTracker(): UsageTracker {
  return new UsageTracker();
}

/**
 * Create budget manager
 */
export function createBudgetManager(
  tracker: UsageTracker,
  config?: Partial<BudgetConfig>
): BudgetManager {
  return new BudgetManager(tracker, config);
}

// Singleton instances
let defaultTracker: UsageTracker | null = null;
let defaultBudgetManager: BudgetManager | null = null;

/**
 * Get default usage tracker
 */
export async function getUsageTracker(): Promise<UsageTracker> {
  if (!defaultTracker) {
    defaultTracker = createUsageTracker();
    await defaultTracker.initialize();
  }
  return defaultTracker;
}

/**
 * Get default budget manager
 */
export async function getBudgetManager(config?: Partial<BudgetConfig>): Promise<BudgetManager> {
  if (!defaultBudgetManager) {
    const tracker = await getUsageTracker();
    defaultBudgetManager = createBudgetManager(tracker, config);
  }
  return defaultBudgetManager;
}

// =============================================================================
// Helper: Format currency
// =============================================================================

/**
 * Format cost as currency string
 */
export function formatCost(cost: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    if (cost < 0.01) {
      return `$${cost.toFixed(6)}`;
    } else if (cost < 1) {
      return `$${cost.toFixed(4)}`;
    } else {
      return `$${cost.toFixed(2)}`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cost);
}

/**
 * Format token count
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

// =============================================================================
// Re-export Tools
// =============================================================================

export * from './tools.js';

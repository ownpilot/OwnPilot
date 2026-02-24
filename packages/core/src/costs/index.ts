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

// Types
export type {
  AIProvider,
  ModelPricing,
  UsageRecord,
  UsageSummary,
  ProviderUsage,
  ModelUsage,
  DailyUsage,
  BudgetConfig,
  BudgetStatus,
  BudgetAlert,
  CostEstimate,
  CostRecommendation,
} from './types.js';

// Model Pricing
export { MODEL_PRICING } from './model-pricing.js';

// Calculator
export {
  pricingByExactKey,
  pricingByProvider,
  getModelPricing,
  calculateCost,
  estimateCost,
} from './calculator.js';

// Usage Tracker
export { UsageTracker, MAX_RECORDS } from './usage-tracker.js';

// Budget Manager
export { BudgetManager } from './budget-manager.js';

// Recommendations
export { generateRecommendations } from './recommendations.js';

// Helpers
export { formatCost, formatTokens } from './helpers.js';

// Tools
export * from './tools.js';

// =============================================================================
// Factory & Singleton
// =============================================================================

import type { BudgetConfig } from './types.js';
import { UsageTracker } from './usage-tracker.js';
import { BudgetManager } from './budget-manager.js';

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

/**
 * Cost Calculator
 *
 * Functions for calculating and estimating LLM API costs.
 */

import type { AIProvider, CostEstimate, ModelPricing } from './types.js';
import { MODEL_PRICING } from './model-pricing.js';

// Pre-built lookup maps for O(1) exact-match pricing (built once at module load)
export const pricingByExactKey = new Map<string, ModelPricing>();
export const pricingByProvider = new Map<string, ModelPricing>();
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

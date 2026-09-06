/**
 * Cost Calculator
 *
 * Functions for calculating and estimating LLM API costs.
 */

import type { AIProvider, BillingType, CostEstimate, ModelPricing } from './types.js';
import { MODEL_PRICING } from './model-pricing.js';
import { loadProviderConfig } from '../agent/providers/configs/index.js';

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
 * Build a ModelPricing from the synced provider config (data/providers/*.json).
 *
 * The static MODEL_PRICING table only covers a hand-maintained subset of
 * providers/models, but every provider JSON synced from models.dev already
 * carries per-model `inputPrice`/`outputPrice` (same per-million units). This
 * lets cost tracking cover models the static table never listed, instead of
 * silently billing them at $0. Exact-id or alias match only — loose substring
 * matching is intentionally avoided so a fake/unknown model still falls through
 * to the provider-level fallback rather than mispricing against a sibling model.
 */
function pricingFromProviderConfig(provider: AIProvider, modelId: string): ModelPricing | null {
  const config = loadProviderConfig(provider);
  if (!config) return null;

  const model =
    config.models.find((m) => m.id === modelId) ??
    config.models.find((m) => m.aliases?.includes(modelId));
  if (!model) return null;

  return {
    provider,
    modelId: model.id,
    displayName: model.name,
    inputPricePerMillion: model.inputPrice,
    outputPricePerMillion: model.outputPrice,
    contextWindow: model.contextWindow,
    maxOutput: model.maxOutput,
    supportsVision: model.capabilities?.includes('vision'),
    supportsFunctions: model.capabilities?.includes('function_calling'),
    updatedAt: '',
  };
}

/**
 * Get pricing for a model
 */
export function getModelPricing(provider: AIProvider, modelId: string): ModelPricing | null {
  // O(1) exact match
  const exact = pricingByExactKey.get(`${provider}:${modelId}`);
  if (exact) return exact;

  // Partial match for versioned/suffixed model ids (e.g.
  // claude-3-5-sonnet-20241022, gpt-4o-mini-2024-07-18). Match on the FULL
  // table id and prefer the LONGEST match: slicing ids to 3 dash-segments
  // collapsed sibling models into one prefix (claude-3-5-sonnet and
  // claude-3-5-haiku both → "claude-3-5"; "gpt-4o" is contained in
  // "gpt-4o-mini-*"), and first-table-entry-wins then billed the cheaper
  // variant at its family head's price — up to 16.7x input / 30x output.
  const candidates = MODEL_PRICING.filter(
    (p) => p.provider === provider && modelId.includes(p.modelId)
  );
  if (candidates.length > 0) {
    return candidates.reduce((best, p) => (p.modelId.length > best.modelId.length ? p : best));
  }

  // Synced provider data (models.dev) — exact/alias match for models the static
  // table never listed. Preferred over the weak provider-level fallback below
  // because it returns this model's real price, not an arbitrary sibling's.
  const synced = pricingFromProviderConfig(provider, modelId);
  if (synced) return synced;

  // Fallback: any model from the same provider
  return pricingByProvider.get(provider) ?? null;
}

/**
 * Calculate cost for a request.
 *
 * If `billingType` is 'subscription' or 'free', returns 0 (no per-token cost).
 * Subscription costs are tracked separately via provider billing config.
 */
export function calculateCost(
  provider: AIProvider,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  billingType?: BillingType
): number {
  // Subscription and free providers have no per-token cost
  if (billingType === 'subscription' || billingType === 'free') {
    return 0;
  }

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

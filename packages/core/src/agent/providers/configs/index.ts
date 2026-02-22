/**
 * Provider Configurations Index
 * Manages loading and querying AI provider configurations
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the provider data directory.
 * Works from both src/ (dev) and dist/ (production):
 *   src/agent/providers/configs/ → 4 levels up → packages/core/ → data/providers/
 *   dist/agent/providers/configs/ → 4 levels up → packages/core/ → data/providers/
 */
function getProviderDataDir(): string {
  const packageRoot = path.resolve(__dirname, '..', '..', '..', '..');
  return path.join(packageRoot, 'data', 'providers');
}

// Re-export all types from types.ts
export type {
  ModelCapability,
  ModelConfig,
  ProviderType,
  ProviderFeatures,
  ProviderConfig,
  ResolvedProviderConfig,
  ProviderSelectionCriteria,
} from './types.js';

import type {
  ModelCapability,
  ModelConfig,
  ProviderConfig,
  ResolvedProviderConfig,
  ProviderSelectionCriteria,
} from './types.js';

// Provider IDs (auto-generated from JSON files)
export const PROVIDER_IDS = [
  '302ai',
  'abacus',
  'aihubmix',
  'alibaba',
  'alibaba-cn',
  'amazon-bedrock',
  'anthropic',
  'azure',
  'azure-cognitive-services',
  'bailing',
  'baseten',
  'cerebras',
  'chutes',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'cohere',
  'cortecs',
  'deepinfra',
  'deepseek',
  'fastrouter',
  'fireworks-ai',
  'firmware',
  'friendli',
  'github-copilot',
  'github-models',
  'gitlab',
  'google',
  'google-vertex',
  'google-vertex-anthropic',
  'groq',
  'helicone',
  'huggingface',
  'iflowcn',
  'inception',
  'inference',
  'io-net',
  'kimi-for-coding',
  'llama',
  'lmstudio',
  'lucidquery',
  'minimax',
  'minimax-cn',
  'minimax-cn-coding-plan',
  'minimax-coding-plan',
  'mistral',
  'moark',
  'modelscope',
  'moonshotai',
  'moonshotai-cn',
  'morph',
  'nano-gpt',
  'nebius',
  'novita-ai',
  'nvidia',
  'ollama-cloud',
  'openai',
  'opencode',
  'openrouter',
  'ovhcloud',
  'perplexity',
  'poe',
  'privatemode-ai',
  'requesty',
  'sap-ai-core',
  'scaleway',
  'siliconflow',
  'siliconflow-cn',
  'submodel',
  'synthetic',
  'togetherai',
  'upstage',
  'v0',
  'venice',
  'vercel',
  'vivgrid',
  'vultr',
  'wandb',
  'xai',
  'xiaomi',
  'zai',
  'zai-coding-plan',
  'zenmux',
  'zhipuai',
  'zhipuai-coding-plan',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

// Cache for loaded configs
const configCache = new Map<string, ProviderConfig>();

/**
 * Load a provider config by ID
 */
export function loadProviderConfig(id: string): ProviderConfig | null {
  if (configCache.has(id)) {
    return configCache.get(id)!;
  }

  try {
    const configPath = path.join(getProviderDataDir(), `${id}.json`);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProviderConfig;
    configCache.set(id, config);
    return config;
  } catch {
    return null;
  }
}

/**
 * Get provider config by ID (returns undefined for null-safety compat)
 */
export function getProviderConfig(id: string): ProviderConfig | undefined {
  return loadProviderConfig(id) ?? undefined;
}

/**
 * Get the default model for a provider
 */
export function getDefaultModelForProvider(providerId: string): ModelConfig | null {
  const provider = loadProviderConfig(providerId);
  if (!provider || provider.models.length === 0) return null;
  const defaultModel = provider.models.find((m: ModelConfig) => m.default);
  return defaultModel ?? provider.models[0] ?? null;
}

/**
 * Load all provider configs
 */
export function loadAllProviderConfigs(): ProviderConfig[] {
  return PROVIDER_IDS.map((id) => loadProviderConfig(id)).filter(
    (c): c is ProviderConfig => c !== null
  );
}

/**
 * Alias for loadAllProviderConfigs
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  return loadAllProviderConfigs();
}

/**
 * Get available provider IDs
 */
export function getAvailableProviders(): string[] {
  return [...PROVIDER_IDS];
}

/**
 * Clear the config cache
 */
export function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Resolve a provider config with API key from environment
 */
export function resolveProviderConfig(id: string): ResolvedProviderConfig | null {
  const config = loadProviderConfig(id);
  if (!config) return null;

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) return null;

  const { apiKeyEnv: _apiKeyEnv, ...rest } = config;
  return { ...rest, apiKey };
}

/**
 * Get all providers that have API keys configured
 */
export function getConfiguredProviders(): ResolvedProviderConfig[] {
  return PROVIDER_IDS.map((id) => resolveProviderConfig(id)).filter(
    (c): c is ResolvedProviderConfig => c !== null
  );
}

/**
 * Find models matching criteria across all providers
 */
export function findModels(
  criteria: ProviderSelectionCriteria
): Array<{ provider: ProviderConfig; model: ModelConfig }> {
  const results: Array<{ provider: ProviderConfig; model: ModelConfig }> = [];
  const providers = getConfiguredProviders();

  for (const resolvedProvider of providers) {
    if (criteria.excludedProviders?.includes(resolvedProvider.id)) continue;

    // Get full provider config for model access
    const provider = loadProviderConfig(resolvedProvider.id);
    if (!provider) continue;

    for (const model of provider.models) {
      // Check capabilities
      if (criteria.capabilities) {
        const hasAll = criteria.capabilities.every((cap) =>
          model.capabilities.includes(cap as ModelCapability)
        );
        if (!hasAll) continue;
      }

      // Check price limits
      if (criteria.maxInputPrice && model.inputPrice > criteria.maxInputPrice) continue;
      if (criteria.maxOutputPrice && model.outputPrice > criteria.maxOutputPrice) continue;

      // Check context window
      if (criteria.minContextWindow && model.contextWindow < criteria.minContextWindow) continue;

      results.push({ provider, model });
    }
  }

  // Sort by preferred providers first
  if (criteria.preferredProviders) {
    results.sort((a, b) => {
      const aIdx = criteria.preferredProviders!.indexOf(a.provider.id);
      const bIdx = criteria.preferredProviders!.indexOf(b.provider.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }

  return results;
}

/**
 * Select the best model based on criteria
 */
export function selectBestModel(
  criteria: ProviderSelectionCriteria
): { provider: ProviderConfig; model: ModelConfig } | null {
  const results = findModels(criteria);
  return results[0] || null;
}

/**
 * Get the cheapest model matching criteria
 */
export function getCheapestModel(
  criteriaOrCapabilities: ProviderSelectionCriteria | ModelCapability[] = {}
): { provider: ProviderConfig; model: ModelConfig } | null {
  const criteria: ProviderSelectionCriteria = Array.isArray(criteriaOrCapabilities)
    ? { capabilities: criteriaOrCapabilities }
    : criteriaOrCapabilities;
  const results = findModels(criteria);
  if (results.length === 0) return null;

  return results.reduce((cheapest, current) => {
    const cheapestCost = cheapest.model.inputPrice + cheapest.model.outputPrice;
    const currentCost = current.model.inputPrice + current.model.outputPrice;
    return currentCost < cheapestCost ? current : cheapest;
  });
}

/**
 * Get the fastest model (smallest context = usually faster)
 */
export function getFastestModel(
  criteriaOrCapabilities: ProviderSelectionCriteria | ModelCapability[] = {}
): { provider: ProviderConfig; model: ModelConfig } | null {
  const criteria: ProviderSelectionCriteria = Array.isArray(criteriaOrCapabilities)
    ? { capabilities: criteriaOrCapabilities }
    : criteriaOrCapabilities;
  const results = findModels(criteria);
  if (results.length === 0) return null;

  // Prefer smaller models (usually faster) with lower prices (usually simpler)
  return results.reduce((fastest, current) => {
    const fastestScore = fastest.model.contextWindow + fastest.model.inputPrice * 1000;
    const currentScore = current.model.contextWindow + current.model.inputPrice * 1000;
    return currentScore < fastestScore ? current : fastest;
  });
}

/**
 * Get the smartest model (largest context, highest price = usually smarter)
 */
export function getSmartestModel(
  criteriaOrCapabilities: ProviderSelectionCriteria | ModelCapability[] = {}
): { provider: ProviderConfig; model: ModelConfig } | null {
  const criteria: ProviderSelectionCriteria = Array.isArray(criteriaOrCapabilities)
    ? { capabilities: criteriaOrCapabilities }
    : criteriaOrCapabilities;
  const results = findModels(criteria);
  if (results.length === 0) return null;

  return results.reduce((smartest, current) => {
    const smartestScore = smartest.model.contextWindow + smartest.model.outputPrice * 10000;
    const currentScore = current.model.contextWindow + current.model.outputPrice * 10000;
    return currentScore > smartestScore ? current : smartest;
  });
}

// =============================================================================
// Models.dev API Sync Functions
// =============================================================================

// Re-export all sync functions from sync.ts
export {
  fetchModelsDevApi,
  syncProvider,
  syncAllProviders,
  syncProviders,
  listModelsDevProviders,
} from './sync.js';

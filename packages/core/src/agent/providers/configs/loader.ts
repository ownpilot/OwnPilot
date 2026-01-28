/**
 * Provider Configuration Loader
 * Loads all provider configs from JSON files
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ProviderConfig,
  ModelConfig,
  ResolvedProviderConfig,
  ProviderSelectionCriteria,
  ModelCapability,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Cache for loaded configs
 */
let configCache: Map<string, ProviderConfig> | null = null;

/**
 * Load all provider configs from JSON files
 */
export function loadProviderConfigs(): Map<string, ProviderConfig> {
  if (configCache) {
    return configCache;
  }

  configCache = new Map();
  const configDir = __dirname;

  // Find all JSON files in config directory
  const files = readdirSync(configDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = join(configDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content) as ProviderConfig;

      if (config.id) {
        configCache.set(config.id, config);
      }
    } catch (error) {
      console.warn(`Failed to load provider config: ${file}`, error);
    }
  }

  return configCache;
}

/**
 * Get a specific provider config by ID
 */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  const configs = loadProviderConfigs();
  return configs.get(providerId);
}

/**
 * Get all available provider IDs
 */
export function getAvailableProviders(): string[] {
  const configs = loadProviderConfigs();
  return Array.from(configs.keys());
}

/**
 * Get all provider configs as array
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  const configs = loadProviderConfigs();
  return Array.from(configs.values());
}

/**
 * Resolve a provider config with API key from environment
 */
export function resolveProviderConfig(providerId: string): ResolvedProviderConfig | null {
  const config = getProviderConfig(providerId);
  if (!config) {
    return null;
  }

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKeyEnv, ...rest } = config;
  return {
    ...rest,
    apiKey,
  };
}

/**
 * Get all providers that have API keys configured
 */
export function getConfiguredProviders(): ResolvedProviderConfig[] {
  const configs = loadProviderConfigs();
  const resolved: ResolvedProviderConfig[] = [];

  for (const config of configs.values()) {
    const apiKey = process.env[config.apiKeyEnv];
    if (apiKey) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { apiKeyEnv, ...rest } = config;
      resolved.push({ ...rest, apiKey });
    }
  }

  return resolved;
}

/**
 * Get model config by model ID (searches all providers)
 */
export function getModelConfig(modelId: string): { provider: ProviderConfig; model: ModelConfig } | null {
  const configs = loadProviderConfigs();

  for (const provider of configs.values()) {
    const model = provider.models.find(
      m => m.id === modelId || m.aliases?.includes(modelId)
    );
    if (model) {
      return { provider, model };
    }
  }

  return null;
}

/**
 * Get all models matching criteria
 */
export function findModels(criteria: ProviderSelectionCriteria): Array<{
  provider: ProviderConfig;
  model: ModelConfig;
  score: number;
}> {
  const configs = loadProviderConfigs();
  const results: Array<{ provider: ProviderConfig; model: ModelConfig; score: number }> = [];

  for (const provider of configs.values()) {
    // Skip excluded providers
    if (criteria.excludedProviders?.includes(provider.id)) {
      continue;
    }

    // Check if provider has required features
    if (criteria.capabilities?.includes('vision') && !provider.features.vision) {
      continue;
    }
    if (criteria.capabilities?.includes('function_calling') && !provider.features.toolUse) {
      continue;
    }

    for (const model of provider.models) {
      // Skip deprecated models
      if (model.deprecated) {
        continue;
      }

      let score = 0;

      // Check capabilities
      if (criteria.capabilities) {
        const hasAll = criteria.capabilities.every(cap =>
          model.capabilities.includes(cap)
        );
        if (!hasAll) {
          continue;
        }
        score += criteria.capabilities.length * 10;
      }

      // Check price constraints
      if (criteria.maxInputPrice && model.inputPrice > criteria.maxInputPrice) {
        continue;
      }
      if (criteria.maxOutputPrice && model.outputPrice > criteria.maxOutputPrice) {
        continue;
      }

      // Check context window
      if (criteria.minContextWindow && model.contextWindow < criteria.minContextWindow) {
        continue;
      }

      // Score based on preferences
      if (criteria.preferredProviders?.includes(provider.id)) {
        const prefIndex = criteria.preferredProviders.indexOf(provider.id);
        score += (criteria.preferredProviders.length - prefIndex) * 20;
      }

      // Score based on task type
      if (criteria.taskType) {
        score += scoreForTaskType(model, criteria.taskType);
      }

      // Default model bonus
      if (model.default) {
        score += 5;
      }

      // Price efficiency (lower is better)
      const avgPrice = (model.inputPrice + model.outputPrice) / 2;
      score += Math.max(0, 20 - avgPrice);

      results.push({ provider, model, score });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Score model for specific task type
 */
function scoreForTaskType(model: ModelConfig, taskType: string): number {
  const caps = model.capabilities;

  switch (taskType) {
    case 'code':
      return caps.includes('code') ? 15 : 0;
    case 'reasoning':
      return caps.includes('reasoning') ? 20 : 0;
    case 'analysis':
      return caps.includes('vision') ? 10 : caps.includes('reasoning') ? 15 : 5;
    case 'creative':
      return model.contextWindow > 100000 ? 10 : 5;
    case 'chat':
    default:
      return caps.includes('chat') ? 5 : 0;
  }
}

/**
 * Get the best model for given criteria
 */
export function selectBestModel(criteria: ProviderSelectionCriteria): {
  provider: ProviderConfig;
  model: ModelConfig;
} | null {
  const models = findModels(criteria);
  if (models.length === 0) return null;
  const first = models[0];
  if (!first) return null;
  return { provider: first.provider, model: first.model };
}

/**
 * Get the cheapest model with given capabilities
 */
export function getCheapestModel(capabilities: ModelCapability[]): {
  provider: ProviderConfig;
  model: ModelConfig;
} | null {
  const models = findModels({ capabilities });

  if (models.length === 0) {
    return null;
  }

  // Sort by total price (input + output)
  models.sort((a, b) => {
    const priceA = a.model.inputPrice + a.model.outputPrice;
    const priceB = b.model.inputPrice + b.model.outputPrice;
    return priceA - priceB;
  });

  const first = models[0];
  if (!first) return null;
  return { provider: first.provider, model: first.model };
}

/**
 * Get the fastest model (based on provider reputation)
 * Groq is generally fastest due to LPU hardware
 */
export function getFastestModel(capabilities: ModelCapability[]): {
  provider: ProviderConfig;
  model: ModelConfig;
} | null {
  // Prioritize Groq for speed, then Fireworks, then others
  return selectBestModel({
    capabilities,
    preferredProviders: ['groq', 'fireworks', 'together', 'deepseek'],
  });
}

/**
 * Get the smartest model for complex tasks
 */
export function getSmartestModel(capabilities: ModelCapability[] = []): {
  provider: ProviderConfig;
  model: ModelConfig;
} | null {
  // Prioritize reasoning models and frontier models
  const allCaps: ModelCapability[] = [...capabilities];

  // First try reasoning models
  const reasoningModel = selectBestModel({
    capabilities: [...allCaps, 'reasoning'],
    preferredProviders: ['anthropic', 'openai', 'deepseek'],
  });

  if (reasoningModel) {
    return reasoningModel;
  }

  // Fall back to best available
  return selectBestModel({
    capabilities: allCaps,
    preferredProviders: ['anthropic', 'openai', 'google'],
  });
}

/**
 * Clear config cache (for testing or hot-reload)
 */
export function clearConfigCache(): void {
  configCache = null;
}

/**
 * Get the default model for a provider
 * Returns the model marked as default, or the first model if none is marked
 */
export function getDefaultModelForProvider(providerId: string): ModelConfig | null {
  const config = getProviderConfig(providerId);
  if (!config || !config.models.length) {
    return null;
  }

  // Find model marked as default
  const defaultModel = config.models.find(m => m.default);
  if (defaultModel) {
    return defaultModel;
  }

  // Fall back to first model
  return config.models[0] ?? null;
}

/**
 * Load a custom provider config from a file path
 */
export function loadCustomProviderConfig(filePath: string): ProviderConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as ProviderConfig;

    // Add to cache
    const configs = loadProviderConfigs();
    configs.set(config.id, config);

    return config;
  } catch (error) {
    console.warn(`Failed to load custom provider config: ${filePath}`, error);
    return null;
  }
}

// Export types
export type { ProviderConfig, ModelConfig, ResolvedProviderConfig, ProviderSelectionCriteria };

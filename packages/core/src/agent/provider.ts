/**
 * AI Provider - Barrel exports + factory
 *
 * Re-exports all provider types and implementations.
 * Consumers should import from this file (unchanged API surface).
 */

export type { IProvider } from './provider-types.js';
export type { ProviderHealthResult } from './provider-types.js';
export { BaseProvider } from './base-provider.js';

import type { ModelConfig as AgentModelConfig, ProviderConfig } from './types.js';
import type { IProvider } from './provider-types.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { GoogleProvider } from './providers/google.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import {
  loadProviderConfig,
  resolveProviderConfig,
  type ModelConfig as CatalogModelConfig,
  type ProviderConfig as CatalogProviderConfig,
  type ProviderFeatures,
  type ResolvedProviderConfig,
} from './providers/configs/index.js';

const DEFAULT_OPENAI_COMPATIBLE_FEATURES: ProviderFeatures = {
  streaming: true,
  toolUse: true,
  vision: false,
  jsonMode: true,
  systemMessage: true,
};

function resolvedFromCatalogConfig(
  config: CatalogProviderConfig,
  apiKey: string
): ResolvedProviderConfig {
  const { apiKeyEnv: _apiKeyEnv, ...rest } = config;
  return { ...rest, apiKey };
}

function catalogModelFromAgentModel(
  model: AgentModelConfig | undefined,
  fallback: CatalogModelConfig | undefined
): CatalogModelConfig {
  const modelId = model?.model ?? fallback?.id ?? 'default';
  return {
    id: modelId,
    name: fallback?.name ?? modelId,
    contextWindow: fallback?.contextWindow ?? 128_000,
    maxOutput: model?.maxTokens ?? fallback?.maxOutput ?? 4096,
    inputPrice: fallback?.inputPrice ?? 0,
    outputPrice: fallback?.outputPrice ?? 0,
    capabilities: fallback?.capabilities ?? ['chat', 'streaming'],
    default: true,
  };
}

function applyOpenAICompatibleOverrides(
  baseConfig: ResolvedProviderConfig,
  config: ProviderConfig
): ResolvedProviderConfig {
  const defaultModel = baseConfig.models.find((model) => model.default) ?? baseConfig.models[0];

  return {
    ...baseConfig,
    apiKey: config.apiKey ?? baseConfig.apiKey,
    resolvedAuth: config.resolvedAuth ?? baseConfig.resolvedAuth,
    baseUrl: config.baseUrl ?? baseConfig.baseUrl,
    endpoint: config.endpoint ?? baseConfig.endpoint,
    timeout: config.timeout ?? baseConfig.timeout,
    headers: config.headers ? { ...baseConfig.headers, ...config.headers } : baseConfig.headers,
    features: config.features
      ? { ...baseConfig.features, ...config.features }
      : baseConfig.features,
    models: config.defaultModel
      ? [catalogModelFromAgentModel(config.defaultModel, defaultModel)]
      : baseConfig.models,
  };
}

function fallbackOpenAICompatibleConfig(config: ProviderConfig): ResolvedProviderConfig {
  const providerId = config.id ?? config.provider;
  return {
    id: providerId,
    name: providerId,
    type: 'openai-compatible',
    baseUrl: config.baseUrl ?? '',
    apiKey: config.apiKey ?? '',
    resolvedAuth: config.resolvedAuth,
    models: [catalogModelFromAgentModel(config.defaultModel, undefined)],
    features: { ...DEFAULT_OPENAI_COMPATIBLE_FEATURES, ...config.features },
    headers: config.headers,
    endpoint: config.endpoint,
    timeout: config.timeout,
  };
}

function openAICompatibleConfig(config: ProviderConfig): ResolvedProviderConfig {
  const providerId = config.id ?? config.provider;
  const baseConfig =
    (config.apiKey === undefined ? resolveProviderConfig(providerId) : null) ??
    (() => {
      const catalogConfig = loadProviderConfig(providerId);
      return catalogConfig
        ? resolvedFromCatalogConfig(catalogConfig, config.apiKey ?? '')
        : fallbackOpenAICompatibleConfig(config);
    })();

  return applyOpenAICompatibleOverrides(baseConfig, config);
}

/**
 * Create a provider instance based on configuration
 */
export function createProvider(config: ProviderConfig): IProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google': {
      // Use native Google/Gemini provider for proper thoughtSignature support
      const googleProvider = GoogleProvider.withApiKey(config.apiKey ?? '');
      if (googleProvider) {
        return googleProvider;
      }
      // Fallback to OpenAI-compatible if Google provider can't be created
      return new OpenAIProvider(config);
    }
    case 'openai-compatible':
      return new OpenAICompatibleProvider(openAICompatibleConfig(config));
    default:
      return new OpenAIProvider(config);
  }
}

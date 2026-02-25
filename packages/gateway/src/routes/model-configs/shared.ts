/**
 * Shared types and helper functions for model-configs sub-routes.
 */

import { modelConfigsRepo, localProvidersRepo } from '../../db/repositories/index.js';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getAllAggregatorProviders,
  getAggregatorProvider,
  isAggregatorProvider,
  type ModelCapability,
} from '@ownpilot/core';
import { hasApiKey, getConfiguredProviderIds } from '../settings.js';

// =============================================================================
// Types
// =============================================================================

export interface MergedModel {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;
  isCustom: boolean;
  hasOverride: boolean;
  isConfigured: boolean; // API key is set for this provider
  source: 'builtin' | 'aggregator' | 'custom' | 'local';
}

export interface MergedProvider {
  id: string;
  name: string;
  type: 'builtin' | 'aggregator' | 'custom' | 'local';
  apiBase?: string;
  apiKeyEnv?: string;
  apiKeySetting?: string;
  isEnabled: boolean;
  isConfigured: boolean; // API key is set
  modelCount: number;
  description?: string;
  docsUrl?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a provider has an API key configured (in database or environment)
 */
export async function isProviderConfigured(providerId: string): Promise<boolean> {
  return await hasApiKey(providerId);
}

/**
 * Get merged models from all sources (builtin + aggregators + custom)
 * Includes ALL models, with isConfigured flag based on API key presence
 */
export async function getMergedModels(userId: string): Promise<MergedModel[]> {
  const models: MergedModel[] = [];
  const seenKeys = new Set<string>();
  const [userConfigs, disabledSet, configuredProviders] = await Promise.all([
    modelConfigsRepo.listModels(userId),
    modelConfigsRepo.getDisabledModelIds(userId),
    getConfiguredProviderIds(),
  ]);
  const userConfigMap = new Map(userConfigs.map((c) => [`${c.providerId}/${c.modelId}`, c]));

  // 1. Built-in providers from models.dev (ALL providers)
  const builtinProviders = getAllProviderConfigs();
  for (const provider of builtinProviders) {
    const configured = configuredProviders.has(provider.id);

    for (const model of provider.models) {
      const key = `${provider.id}/${model.id}`;
      seenKeys.add(key);
      const userConfig = userConfigMap.get(key);
      const isDisabled = disabledSet.has(key);

      models.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        displayName: userConfig?.displayName || model.name,
        capabilities: userConfig?.capabilities?.length
          ? userConfig.capabilities
          : model.capabilities,
        pricingInput: userConfig?.pricingInput ?? model.inputPrice,
        pricingOutput: userConfig?.pricingOutput ?? model.outputPrice,
        contextWindow: userConfig?.contextWindow ?? model.contextWindow,
        maxOutput: userConfig?.maxOutput ?? model.maxOutput,
        isEnabled: !isDisabled,
        isCustom: false,
        hasOverride: !!userConfig,
        isConfigured: configured,
        source: 'builtin',
      });
    }
  }

  // 2. Aggregator providers (only if user has added them with API key)
  const aggregators = getAllAggregatorProviders();
  for (const agg of aggregators) {
    // Aggregators require explicit user addition
    const userProvider = await modelConfigsRepo.getProvider(userId, agg.id);
    if (!userProvider?.isEnabled) continue;

    // Check if API key is configured (from batch-loaded set)
    const configured = configuredProviders.has(agg.id);

    for (const model of agg.defaultModels) {
      const key = `${agg.id}/${model.id}`;
      seenKeys.add(key);
      const userConfig = userConfigMap.get(key);
      const isDisabled = disabledSet.has(key);

      models.push({
        providerId: agg.id,
        providerName: agg.name,
        modelId: model.id,
        displayName: userConfig?.displayName || model.name,
        capabilities: userConfig?.capabilities?.length
          ? userConfig.capabilities
          : model.capabilities,
        pricingInput: userConfig?.pricingInput ?? model.pricingInput,
        pricingOutput: userConfig?.pricingOutput ?? model.pricingOutput,
        pricingPerRequest: model.pricingPerRequest,
        contextWindow: userConfig?.contextWindow ?? model.contextWindow,
        maxOutput: userConfig?.maxOutput ?? model.maxOutput,
        isEnabled: !isDisabled,
        isCustom: false,
        hasOverride: !!userConfig,
        isConfigured: configured,
        source: 'aggregator',
      });
    }
  }

  // 3. Custom models (user-added, including discovered models)
  const customModels = await modelConfigsRepo.getCustomModels(userId);
  for (const custom of customModels) {
    // Avoid duplicates - skip if already in list
    const key = `${custom.providerId}/${custom.modelId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // Resolve provider display name from built-in, aggregator, or user provider
    let resolvedProviderName = custom.providerId;
    const builtinProv = getProviderConfig(custom.providerId);
    if (builtinProv) {
      resolvedProviderName = builtinProv.name;
    } else {
      const aggProv = isAggregatorProvider(custom.providerId)
        ? getAggregatorProvider(custom.providerId)
        : null;
      if (aggProv) {
        resolvedProviderName = aggProv.name;
      } else {
        const userProv = await modelConfigsRepo.getProvider(userId, custom.providerId);
        if (userProv?.displayName) resolvedProviderName = userProv.displayName;
      }
    }

    models.push({
      providerId: custom.providerId,
      providerName: resolvedProviderName,
      modelId: custom.modelId,
      displayName: custom.displayName || custom.modelId,
      capabilities: custom.capabilities,
      pricingInput: custom.pricingInput,
      pricingOutput: custom.pricingOutput,
      contextWindow: custom.contextWindow,
      maxOutput: custom.maxOutput,
      isEnabled: custom.isEnabled,
      isCustom: true,
      hasOverride: true,
      isConfigured: true, // Custom models are always "configured" by user
      source: 'custom',
    });
  }

  // 4. Local providers (LM Studio, Ollama, etc.)
  const localProviders = await localProvidersRepo.listProviders(userId);
  // Batch-load all local models at once (avoids N+1 per-provider queries)
  const allLocalModels = localProviders.length > 0
    ? await localProvidersRepo.listModels(userId)
    : [];
  const localModelsByProvider = new Map<string, typeof allLocalModels>();
  for (const lm of allLocalModels) {
    const list = localModelsByProvider.get(lm.localProviderId);
    if (list) list.push(lm);
    else localModelsByProvider.set(lm.localProviderId, [lm]);
  }
  for (const lp of localProviders) {
    if (!lp.isEnabled) continue;
    const localModels = localModelsByProvider.get(lp.id) ?? [];
    for (const lm of localModels) {
      if (!lm.isEnabled) continue;
      // Skip duplicates (local provider ID + model ID)
      const key = `${lp.id}/${lm.modelId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      models.push({
        providerId: lp.id,
        providerName: lp.name,
        modelId: lm.modelId,
        displayName: lm.displayName,
        capabilities: lm.capabilities as ModelCapability[],
        pricingInput: 0,
        pricingOutput: 0,
        contextWindow: lm.contextWindow,
        maxOutput: lm.maxOutput,
        isEnabled: true,
        isCustom: false,
        hasOverride: false,
        isConfigured: true, // local = always configured
        source: 'local',
      });
    }
  }

  // Sort: configured first, then by provider name
  models.sort((a, b) => {
    if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
    return a.providerName.localeCompare(b.providerName);
  });

  return models;
}

/**
 * Get merged providers from all sources (ALL providers with isConfigured flag)
 */
export async function getMergedProviders(userId: string): Promise<MergedProvider[]> {
  const providers: MergedProvider[] = [];
  const customProviders = await modelConfigsRepo.listProviders(userId);
  const customProviderMap = new Map(customProviders.map((p) => [p.providerId, p]));
  const disabledProviders = new Set(
    customProviders.filter((p) => !p.isEnabled).map((p) => p.providerId)
  );

  // 1. Built-in providers (ALL from models.dev)
  const builtinProviders = getAllProviderConfigs();
  for (const provider of builtinProviders) {
    const configured = await isProviderConfigured(provider.id);
    const userDisabled = disabledProviders.has(provider.id);

    providers.push({
      id: provider.id,
      name: provider.name,
      type: 'builtin',
      apiBase: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv,
      isEnabled: !userDisabled,
      isConfigured: configured,
      modelCount: provider.models.length,
      docsUrl: provider.docsUrl,
    });
  }

  // 2. Aggregator providers (all, with enabled status if user has added them)
  const aggregators = getAllAggregatorProviders();
  for (const agg of aggregators) {
    const customConfig = customProviderMap.get(agg.id);
    const configured = await isProviderConfigured(agg.id);

    providers.push({
      id: agg.id,
      name: customConfig?.displayName || agg.name,
      type: 'aggregator',
      apiBase: customConfig?.apiBaseUrl || agg.apiBase,
      apiKeyEnv: agg.apiKeyEnv,
      apiKeySetting: customConfig?.apiKeySetting,
      isEnabled: customConfig?.isEnabled ?? false,
      isConfigured: configured,
      modelCount: agg.defaultModels.length,
      description: agg.description,
      docsUrl: agg.docsUrl,
    });
  }

  // 3. Custom providers (not matching any aggregator)
  for (const custom of customProviders) {
    if (isAggregatorProvider(custom.providerId)) continue; // Already included

    const modelCount = (await modelConfigsRepo.listModels(userId, custom.providerId)).length;
    providers.push({
      id: custom.providerId,
      name: custom.displayName,
      type: 'custom',
      apiBase: custom.apiBaseUrl,
      apiKeySetting: custom.apiKeySetting,
      isEnabled: custom.isEnabled,
      isConfigured: true, // Custom providers are configured by definition
      modelCount,
    });
  }

  // 4. Local providers (LM Studio, Ollama, etc.)
  const localProviders = await localProvidersRepo.listProviders(userId);
  // Batch-load all local models at once (avoids N+1 per-provider queries)
  const allLocalModelsForProviders = localProviders.length > 0
    ? await localProvidersRepo.listModels(userId)
    : [];
  const localModelCountByProvider = new Map<string, number>();
  for (const lm of allLocalModelsForProviders) {
    if (lm.isEnabled) {
      localModelCountByProvider.set(
        lm.localProviderId,
        (localModelCountByProvider.get(lm.localProviderId) ?? 0) + 1
      );
    }
  }
  for (const lp of localProviders) {
    providers.push({
      id: lp.id,
      name: lp.name,
      type: 'local',
      apiBase: lp.baseUrl,
      isEnabled: lp.isEnabled,
      isConfigured: true, // local = always configured
      modelCount: localModelCountByProvider.get(lp.id) ?? 0,
    });
  }

  // Sort: configured first, then by name
  providers.sort((a, b) => {
    if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return providers;
}

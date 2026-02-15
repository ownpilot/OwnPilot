/**
 * AI Model Configs API Routes
 *
 * Manage AI models and providers configuration:
 * - List/create/update/delete model configs
 * - List/create/update/delete custom providers
 * - Toggle model/provider enable status
 * - Get merged view with models.dev data
 */

import { Hono } from 'hono';
import {
  modelConfigsRepo,
  localProvidersRepo,
  type CreateModelConfigInput,
  type UpdateModelConfigInput,
  type CreateProviderInput,
  type UpdateProviderInput,
} from '../db/repositories/index.js';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getAllAggregatorProviders,
  getAggregatorProvider,
  isAggregatorProvider,
  type ModelCapability,
} from '@ownpilot/core';
import { hasApiKey, getApiKey, getConfiguredProviderIds } from './settings.js';
import { getLog } from '../services/log.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, sanitizeId, validateQueryEnum, getErrorMessage } from './helpers.js'

const log = getLog('ModelConfigs');

export const modelConfigsRoutes = new Hono();

// =============================================================================
// Types
// =============================================================================

interface MergedModel {
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

interface MergedProvider {
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
async function isProviderConfigured(providerId: string): Promise<boolean> {
  return await hasApiKey(providerId);
}

/**
 * Get merged models from all sources (builtin + aggregators + custom)
 * Includes ALL models, with isConfigured flag based on API key presence
 */
async function getMergedModels(userId: string): Promise<MergedModel[]> {
  const models: MergedModel[] = [];
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
    if (models.some((m) => `${m.providerId}/${m.modelId}` === key)) continue;

    // Resolve provider display name from built-in, aggregator, or user provider
    let resolvedProviderName = custom.providerId;
    const builtinProv = getProviderConfig(custom.providerId);
    if (builtinProv) {
      resolvedProviderName = builtinProv.name;
    } else {
      const aggProv = isAggregatorProvider(custom.providerId) ? getAggregatorProvider(custom.providerId) : null;
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
  for (const lp of localProviders) {
    if (!lp.isEnabled) continue;
    const localModels = await localProvidersRepo.listModels(userId, lp.id);
    for (const lm of localModels) {
      if (!lm.isEnabled) continue;
      // Skip duplicates (local provider ID + model ID)
      const key = `${lp.id}/${lm.modelId}`;
      if (models.some((m) => `${m.providerId}/${m.modelId}` === key)) continue;

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
async function getMergedProviders(userId: string): Promise<MergedProvider[]> {
  const providers: MergedProvider[] = [];
  const customProviders = await modelConfigsRepo.listProviders(userId);
  const customProviderMap = new Map(customProviders.map((p) => [p.providerId, p]));
  const disabledProviders = new Set(customProviders.filter((p) => !p.isEnabled).map((p) => p.providerId));

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
  for (const lp of localProviders) {
    const localModels = await localProvidersRepo.listModels(userId, lp.id);
    providers.push({
      id: lp.id,
      name: lp.name,
      type: 'local',
      apiBase: lp.baseUrl,
      isEnabled: lp.isEnabled,
      isConfigured: true, // local = always configured
      modelCount: localModels.filter((m) => m.isEnabled).length,
    });
  }

  // Sort: configured first, then by name
  providers.sort((a, b) => {
    if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return providers;
}

// =============================================================================
// Model Routes
// =============================================================================

/**
 * GET /api/v1/models - List all models (merged view)
 */
modelConfigsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.query('provider');
  const capability = validateQueryEnum(c.req.query('capability'), ['chat', 'code', 'vision', 'function_calling', 'json_mode', 'streaming', 'embeddings', 'image_generation', 'audio', 'reasoning'] as const);
  const enabledOnly = c.req.query('enabled') === 'true';

  let models = await getMergedModels(userId);

  // Filter by provider
  if (providerId) {
    models = models.filter((m) => m.providerId === providerId);
  }

  // Filter by capability
  if (capability) {
    models = models.filter((m) => m.capabilities.includes(capability));
  }

  // Filter by enabled
  if (enabledOnly) {
    models = models.filter((m) => m.isEnabled);
  }

  return apiResponse(c, models);
});

/**
 * POST /api/v1/models - Create custom model
 */
modelConfigsRoutes.post('/', async (c) => {
  const userId = getUserId(c);

  try {
    const body = await c.req.json<CreateModelConfigInput>();

    if (!body.providerId || !body.modelId) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Provider ID and Model ID are required' }, 400);
    }

    const config = await modelConfigsRepo.upsertModel({
      ...body,
      userId,
      isCustom: true,
    });

    return apiResponse(c, config);
  } catch (error) {
    log.error('Failed to create model:', error);
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: 'Failed to create model' }, 500);
  }
});

// =============================================================================
// Provider Routes
// =============================================================================

/**
 * GET /api/v1/providers - List all providers (merged view)
 */
modelConfigsRoutes.get('/providers/list', async (c) => {
  const userId = getUserId(c);
  const type = validateQueryEnum(c.req.query('type'), ['builtin', 'aggregator', 'custom'] as const);

  let providers = await getMergedProviders(userId);

  if (type) {
    providers = providers.filter((p) => p.type === type);
  }

  return apiResponse(c, providers);
});

/**
 * GET /api/v1/providers/available - List all providers available to enable/add
 * Includes both models.dev providers and aggregators, with isConfigured flag
 */
modelConfigsRoutes.get('/providers/available', async (c) => {
  const userId = getUserId(c);
  const customProviders = await modelConfigsRepo.listProviders(userId);
  const disabledProviders = new Set(customProviders.filter((p) => !p.isEnabled).map((p) => p.providerId));

  interface AvailableProvider {
    id: string;
    name: string;
    type: 'builtin' | 'aggregator';
    description?: string;
    apiBase?: string;
    apiKeyEnv: string;
    docsUrl?: string;
    modelCount: number;
    isEnabled: boolean;
    isConfigured: boolean;
  }

  const available: AvailableProvider[] = [];

  // 1. Built-in providers from models.dev (ALL providers)
  const builtinProviders = getAllProviderConfigs();
  for (const provider of builtinProviders) {
    const configured = await isProviderConfigured(provider.id);
    const userDisabled = disabledProviders.has(provider.id);

    available.push({
      id: provider.id,
      name: provider.name,
      type: 'builtin',
      apiBase: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv,
      docsUrl: provider.docsUrl,
      modelCount: provider.models.length,
      isEnabled: !userDisabled,
      isConfigured: configured,
    });
  }

  // 2. Aggregator providers
  const aggregators = getAllAggregatorProviders();
  for (const agg of aggregators) {
    const userProvider = await modelConfigsRepo.getProvider(userId, agg.id);
    const configured = await isProviderConfigured(agg.id);

    available.push({
      id: agg.id,
      name: agg.name,
      type: 'aggregator',
      description: agg.description,
      apiBase: agg.apiBase,
      apiKeyEnv: agg.apiKeyEnv,
      docsUrl: agg.docsUrl,
      modelCount: agg.defaultModels.length,
      isEnabled: userProvider?.isEnabled ?? false,
      isConfigured: configured,
    });
  }

  // Sort: configured first, then enabled, then by name
  available.sort((a, b) => {
    if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
    if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return apiResponse(c, available);
});

/**
 * GET /api/v1/providers/:id - Get single provider
 */
modelConfigsRoutes.get('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  const provider = (await getMergedProviders(userId)).find((p) => p.id === providerId);

  if (!provider) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
  }

  // Get models for this provider
  const models = (await getMergedModels(userId)).filter((m) => m.providerId === providerId);

  return apiResponse(c, {
    ...provider,
    models,
  });
});

/**
 * POST /api/v1/providers - Create/enable custom provider
 */
modelConfigsRoutes.post('/providers', async (c) => {
  const userId = getUserId(c);

  try {
    const body = await c.req.json<CreateProviderInput>();

    if (!body.providerId || !body.displayName) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Provider ID and display name are required' }, 400);
    }

    const provider = await modelConfigsRepo.upsertProvider({
      ...body,
      userId,
    });

    return apiResponse(c, { message: 'Provider created',
      data: provider, });
  } catch (error) {
    log.error('Failed to create provider:', error);
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: 'Failed to create provider' }, 500);
  }
});

/**
 * PUT /api/v1/providers/:id - Update provider
 */
modelConfigsRoutes.put('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  try {
    const body = await c.req.json<UpdateProviderInput>();

    const existing = await modelConfigsRepo.getProvider(userId, providerId);
    if (!existing) {
      // Create new entry for aggregator
      if (isAggregatorProvider(providerId)) {
        const agg = getAggregatorProvider(providerId)!;
        const provider = await modelConfigsRepo.upsertProvider({
          userId,
          providerId,
          displayName: body.displayName || agg.name,
          apiBaseUrl: body.apiBaseUrl || agg.apiBase,
          apiKeySetting: body.apiKeySetting,
          providerType: agg.type,
          isEnabled: body.isEnabled ?? true,
          config: body.config,
        });

        return apiResponse(c, { message: 'Provider configured',
          data: provider, });
      }

      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
    }

    const provider = await modelConfigsRepo.updateProvider(userId, providerId, body);

    return apiResponse(c, { message: 'Provider updated',
      data: provider, });
  } catch (error) {
    log.error('Failed to update provider:', error);
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update provider' }, 500);
  }
});

/**
 * DELETE /api/v1/providers/:id - Delete custom provider
 */
modelConfigsRoutes.delete('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  // Can't delete built-in providers
  const builtinProvider = getProviderConfig(providerId);
  if (builtinProvider) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Cannot delete built-in provider' }, 400);
  }

  const deleted = await modelConfigsRepo.deleteProvider(userId, providerId);

  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
  }

  return apiResponse(c, { message: 'Provider deleted', });
});

/**
 * PATCH /api/v1/providers/:id/toggle - Toggle provider enabled
 * Works for both builtin (models.dev) and aggregator providers
 */
modelConfigsRoutes.patch('/providers/:id/toggle', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  try {
    const body = await c.req.json<{ enabled: boolean }>();

    if (typeof body.enabled !== 'boolean') {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'enabled field required (boolean)' }, 400);
    }

    // Check if it's a builtin provider from models.dev
    const builtinProvider = getProviderConfig(providerId);
    if (builtinProvider) {
      // Create/update user preference for this provider
      // Use 'openai_compatible' as storage type for builtin providers
      await modelConfigsRepo.upsertProvider({
        userId,
        providerId,
        displayName: builtinProvider.name,
        apiBaseUrl: builtinProvider.baseUrl,
        providerType: 'openai_compatible',
        isEnabled: body.enabled,
      });

      return apiResponse(c, { message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
        enabled: body.enabled, });
    }

    // For aggregators, create config entry if doesn't exist
    if (isAggregatorProvider(providerId)) {
      const agg = getAggregatorProvider(providerId)!;
      await modelConfigsRepo.upsertProvider({
        userId,
        providerId,
        displayName: agg.name,
        apiBaseUrl: agg.apiBase,
        providerType: agg.type,
        isEnabled: body.enabled,
      });
    } else {
      const toggled = await modelConfigsRepo.toggleProvider(userId, providerId, body.enabled);
      if (!toggled) {
        return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
      }
    }

    return apiResponse(c, { message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled, });
  } catch (error) {
    log.error('Failed to toggle provider:', error);
    return apiError(c, { code: ERROR_CODES.TOGGLE_FAILED, message: 'Failed to toggle provider' }, 500);
  }
});

// =============================================================================
// Provider Model Discovery (fetch /v1/models from local or remote provider)
// =============================================================================

/**
 * POST /api/v1/providers/:id/discover-models
 * Fetches models from the provider's OpenAI-compatible /v1/models endpoint
 * and saves them as custom models in the database.
 */
modelConfigsRoutes.post('/providers/:id/discover-models', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  // Resolve provider base URL (user override > built-in config > aggregator)
  let baseUrl: string | undefined;
  let providerName = providerId;

  // Check user provider override first
  const userProvider = await modelConfigsRepo.getProvider(userId, providerId);
  if (userProvider?.apiBaseUrl) {
    baseUrl = userProvider.apiBaseUrl;
    providerName = userProvider.displayName || providerId;
  }

  // Fall back to built-in provider config
  if (!baseUrl) {
    const builtinConfig = getProviderConfig(providerId);
    if (builtinConfig) {
      baseUrl = builtinConfig.baseUrl;
      providerName = builtinConfig.name;
    }
  }

  // Fall back to aggregator config
  if (!baseUrl && isAggregatorProvider(providerId)) {
    const agg = getAggregatorProvider(providerId);
    if (agg) {
      baseUrl = agg.apiBase;
      providerName = agg.name;
    }
  }

  if (!baseUrl) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Provider "${sanitizeId(providerId)}" has no base URL configured. Set a base URL first.` }, 400);
  }

  // Resolve API key for authentication (some local providers require it)
  const apiKey = await getApiKey(providerId);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Build candidate URLs — different providers use different path patterns
  const origin = baseUrl.replace(/\/v\d+\/?$/, '').replace(/\/+$/, '');
  const candidateUrls = [
    `${origin}/v1/models`,
    `${origin}/api/v1/models`,
    `${origin}/models`,
  ];

  // Try each URL pattern until we get a valid model list
  type ModelEntry = { id: string; object?: string; owned_by?: string };
  let modelList: ModelEntry[] | null = null;
  let usedUrl = '';
  let lastError = '';

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${url}`;
        continue;
      }

      // Read as text first to handle non-JSON responses gracefully
      const text = await response.text();
      if (!text.trim()) {
        lastError = `Empty response from ${url}`;
        continue;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        lastError = `Non-JSON response from ${url}: ${text.slice(0, 200)}`;
        continue;
      }

      // OpenAI format: { data: [...] } — some providers return a flat array
      const asObj = json as Record<string, unknown>;
      let candidates: ModelEntry[] = [];
      if (Array.isArray(asObj.data)) {
        candidates = asObj.data as ModelEntry[];
      } else if (Array.isArray(json)) {
        candidates = json as ModelEntry[];
      }

      if (candidates.length > 0) {
        modelList = candidates;
        usedUrl = url;
        break;
      }

      lastError = `No models in response from ${url}`;
    } catch (err) {
      const msg = getErrorMessage(err);
      lastError = msg.includes('abort')
        ? `Timeout connecting to ${url}`
        : `Fetch error for ${url}: ${msg}`;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!modelList || modelList.length === 0) {
    return apiError(c, { code: ERROR_CODES.FETCH_ERROR, message: `Could not discover models from ${providerName}. ${lastError}` }, 502);
  }

  // Save each discovered model as a custom model
  try {
    const discovered: Array<{ modelId: string; displayName: string; isNew: boolean }> = [];
    const existingModels = await modelConfigsRepo.listModels(userId);
    const existingSet = new Set(existingModels.map((m) => `${m.providerId}/${m.modelId}`));

    for (const model of modelList) {
      if (!model.id) continue;

      const key = `${providerId}/${model.id}`;
      const isNew = !existingSet.has(key);

      // Create a readable display name from model ID
      const displayName = model.id
        .replace(/^.*\//, '') // strip org prefix
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (ch: string) => ch.toUpperCase());

      await modelConfigsRepo.upsertModel({
        userId,
        providerId,
        modelId: model.id,
        displayName,
        capabilities: ['chat', 'streaming'],
        contextWindow: 32768,
        maxOutput: 4096,
        pricingInput: 0,
        pricingOutput: 0,
        isEnabled: true,
        isCustom: true,
      });

      discovered.push({ modelId: model.id, displayName, isNew });
    }

    return apiResponse(c, { message: `Discovered ${discovered.length} models from ${providerName}`,
      data: {
        provider: providerId,
        providerName,
        sourceUrl: usedUrl,
        models: discovered,
        newModels: discovered.filter((m) => m.isNew).length,
        existingModels: discovered.filter((m) => !m.isNew).length,
      }, });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: `Models fetched but failed to save: ${getErrorMessage(error)}` }, 500);
  }
});

// =============================================================================
// Sync Route
// =============================================================================

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
  limit?: { context?: number; output?: number };
  release_date?: string;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  api?: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

/**
 * POST /api/v1/sync - Sync models from models.dev API
 * Updates pricing and adds new models while preserving user disabled state
 */
modelConfigsRoutes.post('/sync', async (c) => {
  try {
    // Fetch models.dev API
    const response = await fetch(MODELS_DEV_API_URL);
    if (!response.ok) {
      return apiError(c, { code: ERROR_CODES.FETCH_FAILED, message: `Failed to fetch models.dev: ${response.status}` }, 500);
    }

    const data = await response.json() as Record<string, ModelsDevProvider>;

    // Get current provider configs to compare
    const currentProviders = getAllProviderConfigs();
    const currentModelMap = new Map<string, { inputPrice: number; outputPrice: number }>();

    for (const provider of currentProviders) {
      for (const model of provider.models) {
        currentModelMap.set(`${provider.id}/${model.id}`, {
          inputPrice: model.inputPrice,
          outputPrice: model.outputPrice,
        });
      }
    }

    // Count changes
    let newModels = 0;
    let updatedPricing = 0;
    let totalModels = 0;

    for (const [providerId, provider] of Object.entries(data)) {
      if (!provider.models) continue;

      for (const [modelId, model] of Object.entries(provider.models)) {
        totalModels++;
        const key = `${providerId}/${modelId}`;
        const current = currentModelMap.get(key);

        if (!current) {
          newModels++;
        } else {
          const newInput = model.cost?.input ?? 0;
          const newOutput = model.cost?.output ?? 0;
          if (current.inputPrice !== newInput || current.outputPrice !== newOutput) {
            updatedPricing++;
          }
        }
      }
    }

    // Note: Actual file regeneration should be done via CLI script
    // This endpoint just reports what would change
    return apiResponse(c, { message: 'Sync check complete. Run `npx tsx scripts/generate-provider-configs.ts` to apply changes.',
      stats: {
        providers: Object.keys(data).length,
        totalModels,
        newModels,
        updatedPricing,
      },
      note: 'User disabled models are preserved in database, not affected by sync.', });
  } catch (error) {
    log.error('Sync failed:', error);
    return apiError(c, { code: ERROR_CODES.SYNC_ERROR, message: 'Sync failed' }, 500);
  }
});

/**
 * POST /api/v1/sync/apply - Sync providers from models.dev using proper sync function
 * This uses the syncAllProviders function from core which applies CANONICAL_CONFIGS
 * to ensure correct provider types and base URLs
 */
modelConfigsRoutes.post('/sync/apply', async (c) => {
  try {
    // Use the proper sync function from core which applies CANONICAL_CONFIGS
    const { syncAllProviders, clearConfigCache } = await import('@ownpilot/core');

    const result = await syncAllProviders();

    // Clear the provider config cache so new configs are loaded
    clearConfigCache();

    return apiResponse(c, { message: `Synced ${result.synced.length} providers from models.dev`,
      stats: {
        providers: result.synced.length,
        failed: result.failed.length,
        total: result.total,
        syncedProviders: result.synced,
        failedProviders: result.failed,
      }, });
  } catch (error) {
    log.error('Sync apply failed:', error);
    return apiError(c, { code: ERROR_CODES.SYNC_ERROR, message: 'Sync apply failed: ' + String(error) }, 500);
  }
});

/**
 * POST /api/v1/sync/reset - FULL RESET: Delete ALL provider data and resync
 * Deletes:
 * 1. All JSON config files from configs directory
 * 2. All user provider configs from database
 * 3. All user model configs from database
 * 4. All custom providers from database
 * Then syncs fresh from models.dev.
 */
modelConfigsRoutes.post('/sync/reset', async (c) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    // 1. Clear database records first
    const userId = getUserId(c);
    const dbResult = await modelConfigsRepo.fullReset(userId);

    // 2. Delete all JSON config files
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configsDir = path.join(__dirname, '..', '..', '..', 'core', 'src', 'agent', 'providers', 'configs');

    const deletedFiles: string[] = [];

    if (fs.existsSync(configsDir)) {
      const files = fs.readdirSync(configsDir)
        .filter((f: string) => f.endsWith('.json'));

      for (const file of files) {
        const providerId = file.replace('.json', '');
        try {
          fs.unlinkSync(path.join(configsDir, file));
          deletedFiles.push(providerId);
        } catch {
          // Ignore delete errors
        }
      }
    }

    // 3. Sync fresh from models.dev
    const { syncAllProviders, clearConfigCache } = await import('@ownpilot/core');
    const syncResult = await syncAllProviders();

    // 4. Clear all caches
    clearConfigCache();

    return apiResponse(c, { message: `FULL RESET complete! Cleared ${deletedFiles.length} config files, ${dbResult.providerConfigs} provider overrides, ${dbResult.modelConfigs} model configs, ${dbResult.customProviders} custom providers. Synced ${syncResult.synced.length} providers fresh from models.dev`,
      stats: {
        deletedFiles: deletedFiles.length,
        deletedFilesList: deletedFiles,
        database: {
          providerConfigs: dbResult.providerConfigs,
          modelConfigs: dbResult.modelConfigs,
          customProviders: dbResult.customProviders,
        },
        synced: syncResult.synced.length,
        syncedProviders: syncResult.synced,
        failed: syncResult.failed,
      }, });
  } catch (error) {
    log.error('Full reset failed:', error);
    return apiError(c, { code: ERROR_CODES.DELETE_FAILED, message: 'Full reset failed' }, 500);
  }
});

/**
 * DELETE /api/v1/sync/provider/:id - Delete a specific provider config and optionally resync
 */
modelConfigsRoutes.delete('/sync/provider/:id', async (c) => {
  const providerId = c.req.param('id');
  const resync = c.req.query('resync') === 'true';

  // Validate providerId to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid provider ID format' }, 400);
  }

  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.join(__dirname, '..', '..', '..', 'core', 'src', 'agent', 'providers', 'configs', `${providerId}.json`);

    if (!fs.existsSync(configPath)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Provider config '${sanitizeId(providerId)}' not found` }, 404);
    }

    // Delete the config file
    fs.unlinkSync(configPath);

    const { clearConfigCache, syncProviders } = await import('@ownpilot/core');

    // Optionally resync this provider from models.dev
    let syncResult = null;
    if (resync) {
      syncResult = await syncProviders([providerId]);
    }

    // Clear cache
    clearConfigCache();

    return apiResponse(c, { message: resync
        ? `Deleted and resynced provider '${sanitizeId(providerId)}'`
        : `Deleted provider '${sanitizeId(providerId)}'`,
      data: {
        providerId,
        deleted: true,
        resynced: resync,
        syncResult,
      }, });
  } catch (error) {
    log.error('Delete provider failed:', error);
    return apiError(c, { code: ERROR_CODES.DELETE_FAILED, message: 'Delete provider failed: ' + String(error) }, 500);
  }
});

// =============================================================================
// Capabilities Route
// =============================================================================

/**
 * GET /api/v1/capabilities - List all capability types
 */
modelConfigsRoutes.get('/capabilities/list', async (c) => {
  const capabilities: Array<{
    id: ModelCapability;
    name: string;
    description: string;
  }> = [
    { id: 'chat', name: 'Chat', description: 'Text conversation' },
    { id: 'code', name: 'Code', description: 'Code generation and completion' },
    { id: 'vision', name: 'Vision', description: 'Image understanding' },
    { id: 'function_calling', name: 'Function Calling', description: 'Tool use' },
    { id: 'json_mode', name: 'JSON Mode', description: 'Structured output' },
    { id: 'streaming', name: 'Streaming', description: 'Stream responses' },
    { id: 'embeddings', name: 'Embeddings', description: 'Text embeddings' },
    { id: 'image_generation', name: 'Image Generation', description: 'Create images from text' },
    { id: 'audio', name: 'Audio', description: 'Text-to-speech and speech-to-text' },
    { id: 'reasoning', name: 'Reasoning', description: 'Chain of thought (o1-style)' },
  ];

  return apiResponse(c, capabilities);
});

// =============================================================================
// Parameterized Model Routes (MUST be after all specific routes like /providers/*, /capabilities/*)
// =============================================================================

/**
 * GET /api/v1/models/:provider - List models for a provider
 */
modelConfigsRoutes.get('/:provider', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');

  const models = (await getMergedModels(userId)).filter((m) => m.providerId === providerId);

  return apiResponse(c, models);
});

/**
 * GET /api/v1/models/:provider/:model - Get single model
 */
modelConfigsRoutes.get('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const model = (await getMergedModels(userId)).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!model) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Model not found' }, 404);
  }

  return apiResponse(c, model);
});

/**
 * PUT /api/v1/models/:provider/:model - Update model config
 */
modelConfigsRoutes.put('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  try {
    const body = await c.req.json<UpdateModelConfigInput>();

    // Check if model exists in any source
    const existingModel = (await getMergedModels(userId)).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Model not found' }, 404);
    }

    // Create or update override
    const config = await modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      ...body,
      isCustom: existingModel.isCustom,
    });

    return apiResponse(c, { message: 'Model updated',
      data: config, });
  } catch (error) {
    log.error('Failed to update model:', error);
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update model' }, 500);
  }
});

/**
 * DELETE /api/v1/models/:provider/:model - Delete custom model or remove override
 */
modelConfigsRoutes.delete('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const existingModel = (await getMergedModels(userId)).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!existingModel) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Model not found' }, 404);
  }

  if (!existingModel.isCustom && !existingModel.hasOverride) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Cannot delete built-in model without override' }, 400);
  }

  const deleted = await modelConfigsRepo.deleteModel(userId, providerId, modelId);

  return apiResponse(c, { message: existingModel.isCustom ? 'Custom model deleted' : 'Override removed',
    deleted, });
});

/**
 * PATCH /api/v1/models/:provider/:model/toggle - Toggle model enabled
 */
modelConfigsRoutes.patch('/:provider/:model/toggle', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  try {
    const body = await c.req.json<{ enabled: boolean }>();

    if (typeof body.enabled !== 'boolean') {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'enabled field required (boolean)' }, 400);
    }

    // Check if model exists
    const existingModel = (await getMergedModels(userId)).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Model not found' }, 404);
    }

    // Create config entry if it doesn't exist, then toggle
    await modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      isEnabled: body.enabled,
      isCustom: existingModel.isCustom,
    });

    return apiResponse(c, { message: `Model ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled, });
  } catch (error) {
    log.error('Failed to toggle model:', error);
    return apiError(c, { code: ERROR_CODES.TOGGLE_FAILED, message: 'Failed to toggle model' }, 500);
  }
});

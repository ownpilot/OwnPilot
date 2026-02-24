/**
 * Provider configuration endpoints
 *
 * Handles listing, creating, updating, deleting, and toggling providers.
 * Includes model discovery from provider /v1/models endpoints.
 */

import { Hono } from 'hono';
import {
  modelConfigsRepo,
  type CreateProviderInput,
  type UpdateProviderInput,
} from '../../db/repositories/index.js';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getAllAggregatorProviders,
  getAggregatorProvider,
  isAggregatorProvider,
  type ModelCapability,
} from '@ownpilot/core';
import { hasApiKey, getApiKey } from '../settings.js';
import { getLog } from '../../services/log.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  sanitizeId,
  validateQueryEnum,
  getErrorMessage,
  notFoundError,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { getMergedModels, getMergedProviders, isProviderConfigured } from './shared.js';

const log = getLog('ModelConfigs');

export const providerRoutes = new Hono();

// =============================================================================
// Provider Routes
// =============================================================================

/**
 * GET /api/v1/providers - List all providers (merged view)
 */
providerRoutes.get('/providers/list', async (c) => {
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
providerRoutes.get('/providers/available', async (c) => {
  const userId = getUserId(c);
  const customProviders = await modelConfigsRepo.listProviders(userId);
  const disabledProviders = new Set(
    customProviders.filter((p) => !p.isEnabled).map((p) => p.providerId)
  );

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
providerRoutes.get('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  const provider = (await getMergedProviders(userId)).find((p) => p.id === providerId);

  if (!provider) {
    return notFoundError(c, 'Provider', providerId);
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
providerRoutes.post('/providers', async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json<CreateProviderInput>().catch(() => null);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    if (!body.providerId || !body.displayName) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'Provider ID and display name are required' },
        400
      );
    }

    const provider = await modelConfigsRepo.upsertProvider({
      ...body,
      userId,
    });

    wsGateway.broadcast('data:changed', {
      entity: 'model_provider',
      action: 'created',
      id: provider.id,
    });
    return apiResponse(c, { message: 'Provider created', data: provider });
  } catch (error) {
    log.error('Failed to create provider:', error);
    return apiError(
      c,
      { code: ERROR_CODES.CREATE_FAILED, message: 'Failed to create provider' },
      500
    );
  }
});

/**
 * PUT /api/v1/providers/:id - Update provider
 */
providerRoutes.put('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  const body = await c.req.json<UpdateProviderInput>().catch(() => null);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
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

        wsGateway.broadcast('data:changed', {
          entity: 'model_provider',
          action: 'updated',
          id: providerId,
        });
        return apiResponse(c, { message: 'Provider configured', data: provider });
      }

      return notFoundError(c, 'Provider', providerId);
    }

    const provider = await modelConfigsRepo.updateProvider(userId, providerId, body);

    wsGateway.broadcast('data:changed', {
      entity: 'model_provider',
      action: 'updated',
      id: providerId,
    });
    return apiResponse(c, { message: 'Provider updated', data: provider });
  } catch (error) {
    log.error('Failed to update provider:', error);
    return apiError(
      c,
      { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update provider' },
      500
    );
  }
});

/**
 * DELETE /api/v1/providers/:id - Delete custom provider
 */
providerRoutes.delete('/providers/:id', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  // Can't delete built-in providers
  const builtinProvider = getProviderConfig(providerId);
  if (builtinProvider) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Cannot delete built-in provider' },
      400
    );
  }

  const deleted = await modelConfigsRepo.deleteProvider(userId, providerId);

  if (!deleted) {
    return notFoundError(c, 'Provider', providerId);
  }

  wsGateway.broadcast('data:changed', {
    entity: 'model_provider',
    action: 'deleted',
    id: providerId,
  });
  return apiResponse(c, { message: 'Provider deleted' });
});

/**
 * PATCH /api/v1/providers/:id/toggle - Toggle provider enabled
 * Works for both builtin (models.dev) and aggregator providers
 */
providerRoutes.patch('/providers/:id/toggle', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  const body = await c.req.json<{ enabled: boolean }>().catch(() => null);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    if (typeof body.enabled !== 'boolean') {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'enabled field required (boolean)' },
        400
      );
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

      wsGateway.broadcast('data:changed', {
        entity: 'model_provider',
        action: 'updated',
        id: providerId,
      });
      return apiResponse(c, {
        message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
        enabled: body.enabled,
      });
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
        return notFoundError(c, 'Provider', providerId);
      }
    }

    wsGateway.broadcast('data:changed', {
      entity: 'model_provider',
      action: 'updated',
      id: providerId,
    });
    return apiResponse(c, {
      message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled,
    });
  } catch (error) {
    log.error('Failed to toggle provider:', error);
    return apiError(
      c,
      { code: ERROR_CODES.TOGGLE_FAILED, message: 'Failed to toggle provider' },
      500
    );
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
providerRoutes.post('/providers/:id/discover-models', async (c) => {
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
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `Provider "${sanitizeId(providerId)}" has no base URL configured. Set a base URL first.`,
      },
      400
    );
  }

  // Resolve API key for authentication (some local providers require it)
  const apiKey = await getApiKey(providerId);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Build candidate URLs — different providers use different path patterns
  const origin = baseUrl.replace(/\/v\d+\/?$/, '').replace(/\/+$/, '');
  const candidateUrls = [`${origin}/v1/models`, `${origin}/api/v1/models`, `${origin}/models`];

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
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_ERROR,
        message: `Could not discover models from ${providerName}. ${lastError}`,
      },
      502
    );
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
        capabilities: ['chat', 'streaming'] as ModelCapability[],
        contextWindow: 32768,
        maxOutput: 4096,
        pricingInput: 0,
        pricingOutput: 0,
        isEnabled: true,
        isCustom: true,
      });

      discovered.push({ modelId: model.id, displayName, isNew });
    }

    return apiResponse(c, {
      message: `Discovered ${discovered.length} models from ${providerName}`,
      data: {
        provider: providerId,
        providerName,
        sourceUrl: usedUrl,
        models: discovered,
        newModels: discovered.filter((m) => m.isNew).length,
        existingModels: discovered.filter((m) => !m.isNew).length,
      },
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: `Models fetched but failed to save: ${getErrorMessage(error)}`,
      },
      500
    );
  }
});

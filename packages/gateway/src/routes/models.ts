/**
 * Models Route
 *
 * Provides information about available AI models from configured providers
 * All model data is loaded from JSON config files - no hardcoded data
 */

import { Hono } from 'hono';
import { hasApiKey } from './settings.js';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getAvailableProviders,
  syncAllProviders,
  syncProviders,
  listModelsDevProviders,
  clearConfigCache,
} from '@ownpilot/core';
import { modelConfigsRepo } from '../db/repositories/model-configs.js';
import { localProvidersRepo } from '../db/repositories/index.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';

const app = new Hono();

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  inputPrice: number; // per 1M tokens
  outputPrice: number; // per 1M tokens
  capabilities: string[];
  recommended?: boolean;
}

/**
 * Convert provider config models to ModelInfo format
 */
function convertToModelInfo(providerId: string): ModelInfo[] {
  const config = getProviderConfig(providerId);
  if (!config || !config.models) {
    return [];
  }

  return config.models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: providerId,
    description: undefined, // Can be added to config if needed
    contextWindow: m.contextWindow ?? 8192,
    maxOutputTokens: m.maxOutput,
    inputPrice: m.inputPrice ?? 0,
    outputPrice: m.outputPrice ?? 0,
    capabilities: m.capabilities ?? ['chat'],
    recommended: m.default,
  }));
}

/**
 * GET /models - List all available models (only from configured providers)
 * Query params:
 *   - enabledOnly: boolean (default: true) - Filter to only enabled models
 */
app.get('/', async (c) => {
  const enabledOnly = c.req.query('enabledOnly') !== 'false';
  const userId = getUserId(c);

  const allModels: ModelInfo[] = [];
  const configuredProviders: string[] = [];
  const availableProviders = getAvailableProviders();

  // Get disabled models for filtering
  const disabledModels = enabledOnly
    ? await modelConfigsRepo.getDisabledModelIds(userId)
    : new Set<string>();

  // Check all available providers
  for (const provider of availableProviders) {
    if (await hasApiKey(provider)) {
      configuredProviders.push(provider);
      let models = convertToModelInfo(provider);

      // Filter out disabled models if enabledOnly is true
      if (enabledOnly) {
        models = models.filter((m) => !disabledModels.has(`${provider}/${m.id}`));
      }

      allModels.push(...models);
    }
  }

  // Include models from local providers (LM Studio, Ollama, etc.)
  const localProviders = await localProvidersRepo.listProviders();
  for (const lp of localProviders) {
    if (!lp.isEnabled) continue;
    configuredProviders.push(lp.id);
    const localModels = await localProvidersRepo.listModels(undefined, lp.id);
    for (const lm of localModels) {
      if (!lm.isEnabled) continue;
      allModels.push({
        id: lm.modelId,
        name: lm.displayName || lm.modelId,
        provider: lp.id,
        contextWindow: lm.contextWindow ?? 32768,
        maxOutputTokens: lm.maxOutput ?? 4096,
        inputPrice: 0,
        outputPrice: 0,
        capabilities: lm.capabilities ?? ['chat', 'streaming'],
        recommended: false,
      });
    }
  }

  return apiResponse(c, {
    models: allModels,
    configuredProviders,
    availableProviders,
  });
});

/**
 * GET /models/catalog/all - Get full catalog without API key check
 * NOTE: Must be defined BEFORE /:provider to avoid route collision
 */
app.get('/catalog/all', async (c) => {
  const configs = getAllProviderConfigs();
  const catalog: Record<string, ModelInfo[]> = {};

  for (const config of configs) {
    catalog[config.id] = convertToModelInfo(config.id);
  }

  return apiResponse(c, catalog);
});

/**
 * GET /models/sync/providers - List available providers from models.dev
 */
app.get('/sync/providers', async (c) => {
  try {
    const providers = await listModelsDevProviders();
    return apiResponse(c, {
      providers,
      total: providers.length,
      source: 'https://models.dev/api.json',
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return apiError(
      c,
      { code: ERROR_CODES.FETCH_ERROR, message: `Failed to fetch providers: ${message}` },
      500
    );
  }
});

/**
 * POST /models/sync - Sync provider configs from models.dev API
 * Body: { providers?: string[] } - Optional array of provider IDs to sync
 *       If not provided, syncs all providers
 */
app.post('/sync', async (c) => {
  try {
    const body = (await parseJsonBody<{ providers?: string[] }>(c)) ?? {};
    const providerIds = body.providers as string[] | undefined;

    let result;
    if (providerIds && providerIds.length > 0) {
      result = await syncProviders(providerIds);
    } else {
      result = await syncAllProviders();
    }

    // Clear config cache so new configs are loaded
    clearConfigCache();

    const total = 'total' in result ? result.total : result.synced.length + result.failed.length;

    return apiResponse(c, {
      synced: result.synced,
      failed: result.failed,
      notFound: 'notFound' in result ? result.notFound : undefined,
      total,
      message: `Synced ${result.synced.length} provider(s) from models.dev`,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return apiError(
      c,
      { code: ERROR_CODES.SYNC_ERROR, message: `Failed to sync providers: ${message}` },
      500
    );
  }
});

/**
 * GET /models/:provider - Get models for a specific provider
 */
app.get('/:provider', async (c) => {
  const provider = c.req.param('provider');

  const config = getProviderConfig(provider);
  if (!config) {
    return apiError(
      c,
      { code: ERROR_CODES.UNKNOWN_PROVIDER, message: `Unknown provider: ${provider}` },
      404
    );
  }

  const models = convertToModelInfo(provider);
  const isConfigured = hasApiKey(provider);

  return apiResponse(c, {
    provider,
    models,
    isConfigured,
    providerName: config.name,
    features: config.features,
    baseUrl: config.baseUrl,
    docsUrl: config.docsUrl,
  });
});

export const modelsRoutes = app;

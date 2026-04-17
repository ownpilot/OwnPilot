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
import { detectCliChatProviders } from '../services/cli-chat-provider.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';

const log = console;

const app = new Hono();

// ---------------------------------------------------------------------------
// Bridge model fetching — dynamic discovery for bridge-* local providers
// ---------------------------------------------------------------------------

interface BridgeModelEntry {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * Fetch models from a bridge provider's /v1/models endpoint.
 * Sends X-Runtime header derived from the provider name (e.g., bridge-opencode → opencode).
 * Returns empty array on failure (never throws).
 */
async function fetchBridgeModels(
  baseUrl: string,
  providerName: string,
  apiKey?: string,
): Promise<BridgeModelEntry[]> {
  try {
    const base = baseUrl.replace(/\/+$/, '');
    // baseUrl may already end with /v1 — normalize
    const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    const runtime = providerName.replace('bridge-', '');
    const headers: Record<string, string> = {
      'X-Runtime': runtime,
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const body = await resp.json() as { data?: BridgeModelEntry[] };
    return body.data ?? [];
  } catch {
    log.warn?.(`Failed to fetch models from bridge provider ${providerName}`);
    return [];
  }
}

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

  // Include models from local providers (LM Studio, Ollama, bridge-*, etc.)
  const localProviders = await localProvidersRepo.listProviders();
  for (const lp of localProviders) {
    if (!lp.isEnabled) continue;
    configuredProviders.push(lp.id);

    // Bridge providers: fetch models dynamically from bridge /v1/models
    if (lp.name?.startsWith('bridge-')) {
      const bridgeModels = await fetchBridgeModels(lp.baseUrl, lp.name, lp.apiKey);
      if (bridgeModels.length > 0) {
        for (const bm of bridgeModels) {
          allModels.push({
            id: bm.id,
            name: bm.id,
            provider: lp.id,
            contextWindow: 128_000,
            maxOutputTokens: 8192,
            inputPrice: 0,
            outputPrice: 0,
            capabilities: ['chat', 'streaming'],
            recommended: false,
          });
        }
        continue; // Skip DB models — bridge is the source of truth
      }
      // Fall through to DB models if bridge is unreachable
    }

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

  // Include CLI chat providers (Claude CLI, Codex CLI, Gemini CLI)
  // CLI providers don't expose model selection — they use their own default model.
  // We only register them as configured providers so they appear in the provider dropdown.
  const cliChatProviders = detectCliChatProviders();
  for (const cli of cliChatProviders) {
    if (!cli.installed) continue;
    configuredProviders.push(cli.id);
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

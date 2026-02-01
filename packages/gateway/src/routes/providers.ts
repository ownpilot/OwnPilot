/**
 * Providers routes
 *
 * Provides API for listing and managing AI providers
 * Provider configs are loaded from JSON files in the core package
 */

import { Hono } from 'hono';
import { loadProviderConfig, PROVIDER_IDS } from '@ownpilot/core';
import type { ApiResponse } from '../types/index.js';
import { hasApiKey, getApiKeySource } from './settings.js';
import { modelConfigsRepo } from '../db/repositories/model-configs.js';
import { localProvidersRepo } from '../db/repositories/index.js';
import { getUserId } from './helpers.js';

const app = new Hono();

// Provider UI metadata (colors, placeholders, etc.)
const PROVIDER_UI_METADATA: Record<string, { color: string; apiKeyPlaceholder?: string }> = {
  // Popular
  openai: { color: '#10a37f', apiKeyPlaceholder: 'sk-...' },
  anthropic: { color: '#d4a27f', apiKeyPlaceholder: 'sk-ant-...' },
  google: { color: '#4285f4', apiKeyPlaceholder: 'AIza...' },
  deepseek: { color: '#5b6cf9', apiKeyPlaceholder: 'sk-...' },
  groq: { color: '#f55036', apiKeyPlaceholder: 'gsk_...' },
  mistral: { color: '#ff7000', apiKeyPlaceholder: 'sk-...' },
  xai: { color: '#000000', apiKeyPlaceholder: 'xai-...' },
  // Cloud Platforms
  azure: { color: '#0078d4' },
  'amazon-bedrock': { color: '#ff9900' },
  'google-vertex': { color: '#4285f4' },
  'google-vertex-anthropic': { color: '#4285f4' },
  'cloudflare-workers-ai': { color: '#f38020' },
  'cloudflare-ai-gateway': { color: '#f38020' },
  scaleway: { color: '#4f0599' },
  ovhcloud: { color: '#0050d7' },
  vultr: { color: '#007bfc' },
  nvidia: { color: '#76b900' },
  'sap-ai-core': { color: '#0070f2' },
  // Inference Providers
  togetherai: { color: '#6366f1' },
  'fireworks-ai': { color: '#ff6b35' },
  deepinfra: { color: '#5436da' },
  cerebras: { color: '#00bfa5' },
  baseten: { color: '#6366f1' },
  friendli: { color: '#00b894' },
  inference: { color: '#6c5ce7' },
  'novita-ai': { color: '#ff4757' },
  siliconflow: { color: '#667eea' },
  'siliconflow-cn': { color: '#667eea' },
  // Search & Research
  perplexity: { color: '#22b8cf' },
  // Chinese Providers
  zhipuai: { color: '#2d5af0' },
  zhipu: { color: '#2d5af0' },
  alibaba: { color: '#ff6a00' },
  'alibaba-cn': { color: '#ff6a00' },
  moonshotai: { color: '#6c5ce7' },
  'moonshotai-cn': { color: '#6c5ce7' },
  minimax: { color: '#f8312f' },
  'minimax-cn': { color: '#f8312f' },
  xiaomi: { color: '#ff6900' },
  bailing: { color: '#667eea' },
  zai: { color: '#6c5ce7' },
  iflowcn: { color: '#00b894' },
  // Development Tools
  'github-copilot': { color: '#6e5494' },
  'github-models': { color: '#6e5494' },
  gitlab: { color: '#fc6d26' },
  v0: { color: '#000000' },
  lmstudio: { color: '#10a37f' },
  opencode: { color: '#6366f1' },
  'kimi-for-coding': { color: '#6c5ce7' },
  // Aggregators & Routers
  openrouter: { color: '#6366f1' },
  helicone: { color: '#0ea5e9' },
  fastrouter: { color: '#f97316' },
  zenmux: { color: '#8b5cf6' },
  aihubmix: { color: '#ec4899' },
  vercel: { color: '#000000' },
  morph: { color: '#14b8a6' },
  requesty: { color: '#3b82f6' },
  // Specialized
  cohere: { color: '#39594d' },
  upstage: { color: '#0066ff' },
  huggingface: { color: '#ffcc00' },
  'ollama-cloud': { color: '#ffffff' },
  llama: { color: '#0467df' },
  poe: { color: '#8b5cf6' },
  venice: { color: '#f59e0b' },
  synthetic: { color: '#6366f1' },
  'nano-gpt': { color: '#22c55e' },
  modelscope: { color: '#ff6a00' },
  // Enterprise
  wandb: { color: '#ffcc33' },
  inception: { color: '#6366f1' },
  cortecs: { color: '#3b82f6' },
  lucidquery: { color: '#8b5cf6' },
  firmware: { color: '#ef4444' },
  chutes: { color: '#22c55e' },
  vivgrid: { color: '#6366f1' },
  moark: { color: '#f97316' },
  submodel: { color: '#8b5cf6' },
  'io-net': { color: '#3b82f6' },
  // Other
  'privatemode-ai': { color: '#6366f1' },
  nebius: { color: '#0066ff' },
  abacus: { color: '#10b981' },
};

// Default UI metadata for unknown providers
const DEFAULT_UI_METADATA: { color: string; apiKeyPlaceholder?: string } = { color: '#666666' };

// Provider categories for UI organization
const PROVIDER_CATEGORIES: Record<string, string[]> = {
  'Popular': [
    'openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai'
  ],
  'Cloud Platforms': [
    'azure', 'amazon-bedrock', 'google-vertex', 'google-vertex-anthropic',
    'cloudflare-workers-ai', 'cloudflare-ai-gateway', 'scaleway', 'ovhcloud',
    'vultr', 'nvidia', 'sap-ai-core'
  ],
  'Inference Providers': [
    'togetherai', 'fireworks-ai', 'deepinfra', 'groq', 'cerebras', 'baseten',
    'friendli', 'inference', 'novita-ai', 'siliconflow', 'siliconflow-cn'
  ],
  'Search & Research': [
    'perplexity'
  ],
  'Chinese Providers': [
    'zhipuai', 'alibaba', 'alibaba-cn', 'moonshotai', 'moonshotai-cn',
    'minimax', 'minimax-cn', 'xiaomi', 'bailing', 'zai', 'iflowcn'
  ],
  'Development Tools': [
    'github-copilot', 'github-models', 'gitlab', 'v0', 'lmstudio',
    'opencode', 'kimi-for-coding'
  ],
  'Aggregators & Routers': [
    'openrouter', 'helicone', 'fastrouter', 'zenmux', 'aihubmix',
    'vercel', 'morph', 'requesty'
  ],
  'Specialized': [
    'cohere', 'upstage', 'huggingface', 'ollama-cloud', 'llama',
    'poe', 'venice', 'synthetic', 'nano-gpt', 'modelscope'
  ],
  'Enterprise': [
    'azure-cognitive-services', 'wandb', 'inception', 'cortecs',
    'lucidquery', 'firmware', 'chutes', 'vivgrid', 'moark', 'submodel', 'io-net'
  ],
  'Other': [
    'privatemode-ai', 'nebius', 'abacus'
  ]
};

/**
 * Get all available provider IDs (from core PROVIDER_IDS)
 */
function getProviderIds(): string[] {
  return [...PROVIDER_IDS];
}

/**
 * GET /providers - List all available providers
 */
app.get('/', async (c) => {
  const userId = getUserId(c);
  const providerIds = getProviderIds();

  // Get all user overrides at once for efficiency
  const userOverrides = await modelConfigsRepo.listUserProviderConfigs(userId);
  const overrideMap = new Map(userOverrides.map((o) => [o.providerId, o]));

  // Build provider list with async API key checks
  const providerPromises = providerIds.map(async (id) => {
    const config = loadProviderConfig(id);
    if (!config) return null;

    // Get UI metadata
    const uiMeta = PROVIDER_UI_METADATA[config.id] ?? DEFAULT_UI_METADATA;

    // Await the async function properly
    const configSource = await getApiKeySource(config.id);

    // Get user override if exists
    const override = overrideMap.get(id);

    return {
      id: config.id,
      name: config.name,
      // Effective type (user override > base config)
      type: override?.providerType || config.type,
      // Effective baseUrl (user override > base config)
      baseUrl: override?.baseUrl || config.baseUrl,
      apiKeyEnv: override?.apiKeyEnv || config.apiKeyEnv,
      docsUrl: config.docsUrl,
      features: config.features,
      modelCount: config.models.length,
      isConfigured: configSource !== null,
      // Is provider enabled (default: true, can be disabled by user)
      isEnabled: override?.isEnabled !== false,
      // Has user override
      hasOverride: !!override,
      // Configuration source: 'database' = set via UI, 'environment' = set via env var
      configSource,
      // UI metadata
      color: uiMeta.color,
      apiKeyPlaceholder: uiMeta.apiKeyPlaceholder,
    };
  });

  const providersWithNulls = await Promise.all(providerPromises);
  const providers = providersWithNulls.filter((p): p is NonNullable<typeof p> => p !== null);

  // Include local providers (LM Studio, Ollama, etc.)
  const localProviderColors: Record<string, string> = {
    lmstudio: '#10a37f',
    ollama: '#ffffff',
    localai: '#6366f1',
    vllm: '#f97316',
    custom: '#666666',
  };
  const dbLocalProviders = await localProvidersRepo.listProviders();
  for (const lp of dbLocalProviders) {
    if (!lp.isEnabled) continue;
    const localModels = await localProvidersRepo.listModels(undefined, lp.id);
    providers.push({
      id: lp.id,
      name: lp.name,
      type: 'local',
      baseUrl: lp.baseUrl,
      apiKeyEnv: '',
      docsUrl: undefined,
      features: { streaming: true, toolUse: true, vision: false, jsonMode: true, systemMessage: true },
      modelCount: localModels.length,
      isConfigured: true,
      isEnabled: true,
      hasOverride: false,
      configSource: 'database' as const,
      color: localProviderColors[lp.providerType] ?? '#10b981',
      apiKeyPlaceholder: undefined,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
      providers,
      categories: PROVIDER_CATEGORIES,
      total: providers.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /providers/categories - Get provider categories
 */
app.get('/categories', (c) => {
  // Find uncategorized providers
  const allCategorizedIds = new Set(
    Object.values(PROVIDER_CATEGORIES).flat()
  );
  const allProviderIds = getProviderIds();
  const uncategorized = allProviderIds.filter(id => !allCategorizedIds.has(id));

  const response: ApiResponse = {
    success: true,
    data: {
      categories: PROVIDER_CATEGORIES,
      uncategorized,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /providers/:id - Get full provider config
 */
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const config = loadProviderConfig(id);

  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider '${id}' not found`,
        },
      },
      404
    );
  }

  // Get UI metadata
  const uiMeta = PROVIDER_UI_METADATA[config.id] ?? DEFAULT_UI_METADATA;

  // Get user override if exists
  const override = await modelConfigsRepo.getUserProviderConfig(userId, id);

  const response: ApiResponse = {
    success: true,
    data: {
      ...config,
      // Effective type (user override > base config)
      type: override?.providerType || config.type,
      // Effective baseUrl (user override > base config)
      baseUrl: override?.baseUrl || config.baseUrl,
      apiKeyEnv: override?.apiKeyEnv || config.apiKeyEnv,
      isConfigured: hasApiKey(config.id),
      isEnabled: override?.isEnabled !== false,
      hasOverride: !!override,
      // Include user override details if present
      userOverride: override
        ? {
            baseUrl: override.baseUrl,
            providerType: override.providerType,
            isEnabled: override.isEnabled,
            apiKeyEnv: override.apiKeyEnv,
            notes: override.notes,
          }
        : null,
      // UI metadata
      color: uiMeta.color,
      apiKeyPlaceholder: uiMeta.apiKeyPlaceholder,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /providers/:id/models - Get models for a provider
 */
app.get('/:id/models', (c) => {
  const id = c.req.param('id');
  const config = loadProviderConfig(id);

  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider '${id}' not found`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      provider: config.id,
      providerName: config.name,
      models: config.models,
      isConfigured: hasApiKey(config.id),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /providers/:id/config - Get user config overrides for a provider
 */
app.get('/:id/config', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const config = loadProviderConfig(id);

  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider '${id}' not found`,
        },
      },
      404
    );
  }

  // Get user override
  const userConfig = await modelConfigsRepo.getUserProviderConfig(userId, id);

  const response: ApiResponse = {
    success: true,
    data: {
      providerId: id,
      // Base config (from JSON)
      baseConfig: {
        type: config.type,
        baseUrl: config.baseUrl,
        apiKeyEnv: config.apiKeyEnv,
      },
      // User overrides (if any)
      userOverride: userConfig
        ? {
            baseUrl: userConfig.baseUrl,
            providerType: userConfig.providerType,
            isEnabled: userConfig.isEnabled,
            apiKeyEnv: userConfig.apiKeyEnv,
            notes: userConfig.notes,
          }
        : null,
      // Effective config (merged)
      effectiveConfig: {
        type: userConfig?.providerType || config.type,
        baseUrl: userConfig?.baseUrl || config.baseUrl,
        apiKeyEnv: userConfig?.apiKeyEnv || config.apiKeyEnv,
        isEnabled: userConfig?.isEnabled !== false,
      },
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * PUT /providers/:id/config - Update user config override for a provider
 */
app.put('/:id/config', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const config = loadProviderConfig(id);

  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider '${id}' not found`,
        },
      },
      404
    );
  }

  try {
    const body = await c.req.json();
    const { baseUrl, providerType, isEnabled, apiKeyEnv, notes } = body;

    const updated = await modelConfigsRepo.upsertUserProviderConfig({
      userId,
      providerId: id,
      baseUrl,
      providerType,
      isEnabled,
      apiKeyEnv,
      notes,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        providerId: id,
        userOverride: {
          baseUrl: updated.baseUrl,
          providerType: updated.providerType,
          isEnabled: updated.isEnabled,
          apiKeyEnv: updated.apiKeyEnv,
          notes: updated.notes,
        },
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update provider config',
        },
      },
      500
    );
  }
});

/**
 * DELETE /providers/:id/config - Delete user config override for a provider
 */
app.delete('/:id/config', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  const deleted = await modelConfigsRepo.deleteUserProviderConfig(userId, id);

  const response: ApiResponse = {
    success: true,
    data: {
      providerId: id,
      deleted,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * PATCH /providers/:id/toggle - Toggle provider enabled/disabled
 */
app.patch('/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const config = loadProviderConfig(id);

  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider '${id}' not found`,
        },
      },
      404
    );
  }

  try {
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'enabled must be a boolean',
          },
        },
        400
      );
    }

    await modelConfigsRepo.toggleUserProviderConfig(userId, id, enabled);
    const userConfig = await modelConfigsRepo.getUserProviderConfig(userId, id);

    const response: ApiResponse = {
      success: true,
      data: {
        providerId: id,
        isEnabled: userConfig?.isEnabled ?? true,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TOGGLE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to toggle provider',
        },
      },
      500
    );
  }
});

/**
 * GET /providers/overrides - Get all user provider overrides
 */
app.get('/overrides/all', async (c) => {
  const userId = getUserId(c);
  const overrides = await modelConfigsRepo.listUserProviderConfigs(userId);

  const response: ApiResponse = {
    success: true,
    data: {
      overrides: overrides.map((o) => ({
        providerId: o.providerId,
        baseUrl: o.baseUrl,
        providerType: o.providerType,
        isEnabled: o.isEnabled,
        apiKeyEnv: o.apiKeyEnv,
        notes: o.notes,
      })),
      total: overrides.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

export const providersRoutes = app;

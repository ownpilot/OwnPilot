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
  type AggregatorProvider,
} from '@ownpilot/core';
import { hasApiKey } from './settings.js';

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
  source: 'builtin' | 'aggregator' | 'custom';
}

interface MergedProvider {
  id: string;
  name: string;
  type: 'builtin' | 'aggregator' | 'custom';
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

function getUserId(c: { req: { query: (key: string) => string | undefined } }): string {
  return c.req.query('userId') || 'default';
}

/**
 * Check if a provider has an API key configured (in database or environment)
 */
function isProviderConfigured(providerId: string): boolean {
  return hasApiKey(providerId);
}

/**
 * Get merged models from all sources (builtin + aggregators + custom)
 * Includes ALL models, with isConfigured flag based on API key presence
 */
function getMergedModels(userId: string): MergedModel[] {
  const models: MergedModel[] = [];
  const userConfigs = modelConfigsRepo.listModels(userId);
  const disabledSet = modelConfigsRepo.getDisabledModelIds(userId);
  const userConfigMap = new Map(userConfigs.map((c) => [`${c.providerId}/${c.modelId}`, c]));

  // 1. Built-in providers from models.dev (ALL providers)
  const builtinProviders = getAllProviderConfigs();
  for (const provider of builtinProviders) {
    const configured = isProviderConfigured(provider.id);

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
    const userProvider = modelConfigsRepo.getProvider(userId, agg.id);
    if (!userProvider?.isEnabled) continue;

    // Check if API key is configured (either in env or in user settings)
    const configured = isProviderConfigured(agg.id);

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

  // 3. Custom models (user-added)
  const customModels = modelConfigsRepo.getCustomModels(userId);
  for (const custom of customModels) {
    // Avoid duplicates - skip if already in list
    const key = `${custom.providerId}/${custom.modelId}`;
    if (models.some((m) => `${m.providerId}/${m.modelId}` === key)) continue;

    models.push({
      providerId: custom.providerId,
      providerName: custom.providerId, // Will be resolved by UI
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
function getMergedProviders(userId: string): MergedProvider[] {
  const providers: MergedProvider[] = [];
  const customProviders = modelConfigsRepo.listProviders(userId);
  const customProviderMap = new Map(customProviders.map((p) => [p.providerId, p]));
  const disabledProviders = new Set(customProviders.filter((p) => !p.isEnabled).map((p) => p.providerId));

  // 1. Built-in providers (ALL from models.dev)
  const builtinProviders = getAllProviderConfigs();
  for (const provider of builtinProviders) {
    const configured = isProviderConfigured(provider.id);
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
    const configured = isProviderConfigured(agg.id);

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

    providers.push({
      id: custom.providerId,
      name: custom.displayName,
      type: 'custom',
      apiBase: custom.apiBaseUrl,
      apiKeySetting: custom.apiKeySetting,
      isEnabled: custom.isEnabled,
      isConfigured: true, // Custom providers are configured by definition
      modelCount: modelConfigsRepo.listModels(userId, custom.providerId).length,
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
modelConfigsRoutes.get('/', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.query('provider');
  const capability = c.req.query('capability') as ModelCapability | undefined;
  const enabledOnly = c.req.query('enabled') === 'true';

  let models = getMergedModels(userId);

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

  return c.json({
    success: true,
    data: models,
    count: models.length,
  });
});

/**
 * GET /api/v1/models/:provider - List models for a provider
 */
modelConfigsRoutes.get('/:provider', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');

  const models = getMergedModels(userId).filter((m) => m.providerId === providerId);

  return c.json({
    success: true,
    data: models,
    count: models.length,
  });
});

/**
 * GET /api/v1/models/:provider/:model - Get single model
 */
modelConfigsRoutes.get('/:provider/:model', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const model = getMergedModels(userId).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!model) {
    return c.json({ success: false, error: 'Model not found' }, 404);
  }

  return c.json({
    success: true,
    data: model,
  });
});

/**
 * POST /api/v1/models - Create custom model
 */
modelConfigsRoutes.post('/', async (c) => {
  const userId = getUserId(c);

  try {
    const body = await c.req.json<CreateModelConfigInput>();

    if (!body.providerId || !body.modelId) {
      return c.json({ success: false, error: 'Provider ID and Model ID are required' }, 400);
    }

    const config = modelConfigsRepo.upsertModel({
      ...body,
      userId,
      isCustom: true,
    });

    return c.json({
      success: true,
      message: 'Model created',
      data: config,
    });
  } catch (error) {
    console.error('Failed to create model:', error);
    return c.json({ success: false, error: 'Failed to create model' }, 500);
  }
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
    const existingModel = getMergedModels(userId).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return c.json({ success: false, error: 'Model not found' }, 404);
    }

    // Create or update override
    const config = modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      ...body,
      isCustom: existingModel.isCustom,
    });

    return c.json({
      success: true,
      message: 'Model updated',
      data: config,
    });
  } catch (error) {
    console.error('Failed to update model:', error);
    return c.json({ success: false, error: 'Failed to update model' }, 500);
  }
});

/**
 * DELETE /api/v1/models/:provider/:model - Delete custom model or remove override
 */
modelConfigsRoutes.delete('/:provider/:model', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const existingModel = getMergedModels(userId).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!existingModel) {
    return c.json({ success: false, error: 'Model not found' }, 404);
  }

  if (!existingModel.isCustom && !existingModel.hasOverride) {
    return c.json({ success: false, error: 'Cannot delete built-in model without override' }, 400);
  }

  const deleted = modelConfigsRepo.deleteModel(userId, providerId, modelId);

  return c.json({
    success: true,
    message: existingModel.isCustom ? 'Custom model deleted' : 'Override removed',
    deleted,
  });
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
      return c.json({ success: false, error: 'enabled field required (boolean)' }, 400);
    }

    // Check if model exists
    const existingModel = getMergedModels(userId).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return c.json({ success: false, error: 'Model not found' }, 404);
    }

    // Create config entry if it doesn't exist, then toggle
    modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      isEnabled: body.enabled,
      isCustom: existingModel.isCustom,
    });

    return c.json({
      success: true,
      message: `Model ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled,
    });
  } catch (error) {
    console.error('Failed to toggle model:', error);
    return c.json({ success: false, error: 'Failed to toggle model' }, 500);
  }
});

// =============================================================================
// Provider Routes
// =============================================================================

/**
 * GET /api/v1/providers - List all providers (merged view)
 */
modelConfigsRoutes.get('/providers/list', (c) => {
  const userId = getUserId(c);
  const type = c.req.query('type') as 'builtin' | 'aggregator' | 'custom' | undefined;

  let providers = getMergedProviders(userId);

  if (type) {
    providers = providers.filter((p) => p.type === type);
  }

  return c.json({
    success: true,
    data: providers,
    count: providers.length,
  });
});

/**
 * GET /api/v1/providers/available - List all providers available to enable/add
 * Includes both models.dev providers and aggregators, with isConfigured flag
 */
modelConfigsRoutes.get('/providers/available', (c) => {
  const userId = getUserId(c);
  const customProviders = modelConfigsRepo.listProviders(userId);
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
    const configured = isProviderConfigured(provider.id);
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
    const userProvider = modelConfigsRepo.getProvider(userId, agg.id);
    const configured = isProviderConfigured(agg.id);

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

  return c.json({
    success: true,
    data: available,
    counts: {
      total: available.length,
      enabled: available.filter((p) => p.isEnabled).length,
      configured: available.filter((p) => p.isConfigured).length,
    },
  });
});

/**
 * GET /api/v1/providers/:id - Get single provider
 */
modelConfigsRoutes.get('/providers/:id', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  const provider = getMergedProviders(userId).find((p) => p.id === providerId);

  if (!provider) {
    return c.json({ success: false, error: 'Provider not found' }, 404);
  }

  // Get models for this provider
  const models = getMergedModels(userId).filter((m) => m.providerId === providerId);

  return c.json({
    success: true,
    data: {
      ...provider,
      models,
    },
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
      return c.json({ success: false, error: 'Provider ID and display name are required' }, 400);
    }

    const provider = modelConfigsRepo.upsertProvider({
      ...body,
      userId,
    });

    return c.json({
      success: true,
      message: 'Provider created',
      data: provider,
    });
  } catch (error) {
    console.error('Failed to create provider:', error);
    return c.json({ success: false, error: 'Failed to create provider' }, 500);
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

    const existing = modelConfigsRepo.getProvider(userId, providerId);
    if (!existing) {
      // Create new entry for aggregator
      if (isAggregatorProvider(providerId)) {
        const agg = getAggregatorProvider(providerId)!;
        const provider = modelConfigsRepo.upsertProvider({
          userId,
          providerId,
          displayName: body.displayName || agg.name,
          apiBaseUrl: body.apiBaseUrl || agg.apiBase,
          apiKeySetting: body.apiKeySetting,
          providerType: agg.type,
          isEnabled: body.isEnabled ?? true,
          config: body.config,
        });

        return c.json({
          success: true,
          message: 'Provider configured',
          data: provider,
        });
      }

      return c.json({ success: false, error: 'Provider not found' }, 404);
    }

    const provider = modelConfigsRepo.updateProvider(userId, providerId, body);

    return c.json({
      success: true,
      message: 'Provider updated',
      data: provider,
    });
  } catch (error) {
    console.error('Failed to update provider:', error);
    return c.json({ success: false, error: 'Failed to update provider' }, 500);
  }
});

/**
 * DELETE /api/v1/providers/:id - Delete custom provider
 */
modelConfigsRoutes.delete('/providers/:id', (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('id');

  // Can't delete built-in providers
  const builtinProvider = getProviderConfig(providerId);
  if (builtinProvider) {
    return c.json({ success: false, error: 'Cannot delete built-in provider' }, 400);
  }

  const deleted = modelConfigsRepo.deleteProvider(userId, providerId);

  if (!deleted) {
    return c.json({ success: false, error: 'Provider not found' }, 404);
  }

  return c.json({
    success: true,
    message: 'Provider deleted',
  });
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
      return c.json({ success: false, error: 'enabled field required (boolean)' }, 400);
    }

    // Check if it's a builtin provider from models.dev
    const builtinProvider = getProviderConfig(providerId);
    if (builtinProvider) {
      // Create/update user preference for this provider
      // Use 'openai_compatible' as storage type for builtin providers
      modelConfigsRepo.upsertProvider({
        userId,
        providerId,
        displayName: builtinProvider.name,
        apiBaseUrl: builtinProvider.baseUrl,
        providerType: 'openai_compatible',
        isEnabled: body.enabled,
      });

      return c.json({
        success: true,
        message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
        enabled: body.enabled,
      });
    }

    // For aggregators, create config entry if doesn't exist
    if (isAggregatorProvider(providerId)) {
      const agg = getAggregatorProvider(providerId)!;
      modelConfigsRepo.upsertProvider({
        userId,
        providerId,
        displayName: agg.name,
        apiBaseUrl: agg.apiBase,
        providerType: agg.type,
        isEnabled: body.enabled,
      });
    } else {
      const toggled = modelConfigsRepo.toggleProvider(userId, providerId, body.enabled);
      if (!toggled) {
        return c.json({ success: false, error: 'Provider not found' }, 404);
      }
    }

    return c.json({
      success: true,
      message: `Provider ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled,
    });
  } catch (error) {
    console.error('Failed to toggle provider:', error);
    return c.json({ success: false, error: 'Failed to toggle provider' }, 500);
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
      return c.json({ success: false, error: `Failed to fetch models.dev: ${response.status}` }, 500);
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
    return c.json({
      success: true,
      message: 'Sync check complete. Run `npx tsx scripts/generate-provider-configs.ts` to apply changes.',
      stats: {
        providers: Object.keys(data).length,
        totalModels,
        newModels,
        updatedPricing,
      },
      note: 'User disabled models are preserved in database, not affected by sync.',
    });
  } catch (error) {
    console.error('Sync failed:', error);
    return c.json({ success: false, error: 'Sync failed' }, 500);
  }
});

/**
 * POST /api/v1/sync/apply - Actually apply sync by regenerating configs
 */
modelConfigsRoutes.post('/sync/apply', async (c) => {
  try {
    // Fetch models.dev API
    const response = await fetch(MODELS_DEV_API_URL);
    if (!response.ok) {
      return c.json({ success: false, error: `Failed to fetch models.dev: ${response.status}` }, 500);
    }

    const data = await response.json() as Record<string, ModelsDevProvider>;

    // Import fs and path for file operations
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    // Get configs directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configsDir = path.join(__dirname, '..', '..', '..', 'core', 'src', 'agent', 'providers', 'configs');

    // Check if directory exists (it might not in production)
    if (!fs.existsSync(configsDir)) {
      return c.json({
        success: false,
        error: 'Configs directory not found. Use CLI script instead: npx tsx scripts/generate-provider-configs.ts',
      }, 400);
    }

    let generated = 0;

    for (const [providerId, provider] of Object.entries(data)) {
      if (!provider.models || Object.keys(provider.models).length === 0) continue;

      const models = Object.values(provider.models);

      // Sort models: latest first
      models.sort((a, b) => {
        const aIsLatest = !a.id.match(/\d{4}/) && !a.id.includes('-preview');
        const bIsLatest = !b.id.match(/\d{4}/) && !b.id.includes('-preview');
        if (aIsLatest && !bIsLatest) return -1;
        if (!aIsLatest && bIsLatest) return 1;
        if (a.release_date && b.release_date) {
          return b.release_date.localeCompare(a.release_date);
        }
        return 0;
      });

      // Transform models
      const transformedModels = models.map((m, i) => {
        const capabilities: string[] = ['chat'];
        if (m.modalities?.input?.includes('image') || m.attachment) capabilities.push('vision');
        if (m.modalities?.input?.includes('audio')) capabilities.push('audio');
        if (m.tool_call) capabilities.push('function_calling');
        if (m.structured_output) capabilities.push('json_mode');
        if (m.reasoning) capabilities.push('reasoning');
        capabilities.push('streaming');

        return {
          id: m.id,
          name: m.name,
          contextWindow: m.limit?.context || 128000,
          maxOutput: m.limit?.output || 8192,
          inputPrice: m.cost?.input || 0,
          outputPrice: m.cost?.output || 0,
          capabilities: [...new Set(capabilities)],
          ...(i === 0 ? { default: true } : {}),
          ...(m.release_date ? { releaseDate: m.release_date } : {}),
        };
      });

      // Determine features
      const hasVision = models.some(m => m.attachment || m.modalities?.input?.includes('image'));
      const hasToolUse = models.some(m => m.tool_call);
      const hasJsonMode = models.some(m => m.structured_output);

      const config = {
        id: providerId,
        name: provider.name,
        type: 'openai-compatible',
        apiKeyEnv: provider.env?.[0] || `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`,
        features: {
          streaming: true,
          toolUse: hasToolUse,
          vision: hasVision,
          jsonMode: hasJsonMode,
          systemMessage: true,
        },
        models: transformedModels,
        ...(provider.api ? { baseUrl: provider.api } : {}),
        ...(provider.doc ? { docsUrl: provider.doc } : {}),
      };

      // Write config file
      const outputPath = path.join(configsDir, `${providerId}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n');
      generated++;
    }

    // Clear the provider config cache so new configs are loaded
    const { clearConfigCache } = await import('@ownpilot/core');
    clearConfigCache();

    return c.json({
      success: true,
      message: `Synced ${generated} providers from models.dev`,
      stats: {
        providers: generated,
        totalModels: Object.values(data).reduce((sum, p) => sum + Object.keys(p.models || {}).length, 0),
      },
    });
  } catch (error) {
    console.error('Sync apply failed:', error);
    return c.json({ success: false, error: 'Sync apply failed: ' + String(error) }, 500);
  }
});

// =============================================================================
// Capabilities Route
// =============================================================================

/**
 * GET /api/v1/capabilities - List all capability types
 */
modelConfigsRoutes.get('/capabilities/list', (c) => {
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

  return c.json({
    success: true,
    data: capabilities,
  });
});

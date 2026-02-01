/**
 * Local Providers Routes
 *
 * API endpoints for managing local AI providers (LM Studio, Ollama, LocalAI, vLLM, etc.)
 * Supports full CRUD, model discovery, enable/disable toggle, and default selection.
 */

import { Hono } from 'hono';
import { localProvidersRepo } from '../db/repositories/local-providers.js';
import { discoverModels } from '../services/local-discovery.js';
import { getLog } from '../services/log.js';
import { getUserId } from './helpers.js';

const log = getLog('LocalProviders');

export const localProvidersRoutes = new Hono();

// =============================================================================
// Templates
// =============================================================================

const LOCAL_PROVIDER_TEMPLATES = [
  { id: 'lmstudio', name: 'LM Studio', providerType: 'lmstudio' as const, baseUrl: 'http://localhost:1234', discoveryEndpoint: '/v1/models', description: 'Run models locally with LM Studio' },
  { id: 'ollama', name: 'Ollama', providerType: 'ollama' as const, baseUrl: 'http://localhost:11434', discoveryEndpoint: '/api/tags', description: 'Run Llama, Gemma, Qwen and more locally' },
  { id: 'localai', name: 'LocalAI', providerType: 'localai' as const, baseUrl: 'http://localhost:8080', discoveryEndpoint: '/v1/models', description: 'OpenAI-compatible local AI server' },
  { id: 'vllm', name: 'vLLM', providerType: 'vllm' as const, baseUrl: 'http://localhost:8000', discoveryEndpoint: '/v1/models', description: 'High-throughput LLM serving engine' },
  { id: 'custom', name: 'Custom Local Server', providerType: 'custom' as const, baseUrl: 'http://localhost:8080', discoveryEndpoint: '/v1/models', description: 'Any OpenAI-compatible local server' },
];

// =============================================================================
// Static Routes (MUST be before parameterized /:id routes)
// =============================================================================

/**
 * GET /templates - Get available local provider templates
 */
localProvidersRoutes.get('/templates', (c) => {
  return c.json({
    success: true,
    data: LOCAL_PROVIDER_TEMPLATES,
  });
});

/**
 * GET / - List all local providers with model counts
 */
localProvidersRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  try {
    const providers = await localProvidersRepo.listProviders(userId);

    const providersWithCounts = await Promise.all(
      providers.map(async (provider) => {
        const models = await localProvidersRepo.listModels(userId, provider.id);
        return {
          ...provider,
          modelCount: models.length,
        };
      })
    );

    return c.json({
      success: true,
      data: providersWithCounts,
    });
  } catch (error) {
    log.error('Failed to list local providers:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list local providers',
      },
      500
    );
  }
});

/**
 * POST / - Create a new local provider
 */
localProvidersRoutes.post('/', async (c) => {
  const userId = getUserId(c);

  try {
    const body = await c.req.json();
    const { name, providerType, baseUrl, apiKey, discoveryEndpoint } = body;

    if (!name || !providerType || !baseUrl) {
      return c.json(
        {
          success: false,
          error: 'name, providerType, and baseUrl are required',
        },
        400
      );
    }

    const provider = await localProvidersRepo.createProvider({
      userId,
      name,
      providerType,
      baseUrl,
      apiKey,
      discoveryEndpoint,
    });

    return c.json(
      {
        success: true,
        data: provider,
      },
      201
    );
  } catch (error) {
    log.error('Failed to create local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create local provider',
      },
      500
    );
  }
});

// =============================================================================
// Parameterized Routes (/:id and sub-resources)
// =============================================================================

/**
 * GET /:id - Get a single local provider with its models
 */
localProvidersRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const provider = await localProvidersRepo.getProvider(id);

    if (!provider) {
      return c.json(
        {
          success: false,
          error: 'Local provider not found',
        },
        404
      );
    }

    const models = await localProvidersRepo.listModels(userId, id);

    return c.json({
      success: true,
      data: {
        ...provider,
        models,
      },
    });
  } catch (error) {
    log.error('Failed to get local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get local provider',
      },
      500
    );
  }
});

/**
 * PUT /:id - Update a local provider
 */
localProvidersRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const { name, baseUrl, apiKey, discoveryEndpoint, isEnabled } = body;

    const updated = await localProvidersRepo.updateProvider(id, {
      name,
      baseUrl,
      apiKey,
      discoveryEndpoint,
      isEnabled,
    });

    if (!updated) {
      return c.json(
        {
          success: false,
          error: 'Local provider not found',
        },
        404
      );
    }

    return c.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    log.error('Failed to update local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update local provider',
      },
      500
    );
  }
});

/**
 * DELETE /:id - Delete a local provider (CASCADE deletes its models)
 */
localProvidersRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const deleted = await localProvidersRepo.deleteProvider(id);

    if (!deleted) {
      return c.json(
        {
          success: false,
          error: 'Local provider not found',
        },
        404
      );
    }

    return c.json({
      success: true,
      message: 'Local provider deleted',
    });
  } catch (error) {
    log.error('Failed to delete local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete local provider',
      },
      500
    );
  }
});

/**
 * PATCH /:id/toggle - Toggle provider enabled/disabled
 */
localProvidersRoutes.patch('/:id/toggle', async (c) => {
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json(
        {
          success: false,
          error: 'enabled field is required and must be a boolean',
        },
        400
      );
    }

    const updated = await localProvidersRepo.updateProvider(id, { isEnabled: enabled });

    if (!updated) {
      return c.json(
        {
          success: false,
          error: 'Local provider not found',
        },
        404
      );
    }

    return c.json({
      success: true,
      data: updated,
      message: `Local provider ${enabled ? 'enabled' : 'disabled'}`,
    });
  } catch (error) {
    log.error('Failed to toggle local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle local provider',
      },
      500
    );
  }
});

/**
 * PATCH /:id/set-default - Set as the default local provider
 */
localProvidersRoutes.patch('/:id/set-default', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    await localProvidersRepo.setDefault(userId, id);

    return c.json({
      success: true,
      message: 'Default local provider updated',
    });
  } catch (error) {
    log.error('Failed to set default local provider:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set default local provider',
      },
      500
    );
  }
});

/**
 * POST /:id/discover - Discover models from a local provider
 *
 * Contacts the provider's discovery endpoint, upserts discovered models,
 * and tracks new vs existing models.
 */
localProvidersRoutes.post('/:id/discover', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const provider = await localProvidersRepo.getProvider(id);

    if (!provider) {
      return c.json(
        {
          success: false,
          error: 'Local provider not found',
        },
        404
      );
    }

    const result = await discoverModels(provider);

    // If discovery returned an error and no models, report upstream failure
    if (result.error && (!result.models || result.models.length === 0)) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        502
      );
    }

    const discovered = result.models || [];

    // Get existing models before upserting so we can track new vs existing
    const existingModels = await localProvidersRepo.listModels(userId, id);
    const existingModelIds = new Set(existingModels.map((m) => m.modelId));

    let newCount = 0;
    let existingCount = 0;

    for (const model of discovered) {
      const isNew = !existingModelIds.has(model.modelId);

      await localProvidersRepo.upsertModel({
        localProviderId: id,
        modelId: model.modelId,
        displayName: model.displayName,
        metadata: model.metadata,
      });

      if (isNew) {
        newCount++;
      } else {
        existingCount++;
      }
    }

    // Update the provider's last discovery timestamp
    await localProvidersRepo.updateDiscoveredAt(id);

    return c.json({
      success: true,
      data: {
        sourceUrl: result.sourceUrl,
        totalModels: discovered.length,
        newModels: newCount,
        existingModels: existingCount,
        models: discovered,
      },
    });
  } catch (error) {
    log.error('Failed to discover models:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover models',
      },
      500
    );
  }
});

/**
 * GET /:id/models - List models for a local provider
 */
localProvidersRoutes.get('/:id/models', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const models = await localProvidersRepo.listModels(userId, id);

    return c.json({
      success: true,
      data: models,
    });
  } catch (error) {
    log.error('Failed to list local provider models:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list models',
      },
      500
    );
  }
});

/**
 * PATCH /:id/models/:modelId/toggle - Toggle a model enabled/disabled
 *
 * The modelId path parameter is URI-encoded since model IDs can contain slashes.
 * We look up the model by its logical modelId within the provider, then use
 * the database record's id to perform the toggle.
 */
localProvidersRoutes.patch('/:id/models/:modelId/toggle', async (c) => {
  const id = c.req.param('id');
  const modelId = decodeURIComponent(c.req.param('modelId'));

  try {
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json(
        {
          success: false,
          error: 'enabled field is required and must be a boolean',
        },
        400
      );
    }

    // Find the model by provider ID + logical modelId to get its DB record id
    const userId = getUserId(c);
    const models = await localProvidersRepo.listModels(userId, id);
    const model = models.find((m) => m.modelId === modelId);

    if (!model) {
      return c.json(
        {
          success: false,
          error: 'Model not found',
        },
        404
      );
    }

    await localProvidersRepo.toggleModel(model.id, enabled);

    return c.json({
      success: true,
      message: `Model ${enabled ? 'enabled' : 'disabled'}`,
      enabled,
    });
  } catch (error) {
    log.error('Failed to toggle model:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle model',
      },
      500
    );
  }
});

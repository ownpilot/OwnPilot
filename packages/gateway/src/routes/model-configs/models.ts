/**
 * Model CRUD endpoints
 *
 * Handles listing, creating, updating, deleting, and toggling model configs.
 * Includes capabilities listing and parameterized provider/model routes.
 */

import { Hono } from 'hono';
import {
  modelConfigsRepo,
  type CreateModelConfigInput,
  type UpdateModelConfigInput,
} from '../../db/repositories/index.js';
import { type ModelCapability } from '@ownpilot/core';
import { getLog } from '../../services/log.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  validateQueryEnum,
  notFoundError,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { getMergedModels } from './shared.js';

const log = getLog('ModelConfigs');

export const modelRoutes = new Hono();

// =============================================================================
// Model Routes
// =============================================================================

/**
 * GET /api/v1/models - List all models (merged view)
 */
modelRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.query('provider');
  const capability = validateQueryEnum(c.req.query('capability'), [
    'chat',
    'code',
    'vision',
    'function_calling',
    'json_mode',
    'streaming',
    'embeddings',
    'image_generation',
    'audio',
    'reasoning',
  ] as const);
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
modelRoutes.post('/', async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json<CreateModelConfigInput>().catch(() => null);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    if (!body.providerId || !body.modelId) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'Provider ID and Model ID are required' },
        400
      );
    }

    const config = await modelConfigsRepo.upsertModel({
      ...body,
      userId,
      isCustom: true,
    });

    wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'created' });
    return apiResponse(c, config);
  } catch (error) {
    log.error('Failed to create model:', error);
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: 'Failed to create model' }, 500);
  }
});

// =============================================================================
// Capabilities Route
// =============================================================================

/**
 * GET /api/v1/capabilities - List all capability types
 */
modelRoutes.get('/capabilities/list', async (c) => {
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
modelRoutes.get('/:provider', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');

  const models = (await getMergedModels(userId)).filter((m) => m.providerId === providerId);

  return apiResponse(c, models);
});

/**
 * GET /api/v1/models/:provider/:model - Get single model
 */
modelRoutes.get('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const model = (await getMergedModels(userId)).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!model) {
    return notFoundError(c, 'Model', modelId);
  }

  return apiResponse(c, model);
});

/**
 * PUT /api/v1/models/:provider/:model - Update model config
 */
modelRoutes.put('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const body = await c.req.json<UpdateModelConfigInput>().catch(() => null);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    // Check if model exists in any source
    const existingModel = (await getMergedModels(userId)).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return notFoundError(c, 'Model', modelId);
    }

    // Create or update override
    const config = await modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      ...body,
      isCustom: existingModel.isCustom,
    });

    wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'updated' });
    return apiResponse(c, { message: 'Model updated', data: config });
  } catch (error) {
    log.error('Failed to update model:', error);
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update model' }, 500);
  }
});

/**
 * DELETE /api/v1/models/:provider/:model - Delete custom model or remove override
 */
modelRoutes.delete('/:provider/:model', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

  const existingModel = (await getMergedModels(userId)).find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );

  if (!existingModel) {
    return notFoundError(c, 'Model', modelId);
  }

  if (!existingModel.isCustom && !existingModel.hasOverride) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Cannot delete built-in model without override',
      },
      400
    );
  }

  const deleted = await modelConfigsRepo.deleteModel(userId, providerId, modelId);

  wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'deleted' });
  return apiResponse(c, {
    message: existingModel.isCustom ? 'Custom model deleted' : 'Override removed',
    deleted,
  });
});

/**
 * PATCH /api/v1/models/:provider/:model/toggle - Toggle model enabled
 */
modelRoutes.patch('/:provider/:model/toggle', async (c) => {
  const userId = getUserId(c);
  const providerId = c.req.param('provider');
  const modelId = decodeURIComponent(c.req.param('model'));

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

    // Check if model exists
    const existingModel = (await getMergedModels(userId)).find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );

    if (!existingModel) {
      return notFoundError(c, 'Model', modelId);
    }

    // Create config entry if it doesn't exist, then toggle
    await modelConfigsRepo.upsertModel({
      userId,
      providerId,
      modelId,
      isEnabled: body.enabled,
      isCustom: existingModel.isCustom,
    });

    wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'updated' });
    return apiResponse(c, {
      message: `Model ${body.enabled ? 'enabled' : 'disabled'}`,
      enabled: body.enabled,
    });
  } catch (error) {
    log.error('Failed to toggle model:', error);
    return apiError(c, { code: ERROR_CODES.TOGGLE_FAILED, message: 'Failed to toggle model' }, 500);
  }
});

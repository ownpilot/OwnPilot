/**
 * Channel Bridge Routes
 *
 * REST API for managing cross-channel message bridges (UCP).
 */

import { Hono } from 'hono';
import { ChannelBridgesRepository } from '../db/repositories/channel-bridges.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, getUserId } from './helpers.js';
import { validateBody, createBridgeSchema, updateBridgeSchema } from '../middleware/validation.js';

export const bridgeRoutes = new Hono();

function getRepo(): ChannelBridgesRepository {
  return new ChannelBridgesRepository();
}

// =============================================================================
// GET / - List all bridges
// =============================================================================

bridgeRoutes.get('/', async (c) => {
  try {
    const repo = getRepo();
    const channelId = c.req.query('channelId');

    const bridges = channelId ? await repo.getByChannel(channelId) : await repo.getAll();

    return apiResponse(c, bridges);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// GET /:id - Get a specific bridge
// =============================================================================

bridgeRoutes.get('/:id', async (c) => {
  try {
    const repo = getRepo();
    const userId = getUserId(c);
    const id = c.req.param('id');

    const bridge = await repo.getById(id);
    if (!bridge) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
    }

    if (!(await repo.isOwnedByUser(id, userId))) {
      return apiError(c, { code: ERROR_CODES.FORBIDDEN, message: 'Access denied' }, 403);
    }

    return apiResponse(c, bridge);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// POST / - Create a new bridge
// =============================================================================

bridgeRoutes.post('/', async (c) => {
  try {
    const body = validateBody(createBridgeSchema, await c.req.json());

    const repo = getRepo();
    const bridge = await repo.save({
      sourceChannelId: body.sourceChannelId,
      targetChannelId: body.targetChannelId,
      direction: body.direction ?? 'both',
      filterPattern: body.filterPattern ?? undefined,
      enabled: body.enabled ?? true,
    });

    return apiResponse(c, bridge, 201);
  } catch (e) {
    const msg = getErrorMessage(e);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

// =============================================================================
// PATCH /:id - Update a bridge
// =============================================================================

bridgeRoutes.patch('/:id', async (c) => {
  try {
    const repo = getRepo();
    const userId = getUserId(c);
    const id = c.req.param('id');

    const existing = await repo.getById(id);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
    }

    if (!(await repo.isOwnedByUser(id, userId))) {
      return apiError(c, { code: ERROR_CODES.FORBIDDEN, message: 'Access denied' }, 403);
    }

    const body = validateBody(updateBridgeSchema, await c.req.json());

    await repo.update(id, body);

    const updated = await repo.getById(id);
    return apiResponse(c, updated);
  } catch (e) {
    const msg = getErrorMessage(e);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

// =============================================================================
// DELETE /:id - Delete a bridge
// =============================================================================

bridgeRoutes.delete('/:id', async (c) => {
  try {
    const repo = getRepo();
    const userId = getUserId(c);
    const id = c.req.param('id');

    const existing = await repo.getById(id);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
    }

    if (!(await repo.isOwnedByUser(id, userId))) {
      return apiError(c, { code: ERROR_CODES.FORBIDDEN, message: 'Access denied' }, 403);
    }

    await repo.remove(id);
    return apiResponse(c, { deleted: true });
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

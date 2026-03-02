/**
 * Channel Bridge Routes
 *
 * REST API for managing cross-channel message bridges (UCP).
 */

import { Hono } from 'hono';
import { ChannelBridgesRepository } from '../db/repositories/channel-bridges.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

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
    const bridge = await repo.getById(c.req.param('id'));

    if (!bridge) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
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
    const body = await c.req.json();

    const { sourceChannelId, targetChannelId, direction, filterPattern, enabled } = body;

    if (!sourceChannelId || !targetChannelId) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'sourceChannelId and targetChannelId are required',
        },
        400
      );
    }

    if (sourceChannelId === targetChannelId) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Cannot bridge a channel to itself' },
        400
      );
    }

    const validDirections = ['source_to_target', 'target_to_source', 'both'];
    if (direction && !validDirections.includes(direction)) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Invalid direction. Must be one of: ${validDirections.join(', ')}`,
        },
        400
      );
    }

    // Validate filter pattern if provided
    if (filterPattern) {
      try {
        new RegExp(filterPattern);
      } catch {
        return apiError(
          c,
          {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid filter pattern (must be valid regex)',
          },
          400
        );
      }
    }

    const repo = getRepo();
    const bridge = await repo.save({
      sourceChannelId,
      targetChannelId,
      direction: direction ?? 'both',
      filterPattern: filterPattern ?? undefined,
      enabled: enabled ?? true,
    });

    return apiResponse(c, bridge, 201);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// PATCH /:id - Update a bridge
// =============================================================================

bridgeRoutes.patch('/:id', async (c) => {
  try {
    const repo = getRepo();
    const id = c.req.param('id');

    const existing = await repo.getById(id);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
    }

    const body = await c.req.json();

    // Validate filter pattern if provided
    if (body.filterPattern) {
      try {
        new RegExp(body.filterPattern);
      } catch {
        return apiError(
          c,
          {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid filter pattern (must be valid regex)',
          },
          400
        );
      }
    }

    await repo.update(id, body);

    const updated = await repo.getById(id);
    return apiResponse(c, updated);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Delete a bridge
// =============================================================================

bridgeRoutes.delete('/:id', async (c) => {
  try {
    const repo = getRepo();
    const id = c.req.param('id');

    const existing = await repo.getById(id);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bridge not found' }, 404);
    }

    await repo.remove(id);
    return apiResponse(c, { deleted: true });
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

/**
 * Subagent Routes
 *
 * REST API for managing ephemeral subagents.
 */

import { Hono } from 'hono';
import { getSubagentService } from '../services/subagent-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';

export const subagentRoutes = new Hono();

// =============================================================================
// GET / - List active subagents
// =============================================================================

subagentRoutes.get('/', (c) => {
  try {
    const userId = getUserId(c);
    const parentId = c.req.query('parentId');
    const service = getSubagentService();

    if (parentId) {
      const sessions = service.listByParent(parentId, userId);
      return apiResponse(c, sessions);
    }

    // Without parentId, return empty (no way to list all without parent)
    return apiResponse(c, []);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST / - Spawn a subagent
// =============================================================================

subagentRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();
    const service = getSubagentService();

    if (!body.name || !body.task) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'name and task are required' },
        400
      );
    }

    const session = await service.spawn({
      parentId: body.parentId ?? 'api',
      parentType: body.parentType ?? 'chat',
      userId,
      name: body.name,
      task: body.task,
      context: body.context,
      allowedTools: body.allowedTools,
      provider: body.provider,
      model: body.model,
      limits: body.limits,
    });

    return apiResponse(c, session, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /history - Get execution history
// =============================================================================

subagentRoutes.get('/history', async (c) => {
  try {
    const userId = getUserId(c);
    const parentId = c.req.query('parentId') ?? '';
    const { limit, offset } = getPaginationParams(c);
    const service = getSubagentService();

    const result = await service.getHistory(parentId, userId, limit, offset);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id - Get subagent session/result
// =============================================================================

subagentRoutes.get('/:id', (c) => {
  try {
    const userId = getUserId(c);
    const subagentId = c.req.param('id');
    const service = getSubagentService();

    const session = service.getSession(subagentId, userId);
    if (!session) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Subagent ${subagentId} not found` },
        404
      );
    }

    return apiResponse(c, session);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Cancel a subagent
// =============================================================================

subagentRoutes.delete('/:id', (c) => {
  try {
    const userId = getUserId(c);
    const subagentId = c.req.param('id');
    const service = getSubagentService();

    const cancelled = service.cancel(subagentId, userId);
    if (!cancelled) {
      return apiError(
        c,
        {
          code: ERROR_CODES.NOT_FOUND,
          message: `Subagent ${subagentId} not found or already completed`,
        },
        404
      );
    }

    return apiResponse(c, { message: `Subagent ${subagentId} cancelled` });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

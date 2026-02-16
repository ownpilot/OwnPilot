/**
 * Heartbeats Routes
 *
 * API for managing heartbeat entries (NL-to-cron periodic tasks).
 */

import { Hono } from 'hono';
import { getHeartbeatService, HeartbeatServiceError } from '../services/heartbeat-service.js';
import { getUserId, apiResponse, apiError, getIntParam, ERROR_CODES, getErrorMessage } from './helpers.js';

export const heartbeatsRoutes = new Hono();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET / - List heartbeats
 */
heartbeatsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const enabled = c.req.query('enabled');
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  const service = getHeartbeatService();
  const heartbeats = await service.listHeartbeats(userId, {
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    limit,
  });

  return apiResponse(c, { heartbeats, total: heartbeats.length });
});

/**
 * POST / - Create a heartbeat
 */
heartbeatsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const { scheduleText, taskDescription, name, enabled, tags } = body as {
    scheduleText?: string;
    taskDescription?: string;
    name?: string;
    enabled?: boolean;
    tags?: string[];
  };

  if (!scheduleText?.trim()) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'scheduleText is required' }, 400);
  }
  if (!taskDescription?.trim()) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'taskDescription is required' }, 400);
  }

  try {
    const service = getHeartbeatService();
    const heartbeat = await service.createHeartbeat(userId, {
      scheduleText,
      taskDescription,
      name,
      enabled,
      tags,
    });
    return apiResponse(c, { heartbeat, message: 'Heartbeat created successfully.' }, 201);
  } catch (error) {
    if (error instanceof HeartbeatServiceError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: getErrorMessage(error, 'Failed to create heartbeat') }, 500);
  }
});

/**
 * GET /:id - Get a heartbeat
 */
heartbeatsRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getHeartbeatService();
  const heartbeat = await service.getHeartbeat(userId, id);

  if (!heartbeat) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Heartbeat not found' }, 404);
  }

  return apiResponse(c, { heartbeat });
});

/**
 * PATCH /:id - Update a heartbeat
 */
heartbeatsRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    const service = getHeartbeatService();
    const heartbeat = await service.updateHeartbeat(userId, id, body);

    if (!heartbeat) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Heartbeat not found' }, 404);
    }

    return apiResponse(c, { heartbeat, message: 'Heartbeat updated successfully.' });
  } catch (error) {
    if (error instanceof HeartbeatServiceError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(error, 'Failed to update heartbeat') }, 500);
  }
});

/**
 * DELETE /:id - Delete a heartbeat + backing trigger
 */
heartbeatsRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getHeartbeatService();
  const deleted = await service.deleteHeartbeat(userId, id);

  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Heartbeat not found' }, 404);
  }

  return apiResponse(c, { message: 'Heartbeat deleted successfully.' });
});

/**
 * POST /:id/enable - Enable heartbeat + trigger
 */
heartbeatsRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getHeartbeatService();
  const heartbeat = await service.enableHeartbeat(userId, id);

  if (!heartbeat) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Heartbeat not found' }, 404);
  }

  return apiResponse(c, { heartbeat, message: 'Heartbeat enabled.' });
});

/**
 * POST /:id/disable - Disable heartbeat + trigger
 */
heartbeatsRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getHeartbeatService();
  const heartbeat = await service.disableHeartbeat(userId, id);

  if (!heartbeat) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Heartbeat not found' }, 404);
  }

  return apiResponse(c, { heartbeat, message: 'Heartbeat disabled.' });
});

/**
 * POST /import - Import from markdown
 */
heartbeatsRoutes.post('/import', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || typeof (body as { markdown?: string }).markdown !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'markdown field is required (string)' }, 400);
  }

  const service = getHeartbeatService();
  const result = await service.importMarkdown(userId, (body as { markdown: string }).markdown);

  return apiResponse(c, result, 201);
});

/**
 * GET /export - Export as markdown
 */
heartbeatsRoutes.get('/export', async (c) => {
  const userId = getUserId(c);

  const service = getHeartbeatService();
  const markdown = await service.exportMarkdown(userId);

  return apiResponse(c, { markdown });
});

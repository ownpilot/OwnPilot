/**
 * Heartbeats Routes
 *
 * API for managing heartbeat entries (NL-to-cron periodic tasks).
 *
 * Uses createCrudRoutes factory for standard GET /:id and DELETE /:id,
 * with custom handlers for list, create, update (which need specialized
 * validation and error handling), and the import/export/enable/disable endpoints.
 */

import { Hono } from 'hono';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { HeartbeatServiceError } from '../services/heartbeat-service.js';
import type { HeartbeatService } from '../services/heartbeat-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  getIntParam,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import { createCrudRoutes } from './crud-factory.js';

export const heartbeatsRoutes = new Hono();

/** Get HeartbeatService from registry. */
const getService = () => getServiceRegistry().get(Services.Heartbeat) as HeartbeatService;

// ============================================================================
// Custom Routes (must be registered BEFORE parametric /:id routes)
// ============================================================================

/**
 * GET / - List heartbeats
 * (Custom: uses enabled filter and listHeartbeats-specific API)
 */
heartbeatsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const enabled = c.req.query('enabled');
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  const service = getService();
  const heartbeats = await service.listHeartbeats(userId, {
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    limit,
  });

  return apiResponse(c, { heartbeats, total: heartbeats.length });
});

/**
 * POST / - Create a heartbeat
 * (Custom: has manual field validation and HeartbeatServiceError handling)
 */
heartbeatsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);

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
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'scheduleText is required' },
      400
    );
  }
  if (!taskDescription?.trim()) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'taskDescription is required' },
      400
    );
  }

  try {
    const service = getService();
    const heartbeat = await service.createHeartbeat(userId, {
      scheduleText,
      taskDescription,
      name,
      enabled,
      tags,
    });
    wsGateway.broadcast('data:changed', {
      entity: 'heartbeat',
      action: 'created',
      id: heartbeat.id,
    });
    return apiResponse(c, { heartbeat, message: 'Heartbeat created successfully.' }, 201);
  } catch (error) {
    if (error instanceof HeartbeatServiceError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to create heartbeat'),
      },
      500
    );
  }
});

/**
 * POST /import - Import from markdown
 * (Static route: must be defined before parametric /:id routes)
 */
heartbeatsRoutes.post('/import', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);

  if (!body || typeof (body as { markdown?: string }).markdown !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'markdown field is required (string)' },
      400
    );
  }

  const service = getService();
  const result = await service.importMarkdown(userId, (body as { markdown: string }).markdown);

  return apiResponse(c, result, 201);
});

/**
 * GET /export - Export as markdown
 * (Static route: must be defined before parametric /:id routes)
 */
heartbeatsRoutes.get('/export', async (c) => {
  const userId = getUserId(c);

  const service = getService();
  const markdown = await service.exportMarkdown(userId);

  return apiResponse(c, { markdown });
});

// ============================================================================
// Factory-generated CRUD routes: GET /:id, DELETE /:id
// ============================================================================

const crudRoutes = createCrudRoutes({
  entity: 'heartbeat',
  serviceToken: Services.Heartbeat,
  methods: ['get', 'delete'],
  serviceMethods: {
    get: 'getHeartbeat',
    delete: 'deleteHeartbeat',
  },
});

heartbeatsRoutes.route('/', crudRoutes);

// ============================================================================
// Custom PATCH /:id (needs HeartbeatServiceError handling)
// ============================================================================

/**
 * PATCH /:id - Update a heartbeat
 * (Custom: catches HeartbeatServiceError for domain-specific error codes)
 */
heartbeatsRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await parseJsonBody(c);

  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  try {
    const service = getService();
    const heartbeat = await service.updateHeartbeat(userId, id, body);

    if (!heartbeat) {
      return notFoundError(c, 'Heartbeat', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'heartbeat', action: 'updated', id });
    return apiResponse(c, { heartbeat, message: 'Heartbeat updated successfully.' });
  } catch (error) {
    if (error instanceof HeartbeatServiceError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to update heartbeat'),
      },
      500
    );
  }
});

// ============================================================================
// Custom Parametric Routes (after factory-generated /:id)
// ============================================================================

/**
 * POST /:id/enable - Enable heartbeat + trigger
 */
heartbeatsRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getService();
  const heartbeat = await service.enableHeartbeat(userId, id);

  if (!heartbeat) {
    return notFoundError(c, 'Heartbeat', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'heartbeat', action: 'updated', id });

  return apiResponse(c, { heartbeat, message: 'Heartbeat enabled.' });
});

/**
 * POST /:id/disable - Disable heartbeat + trigger
 */
heartbeatsRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getService();
  const heartbeat = await service.disableHeartbeat(userId, id);

  if (!heartbeat) {
    return notFoundError(c, 'Heartbeat', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'heartbeat', action: 'updated', id });

  return apiResponse(c, { heartbeat, message: 'Heartbeat disabled.' });
});

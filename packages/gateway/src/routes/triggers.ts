/**
 * Triggers Routes
 *
 * API for managing proactive triggers.
 */

import { Hono } from 'hono';
import {
  type TriggerType,
  type CreateTriggerInput,
  type UpdateTriggerInput,
} from '../db/repositories/triggers.js';
import { getTriggerService } from '../services/trigger-service.js';
import { getTriggerEngine } from '../triggers/index.js';
import { validateCronExpression } from '@ownpilot/core';
import { getUserId, apiResponse, getIntParam } from './helpers.js'
import { ERROR_CODES } from './helpers.js';

export const triggersRoutes = new Hono();

// ============================================================================
// Trigger Routes
// ============================================================================

/**
 * GET /triggers - List triggers
 */
triggersRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const type = c.req.query('type') as TriggerType | undefined;
  const enabled = c.req.query('enabled');
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  const service = getTriggerService();
  const triggers = await service.listTriggers(userId, {
    type,
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    limit,
  });

  return apiResponse(c, {
      triggers,
      total: triggers.length,
    });
});

/**
 * POST /triggers - Create a new trigger
 */
triggersRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const rawBody = await c.req.json();
  const { validateBody, createTriggerSchema } = await import('../middleware/validation.js');
  const body = validateBody(createTriggerSchema, rawBody) as unknown as CreateTriggerInput;

  // Validate cron expression for schedule triggers before saving
  if (body.type === 'schedule') {
    const config = body.config as { cron?: string };
    if (!config.cron) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.INVALID_CRON,
            message: 'Schedule triggers require a cron expression in config.cron',
          },
        },
        400
      );
    }
    const validation = validateCronExpression(config.cron);
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.INVALID_CRON,
            message: validation.error!,
          },
        },
        400
      );
    }
  }

  const service = getTriggerService();

  let trigger;
  try {
    trigger = await service.createTrigger(userId, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create trigger';
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.CREATE_FAILED,
          message,
        },
      },
      400
    );
  }

  return apiResponse(c, {
      trigger,
      message: 'Trigger created successfully.',
    }, 201);
});

/**
 * GET /triggers/stats - Get trigger statistics
 */
triggersRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const service = getTriggerService();
  const stats = await service.getStats(userId);

  return apiResponse(c, stats);
});

/**
 * GET /triggers/history - Get recent trigger history
 */
triggersRoutes.get('/history', async (c) => {
  const userId = getUserId(c);
  const limit = getIntParam(c, 'limit', 50, 1, 200);

  const service = getTriggerService();
  const history = await service.getRecentHistory(userId, limit);

  return apiResponse(c, {
      history,
      count: history.length,
    });
});

/**
 * GET /triggers/due - Get triggers that are due to fire
 */
triggersRoutes.get('/due', async (c) => {
  const userId = getUserId(c);

  const service = getTriggerService();
  const triggers = await service.getDueTriggers(userId);

  return apiResponse(c, {
      triggers,
      count: triggers.length,
    });
});

/**
 * GET /triggers/:id - Get a specific trigger
 */
triggersRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  // Get recent history for this trigger
  const history = await service.getHistoryForTrigger(userId, id, 10);

  return apiResponse(c, {
      ...trigger,
      recentHistory: history,
    });
});

/**
 * PATCH /triggers/:id - Update a trigger
 */
triggersRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<UpdateTriggerInput>();

  const service = getTriggerService();

  // Validate cron expression if config is being updated on a schedule trigger
  if (body.config) {
    const existing = await service.getTrigger(userId, id);
    if (existing?.type === 'schedule') {
      const config = body.config as { cron?: string };
      if (config.cron) {
        const validation = validateCronExpression(config.cron);
        if (!validation.valid) {
          return c.json(
            {
              success: false,
              error: {
                code: ERROR_CODES.INVALID_CRON,
                message: validation.error!,
              },
            },
            400
          );
        }
      }
    }
  }

  const updated = await service.updateTrigger(userId, id, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  return apiResponse(c, updated);
});

/**
 * POST /triggers/:id/enable - Enable a trigger
 */
triggersRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getTriggerService();
  const updated = await service.updateTrigger(userId, id, { enabled: true });

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  return apiResponse(c, {
      trigger: updated,
      message: 'Trigger enabled.',
    });
});

/**
 * POST /triggers/:id/disable - Disable a trigger
 */
triggersRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getTriggerService();
  const updated = await service.updateTrigger(userId, id, { enabled: false });

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  return apiResponse(c, {
      trigger: updated,
      message: 'Trigger disabled.',
    });
});

/**
 * POST /triggers/:id/fire - Manually fire a trigger
 */
triggersRoutes.post('/:id/fire', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  // Fire the trigger using the engine
  const engine = getTriggerEngine({ userId });
  const result = await engine.fireTrigger(id);

  return c.json({
    success: result.success,
    data: {
      result,
      message: result.success ? 'Trigger fired successfully.' : 'Trigger execution failed.',
    },
    error: result.error
      ? {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: result.error,
        }
      : undefined,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  }, result.success ? 200 : 500);
});

/**
 * DELETE /triggers/:id - Delete a trigger
 */
triggersRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getTriggerService();
  const deleted = await service.deleteTrigger(userId, id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  return apiResponse(c, {
      message: 'Trigger deleted successfully.',
    });
});

/**
 * GET /triggers/:id/history - Get history for a specific trigger
 */
triggersRoutes.get('/:id/history', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  const service = getTriggerService();
  const trigger = await service.getTrigger(userId, id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const history = await service.getHistoryForTrigger(userId, id, limit);

  return apiResponse(c, {
      triggerId: id,
      triggerName: trigger.name,
      history,
      count: history.length,
    });
});

/**
 * POST /triggers/cleanup - Clean up old history
 */
triggersRoutes.post('/cleanup', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{ maxAgeDays?: number }>().catch((): { maxAgeDays?: number } => ({}));

  const service = getTriggerService();
  const deleted = await service.cleanupHistory(userId, body.maxAgeDays ?? 30);

  return apiResponse(c, {
      deletedCount: deleted,
      message: `Cleaned up ${deleted} old history entries.`,
    });
});

// ============================================================================
// Engine Control Routes
// ============================================================================

/**
 * GET /triggers/engine/status - Get engine status
 */
triggersRoutes.get('/engine/status', (c) => {
  const engine = getTriggerEngine();

  return apiResponse(c, {
      running: engine.isRunning(),
    });
});

/**
 * POST /triggers/engine/start - Start the trigger engine
 */
triggersRoutes.post('/engine/start', (c) => {
  const engine = getTriggerEngine();
  engine.start();

  return apiResponse(c, {
      running: engine.isRunning(),
      message: 'Trigger engine started.',
    });
});

/**
 * POST /triggers/engine/stop - Stop the trigger engine
 */
triggersRoutes.post('/engine/stop', (c) => {
  const engine = getTriggerEngine();
  engine.stop();

  return apiResponse(c, {
      running: engine.isRunning(),
      message: 'Trigger engine stopped.',
    });
});

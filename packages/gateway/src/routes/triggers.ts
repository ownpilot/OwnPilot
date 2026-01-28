/**
 * Triggers Routes
 *
 * API for managing proactive triggers.
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import {
  TriggersRepository,
  type TriggerType,
  type CreateTriggerInput,
  type UpdateTriggerInput,
} from '../db/repositories/triggers.js';
import { getTriggerEngine } from '../triggers/index.js';

export const triggersRoutes = new Hono();

// Get repository instance
function getRepo(userId = 'default'): TriggersRepository {
  return new TriggersRepository(userId);
}

// ============================================================================
// Trigger Routes
// ============================================================================

/**
 * GET /triggers - List triggers
 */
triggersRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const type = c.req.query('type') as TriggerType | undefined;
  const enabled = c.req.query('enabled');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const repo = getRepo(userId);
  const triggers = await repo.list({
    type,
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    limit,
  });

  const response: ApiResponse = {
    success: true,
    data: {
      triggers,
      total: triggers.length,
    },
  };

  return c.json(response);
});

/**
 * POST /triggers - Create a new trigger
 */
triggersRoutes.post('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateTriggerInput>();

  if (!body.name || !body.type || !body.config || !body.action) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'name, type, config, and action are required',
        },
      },
      400
    );
  }

  const repo = getRepo(userId);
  const trigger = await repo.create(body);

  const response: ApiResponse = {
    success: true,
    data: {
      trigger,
      message: 'Trigger created successfully.',
    },
  };

  return c.json(response, 201);
});

/**
 * GET /triggers/stats - Get trigger statistics
 */
triggersRoutes.get('/stats', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getRepo(userId);
  const stats = await repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /triggers/history - Get recent trigger history
 */
triggersRoutes.get('/history', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const repo = getRepo(userId);
  const history = await repo.getRecentHistory(limit);

  const response: ApiResponse = {
    success: true,
    data: {
      history,
      count: history.length,
    },
  };

  return c.json(response);
});

/**
 * GET /triggers/due - Get triggers that are due to fire
 */
triggersRoutes.get('/due', async (c) => {
  const userId = c.req.query('userId') ?? 'default';

  const repo = getRepo(userId);
  const triggers = await repo.getDueTriggers();

  const response: ApiResponse = {
    success: true,
    data: {
      triggers,
      count: triggers.length,
    },
  };

  return c.json(response);
});

/**
 * GET /triggers/:id - Get a specific trigger
 */
triggersRoutes.get('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const trigger = await repo.get(id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  // Get recent history for this trigger
  const history = await repo.getHistoryForTrigger(id, 10);

  const response: ApiResponse = {
    success: true,
    data: {
      ...trigger,
      recentHistory: history,
    },
  };

  return c.json(response);
});

/**
 * PATCH /triggers/:id - Update a trigger
 */
triggersRoutes.patch('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<UpdateTriggerInput>();

  const repo = getRepo(userId);
  const updated = await repo.update(id, body);

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: updated,
  };

  return c.json(response);
});

/**
 * POST /triggers/:id/enable - Enable a trigger
 */
triggersRoutes.post('/:id/enable', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const updated = await repo.update(id, { enabled: true });

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      trigger: updated,
      message: 'Trigger enabled.',
    },
  };

  return c.json(response);
});

/**
 * POST /triggers/:id/disable - Disable a trigger
 */
triggersRoutes.post('/:id/disable', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const updated = await repo.update(id, { enabled: false });

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      trigger: updated,
      message: 'Trigger disabled.',
    },
  };

  return c.json(response);
});

/**
 * POST /triggers/:id/fire - Manually fire a trigger
 */
triggersRoutes.post('/:id/fire', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const trigger = await repo.get(id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  // Fire the trigger using the engine
  const engine = getTriggerEngine({ userId });
  const result = await engine.fireTrigger(id);

  const response: ApiResponse = {
    success: result.success,
    data: {
      result,
      message: result.success ? 'Trigger fired successfully.' : 'Trigger execution failed.',
    },
    error: result.error
      ? {
          code: 'EXECUTION_ERROR',
          message: result.error,
        }
      : undefined,
  };

  return c.json(response, result.success ? 200 : 500);
});

/**
 * DELETE /triggers/:id - Delete a trigger
 */
triggersRoutes.delete('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getRepo(userId);
  const deleted = await repo.delete(id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Trigger deleted successfully.',
    },
  };

  return c.json(response);
});

/**
 * GET /triggers/:id/history - Get history for a specific trigger
 */
triggersRoutes.get('/:id/history', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const repo = getRepo(userId);
  const trigger = await repo.get(id);

  if (!trigger) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Trigger not found: ${id}`,
        },
      },
      404
    );
  }

  const history = await repo.getHistoryForTrigger(id, limit);

  const response: ApiResponse = {
    success: true,
    data: {
      triggerId: id,
      triggerName: trigger.name,
      history,
      count: history.length,
    },
  };

  return c.json(response);
});

/**
 * POST /triggers/cleanup - Clean up old history
 */
triggersRoutes.post('/cleanup', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<{ maxAgeDays?: number }>().catch((): { maxAgeDays?: number } => ({}));

  const repo = getRepo(userId);
  const deleted = await repo.cleanupHistory(body.maxAgeDays ?? 30);

  const response: ApiResponse = {
    success: true,
    data: {
      deletedCount: deleted,
      message: `Cleaned up ${deleted} old history entries.`,
    },
  };

  return c.json(response);
});

// ============================================================================
// Engine Control Routes
// ============================================================================

/**
 * GET /triggers/engine/status - Get engine status
 */
triggersRoutes.get('/engine/status', (c) => {
  const engine = getTriggerEngine();

  const response: ApiResponse = {
    success: true,
    data: {
      running: engine.isRunning(),
    },
  };

  return c.json(response);
});

/**
 * POST /triggers/engine/start - Start the trigger engine
 */
triggersRoutes.post('/engine/start', (c) => {
  const engine = getTriggerEngine();
  engine.start();

  const response: ApiResponse = {
    success: true,
    data: {
      running: engine.isRunning(),
      message: 'Trigger engine started.',
    },
  };

  return c.json(response);
});

/**
 * POST /triggers/engine/stop - Stop the trigger engine
 */
triggersRoutes.post('/engine/stop', (c) => {
  const engine = getTriggerEngine();
  engine.stop();

  const response: ApiResponse = {
    success: true,
    data: {
      running: engine.isRunning(),
      message: 'Trigger engine stopped.',
    },
  };

  return c.json(response);
});

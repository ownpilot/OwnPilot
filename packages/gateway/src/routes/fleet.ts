/**
 * Fleet Routes
 *
 * REST API for managing fleets — coordinated background agent armies.
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:id/tasks, /:id/start, etc.)
 * 3. Generic dynamic route (/:id) - MUST be last
 */

import { Hono } from 'hono';
import type { FleetScheduleType } from '@ownpilot/core';
import { getFleetService } from '../services/fleet-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';

export const fleetRoutes = new Hono();

// =============================================================================
// 1. STATIC ROUTES
// =============================================================================

// GET / - List all fleets
fleetRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getFleetService();

    const configs = await service.listFleets(userId);
    const result = await Promise.all(
      configs.map(async (config) => {
        const session = await service.getSession(config.id);
        return {
          ...config,
          session: session
            ? {
                state: session.state,
                cyclesCompleted: session.cyclesCompleted,
                tasksCompleted: session.tasksCompleted,
                tasksFailed: session.tasksFailed,
                totalCostUsd: session.totalCostUsd,
                activeWorkers: session.activeWorkers,
                startedAt: session.startedAt,
                stoppedAt: session.stoppedAt,
              }
            : null,
        };
      })
    );

    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST / - Create a new fleet
fleetRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    const {
      name,
      mission,
      description,
      workers,
      schedule_type,
      schedule_config,
      budget,
      concurrency_limit,
      auto_start,
      provider,
      model,
      shared_context,
    } = body as Record<string, unknown>;

    if (!name || typeof name !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' }, 400);
    }
    if (!mission || typeof mission !== 'string') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'mission is required' },
        400
      );
    }
    if (!Array.isArray(workers) || workers.length === 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'workers array is required' },
        400
      );
    }

    const validSchedules = ['continuous', 'interval', 'cron', 'event', 'on-demand'];
    if (schedule_type && !validSchedules.includes(schedule_type as string)) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `schedule_type must be one of: ${validSchedules.join(', ')}`,
        },
        400
      );
    }

    const service = getFleetService();

    const config = await service.createFleet({
      userId,
      name,
      mission,
      description: description as string | undefined,
      workers: workers as Array<{
        name: string;
        type: 'ai-chat' | 'coding-cli' | 'api-call' | 'mcp-bridge';
        [key: string]: unknown;
      }>,
      scheduleType: schedule_type as FleetScheduleType | undefined,
      scheduleConfig: schedule_config as Record<string, unknown> | undefined,
      budget: budget as Record<string, unknown> | undefined,
      concurrencyLimit: concurrency_limit as number | undefined,
      autoStart: (auto_start as boolean) ?? false,
      provider: provider as string | undefined,
      model: model as string | undefined,
      sharedContext: shared_context as Record<string, unknown> | undefined,
    });

    wsGateway.broadcast('data:changed', { entity: 'fleet', action: 'created', id: config.id });
    return apiResponse(c, config, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 2. SPECIFIC SUB-ROUTES (must come BEFORE /:id)
// =============================================================================

// GET /:id/tasks - List tasks
fleetRoutes.get('/:id/tasks', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const status = c.req.query('status');
    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    const tasks = await service.listTasks(fleetId, status);
    return apiResponse(c, tasks);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/tasks - Add tasks
fleetRoutes.post('/:id/tasks', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const body = await c.req.json();

    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    // Support both single task and array
    const tasks = Array.isArray(body) ? body : body.tasks ? body.tasks : [body];

    const created = await service.addTasks(
      fleetId,
      userId,
      tasks.map(
        (t: Record<string, unknown>) => ({
          title: t.title as string,
          description: (t.description as string) ?? '',
          assignedWorker: t.assigned_worker as string | undefined,
          priority: t.priority as 'low' | 'normal' | 'high' | 'critical' | undefined,
          input: t.input as Record<string, unknown> | undefined,
          dependsOn: t.depends_on as string[] | undefined,
          maxRetries: t.max_retries as number | undefined,
        })
      )
    );

    return apiResponse(c, created, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/history - Worker execution history
fleetRoutes.get('/:id/history', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const { limit, offset } = getPaginationParams(c);
    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    const { entries, total } = await service.getWorkerHistory(fleetId, limit, offset);

    return apiResponse(c, { entries, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/session - Current session
fleetRoutes.get('/:id/session', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    const session = await service.getSession(fleetId);
    if (!session) {
      return apiResponse(c, null);
    }

    return apiResponse(c, session);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/start - Start fleet
fleetRoutes.post('/:id/start', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const session = await service.startFleet(fleetId, userId);
    return apiResponse(c, {
      state: session.state,
      startedAt: session.startedAt,
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    if (msg.includes('already running')) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: msg }, 409);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

// POST /:id/pause - Pause fleet
fleetRoutes.post('/:id/pause', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const paused = await service.pauseFleet(fleetId, userId);
    if (!paused) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Fleet is not running' },
        400
      );
    }
    return apiResponse(c, { state: 'paused' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/resume - Resume fleet
fleetRoutes.post('/:id/resume', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const resumed = await service.resumeFleet(fleetId, userId);
    if (!resumed) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Fleet is not paused' },
        400
      );
    }
    return apiResponse(c, { state: 'running' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/stop - Stop fleet
fleetRoutes.post('/:id/stop', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const stopped = await service.stopFleet(fleetId, userId);
    if (!stopped) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Fleet is not running' },
        400
      );
    }
    return apiResponse(c, { state: 'stopped' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/broadcast - Broadcast message
fleetRoutes.post('/:id/broadcast', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const body = await c.req.json();

    const { message } = body as { message?: string };
    if (!message || typeof message !== 'string') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'message is required' },
        400
      );
    }

    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    await service.broadcastToFleet(fleetId, message);
    return apiResponse(c, { sent: true });
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not running')) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: msg }, 400);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

// =============================================================================
// 3. GENERIC DYNAMIC ROUTES (/:id) - MUST be last
// =============================================================================

// GET /:id - Get fleet details
fleetRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    const session = await service.getSession(fleetId);

    return apiResponse(c, {
      ...config,
      session: session
        ? {
            state: session.state,
            cyclesCompleted: session.cyclesCompleted,
            tasksCompleted: session.tasksCompleted,
            tasksFailed: session.tasksFailed,
            totalCostUsd: session.totalCostUsd,
            activeWorkers: session.activeWorkers,
            startedAt: session.startedAt,
            stoppedAt: session.stoppedAt,
          }
        : null,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /:id - Update fleet
fleetRoutes.put('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const body = (await c.req.json()) as Record<string, unknown>;

    const service = getFleetService();

    const updated = await service.updateFleet(fleetId, userId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      mission: typeof body.mission === 'string' ? body.mission : undefined,
      scheduleType: body.schedule_type as FleetScheduleType | undefined,
      scheduleConfig: body.schedule_config as Record<string, unknown> | undefined,
      workers: Array.isArray(body.workers) ? body.workers : undefined,
      budget: body.budget as Record<string, unknown> | undefined,
      concurrencyLimit:
        typeof body.concurrency_limit === 'number' ? body.concurrency_limit : undefined,
      autoStart: typeof body.auto_start === 'boolean' ? body.auto_start : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      sharedContext: body.shared_context as Record<string, unknown> | undefined,
    });

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    wsGateway.broadcast('data:changed', { entity: 'fleet', action: 'updated', id: fleetId });
    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:id - Delete fleet
fleetRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const deleted = await service.deleteFleet(fleetId, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    wsGateway.broadcast('data:changed', { entity: 'fleet', action: 'deleted', id: fleetId });
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

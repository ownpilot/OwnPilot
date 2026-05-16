/**
 * Fleet Routes
 *
 * REST API for managing fleets — coordinated agent armies.
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
import {
  validateBody,
  createFleetSchema,
  updateFleetSchema,
  addFleetTasksSchema,
  broadcastToFleetSchema,
} from '../middleware/validation.js';
import { wsGateway } from '../ws/server.js';

/**
 * Parse + validate a JSON body, returning either the typed value or a
 * Hono error response.
 */
async function parseBody<T>(
  c: import('hono').Context,
  schema: import('zod').z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      res: apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400),
    };
  }
  try {
    return { ok: true, data: validateBody(schema, raw) };
  } catch (e) {
    return {
      ok: false,
      res: apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(e) }, 400),
    };
  }
}

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
  const parsed = await parseBody(c, createFleetSchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  try {
    const userId = getUserId(c);
    const service = getFleetService();

    // Map snake_case worker fields from API to camelCase for internal types
    const mappedWorkers = body.workers.map((w) => ({
      name: w.name,
      type: w.type,
      description: w.description,
      provider: w.provider,
      model: w.model,
      systemPrompt: w.system_prompt ?? w.systemPrompt,
      allowedTools: w.allowed_tools ?? w.allowedTools,
      skills: w.skills,
      cliProvider: w.cli_provider ?? w.cliProvider,
      cwd: w.cwd,
      mcpServer: w.mcp_server ?? w.mcpServer,
      mcpTools: w.mcp_tools ?? w.mcpTools,
      maxTurns: w.max_turns ?? w.maxTurns,
      maxTokens: w.max_tokens ?? w.maxTokens,
      timeoutMs: w.timeout_ms ?? w.timeoutMs,
    }));

    const config = await service.createFleet({
      userId,
      name: body.name,
      mission: body.mission,
      description: body.description,
      workers: mappedWorkers,
      scheduleType: body.schedule_type as FleetScheduleType | undefined,
      scheduleConfig: body.schedule_config,
      budget: body.budget,
      concurrencyLimit: body.concurrency_limit,
      autoStart: body.auto_start ?? false,
      provider: body.provider,
      model: body.model,
      sharedContext: body.shared_context,
    });

    wsGateway.broadcast('data:changed', { entity: 'fleet', action: 'created', id: config.id });
    return apiResponse(c, config, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /stats — Aggregate fleet statistics
// =============================================================================

fleetRoutes.get('/stats', async (c) => {
  try {
    const userId = getUserId(c);
    const repo = (await import('../db/repositories/fleet.js')).getFleetRepository();

    const sessions = await repo.listSessions(userId);
    const dbStats = await repo.getStats(userId);

    const running = sessions.filter((s) => s.state === 'running').length;
    const activeWorkers = sessions.reduce((sum, s) => sum + s.activeWorkers, 0);
    void activeWorkers; // used in response below

    return apiResponse(c, {
      totalFleets: dbStats.totalFleets,
      running,
      totalWorkers: activeWorkers,
      successRate: dbStats.successRate,
      avgCost: dbStats.avgCost,
      avgDuration: dbStats.avgDuration,
      totalCost: dbStats.totalCost,
      errorRate: dbStats.errorRate,
      byState: dbStats.byState,
      totalTokens: dbStats.totalTokens,
      tasksCompleted: dbStats.tasksCompleted,
      tasksFailed: dbStats.tasksFailed,
      activeWorkers,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /health — Fleet health indicators
// =============================================================================

fleetRoutes.get('/health', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getFleetService();
    const repo = (await import('../db/repositories/fleet.js')).getFleetRepository();

    const configs = await service.listFleets(userId);
    const sessions = await repo.listSessions(userId);

    const signals: string[] = [];
    const recommendations: string[] = [];

    const running = sessions.filter((s) => s.state === 'running');
    const withErrors = running.filter((s) => s.cyclesCompleted > 0 && s.totalCostUsd > 0);
    const noWorkers = running.filter((s) => s.activeWorkers === 0);
    const overBudget = configs.filter((cfg) => {
      if (!cfg.budget?.maxCostUsd) return false;
      const session = sessions.find((s) => s.fleetId === cfg.id);
      return session && session.totalCostUsd >= cfg.budget.maxCostUsd;
    });

    let score = 80;
    let status: 'healthy' | 'watch' | 'stuck' | 'failed' | 'expensive' = 'healthy';

    if (overBudget.length > 0) {
      signals.push(`${overBudget.length} fleets at budget cap`);
      recommendations.push('Raise budgets or stop expensive fleets');
      score = Math.min(score, 25);
      status = 'expensive';
    }
    if (noWorkers.length > 0) {
      signals.push(`${noWorkers.length} fleets running without workers`);
      recommendations.push('Check worker availability and concurrency limits');
      score = Math.min(score, 40);
      status = 'stuck';
    }
    if (withErrors.length > 0) {
      signals.push(`${withErrors.length} fleets with errors`);
      recommendations.push('Inspect fleet cycle errors');
      score = Math.min(score, 50);
      status = 'watch';
    }
    if (running.length === 0 && sessions.length > 0) {
      signals.push('all fleets idle');
      score = 65;
      status = 'watch';
    }

    return apiResponse(c, {
      status,
      score,
      signals,
      recommendations,
      activeFleets: running.length,
      totalFleets: sessions.length,
      tasksInQueue: 0, // task queue count not currently tracked at fleet level
    });
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
  const parsed = await parseBody(c, addFleetTasksSchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');

    const service = getFleetService();

    const config = await service.getFleet(fleetId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Fleet not found' }, 404);
    }

    // Normalise the union (single | array | { tasks: [...] }) into an array
    const tasks = Array.isArray(body) ? body : 'tasks' in body ? body.tasks : [body];

    const created = await service.addTasks(
      fleetId,
      userId,
      tasks.map((t) => ({
        title: t.title,
        description: t.description ?? '',
        assignedWorker: t.assigned_worker,
        priority: t.priority,
        input: t.input,
        dependsOn: t.depends_on,
        maxRetries: t.max_retries,
      }))
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
  const parsed = await parseBody(c, broadcastToFleetSchema);
  if (!parsed.ok) return parsed.res;
  const { message } = parsed.data;
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
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
  const parsed = await parseBody(c, updateFleetSchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  try {
    const userId = getUserId(c);
    const fleetId = c.req.param('id');
    const service = getFleetService();

    const mappedWorkers = body.workers?.map((w) => ({
      name: w.name,
      type: w.type,
      description: w.description,
      provider: w.provider,
      model: w.model,
      systemPrompt: w.system_prompt ?? w.systemPrompt,
      allowedTools: w.allowed_tools ?? w.allowedTools,
      skills: w.skills,
      cliProvider: w.cli_provider ?? w.cliProvider,
      cwd: w.cwd,
      mcpServer: w.mcp_server ?? w.mcpServer,
      mcpTools: w.mcp_tools ?? w.mcpTools,
      maxTurns: w.max_turns ?? w.maxTurns,
      maxTokens: w.max_tokens ?? w.maxTokens,
      timeoutMs: w.timeout_ms ?? w.timeoutMs,
    }));

    const updated = await service.updateFleet(fleetId, userId, {
      name: body.name,
      description: body.description,
      mission: body.mission,
      scheduleType: body.schedule_type as FleetScheduleType | undefined,
      scheduleConfig: body.schedule_config,
      workers: mappedWorkers,
      budget: body.budget,
      concurrencyLimit: body.concurrency_limit,
      autoStart: body.auto_start,
      provider: body.provider,
      model: body.model,
      sharedContext: body.shared_context,
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

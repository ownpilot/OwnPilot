/**
 * Claws Routes
 *
 * REST API for managing Claw agents (unified autonomous runtime).
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:id/start, /:id/history, etc.)
 * 3. Generic dynamic route (/:id) - MUST be last
 */

import { Hono } from 'hono';
import type { ClawMode } from '@ownpilot/core';
import { getClawService } from '../services/claw-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';

export const clawRoutes = new Hono();

// =============================================================================
// 1. STATIC ROUTES
// =============================================================================

// GET / - List all claws
clawRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getClawService();

    const configs = await service.listClaws(userId);
    const sessions = service.listSessions(userId);

    const claws = configs.map((config) => {
      const session = sessions.find((s) => s.config.id === config.id);
      return {
        ...config,
        session: session
          ? {
              state: session.state,
              cyclesCompleted: session.cyclesCompleted,
              totalToolCalls: session.totalToolCalls,
              totalCostUsd: session.totalCostUsd,
              lastCycleAt: session.lastCycleAt,
              lastCycleDurationMs: session.lastCycleDurationMs,
              lastCycleError: session.lastCycleError,
              startedAt: session.startedAt,
              stoppedAt: session.stoppedAt,
              artifacts: session.artifacts,
              pendingEscalation: session.pendingEscalation,
            }
          : null,
      };
    });

    return apiResponse(c, claws);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST / - Create a new claw
clawRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    const { name, mission, mode, allowed_tools, limits, interval_ms, event_filters, auto_start,
      stop_condition, provider, model, soul_id, sandbox, coding_agent_provider, skills } =
      body as Record<string, unknown>;

    if (!name || typeof name !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' }, 400);
    }
    if (!mission || typeof mission !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'mission is required' }, 400);
    }

    const validModes = ['continuous', 'interval', 'event', 'single-shot'];
    if (mode && !validModes.includes(mode as string)) {
      return apiError(c, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `mode must be one of: ${validModes.join(', ')}`,
      }, 400);
    }

    const service = getClawService();

    const config = await service.createClaw({
      userId,
      name: name as string,
      mission: mission as string,
      mode: (mode as ClawMode) ?? 'continuous',
      allowedTools: (allowed_tools as string[]) ?? undefined,
      limits: limits as Record<string, number> | undefined,
      intervalMs: interval_ms as number | undefined,
      eventFilters: event_filters as string[] | undefined,
      autoStart: (auto_start as boolean) ?? false,
      stopCondition: stop_condition as string | undefined,
      provider: provider as string | undefined,
      model: model as string | undefined,
      soulId: soul_id as string | undefined,
      sandbox: sandbox as 'docker' | 'local' | 'auto' | undefined,
      codingAgentProvider: coding_agent_provider as string | undefined,
      skills: skills as string[] | undefined,
    });

    return apiResponse(c, config, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 2. SUB-ROUTES (before /:id)
// =============================================================================

// POST /:id/start
clawRoutes.post('/:id/start', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const session = await service.startClaw(id, userId);
    return apiResponse(c, { state: session.state, startedAt: session.startedAt });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/pause
clawRoutes.post('/:id/pause', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const paused = await service.pauseClaw(id, userId);
    if (!paused) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not running or not found' }, 404);
    }
    return apiResponse(c, { paused: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/resume
clawRoutes.post('/:id/resume', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const resumed = await service.resumeClaw(id, userId);
    if (!resumed) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not paused or not found' }, 404);
    }
    return apiResponse(c, { resumed: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/stop
clawRoutes.post('/:id/stop', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const stopped = await service.stopClaw(id, userId);
    if (!stopped) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not running or not found' }, 404);
    }
    return apiResponse(c, { stopped: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/execute
clawRoutes.post('/:id/execute', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const result = await service.executeNow(id, userId);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/message
clawRoutes.post('/:id/message', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!body.message || typeof body.message !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'message is required' }, 400);
    }

    const service = getClawService();
    await service.sendMessage(id, userId, body.message);
    return apiResponse(c, { sent: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/history
clawRoutes.get('/:id/history', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const { limit, offset } = getPaginationParams(c);
    const service = getClawService();

    const { entries, total } = await service.getHistory(id, userId, limit, offset);
    return apiResponse(c, { entries, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/audit — Get audit log (per-tool-call tracking)
clawRoutes.get('/:id/audit', async (c) => {
  try {
    const { id } = c.req.param();
    const { limit, offset } = getPaginationParams(c);
    const category = c.req.query('category');

    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    const result = await repo.getAuditLog(id, limit, offset, category || undefined);

    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/approve-escalation
clawRoutes.post('/:id/approve-escalation', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const approved = await service.approveEscalation(id, userId);
    if (!approved) {
      return apiError(c, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'No pending escalation or claw not found',
      }, 404);
    }
    return apiResponse(c, { approved: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 3. GENERIC DYNAMIC ROUTE (must be last)
// =============================================================================

// GET /:id
clawRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const config = await service.getClaw(id, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    const session = service.getSession(id, userId);

    return apiResponse(c, {
      ...config,
      session: session
        ? {
            state: session.state,
            cyclesCompleted: session.cyclesCompleted,
            totalToolCalls: session.totalToolCalls,
            totalCostUsd: session.totalCostUsd,
            lastCycleAt: session.lastCycleAt,
            lastCycleDurationMs: session.lastCycleDurationMs,
            lastCycleError: session.lastCycleError,
            startedAt: session.startedAt,
            stoppedAt: session.stoppedAt,
            artifacts: session.artifacts,
            pendingEscalation: session.pendingEscalation,
          }
        : null,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /:id
clawRoutes.put('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const body = await c.req.json();
    const service = getClawService();

    const updated = await service.updateClaw(id, userId, body);
    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }
    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:id
clawRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const deleted = await service.deleteClaw(id, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

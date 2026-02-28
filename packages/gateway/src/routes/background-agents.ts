/**
 * Background Agents Routes
 *
 * REST API for managing persistent background agents.
 */

import { Hono } from 'hono';
import type { BackgroundAgentMode } from '@ownpilot/core';
import { getBackgroundAgentService } from '../services/background-agent-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';

export const backgroundAgentsRoutes = new Hono();

// =============================================================================
// GET / - List all background agents
// =============================================================================

backgroundAgentsRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getBackgroundAgentService();

    const configs = await service.listAgents(userId);
    const sessions = service.listSessions(userId);

    const agents = configs.map((config) => {
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
            }
          : null,
      };
    });

    return apiResponse(c, agents);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST / - Create a new background agent
// =============================================================================

backgroundAgentsRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    const { name, mission, mode, allowed_tools, limits, interval_ms, event_filters, auto_start, stop_condition } =
      body as Record<string, unknown>;

    if (!name || typeof name !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' }, 400);
    }
    if (!mission || typeof mission !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'mission is required' }, 400);
    }

    const validModes = ['continuous', 'interval', 'event'];
    if (mode && !validModes.includes(mode as string)) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: `mode must be one of: ${validModes.join(', ')}` },
        400
      );
    }

    const service = getBackgroundAgentService();

    const config = await service.createAgent({
      userId,
      name,
      mission,
      mode: (mode as BackgroundAgentMode) ?? 'interval',
      allowedTools: (allowed_tools as string[]) ?? undefined,
      limits: limits as Record<string, number> | undefined,
      intervalMs: interval_ms as number | undefined,
      eventFilters: event_filters as string[] | undefined,
      autoStart: (auto_start as boolean) ?? false,
      stopCondition: stop_condition as string | undefined,
      createdBy: 'user',
    });

    return apiResponse(c, config, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id - Get agent details + session
// =============================================================================

backgroundAgentsRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const config = await service.getAgent(agentId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    const session = service.getSession(agentId, userId);

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
            persistentContext: session.persistentContext,
            inbox: session.inbox,
          }
        : null,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// PATCH /:id - Update agent config
// =============================================================================

backgroundAgentsRoutes.patch('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const body = await c.req.json();

    const service = getBackgroundAgentService();

    const updated = await service.updateAgent(agentId, userId, {
      name: body.name,
      mission: body.mission,
      mode: body.mode,
      allowedTools: body.allowed_tools,
      limits: body.limits,
      intervalMs: body.interval_ms,
      eventFilters: body.event_filters,
      autoStart: body.auto_start,
      stopCondition: body.stop_condition,
    });

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Delete agent
// =============================================================================

backgroundAgentsRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const deleted = await service.deleteAgent(agentId, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/start - Start agent
// =============================================================================

backgroundAgentsRoutes.post('/:id/start', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const session = await service.startAgent(agentId, userId);
    return apiResponse(c, {
      state: session.state,
      cyclesCompleted: session.cyclesCompleted,
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

// =============================================================================
// POST /:id/pause - Pause agent
// =============================================================================

backgroundAgentsRoutes.post('/:id/pause', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const paused = await service.pauseAgent(agentId, userId);
    if (!paused) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not running' }, 400);
    }

    return apiResponse(c, { state: 'paused' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/resume - Resume agent
// =============================================================================

backgroundAgentsRoutes.post('/:id/resume', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const resumed = await service.resumeAgent(agentId, userId);
    if (!resumed) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not paused' }, 400);
    }

    return apiResponse(c, { state: 'running' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/stop - Stop agent
// =============================================================================

backgroundAgentsRoutes.post('/:id/stop', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const stopped = await service.stopAgent(agentId, userId);
    if (!stopped) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not running' }, 400);
    }

    return apiResponse(c, { state: 'stopped' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id/history - Get cycle history
// =============================================================================

backgroundAgentsRoutes.get('/:id/history', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const { limit, offset } = getPaginationParams(c);
    const service = getBackgroundAgentService();

    // Verify agent exists and belongs to user
    const config = await service.getAgent(agentId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    const { entries, total } = await service.getHistory(agentId, userId, limit, offset);

    return apiResponse(c, {
      entries,
      total,
      limit,
      offset,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/message - Send message to agent inbox
// =============================================================================

backgroundAgentsRoutes.post('/:id/message', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const body = await c.req.json();

    const { message } = body as { message?: string };
    if (!message || typeof message !== 'string') {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'message is required' }, 400);
    }

    const service = getBackgroundAgentService();

    // Verify agent exists
    const config = await service.getAgent(agentId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    await service.sendMessage(agentId, userId, message);

    return apiResponse(c, { sent: true });
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not running')) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: msg }, 400);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

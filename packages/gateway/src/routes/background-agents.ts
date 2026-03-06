/**
 * Background Agents Routes
 *
 * REST API for managing persistent background agents.
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:id/history, /:id/message, /:id/start, etc.)
 * 3. Generic dynamic route (/:id) - MUST be last
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
// 1. STATIC ROUTES (no params)
// =============================================================================

// GET / - List all background agents
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

// POST / - Create a new background agent
backgroundAgentsRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    const {
      name,
      mission,
      mode,
      allowed_tools,
      limits,
      interval_ms,
      event_filters,
      auto_start,
      stop_condition,
      provider,
      model,
      skills,
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

    const validModes = ['continuous', 'interval', 'event'];
    if (mode && !validModes.includes(mode as string)) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `mode must be one of: ${validModes.join(', ')}`,
        },
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
      provider: provider as string | undefined,
      model: model as string | undefined,
      skills: (skills as string[]) ?? undefined,
      createdBy: 'user',
    });

    return apiResponse(c, config, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 2. SPECIFIC SUB-ROUTES (must come BEFORE /:id)
// =============================================================================

// GET /:id/history - Get cycle history
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

// POST /:id/message - Send message to agent inbox
backgroundAgentsRoutes.post('/:id/message', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const body = await c.req.json();

    const { message } = body as { message?: string };
    if (!message || typeof message !== 'string') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'message is required' },
        400
      );
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

// POST /:id/start - Start agent
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

// POST /:id/pause - Pause agent
backgroundAgentsRoutes.post('/:id/pause', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const paused = await service.pauseAgent(agentId, userId);
    if (!paused) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not running' },
        400
      );
    }

    return apiResponse(c, { state: 'paused' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/resume - Resume agent
backgroundAgentsRoutes.post('/:id/resume', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const resumed = await service.resumeAgent(agentId, userId);
    if (!resumed) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not paused' },
        400
      );
    }

    return apiResponse(c, { state: 'running' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/stop - Stop agent
backgroundAgentsRoutes.post('/:id/stop', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    const stopped = await service.stopAgent(agentId, userId);
    if (!stopped) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not running' },
        400
      );
    }

    return apiResponse(c, { state: 'stopped' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 3. GENERIC DYNAMIC ROUTE (/:id) - MUST be after specific sub-routes
// =============================================================================

// GET /:id - Get agent details + session
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

// PATCH /:id - Update agent config
backgroundAgentsRoutes.patch('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const body = (await c.req.json()) as Record<string, unknown>;

    const validModes = ['continuous', 'interval', 'event'];
    if (body.mode !== undefined && !validModes.includes(body.mode as string)) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `mode must be one of: ${validModes.join(', ')}`,
        },
        400
      );
    }

    // Validate limits upper bounds to prevent abuse
    let validatedLimits: Record<string, number> | undefined;
    if (typeof body.limits === 'object' && body.limits !== null) {
      const rawLimits = body.limits as Record<string, unknown>;
      const LIMITS_MAX: Record<string, number> = {
        maxTurns: 500,
        maxToolCalls: 5000,
        timeoutMs: 3_600_000, // 1 hour
        maxTokens: 200_000,
      };
      for (const [key, val] of Object.entries(rawLimits)) {
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `limits.${key} must be a positive finite number`,
            },
            400
          );
        }
        const cap = LIMITS_MAX[key];
        if (cap !== undefined && val > cap) {
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `limits.${key} exceeds maximum allowed value (${cap})`,
            },
            400
          );
        }
      }
      validatedLimits = rawLimits as Record<string, number>;
    }

    const service = getBackgroundAgentService();

    const updated = await service.updateAgent(agentId, userId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      mission: typeof body.mission === 'string' ? body.mission : undefined,
      mode: body.mode as BackgroundAgentMode | undefined,
      allowedTools: Array.isArray(body.allowed_tools)
        ? (body.allowed_tools as string[])
        : undefined,
      limits: validatedLimits,
      intervalMs: typeof body.interval_ms === 'number' ? body.interval_ms : undefined,
      eventFilters: Array.isArray(body.event_filters)
        ? (body.event_filters as string[])
        : undefined,
      autoStart: typeof body.auto_start === 'boolean' ? body.auto_start : undefined,
      stopCondition: typeof body.stop_condition === 'string' ? body.stop_condition : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
    });

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:id - Delete agent
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

// ── GET /:id/logs — stream agent execution logs (NEW) ──────────────────────
backgroundAgentsRoutes.get('/:id/logs', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    // Verify agent exists
    const config = await service.getAgent(agentId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    const session = service.getSession(agentId, userId);

    // Get history from repository
    const { entries } = await service.getHistory(agentId, userId, 20, 0);

    return apiResponse(c, {
      agentId,
      logs: entries.map((e) => ({
        timestamp: e.executedAt.toISOString(),
        success: e.success,
        durationMs: e.durationMs,
        toolCalls: e.toolCalls.length,
        error: e.error,
      })),
      state: session?.state ?? 'stopped',
      cyclesCompleted: session?.cyclesCompleted ?? 0,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/execute — trigger immediate execution (NEW) ───────────────────
backgroundAgentsRoutes.post('/:id/execute', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const service = getBackgroundAgentService();

    // Verify agent exists
    const config = await service.getAgent(agentId, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    const body = await c.req.json<{ task?: string }>();

    // Trigger immediate execution cycle
    const executed = await service.executeNow(agentId, userId, body.task);
    if (!executed) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is not running' },
        400
      );
    }

    return apiResponse(c, {
      executed: true,
      agentId,
      task: body.task ?? 'default cycle',
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

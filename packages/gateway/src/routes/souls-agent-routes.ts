/**
 * Soul Agent Sub-Routes
 *
 * All /:agentId/* endpoints for agent operations:
 * logs, memories, goals, tasks, mission, test, tools, command, stats, versions, feedback.
 *
 * IMPORTANT: These routes must be mounted BEFORE the generic /:agentId catch-all.
 */

import { Hono } from 'hono';
import type { SoulFeedback } from '@ownpilot/core';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { runAgentHeartbeat } from '../services/soul-heartbeat-service.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import {
  validateBody,
  soulGoalSchema,
  soulMissionSchema,
  soulToolsSchema,
  soulCommandSchema,
  soulFeedbackSchema,
} from '../middleware/validation.js';

export const soulAgentRoutes = new Hono();

// Reserved keywords that cannot be agent IDs
const RESERVED_KEYWORDS = [
  'test',
  'tools',
  'stats',
  'command',
  'deploy',
  'logs',
  'memories',
  'goals',
  'tasks',
];

// ── GET /:agentId/logs — get agent execution logs ─────────────────────────

soulAgentRoutes.get('/:agentId/logs', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const logs = await hbRepo.listByAgent(agentId, limit, offset);
    const stats = await hbRepo.getStats(agentId);

    return apiResponse(c, {
      agentId,
      logs: logs.map((log) => ({
        id: log.id,
        timestamp: log.createdAt,
        durationMs: log.durationMs,
        cost: log.cost,
        tasksRun: log.tasksRun.length,
        tasksFailed: log.tasksFailed.length,
      })),
      stats: {
        totalCycles: stats?.totalCycles ?? 0,
        successRate: stats ? 1 - stats.failureRate : 0,
        avgCost: stats?.totalCost ? stats.totalCost / stats.totalCycles : 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/memories — get agent memories ───────────────────────────

soulAgentRoutes.get('/:agentId/memories', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const { getServiceRegistry, Services } = await import('@ownpilot/core');
    const registry = getServiceRegistry();
    const memorySvc = registry.get(Services.Memory);

    const memories = await memorySvc.listMemories(agentId, { limit, offset });

    return apiResponse(c, {
      agentId,
      memories: memories.map(
        (m: { id: string; content: string; source?: string; createdAt?: Date }) => ({
          id: m.id,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt,
        })
      ),
      learnings: soul.evolution.learnings.slice(-20),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/goals — get agent goals ─────────────────────────────────

soulAgentRoutes.get('/:agentId/goals', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const { getServiceRegistry, Services } = await import('@ownpilot/core');
    const registry = getServiceRegistry();
    const goalSvc = registry.get(Services.Goal);

    const goals = await goalSvc.listGoals(agentId);

    return apiResponse(c, {
      agentId,
      mission: soul.purpose.mission,
      goals: soul.purpose.goals,
      systemGoals: goals.map(
        (g: { id: string; title: string; status?: string; progress?: number }) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          progress: g.progress,
        })
      ),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/goals — add a goal to agent ────────────────────────────

soulAgentRoutes.post('/:agentId/goals', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = validateBody(soulGoalSchema, await c.req.json());

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    soul.purpose.goals.push(body.goal);
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(
      c,
      {
        agentId,
        goals: soul.purpose.goals,
      },
      201
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/tasks — get agent current tasks ─────────────────────────

soulAgentRoutes.get('/:agentId/tasks', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const bootTasks = soul.bootSequence?.onHeartbeat ?? [];
    const checklist = soul.heartbeat?.checklist ?? [];

    return apiResponse(c, {
      agentId,
      bootTasks,
      checklist,
      inboxUnread: 0,
      isRunning: soul.heartbeat.enabled,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/mission — assign a high-level mission ──────────────────

soulAgentRoutes.post('/:agentId/mission', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const rawBody = await c.req.json();
    const body = validateBody(soulMissionSchema, rawBody);

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    soul.purpose.mission = body.mission;
    soul.updatedAt = new Date();

    if (rawBody.autoPlan) {
      soul.bootSequence.onHeartbeat = [
        'analyze_mission',
        'gather_context',
        'execute_plan',
        'report_results',
      ];
    }

    await repo.update(soul);

    return apiResponse(c, {
      agentId,
      mission: soul.purpose.mission,
      priority: rawBody.priority ?? 'medium',
      status: 'accepted',
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/test — run agent test (immediate heartbeat) ────────────

soulAgentRoutes.post('/:agentId/test', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    if (!soul.heartbeat.enabled) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is paused. Resume before testing.' },
        400
      );
    }

    const result = await runAgentHeartbeat(agentId, true);

    if (result.success) {
      return apiResponse(c, {
        success: true,
        message: 'Test run complete. Check the Activity tab for results.',
        agentId,
        completedAt: new Date().toISOString(),
      });
    } else {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: result.error ?? 'Test run failed' },
        500
      );
    }
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/tools — get all tools with permission status ────────────

soulAgentRoutes.get('/:agentId/tools', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const toolRegistry = getSharedToolRegistry();

    if (!toolRegistry) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Tool registry not available' },
        500
      );
    }

    const allTools = toolRegistry.getAllTools();
    const allowedTools = new Set(soul.autonomy.allowedActions ?? []);
    const blockedTools = new Set(soul.autonomy.blockedActions ?? []);

    const tools = allTools.map(({ definition }) => {
      const name = definition.name;
      let category = 'core';
      if (name.startsWith('mcp.')) category = 'mcp';
      else if (name.startsWith('custom.')) category = 'custom';
      else if (name.startsWith('ext.')) category = 'custom';
      else if (name.startsWith('skill.')) category = 'custom';
      else if (name.startsWith('plugin.')) category = 'mcp';

      let status: 'allowed' | 'blocked' | 'neutral' = 'neutral';
      if (blockedTools.has(name) || blockedTools.has(name.replace(/^.*?\./, ''))) {
        status = 'blocked';
      } else if (allowedTools.has(name) || allowedTools.has(name.replace(/^.*?\./, ''))) {
        status = 'allowed';
      }

      return {
        name,
        description: definition.description,
        category,
        status,
        provider: (definition as unknown as { providerName?: string }).providerName,
      };
    });

    return apiResponse(c, {
      tools,
      allowed: Array.from(allowedTools),
      blocked: Array.from(blockedTools),
      summary: {
        total: tools.length,
        allowed: tools.filter((t) => t.status === 'allowed').length,
        blocked: tools.filter((t) => t.status === 'blocked').length,
        neutral: tools.filter((t) => t.status === 'neutral').length,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── PUT /:agentId/tools — update tool permissions ─────────────────────────

soulAgentRoutes.put('/:agentId/tools', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = validateBody(soulToolsSchema, await c.req.json());
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    if (body.allowed !== undefined) {
      soul.autonomy.allowedActions = body.allowed;
    }
    if (body.blocked !== undefined) {
      soul.autonomy.blockedActions = body.blocked;
    }
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(c, {
      allowed: soul.autonomy.allowedActions,
      blocked: soul.autonomy.blockedActions,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/command — send direct command to agent ─────────────────

soulAgentRoutes.post('/:agentId/command', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = validateBody(soulCommandSchema, await c.req.json());

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const commandLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      command: body.command,
      params: body.params ?? {},
      status: 'pending' as const,
    };

    let result: unknown;
    switch (body.command) {
      case 'run_heartbeat':
        result = { message: 'Heartbeat triggered', agentId };
        break;
      case 'pause':
        await repo.setHeartbeatEnabled(agentId, false);
        soul.heartbeat.enabled = false;
        result = { message: 'Agent paused', agentId };
        break;
      case 'resume':
        await repo.setHeartbeatEnabled(agentId, true);
        soul.heartbeat.enabled = true;
        result = { message: 'Agent resumed', agentId };
        break;
      case 'reset_budget':
        result = { message: 'Budget counters reset (daily auto-reset)', agentId };
        break;
      default:
        result = { message: `Unknown command: ${body.command}`, agentId };
    }

    return apiResponse(c, {
      command: commandLog,
      result,
      agentId,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/stats — get agent statistics ────────────────────────────

soulAgentRoutes.get('/:agentId/stats', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const stats = await hbRepo.getStats(agentId);
    const recentLogs = await hbRepo.listByAgent(agentId, 10, 0);
    const lastLog = recentLogs[0] ?? null;

    return apiResponse(c, {
      agentId,
      soulVersion: soul.evolution.version,
      heartbeat: {
        enabled: soul.heartbeat.enabled,
        interval: soul.heartbeat.interval,
        lastRunAt: lastLog?.createdAt ?? null,
      },
      stats: {
        totalCycles: stats?.totalCycles ?? 0,
        totalCost: stats?.totalCost ?? 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
        failureRate: stats?.failureRate ?? 0,
      },
      budget: {
        maxCostPerDay: soul.autonomy.maxCostPerDay,
        maxCostPerMonth: soul.autonomy.maxCostPerMonth,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/versions — version history ────────

soulAgentRoutes.get('/:agentId/versions', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    const versions = await repo.getVersions(soul.id, limit, offset);
    return apiResponse(c, versions);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/versions/:v — specific version ────

soulAgentRoutes.get('/:agentId/versions/:v', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const v = parseInt(c.req.param('v'), 10);
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    const version = await repo.getVersion(soul.id, v);
    if (!version) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Version not found' }, 404);
    }
    return apiResponse(c, version);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/feedback — apply feedback ────────

soulAgentRoutes.post('/:agentId/feedback', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const rawBody = await c.req.json();
    const body = validateBody(soulFeedbackSchema, rawBody);

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Create version snapshot
    await repo.createVersion(soul, body.content, rawBody.source || 'user');

    const feedback: SoulFeedback = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: body.type,
      content: body.content,
      appliedToVersion: soul.evolution.version,
      source: (rawBody.source || 'user') as SoulFeedback['source'],
    };

    switch (feedback.type) {
      case 'praise':
        soul.evolution.learnings.push(`Positive: ${feedback.content}`);
        break;
      case 'correction':
        soul.identity.boundaries.push(feedback.content);
        soul.evolution.learnings.push(`Correction: ${feedback.content}`);
        break;
      case 'directive':
        soul.purpose.goals.push(feedback.content);
        break;
      case 'personality_tweak':
        soul.evolution.mutableTraits.push(feedback.content);
        soul.evolution.learnings.push(`Personality: ${feedback.content}`);
        break;
    }

    if (soul.evolution.learnings.length > 50) {
      soul.evolution.learnings = soul.evolution.learnings.slice(-50);
    }
    soul.evolution.feedbackLog.push(feedback);
    if (soul.evolution.feedbackLog.length > 100) {
      soul.evolution.feedbackLog = soul.evolution.feedbackLog.slice(-100);
    }
    soul.evolution.version++;
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(c, soul);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * Agent Command Center — Unified control interface for all agents
 *
 * Provides army-level commands:
 * - Broadcast commands to multiple agents
 * - Monitor all agents at once
 * - Aggregate results from multiple agents
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getUserId,
  getIntParam,
} from '../helpers.js';
import { getSoulsRepository } from '../../db/repositories/souls.js';
import { getCrewsRepository } from '../../db/repositories/crew/index.js';
import { getHeartbeatLogRepository } from '../../db/repositories/heartbeats/log.js';
import { getClawService } from '../../services/claw/service.js';
import {
  validateBody,
  agentCommandSchema,
  agentMissionSchema,
  agentExecuteSchema,
  agentToolsBatchUpdateSchema,
} from '../../middleware/validation.js';

export const agentCommandCenterRoutes = new Hono();

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-AGENT COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /command — broadcast command to multiple agents ──────────────────

agentCommandCenterRoutes.post('/command', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(agentCommandSchema, await c.req.json());

    const results: {
      target: { type: string; id: string };
      success: boolean;
      result?: unknown;
      error?: string;
    }[] = [];

    // Execute command on each target
    for (const target of body.targets) {
      try {
        let result: unknown;

        switch (target.type) {
          case 'soul': {
            const soulRepo = getSoulsRepository();
            const soul = await soulRepo.getByAgentId(target.id);
            if (!soul) {
              results.push({ target, success: false, error: 'Soul not found' });
              continue;
            }

            // Execute command on soul
            switch (body.command) {
              case 'pause':
                await soulRepo.setHeartbeatEnabled(target.id, false);
                result = { status: 'paused' };
                break;
              case 'resume':
                await soulRepo.setHeartbeatEnabled(target.id, true);
                result = { status: 'resumed' };
                break;
              case 'run_once':
                const { runAgentHeartbeat } =
                  await import('../../services/heartbeat/soul-service.js');
                const hbResult = await runAgentHeartbeat(target.id);
                result = {
                  status: hbResult.success ? 'executed' : 'failed',
                  error: hbResult.error,
                };
                break;
              default:
                result = { status: 'unknown_command', command: body.command };
            }
            break;
          }

          case 'crew': {
            const crewRepo = getCrewsRepository();
            const crew = await crewRepo.getById(target.id, userId);
            if (!crew) {
              results.push({ target, success: false, error: 'Crew not found' });
              continue;
            }

            const members = await crewRepo.getMembers(target.id);
            const soulRepo = getSoulsRepository();

            switch (body.command) {
              case 'pause':
                for (const m of members) {
                  await soulRepo.setHeartbeatEnabled(m.agentId, false);
                }
                await crewRepo.updateStatus(target.id, 'paused');
                result = { status: 'paused', affectedAgents: members.length };
                break;
              case 'resume':
                for (const m of members) {
                  await soulRepo.setHeartbeatEnabled(m.agentId, true);
                }
                await crewRepo.updateStatus(target.id, 'active');
                result = { status: 'resumed', affectedAgents: members.length };
                break;
              default:
                result = { status: 'unknown_command', command: body.command };
            }
            break;
          }
        }

        results.push({ target, success: true, result });
      } catch (err) {
        results.push({ target, success: false, error: getErrorMessage(err) });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    return apiResponse(c, {
      command: body.command,
      total: results.length,
      success: successCount,
      failed: failCount,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /overview — Unified view of all agent runners ──────────────────────

agentCommandCenterRoutes.get('/overview', async (c) => {
  try {
    const userId = getUserId(c);
    const hbRepo = getHeartbeatLogRepository();
    const crewRepo = getCrewsRepository();
    const soulRepo = getSoulsRepository();
    const clawService = getClawService();

    const [soulStats, soulHealth, crewStats, crewHealth, souls, crews, clawStats, clawHealth] =
      await Promise.all([
        hbRepo
          .getStatsByUser(userId)
          .catch(() => ({ totalCycles: 0, totalCost: 0, avgDurationMs: 0, failureRate: 0 })),
        (async () => {
          try {
            const stats = await hbRepo
              .getStatsByUser(userId)
              .catch(() => ({ totalCycles: 0, totalCost: 0, avgDurationMs: 0, failureRate: 0 }));
            const score = stats.failureRate > 0.5 ? 30 : stats.failureRate > 0.2 ? 55 : 90;
            const status: 'healthy' | 'watch' | 'stuck' | 'failed' =
              stats.failureRate > 0.5 ? 'failed' : stats.failureRate > 0.2 ? 'watch' : 'healthy';
            const signals: string[] =
              stats.failureRate > 0.2
                ? [`high failure rate: ${(stats.failureRate * 100).toFixed(1)}%`]
                : [];
            const recommendations: string[] =
              stats.failureRate > 0.2
                ? ['Review failed heartbeat tasks and agent configuration']
                : [];
            return {
              status,
              score,
              signals,
              recommendations,
              totalCycles: stats.totalCycles,
              totalCost: stats.totalCost,
              failureRate: stats.failureRate,
            };
          } catch {
            return {
              status: 'healthy' as const,
              score: 90,
              signals: [] as string[],
              recommendations: [] as string[],
              totalCycles: 0,
              totalCost: 0,
              failureRate: 0,
            };
          }
        })(),
        crewRepo
          .list(userId, 1000, 0)
          .then((crews) => ({
            totalCrews: crews.length,
            totalCycles: 0,
            totalCost: 0,
            failureRate: 0,
            byStatus: crews.reduce(
              (acc, cr) => {
                acc[cr.status] = (acc[cr.status] ?? 0) + 1;
                return acc;
              },
              {} as Record<string, number>
            ),
          }))
          .catch(() => ({
            totalCrews: 0,
            totalCycles: 0,
            totalCost: 0,
            failureRate: 0,
            byStatus: {} as Record<string, number>,
          })),
        (async () => {
          try {
            const crews = await crewRepo.list(userId, 100, 0);
            const allMembers = await Promise.all(crews.map((crew) => crewRepo.getMembers(crew.id)));
            const agentIds = allMembers.flatMap((m) => m.map((mem) => mem.agentId));
            const latestHBMap = await hbRepo.getLatestByAgentIds(agentIds);
            let totalErrors = 0;
            let neverRun = 0;
            for (const members of allMembers) {
              for (const m of members) {
                const lastHB = latestHBMap.get(m.agentId);
                if (!lastHB) neverRun++;
                else if (lastHB.tasksFailed.length > 0) totalErrors++;
              }
            }
            const score =
              totalErrors > 0 ? Math.max(30, 70 - totalErrors * 10) : neverRun > 0 ? 75 : 85;
            const status: 'healthy' | 'watch' | 'stuck' | 'failed' =
              totalErrors > 3 ? 'watch' : 'healthy';
            const signals: string[] = [];
            const recommendations: string[] = [];
            if (totalErrors > 0) {
              signals.push(totalErrors + ' agents with errors');
              recommendations.push('Review individual agent heartbeat logs');
            }
            if (neverRun > 0) signals.push(neverRun + ' agents never run');
            return {
              status,
              score,
              signals,
              recommendations,
              totalCrews: crews.length,
              pausedCrews: crews.filter((c) => c.status === 'paused').length,
            };
          } catch {
            return {
              status: 'healthy' as const,
              score: 80,
              signals: [] as string[],
              recommendations: [] as string[],
              totalCrews: 0,
              pausedCrews: 0,
            };
          }
        })(),
        soulRepo.list(userId, 1000, 0).catch(() => []),
        crewRepo.list(userId, 100, 0).catch(() => []),
        (async () => {
          try {
            const configs = await clawService.listClaws(userId);
            const sessions = clawService.listSessions(userId);
            const totalCost = sessions.reduce((s, ses) => s + ses.totalCostUsd, 0);
            const totalCycles = sessions.reduce((s, ses) => s + ses.cyclesCompleted, 0);
            const byMode: Record<string, number> = {};
            const byState: Record<string, number> = {};
            for (const cfg of configs) {
              byMode[cfg.mode] = (byMode[cfg.mode] ?? 0) + 1;
              const state = sessions.find((s) => s.config.id === cfg.id)?.state ?? 'stopped';
              byState[state] = (byState[state] ?? 0) + 1;
            }
            return {
              total: configs.length,
              running: sessions.filter((s) => ['running', 'starting', 'waiting'].includes(s.state))
                .length,
              totalCost: Math.round(totalCost * 10000) / 10000,
              totalCycles,
              byMode,
              byState,
            };
          } catch {
            return { total: 0, running: 0, totalCost: 0, totalCycles: 0, byMode: {}, byState: {} };
          }
        })(),
        (async () => {
          try {
            const configs = await clawService.listClaws(userId);
            const sessions = clawService.listSessions(userId);
            const signals: string[] = [];
            const recommendations: string[] = [];
            const failedConfigs = configs.filter((cfg) => {
              const session = sessions.find((s) => s.config.id === cfg.id);
              if (!session) return false;
              if (session.state === 'failed') return true;
              if (session.lastCycleError) return true;
              return false;
            });
            const runningCount = sessions.filter((s) =>
              ['running', 'starting', 'waiting'].includes(s.state)
            ).length;
            if (failedConfigs.length > 0) {
              signals.push(`${failedConfigs.length} claw(s) need attention`);
              recommendations.push('Review claws with failed/stuck status');
            }
            if (runningCount === 0 && configs.length > 0) {
              signals.push('No claws currently running');
              recommendations.push('Start a claw or set one to auto-start');
            }
            const score =
              failedConfigs.length === 0
                ? runningCount > 0
                  ? 90
                  : 75
                : Math.max(30, 70 - failedConfigs.length * 15);
            const status: 'healthy' | 'watch' | 'stuck' | 'failed' =
              failedConfigs.length > 2 ? 'stuck' : failedConfigs.length > 0 ? 'watch' : 'healthy';
            return {
              status,
              score,
              signals,
              recommendations,
              needsAttention: failedConfigs.length,
            };
          } catch {
            return {
              status: 'healthy' as const,
              score: 75,
              signals: [] as string[],
              recommendations: [] as string[],
              needsAttention: 0,
            };
          }
        })(),
      ]);

    const totalCost = (soulStats.totalCost ?? 0) + (clawStats.totalCost ?? 0);

    return apiResponse(c, {
      soul: {
        stats: soulStats,
        health: soulHealth,
      },
      crew: {
        stats: crewStats,
        health: crewHealth,
      },
      claw: {
        stats: {
          total: clawStats.total,
          running: clawStats.running,
          totalCost: clawStats.totalCost,
          totalCycles: clawStats.totalCycles,
          byMode: clawStats.byMode,
          byState: clawStats.byState,
        },
        health: clawHealth,
      },
      totalCost,
      summary: {
        totalSouls: souls.length,
        totalCrews: crews.length,
        activeSouls: souls.filter((s) => s.heartbeat.enabled).length,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /status — get status of all agents ────────────────────────────────

agentCommandCenterRoutes.get('/status', async (c) => {
  try {
    const userId = getUserId(c);
    const soulRepo = getSoulsRepository();
    const crewRepo = getCrewsRepository();

    // Get all souls for this user
    const souls = await soulRepo.list(userId, 1000, 0);

    // Get all crews for this user
    const crews = await crewRepo.list(userId, 100, 0);

    // Aggregate status — batch-fetch latest heartbeat per soul in a single
    // query instead of N round-trips (souls.length can reach 1000).
    const hbRepo = (
      await import('../../db/repositories/heartbeats/log.js')
    ).getHeartbeatLogRepository();
    const latestByAgent = await hbRepo.getLatestByAgentIds(souls.map((s) => s.agentId));
    const soulStatuses = souls.map((soul) => {
      const lastLog = latestByAgent.get(soul.agentId);
      return {
        type: 'soul' as const,
        id: soul.agentId,
        name: soul.identity.name,
        status: soul.heartbeat.enabled ? 'running' : 'paused',
        lastActivity: lastLog?.createdAt ?? null,
        emoji: soul.identity.emoji,
        role: soul.identity.role,
      };
    });

    const crewStatuses = crews.map((crew) => ({
      type: 'crew' as const,
      id: crew.id,
      name: crew.name,
      status: crew.status,
      pattern: crew.coordinationPattern,
    }));

    return apiResponse(c, {
      summary: {
        totalAgents: soulStatuses.length,
        totalCrews: crewStatuses.length,
        running: soulStatuses.filter((s) => s.status === 'healthy' || s.status === 'running')
          .length,
        paused: soulStatuses.filter((s) => s.status === 'paused').length,
      },
      souls: soulStatuses,
      crews: crewStatuses,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /mission — assign mission to multiple agents ─────────────────────

agentCommandCenterRoutes.post('/mission', async (c) => {
  try {
    const body = validateBody(agentMissionSchema, await c.req.json());

    if (
      (!body.agentIds || body.agentIds.length === 0) &&
      (!body.crewIds || body.crewIds.length === 0)
    ) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'agentIds or crewIds required' },
        400
      );
    }

    const soulRepo = getSoulsRepository();
    const results: { target: string; success: boolean; error?: string }[] = [];

    // Assign to individual agents
    if (body.agentIds) {
      for (const agentId of body.agentIds) {
        try {
          const soul = await soulRepo.getByAgentId(agentId);
          if (!soul) {
            results.push({ target: agentId, success: false, error: 'Not found' });
            continue;
          }

          soul.purpose.mission = body.mission;
          soul.purpose.goals.push(`Mission (${body.priority ?? 'normal'}): ${body.mission}`);
          if (body.deadline) {
            soul.purpose.goals.push(`Deadline: ${body.deadline}`);
          }
          soul.updatedAt = new Date();
          await soulRepo.update(soul);

          results.push({ target: agentId, success: true });
        } catch (err) {
          results.push({ target: agentId, success: false, error: getErrorMessage(err) });
        }
      }
    }

    // Assign to crews
    if (body.crewIds) {
      const crewRepo = getCrewsRepository();
      for (const crewId of body.crewIds) {
        try {
          const members = await crewRepo.getMembers(crewId);
          for (const member of members) {
            const soul = await soulRepo.getByAgentId(member.agentId);
            if (soul) {
              soul.purpose.mission = `${body.mission} (Crew: ${crewId})`;
              soul.updatedAt = new Date();
              await soulRepo.update(soul);
            }
          }
          results.push({ target: crewId, success: true });
        } catch (err) {
          results.push({ target: crewId, success: false, error: getErrorMessage(err) });
        }
      }
    }

    return apiResponse(c, {
      mission: body.mission,
      priority: body.priority ?? 'medium',
      assigned: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /activity — get recent activity from all agents ───────────────────

agentCommandCenterRoutes.get('/activity', async (c) => {
  try {
    const limitNum = getIntParam(c, 'limit', 50, 1, 100);

    const soulRepo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();
    const { getAgentMessagesRepository } = await import('../../db/repositories/agents/messages.js');
    const msgRepo = getAgentMessagesRepository();

    const userId = getUserId(c);

    // Get souls for the authenticated user only
    const souls = await soulRepo.list(userId, 100, 0);

    // Collect recent activities
    const activities: {
      type: 'heartbeat' | 'message' | 'command' | 'error';
      agentId: string;
      agentName: string;
      timestamp: Date;
      details: unknown;
    }[] = [];

    for (const soul of souls) {
      // Get recent heartbeats
      const heartbeats = await hbRepo.getRecent(soul.agentId, 5);
      for (const hb of heartbeats) {
        activities.push({
          type: hb.tasksFailed.length > 0 ? 'error' : 'heartbeat',
          agentId: soul.agentId,
          agentName: soul.identity.name,
          timestamp: hb.createdAt,
          details: {
            tasksRun: hb.tasksRun.length,
            tasksFailed: hb.tasksFailed.length,
            durationMs: hb.durationMs,
            cost: hb.cost,
          },
        });
      }

      // Get recent messages
      const messages = await msgRepo.listByAgent(soul.agentId, 5, 0);
      for (const msg of messages.slice(0, 3)) {
        activities.push({
          type: 'message',
          agentId: soul.agentId,
          agentName: soul.identity.name,
          timestamp: msg.createdAt,
          details: {
            from: msg.from,
            subject: msg.subject,
            type: msg.type,
          },
        });
      }
    }

    // Sort by timestamp desc
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return apiResponse(c, {
      activities: activities.slice(0, limitNum),
      total: activities.length,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /execute — execute multiple agents immediately ───────────────────

agentCommandCenterRoutes.post('/execute', async (c) => {
  try {
    const userId = getUserId(c);
    if ((!userId || userId === 'default') && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const body = validateBody(agentExecuteSchema, await c.req.json());

    const { runAgentHeartbeat } = await import('../../services/heartbeat/soul-service.js');
    const results: { target: { type: string; id: string }; success: boolean; error?: string }[] =
      [];

    if (body.parallel) {
      // Execute in parallel
      const promises = body.targets.map(async (target) => {
        try {
          if (target.type === 'soul') {
            const result = await runAgentHeartbeat(target.id);
            return { target, success: result.success, error: result.error };
          }
          return { target, success: false, error: `Unsupported target type: ${target.type}` };
        } catch (err) {
          return { target, success: false, error: getErrorMessage(err) };
        }
      });
      const parallelResults = await Promise.all(promises);
      results.push(...parallelResults);
    } else {
      // Execute sequentially
      for (const target of body.targets) {
        try {
          if (target.type === 'soul') {
            const result = await runAgentHeartbeat(target.id);
            results.push({ target, success: result.success, error: result.error });
          } else {
            results.push({
              target,
              success: false,
              error: `Unsupported target type: ${target.type}`,
            });
          }
        } catch (err) {
          results.push({ target, success: false, error: getErrorMessage(err) });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return apiResponse(c, {
      executed: successCount,
      failed: results.length - successCount,
      parallel: body.parallel ?? false,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /analytics — get aggregate agent analytics ────────────────────────

agentCommandCenterRoutes.get('/analytics', async (c) => {
  try {
    const userId = getUserId(c);
    const soulRepo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();
    const crewRepo = getCrewsRepository();

    const [souls, crews] = await Promise.all([
      soulRepo.list(userId, 1000, 0),
      crewRepo.list(userId, 100, 0),
    ]);

    // Aggregate stats across all agents
    let totalCycles = 0;
    let totalCost = 0;
    let totalErrors = 0;
    const agentStats: {
      agentId: string;
      name: string;
      cycles: number;
      cost: number;
      errorRate: number;
      status: string;
    }[] = [];

    // Batch the per-soul stats into a single GROUP BY query (was N+1).
    const statsByAgent = await hbRepo.getStatsByAgentIds(souls.map((s) => s.agentId));
    const zeroStats = { totalCycles: 0, totalCost: 0, avgDurationMs: 0, failureRate: 0 };
    for (const soul of souls) {
      const stats = statsByAgent.get(soul.agentId) ?? zeroStats;
      totalCycles += stats.totalCycles;
      totalCost += stats.totalCost;
      totalErrors += Math.round(stats.totalCycles * stats.failureRate);

      agentStats.push({
        agentId: soul.agentId,
        name: soul.identity.name,
        cycles: stats.totalCycles,
        cost: stats.totalCost,
        errorRate: stats.failureRate,
        status: soul.heartbeat.enabled ? 'running' : 'paused',
      });
    }

    // Sort by activity (cycles)
    agentStats.sort((a, b) => b.cycles - a.cycles);

    return apiResponse(c, {
      summary: {
        totalAgents: souls.length,
        totalCrews: crews.length,
        totalCycles,
        totalCost: Math.round(totalCost * 100) / 100,
        overallErrorRate: totalCycles > 0 ? totalErrors / totalCycles : 0,
        activeAgents: souls.filter((s) => s.heartbeat.enabled).length,
      },
      topAgents: agentStats.slice(0, 10),
      agentStats,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /tools/batch-update — update tools for multiple agents ───────────

agentCommandCenterRoutes.post('/tools/batch-update', async (c) => {
  try {
    const body = validateBody(agentToolsBatchUpdateSchema, await c.req.json());

    const soulRepo = getSoulsRepository();
    const results: { agentId: string; success: boolean; error?: string }[] = [];

    for (const agentId of body.agentIds) {
      try {
        const soul = await soulRepo.getByAgentId(agentId);
        if (!soul) {
          results.push({ agentId, success: false, error: 'Soul not found' });
          continue;
        }

        // Update allowed actions
        const allowed = new Set(soul.autonomy.allowedActions ?? []);
        if (body.addAllowed) body.addAllowed.forEach((t) => allowed.add(t));
        if (body.removeAllowed) body.removeAllowed.forEach((t) => allowed.delete(t));
        soul.autonomy.allowedActions = Array.from(allowed);

        // Update blocked actions
        const blocked = new Set(soul.autonomy.blockedActions ?? []);
        if (body.addBlocked) body.addBlocked.forEach((t) => blocked.add(t));
        if (body.removeBlocked) body.removeBlocked.forEach((t) => blocked.delete(t));
        soul.autonomy.blockedActions = Array.from(blocked);

        soul.updatedAt = new Date();
        await soulRepo.update(soul);

        results.push({ agentId, success: true });
      } catch (err) {
        results.push({ agentId, success: false, error: getErrorMessage(err) });
      }
    }

    return apiResponse(c, {
      updated: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

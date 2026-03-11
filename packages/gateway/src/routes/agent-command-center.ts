/**
 * Agent Command Center — Unified control interface for all agents
 *
 * Provides army-level commands:
 * - Broadcast commands to multiple agents
 * - Deploy fleets (crews with missions)
 * - Monitor all agents at once
 * - Aggregate results from multiple agents
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getUserId,
  getIntParam,
} from './helpers.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getBackgroundAgentService } from '../services/background-agent-service.js';
import { getCrewsRepository } from '../db/repositories/crews.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { agentsRepo } from '../db/repositories/agents.js';
import {
  validateBody,
  agentCommandSchema,
  deployFleetSchema,
  agentMissionSchema,
  agentExecuteSchema,
  agentToolsBatchUpdateSchema,
} from '../middleware/validation.js';

export const agentCommandCenterRoutes = new Hono();

// ═══════════════════════════════════════════════════════════════════════════
// FLEET OPERATIONS (Multi-Agent Commands)
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
                const { runAgentHeartbeat } = await import('../services/soul-heartbeat-service.js');
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

          case 'background': {
            const bgService = getBackgroundAgentService();
            const config = await bgService.getAgent(target.id, userId);
            if (!config) {
              results.push({ target, success: false, error: 'Background agent not found' });
              continue;
            }

            switch (body.command) {
              case 'start':
                await bgService.startAgent(target.id, userId);
                result = { status: 'started' };
                break;
              case 'pause':
                await bgService.pauseAgent(target.id, userId);
                result = { status: 'paused' };
                break;
              case 'resume':
                await bgService.resumeAgent(target.id, userId);
                result = { status: 'resumed' };
                break;
              case 'stop':
                await bgService.stopAgent(target.id, userId);
                result = { status: 'stopped' };
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

// ── POST /deploy-fleet — deploy multiple agents with a shared mission ─────

agentCommandCenterRoutes.post('/deploy-fleet', async (c) => {
  try {
    const body = validateBody(deployFleetSchema, await c.req.json());

    const count = Math.min(body.agentCount ?? 1, 10); // Max 10 agents per fleet
    const { settingsRepo } = await import('../db/repositories/index.js');

    const [defaultProvider, defaultModel] = await Promise.all([
      settingsRepo.get<string>('default_ai_provider'),
      settingsRepo.get<string>('default_ai_model'),
    ]);

    const provider = body.provider ?? defaultProvider ?? 'anthropic';
    const model = body.model ?? defaultModel ?? 'claude-sonnet-4-5-20251001';

    const soulRepo = getSoulsRepository();
    const agents: { agentId: string; role: string; name: string }[] = [];

    // Create fleet crew
    const crewRepo = getCrewsRepository();
    const crew = await crewRepo.create({
      name: body.name,
      description: body.mission,
      templateId: 'fleet',
      coordinationPattern: body.coordinationPattern ?? 'hub_spoke',
      status: 'active',
    });

    // Create agents with different roles
    const defaultRoles = ['coordinator', 'researcher', 'executor', 'reviewer'];
    const roles = body.roles ?? defaultRoles;

    for (let i = 0; i < count; i++) {
      const agentId = randomUUID();
      const role = roles[i % roles.length] ?? 'member';
      const name = `${body.name} ${role.charAt(0).toUpperCase() + role.slice(1)} ${i + 1}`;

      // Create agent
      await agentsRepo.create({
        id: agentId,
        name,
        systemPrompt: `You are ${role} in fleet "${body.name}". Mission: ${body.mission}`,
        provider,
        model,
      });

      // Create soul with role-specific configuration
      await soulRepo.create({
        agentId,
        identity: {
          name,
          emoji:
            role === 'coordinator'
              ? '👑'
              : role === 'researcher'
                ? '🔍'
                : role === 'executor'
                  ? '⚡'
                  : '✓',
          role: role.charAt(0).toUpperCase() + role.slice(1),
          personality: `Specialized ${role} agent`,
          voice: { tone: 'professional', language: 'en', quirks: [] },
          boundaries: [],
        },
        purpose: {
          mission: `${body.mission} (Role: ${role})`,
          goals: [`Execute ${role} duties`, 'Collaborate with fleet members'],
          expertise: [role],
          toolPreferences: [],
        },
        autonomy: {
          level: 3,
          allowedActions: [
            'search_web',
            'create_note',
            'read_url',
            'search_memories',
            'send_message_to_user',
          ],
          blockedActions: ['delete_data', 'execute_code'],
          requiresApproval: [],
          maxCostPerCycle: 0.5,
          maxCostPerDay: 5.0,
          maxCostPerMonth: 100.0,
          pauseOnConsecutiveErrors: 5,
          pauseOnBudgetExceeded: true,
          notifyUserOnPause: true,
        },
        heartbeat: {
          enabled: true,
          interval: '0 */6 * * *',
          checklist: [],
          selfHealingEnabled: true,
          maxDurationMs: 120000,
        },
        relationships: {
          delegates: [],
          peers: [], // Will be populated with other fleet members
          channels: [],
          crewId: crew.id,
        },
        evolution: {
          version: 1,
          evolutionMode: 'supervised',
          coreTraits: [],
          mutableTraits: [],
          learnings: [],
          feedbackLog: [],
        },
        bootSequence: {
          onStart: ['announce_presence'],
          onHeartbeat: ['read_inbox', 'check_fleet_status'],
          onMessage: ['respond_and_act'],
        },
      });

      // Add to crew
      await crewRepo.addMember(crew.id, agentId, role);
      agents.push({ agentId, role, name });
    }

    // Update peer relationships
    for (const agent of agents) {
      const peers = agents.filter((a) => a.agentId !== agent.agentId).map((a) => a.agentId);
      const soul = await soulRepo.getByAgentId(agent.agentId);
      if (soul) {
        soul.relationships.peers = peers;
        await soulRepo.update(soul);
      }
    }

    return apiResponse(
      c,
      {
        fleetId: crew.id,
        name: body.name,
        mission: body.mission,
        agents,
        coordinationPattern: body.coordinationPattern ?? 'hub_spoke',
      },
      201
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /status — get status of all agents ────────────────────────────────

agentCommandCenterRoutes.get('/status', async (c) => {
  try {
    const userId = getUserId(c);
    const soulRepo = getSoulsRepository();
    const bgService = getBackgroundAgentService();
    const crewRepo = getCrewsRepository();

    // Get all souls for this user
    const souls = await soulRepo.list(userId, 1000, 0);

    // Get all background agents for this user
    const bgAgents = await bgService.listAgents(userId);
    const bgSessions = bgService.listSessions(userId);

    // Get all crews for this user
    const crews = await crewRepo.list(userId, 100, 0);

    // Aggregate status
    const soulStatuses = await Promise.all(
      souls.map(async (soul) => {
        const hbRepo = (
          await import('../db/repositories/heartbeat-log.js')
        ).getHeartbeatLogRepository();
        const lastLog = await hbRepo.getLatest(soul.agentId);
        return {
          type: 'soul' as const,
          id: soul.agentId,
          name: soul.identity.name,
          status: soul.heartbeat.enabled ? 'running' : 'paused',
          lastActivity: lastLog?.createdAt ?? null,
          emoji: soul.identity.emoji,
          role: soul.identity.role,
        };
      })
    );

    const bgStatuses = bgAgents.map((agent) => {
      const session = bgSessions.find((s) => s.config.id === agent.id);
      return {
        type: 'background' as const,
        id: agent.id,
        name: agent.name,
        status: session?.state ?? 'stopped',
        lastActivity: session?.lastCycleAt ?? null,
        mode: agent.mode,
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
        totalAgents: soulStatuses.length + bgStatuses.length,
        totalCrews: crewStatuses.length,
        running:
          soulStatuses.filter((s) => s.status === 'healthy' || s.status === 'running').length +
          bgStatuses.filter((s) => s.status === 'running').length,
        paused:
          soulStatuses.filter((s) => s.status === 'paused').length +
          bgStatuses.filter((s) => s.status === 'paused').length,
      },
      souls: soulStatuses,
      backgroundAgents: bgStatuses,
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
    const { getAgentMessagesRepository } = await import('../db/repositories/agent-messages.js');
    const msgRepo = getAgentMessagesRepository();

    // Get all souls (admin view - no user filter)
    const souls = await soulRepo.list(null, 100, 0);

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
    const body = validateBody(agentExecuteSchema, await c.req.json());

    const { runAgentHeartbeat } = await import('../services/soul-heartbeat-service.js');
    const bgService = getBackgroundAgentService();
    const results: { target: { type: string; id: string }; success: boolean; error?: string }[] =
      [];

    if (body.parallel) {
      // Execute in parallel
      const promises = body.targets.map(async (target) => {
        try {
          if (target.type === 'soul') {
            const result = await runAgentHeartbeat(target.id);
            return { target, success: result.success, error: result.error };
          } else {
            const executed = await bgService.executeNow(target.id, userId, target.task);
            return { target, success: executed };
          }
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
            const executed = await bgService.executeNow(target.id, userId, target.task);
            results.push({ target, success: executed });
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

// ── GET /analytics — get fleet-wide analytics ─────────────────────────────

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

    for (const soul of souls) {
      const stats = await hbRepo.getStats(soul.agentId);
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

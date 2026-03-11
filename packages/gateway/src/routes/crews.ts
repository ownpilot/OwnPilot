/**
 * Crew Routes — deploy, manage, and monitor agent crews
 */

import { Hono } from 'hono';
import { getLog } from '../services/log.js';

const log = getLog('CrewsRoute');
import { randomUUID } from 'node:crypto';
import { listCrewTemplates, getCrewTemplate } from '@ownpilot/core';
import { getCrewsRepository } from '../db/repositories/crews.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { agentsRepo } from '../db/repositories/agents.js';
import { createTriggersRepository } from '../db/repositories/triggers.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
  getUserId,
} from './helpers.js';
import {
  validateBody,
  crewDeploySchema,
  crewMessageSchema,
  crewDelegateSchema,
  crewSyncSchema,
} from '../middleware/validation.js';

export const crewRoutes = new Hono();

// ── GET / — list all crews ──────────────────────────

crewRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const { limit, offset } = getPaginationParams(c);
    const repo = getCrewsRepository();
    const [crews, total] = await Promise.all([
      repo.list(userId, limit, offset),
      repo.count(userId),
    ]);
    return apiResponse(c, { items: crews, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /templates — list crew templates (MUST be before /:id) ──

crewRoutes.get('/templates', (_c) => {
  const templates = listCrewTemplates();
  return apiResponse(_c, templates);
});

// ── GET /templates/:id — template details ───────────

crewRoutes.get('/templates/:id', (c) => {
  const template = getCrewTemplate(c.req.param('id'));
  if (!template) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Template not found' }, 404);
  }
  return apiResponse(c, template);
});

// ── POST /deploy — deploy crew from template ────────

crewRoutes.post('/deploy', async (c) => {
  try {
    const userId = getUserId(c);
    const rawBody = await c.req.json();
    const body = validateBody(crewDeploySchema, rawBody);
    const { templateId } = body;
    // provider and model are pass-through fields not in the schema
    const provider = (rawBody as Record<string, unknown>).provider as string | undefined;
    const model = (rawBody as Record<string, unknown>).model as string | undefined;

    const template = getCrewTemplate(templateId);
    if (!template) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Template not found: ${templateId}` },
        404
      );
    }

    const crewRepo = getCrewsRepository();
    const soulRepo = getSoulsRepository();
    const triggerRepo = createTriggersRepository();
    const { settingsRepo } = await import('../db/repositories/index.js');

    // Get default provider/model if not specified
    const [defaultProvider, defaultModel] = await Promise.all([
      settingsRepo.get<string>('default_ai_provider'),
      settingsRepo.get<string>('default_ai_model'),
    ]);

    // Use provided values, or defaults, or system fallback
    const agentProvider = provider ?? defaultProvider ?? 'anthropic';
    const agentModel = model ?? defaultModel ?? 'claude-sonnet-4-5-20251001';

    // 1. Create crew record
    const crew = await crewRepo.create({
      name: template.name,
      description: template.description,
      templateId,
      coordinationPattern: template.coordinationPattern,
      status: 'active',
      workspaceId: userId,
    });

    const agentResults: {
      agentId: string;
      name: string;
      status: 'created' | 'failed';
      error?: string;
    }[] = [];

    // 2. Create each agent with soul
    for (const tmpl of template.agents) {
      const agentId = randomUUID();
      const agentName = tmpl.identity?.name ?? 'Unnamed Agent';

      try {
        // Create agent record with configurable provider/model
        await agentsRepo.create({
          id: agentId,
          name: agentName,
          systemPrompt: '',
          provider: agentProvider,
          model: agentModel,
        });

        // Create soul - with explicit defaults for any missing template data
        await soulRepo.create({
          agentId,
          identity: tmpl.identity,
          purpose: tmpl.purpose,
          autonomy: {
            level: 3,
            allowedActions: ['search_web', 'create_note', 'read_url', 'search_memories'],
            blockedActions: ['delete_data', 'execute_code'],
            requiresApproval: ['send_message_to_user'],
            maxCostPerCycle: 0.5,
            maxCostPerDay: 5.0,
            maxCostPerMonth: 100.0,
            pauseOnConsecutiveErrors: 5,
            pauseOnBudgetExceeded: true,
            notifyUserOnPause: true,
          },
          heartbeat: tmpl.heartbeat ?? {
            enabled: false,
            interval: '0 */6 * * *',
            checklist: [],
            selfHealingEnabled: false,
            maxDurationMs: 120000,
          },
          relationships: { ...tmpl.relationships, crewId: crew.id },
          evolution: {
            version: 1,
            evolutionMode: 'supervised',
            coreTraits: tmpl.identity?.personality ? [tmpl.identity.personality] : [],
            mutableTraits: [],
            learnings: [],
            feedbackLog: [],
          },
          bootSequence: {
            onStart: [],
            onHeartbeat: ['read_inbox'],
            onMessage: [],
          },
        });

        // Add crew member
        await crewRepo.addMember(crew.id, agentId, tmpl.identity?.role ?? 'Member');

        // Create heartbeat trigger if enabled and interval is valid
        if (tmpl.heartbeat?.enabled && tmpl.heartbeat.interval?.trim()) {
          try {
            await triggerRepo.create({
              name: `${agentName} Heartbeat`,
              type: 'schedule' as never,
              config: { expression: tmpl.heartbeat.interval } as never,
              action: { type: 'run_heartbeat', agentId } as never,
              enabled: true,
            });
          } catch (triggerError) {
            // Log but don't fail - agent is still created
            log.warn(`Failed to create heartbeat trigger for ${agentId}:`, triggerError);
          }
        }

        agentResults.push({ agentId, name: agentName, status: 'created' });
      } catch (agentError) {
        const errorMsg = getErrorMessage(agentError);
        agentResults.push({ agentId, name: agentName, status: 'failed', error: errorMsg });
        // Continue with other agents - don't fail the entire crew
      }
    }

    const createdAgents = agentResults.filter((a) => a.status === 'created');
    const failedAgents = agentResults.filter((a) => a.status === 'failed');

    // If all agents failed, mark crew as failed and return error
    if (createdAgents.length === 0 && failedAgents.length > 0) {
      await crewRepo.updateStatus(crew.id, 'disbanded');
      return apiError(
        c,
        {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: `Failed to create all agents: ${failedAgents.map((a) => `${a.name}: ${a.error}`).join(', ')}`,
        },
        500
      );
    }

    return apiResponse(
      c,
      {
        crewId: crew.id,
        agents: createdAgents.map((a) => a.agentId),
        agentDetails: agentResults,
        name: crew.name,
        createdCount: createdAgents.length,
        failedCount: failedAgents.length,
      },
      201
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:id — crew details with member status ──────

crewRoutes.get('/:id', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const crewRepo = getCrewsRepository();
    const crew = await crewRepo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await crewRepo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    // Batch-fetch souls and heartbeats to avoid N+1 queries
    const agentIds = members.map((m) => m.agentId);
    const [latestHBMap, ...souls] = await Promise.all([
      hbRepo.getLatestByAgentIds(agentIds),
      ...members.map((m) => soulRepo.getByAgentId(m.agentId)),
    ]);

    const agents = members.map((m, i) => {
      const soul = souls[i];
      return {
        agentId: m.agentId,
        role: m.role,
        name: soul?.identity.name || 'Unknown',
        emoji: soul?.identity.emoji || '?',
        heartbeatEnabled: soul?.heartbeat.enabled ?? false,
        lastHeartbeat: latestHBMap.get(m.agentId)?.createdAt || null,
        soulVersion: soul?.evolution.version || 0,
      };
    });

    return apiResponse(c, { ...crew, agents });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/pause — pause crew ────────────────────

crewRoutes.post('/:id/pause', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    for (const m of members) {
      await soulRepo.setHeartbeatEnabled(m.agentId, false);
    }
    await repo.updateStatus(crewId, 'paused');
    return apiResponse(c, { status: 'paused' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/resume — resume crew ──────────────────

crewRoutes.post('/:id/resume', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    for (const m of members) {
      await soulRepo.setHeartbeatEnabled(m.agentId, true);
    }
    await repo.updateStatus(crewId, 'active');
    return apiResponse(c, { status: 'active' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── DELETE /:id — delete crew completely ────────────

crewRoutes.delete('/:id', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const soulRepo = getSoulsRepository();
    const triggerRepo = createTriggersRepository();

    // Get all crew members
    const members = await repo.getMembers(crewId);

    // Delete each agent and associated data
    for (const member of members) {
      const agentId = member.agentId;

      // 1. Delete heartbeat triggers for this agent (single JSONB query, no full-table scan)
      await triggerRepo.deleteHeartbeatTriggersForAgent(agentId);

      // 2. Delete soul
      await soulRepo.delete(agentId);

      // 3. Delete agent
      await agentsRepo.delete(agentId);
    }

    // 4. Remove crew members
    await repo.removeAllMembers(crewId);

    // 5. Delete crew record
    await repo.delete(crewId);

    return apiResponse(c, { status: 'deleted', deletedAgents: members.length });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CREW COMMUNICATION & COORDINATION
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /:id/message — broadcast message to all crew members ─────────────

crewRoutes.post('/:id/message', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const body = validateBody(crewMessageSchema, await c.req.json());

    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    const { getAgentMessagesRepository } = await import('../db/repositories/agent-messages.js');
    const msgRepo = getAgentMessagesRepository();

    // Send message to all crew members
    const sent: { agentId: string; name: string; success: boolean }[] = [];
    for (const member of members) {
      try {
        const soul = await soulRepo.getByAgentId(member.agentId);
        await msgRepo.create({
          id: crypto.randomUUID(),
          from: 'crew-commander',
          to: member.agentId,
          type: 'coordination',
          subject: `Crew Message: ${crew.name}`,
          content: `[Crew ${crew.name}] ${body.message}`,
          attachments: [],
          priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
          requiresResponse: false,
          status: 'sent',
          crewId: crew.id,
          createdAt: new Date(),
        });
        sent.push({
          agentId: member.agentId,
          name: soul?.identity.name ?? 'Unknown',
          success: true,
        });
      } catch {
        sent.push({ agentId: member.agentId, name: 'Unknown', success: false });
      }
    }

    return apiResponse(c, {
      crewId,
      message: body.message,
      sentTo: sent.filter((s) => s.success).length,
      failed: sent.filter((s) => !s.success).length,
      recipients: sent,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/delegate — delegate task from one agent to another ─────────

crewRoutes.post('/:id/delegate', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const body = validateBody(crewDelegateSchema, await c.req.json());

    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const fromMember = members.find((m) => m.agentId === body.fromAgentId);
    const toMember = members.find((m) => m.agentId === body.toAgentId);

    if (!fromMember || !toMember) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found in crew' }, 404);
    }

    // Send delegation message
    const { getAgentMessagesRepository } = await import('../db/repositories/agent-messages.js');
    const msgRepo = getAgentMessagesRepository();

    await msgRepo.create({
      id: crypto.randomUUID(),
      from: body.fromAgentId,
      to: body.toAgentId,
      type: 'task_delegation',
      subject: 'Task Delegation',
      content: `DELEGATION: ${body.task}${body.context ? `\nContext: ${JSON.stringify(body.context)}` : ''}`,
      attachments: [],
      priority: 'high',
      requiresResponse: true,
      status: 'sent',
      crewId: crew.id,
      createdAt: new Date(),
    });

    return apiResponse(c, {
      crewId,
      from: body.fromAgentId,
      to: body.toAgentId,
      task: body.task,
      status: 'delegated',
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:id/status — detailed crew status with coordination info ────────

crewRoutes.get('/:id/status', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();
    const { getAgentMessagesRepository } = await import('../db/repositories/agent-messages.js');
    const msgRepo = getAgentMessagesRepository();

    // Batch-fetch souls, heartbeats, and unread counts to avoid N+1 queries
    const agentIds = members.map((m) => m.agentId);
    const [latestHBMap, unreadMap, ...souls] = await Promise.all([
      hbRepo.getLatestByAgentIds(agentIds),
      msgRepo.countUnreadByAgentIds(agentIds),
      ...members.map((m) => soulRepo.getByAgentId(m.agentId)),
    ]);

    const agents = members.map((m, i) => {
      const soul = souls[i];
      return {
        agentId: m.agentId,
        role: m.role,
        name: soul?.identity.name || 'Unknown',
        emoji: soul?.identity.emoji || '?',
        status: soul?.heartbeat.enabled ? 'running' : 'paused',
        lastHeartbeat: latestHBMap.get(m.agentId)?.createdAt || null,
        unreadMessages: unreadMap.get(m.agentId) ?? 0,
        mission: soul?.purpose.mission || '',
        peers: soul?.relationships.peers || [],
      };
    });

    // Calculate coordination metrics
    const activeAgents = agents.filter((a) => a.status === 'healthy').length;
    const totalMessages = agents.reduce((sum, a) => sum + a.unreadMessages, 0);

    return apiResponse(c, {
      crewId: crew.id,
      name: crew.name,
      status: crew.status,
      pattern: crew.coordinationPattern,
      metrics: {
        totalAgents: agents.length,
        activeAgents,
        pausedAgents: agents.length - activeAgents,
        unreadMessages: totalMessages,
        health: agents.length > 0 ? Math.round((activeAgents / agents.length) * 100) : 0,
      },
      agents,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/sync — synchronize knowledge/context across crew ───────────

crewRoutes.post('/:id/sync', async (c) => {
  try {
    const crewId = c.req.param('id');
    const userId = getUserId(c);
    const body = validateBody(crewSyncSchema, await c.req.json());

    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId, userId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await repo.getMembers(crewId);
    const soulRepo = getSoulsRepository();

    // Add shared context to all members' learnings
    for (const member of members) {
      const soul = await soulRepo.getByAgentId(member.agentId);
      if (soul) {
        soul.evolution.learnings.push(`[Crew Sync ${new Date().toISOString()}] ${body.context}`);
        // Keep only last 50 learnings
        if (soul.evolution.learnings.length > 50) {
          soul.evolution.learnings = soul.evolution.learnings.slice(-50);
        }
        soul.updatedAt = new Date();
        await soulRepo.update(soul);
      }
    }

    return apiResponse(c, {
      crewId,
      syncedTo: members.length,
      context: body.context,
      importance: 'medium',
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

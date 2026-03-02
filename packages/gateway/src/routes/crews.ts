/**
 * Crew Routes — deploy, manage, and monitor agent crews
 */

import { Hono } from 'hono';
import { listCrewTemplates, getCrewTemplate, generateId } from '@ownpilot/core';
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
} from './helpers.js';

export const crewRoutes = new Hono();

// ── GET / — list all crews ──────────────────────────

crewRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const repo = getCrewsRepository();
    const [crews, total] = await Promise.all([repo.list(limit, offset), repo.count()]);
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
    const body = await c.req.json<{ templateId: string }>();
    const { templateId } = body;
    if (!templateId) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'templateId is required' },
        400
      );
    }

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

    // 1. Create crew record
    const crew = await crewRepo.create({
      name: template.name,
      description: template.description,
      templateId,
      coordinationPattern: template.coordinationPattern,
      status: 'active',
    });

    const agentIds: string[] = [];

    // 2. Create each agent with soul
    for (const tmpl of template.agents) {
      const agentId = generateId('agt');

      // Create agent record
      await agentsRepo.create({
        id: agentId,
        name: tmpl.identity.name,
        systemPrompt: '',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250514',
      });

      // Create soul
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
        heartbeat: tmpl.heartbeat,
        relationships: { ...tmpl.relationships, crewId: crew.id },
        evolution: {
          version: 1,
          evolutionMode: 'supervised',
          coreTraits: [tmpl.identity.personality],
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
      await crewRepo.addMember(crew.id, agentId, tmpl.identity.role);

      // Create heartbeat trigger if enabled
      if (tmpl.heartbeat.enabled) {
        await triggerRepo.create({
          name: `${tmpl.identity.name} Heartbeat`,
          type: 'schedule' as never,
          config: { expression: tmpl.heartbeat.interval } as never,
          action: { type: 'run_heartbeat', agentId } as never,
          enabled: true,
        });
      }

      agentIds.push(agentId);
    }

    return apiResponse(c, { crewId: crew.id, agents: agentIds, name: crew.name }, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:id — crew details with member status ──────

crewRoutes.get('/:id', async (c) => {
  try {
    const crewId = c.req.param('id');
    const crewRepo = getCrewsRepository();
    const crew = await crewRepo.getById(crewId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }

    const members = await crewRepo.getMembers(crewId);
    const soulRepo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    const agents = await Promise.all(
      members.map(async (m) => {
        const soul = await soulRepo.getByAgentId(m.agentId);
        const lastHB = await hbRepo.getLatest(m.agentId);
        return {
          agentId: m.agentId,
          role: m.role,
          name: soul?.identity.name || 'Unknown',
          emoji: soul?.identity.emoji || '?',
          heartbeatEnabled: soul?.heartbeat.enabled ?? false,
          lastHeartbeat: lastHB?.createdAt || null,
          soulVersion: soul?.evolution.version || 0,
        };
      })
    );

    return apiResponse(c, { ...crew, agents });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:id/pause — pause crew ────────────────────

crewRoutes.post('/:id/pause', async (c) => {
  try {
    const crewId = c.req.param('id');
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId);
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
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId);
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

// ── DELETE /:id — disband crew ──────────────────────

crewRoutes.delete('/:id', async (c) => {
  try {
    const crewId = c.req.param('id');
    const repo = getCrewsRepository();
    const crew = await repo.getById(crewId);
    if (!crew) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Crew not found' }, 404);
    }
    await repo.updateStatus(crewId, 'disbanded');
    return apiResponse(c, { status: 'disbanded' });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

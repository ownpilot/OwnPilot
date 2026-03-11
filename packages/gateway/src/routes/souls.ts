/**
 * Soul Routes — CRUD + evolution + versioning
 *
 * Implementation split:
 * - souls-deploy.ts:        POST /deploy — atomic agent+soul+trigger creation
 * - souls-agent-routes.ts:  /:agentId/* sub-routes (logs, memories, goals, etc.)
 * - souls.ts:               List, create, GET/PUT/DELETE /:agentId (this file)
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:agentId/versions, /:agentId/feedback, etc.)
 * 3. Generic dynamic route (/:agentId) - MUST be last
 */

import { Hono } from 'hono';
import type { AgentSoul } from '@ownpilot/core';
import { getSoulsRepository } from '../db/repositories/souls.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { validateBody, createSoulSchema } from '../middleware/validation.js';

// Import sub-routes
import { soulDeployRoutes } from './souls-deploy.js';
import { soulAgentRoutes } from './souls-agent-routes.js';

export const soulRoutes = new Hono();

// Mount sub-routes (order matters: deploy + agent sub-routes BEFORE /:agentId catch-all)
soulRoutes.route('/', soulDeployRoutes);
soulRoutes.route('/', soulAgentRoutes);

/**
 * Validate and protect core traits during soul evolution.
 * AGENT-HIGH-005: Core trait protection - prevents modification of core DNA.
 */
function validateEvolutionChanges(
  existing: AgentSoul,
  updates: Partial<AgentSoul>
): { valid: true } | { valid: false; error: string } {
  if (!updates.evolution) {
    return { valid: true };
  }

  const newCoreTraits = updates.evolution.coreTraits;
  const oldCoreTraits = existing.evolution.coreTraits;

  if (newCoreTraits !== undefined) {
    const isSame =
      newCoreTraits.length === oldCoreTraits.length &&
      newCoreTraits.every((trait: string, i: number) => trait === oldCoreTraits[i]);

    if (!isSame && oldCoreTraits.length > 0) {
      return {
        valid: false,
        error:
          'Core traits (DNA) cannot be modified after creation. Use mutableTraits for evolution.',
      };
    }
  }

  const oldMode = existing.evolution.evolutionMode;
  const newMode = updates.evolution.evolutionMode;

  if (newMode && newMode !== oldMode) {
    if (oldMode === 'manual' && newMode === 'autonomous') {
      return {
        valid: false,
        error:
          'Cannot transition directly from manual to autonomous evolution. Use supervised first.',
      };
    }
  }

  return { valid: true };
}

// ── GET / — list all souls ──────────────────────────

soulRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const rawUserId = c.get('userId') as string | undefined;
    const userId = rawUserId && rawUserId !== 'default' ? rawUserId : null;
    const repo = getSoulsRepository();
    const [souls, total] = await Promise.all([
      repo.list(userId, limit, offset),
      repo.count(userId),
    ]);
    return apiResponse(c, { items: souls, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST / — create soul ────────────────────────────

soulRoutes.post('/', async (c) => {
  try {
    const rawBody = await c.req.json();
    const body = validateBody(createSoulSchema, rawBody);

    const soulData = {
      agentId: body.agentId,
      identity: body.identity,
      purpose: body.purpose,
      autonomy: body.autonomy,
      heartbeat: body.heartbeat,
      relationships: body.relationships ?? {},
      evolution: body.evolution,
      bootSequence: body.bootSequence ?? {},
      provider: rawBody.provider,
      skillAccess: rawBody.skillAccess,
    } as unknown as Parameters<ReturnType<typeof getSoulsRepository>['create']>[0];
    const soul = await getSoulsRepository().create(soulData);
    return apiResponse(c, soul, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC DYNAMIC ROUTES (/:agentId) - MUST be last
// These catch-all routes must come after all specific /:agentId/... routes
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /:agentId — get soul by agent ID ────────────

soulRoutes.get('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const soul = await getSoulsRepository().getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    return apiResponse(c, soul);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── PUT /:agentId — update soul ─────────────────────

soulRoutes.put('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const repo = getSoulsRepository();
    const existing = await repo.getByAgentId(agentId);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const body = await c.req.json<Partial<AgentSoul>>();

    // AGENT-HIGH-005: Validate evolution changes protect core traits
    const validation = validateEvolutionChanges(existing, body);
    if (!validation.valid) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: validation.error }, 400);
    }

    // Only allow explicitly listed fields — prevent mass assignment
    const allowedUpdates: Partial<AgentSoul> = {};
    if (body.identity !== undefined) allowedUpdates.identity = body.identity;
    if (body.purpose !== undefined) allowedUpdates.purpose = body.purpose;
    if (body.autonomy !== undefined) allowedUpdates.autonomy = body.autonomy;
    if (body.heartbeat !== undefined) allowedUpdates.heartbeat = body.heartbeat;
    if (body.relationships !== undefined) allowedUpdates.relationships = body.relationships;
    if (body.evolution !== undefined) allowedUpdates.evolution = body.evolution;
    if (body.bootSequence !== undefined) allowedUpdates.bootSequence = body.bootSequence;
    if (body.provider !== undefined) allowedUpdates.provider = body.provider;
    if (body.skillAccess !== undefined) allowedUpdates.skillAccess = body.skillAccess;

    const updated = {
      ...existing,
      ...allowedUpdates,
      agentId,
      id: existing.id,
      updatedAt: new Date(),
    };
    await repo.update(updated);
    const soul = await repo.getByAgentId(agentId);
    return apiResponse(c, soul);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── DELETE /:agentId — delete soul ──────────────────

soulRoutes.delete('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const deleted = await getSoulsRepository().delete(agentId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

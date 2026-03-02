/**
 * Soul Routes — CRUD + evolution + versioning
 */

import { Hono } from 'hono';
import { getSoulsRepository } from '../db/repositories/souls.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';

export const soulRoutes = new Hono();

// ── GET / — list all souls ──────────────────────────

soulRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();
    const [souls, total] = await Promise.all([repo.list(limit, offset), repo.count()]);
    return apiResponse(c, { items: souls, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

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

// ── POST / — create soul ────────────────────────────

soulRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    if (
      !body.agentId ||
      !body.identity ||
      !body.purpose ||
      !body.autonomy ||
      !body.heartbeat ||
      !body.evolution
    ) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message:
            'Missing required fields: agentId, identity, purpose, autonomy, heartbeat, evolution',
        },
        400
      );
    }
    const soul = await getSoulsRepository().create(body);
    return apiResponse(c, soul, 201);
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

    const body = await c.req.json();
    const updated = {
      ...existing,
      ...body,
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

// ── GET /:agentId/versions — version history ────────

soulRoutes.get('/:agentId/versions', async (c) => {
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

soulRoutes.get('/:agentId/versions/:v', async (c) => {
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

soulRoutes.post('/:agentId/feedback', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const body = await c.req.json();
    if (!body.type || !body.content) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing required fields: type, content' },
        400
      );
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Create version snapshot
    await repo.createVersion(soul, body.content, body.source || 'user');

    // Apply feedback inline (lightweight — no evolution engine dependency)
    const feedback = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: body.type,
      content: body.content,
      appliedToVersion: soul.evolution.version,
      source: body.source || 'user',
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
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

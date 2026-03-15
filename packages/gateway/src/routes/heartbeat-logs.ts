/**
 * Heartbeat Log Routes — audit trail API
 */

import { Hono } from 'hono';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
  getUserId,
} from './helpers.js';

export const heartbeatLogRoutes = new Hono();

// ── GET / — list heartbeat logs for authenticated user (paginated) ─────

heartbeatLogRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const { limit, offset } = getPaginationParams(c);
    const repo = getHeartbeatLogRepository();
    const [logs, total] = await Promise.all([
      repo.listByUser(userId, limit, offset),
      repo.countByUser(userId),
    ]);
    return apiResponse(c, { items: logs, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /agent/:id — logs for a specific agent (ownership verified) ──────

heartbeatLogRoutes.get('/agent/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.param('id');
    const repo = getHeartbeatLogRepository();

    // Verify agent belongs to the user
    const owned = await repo.isAgentOwnedByUser(agentId, userId);
    if (!owned) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
    }

    const { limit, offset } = getPaginationParams(c);
    const logs = await repo.listByAgent(agentId, limit, offset);
    return apiResponse(c, logs);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /stats — aggregate statistics (scoped to user) ───────────────

heartbeatLogRoutes.get('/stats', async (c) => {
  try {
    const userId = getUserId(c);
    const agentId = c.req.query('agentId');

    // If agentId provided, verify ownership
    if (agentId) {
      const repo = getHeartbeatLogRepository();
      const owned = await repo.isAgentOwnedByUser(agentId, userId);
      if (!owned) {
        return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Agent not found' }, 404);
      }
    }

    const stats = await getHeartbeatLogRepository().getStatsByUser(userId, agentId);
    return apiResponse(c, stats);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

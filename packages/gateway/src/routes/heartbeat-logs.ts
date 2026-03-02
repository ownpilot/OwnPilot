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
} from './helpers.js';

export const heartbeatLogRoutes = new Hono();

// ── GET / — list all heartbeat logs (paginated) ─────

heartbeatLogRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const repo = getHeartbeatLogRepository();
    const [logs, total] = await Promise.all([repo.list(limit, offset), repo.count()]);
    return apiResponse(c, { items: logs, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /agent/:id — logs for a specific agent ──────

heartbeatLogRoutes.get('/agent/:id', async (c) => {
  try {
    const agentId = c.req.param('id');
    const { limit, offset } = getPaginationParams(c);
    const logs = await getHeartbeatLogRepository().listByAgent(agentId, limit, offset);
    return apiResponse(c, logs);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /stats — aggregate statistics ───────────────

heartbeatLogRoutes.get('/stats', async (c) => {
  try {
    const agentId = c.req.query('agentId');
    const stats = await getHeartbeatLogRepository().getStats(agentId);
    return apiResponse(c, stats);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

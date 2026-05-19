/**
 * Pulse Engine Routes
 *
 * REST API for Pulse Engine observability — tracks both souls (heartbeat)
 * and claws (autonomous agents) in a unified monitoring layer.
 *
 * GET /claws          — per-claw circuit state and cycle metrics
 */

import { Hono } from 'hono';
import { getPulseMetricsService } from '../services/pulse-metrics-service.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

export const pulseRoutes = new Hono();

/** GET /api/v1/pulse/claws — Claw status from Pulse Engine metrics */
pulseRoutes.get('/claws', async (c) => {
  try {
    const service = getPulseMetricsService();
    const claws = service.getPulseClawStatus();
    return apiResponse(c, { items: claws, total: claws.length });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

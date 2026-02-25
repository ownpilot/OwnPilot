/**
 * Model Routing Routes
 *
 * REST API for per-process model routing configuration.
 * Mounted at /api/v1/model-routing
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js';
import {
  getAllRouting,
  getProcessRouting,
  resolveForProcess,
  setProcessRouting,
  clearProcessRouting,
  isValidProcess,
  VALID_PROCESSES,
  type RoutingProcess,
} from '../services/model-routing.js';

export const modelRoutingRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — List all process configs + resolved values
// ---------------------------------------------------------------------------

modelRoutingRoutes.get('/', async (c) => {
  const routing = getAllRouting();
  const resolved: Record<string, unknown> = {};

  for (const process of VALID_PROCESSES) {
    resolved[process] = await resolveForProcess(process);
  }

  return apiResponse(c, { routing, resolved });
});

// ---------------------------------------------------------------------------
// GET /:process — Get routing for a single process
// ---------------------------------------------------------------------------

modelRoutingRoutes.get('/:process', async (c) => {
  const process = c.req.param('process');
  if (!isValidProcess(process)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Invalid process: ${process}. Valid: ${VALID_PROCESSES.join(', ')}`,
      },
      400
    );
  }

  const routing = getProcessRouting(process);
  const resolved = await resolveForProcess(process);

  return apiResponse(c, { routing, resolved });
});

// ---------------------------------------------------------------------------
// PUT /:process — Update routing for a process
// ---------------------------------------------------------------------------

modelRoutingRoutes.put('/:process', async (c) => {
  const process = c.req.param('process');
  if (!isValidProcess(process)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Invalid process: ${process}. Valid: ${VALID_PROCESSES.join(', ')}`,
      },
      400
    );
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid request body' }, 400);
  }

  // Validate field types and lengths
  for (const field of ['provider', 'model', 'fallbackProvider', 'fallbackModel'] as const) {
    const val = body[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'string') {
        return apiError(
          c,
          { code: ERROR_CODES.INVALID_INPUT, message: `${field} must be a string` },
          400
        );
      }
      if (val.length > 128) {
        return apiError(
          c,
          { code: ERROR_CODES.INVALID_INPUT, message: `${field} too long (max 128 characters)` },
          400
        );
      }
    }
  }

  await setProcessRouting(process as RoutingProcess, body);

  const routing = getProcessRouting(process as RoutingProcess);
  const resolved = await resolveForProcess(process as RoutingProcess);

  return apiResponse(c, { routing, resolved });
});

// ---------------------------------------------------------------------------
// DELETE /:process — Clear routing for a process (revert to global default)
// ---------------------------------------------------------------------------

modelRoutingRoutes.delete('/:process', async (c) => {
  const process = c.req.param('process');
  if (!isValidProcess(process)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Invalid process: ${process}. Valid: ${VALID_PROCESSES.join(', ')}`,
      },
      400
    );
  }

  await clearProcessRouting(process as RoutingProcess);

  return apiResponse(c, { cleared: true });
});

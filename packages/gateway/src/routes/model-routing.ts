/**
 * Model Routing Routes
 *
 * REST API for per-process model routing configuration.
 * Mounted at /api/v1/model-routing
 */

import { Hono } from 'hono';
import { getChannelService } from '@ownpilot/core/channels';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import {
  getChannelScopedRouting,
  getAllRouting,
  getProcessRouting,
  resolveForProcess,
  resolveForChannel,
  setChannelScopedRouting,
  setProcessRouting,
  clearChannelScopedRouting,
  clearProcessRouting,
  isValidProcess,
  VALID_PROCESSES,
  type ChannelRoutingKind,
  type RoutingProcess,
} from '../services/llm/model-routing.js';

export const modelRoutingRoutes = new Hono();

function parseKind(value: string | undefined): ChannelRoutingKind {
  return value === 'media' ? 'media' : 'default';
}

async function parseValidatedBody(c: Parameters<typeof parseJsonBody>[0]) {
  const body = await parseJsonBody<Record<string, unknown>>(c);
  if (!body || typeof body !== 'object') {
    return {
      error: apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid request body' }, 400),
    };
  }

  for (const field of ['provider', 'model', 'fallbackProvider', 'fallbackModel'] as const) {
    const val = body[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'string') {
        return {
          error: apiError(
            c,
            { code: ERROR_CODES.INVALID_INPUT, message: `${field} must be a string` },
            400
          ),
        };
      }
      if (val.length > 128) {
        return {
          error: apiError(
            c,
            { code: ERROR_CODES.INVALID_INPUT, message: `${field} too long (max 128 characters)` },
            400
          ),
        };
      }
    }
  }

  return { body };
}

modelRoutingRoutes.get('/channels', async (c) => {
  const service = getChannelService();
  const channels = service.listChannels();

  const items = await Promise.all(
    channels.map(async (channel) => ({
      pluginId: channel.pluginId,
      platform: channel.platform,
      name: channel.name,
      status: channel.status,
      routing: getChannelScopedRouting(channel.pluginId),
      resolved: await resolveForChannel(channel.pluginId),
      mediaRouting: getChannelScopedRouting(channel.pluginId, 'media'),
      mediaResolved: await resolveForChannel(channel.pluginId, { hasMedia: true }),
    }))
  );

  return apiResponse(c, { channels: items });
});

modelRoutingRoutes.get('/channels/:pluginId', async (c) => {
  const pluginId = c.req.param('pluginId');
  const kind = parseKind(c.req.query('kind'));
  const routing = getChannelScopedRouting(pluginId, kind);
  const resolved = await resolveForChannel(pluginId, { hasMedia: kind === 'media' });
  return apiResponse(c, { routing, resolved, kind });
});

modelRoutingRoutes.put('/channels/:pluginId', async (c) => {
  const pluginId = c.req.param('pluginId');
  const kind = parseKind(c.req.query('kind'));
  const parsed = await parseValidatedBody(c);
  if ('error' in parsed) return parsed.error;

  await setChannelScopedRouting(pluginId, parsed.body, kind);
  const routing = getChannelScopedRouting(pluginId, kind);
  const resolved = await resolveForChannel(pluginId, { hasMedia: kind === 'media' });
  return apiResponse(c, { routing, resolved, kind });
});

modelRoutingRoutes.delete('/channels/:pluginId', async (c) => {
  const pluginId = c.req.param('pluginId');
  const kind = parseKind(c.req.query('kind'));
  await clearChannelScopedRouting(pluginId, kind);
  return apiResponse(c, { cleared: true, kind });
});

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

  const parsed = await parseValidatedBody(c);
  if ('error' in parsed) return parsed.error;

  await setProcessRouting(process as RoutingProcess, parsed.body);

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

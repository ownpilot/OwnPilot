/**
 * Tunnel Routes
 *
 * REST API for managing the Cloudflare tunnel.
 * All endpoints are protected by API key authentication.
 */

import { Hono, type Context } from 'hono';
import { getTunnelService } from '../services/tunnel-service.js';
import { apiError, apiResponse, ERROR_CODES, getErrorMessage } from './helpers.js';

const app = new Hono();

// cloudflared's --basic-auth expects user:password — disallow ':' so a stray
// colon can't split the password into a second username segment. Restrict to
// printable ASCII excluding space and ':' to keep the value safe to pass as a
// process argument and to avoid newline/control-char injection.
const PASSWORD_RE = /^[!-9;-~]{8,128}$/;

// FQDN-ish: lowercase letters, digits, dashes (not at segment boundaries),
// segments separated by dots, total length 1-253.
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

interface ConfigBody {
  password?: unknown;
  port?: unknown;
  hostname?: unknown;
}

function validatePassword(
  value: unknown
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, error: 'password must be a string' };
  if (!PASSWORD_RE.test(value)) {
    return {
      ok: false,
      error: 'password must be 8-128 printable ASCII chars (no spaces or ":")',
    };
  }
  return { ok: true, value };
}

function validatePort(
  value: unknown
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return { ok: false, error: 'port must be an integer in [1, 65535]' };
  }
  return { ok: true, value };
}

function validateHostname(
  value: unknown
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, error: 'hostname must be a string' };
  if (!HOSTNAME_RE.test(value)) {
    return { ok: false, error: 'hostname must be a valid FQDN' };
  }
  return { ok: true, value };
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = (await c.req.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * GET /api/v1/tunnel
 * Returns current tunnel status.
 */
app.get('/', (c) => {
  const service = getTunnelService();
  return apiResponse(c, service.getStatus());
});

/**
 * GET /api/v1/tunnel/url
 * Returns the tunnel URL if running.
 */
app.get('/url', (c) => {
  const service = getTunnelService();
  const url = service.getUrl();
  if (!url) {
    return apiError(c, { code: 'TUNNEL_NOT_RUNNING', message: 'Tunnel not running' }, 404);
  }
  return apiResponse(c, { url });
});

/**
 * POST /api/v1/tunnel/start
 * Starts the tunnel with optional password override.
 */
app.post('/start', async (c) => {
  const body = (await readJsonBody(c)) as { password?: unknown };
  const password = validatePassword(body.password);
  if (!password.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: password.error }, 400);
  }

  try {
    const service = getTunnelService();
    const status = await service.start(password.value);
    return apiResponse(c, { url: status.url, status: status.status });
  } catch (err) {
    return apiError(c, { code: 'TUNNEL_START_FAILED', message: getErrorMessage(err) }, 500);
  }
});

/**
 * POST /api/v1/tunnel/stop
 * Stops the tunnel.
 */
app.post('/stop', async (c) => {
  const service = getTunnelService();
  await service.stop();
  return apiResponse(c, { status: 'stopped' });
});

/**
 * PUT /api/v1/tunnel/config
 * Updates tunnel configuration for the next start.
 */
app.put('/config', async (c) => {
  const body = (await readJsonBody(c)) as ConfigBody;

  const password = validatePassword(body.password);
  if (!password.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: password.error }, 400);
  }
  const port = validatePort(body.port);
  if (!port.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: port.error }, 400);
  }
  const hostname = validateHostname(body.hostname);
  if (!hostname.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: hostname.error }, 400);
  }

  const service = getTunnelService();
  service.configure({
    password: password.value,
    port: port.value,
    hostname: hostname.value,
  });

  return apiResponse(c, { status: 'configured' });
});

export { app as tunnelRoutes };

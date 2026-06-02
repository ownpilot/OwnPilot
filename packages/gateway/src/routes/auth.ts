/**
 * Auth routes — OAuth 2.0 device-code sign-in for LLM providers.
 *
 * Endpoints:
 *   POST   /auth/oauth/device/start    — kick off device-code flow
 *   POST   /auth/oauth/device/poll     — poll for completion
 *   POST   /auth/signout               — wipe stored credentials for a provider
 *   GET    /auth/providers             — list providers with auth state
 *   GET    /auth/config/:provider      — read stored OAuth app override
 *   PUT    /auth/config/:provider      — store OAuth app override
 *   DELETE /auth/config/:provider      — remove OAuth app override
 *
 * All endpoints accept JSON bodies and return the standard
 * `{ success, data | error }` envelope via {@link apiResponse}.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  startDeviceFlow,
  pollPendingDeviceFlow,
  signOutProvider,
  getProviderOAuthConfig,
} from '../services/auth/oauth-flow.js';
import {
  getResolvedAuth,
  getProviderOAuthOverride,
  setProviderOAuthOverride,
  deleteProviderOAuthOverride,
} from '../services/app-settings.js';
import { getAvailableProviders } from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  sanitizeProviderName,
  zodValidationError,
} from './helpers.js';
import { getLog } from '../services/log.js';
import { uiSessionMiddleware } from '../middleware/ui-session.js';
import { validateBody, ValidationError } from '../middleware/validation.js';

const log = getLog('AuthRoutes');
const app = new Hono();

// All provider-auth routes require an active UI session.
// Mounted at /api/v1/provider-auth via .route() in platform.ts;
// unlike app.use('/api/v1/*', ...) this does NOT inherit parent middleware.
app.use('*', uiSessionMiddleware);

const ProviderBody = z.object({ provider: z.string().min(1).max(64) });

/**
 * POST /auth/oauth/device/start
 * Body: { provider }
 * Returns: { userCode, verificationUri, verificationUriComplete?, expiresIn, interval }
 */
app.post('/oauth/device/start', async (c) => {
  let parsed: z.infer<typeof ProviderBody>;
  try {
    parsed = validateBody(ProviderBody, await c.req.json());
  } catch (err) {
    if (err instanceof ValidationError) return zodValidationError(c, err.issues);
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const provider = sanitizeProviderName(parsed.provider);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }

  try {
    const response = await startDeviceFlow(provider);
    // Don't leak the device_code to the client — only the gateway needs it
    // to poll. The user_code is what the human types into the browser.
    return apiResponse(c, {
      provider,
      userCode: response.userCode,
      verificationUri: response.verificationUri,
      verificationUriComplete: response.verificationUriComplete,
      expiresIn: response.expiresIn,
      interval: response.interval,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`startDeviceFlow failed for ${provider}: ${message}`);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message }, 400);
  }
});

/**
 * POST /auth/oauth/device/poll
 * Body: { provider }
 * Returns: { status: 'success' | 'pending' | 'expired' | 'denied' | 'error', intervalSec?, reason? }
 *
 * On success the `auth.method` is reported but the token value is never
 * returned to the client — the credential is stored gateway-side.
 */
app.post('/oauth/device/poll', async (c) => {
  let parsed: z.infer<typeof ProviderBody>;
  try {
    parsed = validateBody(ProviderBody, await c.req.json());
  } catch (err) {
    if (err instanceof ValidationError) return zodValidationError(c, err.issues);
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const provider = sanitizeProviderName(parsed.provider);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }

  const result = await pollPendingDeviceFlow(provider);
  if (result.status === 'success') {
    return apiResponse(c, {
      provider,
      status: 'success' as const,
      method: result.auth.method,
    });
  }
  if (result.status === 'pending') {
    return apiResponse(c, {
      provider,
      status: 'pending' as const,
      intervalSec: result.intervalSec,
    });
  }
  return apiResponse(c, {
    provider,
    status: result.status,
    reason: 'reason' in result ? result.reason : undefined,
  });
});

/**
 * POST /auth/signout
 * Body: { provider }
 * Removes the OAuth blob (and pending device flow) for the provider.
 * The legacy api_key:<provider> entry is NOT touched — that's a separate
 * surface (the existing settings UI).
 */
app.post('/signout', async (c) => {
  let parsed: z.infer<typeof ProviderBody>;
  try {
    parsed = validateBody(ProviderBody, await c.req.json());
  } catch (err) {
    if (err instanceof ValidationError) return zodValidationError(c, err.issues);
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const provider = sanitizeProviderName(parsed.provider);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }

  await signOutProvider(provider);
  return apiResponse(c, { provider, signedOut: true });
});

/**
 * GET /auth/providers
 * Lists every catalog provider with its supported auth methods and the
 * currently-stored auth method (if any). Token values are never included.
 */
app.get('/providers', async (c) => {
  const providers = getAvailableProviders();
  const out: Array<{
    provider: string;
    /** Provider has at least an OAuth shape in catalog or override. */
    oauthCapable: boolean;
    /** All three required fields (deviceCodeUrl/tokenUrl/clientId) are set
     *  — startDeviceFlow will succeed. When false but oauthCapable is true,
     *  the user must add the missing pieces via PUT /config/:provider. */
    oauthReady: boolean;
    storedMethod?: string;
    hasExpiry?: boolean;
    expiresAt?: number;
  }> = [];

  for (const provider of providers) {
    const oauth = await getProviderOAuthConfig(provider);
    const auth = await getResolvedAuth(provider);
    const oauthReady = !!oauth && !!oauth.deviceCodeUrl && !!oauth.tokenUrl && !!oauth.clientId;
    out.push({
      provider,
      oauthCapable: !!oauth,
      oauthReady,
      ...(auth ? { storedMethod: auth.method } : {}),
      ...(auth && 'expiresAt' in auth && auth.expiresAt !== undefined
        ? { hasExpiry: true, expiresAt: auth.expiresAt }
        : {}),
    });
  }

  return apiResponse(c, { providers: out });
});

const ConfigBody = z.object({
  deviceCodeUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  clientId: z.string().min(1).max(512).optional(),
  scopes: z.array(z.string().min(1).max(128)).max(32).optional(),
});

function paramProvider(c: import('hono').Context): string | null {
  const raw = c.req.param('provider');
  return raw ? sanitizeProviderName(raw) : null;
}

/**
 * GET /auth/config/:provider
 * Returns the user-supplied OAuth override (or null if none).
 */
app.get('/config/:provider', async (c) => {
  const provider = paramProvider(c);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }
  const override = await getProviderOAuthOverride(provider);
  return apiResponse(c, { provider, override: override ?? null });
});

/**
 * PUT /auth/config/:provider
 * Stores an OAuth app override for this provider. Empty body is rejected
 * — to clear an override, use DELETE.
 */
app.put('/config/:provider', async (c) => {
  const provider = paramProvider(c);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }

  let parsed: z.infer<typeof ConfigBody>;
  try {
    parsed = validateBody(ConfigBody, await c.req.json());
  } catch (err) {
    if (err instanceof ValidationError) return zodValidationError(c, err.issues);
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const hasAnyField =
    parsed.deviceCodeUrl ||
    parsed.authorizationUrl ||
    parsed.tokenUrl ||
    parsed.clientId ||
    (parsed.scopes && parsed.scopes.length > 0);
  if (!hasAnyField) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: 'At least one field must be set — use DELETE to clear the override',
      },
      400
    );
  }

  await setProviderOAuthOverride(provider, parsed);
  log.info(`Stored OAuth override for provider=${provider}`);
  return apiResponse(c, { provider, override: parsed });
});

/**
 * DELETE /auth/config/:provider
 * Removes the OAuth override. Catalog defaults take over again.
 */
app.delete('/config/:provider', async (c) => {
  const provider = paramProvider(c);
  if (!provider) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid provider id' }, 400);
  }
  await deleteProviderOAuthOverride(provider);
  log.info(`Cleared OAuth override for provider=${provider}`);
  return apiResponse(c, { provider, cleared: true });
});

export default app;

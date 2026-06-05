/**
 * OAuth flow service — gateway-side orchestration for OAuth 2.0
 * device-code sign-in against LLM providers (Codex CLI, GitHub Models,
 * any provider that ships device-code in its catalog config).
 *
 * Responsibilities:
 *   - Read OAuth endpoints from the provider's static catalog config
 *     (`ProviderAuthSupport.oauth`).
 *   - Drive {@link startDeviceAuthorization} / {@link pollForToken} /
 *     {@link refreshAccessToken} from `@ownpilot/core`.
 *   - Persist the resulting {@link ResolvedAuth} via
 *     {@link setResolvedAuth} so the chat + autonomous runners can pick
 *     it up through the regular {@link getResolvedAuth} path.
 *   - Auto-refresh expired OAuth tokens via {@link resolveAuthForRequest}
 *     — wraps {@link getResolvedAuth} and transparently swaps in a fresh
 *     access token when the stored one is past its TTL.
 *
 * Track in-flight device flows in memory: the user has at most a few
 * minutes between starting the flow and the device_code expiring, and
 * persisting these to the DB would just add operational cost. If the
 * gateway restarts mid-flow the user re-starts — same UX as restarting
 * a CLI sign-in.
 */

import {
  startDeviceAuthorization,
  pollForToken,
  refreshAccessToken,
  isAuthExpired,
  getProviderConfig,
  type DeviceAuthorizationResponse,
  type ResolvedAuth,
  type ProviderOAuthConfig,
  type TokenResponse,
} from '@ownpilot/core';
import { getLog } from '../log.js';
import {
  getResolvedAuth,
  setResolvedAuth,
  deleteResolvedAuth,
  getProviderOAuthOverride,
} from '../app-settings.js';

const log = getLog('OAuthFlow');

/** State for an in-flight device-code authorization, kept in memory. */
interface PendingDeviceFlow {
  provider: string;
  deviceCode: string;
  expiresAtMs: number;
  intervalSec: number;
  clientId: string;
  tokenUrl: string;
}

const pendingDeviceFlows = new Map<string, PendingDeviceFlow>();

/**
 * Read OAuth config from the provider's catalog entry, with optional
 * user-supplied overrides layered on top. Returns null when neither
 * source produces a config that includes the three fields the device
 * flow actually needs (`deviceCodeUrl + tokenUrl + clientId`).
 *
 * The override path is what lets users register their own GitHub OAuth
 * app (or any other) without committing fabricated client IDs to the
 * static JSON catalog — see {@link getProviderOAuthOverride}.
 */
export async function getProviderOAuthConfig(
  provider: string
): Promise<ProviderOAuthConfig | null> {
  const override = await getProviderOAuthOverride(provider);
  const catalog = getProviderConfig(provider);
  const fromCatalog = catalog?.auth?.oauth;

  // Override fields win when set; unset/empty fall back to catalog.
  const merged: ProviderOAuthConfig = {
    deviceCodeUrl: override?.deviceCodeUrl ?? fromCatalog?.deviceCodeUrl,
    authorizationUrl: override?.authorizationUrl ?? fromCatalog?.authorizationUrl,
    tokenUrl: override?.tokenUrl ?? fromCatalog?.tokenUrl,
    clientId: override?.clientId ?? fromCatalog?.clientId,
    scopes: override?.scopes ?? fromCatalog?.scopes,
  };

  // Even with overrides, the provider must opt-in to OAuth somewhere —
  // either the catalog lists it in supported methods, or the override
  // alone supplies all three required endpoint fields (the implicit
  // "user knows what they're doing" path).
  const catalogOptsIn = catalog?.auth?.supported.some(
    (m) => m === 'oauth2_device_code' || m === 'oauth2_pkce'
  );
  const overrideStandsAlone =
    !!override?.deviceCodeUrl && !!override?.tokenUrl && !!override?.clientId;
  if (!catalogOptsIn && !overrideStandsAlone) return null;

  return merged;
}

/**
 * Begin a device-code flow for `provider`. Returns the user_code +
 * verification URI to show the human. The caller then polls
 * {@link pollPendingDeviceFlow} on a timer until success / failure.
 *
 * @throws when the provider isn't OAuth-capable or the device endpoint
 *   responds with an error.
 */
export async function startDeviceFlow(provider: string): Promise<DeviceAuthorizationResponse> {
  const oauth = await getProviderOAuthConfig(provider);
  if (!oauth?.deviceCodeUrl || !oauth.tokenUrl || !oauth.clientId) {
    throw new Error(
      `Provider "${provider}" is not configured for OAuth device-code flow ` +
        `(missing deviceCodeUrl / tokenUrl / clientId in provider config)`
    );
  }

  const response = await startDeviceAuthorization({
    deviceCodeUrl: oauth.deviceCodeUrl,
    clientId: oauth.clientId,
    scope: oauth.scopes?.join(' '),
  });

  pendingDeviceFlows.set(provider, {
    provider,
    deviceCode: response.deviceCode,
    expiresAtMs: Date.now() + response.expiresIn * 1000,
    intervalSec: response.interval,
    clientId: oauth.clientId,
    tokenUrl: oauth.tokenUrl,
  });

  log.info(`Started device-code flow for provider=${provider}`);
  return response;
}

type PollOutcome =
  | { status: 'success'; auth: ResolvedAuth }
  | { status: 'pending'; intervalSec: number }
  | { status: 'expired' }
  | { status: 'denied'; reason: string }
  | { status: 'error'; reason: string };

/**
 * Poll the token endpoint once on behalf of a pending device flow. On
 * success, persists the {@link ResolvedAuth} via {@link setResolvedAuth}
 * and drops the in-memory state. The caller is responsible for repeating
 * the call on the recommended interval — this function does not loop.
 */
export async function pollPendingDeviceFlow(provider: string): Promise<PollOutcome> {
  const pending = pendingDeviceFlows.get(provider);
  if (!pending) {
    return { status: 'error', reason: 'No pending device flow for provider' };
  }
  if (Date.now() > pending.expiresAtMs) {
    pendingDeviceFlows.delete(provider);
    return { status: 'expired' };
  }

  const result = await pollForToken({
    tokenUrl: pending.tokenUrl,
    clientId: pending.clientId,
    deviceCode: pending.deviceCode,
  });

  if (result.status === 'pending') {
    // RFC 8628 §3.5: slow_down means add 5 seconds to the polling interval.
    if (result.error === 'slow_down') {
      pending.intervalSec += 5;
    }
    return { status: 'pending', intervalSec: pending.intervalSec };
  }

  if (result.status === 'error') {
    pendingDeviceFlows.delete(provider);
    if (result.error === 'expired_token') return { status: 'expired' };
    if (result.error === 'access_denied') {
      return { status: 'denied', reason: result.description ?? 'User denied access' };
    }
    return { status: 'error', reason: result.description ?? result.error };
  }

  pendingDeviceFlows.delete(provider);
  const auth = tokenToResolvedAuth(result.token, 'oauth2_device_code');
  await setResolvedAuth(provider, auth);
  log.info(`Device-code flow completed for provider=${provider}`);
  return { status: 'success', auth };
}

/**
 * Read the current {@link ResolvedAuth} for a provider, auto-refreshing
 * if it's an OAuth token and the access token has expired (or is within
 * the 30s skew window honored by {@link isAuthExpired}).
 *
 * Falls back silently to the unrefreshed value if the refresh attempt
 * throws — providers sometimes have brief outages on their token
 * endpoint, and forcing a sign-out on every blip would be hostile.
 */
export async function resolveAuthForRequest(provider: string): Promise<ResolvedAuth | undefined> {
  const auth = await getResolvedAuth(provider);
  if (!auth) return undefined;

  if (auth.method !== 'oauth2_device_code' && auth.method !== 'oauth2_pkce') {
    return auth;
  }
  if (!isAuthExpired(auth)) return auth;
  if (!auth.refreshToken) {
    log.warn(`OAuth token for ${provider} expired and no refresh_token available`);
    return auth;
  }

  const oauth = await getProviderOAuthConfig(provider);
  if (!oauth?.tokenUrl || !oauth.clientId) {
    log.warn(`Cannot refresh ${provider}: OAuth config missing tokenUrl/clientId`);
    return auth;
  }

  try {
    const refreshed = await refreshAccessToken({
      tokenUrl: oauth.tokenUrl,
      clientId: oauth.clientId,
      refreshToken: auth.refreshToken,
    });
    const next: ResolvedAuth = {
      method: auth.method,
      value: refreshed.accessToken,
      // Providers MAY rotate the refresh token (RFC 6749 §10.4) — keep
      // the new one if returned, otherwise reuse the old one.
      refreshToken: refreshed.refreshToken ?? auth.refreshToken,
      ...(refreshed.expiresIn !== undefined
        ? { expiresAt: Date.now() + refreshed.expiresIn * 1000 }
        : {}),
      ...(auth.scopes ? { scopes: auth.scopes } : {}),
    };
    await setResolvedAuth(provider, next);
    log.info(`Refreshed OAuth token for provider=${provider}`);
    return next;
  } catch (err) {
    log.warn(
      `OAuth refresh failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`
    );
    return auth;
  }
}

/** Wipe both the OAuth blob and the legacy API-key entry for a provider. */
export async function signOutProvider(provider: string): Promise<void> {
  await deleteResolvedAuth(provider);
  pendingDeviceFlows.delete(provider);
  log.info(`Signed out provider=${provider}`);
}

/**
 * @internal — exported for tests to inspect / reset in-flight state.
 */
export function _clearPendingDeviceFlowsForTest(): void {
  pendingDeviceFlows.clear();
}

function tokenToResolvedAuth(
  token: TokenResponse,
  method: 'oauth2_device_code' | 'oauth2_pkce'
): ResolvedAuth {
  return {
    method,
    value: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    ...(token.expiresIn !== undefined ? { expiresAt: Date.now() + token.expiresIn * 1000 } : {}),
    ...(token.scope ? { scopes: token.scope.split(/\s+/) } : {}),
  };
}

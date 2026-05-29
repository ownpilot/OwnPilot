/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * This is the flow used by CLIs that can't easily spawn a browser — Codex,
 * GitHub CLI, gcloud, etc. The shape:
 *
 *   1. Client POSTs to the device-code endpoint, gets a `device_code`,
 *      `user_code`, and `verification_uri`.
 *   2. The user is shown the `user_code` and asked to visit the URI in
 *      a browser to authorize.
 *   3. Client polls the token endpoint with the `device_code` every
 *      `interval` seconds until the user authorizes (or denies).
 *   4. On success, the token endpoint returns an access token + optional
 *      refresh token + expiry.
 *
 * This module intentionally has zero gateway / DB / channel dependencies —
 * it's pure HTTP. The gateway layer wraps these helpers to persist the
 * resulting auth into the settings store via `setResolvedAuth`.
 *
 * Refresh: `refreshAccessToken` implements the RFC 6749 §6 refresh-token
 * grant for the same client. The gateway's resolver path calls it
 * transparently when {@link isAuthExpired} flags an OAuth token.
 */

/**
 * Successful response from the device-code endpoint (RFC 8628 §3.2).
 */
export interface DeviceAuthorizationResponse {
  /** Long-lived device identifier — used in polling. */
  deviceCode: string;
  /** Short code the user types into the verification page. */
  userCode: string;
  /** URI the user opens to authorize. */
  verificationUri: string;
  /** Optional "verification_uri_complete" — preferred when the provider
   *  encodes the user_code in the URL so the user doesn't have to type it. */
  verificationUriComplete?: string;
  /** Seconds until the device_code expires. */
  expiresIn: number;
  /** Recommended polling interval in seconds (default 5 per RFC). */
  interval: number;
}

/**
 * Successful token endpoint response (RFC 6749 §5.1 + RFC 8628 §3.5).
 */
export interface TokenResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
}

/**
 * RFC 8628 §3.5 polling errors. `authorization_pending` and `slow_down`
 * are normal during polling — the others are terminal.
 */
export type DeviceAuthError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | string; // forward-compat for provider-specific codes

/**
 * Either a successful token or a polling error. Polling errors with
 * `pending = true` mean "keep polling" — anything else is terminal.
 */
export type PollResult =
  | { status: 'success'; token: TokenResponse }
  | { status: 'pending'; error: DeviceAuthError }
  | { status: 'error'; error: DeviceAuthError; description?: string };

export interface StartDeviceAuthorizationOptions {
  /** Provider device-code endpoint (RFC 8628 §3.1). */
  deviceCodeUrl: string;
  /** OAuth client identifier issued by the provider. */
  clientId: string;
  /** Space-separated scopes (RFC 6749 §3.3). */
  scope?: string;
  /** Optional extra form params some providers require (e.g. `audience`). */
  extraParams?: Record<string, string>;
  /** Fetch impl — pass `globalThis.fetch` by default. Tests override this. */
  fetchImpl?: typeof fetch;
}

/**
 * Kick off the device-authorization flow.
 *
 * @throws if the endpoint returns non-2xx or the body doesn't look like a
 *   device-code response.
 */
export async function startDeviceAuthorization(
  opts: StartDeviceAuthorizationOptions
): Promise<DeviceAuthorizationResponse> {
  const body = new URLSearchParams({ client_id: opts.clientId });
  if (opts.scope) body.set('scope', opts.scope);
  if (opts.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) body.set(k, v);
  }

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const response = await fetchFn(opts.deviceCodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await safeText(response);
    throw new Error(
      `Device authorization request failed: ${response.status} ${response.statusText}: ${text}`
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const deviceCode = json.device_code;
  const userCode = json.user_code;
  const verificationUri = (json.verification_uri ?? json.verification_url) as string | undefined;

  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || !verificationUri) {
    throw new Error(
      `Malformed device-code response: missing one of device_code/user_code/verification_uri`
    );
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete:
      typeof json.verification_uri_complete === 'string'
        ? json.verification_uri_complete
        : undefined,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 900,
    interval: typeof json.interval === 'number' ? json.interval : 5,
  };
}

export interface PollForTokenOptions {
  tokenUrl: string;
  clientId: string;
  deviceCode: string;
  fetchImpl?: typeof fetch;
}

/**
 * Single poll attempt at the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
 *
 * Callers drive the polling loop themselves so they can respect the
 * `interval` from {@link DeviceAuthorizationResponse} and back off on
 * `slow_down` (RFC 8628 §3.5).
 */
export async function pollForToken(opts: PollForTokenOptions): Promise<PollResult> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: opts.deviceCode,
    client_id: opts.clientId,
  });

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const response = await fetchFn(opts.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  // RFC 8628 §3.5: pending/slow_down come back as 4xx with an error code.
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      status: 'error',
      error: 'invalid_response',
      description: `Token endpoint returned non-JSON (${response.status})`,
    };
  }

  if (response.ok && typeof json.access_token === 'string') {
    return { status: 'success', token: tokenFromJson(json) };
  }

  const errorCode = (json.error as string | undefined) ?? `http_${response.status}`;
  const description = json.error_description as string | undefined;

  if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
    return { status: 'pending', error: errorCode };
  }

  return { status: 'error', error: errorCode, description };
}

export interface RefreshAccessTokenOptions {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Refresh an OAuth access token using a refresh token (RFC 6749 §6).
 * Some providers issue a new refresh token; the returned shape includes
 * it when present so callers can persist the rotated value.
 */
export async function refreshAccessToken(opts: RefreshAccessTokenOptions): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const response = await fetchFn(opts.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await safeText(response);
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText}: ${text}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.access_token !== 'string') {
    throw new Error('Token refresh response missing access_token');
  }

  return tokenFromJson(json);
}

function tokenFromJson(json: Record<string, unknown>): TokenResponse {
  return {
    accessToken: json.access_token as string,
    tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}

/**
 * Gateway HTTP client shared by every CLI subcommand that talks to the
 * local OwnPilot gateway.
 *
 * Centralizes:
 *   - base URL resolution (`OWNPILOT_GATEWAY_URL` or `http://localhost:8080`)
 *   - `Authorization: Bearer <key>` header attachment from
 *     `OWNPILOT_API_KEY` or `OWNPILOT_JWT` env vars
 *   - gateway error envelope unwrapping
 *
 * Without the Authorization header, every CLI subcommand silently 401s
 * against an `--auth`-protected gateway, leaving the user confused about
 * why `ownpilot channel list` etc. fail with "HTTP 401" while
 * `ownpilot server` itself runs fine.
 */

export function getBaseUrl(): string {
  return process.env.OWNPILOT_GATEWAY_URL ?? 'http://localhost:8080';
}

/**
 * Build common headers for gateway calls. Attaches Authorization when an
 * API key or JWT is configured in the env. Caller-supplied `extra` headers
 * override built-ins (so a caller can set `Content-Type: application/octet-
 * stream` for binary uploads).
 */
export function gatewayHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.OWNPILOT_API_KEY;
  const jwt = process.env.OWNPILOT_JWT;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  else if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  if (extra) Object.assign(headers, extra);
  return headers;
}

/**
 * Issue a JSON request against `/api/v1${path}` and return the unwrapped
 * `data` field (or the raw body if the response isn't enveloped). Throws
 * with the gateway's error message on non-2xx.
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: gatewayHeaders(options?.headers as Record<string, string> | undefined),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Gateway returns { error: { code, message } } or { error: "string" }
    const errField = body.error;
    const msg =
      typeof errField === 'object' && errField !== null
        ? ((errField as Record<string, string>).message ?? JSON.stringify(errField))
        : ((errField as string) ?? (body.message as string) ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return (json.data ?? json) as T;
}

/**
 * Returns the "is the gateway running?" hint string for a fetch error, or
 * `null` if the error is unrelated. Callers decide whether to `console.error`
 * + `process.exit(1)` or re-throw.
 */
export function gatewayUnreachableMessage(error: unknown): string | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    return (
      '\nCould not reach gateway at ' +
      getBaseUrl() +
      '.\n' +
      'Make sure the server is running: ownpilot start\n'
    );
  }
  return null;
}

/**
 * Print a user-facing error for a failed gateway call and exit(1). Shows the
 * "is the gateway running?" hint for connection errors, otherwise the raw
 * error message.
 */
export function ensureGatewayError(error: unknown): never {
  const hint = gatewayUnreachableMessage(error);
  if (hint) {
    console.error(hint);
  } else {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\nError: ${msg}\n`);
  }
  process.exit(1);
}

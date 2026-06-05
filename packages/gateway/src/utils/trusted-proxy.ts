/**
 * Trusted-proxy aware request origin / URL helpers.
 *
 * `X-Forwarded-Proto` and `X-Forwarded-Host` are honored ONLY when a trusted
 * proxy is configured via `TRUSTED_PROXY=true` + `TRUSTED_PROXY_IPS`
 * (see utils/client-ip.ts). When the gateway is directly exposed, these
 * headers are attacker-controllable and must be ignored.
 *
 * Used by:
 *   - SMS (Twilio) webhook signature verification — webhook URL reconstruction
 *   - UI session CSRF check — canonical request origin comparison
 *   - UI session cookie Secure flag — protocol detection
 */

import { isProxyAwareConfigured } from './client-ip.js';

interface RequestLike {
  url: string;
  header: (name: string) => string | undefined;
}

/**
 * Resolve the canonical external request origin (scheme + host[:port]).
 *
 * When a trusted proxy is configured, honors `X-Forwarded-Proto` /
 * `X-Forwarded-Host`. Otherwise falls back to the URL the request was
 * received on.
 */
export function getRequestOrigin(req: RequestLike): string {
  const url = new URL(req.url);
  if (isProxyAwareConfigured()) {
    const forwardedProto = req.header('X-Forwarded-Proto');
    const forwardedHost = req.header('X-Forwarded-Host');
    if (forwardedProto && forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }
  return url.origin;
}

/**
 * Reconstruct the full external URL for a request (origin + path).
 *
 * Used by webhook signature verification where the external URL is part of
 * the signed payload (e.g., Twilio).
 */
export function getRequestUrl(req: RequestLike, path: string): string {
  return `${getRequestOrigin(req)}${path}`;
}

/**
 * Determine whether the request was received over HTTPS, taking into account
 * a trusted reverse proxy that may be terminating TLS.
 */
export function isSecureRequest(req: RequestLike): boolean {
  if (req.url.startsWith('https://')) return true;
  if (isProxyAwareConfigured() && req.header('X-Forwarded-Proto') === 'https') {
    return true;
  }
  return false;
}

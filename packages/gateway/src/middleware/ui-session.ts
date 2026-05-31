/**
 * UI Session Middleware
 *
 * Validates HttpOnly UI session cookie for web UI requests.
 * MCP serve may additionally use X-Session-Token for short-lived CLI MCP sessions.
 * Runs BEFORE API auth middleware so that UI sessions bypass api-key/jwt checks.
 *
 * Logic:
 * 1. Auth-own paths (/auth/*) set sessionAuthenticated=true so API auth is skipped
 * 2. Valid cookie session sets sessionAuthenticated=true, proceed
 * 3. Cookie-authenticated unsafe methods require a trusted Origin/Referer
 * 4. UI password configured AND no session AND no Authorization/X-API-Key returns 401
 * 5. Otherwise pass through (let API auth handle it)
 */

import { createMiddleware } from 'hono/factory';
import { validateSession, isPasswordConfigured } from '../services/ui-session.js';
import { apiError, ERROR_CODES } from '../routes/helpers.js';
import { getUiSessionAuth } from '../utils/ui-session-cookie.js';
import { getRequestOrigin } from '../utils/trusted-proxy.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// H-S8: requestOrigin only honors X-Forwarded-* when TRUSTED_PROXY is set.
// Otherwise an attacker could spoof those headers to make their origin match
// our canonical origin and bypass the CSRF same-origin check.
function requestOrigin(c: {
  req: { url: string; header: (name: string) => string | undefined };
}): string {
  return getRequestOrigin(c.req);
}

function configuredOrigins(): Set<string> {
  return new Set(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .filter((o) => o !== '*') // CORS-001: strip wildcard element
  );
}

function isTrustedBrowserOrigin(c: {
  req: { url: string; header: (name: string) => string | undefined };
}): boolean {
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');
  let candidate = origin;
  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      return false;
    }
  }
  if (!candidate) return false;

  return candidate === requestOrigin(c) || configuredOrigins().has(candidate);
}

function shouldEnforceCsrf(method: string, source: string): boolean {
  return source === 'cookie' && !SAFE_METHODS.has(method.toUpperCase());
}

export const uiSessionMiddleware = createMiddleware(async (c, next) => {
  const fullPath = c.req.path;
  const relativePath = fullPath.replace(/^\/api\/v1/, '');
  const allowMcpSessionHeader = relativePath.startsWith('/mcp/serve');
  const sessionAuth = getUiSessionAuth(c, { allowHeader: allowMcpSessionHeader });

  if (relativePath.startsWith('/auth/')) {
    if (shouldEnforceCsrf(c.req.method, sessionAuth.source) && !isTrustedBrowserOrigin(c)) {
      return apiError(
        c,
        { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid request origin' },
        403
      );
    }
    c.set('sessionAuthenticated', true);
    c.set('userId', 'default');
    return next();
  }

  const token = sessionAuth.token;
  if (token && (await validateSession(token))) {
    if (shouldEnforceCsrf(c.req.method, sessionAuth.source) && !isTrustedBrowserOrigin(c)) {
      return apiError(
        c,
        { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid request origin' },
        403
      );
    }
    c.set('sessionAuthenticated', true);
    c.set('userId', 'default');
    return next();
  }

  if (isPasswordConfigured()) {
    const hasAuthHeader = c.req.header('Authorization');
    const hasApiKey = c.req.header('X-API-Key');

    if (!hasAuthHeader && !hasApiKey) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    // Password configured + Authorization/X-API-Key present: let the API auth
    // middleware validate the credential.
    return next();
  }

  // No UI password configured — this is an open single-user deployment, so the
  // local owner is implicitly authenticated. Mark the request as the 'default'
  // owner so downstream route guards (e.g. claws IDOR-017) don't mistake the
  // legitimate owner for an anonymous caller and 401 them, which would bounce
  // the web UI back to the login screen even though no password exists.
  c.set('sessionAuthenticated', true);
  c.set('userId', 'default');
  return next();
});

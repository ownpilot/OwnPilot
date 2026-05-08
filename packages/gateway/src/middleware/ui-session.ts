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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(c: {
  req: { url: string; header: (name: string) => string | undefined };
}): string {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('X-Forwarded-Proto');
  const forwardedHost = c.req.header('X-Forwarded-Host');
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return url.origin;
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
  }

  return next();
});

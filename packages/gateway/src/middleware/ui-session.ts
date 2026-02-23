/**
 * UI Session Middleware
 *
 * Validates X-Session-Token for web UI requests.
 * Runs BEFORE API auth middleware so that UI sessions bypass api-key/jwt checks.
 *
 * Logic:
 * 1. Auth-own paths (/auth/*) → set sessionAuthenticated=true so API auth is skipped
 * 2. Valid session token → set sessionAuthenticated=true, proceed
 * 3. UI password configured AND no session AND no Authorization/X-API-Key → 401
 * 4. Otherwise → pass through (let API auth handle it)
 */

import { createMiddleware } from 'hono/factory';
import { validateSession, isPasswordConfigured } from '../services/ui-session.js';
import { apiError, ERROR_CODES } from '../routes/helpers.js';

export const uiSessionMiddleware = createMiddleware(async (c, next) => {
  // Extract the path relative to /api/v1
  const fullPath = c.req.path;
  const relativePath = fullPath.replace(/^\/api\/v1/, '');

  // 1. Auth-own paths — these handle their own authentication internally.
  //    Set sessionAuthenticated so the API auth middleware (api-key/jwt) is skipped.
  if (relativePath.startsWith('/auth/')) {
    c.set('sessionAuthenticated', true);
    c.set('userId', 'default');
    return next();
  }

  // 2. Check for session token
  const token = c.req.header('X-Session-Token');
  if (token && validateSession(token)) {
    c.set('sessionAuthenticated', true);
    c.set('userId', 'default');
    return next();
  }

  // 3. If UI password is configured and there's no API auth header, reject
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

  // 4. No password configured or has API auth headers — let API auth handle it
  return next();
});

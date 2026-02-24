/**
 * UI Authentication Routes
 *
 * Password-based authentication for the web dashboard.
 * Endpoints: status, login, logout, password set/change/remove.
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  invalidateSession,
  invalidateAllSessions,
  isPasswordConfigured,
  getPasswordHash,
  setPasswordHash,
  removePassword,
  validateSession,
  getActiveSessionCount,
} from '../services/ui-session.js';

const MIN_PASSWORD_LENGTH = 8;

export const uiAuthRoutes = new Hono();

/**
 * GET /auth/status — Public
 * Returns whether a password is configured and whether the current request is authenticated.
 */
uiAuthRoutes.get('/status', (c) => {
  const passwordConfigured = isPasswordConfigured();

  // Check if the request has a valid session token
  const token = c.req.header('X-Session-Token');
  const authenticated = token ? validateSession(token) : false;

  return apiResponse(c, {
    passwordConfigured,
    authenticated,
  });
});

/**
 * POST /auth/login — Public
 * Authenticate with password, receive a session token.
 */
uiAuthRoutes.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const { password } = body;

  if (!password || typeof password !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Password is required' }, 400);
  }

  const storedHash = getPasswordHash();
  if (!storedHash) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'No password configured' }, 400);
  }

  if (!verifyPassword(password, storedHash)) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid password' }, 403);
  }

  const session = createSession();
  return apiResponse(c, {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
  });
});

/**
 * POST /auth/logout — Requires session
 * Invalidate the current session.
 */
uiAuthRoutes.post('/logout', (c) => {
  const token = c.req.header('X-Session-Token');
  if (!token || !validateSession(token)) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Not authenticated' }, 401);
  }

  invalidateSession(token);
  return apiResponse(c, { message: 'Logged out' });
});

/**
 * POST /auth/password — Conditional auth
 * Set (first time) or change (requires current password) the UI password.
 */
uiAuthRoutes.post('/password', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    password?: string;
    currentPassword?: string;
  };
  const { password, currentPassword } = body;

  if (!password || typeof password !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Password is required' }, 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      },
      400
    );
  }

  const existingHash = getPasswordHash();

  if (existingHash) {
    // Changing password — require valid session + current password
    const token = c.req.header('X-Session-Token');
    if (!token || !validateSession(token)) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    if (!currentPassword || typeof currentPassword !== 'string') {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_INPUT,
          message: 'Current password is required to change password',
        },
        400
      );
    }

    if (!verifyPassword(currentPassword, existingHash)) {
      return apiError(
        c,
        { code: ERROR_CODES.ACCESS_DENIED, message: 'Current password is incorrect' },
        403
      );
    }
  }

  // Hash and store the new password
  const hash = hashPassword(password);
  await setPasswordHash(hash);

  // Invalidate all existing sessions
  invalidateAllSessions();

  // Create a fresh session for the user who just set/changed the password
  const session = createSession();

  return apiResponse(c, {
    message: existingHash ? 'Password changed' : 'Password set',
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
  });
});

/**
 * DELETE /auth/password — Requires session
 * Remove the UI password (disables UI authentication).
 */
uiAuthRoutes.delete('/password', async (c) => {
  const token = c.req.header('X-Session-Token');
  if (!token || !validateSession(token)) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }

  if (!isPasswordConfigured()) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'No password configured' }, 400);
  }

  await removePassword();
  return apiResponse(c, { message: 'Password removed' });
});

/**
 * GET /auth/sessions — Requires session
 * Returns count of active sessions (for Security settings page).
 */
uiAuthRoutes.get('/sessions', (c) => {
  const token = c.req.header('X-Session-Token');
  if (!token || !validateSession(token)) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }

  return apiResponse(c, { activeSessions: getActiveSessionCount() });
});

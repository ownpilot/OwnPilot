/**
 * Composio API Routes
 *
 * Manage Composio app connections and OAuth flows.
 * Endpoints for listing available apps, managing connections,
 * and handling OAuth callbacks.
 */

import { Hono } from 'hono';
import { composioService } from '../services/composio-service.js';
import { getLog } from '../services/log.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getIntParam,
} from './helpers.js';

const log = getLog('ComposioRoutes');

export const composioRoutes = new Hono();

// =============================================================================
// Middleware — guard all routes if Composio not configured
// =============================================================================

composioRoutes.use('*', async (c, next) => {
  // Allow status endpoint without API key
  if (c.req.path.endsWith('/status')) return next();

  if (!composioService.isConfigured()) {
    return apiError(
      c,
      {
        code: ERROR_CODES.BAD_REQUEST,
        message:
          'Composio API key not configured. Set it in Config Center or COMPOSIO_API_KEY env var.',
      },
      400
    );
  }
  return next();
});

// =============================================================================
// GET /status — Service health check
// =============================================================================

composioRoutes.get('/status', (c) => {
  return apiResponse(c, {
    configured: composioService.isConfigured(),
    message: composioService.isConfigured()
      ? 'Composio is configured and ready'
      : 'Composio API key not configured. Set it in Config Center → Composio.',
  });
});

// =============================================================================
// GET /apps — List available Composio apps (cached)
// =============================================================================

composioRoutes.get('/apps', async (c) => {
  try {
    const apps = await composioService.getAvailableApps();
    return apiResponse(c, { apps, count: apps.length });
  } catch (err) {
    log.error('Failed to list Composio apps:', err);
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err, 'Failed to list apps') },
      500
    );
  }
});

// =============================================================================
// GET /connections — List user's active connections
// =============================================================================

composioRoutes.get('/connections', async (c) => {
  try {
    const userId = getUserId(c);
    const connections = await composioService.getConnections(userId);
    return apiResponse(c, { connections, count: connections.length });
  } catch (err) {
    log.error('Failed to list connections:', err);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to list connections'),
      },
      500
    );
  }
});

// =============================================================================
// POST /connections — Initiate OAuth connection
// =============================================================================

composioRoutes.post('/connections', async (c) => {
  try {
    const body = await c.req.json<{ appName: string; redirectUrl?: string }>();
    const { appName, redirectUrl } = body;

    if (!appName) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing required field: appName' },
        400
      );
    }

    const userId = 'default';
    const result = await composioService.initiateConnection(userId, appName, redirectUrl);

    return apiResponse(c, {
      appName,
      redirectUrl: result.redirectUrl,
      connectionId: result.connectedAccountId,
      status: result.connectionStatus,
    });
  } catch (err) {
    log.error('Failed to initiate connection:', err);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to initiate connection'),
      },
      500
    );
  }
});

// =============================================================================
// GET /connections/:id — Single connection status
// =============================================================================

composioRoutes.get('/connections/:id', async (c) => {
  try {
    const connectionId = c.req.param('id');
    const connection = await composioService.waitForConnection(connectionId, 5);
    return apiResponse(c, connection);
  } catch (err) {
    log.error('Failed to get connection:', err);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to get connection status'),
      },
      500
    );
  }
});

// =============================================================================
// DELETE /connections/:id — Disconnect an app
// =============================================================================

composioRoutes.delete('/connections/:id', async (c) => {
  try {
    const connectionId = c.req.param('id');
    await composioService.disconnect(connectionId);
    return apiResponse(c, { disconnected: true, connectionId });
  } catch (err) {
    log.error('Failed to disconnect:', err);
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err, 'Failed to disconnect') },
      500
    );
  }
});

// =============================================================================
// POST /connections/:id/refresh — Refresh connection tokens
// =============================================================================

composioRoutes.post('/connections/:id/refresh', async (c) => {
  try {
    const connectionId = c.req.param('id');
    const connection = await composioService.refreshConnection(connectionId);
    return apiResponse(c, connection);
  } catch (err) {
    log.error('Failed to refresh connection:', err);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to refresh connection'),
      },
      500
    );
  }
});

// =============================================================================
// GET /callback — OAuth callback handler (redirects back to UI)
// =============================================================================

composioRoutes.get('/callback', (c) => {
  const status = c.req.query('status') ?? 'unknown';
  const appName = c.req.query('appName') ?? '';

  // Redirect back to UI Connected Apps page
  const uiPort = process.env.UI_PORT ?? '5173';
  const uiHost = process.env.UI_HOST ?? `http://localhost:${uiPort}`;
  const redirectUrl = `${uiHost}/settings/connected-apps?connected=${encodeURIComponent(appName)}&status=${encodeURIComponent(status)}`;

  return c.redirect(redirectUrl);
});

// =============================================================================
// GET /actions/search — Search Composio actions (for UI)
// =============================================================================

composioRoutes.get('/actions/search', async (c) => {
  try {
    const query = c.req.query('q') ?? '';
    const app = c.req.query('app');
    const limit = getIntParam(c, 'limit', 10, 1, 100);

    if (!query) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing required query parameter: q' },
        400
      );
    }

    const actions = await composioService.searchActions(query, app ?? undefined, limit);
    return apiResponse(c, { actions, count: actions.length });
  } catch (err) {
    log.error('Failed to search actions:', err);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to search actions'),
      },
      500
    );
  }
});

/**
 * Integrations API Routes
 *
 * Manage OAuth integrations (Gmail, Calendar, Drive, etc.)
 */

import { Hono } from 'hono';
import { oauthIntegrationsRepo, settingsRepo } from '../db/repositories/index.js';
import type { OAuthProvider, OAuthService } from '../db/repositories/oauth-integrations.js';

export const integrationsRoutes = new Hono();

// =============================================================================
// Types
// =============================================================================

interface AvailableIntegration {
  provider: OAuthProvider;
  service: OAuthService;
  name: string;
  description: string;
  icon: string;
  requiredConfig: string[];
  isConfigured: boolean;
}

// =============================================================================
// Available Integrations Definition
// =============================================================================

const AVAILABLE_INTEGRATIONS: Array<{
  provider: OAuthProvider;
  service: OAuthService;
  name: string;
  description: string;
  icon: string;
  requiredConfig: string[];
}> = [
  {
    provider: 'google',
    service: 'gmail',
    name: 'Gmail',
    description: 'Read, send, and manage emails via Gmail API',
    icon: 'mail',
    requiredConfig: ['google_oauth_client_id', 'google_oauth_client_secret'],
  },
  {
    provider: 'google',
    service: 'calendar',
    name: 'Google Calendar',
    description: 'View and manage calendar events',
    icon: 'calendar',
    requiredConfig: ['google_oauth_client_id', 'google_oauth_client_secret'],
  },
  {
    provider: 'google',
    service: 'drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive',
    icon: 'folder',
    requiredConfig: ['google_oauth_client_id', 'google_oauth_client_secret'],
  },
];

// =============================================================================
// Routes
// =============================================================================

/**
 * List available integrations
 */
integrationsRoutes.get('/available', async (c) => {
  const integrations: AvailableIntegration[] = await Promise.all(
    AVAILABLE_INTEGRATIONS.map(async (integration) => {
      // Check if required config exists
      const configChecks = await Promise.all(
        integration.requiredConfig.map(async (key) => {
          const value = await settingsRepo.get<string>(key);
          return value && value.length > 0;
        })
      );
      const isConfigured = configChecks.every(Boolean);

      return {
        ...integration,
        isConfigured,
      };
    })
  );

  return c.json({
    success: true,
    data: integrations,
  });
});

/**
 * List user's connected integrations
 */
integrationsRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') || 'default';

  const integrations = await oauthIntegrationsRepo.listByUser(userId);

  // Don't expose tokens, only metadata
  const safeIntegrations = integrations.map((integration) => ({
    id: integration.id,
    provider: integration.provider,
    service: integration.service,
    email: integration.email,
    status: integration.status,
    scopes: integration.scopes,
    lastSyncAt: integration.lastSyncAt,
    errorMessage: integration.errorMessage,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  }));

  return c.json({
    success: true,
    data: safeIntegrations,
  });
});

/**
 * Get integration details
 */
integrationsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const integration = await oauthIntegrationsRepo.getById(id);

  if (!integration) {
    return c.json({ success: false, error: 'Integration not found' }, 404);
  }

  // Don't expose tokens
  const safeIntegration = {
    id: integration.id,
    provider: integration.provider,
    service: integration.service,
    email: integration.email,
    status: integration.status,
    scopes: integration.scopes,
    lastSyncAt: integration.lastSyncAt,
    errorMessage: integration.errorMessage,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };

  return c.json({
    success: true,
    data: safeIntegration,
  });
});

/**
 * Check if a specific integration is connected
 */
integrationsRoutes.get('/status/:provider/:service', async (c) => {
  const provider = c.req.param('provider') as OAuthProvider;
  const service = c.req.param('service') as OAuthService;
  const userId = c.req.query('userId') || 'default';

  const isConnected = await oauthIntegrationsRepo.isConnected(userId, provider, service);
  const integration = await oauthIntegrationsRepo.getByUserProviderService(userId, provider, service);

  return c.json({
    success: true,
    data: {
      isConnected,
      status: integration?.status,
      email: integration?.email,
      lastSyncAt: integration?.lastSyncAt,
    },
  });
});

/**
 * Delete/disconnect an integration
 */
integrationsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const integration = await oauthIntegrationsRepo.getById(id);

  if (!integration) {
    return c.json({ success: false, error: 'Integration not found' }, 404);
  }

  // For Google integrations, try to revoke the token
  if (integration.provider === 'google') {
    const tokens = await oauthIntegrationsRepo.getTokens(id);
    if (tokens?.accessToken) {
      try {
        const { google } = await import('googleapis');
        const clientId = await settingsRepo.get<string>('google_oauth_client_id');
        const clientSecret = await settingsRepo.get<string>('google_oauth_client_secret');

        if (clientId && clientSecret) {
          const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
          await oauth2Client.revokeToken(tokens.accessToken);
        }
      } catch (error) {
        // Log but don't fail - token might already be revoked
        console.warn('Failed to revoke token:', error);
      }
    }
  }

  // Delete from database
  await oauthIntegrationsRepo.delete(id);

  return c.json({
    success: true,
    message: `${integration.service} disconnected successfully`,
  });
});

/**
 * Manually sync/refresh an integration
 */
integrationsRoutes.post('/:id/sync', async (c) => {
  const id = c.req.param('id');

  const integration = await oauthIntegrationsRepo.getById(id);

  if (!integration) {
    return c.json({ success: false, error: 'Integration not found' }, 404);
  }

  // Get tokens
  const tokens = await oauthIntegrationsRepo.getTokens(id);

  if (!tokens?.refreshToken) {
    await oauthIntegrationsRepo.updateStatus(id, 'expired', 'No refresh token available');
    return c.json({ success: false, error: 'No refresh token available' }, 400);
  }

  // Refresh token for Google integrations
  if (integration.provider === 'google') {
    try {
      const { google } = await import('googleapis');
      const clientId = await settingsRepo.get<string>('google_oauth_client_id');
      const clientSecret = await settingsRepo.get<string>('google_oauth_client_secret');

      if (!clientId || !clientSecret) {
        return c.json({ success: false, error: 'OAuth not configured' }, 400);
      }

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: tokens.refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('No access token received');
      }

      // Update tokens
      await oauthIntegrationsRepo.updateTokens(id, {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || tokens.refreshToken,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
      });

      return c.json({
        success: true,
        message: 'Integration synced successfully',
        expiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : undefined,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      await oauthIntegrationsRepo.updateStatus(id, 'error', errorMessage);
      return c.json({ success: false, error: errorMessage }, 500);
    }
  }

  return c.json({ success: false, error: 'Sync not supported for this provider' }, 400);
});

/**
 * Get integration health/status summary
 */
integrationsRoutes.get('/health/summary', async (c) => {
  const userId = c.req.query('userId') || 'default';
  const integrations = await oauthIntegrationsRepo.listByUser(userId);

  const summary = {
    total: integrations.length,
    active: integrations.filter((i) => i.status === 'active').length,
    expired: integrations.filter((i) => i.status === 'expired').length,
    error: integrations.filter((i) => i.status === 'error').length,
    revoked: integrations.filter((i) => i.status === 'revoked').length,
  };

  const details = integrations.map((i) => ({
    service: i.service,
    status: i.status,
    email: i.email,
  }));

  return c.json({
    success: true,
    data: {
      summary,
      integrations: details,
    },
  });
});

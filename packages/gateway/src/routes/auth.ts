/**
 * OAuth Authentication Routes
 *
 * Handles OAuth flows for external service integrations (Google, Microsoft, etc.)
 * All credentials are stored in Settings, not hardcoded in .env
 */

import { Hono } from 'hono';
import { google } from 'googleapis';
import { settingsRepo, oauthIntegrationsRepo } from '../db/repositories/index.js';
import type { OAuthProvider, OAuthService } from '../db/repositories/oauth-integrations.js';

export const authRoutes = new Hono();

// ============================================================================
// Types
// ============================================================================

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface OAuthState {
  provider: OAuthProvider;
  service: OAuthService;
  userId: string;
  returnUrl?: string;
  timestamp: number;
}

// ============================================================================
// Google OAuth Scopes
// ============================================================================

const GOOGLE_SCOPES: Record<string, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get Google OAuth configuration from settings
 */
function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = settingsRepo.get<string>('google_oauth_client_id');
  const clientSecret = settingsRepo.get<string>('google_oauth_client_secret');

  if (!clientId || !clientSecret) {
    return null;
  }

  // Determine redirect URI
  const port = process.env.PORT || '8080';
  const host = process.env.HOST || 'localhost';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const defaultRedirectUri = `${protocol}://${host}:${port}/api/v1/auth/google/callback`;

  const redirectUri = settingsRepo.get<string>('google_oauth_redirect_uri') || defaultRedirectUri;

  return { clientId, clientSecret, redirectUri };
}

/**
 * Store OAuth state for CSRF protection
 */
function storeOAuthState(state: OAuthState): string {
  const stateToken = Buffer.from(JSON.stringify(state)).toString('base64url');
  settingsRepo.set(`oauth_state:${stateToken}`, {
    ...state,
    createdAt: new Date().toISOString(),
  });
  return stateToken;
}

/**
 * Retrieve and validate OAuth state
 */
function retrieveOAuthState(stateToken: string): OAuthState | null {
  const key = `oauth_state:${stateToken}`;
  const state = settingsRepo.get<OAuthState & { createdAt: string }>(key);

  if (!state) {
    return null;
  }

  // Delete the state (one-time use)
  settingsRepo.delete(key);

  // Check if state is expired (10 minutes)
  const createdAt = new Date(state.createdAt);
  const now = new Date();
  if (now.getTime() - createdAt.getTime() > 10 * 60 * 1000) {
    return null;
  }

  return state;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Check OAuth configuration status
 */
authRoutes.get('/status', (c) => {
  const googleConfig = getGoogleOAuthConfig();

  return c.json({
    success: true,
    data: {
      google: {
        configured: !!googleConfig,
        redirectUri: googleConfig?.redirectUri,
      },
    },
  });
});

/**
 * Save OAuth configuration (from Settings UI)
 */
authRoutes.post('/config/google', async (c) => {
  try {
    const body = await c.req.json<{
      clientId: string;
      clientSecret: string;
      redirectUri?: string;
    }>();

    if (!body.clientId || !body.clientSecret) {
      return c.json({ success: false, error: 'Client ID and Client Secret are required' }, 400);
    }

    settingsRepo.set('google_oauth_client_id', body.clientId);
    settingsRepo.set('google_oauth_client_secret', body.clientSecret);

    if (body.redirectUri) {
      settingsRepo.set('google_oauth_redirect_uri', body.redirectUri);
    }

    return c.json({
      success: true,
      message: 'Google OAuth configuration saved',
    });
  } catch (error) {
    console.error('Failed to save Google OAuth config:', error);
    return c.json({ success: false, error: 'Failed to save configuration' }, 500);
  }
});

/**
 * Delete OAuth configuration
 */
authRoutes.delete('/config/google', (c) => {
  settingsRepo.delete('google_oauth_client_id');
  settingsRepo.delete('google_oauth_client_secret');
  settingsRepo.delete('google_oauth_redirect_uri');

  return c.json({
    success: true,
    message: 'Google OAuth configuration removed',
  });
});

/**
 * Start Google OAuth flow
 */
authRoutes.get('/google/start', (c) => {
  const service = (c.req.query('service') || 'gmail') as OAuthService;
  const returnUrl = c.req.query('returnUrl') || '/settings';
  const userId = c.req.query('userId') || 'default';

  // Validate service
  if (!['gmail', 'calendar', 'drive'].includes(service)) {
    return c.json({ success: false, error: `Invalid service: ${service}` }, 400);
  }

  // Get OAuth configuration
  const config = getGoogleOAuthConfig();
  if (!config) {
    return c.json(
      {
        success: false,
        error: 'Google OAuth not configured',
        hint: 'Configure Google OAuth in Settings > Integrations first',
      },
      400
    );
  }

  // Create OAuth client
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  // Generate state token
  const state: OAuthState = {
    provider: 'google',
    service,
    userId,
    returnUrl,
    timestamp: Date.now(),
  };
  const stateToken = storeOAuthState(state);

  // Generate authorization URL
  const scopes = GOOGLE_SCOPES[service] || GOOGLE_SCOPES.gmail;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: stateToken,
    prompt: 'consent', // Always show consent to ensure refresh token
    include_granted_scopes: true,
  });

  // Redirect to Google
  return c.redirect(authUrl);
});

/**
 * Google OAuth callback
 */
authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const stateToken = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error, errorDescription);
    const returnUrl = `/settings?oauth_error=${encodeURIComponent(error)}`;
    return c.redirect(returnUrl);
  }

  // Validate state
  if (!stateToken) {
    return c.redirect('/settings?oauth_error=missing_state');
  }

  const state = retrieveOAuthState(stateToken);
  if (!state) {
    return c.redirect('/settings?oauth_error=invalid_or_expired_state');
  }

  // Validate code
  if (!code) {
    return c.redirect(`${state.returnUrl || '/settings'}?oauth_error=missing_code`);
  }

  // Get OAuth configuration
  const config = getGoogleOAuthConfig();
  if (!config) {
    return c.redirect(`${state.returnUrl || '/settings'}?oauth_error=oauth_not_configured`);
  }

  try {
    // Create OAuth client
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('No access token received');
    }

    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    // Check if integration already exists
    const existing = oauthIntegrationsRepo.getByUserProviderService(
      state.userId,
      state.provider,
      state.service
    );

    if (existing) {
      // Update existing integration
      oauthIntegrationsRepo.updateTokens(existing.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      });
    } else {
      // Create new integration
      oauthIntegrationsRepo.create({
        userId: state.userId,
        provider: state.provider,
        service: state.service,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scopes: tokens.scope?.split(' ') || [],
        email: email || undefined,
      });
    }

    // Redirect back with success
    const returnUrl = state.returnUrl || '/settings';
    const separator = returnUrl.includes('?') ? '&' : '?';
    return c.redirect(`${returnUrl}${separator}oauth_success=${state.service}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const returnUrl = state.returnUrl || '/settings';
    return c.redirect(`${returnUrl}?oauth_error=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * Revoke Google OAuth (disconnect)
 */
authRoutes.post('/google/revoke', async (c) => {
  try {
    const body = await c.req.json<{ integrationId: string }>();
    const { integrationId } = body;

    if (!integrationId) {
      return c.json({ success: false, error: 'Integration ID required' }, 400);
    }

    // Get integration
    const integration = oauthIntegrationsRepo.getById(integrationId);
    if (!integration) {
      return c.json({ success: false, error: 'Integration not found' }, 404);
    }

    // Get tokens for revocation
    const tokens = oauthIntegrationsRepo.getTokens(integrationId);

    if (tokens?.accessToken) {
      // Try to revoke token with Google
      try {
        const config = getGoogleOAuthConfig();
        if (config) {
          const oauth2Client = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret,
            config.redirectUri
          );
          await oauth2Client.revokeToken(tokens.accessToken);
        }
      } catch (revokeError) {
        // Log but don't fail - token might already be revoked
        console.warn('Failed to revoke Google token:', revokeError);
      }
    }

    // Delete from database
    oauthIntegrationsRepo.delete(integrationId);

    return c.json({
      success: true,
      message: `${integration.service} disconnected successfully`,
    });
  } catch (error) {
    console.error('Failed to revoke OAuth:', error);
    return c.json({ success: false, error: 'Failed to disconnect' }, 500);
  }
});

/**
 * Refresh token endpoint (called internally when token expires)
 */
authRoutes.post('/google/refresh', async (c) => {
  try {
    const body = await c.req.json<{ integrationId: string }>();
    const { integrationId } = body;

    if (!integrationId) {
      return c.json({ success: false, error: 'Integration ID required' }, 400);
    }

    // Get integration
    const integration = oauthIntegrationsRepo.getById(integrationId);
    if (!integration) {
      return c.json({ success: false, error: 'Integration not found' }, 404);
    }

    // Get tokens
    const tokens = oauthIntegrationsRepo.getTokens(integrationId);
    if (!tokens?.refreshToken) {
      oauthIntegrationsRepo.updateStatus(integrationId, 'expired', 'No refresh token available');
      return c.json({ success: false, error: 'No refresh token available' }, 400);
    }

    // Get OAuth configuration
    const config = getGoogleOAuthConfig();
    if (!config) {
      return c.json({ success: false, error: 'OAuth not configured' }, 400);
    }

    // Create OAuth client and refresh
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('No access token received');
    }

    // Update tokens in database
    oauthIntegrationsRepo.updateTokens(integrationId, {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || tokens.refreshToken,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
    });

    return c.json({
      success: true,
      message: 'Token refreshed successfully',
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : undefined,
    });
  } catch (error) {
    console.error('Failed to refresh token:', error);

    // Mark integration as expired if refresh fails
    const body = await c.req.json<{ integrationId: string }>().catch(() => ({ integrationId: '' }));
    if (body.integrationId) {
      oauthIntegrationsRepo.updateStatus(
        body.integrationId,
        'expired',
        error instanceof Error ? error.message : 'Token refresh failed'
      );
    }

    return c.json({ success: false, error: 'Failed to refresh token' }, 500);
  }
});

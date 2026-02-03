/**
 * OAuth Authentication Routes Tests
 *
 * Test suite for Google OAuth integration and configuration.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from './auth.js';

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(),
    },
    oauth2: vi.fn(),
  },
}));

// Mock repositories
vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  oauthIntegrationsRepo: {
    getById: vi.fn(),
    getByUserProviderService: vi.fn(),
    create: vi.fn(),
    updateTokens: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    getTokens: vi.fn(),
  },
}));

import { google } from 'googleapis';
import { settingsRepo, oauthIntegrationsRepo } from '../db/repositories/index.js';
import type { OAuthIntegration } from '../db/repositories/index.js';

interface MockOAuth2Client {
  generateAuthUrl: ReturnType<typeof vi.fn>;
  getToken: ReturnType<typeof vi.fn>;
  setCredentials: ReturnType<typeof vi.fn>;
  refreshAccessToken: ReturnType<typeof vi.fn>;
  revokeToken: ReturnType<typeof vi.fn>;
}

describe('Auth Routes', () => {
  let app: Hono;
  let mockOAuth2Client: MockOAuth2Client;

  beforeEach(() => {
    app = new Hono();
    app.route('/auth', authRoutes);

    // Clear all mocks first
    vi.clearAllMocks();

    // Reset settingsRepo methods to return undefined by default
    vi.mocked(settingsRepo.get).mockReturnValue(undefined);
    vi.mocked(settingsRepo.set).mockResolvedValue(undefined);
    vi.mocked(settingsRepo.delete).mockResolvedValue(undefined);

    // Reset oauthIntegrationsRepo methods
    vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue(null);
    vi.mocked(oauthIntegrationsRepo.getByUserProviderService).mockResolvedValue(null);
    vi.mocked(oauthIntegrationsRepo.create).mockResolvedValue({} as unknown as OAuthIntegration);
    vi.mocked(oauthIntegrationsRepo.updateTokens).mockResolvedValue(undefined);
    vi.mocked(oauthIntegrationsRepo.updateStatus).mockResolvedValue(undefined);
    vi.mocked(oauthIntegrationsRepo.delete).mockResolvedValue(undefined);
    vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue(null);

    // Create mock OAuth2 client
    mockOAuth2Client = {
      generateAuthUrl: vi.fn(),
      getToken: vi.fn(),
      setCredentials: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeToken: vi.fn(),
    };

    vi.mocked(google.auth.OAuth2).mockReturnValue(mockOAuth2Client as unknown as InstanceType<typeof google.auth.OAuth2>);
    vi.mocked(google.oauth2).mockReturnValue({
      userinfo: {
        get: vi.fn(),
      },
    } as unknown as ReturnType<typeof google.oauth2>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /auth/status - Check OAuth configuration', () => {
    it('should return configured status when credentials exist', async () => {
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-client-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        return undefined;
      });

      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.data.google.configured).toBe(true);
      expect(data.data.data.google.redirectUri).toBeDefined();
    });

    it('should return not configured when credentials missing', async () => {
      vi.mocked(settingsRepo.get).mockReturnValue(undefined);

      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.data.google.configured).toBe(false);
    });

    it('should use custom redirect URI when configured', async () => {
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        if (key === 'google_oauth_redirect_uri') return 'https://custom.com/callback';
        return undefined;
      });

      const res = await app.request('/auth/status');

      const data = await res.json();
      expect(data.data.data.google.redirectUri).toBe('https://custom.com/callback');
    });
  });

  describe('POST /auth/config/google - Save OAuth configuration', () => {
    it('should save complete OAuth configuration', async () => {
      const res = await app.request('/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'new-client-id',
          clientSecret: 'new-secret',
          redirectUri: 'https://example.com/callback',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('saved');
      expect(settingsRepo.set).toHaveBeenCalledWith('google_oauth_client_id', 'new-client-id');
      expect(settingsRepo.set).toHaveBeenCalledWith('google_oauth_client_secret', 'new-secret');
      expect(settingsRepo.set).toHaveBeenCalledWith('google_oauth_redirect_uri', 'https://example.com/callback');
    });

    it('should save without redirect URI', async () => {
      const res = await app.request('/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-id',
          clientSecret: 'test-secret',
        }),
      });

      expect(res.status).toBe(200);
      expect(settingsRepo.set).toHaveBeenCalledTimes(2);
      expect(settingsRepo.set).not.toHaveBeenCalledWith('google_oauth_redirect_uri', expect.anything());
    });

    it('should return 400 when clientId missing', async () => {
      const res = await app.request('/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSecret: 'test-secret',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Client ID');
    });

    it('should return 400 when clientSecret missing', async () => {
      const res = await app.request('/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-id',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Client Secret');
    });

    it('should handle save error', async () => {
      vi.mocked(settingsRepo.set).mockRejectedValue(new Error('Database error'));

      const res = await app.request('/auth/config/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-id',
          clientSecret: 'test-secret',
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  describe('DELETE /auth/config/google - Delete OAuth configuration', () => {
    it('should delete all OAuth settings', async () => {
      const res = await app.request('/auth/config/google', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('removed');
      expect(settingsRepo.delete).toHaveBeenCalledWith('google_oauth_client_id');
      expect(settingsRepo.delete).toHaveBeenCalledWith('google_oauth_client_secret');
      expect(settingsRepo.delete).toHaveBeenCalledWith('google_oauth_redirect_uri');
    });
  });

  describe('GET /auth/google/start - Start OAuth flow', () => {
    beforeEach(() => {
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-client-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        return undefined;
      });
    });

    it('should redirect to Google OAuth with default service', async () => {
      mockOAuth2Client.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth');

      const res = await app.request('/auth/google/start');

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://accounts.google.com/oauth');
      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          prompt: 'consent',
        })
      );
    });

    it('should use specified service', async () => {
      mockOAuth2Client.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth');

      const res = await app.request('/auth/google/start?service=calendar');

      expect(res.status).toBe(302);
      const call = vi.mocked(mockOAuth2Client.generateAuthUrl).mock.calls[0][0];
      expect(call.scope).toEqual(expect.arrayContaining(['https://www.googleapis.com/auth/calendar']));
    });

    it('should return 400 for invalid service', async () => {
      const res = await app.request('/auth/google/start?service=invalid');

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Invalid service');
    });

    it('should return 400 when OAuth not configured', async () => {
      vi.mocked(settingsRepo.get).mockReturnValue(undefined);

      const res = await app.request('/auth/google/start');

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      // Note: This endpoint uses inline c.json() instead of apiError helper
      expect(data.error).toContain('not configured');
    });

    it('should include return URL in state', async () => {
      mockOAuth2Client.generateAuthUrl.mockImplementation((options: Record<string, unknown>) => {
        expect(options.state).toBeDefined();
        return 'https://accounts.google.com/oauth';
      });

      await app.request('/auth/google/start?returnUrl=/dashboard');

      expect(settingsRepo.set).toHaveBeenCalled();
      const stateKey = vi.mocked(settingsRepo.set).mock.calls[0][0] as string;
      expect(stateKey).toContain('oauth_state:');
    });
  });

  describe('POST /auth/google/revoke - Revoke OAuth', () => {
    it('should revoke integration successfully', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
        service: 'gmail',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        return undefined;
      });
      mockOAuth2Client.revokeToken.mockResolvedValue(undefined);

      const res = await app.request('/auth/google/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('disconnected');
      expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('access-token');
      expect(oauthIntegrationsRepo.delete).toHaveBeenCalledWith('int-123');
    });

    it('should return 400 when integration ID missing', async () => {
      const res = await app.request('/auth/google/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('required');
    });

    it('should return 404 when integration not found', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/auth/google/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-nonexistent' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('not found');
    });

    it('should delete integration even if revoke fails', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
        service: 'gmail',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        accessToken: 'token',
      });
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        return undefined;
      });
      mockOAuth2Client.revokeToken.mockRejectedValue(new Error('Revoke failed'));

      const res = await app.request('/auth/google/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(200);
      expect(oauthIntegrationsRepo.delete).toHaveBeenCalledWith('int-123');
    });

    it('should handle revoke error', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockRejectedValue(new Error('Database error'));

      const res = await app.request('/auth/google/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  describe('POST /auth/google/refresh - Refresh token', () => {
    beforeEach(() => {
      vi.mocked(settingsRepo.get).mockImplementation((key) => {
        if (key === 'google_oauth_client_id') return 'test-client-id';
        if (key === 'google_oauth_client_secret') return 'test-secret';
        return undefined;
      });
    });

    it('should refresh token successfully', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
      });
      mockOAuth2Client.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expiry_date: Date.now() + 3600000,
        },
      });

      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.message).toContain('refreshed');
      expect(oauthIntegrationsRepo.updateTokens).toHaveBeenCalledWith(
        'int-123',
        expect.objectContaining({
          accessToken: 'new-access-token',
        })
      );
    });

    it('should return 400 when integration ID missing', async () => {
      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('required');
    });

    it('should return 404 when integration not found', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue(null);

      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-nonexistent' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('not found');
    });

    it('should return 400 when no refresh token available', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        accessToken: 'token',
        refreshToken: undefined,
      });

      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('No refresh token');
      expect(oauthIntegrationsRepo.updateStatus).toHaveBeenCalledWith(
        'int-123',
        'expired',
        expect.any(String)
      );
    });

    it('should return 400 when OAuth not configured', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        refreshToken: 'refresh-token',
      });
      vi.mocked(settingsRepo.get).mockReturnValue(undefined);

      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('not configured');
    });

    it('should mark integration as expired on refresh failure', async () => {
      vi.mocked(oauthIntegrationsRepo.getById).mockResolvedValue({
        id: 'int-123',
      } as unknown as OAuthIntegration);
      vi.mocked(oauthIntegrationsRepo.getTokens).mockResolvedValue({
        refreshToken: 'refresh-token',
      });
      mockOAuth2Client.refreshAccessToken.mockRejectedValue(new Error('Refresh failed'));

      const res = await app.request('/auth/google/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 'int-123' }),
      });

      expect(res.status).toBe(500);
      expect(oauthIntegrationsRepo.updateStatus).toHaveBeenCalledWith(
        'int-123',
        'expired',
        expect.stringContaining('failed')
      );
    });
  });
});

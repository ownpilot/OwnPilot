/**
 * Integrations Routes Tests
 *
 * Integration tests for the OAuth integrations API endpoints.
 * Mocks oauthIntegrationsRepo and settingsRepo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleIntegration = {
  id: 'int_001',
  userId: 'default',
  provider: 'google' as const,
  service: 'gmail' as const,
  email: 'user@gmail.com',
  status: 'active' as const,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  accessToken: 'secret-access-token',
  refreshToken: 'secret-refresh-token',
  lastSyncAt: '2026-01-30T10:00:00Z',
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-30T10:00:00Z',
};

const expiredIntegration = {
  ...sampleIntegration,
  id: 'int_002',
  service: 'calendar' as const,
  status: 'expired' as const,
};

const mockOauthIntegrationsRepo = {
  listByUser: vi.fn(async () => [sampleIntegration, expiredIntegration]),
  getById: vi.fn(async (id: string) =>
    id === 'int_001' ? sampleIntegration : id === 'int_002' ? expiredIntegration : null
  ),
  isConnected: vi.fn(async () => true),
  getByUserProviderService: vi.fn(async () => sampleIntegration),
  delete: vi.fn(async () => true),
  getTokens: vi.fn(async () => null),
  updateStatus: vi.fn(async () => undefined),
  updateTokens: vi.fn(async () => undefined),
};

const mockSettingsRepo = {
  get: vi.fn(async (key: string) => {
    if (key === 'google_oauth_client_id') return 'test-client-id';
    if (key === 'google_oauth_client_secret') return 'test-client-secret';
    return null;
  }),
};

vi.mock('../db/repositories/index.js', () => ({
  oauthIntegrationsRepo: mockOauthIntegrationsRepo,
  settingsRepo: mockSettingsRepo,
}));

// Import after mocks
const { integrationsRoutes } = await import('./integrations.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/integrations', integrationsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integrations Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOauthIntegrationsRepo.listByUser.mockResolvedValue([sampleIntegration, expiredIntegration]);
    mockOauthIntegrationsRepo.getById.mockImplementation(async (id: string) =>
      id === 'int_001' ? sampleIntegration : id === 'int_002' ? expiredIntegration : null
    );
    mockOauthIntegrationsRepo.isConnected.mockResolvedValue(true);
    mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue(sampleIntegration);
    mockOauthIntegrationsRepo.getTokens.mockResolvedValue(null);
    mockSettingsRepo.get.mockImplementation(async (key: string) => {
      if (key === 'google_oauth_client_id') return 'test-client-id';
      if (key === 'google_oauth_client_secret') return 'test-client-secret';
      return null;
    });
    app = createApp();
  });

  // ========================================================================
  // GET /integrations/available
  // ========================================================================

  describe('GET /integrations/available', () => {
    it('returns available integrations with config status', async () => {
      const res = await app.request('/integrations/available');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // 3 available integrations: gmail, calendar, drive
      expect(json.data).toHaveLength(3);
      expect(json.data[0].name).toBe('Gmail');
      expect(json.data[0].isConfigured).toBe(true);
    });

    it('shows unconfigured when credentials missing', async () => {
      mockSettingsRepo.get.mockResolvedValue(null);

      const res = await app.request('/integrations/available');
      const json = await res.json();

      expect(json.data.every((i: { isConfigured: boolean }) => !i.isConfigured)).toBe(true);
    });
  });

  // ========================================================================
  // GET /integrations
  // ========================================================================

  describe('GET /integrations', () => {
    it('returns user integrations without tokens', async () => {
      const res = await app.request('/integrations');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      // Tokens should NOT be exposed
      expect(json.data[0].accessToken).toBeUndefined();
      expect(json.data[0].refreshToken).toBeUndefined();
      // Metadata should be present
      expect(json.data[0].email).toBe('user@gmail.com');
      expect(json.data[0].status).toBe('active');
    });
  });

  // ========================================================================
  // GET /integrations/:id
  // ========================================================================

  describe('GET /integrations/:id', () => {
    it('returns integration details without tokens', async () => {
      const res = await app.request('/integrations/int_001');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('int_001');
      expect(json.data.service).toBe('gmail');
      expect(json.data.accessToken).toBeUndefined();
      expect(json.data.refreshToken).toBeUndefined();
    });

    it('returns 404 for unknown integration', async () => {
      const res = await app.request('/integrations/int_nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /integrations/status/:provider/:service
  // ========================================================================

  describe('GET /integrations/status/:provider/:service', () => {
    it('returns connection status', async () => {
      const res = await app.request('/integrations/status/google/gmail');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isConnected).toBe(true);
      expect(json.data.email).toBe('user@gmail.com');
    });

    it('shows disconnected when not connected', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValueOnce(false);
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValueOnce(null);

      const res = await app.request('/integrations/status/google/calendar');
      const json = await res.json();

      expect(json.data.isConnected).toBe(false);
    });
  });

  // ========================================================================
  // DELETE /integrations/:id
  // ========================================================================

  describe('DELETE /integrations/:id', () => {
    it('deletes an integration (no tokens to revoke)', async () => {
      const res = await app.request('/integrations/int_001', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toContain('disconnected');
      expect(mockOauthIntegrationsRepo.delete).toHaveBeenCalledWith('int_001');
    });

    it('returns 404 for unknown integration', async () => {
      const res = await app.request('/integrations/int_nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /integrations/:id/sync
  // ========================================================================

  describe('POST /integrations/:id/sync', () => {
    it('returns 404 for unknown integration', async () => {
      const res = await app.request('/integrations/int_nonexistent/sync', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 400 when no refresh token available', async () => {
      mockOauthIntegrationsRepo.getTokens.mockResolvedValueOnce({ accessToken: 'test', refreshToken: null });

      const res = await app.request('/integrations/int_001/sync', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('refresh token');
    });
  });

  // ========================================================================
  // GET /integrations/health/summary
  // ========================================================================

  describe('GET /integrations/health/summary', () => {
    it('returns health summary', async () => {
      const res = await app.request('/integrations/health/summary');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.summary.total).toBe(2);
      expect(json.data.summary.active).toBe(1);
      expect(json.data.summary.expired).toBe(1);
      expect(json.data.integrations).toHaveLength(2);
    });

    it('returns empty summary when no integrations', async () => {
      mockOauthIntegrationsRepo.listByUser.mockResolvedValueOnce([]);

      const res = await app.request('/integrations/health/summary');
      const json = await res.json();

      expect(json.data.summary.total).toBe(0);
      expect(json.data.integrations).toHaveLength(0);
    });
  });
});

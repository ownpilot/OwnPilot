/**
 * Composio Routes Tests
 *
 * Integration tests for the Composio API endpoints.
 * Mocks composioService to test OAuth flow and connection management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockComposioService = {
  isConfigured: vi.fn(() => true),
  getAvailableApps: vi.fn(),
  getConnections: vi.fn(),
  initiateConnection: vi.fn(),
  waitForConnection: vi.fn(),
  disconnect: vi.fn(),
  refreshConnection: vi.fn(),
  searchActions: vi.fn(),
};

vi.mock('../services/composio-service.js', () => ({
  composioService: mockComposioService,
}));

// Import after mocks
const { composioRoutes } = await import('./composio.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/composio', composioRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleApps = [
  { slug: 'github', name: 'GitHub', description: 'Git hosting' },
  { slug: 'gmail', name: 'Gmail', description: 'Email' },
];

const sampleConnections = [
  { id: 'c1', appName: 'github', status: 'ACTIVE', createdAt: '2026-01-01' },
  { id: 'c2', appName: 'gmail', status: 'EXPIRED', createdAt: '2026-01-01' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Composio Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockComposioService.isConfigured.mockReturnValue(true);
    app = createApp();
  });

  // ========================================================================
  // GET /status
  // ========================================================================

  describe('GET /composio/status', () => {
    it('returns configured: true when API key set', async () => {
      const res = await app.request('/composio/status');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { configured: boolean } };
      expect(body.data.configured).toBe(true);
    });

    it('returns configured: false when API key not set', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const res = await app.request('/composio/status');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { configured: boolean } };
      expect(body.data.configured).toBe(false);
    });
  });

  // ========================================================================
  // GET /apps
  // ========================================================================

  describe('GET /composio/apps', () => {
    it('returns list of available apps', async () => {
      mockComposioService.getAvailableApps.mockResolvedValue(sampleApps);

      const res = await app.request('/composio/apps');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { apps: unknown[]; count: number } };
      expect(body.data.apps).toHaveLength(2);
      expect(body.data.count).toBe(2);
    });

    it('returns 400 when not configured', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const res = await app.request('/composio/apps');
      expect(res.status).toBe(400);
    });

    it('returns 500 on SDK error', async () => {
      mockComposioService.getAvailableApps.mockRejectedValue(new Error('SDK error'));
      const res = await app.request('/composio/apps');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /connections
  // ========================================================================

  describe('GET /composio/connections', () => {
    it('returns user connections', async () => {
      mockComposioService.getConnections.mockResolvedValue(sampleConnections);

      const res = await app.request('/composio/connections');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { connections: unknown[]; count: number } };
      expect(body.data.connections).toHaveLength(2);
    });
  });

  // ========================================================================
  // POST /connections
  // ========================================================================

  describe('POST /composio/connections', () => {
    it('initiates OAuth connection', async () => {
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: 'https://composio.dev/auth/github',
        connectedAccountId: 'ca_123',
        connectionStatus: 'INITIATED',
      });

      const res = await app.request('/composio/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: 'github' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { redirectUrl: string; connectionId: string } };
      expect(body.data.redirectUrl).toBe('https://composio.dev/auth/github');
      expect(body.data.connectionId).toBe('ca_123');
    });

    it('returns 400 when appName missing', async () => {
      const res = await app.request('/composio/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // DELETE /connections/:id
  // ========================================================================

  describe('DELETE /composio/connections/:id', () => {
    it('disconnects a connection', async () => {
      mockComposioService.disconnect.mockResolvedValue(undefined);

      const res = await app.request('/composio/connections/ca_123', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { disconnected: boolean } };
      expect(body.data.disconnected).toBe(true);
      expect(mockComposioService.disconnect).toHaveBeenCalledWith('ca_123');
    });
  });

  // ========================================================================
  // POST /connections/:id/refresh
  // ========================================================================

  describe('POST /composio/connections/:id/refresh', () => {
    it('refreshes a connection', async () => {
      mockComposioService.refreshConnection.mockResolvedValue({
        id: 'c2',
        appName: 'gmail',
        status: 'ACTIVE',
      });

      const res = await app.request('/composio/connections/c2/refresh', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('ACTIVE');
    });
  });

  // ========================================================================
  // GET /callback
  // ========================================================================

  describe('GET /composio/callback', () => {
    it('redirects to UI with connection info', async () => {
      const res = await app.request('/composio/callback?appName=github&status=ACTIVE');
      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toContain('/settings/connected-apps');
      expect(location).toContain('connected=github');
    });
  });

  // ========================================================================
  // GET /actions/search
  // ========================================================================

  describe('GET /composio/actions/search', () => {
    it('returns search results', async () => {
      mockComposioService.searchActions.mockResolvedValue([
        { slug: 'GMAIL_SEND_EMAIL', name: 'Send Email', description: 'Send email', appName: 'gmail' },
      ]);

      const res = await app.request('/composio/actions/search?q=send+email');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { actions: unknown[]; count: number } };
      expect(body.data.actions).toHaveLength(1);
      expect(body.data.count).toBe(1);
    });

    it('returns 400 when query missing', async () => {
      const res = await app.request('/composio/actions/search');
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // Middleware guard
  // ========================================================================

  describe('middleware guard', () => {
    it('blocks all endpoints (except /status) when not configured', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);

      const endpoints = [
        '/composio/apps',
        '/composio/connections',
        '/composio/actions/search?q=test',
      ];

      for (const endpoint of endpoints) {
        const res = await app.request(endpoint);
        expect(res.status).toBe(400);
      }
    });

    it('allows /status even when not configured', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const res = await app.request('/composio/status');
      expect(res.status).toBe(200);
    });
  });
});

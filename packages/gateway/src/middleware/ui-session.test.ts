import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { uiSessionMiddleware } from './ui-session.js';
import { requestId } from './request-id.js';

// Mock the ui-session service
vi.mock('../services/ui-session.js', () => ({
  validateSession: vi.fn(() => false),
  isPasswordConfigured: vi.fn(() => false),
}));

// Mock helpers (for apiError)
vi.mock('../routes/helpers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../routes/helpers.js')>();
  return { ...original };
});

import { validateSession, isPasswordConfigured } from '../services/ui-session.js';

const mockValidateSession = vi.mocked(validateSession);
const mockIsPasswordConfigured = vi.mocked(isPasswordConfigured);

describe('UI Session Middleware', () => {
  function createApp() {
    const app = new Hono();
    app.use('*', requestId);
    app.use('/api/v1/*', uiSessionMiddleware);

    // Test routes
    app.get('/api/v1/test', (c) => c.json({ ok: true, session: c.get('sessionAuthenticated') }));
    app.get('/api/v1/auth/status', (c) => c.json({ ok: true, path: 'status' }));
    app.post('/api/v1/auth/login', (c) => c.json({ ok: true, path: 'login' }));
    app.post('/api/v1/auth/password', (c) =>
      c.json({ ok: true, session: c.get('sessionAuthenticated') })
    );
    app.post('/api/v1/auth/logout', (c) =>
      c.json({ ok: true, session: c.get('sessionAuthenticated') })
    );
    app.get('/api/v1/auth/sessions', (c) =>
      c.json({ ok: true, session: c.get('sessionAuthenticated') })
    );
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateSession.mockReturnValue(false);
    mockIsPasswordConfigured.mockReturnValue(false);
  });

  // ── Auth-own paths (bypass API auth) ────────────────────────────

  describe('auth paths', () => {
    it('passes through /auth/status and sets sessionAuthenticated', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth/status');
      expect(res.status).toBe(200);
      // These endpoints manage their own auth — sessionAuthenticated is set
      // so the API auth middleware (api-key/jwt) is skipped
    });

    it('passes through /auth/login and sets sessionAuthenticated', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth/login', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('passes through /auth/password (first-time setup)', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth/password', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.session).toBe(true);
    });

    it('passes through /auth/logout', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.session).toBe(true);
    });

    it('passes through /auth/sessions', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth/sessions');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.session).toBe(true);
    });
  });

  // ── Valid session ───────────────────────────────────────────────

  describe('valid session', () => {
    it('sets sessionAuthenticated on valid session token', async () => {
      mockValidateSession.mockReturnValue(true);
      const app = createApp();

      const res = await app.request('/api/v1/test', {
        headers: { 'X-Session-Token': 'valid-token' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.session).toBe(true);
    });
  });

  // ── No password configured ─────────────────────────────────────

  describe('no password configured', () => {
    it('passes through when no password is set', async () => {
      mockIsPasswordConfigured.mockReturnValue(false);
      const app = createApp();

      const res = await app.request('/api/v1/test');
      expect(res.status).toBe(200);
    });
  });

  // ── Password configured, no session ────────────────────────────

  describe('password configured, no session', () => {
    it('returns 401 when password is set and no auth headers', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      const app = createApp();

      const res = await app.request('/api/v1/test');
      expect(res.status).toBe(401);
    });

    it('passes through when Authorization header is present', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      const app = createApp();

      const res = await app.request('/api/v1/test', {
        headers: { Authorization: 'Bearer some-key' },
      });
      expect(res.status).toBe(200);
    });

    it('passes through when X-API-Key header is present', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      const app = createApp();

      const res = await app.request('/api/v1/test', {
        headers: { 'X-API-Key': 'some-key' },
      });
      expect(res.status).toBe(200);
    });

    it('returns 401 with invalid session token and no API auth', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      mockValidateSession.mockReturnValue(false);
      const app = createApp();

      const res = await app.request('/api/v1/test', {
        headers: { 'X-Session-Token': 'invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });
});

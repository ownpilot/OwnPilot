import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { uiAuthRoutes } from './ui-auth.js';
import { requestId } from '../middleware/request-id.js';

// Mock the ui-session service
vi.mock('../services/ui-session.js', () => ({
  hashPassword: vi.fn((pw: string) => `salt:${pw}-hashed`),
  verifyPassword: vi.fn((pw: string, stored: string) => stored === `salt:${pw}-hashed`),
  createSession: vi.fn(() => ({
    token: 'test-token-123',
    expiresAt: new Date('2026-03-01T00:00:00Z'),
  })),
  validateSession: vi.fn((token: string) => token === 'valid-session-token'),
  invalidateSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
  isPasswordConfigured: vi.fn(() => false),
  getPasswordHash: vi.fn(() => null),
  setPasswordHash: vi.fn(),
  removePassword: vi.fn(),
  getActiveSessionCount: vi.fn(() => 2),
}));

vi.mock('./helpers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./helpers.js')>();
  return { ...original };
});

import {
  isPasswordConfigured,
  getPasswordHash,
  validateSession,
} from '../services/ui-session.js';

const mockIsPasswordConfigured = vi.mocked(isPasswordConfigured);
const mockGetPasswordHash = vi.mocked(getPasswordHash);
const mockValidateSession = vi.mocked(validateSession);

describe('UI Auth Routes', () => {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/auth', uiAuthRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no password configured
    mockIsPasswordConfigured.mockReturnValue(false);
    mockGetPasswordHash.mockReturnValue(null);
    mockValidateSession.mockImplementation((token: string) => token === 'valid-session-token');
  });

  // ── GET /auth/status ────────────────────────────────────────────

  describe('GET /auth/status', () => {
    it('returns status when no password configured', async () => {
      const res = await app.request('/auth/status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.passwordConfigured).toBe(false);
      expect(json.data.authenticated).toBe(false);
    });

    it('returns authenticated=true with valid session', async () => {
      const res = await app.request('/auth/status', {
        headers: { 'X-Session-Token': 'valid-session-token' },
      });
      const json = await res.json();
      expect(json.data.authenticated).toBe(true);
    });

    it('returns authenticated=false with invalid session', async () => {
      const res = await app.request('/auth/status', {
        headers: { 'X-Session-Token': 'invalid-token' },
      });
      const json = await res.json();
      expect(json.data.authenticated).toBe(false);
    });
  });

  // ── POST /auth/login ───────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns 400 when no password is configured', async () => {
      const res = await app.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    it('returns token on successful login', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      mockGetPasswordHash.mockReturnValue('salt:correct-hashed');

      const res = await app.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'correct' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.token).toBe('test-token-123');
      expect(json.data.expiresAt).toBeDefined();
    });

    it('returns 403 on wrong password', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);
      mockGetPasswordHash.mockReturnValue('salt:correct-hashed');

      const res = await app.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'wrong' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when password is missing', async () => {
      const res = await app.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /auth/logout ──────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('returns 401 without session', async () => {
      const res = await app.request('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('succeeds with valid session', async () => {
      const res = await app.request('/auth/logout', {
        method: 'POST',
        headers: { 'X-Session-Token': 'valid-session-token' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Logged out');
    });
  });

  // ── POST /auth/password ────────────────────────────────────────

  describe('POST /auth/password', () => {
    it('sets password for the first time (no auth required)', async () => {
      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'new-password-123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Password set');
      expect(json.data.token).toBe('test-token-123');
    });

    it('rejects password shorter than 8 chars', async () => {
      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'short' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('at least 8');
    });

    it('requires auth to change existing password', async () => {
      mockGetPasswordHash.mockReturnValue('salt:old-hashed');

      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'new-password-123', currentPassword: 'old' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401); // No session token
    });

    it('changes password with valid session and current password', async () => {
      mockGetPasswordHash.mockReturnValue('salt:old-hashed');

      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'new-password-123', currentPassword: 'old' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'valid-session-token',
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Password changed');
    });

    it('rejects change with wrong current password', async () => {
      mockGetPasswordHash.mockReturnValue('salt:old-hashed');

      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'new-password-123', currentPassword: 'wrong' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'valid-session-token',
        },
      });
      expect(res.status).toBe(403);
    });

    it('requires currentPassword when changing', async () => {
      mockGetPasswordHash.mockReturnValue('salt:old-hashed');

      const res = await app.request('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'new-password-123' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'valid-session-token',
        },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /auth/password ──────────────────────────────────────

  describe('DELETE /auth/password', () => {
    it('returns 401 without session', async () => {
      const res = await app.request('/auth/password', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when no password configured', async () => {
      const res = await app.request('/auth/password', {
        method: 'DELETE',
        headers: { 'X-Session-Token': 'valid-session-token' },
      });
      expect(res.status).toBe(400);
    });

    it('removes password with valid session', async () => {
      mockIsPasswordConfigured.mockReturnValue(true);

      const res = await app.request('/auth/password', {
        method: 'DELETE',
        headers: { 'X-Session-Token': 'valid-session-token' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Password removed');
    });
  });

  // ── GET /auth/sessions ─────────────────────────────────────────

  describe('GET /auth/sessions', () => {
    it('returns 401 without session', async () => {
      const res = await app.request('/auth/sessions');
      expect(res.status).toBe(401);
    });

    it('returns active session count', async () => {
      const res = await app.request('/auth/sessions', {
        headers: { 'X-Session-Token': 'valid-session-token' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.activeSessions).toBe(2);
    });
  });
});

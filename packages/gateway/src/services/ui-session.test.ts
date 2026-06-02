import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock settingsRepo before importing the module
vi.mock('../db/repositories/settings/index.js', () => ({
  settingsRepo: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock uiSessionsRepo before importing the module
vi.mock('../db/repositories/ui-sessions.js', () => ({
  uiSessionsRepo: {
    createSession: vi.fn(),
    getByTokenHash: vi.fn(),
    deleteByTokenHash: vi.fn(),
    deleteAll: vi.fn(),
    deleteExpired: vi.fn(),
    countActive: vi.fn(),
    listActive: vi.fn(),
  },
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  hashPassword,
  verifyPassword,
  createSession,
  createMcpSession,
  validateSession,
  invalidateSession,
  invalidateAllSessions,
  getActiveSessionCount,
  isPasswordConfigured,
  getPasswordHash,
  getPasswordHashCreatedAt,
  setPasswordHash,
  removePassword,
  purgeExpiredSessions,
  startCleanup,
  stopCleanup,
} from './ui-session.js';
import { settingsRepo } from '../db/repositories/settings/index.js';
import { uiSessionsRepo } from '../db/repositories/ui-sessions.js';

const mockSettingsRepo = vi.mocked(settingsRepo);
const mockUiSessionsRepo = vi.mocked(uiSessionsRepo);

describe('UI Session Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset TTLCache by invalidating all sessions (clears cache + mocks)
    mockUiSessionsRepo.deleteAll.mockResolvedValue(0);
  });

  afterEach(() => {
    stopCleanup();
  });

  // ── Password Hashing ─────────────────────────────────────────────

  describe('hashPassword', () => {
    it('returns salt:hash format', () => {
      const result = hashPassword('test-password');
      expect(result).toContain(':');
      const [salt, hash] = result.split(':');
      expect(salt).toHaveLength(64); // 32 bytes hex
      expect(hash).toHaveLength(128); // 64 bytes hex
    });

    it('produces different hashes for the same password (random salt)', () => {
      const hash1 = hashPassword('same-password');
      const hash2 = hashPassword('same-password');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', () => {
      const stored = hashPassword('correct-password');
      expect(verifyPassword('correct-password', stored)).toBe(true);
    });

    it('returns false for incorrect password', () => {
      const stored = hashPassword('correct-password');
      expect(verifyPassword('wrong-password', stored)).toBe(false);
    });

    it('returns false for malformed stored hash', () => {
      expect(verifyPassword('test', 'invalid')).toBe(false);
      expect(verifyPassword('test', '')).toBe(false);
    });

    it('returns false for missing salt or hash part', () => {
      expect(verifyPassword('test', ':')).toBe(false);
    });

    it('returns false when stored hash buffer length differs from key length', () => {
      const fakeSalt = 'aa'.repeat(32); // 64-char hex salt
      const fakeHash = 'bb'.repeat(32); // 64-char hex hash (32 bytes, not 64)
      const stored = `${fakeSalt}:${fakeHash}`;
      expect(verifyPassword('any-password', stored)).toBe(false);
    });
  });

  // ── Session Management ────────────────────────────────────────────

  describe('createSession', () => {
    it('returns token and expiration', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      const session = await createSession();
      expect(session.token).toHaveLength(64); // 32 bytes hex
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(mockUiSessionsRepo.createSession).toHaveBeenCalledTimes(1);
    });

    it('creates unique tokens', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      const s1 = await createSession();
      const s2 = await createSession();
      expect(s1.token).not.toBe(s2.token);
    });
  });

  describe('createMcpSession', () => {
    it('returns token and 30-day expiration', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      const session = await createMcpSession();
      expect(session.token).toHaveLength(64);
      expect(session.expiresAt).toBeInstanceOf(Date);
      // Should be roughly 30 days from now
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const diff = session.expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(thirtyDaysMs - 60000);
      expect(diff).toBeLessThan(thirtyDaysMs + 60000);
    });
  });

  describe('validateSession', () => {
    it('returns true for valid session', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      const session = await createSession();

      // createSession warms the cache, so first validate is a cache hit
      expect(await validateSession(session.token)).toBe(true);
      expect(mockUiSessionsRepo.getByTokenHash).toHaveBeenCalledTimes(0);

      // After cache expires (or if we had invalidated it), DB lookup would happen.
      // For now, re-validation stays a cache hit.
      expect(await validateSession(session.token)).toBe(true);
      expect(mockUiSessionsRepo.getByTokenHash).toHaveBeenCalledTimes(0);
    });

    it('returns true for valid session after cache miss', async () => {
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {},
      });
      // Token not in cache → hits DB
      expect(await validateSession('some-cached-miss-token')).toBe(true);
      expect(mockUiSessionsRepo.getByTokenHash).toHaveBeenCalledTimes(1);

      // Second call hits cache → no extra DB call
      expect(await validateSession('some-cached-miss-token')).toBe(true);
      expect(mockUiSessionsRepo.getByTokenHash).toHaveBeenCalledTimes(1);
    });

    it('returns false for unknown token', async () => {
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue(null);
      expect(await validateSession('unknown-token')).toBe(false);
    });

    it('returns false for expired session', async () => {
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        metadata: {},
      });
      expect(await validateSession('some-token')).toBe(false);
    });

    it('returns false for session created before password change', async () => {
      const hashCreatedAt = Date.now() - 60_000; // 1 minute ago
      mockSettingsRepo.get.mockReturnValue(hashCreatedAt);
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(hashCreatedAt - 60_000), // older than password change
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {},
      });
      expect(await validateSession('old-session-token')).toBe(false);
    });

    it('returns true when hashCreatedAt is not set (backward compat)', async () => {
      mockSettingsRepo.get.mockReturnValue(null);
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {},
      });
      expect(await validateSession('legacy-session-token')).toBe(true);
    });

    it('cache-hit path also enforces the password-change cutoff (no DB lookup)', async () => {
      // No cutoff at creation time → the warmed-cache session is initially valid.
      mockSettingsRepo.get.mockReturnValue(null);
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      const session = await createSession();
      expect(await validateSession(session.token)).toBe(true);

      // Simulate a password change AFTER this session was created. The cache
      // still holds the (now-stale) session; the cache-hit path must reject it
      // without falling back to the DB. mockReturnValueOnce so the numeric
      // value is consumed by this single lookup and doesn't leak into later
      // tests (vi.clearAllMocks does not reset mockReturnValue).
      mockSettingsRepo.get.mockReturnValueOnce(Date.now() + 60_000);
      expect(await validateSession(session.token)).toBe(false);
      expect(mockUiSessionsRepo.getByTokenHash).toHaveBeenCalledTimes(0);
    });
  });

  describe('invalidateSession', () => {
    it('removes a specific session', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      mockUiSessionsRepo.deleteByTokenHash.mockResolvedValue(true);
      const session = await createSession();

      // Validate should work via cache after creation
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {},
      });
      expect(await validateSession(session.token)).toBe(true);

      await invalidateSession(session.token);
      expect(mockUiSessionsRepo.deleteByTokenHash).toHaveBeenCalledTimes(1);

      // After invalidation, DB returns null
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue(null);
      expect(await validateSession(session.token)).toBe(false);
    });
  });

  describe('invalidateAllSessions', () => {
    it('removes all sessions', async () => {
      mockUiSessionsRepo.createSession.mockResolvedValue(undefined);
      mockUiSessionsRepo.deleteAll.mockResolvedValue(2);

      const s1 = await createSession();
      const s2 = await createSession();

      // Pre-invalidation: both valid in cache
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue({
        tokenHash: 'any',
        kind: 'ui',
        userId: 'default',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {},
      });
      expect(await validateSession(s1.token)).toBe(true);
      expect(await validateSession(s2.token)).toBe(true);

      await invalidateAllSessions();
      expect(mockUiSessionsRepo.deleteAll).toHaveBeenCalledTimes(1);

      // After clearing cache + DB, both invalid
      mockUiSessionsRepo.getByTokenHash.mockResolvedValue(null);
      expect(await validateSession(s1.token)).toBe(false);
      expect(await validateSession(s2.token)).toBe(false);
    });
  });

  describe('getActiveSessionCount', () => {
    it('returns count from repository', async () => {
      mockUiSessionsRepo.countActive.mockResolvedValue(5);
      expect(await getActiveSessionCount()).toBe(5);
      expect(mockUiSessionsRepo.countActive).toHaveBeenCalledTimes(1);
    });
  });

  // ── Password Persistence ──────────────────────────────────────────

  describe('isPasswordConfigured', () => {
    it('returns false when no hash stored', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      expect(isPasswordConfigured()).toBe(false);
    });

    it('returns true when hash is stored', () => {
      mockSettingsRepo.get.mockReturnValue('salt:hash');
      expect(isPasswordConfigured()).toBe(true);
    });
  });

  describe('getPasswordHash', () => {
    it('returns stored hash', () => {
      mockSettingsRepo.get.mockReturnValue('salt:hash');
      expect(getPasswordHash()).toBe('salt:hash');
    });

    it('returns null when not set', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      expect(getPasswordHash()).toBeNull();
    });
  });

  describe('getPasswordHashCreatedAt', () => {
    it('returns stored timestamp', () => {
      mockSettingsRepo.get.mockReturnValue(1_000_000);
      expect(getPasswordHashCreatedAt()).toBe(1_000_000);
    });

    it('returns null when not set', () => {
      mockSettingsRepo.get.mockReturnValue(null);
      expect(getPasswordHashCreatedAt()).toBeNull();
    });

    it('returns null for non-number values', () => {
      mockSettingsRepo.get.mockReturnValue('not-a-number');
      expect(getPasswordHashCreatedAt()).toBeNull();
    });
  });

  describe('setPasswordHash', () => {
    it('stores hash and timestamp in settings', async () => {
      mockSettingsRepo.set.mockResolvedValue(undefined);
      await setPasswordHash('salt:hash');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('ui_password_hash', 'salt:hash');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith(
        'ui_password_hash_created_at',
        expect.any(Number)
      );
    });
  });

  describe('removePassword', () => {
    it('deletes hash, timestamp, and invalidates sessions', async () => {
      mockSettingsRepo.delete.mockResolvedValue(true);
      mockUiSessionsRepo.deleteAll.mockResolvedValue(1);

      await removePassword();
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('ui_password_hash');
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('ui_password_hash_created_at');
      expect(mockUiSessionsRepo.deleteAll).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  describe('purgeExpiredSessions', () => {
    it('removes expired sessions and clears cache', async () => {
      mockUiSessionsRepo.deleteExpired.mockResolvedValue(3);

      const purged = await purgeExpiredSessions();
      expect(purged).toBe(3);
      expect(mockUiSessionsRepo.deleteExpired).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no expired sessions', async () => {
      mockUiSessionsRepo.deleteExpired.mockResolvedValue(0);

      const purged = await purgeExpiredSessions();
      expect(purged).toBe(0);
    });
  });

  describe('startCleanup / stopCleanup', () => {
    it('can be started and stopped without error', () => {
      startCleanup();
      startCleanup(); // Idempotent
      stopCleanup();
      stopCleanup(); // Idempotent
    });
  });
});

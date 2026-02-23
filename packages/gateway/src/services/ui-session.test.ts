import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock settingsRepo before importing the module
vi.mock('../db/repositories/settings.js', () => ({
  settingsRepo: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
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
  validateSession,
  invalidateSession,
  invalidateAllSessions,
  getActiveSessionCount,
  isPasswordConfigured,
  getPasswordHash,
  setPasswordHash,
  removePassword,
  purgeExpiredSessions,
  startCleanup,
  stopCleanup,
} from './ui-session.js';
import { settingsRepo } from '../db/repositories/settings.js';

const mockSettingsRepo = vi.mocked(settingsRepo);

describe('UI Session Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAllSessions();
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
  });

  // ── Session Management ────────────────────────────────────────────

  describe('createSession', () => {
    it('returns token and expiration', () => {
      const session = createSession();
      expect(session.token).toHaveLength(64); // 32 bytes hex
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('creates unique tokens', () => {
      const s1 = createSession();
      const s2 = createSession();
      expect(s1.token).not.toBe(s2.token);
    });
  });

  describe('validateSession', () => {
    it('returns true for valid session', () => {
      const session = createSession();
      expect(validateSession(session.token)).toBe(true);
    });

    it('returns false for unknown token', () => {
      expect(validateSession('unknown-token')).toBe(false);
    });

    it('returns false for expired session', () => {
      // Create a session then manually expire it
      vi.useFakeTimers();
      const session = createSession();
      // Advance time past default TTL (7 days)
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
      expect(validateSession(session.token)).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('invalidateSession', () => {
    it('removes a specific session', () => {
      const session = createSession();
      expect(validateSession(session.token)).toBe(true);
      invalidateSession(session.token);
      expect(validateSession(session.token)).toBe(false);
    });
  });

  describe('invalidateAllSessions', () => {
    it('removes all sessions', () => {
      const s1 = createSession();
      const s2 = createSession();
      expect(validateSession(s1.token)).toBe(true);
      expect(validateSession(s2.token)).toBe(true);

      invalidateAllSessions();
      expect(validateSession(s1.token)).toBe(false);
      expect(validateSession(s2.token)).toBe(false);
    });
  });

  describe('getActiveSessionCount', () => {
    it('returns count of non-expired sessions', () => {
      expect(getActiveSessionCount()).toBe(0);
      createSession();
      createSession();
      expect(getActiveSessionCount()).toBe(2);
    });

    it('excludes expired sessions', () => {
      vi.useFakeTimers();
      createSession();
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
      createSession(); // This one is still valid
      expect(getActiveSessionCount()).toBe(1);
      vi.useRealTimers();
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

  describe('setPasswordHash', () => {
    it('stores hash in settings', async () => {
      mockSettingsRepo.set.mockResolvedValue(undefined);
      await setPasswordHash('salt:hash');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('ui_password_hash', 'salt:hash');
    });
  });

  describe('removePassword', () => {
    it('deletes hash and invalidates sessions', async () => {
      mockSettingsRepo.delete.mockResolvedValue(true);
      const session = createSession();
      expect(validateSession(session.token)).toBe(true);

      await removePassword();
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('ui_password_hash');
      expect(validateSession(session.token)).toBe(false);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  describe('purgeExpiredSessions', () => {
    it('removes expired sessions', () => {
      vi.useFakeTimers();
      createSession();
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
      createSession(); // Still valid

      const purged = purgeExpiredSessions();
      expect(purged).toBe(1);
      expect(getActiveSessionCount()).toBe(1);
      vi.useRealTimers();
    });

    it('returns 0 when no expired sessions', () => {
      createSession();
      expect(purgeExpiredSessions()).toBe(0);
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

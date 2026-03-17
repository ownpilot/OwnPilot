import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Unit tests for LRU eviction logic extracted from ClaudeManager.
 *
 * ClaudeManager evicts the oldest idle (non-active, non-paused) session
 * when MAX_SESSIONS is reached.
 */

// ---- Extracted LRU logic (pure function) ----

interface MockSession {
  id: string;
  lastActivity: Date;
  hasActiveProcess: boolean;
  paused: boolean;
}

/**
 * Find the session to evict: oldest idle session (not active, not paused).
 * Returns null if all sessions are active or paused (cannot evict).
 */
function findEvictionCandidate(sessions: MockSession[]): string | null {
  let oldestId: string | null = null;
  let oldestTime = Infinity;

  for (const s of sessions) {
    if (!s.hasActiveProcess && !s.paused) {
      const t = s.lastActivity.getTime();
      if (t < oldestTime) {
        oldestTime = t;
        oldestId = s.id;
      }
    }
  }
  return oldestId;
}

/**
 * Determine if eviction is needed based on session count and max.
 */
function shouldEvict(currentCount: number, maxSessions: number): boolean {
  return currentCount >= maxSessions;
}

// ---- Tests ----

describe('LRU eviction logic', () => {
  const MAX_SESSIONS = 500;
  const now = Date.now();

  describe('shouldEvict', () => {
    it('returns true when at capacity', () => {
      expect(shouldEvict(500, MAX_SESSIONS)).toBe(true);
    });

    it('returns true when over capacity', () => {
      expect(shouldEvict(501, MAX_SESSIONS)).toBe(true);
    });

    it('returns false when under capacity', () => {
      expect(shouldEvict(499, MAX_SESSIONS)).toBe(false);
    });

    it('returns false when empty', () => {
      expect(shouldEvict(0, MAX_SESSIONS)).toBe(false);
    });
  });

  describe('findEvictionCandidate', () => {
    it('evicts the oldest idle session', () => {
      const sessions: MockSession[] = [
        { id: 'newest', lastActivity: new Date(now), hasActiveProcess: false, paused: false },
        { id: 'oldest', lastActivity: new Date(now - 60_000), hasActiveProcess: false, paused: false },
        { id: 'middle', lastActivity: new Date(now - 30_000), hasActiveProcess: false, paused: false },
      ];

      expect(findEvictionCandidate(sessions)).toBe('oldest');
    });

    it('skips sessions with active processes', () => {
      const sessions: MockSession[] = [
        { id: 'active-old', lastActivity: new Date(now - 120_000), hasActiveProcess: true, paused: false },
        { id: 'idle-newer', lastActivity: new Date(now - 30_000), hasActiveProcess: false, paused: false },
      ];

      expect(findEvictionCandidate(sessions)).toBe('idle-newer');
    });

    it('skips paused sessions', () => {
      const sessions: MockSession[] = [
        { id: 'paused-old', lastActivity: new Date(now - 120_000), hasActiveProcess: false, paused: true },
        { id: 'idle-newer', lastActivity: new Date(now - 10_000), hasActiveProcess: false, paused: false },
      ];

      expect(findEvictionCandidate(sessions)).toBe('idle-newer');
    });

    it('returns null when all sessions are active', () => {
      const sessions: MockSession[] = [
        { id: 'a1', lastActivity: new Date(now - 60_000), hasActiveProcess: true, paused: false },
        { id: 'a2', lastActivity: new Date(now - 30_000), hasActiveProcess: true, paused: false },
      ];

      expect(findEvictionCandidate(sessions)).toBeNull();
    });

    it('returns null when all sessions are paused', () => {
      const sessions: MockSession[] = [
        { id: 'p1', lastActivity: new Date(now - 60_000), hasActiveProcess: false, paused: true },
        { id: 'p2', lastActivity: new Date(now - 30_000), hasActiveProcess: false, paused: true },
      ];

      expect(findEvictionCandidate(sessions)).toBeNull();
    });

    it('returns null for empty session list', () => {
      expect(findEvictionCandidate([])).toBeNull();
    });

    it('handles mixed active/paused/idle correctly', () => {
      const sessions: MockSession[] = [
        { id: 'active', lastActivity: new Date(now - 200_000), hasActiveProcess: true, paused: false },
        { id: 'paused', lastActivity: new Date(now - 150_000), hasActiveProcess: false, paused: true },
        { id: 'idle-old', lastActivity: new Date(now - 100_000), hasActiveProcess: false, paused: false },
        { id: 'idle-new', lastActivity: new Date(now - 10_000), hasActiveProcess: false, paused: false },
      ];

      // Should evict idle-old (oldest idle, skip active and paused)
      expect(findEvictionCandidate(sessions)).toBe('idle-old');
    });

    it('evicts correctly with single idle session among many active', () => {
      const sessions: MockSession[] = [
        { id: 'active1', lastActivity: new Date(now - 300_000), hasActiveProcess: true, paused: false },
        { id: 'active2', lastActivity: new Date(now - 200_000), hasActiveProcess: true, paused: false },
        { id: 'only-idle', lastActivity: new Date(now - 100_000), hasActiveProcess: false, paused: false },
        { id: 'active3', lastActivity: new Date(now - 50_000), hasActiveProcess: true, paused: false },
      ];

      expect(findEvictionCandidate(sessions)).toBe('only-idle');
    });

    it('picks earliest among multiple idle sessions with same activity', () => {
      // Edge case: two sessions with identical timestamps
      const sameTime = new Date(now - 60_000);
      const sessions: MockSession[] = [
        { id: 'first', lastActivity: sameTime, hasActiveProcess: false, paused: false },
        { id: 'second', lastActivity: sameTime, hasActiveProcess: false, paused: false },
      ];

      // Either is valid, but deterministic: first one encountered wins with <
      expect(findEvictionCandidate(sessions)).toBe('first');
    });
  });

  describe('eviction integration (shouldEvict + findCandidate)', () => {
    it('full flow: at capacity → find oldest idle → evict', () => {
      const sessions: MockSession[] = Array.from({ length: 500 }, (_, i) => ({
        id: `session-${i}`,
        lastActivity: new Date(now - (500 - i) * 1000), // session-0 is oldest
        hasActiveProcess: false,
        paused: false,
      }));

      expect(shouldEvict(sessions.length, MAX_SESSIONS)).toBe(true);
      expect(findEvictionCandidate(sessions)).toBe('session-0');
    });

    it('under capacity: no eviction needed', () => {
      const sessions: MockSession[] = Array.from({ length: 100 }, (_, i) => ({
        id: `session-${i}`,
        lastActivity: new Date(now - i * 1000),
        hasActiveProcess: false,
        paused: false,
      }));

      expect(shouldEvict(sessions.length, MAX_SESSIONS)).toBe(false);
      // findEvictionCandidate still works, but shouldn't be called
    });
  });
});

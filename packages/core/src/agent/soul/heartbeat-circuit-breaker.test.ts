/**
 * Tests for HeartbeatCircuitBreaker
 *
 * Covers: constructor defaults, state transitions (closed→open→half-open→closed),
 * isOpen/skipCycle timing, recordSuccess/recordFailure, reset, getSnapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatCircuitBreaker } from './heartbeat-circuit-breaker.js';

describe('HeartbeatCircuitBreaker', () => {
  // ===========================================================================
  // Constructor & defaults
  // ===========================================================================

  describe('constructor', () => {
    it('starts in closed state', () => {
      const cb = new HeartbeatCircuitBreaker();
      expect(cb.state).toBe('closed');
      expect(cb.failureCount).toBe(0);
    });

    it('accepts custom options', () => {
      const cb = new HeartbeatCircuitBreaker({
        failureThreshold: 5,
        cooldownMs: 120_000,
        successThreshold: 3,
      });
      expect(cb.state).toBe('closed');
    });

    it('uses defaults when no options provided', () => {
      const cb = new HeartbeatCircuitBreaker();
      // Call recordFailure 3 times = threshold → opens
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('open');
    });
  });

  // ===========================================================================
  // recordFailure → state transitions
  // ===========================================================================

  describe('recordFailure', () => {
    it('transitions closed → open after failureThreshold failures', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 2 });
      expect(cb.state).toBe('closed');

      cb.recordFailure(); // 1st failure — still closed
      expect(cb.state).toBe('closed');
      expect(cb.failureCount).toBe(1);

      cb.recordFailure(); // 2nd failure → opens
      expect(cb.state).toBe('open');
      expect(cb.failureCount).toBe(2);
    });

    it('records lastFailureAt timestamp', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1 });
      const before = Date.now();
      cb.recordFailure();
      const snapshot = cb.getSnapshot();
      expect(snapshot.lastFailureAt).toBeGreaterThanOrEqual(before);
    });

    it('re-opens immediately when in half-open state', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 });
      cb.recordFailure(); // → open
      expect(cb.state).toBe('open');

      // Force half-open via isOpen (cooldown=0)
      cb.isOpen(); // → half-open (cooldown elapsed)
      expect(cb.state).toBe('half-open');

      cb.recordFailure(); // half-open failure → re-opens
      expect(cb.state).toBe('open');
    });
  });

  // ===========================================================================
  // isOpen / shouldSkipCycle
  // ===========================================================================

  describe('isOpen / shouldSkipCycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns false when circuit is closed', () => {
      const cb = new HeartbeatCircuitBreaker();
      expect(cb.isOpen()).toBe(false);
      expect(cb.shouldSkipCycle()).toBe(false);
    });

    it('returns true when circuit is open before cooldown', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
      cb.recordFailure();
      expect(cb.state).toBe('open');
      expect(cb.isOpen()).toBe(true);
    });

    it('transitions open → half-open after cooldown elapses', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
      const start = Date.now();
      vi.setSystemTime(start);
      cb.recordFailure(); // → open at `start`
      expect(cb.state).toBe('open');

      // Advance past cooldown
      vi.advanceTimersByTime(10_001);
      vi.setSystemTime(start + 10_001);

      expect(cb.isOpen()).toBe(false); // → half-open
      expect(cb.state).toBe('half-open');
    });

    it('still returns true in half-open state (cooldown elapsed, but isOpen returns false)', () => {
      // isOpen returns false when it transitions to half-open, meaning "don't skip"
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 });
      cb.recordFailure(); // → open
      // cooldown = 0, so isOpen immediately transitions to half-open
      expect(cb.isOpen()).toBe(false);
    });
  });

  // ===========================================================================
  // recordSuccess
  // ===========================================================================

  describe('recordSuccess', () => {
    it('resets failureCount when called in closed state', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.failureCount).toBe(2);

      cb.recordSuccess(); // resets failures
      expect(cb.failureCount).toBe(0);
      expect(cb.state).toBe('closed');
    });

    it('transitions half-open → closed after successThreshold successes', () => {
      const cb = new HeartbeatCircuitBreaker({
        failureThreshold: 1,
        cooldownMs: 0,
        successThreshold: 2,
      });
      cb.recordFailure(); // → open
      cb.isOpen(); // → half-open (cooldown=0)

      cb.recordSuccess(); // 1st success
      expect(cb.state).toBe('half-open');

      cb.recordSuccess(); // 2nd success → closed
      expect(cb.state).toBe('closed');
      expect(cb.failureCount).toBe(0);
    });

    it('transitions half-open → closed with default successThreshold (1)', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 });
      cb.recordFailure(); // → open
      cb.isOpen(); // → half-open
      cb.recordSuccess(); // → closed
      expect(cb.state).toBe('closed');
    });
  });

  // ===========================================================================
  // reset
  // ===========================================================================

  describe('reset', () => {
    it('resets to closed state from any state', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure(); // → open
      expect(cb.state).toBe('open');

      cb.reset();
      expect(cb.state).toBe('closed');
      expect(cb.failureCount).toBe(0);
    });

    it('can be called on a closed circuit with no effect', () => {
      const cb = new HeartbeatCircuitBreaker();
      cb.recordFailure();
      cb.reset();
      expect(cb.state).toBe('closed');
      expect(cb.failureCount).toBe(0);
    });

    it('resets consecutiveSuccesses', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 });
      cb.recordFailure(); // → open
      cb.isOpen(); // → half-open
      cb.recordSuccess(); // → closed

      // Reset after closed
      cb.recordFailure(); // → open
      cb.isOpen(); // → half-open
      cb.reset();
      expect(cb.state).toBe('closed');
    });
  });

  // ===========================================================================
  // getSnapshot
  // ===========================================================================

  describe('getSnapshot', () => {
    it('returns correct snapshot in closed state', () => {
      const cb = new HeartbeatCircuitBreaker();
      const snap = cb.getSnapshot();
      expect(snap.state).toBe('closed');
      expect(snap.failureCount).toBe(0);
      expect(snap.lastFailureAt).toBe(0);
      expect(snap.nextAttemptAt).toBe(0);
      expect(snap.consecutiveSuccesses).toBe(0);
    });

    it('returns correct snapshot in open state', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
      const before = Date.now();
      cb.recordFailure();
      const snap = cb.getSnapshot();
      expect(snap.state).toBe('open');
      expect(snap.failureCount).toBe(1);
      expect(snap.lastFailureAt).toBeGreaterThanOrEqual(before);
      expect(snap.nextAttemptAt).toBeGreaterThan(snap.lastFailureAt);
    });

    it('returns correct snapshot in half-open state', () => {
      const cb = new HeartbeatCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 });
      cb.recordFailure(); // → open
      cb.isOpen(); // → half-open
      const snap = cb.getSnapshot();
      expect(snap.state).toBe('half-open');
    });
  });

  // ===========================================================================
  // Integration: full cycle
  // ===========================================================================

  describe('full lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('closed → open → half-open → closed', () => {
      const cb = new HeartbeatCircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 5_000,
        successThreshold: 1,
      });

      const start = Date.now();
      vi.setSystemTime(start);

      // Start closed
      expect(cb.state).toBe('closed');
      expect(cb.shouldSkipCycle()).toBe(false);

      // Two failures → open
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('open');

      // Should skip while open
      expect(cb.shouldSkipCycle()).toBe(true);

      // After cooldown → half-open
      vi.advanceTimersByTime(5_001);
      vi.setSystemTime(start + 5_001);
      expect(cb.shouldSkipCycle()).toBe(false);
      expect(cb.state).toBe('half-open');

      // Success → closed
      cb.recordSuccess();
      expect(cb.state).toBe('closed');
      expect(cb.shouldSkipCycle()).toBe(false);
    });
  });
});

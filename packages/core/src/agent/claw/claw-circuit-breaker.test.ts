/**
 * Tests for ClawCircuitBreaker
 *
 * Covers: closed → open → half-open → closed state machine,
 * success/failure tracking, cooldown auto-transition, reset, snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET_LOG_MOCK } from '../../test-helpers.js';

vi.mock('../../services/get-log.js', () => GET_LOG_MOCK);

const { ClawCircuitBreaker } = await import('./claw-circuit-breaker.js');

// ============================================================================
// Initial state
// ============================================================================

describe('ClawCircuitBreaker initial state', () => {
  it('starts in closed state', () => {
    const cb = new ClawCircuitBreaker();
    expect(cb.state).toBe('closed');
  });

  it('starts with zero failure count', () => {
    const cb = new ClawCircuitBreaker();
    expect(cb.failureCount).toBe(0);
  });

  it('isOpen returns false when closed', () => {
    const cb = new ClawCircuitBreaker();
    expect(cb.isOpen()).toBe(false);
  });

  it('shouldSkipCycle returns false when closed', () => {
    const cb = new ClawCircuitBreaker();
    expect(cb.shouldSkipCycle()).toBe(false);
  });
});

// ============================================================================
// Default options
// ============================================================================

describe('ClawCircuitBreaker default options', () => {
  it('defaults failureThreshold to 5', () => {
    const cb = new ClawCircuitBreaker();
    // Record 4 failures → still closed
    for (let i = 0; i < 4; i++) {
      cb.recordFailure();
    }
    expect(cb.state).toBe('closed');
    // 5th failure → opens
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });

  it('defaults cooldownMs to 60 seconds', () => {
    vi.useFakeTimers();
    const cb = new ClawCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.state).toBe('open');
    // Before cooldown expires, still open
    vi.advanceTimersByTime(59_000);
    expect(cb.isOpen()).toBe(true);
    // After cooldown, transitions to half-open
    vi.advanceTimersByTime(2_000);
    expect(cb.isOpen()).toBe(false);
    expect(cb.state).toBe('half-open');
    vi.useRealTimers();
  });

  it('defaults successThreshold to 1', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    // Manually set to half-open via cooldown trick
    vi.useFakeTimers();
    vi.advanceTimersByTime(61_000);
    cb.isOpen(); // transitions to half-open
    expect(cb.state).toBe('half-open');
    // One success closes it
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
    vi.useRealTimers();
  });
});

// ============================================================================
// Closed → Open transition
// ============================================================================

describe('ClawCircuitBreaker closed → open', () => {
  it('stays closed below failure threshold', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('closed');
    expect(cb.failureCount).toBe(2);
  });

  it('opens when failure threshold is reached', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });

  it('records lastFailureAt on each failure', () => {
    const before = Date.now();
    const cb = new ClawCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.failureCount).toBe(1);
    expect(cb['_lastFailureAt']).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================================
// Open → Half-Open transition (cooldown)
// ============================================================================

describe('ClawCircuitBreaker open → half-open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays open during cooldown window', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(5_000);
    expect(cb.isOpen()).toBe(true);
    expect(cb.state).toBe('open');
  });

  it('transitions to half-open when cooldown elapses', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(10_000);
    expect(cb.isOpen()).toBe(false);
    expect(cb.state).toBe('half-open');
  });

  it('isOpen triggers the half-open transition (side effect)', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    // isOpen should transition to half-open
    const result = cb.isOpen();
    expect(result).toBe(false);
    expect(cb.state).toBe('half-open');
  });

  it('shouldSkipCycle returns false once cooldown elapses', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    expect(cb.shouldSkipCycle()).toBe(false);
  });
});

// ============================================================================
// Half-Open → Closed (success) / Open (failure)
// ============================================================================

describe('ClawCircuitBreaker half-open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('transitions to closed on successful probe', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
    expect(cb.failureCount).toBe(0);
  });

  it('transitions back to open on failed probe (immediate re-open)', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open
    cb.recordFailure(); // immediate re-open
    expect(cb.state).toBe('open');
  });

  it('requires multiple successes when successThreshold > 1', () => {
    const cb = new ClawCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5_000,
      successThreshold: 3,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open

    // 2 successes → still half-open
    cb.recordSuccess();
    expect(cb.state).toBe('half-open');
    cb.recordSuccess();
    expect(cb.state).toBe('half-open');
    // 3rd success → closed
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });
});

// ============================================================================
// Success tracking in closed state
// ============================================================================

describe('ClawCircuitBreaker success tracking', () => {
  it('resets failure count on success when closed', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.failureCount).toBe(2);
    cb.recordSuccess();
    expect(cb.failureCount).toBe(0);
  });

  it('stays closed on success when already closed', () => {
    const cb = new ClawCircuitBreaker();
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });
});

// ============================================================================
// Reset
// ============================================================================

describe('ClawCircuitBreaker reset', () => {
  it('resets open circuit to closed', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.state).toBe('open');
    cb.reset();
    expect(cb.state).toBe('closed');
    expect(cb.failureCount).toBe(0);
  });

  it('resets half-open circuit to closed', () => {
    vi.useFakeTimers();
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open
    cb.reset();
    expect(cb.state).toBe('closed');
    vi.useRealTimers();
  });

  it('resets closed circuit (no-op, state unchanged)', () => {
    const cb = new ClawCircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.reset();
    expect(cb.state).toBe('closed');
    expect(cb.failureCount).toBe(0);
  });

  it('resets consecutiveSuccesses', () => {
    vi.useFakeTimers();
    const cb = new ClawCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5_000,
      successThreshold: 3,
    });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open
    cb.recordSuccess();
    cb.recordSuccess();
    cb.reset();
    expect(cb.state).toBe('closed');
    // After reset, one success should not close (consecutiveSuccesses was zeroed)
    // Actually after reset we're in closed, so success just resets failureCount
    expect(cb['_consecutiveSuccesses']).toBe(0);
    vi.useRealTimers();
  });
});

// ============================================================================
// Snapshot
// ============================================================================

describe('ClawCircuitBreaker getSnapshot', () => {
  it('returns closed snapshot with zero values', () => {
    const cb = new ClawCircuitBreaker();
    const snap = cb.getSnapshot();
    expect(snap.state).toBe('closed');
    expect(snap.failureCount).toBe(0);
    expect(snap.lastFailureAt).toBe(0);
    expect(snap.nextAttemptAt).toBe(0);
    expect(snap.consecutiveSuccesses).toBe(0);
  });

  it('returns open snapshot with computed nextAttemptAt', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000 });
    cb.recordFailure();
    const snap = cb.getSnapshot();
    expect(snap.state).toBe('open');
    expect(snap.failureCount).toBe(1);
    expect(snap.lastFailureAt).toBeGreaterThan(0);
    expect(snap.nextAttemptAt).toBe(snap.lastFailureAt + 10_000);
  });

  it('returns half-open snapshot', () => {
    vi.useFakeTimers();
    const cb = new ClawCircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(6_000);
    cb.isOpen(); // → half-open
    const snap = cb.getSnapshot();
    expect(snap.state).toBe('half-open');
    vi.useRealTimers();
  });
});

// ============================================================================
// Custom options
// ============================================================================

describe('ClawCircuitBreaker custom options', () => {
  it('accepts failureThreshold = 1 (open on first failure)', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });

  it('accepts failureThreshold = 10', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 10 });
    for (let i = 0; i < 9; i++) {
      cb.recordFailure();
    }
    expect(cb.state).toBe('closed');
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });
});

// ============================================================================
// Custom options
// ============================================================================

describe('ClawCircuitBreaker constructor options', () => {
  it('accepts empty options and uses defaults', () => {
    const cb = new ClawCircuitBreaker();
    expect(cb['opts'].failureThreshold).toBe(5);
    expect(cb['opts'].cooldownMs).toBe(60_000);
    expect(cb['opts'].successThreshold).toBe(1);
  });

  it('merges partial options with defaults', () => {
    const cb = new ClawCircuitBreaker({ failureThreshold: 3 });
    expect(cb['opts'].failureThreshold).toBe(3);
    expect(cb['opts'].cooldownMs).toBe(60_000);
    expect(cb['opts'].successThreshold).toBe(1);
  });
});

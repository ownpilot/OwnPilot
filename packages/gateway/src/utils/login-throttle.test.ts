import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLoginThrottle } from './login-throttle.js';

describe('createLoginThrottle', () => {
  const opts = { maxAttempts: 5, windowMs: 10_000, lockoutMs: 30_000 };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  // ── check() — allowed path ────────────────────────────────────

  it('allows first attempt from an IP', () => {
    const throttle = createLoginThrottle(opts);
    const result = throttle.check('1.2.3.4');
    expect(result).toEqual({ allowed: true });
  });

  it('allows up to maxAttempts within the window', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    }
  });

  it('allows different IPs independently', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    }
    // Different IP is not affected
    expect(throttle.check('5.5.5.5')).toEqual({ allowed: true });
  });

  // ── check() — denied / lockout path ──────────────────────────

  it('denies the 6th attempt within the window and sets retryAfterMs', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) throttle.check('1.2.3.4');
    const result = throttle.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; retryAfterMs: number }).retryAfterMs).toBe(30_000);
  });

  it('continues to deny while locked out', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) throttle.check('1.2.3.4');
    const first = throttle.check('1.2.3.4');
    expect(first.allowed).toBe(false);

    // Subsequent calls during lockout return remaining time
    const second = throttle.check('1.2.3.4');
    expect(second.allowed).toBe(false);
    expect((second as { allowed: false; retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(30_000);
    expect((second as { allowed: false; retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
  });

  // ── check() — window expiry ───────────────────────────────────

  it('resets after the window expires', () => {
    vi.useFakeTimers();
    const throttle = createLoginThrottle(opts);

    for (let i = 0; i < 5; i++) throttle.check('1.2.3.4');
    expect(throttle.check('1.2.3.4').allowed).toBe(false); // locked out

    // Advance past both the window (10s) and lockout (30s)
    vi.advanceTimersByTime(31_000);

    // New window — allowed again
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
  });

  it('resets count after lockout expires but window still active', () => {
    vi.useFakeTimers();
    const throttle = createLoginThrottle(opts);

    // Exhaust attempts and get locked out
    for (let i = 0; i < 5; i++) throttle.check('1.2.3.4');
    throttle.check('1.2.3.4'); // locked

    // Advance past lockout but within window
    vi.advanceTimersByTime(31_000);

    // Window still active, but lockout expired — new attempt allowed
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
  });

  // ── recordFailure ─────────────────────────────────────────────

  it('recordFailure increments count on existing in-window entry', () => {
    const throttle = createLoginThrottle(opts);
    throttle.check('1.2.3.4'); // count = 1
    throttle.recordFailure('1.2.3.4'); // count = 2
    throttle.recordFailure('1.2.3.4'); // count = 3
    throttle.recordFailure('1.2.3.4'); // count = 4
    throttle.recordFailure('1.2.3.4'); // count = 5

    // 6th check should now be denied
    const result = throttle.check('1.2.3.4');
    expect(result.allowed).toBe(false);
  });

  it('recordFailure creates new entry if none exists', () => {
    const throttle = createLoginThrottle(opts);
    throttle.recordFailure('1.2.3.4'); // creates entry with count = 1
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
  });

  it('recordFailure sets lockout when count reaches maxAttempts', () => {
    const throttle = createLoginThrottle(opts);
    // Simulate 4 allowed checks, then 5th failure sets lockout
    throttle.check('1.2.3.4');
    throttle.check('1.2.3.4');
    throttle.check('1.2.3.4');
    throttle.check('1.2.3.4');
    throttle.recordFailure('1.2.3.4'); // count = 5, now locked

    const result = throttle.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; retryAfterMs: number }).retryAfterMs).toBe(30_000);
  });

  // ── recordSuccess ─────────────────────────────────────────────

  it('recordSuccess removes the entry and allows fresh attempts', () => {
    const throttle = createLoginThrottle(opts);
    throttle.check('1.2.3.4');
    throttle.check('1.2.3.4');
    throttle.recordSuccess('1.2.3.4');

    // Entry gone — full window restored
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    }
  });

  it('recordSuccess on unknown IP is no-op', () => {
    const throttle = createLoginThrottle(opts);
    expect(() => throttle.recordSuccess('9.9.9.9')).not.toThrow();
  });

  // ── cleanup ───────────────────────────────────────────────────

  it('cleanup removes expired entries', () => {
    vi.useFakeTimers();
    const throttle = createLoginThrottle(opts);

    throttle.check('1.2.3.4');
    throttle.check('5.5.5.5');

    // Advance past window and lockout for both
    vi.advanceTimersByTime(31_000);

    throttle.cleanup();

    // Both entries should be gone — fresh attempts allowed
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    expect(throttle.check('5.5.5.5')).toEqual({ allowed: true });
  });

  it('cleanup preserves active entries', () => {
    const throttle = createLoginThrottle(opts);

    throttle.check('1.2.3.4');
    throttle.check('1.2.3.4');

    throttle.cleanup();

    // Entry still active — 3rd attempt allowed, 4th and 5th too, 6th denied
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    expect(throttle.check('1.2.3.4').allowed).toBe(false);
  });
});

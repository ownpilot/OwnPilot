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
    expect((second as { allowed: false; retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(
      30_000
    );
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

  // Round 44: `check()` already admitted this request, so a failure must NOT
  // spend a second token. This replaces a test that asserted the old
  // double-increment arithmetic (check->1, recordFailure->2..5), which pinned
  // maxAttempts=5 down to 3 admitted logins.
  it('recordFailure marks the outcome without spending a second attempt', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.2.3.4').allowed).toBe(true); // one token per request
      throttle.recordFailure('1.2.3.4'); // outcome of that same request
    }
    // maxAttempts=5 means EXACTLY five admitted attempts: the 6th is the first denial.
    expect(throttle.check('1.2.3.4').allowed).toBe(false);
  });

  it('recordFailure creates new entry if none exists', () => {
    const throttle = createLoginThrottle(opts);
    throttle.recordFailure('1.2.3.4'); // creates entry with count = 1
    expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
  });

  // Round 44: the lockout is armed once the admitted attempts have used up the
  // budget — not half-way through it. Replaces the old 4-checks-then-1-failure
  // expectation, which only made sense when a failure cost two tokens.
  it('recordFailure arms the lockout exactly when the budget is exhausted', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 4; i++) {
      expect(throttle.check('1.2.3.4').allowed).toBe(true);
      throttle.recordFailure('1.2.3.4');
    }
    // Four admitted failures: budget (5) is not yet spent, so not locked out.
    expect(throttle.isLockedOut('1.2.3.4')).toBe(false);

    expect(throttle.check('1.2.3.4').allowed).toBe(true); // 5th = last token
    expect(throttle.isLockedOut('1.2.3.4')).toBe(false);
    throttle.recordFailure('1.2.3.4'); // budget now spent -> lockout armed

    const result = throttle.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(
      30_000
    );
  });

  // ── isLockedOut — non-mutating read ───────────────────────────
  // check() is a CONSUMING gate (it bumps count and can arm lockedUntil), so
  // diagnostics must read state through isLockedOut() instead. These guard the
  // round-43 regression: an audit-only `!check(ip).allowed` read spent a login
  // attempt on top of the one the request had already consumed.

  it('isLockedOut is false for an unknown IP and consumes nothing', () => {
    const throttle = createLoginThrottle(opts);
    expect(throttle.isLockedOut('9.9.9.9')).toBe(false);
    // Budget untouched — the full window of attempts is still available.
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('9.9.9.9')).toEqual({ allowed: true });
    }
    expect(throttle.check('9.9.9.9').allowed).toBe(false);
  });

  it('isLockedOut repeated reads never advance the bucket', () => {
    const throttle = createLoginThrottle(opts);
    throttle.check('1.2.3.4'); // count = 1
    for (let i = 0; i < 50; i++) expect(throttle.isLockedOut('1.2.3.4')).toBe(false);
    // Still exactly 1 consumed: 4 further checks allowed, the 6th denied.
    for (let i = 0; i < 4; i++) {
      expect(throttle.check('1.2.3.4')).toEqual({ allowed: true });
    }
    expect(throttle.check('1.2.3.4').allowed).toBe(false);
  });

  it('isLockedOut reports the lockout and clears when it expires', () => {
    vi.useFakeTimers();
    const throttle = createLoginThrottle(opts);
    expect(throttle.isLockedOut('1.2.3.4')).toBe(false);

    // Round 44: drive the lockout the way production does — check() admits the
    // attempt, recordFailure() marks its outcome. Bare recordFailure() calls no
    // longer spend tokens, so they cannot exhaust the budget on their own.
    for (let i = 0; i < 5; i++) {
      expect(throttle.check('1.2.3.4').allowed).toBe(true);
      throttle.recordFailure('1.2.3.4');
    }
    expect(throttle.isLockedOut('1.2.3.4')).toBe(true);

    vi.advanceTimersByTime(31_000); // past lockoutMs (30s)
    expect(throttle.isLockedOut('1.2.3.4')).toBe(false);
  });

  it('isLockedOut reflects a lockout armed by check() itself', () => {
    const throttle = createLoginThrottle(opts);
    for (let i = 0; i < 5; i++) throttle.check('1.2.3.4'); // exhaust budget
    expect(throttle.check('1.2.3.4').allowed).toBe(false); // arms lockedUntil
    expect(throttle.isLockedOut('1.2.3.4')).toBe(true);
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

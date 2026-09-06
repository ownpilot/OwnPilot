/**
 * Login rate limiter — shared between HTTP UI auth and WebSocket auth.
 * Per-IP attempt cap with window and lockout support.
 *
 * CONTRACT: `maxAttempts` means exactly N ADMITTED attempts per window, which is
 * one token per request regardless of outcome:
 *   - check()         — the consuming GATE. Counts the request as an attempt and
 *                       can arm the lockout when the budget is already spent.
 *   - recordFailure() — marks that attempt's OUTCOME. Spends no extra token; it
 *                       only arms the lockout once the budget is exhausted (and
 *                       self-counts when a caller never went through check()).
 *   - recordSuccess() — clears the bucket.
 *   - isLockedOut()   — non-mutating read for status/audit reporting.
 * Callers that gate on check() and then call recordFailure() for the same request
 * must not expect the failure to cost a second attempt (round 44).
 */

interface LoginThrottleOptions {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

interface LoginThrottleCheck {
  allowed: true;
}

interface LoginThrottleDenied {
  allowed: false;
  retryAfterMs: number;
}

type LoginThrottleResult = LoginThrottleCheck | LoginThrottleDenied;

interface ThrottleEntry {
  count: number;
  resetAt: number;
  lockedUntil: number;
}

/**
 * Create a login throttle instance.
 * Not tied to any transport — accepts a raw IP string so both HTTP (via getClientIp)
 * and WebSocket (via socket.remoteAddress) can share the same helper.
 */
export function createLoginThrottle(opts: LoginThrottleOptions) {
  const { maxAttempts, windowMs, lockoutMs } = opts;
  const attempts = new Map<string, ThrottleEntry>();

  function check(ip: string): LoginThrottleResult {
    const now = Date.now();
    const entry = attempts.get(ip);

    // Active lockout
    if (entry && entry.lockedUntil > now) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }

    // Within window
    if (entry && entry.resetAt > now) {
      if (entry.count >= maxAttempts) {
        const lockedUntil = now + lockoutMs;
        entry.lockedUntil = lockedUntil;
        return { allowed: false, retryAfterMs: lockoutMs };
      }
      entry.count++;
      return { allowed: true };
    }

    // New or expired window
    attempts.set(ip, { count: 1, resetAt: now + windowMs, lockedUntil: 0 });
    return { allowed: true };
  }

  /**
   * Mark the OUTCOME of an attempt as failed. Does NOT spend a second token.
   *
   * `check()` already counted this request as an attempt when it admitted it, so
   * incrementing here as well would make the bucket count half-attempts and
   * silently halve the configured budget (maxAttempts=5 admitted only 3 logins).
   * A failure only arms the lockout once the admitted attempts have used up the
   * budget. When no live window exists, the caller never went through `check()`,
   * so this failure is the first (and only) counted attempt of a new window.
   */
  function recordFailure(ip: string): void {
    const now = Date.now();
    const entry = attempts.get(ip);

    if (!entry || entry.resetAt <= now) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs, lockedUntil: 0 });
      return;
    }

    if (entry.count >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
    }
  }

  function recordSuccess(ip: string): void {
    attempts.delete(ip);
  }

  /**
   * Non-mutating lockout probe: reports whether `ip` is currently locked out
   * WITHOUT spending an attempt.
   *
   * `check()` is a consuming gate — it increments the bucket and can itself arm
   * `lockedUntil` when the count reaches maxAttempts. Use this for status/diagnostic
   * reads (audit fields, health reporting) so observing the state cannot change it.
   */
  function isLockedOut(ip: string): boolean {
    const entry = attempts.get(ip);
    return !!entry && entry.lockedUntil > Date.now();
  }

  function cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of attempts) {
      if (entry.resetAt <= now && entry.lockedUntil <= now) {
        attempts.delete(ip);
      }
    }
  }

  function reset(): void {
    attempts.clear();
  }

  return { check, isLockedOut, recordFailure, recordSuccess, cleanup, reset };
}

/**
 * Login rate limiter — shared between HTTP UI auth and WebSocket auth.
 * Per-IP attempt cap with window and lockout support.
 */

export interface LoginThrottleOptions {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

export interface LoginThrottleCheck {
  allowed: true;
}

export interface LoginThrottleDenied {
  allowed: false;
  retryAfterMs: number;
}

export type LoginThrottleResult = LoginThrottleCheck | LoginThrottleDenied;

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

  /** Periodic cleanup — unref so it doesn't block process exit */
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of attempts) {
      if (entry.resetAt <= now && entry.lockedUntil <= now) {
        attempts.delete(ip);
      }
    }
  }, 2 * 60_000);
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }

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

  function recordFailure(ip: string): void {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (entry && entry.resetAt > now) {
      entry.count++;
      if (entry.count >= maxAttempts) {
        entry.lockedUntil = now + lockoutMs;
      }
    } else {
      attempts.set(ip, { count: 1, resetAt: now + windowMs, lockedUntil: 0 });
    }
  }

  function recordSuccess(ip: string): void {
    attempts.delete(ip);
  }

  function reset(): void {
    attempts.clear();
  }

  return { check, recordFailure, recordSuccess, reset };
}

/**
 * Round 44 — real-throttle route regression.
 *
 * ui-auth.test.ts mocks createLoginThrottle WHOLESALE, so it cannot observe how
 * many tokens one request actually burns. That blind spot let two defects live in
 * the same line of code: the round-43 audit read that spent a token, and the
 * round-44 check()+recordFailure() double-count that spent two per failed login.
 *
 * This file is the real-collaborator counterpart (same pattern as
 * workspace/storage.quota.test.ts and memory/conversation-store.persistence.test.ts):
 * the real route and the real throttle, with ONLY ../services/ui-session.js
 * (crypto + DB) stubbed. It pins the contract that maxAttempts means exactly N
 * served attempts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/ui-session.js', () => ({
  hashPassword: vi.fn((pw: string) => `salt:${pw}-hashed`),
  verifyPassword: vi.fn(() => false), // every credential check fails
  createSession: vi.fn(),
  invalidateSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
  isPasswordConfigured: vi.fn(() => true),
  getPasswordHash: vi.fn(() => 'salt:anything-hashed'),
  setPasswordHash: vi.fn(),
  removePassword: vi.fn(),
  validateSession: vi.fn(() => false),
  getActiveSessionCount: vi.fn(() => 0),
}));

// Mirrors loginThrottle in routes/ui-auth.ts (maxAttempts 5, 5min window, 15min lockout).
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

async function freshRoute() {
  vi.resetModules(); // fresh module graph -> fresh module-level throttle bucket
  const { uiAuthRoutes } = await import('./ui-auth.js');
  return uiAuthRoutes;
}

async function wrongPassword(route: Awaited<ReturnType<typeof freshRoute>>) {
  return route.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'definitely-wrong' }),
  });
}

describe('POST /auth/login with the real throttle', () => {
  it('serves exactly maxAttempts wrong passwords, then 429 with Retry-After', async () => {
    const route = await freshRoute();
    const statuses: number[] = [];
    let retryAfter: string | null = null;

    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      const res = await wrongPassword(route);
      statuses.push(res.status);
      if (res.status === 429) {
        retryAfter = res.headers.get('Retry-After');
        break;
      }
    }

    // 403 = credentials were actually checked, i.e. the attempt was admitted.
    expect(statuses.filter((s) => s === 403)).toHaveLength(MAX_ATTEMPTS);
    expect(statuses.at(-1)).toBe(429);

    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(LOCKOUT_SECONDS);
  }, 30_000);

  it('arms the lockout only after the whole budget is spent, not half of it', async () => {
    const route = await freshRoute();

    // The first four attempts must all reach credential verification. A 429 in
    // this range means one request consumed more than one token.
    for (let i = 1; i <= 4; i++) {
      const res = await wrongPassword(route);
      expect(res.status, `attempt ${i}`).toBe(403);
    }
  }, 30_000);
});

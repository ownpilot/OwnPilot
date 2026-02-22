/**
 * Comprehensive tests for rate-limit middleware.
 *
 * Covers:
 *   - createRateLimitMiddleware (fixed-window)
 *   - createSlidingWindowRateLimiter (sliding-window)
 *   - stopAllRateLimiters
 *   - getClientIp behaviour (TRUST_PROXY on/off)
 *   - Disabled mode, path exclusion, headers, burst zone,
 *     soft vs hard limit, store overflow, window expiry, cleanup intervals.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// TRUST_PROXY must be set BEFORE the rate-limit module is evaluated.
// vi.hoisted() runs before any import, so this is the safe way to set
// module-level env vars that are read at import time.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  process.env.TRUSTED_PROXY = 'true';
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// SUT imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  createRateLimitMiddleware,
  createSlidingWindowRateLimiter,
  stopAllRateLimiters,
} from './rate-limit.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type MiddlewareFn = Parameters<Hono['use']>[0];

/**
 * Build a minimal Hono test application that mounts the given middleware on
 * every route, then registers:
 *   GET /test     -> 200 { ok: true }
 *   GET /health   -> 200 { healthy: true }
 *   GET /api/v1/health -> 200 { healthy: true }
 */
function createTestApp(middleware: MiddlewareFn) {
  const app = new Hono();
  app.use('*', middleware);
  app.get('/test', (c) => c.json({ ok: true }));
  app.get('/health', (c) => c.json({ healthy: true }));
  app.get('/api/v1/health', (c) => c.json({ healthy: true }));
  return app;
}

/**
 * Build a test app where every request carries a userId context value,
 * simulating an authenticated user upstream of the rate limiter.
 */
function createAuthenticatedApp(middleware: MiddlewareFn, userId = 'user-abc') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.use('*', middleware);
  app.get('/test', (c) => c.json({ ok: true }));
  app.get('/health', (c) => c.json({ healthy: true }));
  return app;
}

/**
 * Make N sequential requests to the given URL in the given app.
 * Returns the array of all responses.
 */
async function hitN(
  app: Hono,
  n: number,
  url = '/test',
  headers: Record<string, string> = {}
): Promise<Response[]> {
  const results: Response[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await app.request(url, { headers }));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Cleanup between every test — stop lingering cleanup intervals so that
// fake-timer tests don't bleed into each other.
// ---------------------------------------------------------------------------

afterEach(() => {
  stopAllRateLimiters();
  vi.useRealTimers();
});

// ===========================================================================
// createRateLimitMiddleware — fixed-window
// ===========================================================================

describe('createRateLimitMiddleware', () => {
  // -------------------------------------------------------------------------
  // Disabled mode
  // -------------------------------------------------------------------------

  describe('disabled mode', () => {
    it('passes every request through without any rate-limit headers', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 1_000,
        maxRequests: 1,
        disabled: true,
      });
      const app = createTestApp(mw);

      for (let i = 0; i < 10; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
        expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
        expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
      }
    });

    it('does not register a cleanup interval when disabled', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const countBefore = setIntervalSpy.mock.calls.length;

      createRateLimitMiddleware({
        windowMs: 1_000,
        maxRequests: 5,
        disabled: true,
      });

      expect(setIntervalSpy.mock.calls.length).toBe(countBefore);
      setIntervalSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Path exclusion
  // -------------------------------------------------------------------------

  describe('path exclusion', () => {
    it('skips /health by default regardless of request count', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      // Exhaust the limit on /test
      await hitN(app, 5, '/test');

      // /health must still return 200 with no rate-limit headers
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('skips /api/v1/health by default', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 5, '/test');

      const res = await app.request('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('uses startsWith matching so /health/deep is also excluded', async () => {
      const app = new Hono();
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      app.use('*', mw);
      app.get('/health/deep', (c) => c.json({ ok: true }));

      // Exhaust the default-key limit
      await app.request('/health/deep');
      await app.request('/health/deep');

      const res = await app.request('/health/deep');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('applies custom excludePaths and does NOT exclude the default paths', async () => {
      const app = new Hono();
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        excludePaths: ['/skip-me'],
      });
      app.use('*', mw);
      app.get('/skip-me', (c) => c.json({ ok: true }));
      app.get('/health', (c) => c.json({ ok: true }));

      await app.request('/health'); // count 1 for 'direct'

      // /health is NOT excluded because custom excludePaths replaces defaults
      const res = await app.request('/health'); // count 2 -> over burst (1)
      expect(res.status).toBe(429);

      // /skip-me IS excluded
      const skipped = await app.request('/skip-me');
      expect(skipped.status).toBe(200);
      expect(skipped.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('skips rate-limit processing entirely for excluded paths — no headers set', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/health');
      expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
      expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Key selection (userId vs IP)
  // -------------------------------------------------------------------------

  describe('key selection', () => {
    it('uses userId from context when available', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 2,
      });
      const app = createAuthenticatedApp(mw, 'user-42');

      await app.request('/test'); // count 1
      await app.request('/test'); // count 2

      const res = await app.request('/test'); // count 3 -> over burst
      expect(res.status).toBe(429);
    });

    it('different userIds have independent counters', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });

      const appA = createAuthenticatedApp(mw, 'user-A');
      const appB = createAuthenticatedApp(mw, 'user-B');

      // Note: both apps share the same middleware instance and therefore the same store.
      // user-A exhausts their budget…
      await hitN(appA, 2, '/test');
      const blockedA = await appA.request('/test');
      expect(blockedA.status).toBe(429);

      // …but user-B is unaffected
      const okB = await appB.request('/test');
      expect(okB.status).toBe(200);
    });

    it('falls back to ip:direct when TRUST_PROXY is true but no IP header present', async () => {
      // TRUST_PROXY is true (set via vi.hoisted), but no X-Forwarded-For or X-Real-IP header.
      // getClientIp should return 'unknown', key = 'ip:unknown'
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      const r1 = await app.request('/test'); // count 1 -> ok
      expect(r1.status).toBe(200);

      const r2 = await app.request('/test'); // count 2 -> over burst
      expect(r2.status).toBe(429);

      // A request with a different IP has its own counter
      const r3 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      });
      expect(r3.status).toBe(200);
    });

    it('extracts the first IP from X-Forwarded-For (TRUST_PROXY=true)', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      // Both requests carry the same first IP → same counter
      await app.request('/test', {
        headers: { 'X-Forwarded-For': '10.0.0.1, 192.168.1.1' },
      });
      const r2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '10.0.0.1, 172.16.0.1' },
      });
      expect(r2.status).toBe(429);
    });

    it('uses X-Real-IP when X-Forwarded-For is absent (TRUST_PROXY=true)', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await app.request('/test', { headers: { 'X-Real-IP': '5.5.5.5' } });
      const r2 = await app.request('/test', { headers: { 'X-Real-IP': '5.5.5.5' } });
      expect(r2.status).toBe(429);

      // Different real IP is a different counter
      const r3 = await app.request('/test', { headers: { 'X-Real-IP': '6.6.6.6' } });
      expect(r3.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Rate-limit headers
  // -------------------------------------------------------------------------

  describe('rate-limit headers', () => {
    it('sets X-RateLimit-Limit to maxRequests on every response', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 10,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    });

    it('decrements X-RateLimit-Remaining correctly', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 3,
      });
      const app = createTestApp(mw);

      const r1 = await app.request('/test');
      expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2');

      const r2 = await app.request('/test');
      expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1');

      const r3 = await app.request('/test');
      expect(r3.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('clamps X-RateLimit-Remaining to 0 when over the normal limit', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 3,
      });
      const app = createTestApp(mw);

      await app.request('/test'); // count 1 = maxRequests, remaining = 0
      const r2 = await app.request('/test'); // count 2, in burst, remaining = max(0, -1) = 0
      expect(r2.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('sets X-RateLimit-Reset to a positive integer (seconds until reset)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      const reset = parseInt(res.headers.get('X-RateLimit-Reset') ?? '0', 10);
      expect(reset).toBeGreaterThan(0);
      expect(reset).toBeLessThanOrEqual(60);
    });

    it('always sets all three standard headers on normal requests', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Limit')).not.toBeNull();
      expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
      expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Normal / under-limit behaviour
  // -------------------------------------------------------------------------

  describe('normal (under-limit) behaviour', () => {
    it('returns 200 for every request within the normal limit', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 5);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it('response body is unchanged by the middleware', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Burst zone (count > maxRequests && count <= burstLimit)
  // -------------------------------------------------------------------------

  describe('burst zone', () => {
    it('defaults burstLimit to floor(maxRequests * 1.5)', async () => {
      // maxRequests=4, burstLimit defaults to floor(4*1.5)=6
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 4,
      });
      const app = createTestApp(mw);

      // 4 normal + 2 burst = 6 allowed; 7th should be blocked
      const responses = await hitN(app, 6);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);
    });

    it('respects an explicit burstLimit', async () => {
      // maxRequests=2, burstLimit=4: requests 3 and 4 are burst, 5 is blocked
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      await hitN(app, 2); // normal
      const burst1 = await app.request('/test'); // count 3 — in burst
      const burst2 = await app.request('/test'); // count 4 — still in burst

      expect(burst1.status).toBe(200);
      expect(burst1.headers.get('X-RateLimit-Burst')).toBe('true');
      expect(burst2.status).toBe(200);
      expect(burst2.headers.get('X-RateLimit-Burst')).toBe('true');

      const blocked = await app.request('/test'); // count 5 — exceeds burst
      expect(blocked.status).toBe(429);
    });

    it('sets X-RateLimit-Burst=true when in burst zone', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 3,
      });
      const app = createTestApp(mw);

      await hitN(app, 2);
      const burst = await app.request('/test');
      expect(burst.headers.get('X-RateLimit-Burst')).toBe('true');
    });

    it('sets X-RateLimit-Burst-Remaining to burstLimit - count', async () => {
      // maxRequests=2, burstLimit=4, count 3 => remaining = 4-3 = 1
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      await hitN(app, 2); // exhaust normal

      const burst1 = await app.request('/test'); // count=3, remaining=4-3=1
      expect(burst1.headers.get('X-RateLimit-Burst-Remaining')).toBe('1');

      const burst2 = await app.request('/test'); // count=4, remaining=4-4=0
      expect(burst2.headers.get('X-RateLimit-Burst-Remaining')).toBe('0');
    });

    it('does NOT set X-RateLimit-Burst header on normal (non-burst) requests', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Burst')).toBeNull();
    });

    it('returns 200 for all requests in the burst zone', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 5,
      });
      const app = createTestApp(mw);

      await hitN(app, 2); // normal
      const bursts = await hitN(app, 3); // burst zone (3,4,5)
      for (const res of bursts) {
        expect(res.status).toBe(200);
      }
    });

    it('logs burst warning only on the first burst request (warned flag)', async () => {
      // We cannot inspect the logger directly, but we can verify functional correctness:
      // subsequent burst requests also succeed (warned=true does not block).
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      await app.request('/test'); // normal

      // Multiple burst requests should all succeed
      const b1 = await app.request('/test');
      const b2 = await app.request('/test');
      const b3 = await app.request('/test');
      expect(b1.status).toBe(200);
      expect(b2.status).toBe(200);
      expect(b3.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Over burst limit
  // -------------------------------------------------------------------------

  describe('over burst limit', () => {
    it('returns 429 for hard limit when count exceeds burstLimit', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 3,
      });
      const app = createTestApp(mw);

      await hitN(app, 3); // normal + burst

      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);
    });

    it('includes Retry-After header on hard-limit 429 responses', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const blocked = await app.request('/test');
      const retryAfter = blocked.headers.get('Retry-After');
      expect(retryAfter).not.toBeNull();
      expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);
    });

    it('response body has RATE_LIMITED error code on hard-limit block', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const blocked = await app.request('/test');
      const body = await blocked.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('error message includes retry wait time in seconds', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const mw = createRateLimitMiddleware({
        windowMs: 30_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const blocked = await app.request('/test');
      const body = await blocked.json();
      expect(body.error.message).toMatch(/\d+ second/);
    });

    it('continues blocking on every subsequent request once over burst', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);

      for (let i = 0; i < 5; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(429);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Soft limit mode
  // -------------------------------------------------------------------------

  describe('soft limit mode', () => {
    it('returns 200 when softLimit=true and count is over burstLimit', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 2,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 2); // normal + burst

      const soft = await app.request('/test'); // over burst, but soft
      expect(soft.status).toBe(200);
    });

    it('sets X-RateLimit-SoftLimit=true when soft-limiting', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const soft = await app.request('/test');
      expect(soft.headers.get('X-RateLimit-SoftLimit')).toBe('true');
    });

    it('sets X-RateLimit-Warning header with descriptive message', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const soft = await app.request('/test');
      const warning = soft.headers.get('X-RateLimit-Warning');
      expect(warning).not.toBeNull();
      expect(warning!.toLowerCase()).toContain('rate limit exceeded');
    });

    it('sets Retry-After on soft-limit responses too', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const soft = await app.request('/test');
      expect(soft.headers.get('Retry-After')).not.toBeNull();
    });

    it('does NOT set X-RateLimit-SoftLimit on burst-zone requests', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 3,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1); // normal
      const burst = await app.request('/test'); // burst zone, not over it
      expect(burst.headers.get('X-RateLimit-SoftLimit')).toBeNull();
    });

    it('continues serving 200s indefinitely in soft-limit mode', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 20);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Store overflow (maxStoreSize = 10_000)
  // -------------------------------------------------------------------------

  describe('store overflow', () => {
    it('returns 429 for a new client when the store is at capacity', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const windowMs = 60_000;
      const mw = createRateLimitMiddleware({ windowMs, maxRequests: 100 });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Fill the store with 10_000 unique IPs.
      // We TRUST_PROXY=true so X-Forwarded-For keys are ip:<value>.
      for (let i = 0; i < 10_000; i++) {
        const ip = `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
        await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      }

      // A brand-new IP must be rejected
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '99.99.99.99' },
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('RATE_LIMITED');
    }, 60_000 /* generous timeout for 10k requests */);

    it('allows an existing client to continue when store is full', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now());

      const windowMs = 60_000;
      const mw = createRateLimitMiddleware({ windowMs, maxRequests: 100 });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Seed the first IP (the one we will check again later)
      await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });

      // Fill to capacity with other IPs
      for (let i = 0; i < 9_999; i++) {
        const ip = `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
        await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      }

      // 1.1.1.1 is already in the store — it must NOT be rejected by the overflow guard
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });
      expect(res.status).toBe(200);
    }, 60_000);
  });

  // -------------------------------------------------------------------------
  // Window expiry and cleanup interval
  // -------------------------------------------------------------------------

  describe('window expiry', () => {
    it('resets the counter after the window expires', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const windowMs = 10_000;
      const mw = createRateLimitMiddleware({
        windowMs,
        maxRequests: 2,
        burstLimit: 2,
      });
      const app = createTestApp(mw);

      // Exhaust the budget
      await hitN(app, 2);
      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);

      // Advance past the window
      vi.setSystemTime(now + windowMs + 1);

      // Counter resets — new entry is created
      const res = await app.request('/test');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
    });

    it('cleanup interval removes expired entries', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const windowMs = 5_000;
      const mw = createRateLimitMiddleware({ windowMs, maxRequests: 100 });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Add an entry
      await app.request('/test', { headers: { 'X-Forwarded-For': '200.1.1.1' } });

      // Advance time beyond the window and trigger the cleanup interval
      vi.setSystemTime(now + windowMs + 1);
      vi.advanceTimersByTime(windowMs + 1);

      // After cleanup the entry is gone. If we advance time again past its reset window,
      // the next request should create a fresh entry with remaining = maxRequests - 1.
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '200.1.1.1' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
    });

    it('registers a cleanup interval tracked in activeIntervals', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const countBefore = setIntervalSpy.mock.calls.length;

      createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });

      expect(setIntervalSpy.mock.calls.length).toBe(countBefore + 1);
      setIntervalSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Exact boundary conditions
  // -------------------------------------------------------------------------

  describe('boundary conditions', () => {
    it('request exactly at maxRequests is still allowed (not blocked)', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 3,
        burstLimit: 3,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 3);
      const last = responses[responses.length - 1]!;
      expect(last.status).toBe(200);
      expect(last.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('request exactly at burstLimit is still allowed', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 4);
      const last = responses[responses.length - 1]!;
      expect(last.status).toBe(200);
      expect(last.headers.get('X-RateLimit-Burst')).toBe('true');
    });

    it('request at burstLimit + 1 is blocked (hard limit)', async () => {
      const mw = createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      await hitN(app, 4); // fills burst
      const res = await app.request('/test'); // count = 5 > burstLimit (4)
      expect(res.status).toBe(429);
    });
  });
});

// ===========================================================================
// createSlidingWindowRateLimiter
// ===========================================================================

describe('createSlidingWindowRateLimiter', () => {
  // -------------------------------------------------------------------------
  // Disabled mode
  // -------------------------------------------------------------------------

  describe('disabled mode', () => {
    it('passes every request through without any headers', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 1_000,
        maxRequests: 1,
        disabled: true,
      });
      const app = createTestApp(mw);

      for (let i = 0; i < 10; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
      }
    });

    it('does not register a cleanup interval when disabled', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const countBefore = setIntervalSpy.mock.calls.length;

      createSlidingWindowRateLimiter({
        windowMs: 1_000,
        maxRequests: 5,
        disabled: true,
      });

      expect(setIntervalSpy.mock.calls.length).toBe(countBefore);
      setIntervalSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Path exclusion
  // -------------------------------------------------------------------------

  describe('path exclusion', () => {
    it('skips /health by default', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 5, '/test');

      const res = await app.request('/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('skips /api/v1/health by default', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 5, '/test');

      const res = await app.request('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });

    it('honours custom excludePaths', async () => {
      const app = new Hono();
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        excludePaths: ['/skip'],
      });
      app.use('*', mw);
      app.get('/skip', (c) => c.json({ ok: true }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/skip');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Key selection
  // -------------------------------------------------------------------------

  describe('key selection', () => {
    it('uses userId from context when available', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createAuthenticatedApp(mw, 'slide-user');

      await app.request('/test'); // count 1

      const blocked = await app.request('/test'); // count 2 -> over burst
      expect(blocked.status).toBe(429);
    });

    it('separates different X-Forwarded-For addresses', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await app.request('/test', { headers: { 'X-Forwarded-For': '20.1.1.1' } });
      const blocked = await app.request('/test', {
        headers: { 'X-Forwarded-For': '20.1.1.1' },
      });
      expect(blocked.status).toBe(429);

      const other = await app.request('/test', {
        headers: { 'X-Forwarded-For': '20.1.1.2' },
      });
      expect(other.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Rate-limit headers
  // -------------------------------------------------------------------------

  describe('rate-limit headers', () => {
    it('sets X-RateLimit-Limit to maxRequests', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 7,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('7');
    });

    it('sets X-RateLimit-Remaining based on timestamps BEFORE current push', async () => {
      // Sliding window computes remaining = maxRequests - current_timestamps.length
      // (before appending current), so on the first request remaining equals maxRequests.
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 4,
      });
      const app = createTestApp(mw);

      const r1 = await app.request('/test'); // 0 in window -> remaining=4
      expect(r1.headers.get('X-RateLimit-Remaining')).toBe('4');

      const r2 = await app.request('/test'); // 1 in window -> remaining=3
      expect(r2.headers.get('X-RateLimit-Remaining')).toBe('3');

      const r3 = await app.request('/test'); // 2 in window -> remaining=2
      expect(r3.headers.get('X-RateLimit-Remaining')).toBe('2');
    });

    it('clamps X-RateLimit-Remaining to 0 when over maxRequests', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 4,
      });
      const app = createTestApp(mw);

      await hitN(app, 2); // 0 and 1 in window, remaining=0 on second
      const r = await app.request('/test'); // 2 in window, remaining=max(0,-1)=0
      expect(r.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('always sets both X-RateLimit-Limit and X-RateLimit-Remaining on normal responses', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Limit')).not.toBeNull();
      expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Normal / under-limit behaviour
  // -------------------------------------------------------------------------

  describe('normal (under-limit) behaviour', () => {
    it('returns 200 for every request within burstLimit', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 3,
        burstLimit: 5,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 5);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it('response body is unchanged by the middleware', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 5,
      });
      const app = createTestApp(mw);

      const res = await app.request('/test');
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Over burst limit (hard)
  // -------------------------------------------------------------------------

  describe('over burst limit — hard', () => {
    it('returns 429 when timestamps.length >= burstLimit', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
        burstLimit: 3,
      });
      const app = createTestApp(mw);

      await hitN(app, 3); // fills burst

      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);
    });

    it('includes RATE_LIMITED code in error body', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const blocked = await app.request('/test');
      const body = await blocked.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('sets Retry-After header computed from oldest timestamp in window', async () => {
      vi.useFakeTimers();
      const t0 = Date.now();
      vi.setSystemTime(t0);

      const windowMs = 10_000;
      const mw = createSlidingWindowRateLimiter({
        windowMs,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await app.request('/test'); // records timestamp at t0

      // Advance time by 3 seconds; oldest timestamp in window is t0
      // retryAfter = ceil((t0 + windowMs - now) / 1000) = ceil(7000/1000) = 7
      vi.setSystemTime(t0 + 3_000);

      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);

      const retryAfter = parseInt(blocked.headers.get('Retry-After') ?? '0', 10);
      expect(retryAfter).toBeGreaterThanOrEqual(6);
      expect(retryAfter).toBeLessThanOrEqual(8);
    });

    it('sets X-RateLimit-Reset on 429 responses', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const blocked = await app.request('/test');
      expect(blocked.headers.get('X-RateLimit-Reset')).not.toBeNull();
    });

    it('blocks every subsequent request once limit is reached', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);

      for (let i = 0; i < 5; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(429);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Over burst limit — soft
  // -------------------------------------------------------------------------

  describe('over burst limit — soft', () => {
    it('returns 200 in soft-limit mode when timestamps >= burstLimit', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 2,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 2);
      const soft = await app.request('/test');
      expect(soft.status).toBe(200);
    });

    it('sets X-RateLimit-SoftLimit=true in soft-limit mode', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const soft = await app.request('/test');
      expect(soft.headers.get('X-RateLimit-SoftLimit')).toBe('true');
    });

    it('caps timestamp array at burstLimit + 50 when soft-limiting', async () => {
      // This tests that soft-limit mode doesn't grow the array unboundedly.
      // After burstLimit + 50 entries, new timestamps are dropped.
      // We verify indirectly: all requests still return 200.
      const mw = createSlidingWindowRateLimiter({
        windowMs: 600_000, // large window so timestamps don't expire
        maxRequests: 1,
        burstLimit: 2,
        softLimit: true,
      });
      const app = createTestApp(mw);

      const responses = await hitN(app, 100);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it('sets Retry-After in soft-limit mode too', async () => {
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
        softLimit: true,
      });
      const app = createTestApp(mw);

      await hitN(app, 1);
      const soft = await app.request('/test');
      expect(soft.headers.get('Retry-After')).not.toBeNull();
    });

    it('pushes timestamp into the array in soft-limit mode (capped at burstLimit+50)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now());

      const windowMs = 600_000;
      const burstLimit = 2;
      const mw = createSlidingWindowRateLimiter({
        windowMs,
        maxRequests: 1,
        burstLimit,
        softLimit: true,
      });
      const app = createTestApp(mw);

      // burstLimit + 50 + 5 requests total:
      //   First burstLimit-1 requests are under the limit (push freely).
      //   At burstLimit the check triggers: timestamps.length >= burstLimit,
      //   soft path: push if < burstLimit + 50.
      //   We just verify they all return 200.
      const totalRequests = burstLimit + 50 + 5;
      const responses = await hitN(app, totalRequests);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Store overflow
  // -------------------------------------------------------------------------

  describe('store overflow', () => {
    it('returns 429 for a new client when store is at capacity', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now());

      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 100,
      });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      for (let i = 0; i < 10_000; i++) {
        const ip = `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
        await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      }

      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '99.99.99.99' },
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('RATE_LIMITED');
    }, 60_000);

    it('allows an existing client through when store is full', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now());

      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 100,
      });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Seed the first IP
      await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });

      // Fill to capacity
      for (let i = 0; i < 9_999; i++) {
        const ip = `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
        await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      }

      // Existing IP must still be allowed
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });
      expect(res.status).toBe(200);
    }, 60_000);
  });

  // -------------------------------------------------------------------------
  // Window expiry and cleanup
  // -------------------------------------------------------------------------

  describe('window expiry', () => {
    it('old timestamps outside the window are filtered out', async () => {
      vi.useFakeTimers();
      const t0 = Date.now();
      vi.setSystemTime(t0);

      const windowMs = 5_000;
      const mw = createSlidingWindowRateLimiter({
        windowMs,
        maxRequests: 2,
        burstLimit: 2,
      });
      const app = createTestApp(mw);

      // Exhaust the window
      await hitN(app, 2);
      expect((await app.request('/test')).status).toBe(429);

      // Jump past the window so all old timestamps are before the cutoff
      vi.setSystemTime(t0 + windowMs + 1);

      // Counter should reset (timestamps filtered out)
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });

    it('cleanup interval runs every windowMs/4 and removes stale keys', async () => {
      vi.useFakeTimers();
      const t0 = Date.now();
      vi.setSystemTime(t0);

      const windowMs = 8_000;
      const mw = createSlidingWindowRateLimiter({ windowMs, maxRequests: 100 });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Add an entry
      await app.request('/test', { headers: { 'X-Forwarded-For': '30.1.1.1' } });

      // Advance past the window and tick the cleanup interval (windowMs/4 = 2000 ms each)
      vi.setSystemTime(t0 + windowMs + 1);
      vi.advanceTimersByTime(windowMs / 4 + 1);

      // The next request should be treated as a fresh entry
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '30.1.1.1' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('100');
    });

    it('cleanup interval is registered at windowMs/4 period', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const windowMs = 8_000;
      createSlidingWindowRateLimiter({ windowMs, maxRequests: 10 });

      const lastCall = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1]!;
      expect(lastCall[1]).toBe(windowMs / 4);

      setIntervalSpy.mockRestore();
    });

    it('cleanup removes keys whose entire timestamp array expired but keeps active ones', async () => {
      vi.useFakeTimers();
      const t0 = Date.now();
      vi.setSystemTime(t0);

      const windowMs = 4_000;
      const mw = createSlidingWindowRateLimiter({ windowMs, maxRequests: 100 });
      const app = new Hono();
      app.use('*', mw);
      app.get('/test', (c) => c.json({ ok: true }));

      // Old IP — will expire
      await app.request('/test', { headers: { 'X-Forwarded-For': '50.1.1.1' } });

      // Advance time so that the old IP's timestamp is outside the window
      vi.setSystemTime(t0 + windowMs + 1);

      // Fresh IP — still active after the time jump
      await app.request('/test', { headers: { 'X-Forwarded-For': '50.1.1.2' } });

      // Trigger cleanup
      vi.advanceTimersByTime(windowMs / 4 + 1);

      // 50.1.1.1 was cleaned up; its next request creates a fresh entry
      const oldIpRes = await app.request('/test', {
        headers: { 'X-Forwarded-For': '50.1.1.1' },
      });
      expect(oldIpRes.headers.get('X-RateLimit-Remaining')).toBe('100');

      // 50.1.1.2 was NOT cleaned up (its timestamp is recent)
      const newIpRes = await app.request('/test', {
        headers: { 'X-Forwarded-For': '50.1.1.2' },
      });
      // 1 timestamp already in window -> remaining = 100 - 1 = 99
      expect(newIpRes.headers.get('X-RateLimit-Remaining')).toBe('99');
    });
  });

  // -------------------------------------------------------------------------
  // Default burstLimit for sliding window
  // -------------------------------------------------------------------------

  describe('burstLimit default', () => {
    it('defaults burstLimit to floor(maxRequests * 1.5)', async () => {
      // maxRequests=4 -> burstLimit=6
      const mw = createSlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 4,
      });
      const app = createTestApp(mw);

      // 6 requests should all succeed (0..5 < 6)
      const responses = await hitN(app, 6);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // 7th fills the limit (6 >= 6) -> blocked
      const blocked = await app.request('/test');
      expect(blocked.status).toBe(429);
    });
  });
});

// ===========================================================================
// stopAllRateLimiters
// ===========================================================================

describe('stopAllRateLimiters', () => {
  it('calls clearInterval for every interval registered by fixed-window limiters', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createRateLimitMiddleware({ windowMs: 10_000, maxRequests: 100 });
    createRateLimitMiddleware({ windowMs: 20_000, maxRequests: 200 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();
    expect(clearIntervalSpy.mock.calls.length).toBe(countBefore + 2);

    clearIntervalSpy.mockRestore();
  });

  it('calls clearInterval for every interval registered by sliding-window limiters', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createSlidingWindowRateLimiter({ windowMs: 10_000, maxRequests: 100 });
    createSlidingWindowRateLimiter({ windowMs: 20_000, maxRequests: 200 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();
    expect(clearIntervalSpy.mock.calls.length).toBe(countBefore + 2);

    clearIntervalSpy.mockRestore();
  });

  it('handles mixed fixed-window and sliding-window limiters', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });
    createSlidingWindowRateLimiter({ windowMs: 5_000, maxRequests: 10 });
    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();
    expect(clearIntervalSpy.mock.calls.length).toBe(countBefore + 3);

    clearIntervalSpy.mockRestore();
  });

  it('clears the activeIntervals set so subsequent calls are no-ops', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });

    stopAllRateLimiters();
    const countAfterFirst = clearIntervalSpy.mock.calls.length;

    stopAllRateLimiters(); // second call — nothing to clear
    expect(clearIntervalSpy.mock.calls.length).toBe(countAfterFirst);

    clearIntervalSpy.mockRestore();
  });

  it('is safe to call when no limiters have been created', () => {
    // stopAllRateLimiters called in afterEach already cleared everything.
    expect(() => stopAllRateLimiters()).not.toThrow();
  });

  it('is safe to call multiple times in succession', () => {
    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });

    expect(() => {
      stopAllRateLimiters();
      stopAllRateLimiters();
      stopAllRateLimiters();
    }).not.toThrow();
  });

  it('prevents cleanup intervals from firing after stop', async () => {
    vi.useFakeTimers();

    const windowMs = 5_000;
    createRateLimitMiddleware({ windowMs, maxRequests: 10 });

    stopAllRateLimiters();

    // Advancing timers should not cause any errors
    expect(() => vi.advanceTimersByTime(windowMs * 2)).not.toThrow();
  });
});

// ===========================================================================
// getClientIp — TRUST_PROXY behaviour
// ===========================================================================

describe('getClientIp via TRUST_PROXY=true', () => {
  // TRUST_PROXY was set to 'true' at module load time via vi.hoisted().

  it('identifies separate clients by X-Forwarded-For (fixed-window)', async () => {
    const mw = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    const r1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '11.22.33.44' },
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '11.22.33.44' },
    });
    expect(r2.status).toBe(429);

    const r3 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '55.66.77.88' },
    });
    expect(r3.status).toBe(200);
  });

  it('identifies separate clients by X-Forwarded-For (sliding-window)', async () => {
    const mw = createSlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    const r1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '11.22.33.44' },
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '11.22.33.44' },
    });
    expect(r2.status).toBe(429);

    const r3 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '55.66.77.88' },
    });
    expect(r3.status).toBe(200);
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent (fixed-window)', async () => {
    const mw = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    await app.request('/test', { headers: { 'X-Real-IP': '9.9.9.9' } });
    const r2 = await app.request('/test', { headers: { 'X-Real-IP': '9.9.9.9' } });
    expect(r2.status).toBe(429);
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent (sliding-window)', async () => {
    const mw = createSlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    await app.request('/test', { headers: { 'X-Real-IP': '9.9.9.9' } });
    const r2 = await app.request('/test', { headers: { 'X-Real-IP': '9.9.9.9' } });
    expect(r2.status).toBe(429);
  });

  it('uses "unknown" as IP when neither proxy header is present (fixed-window)', async () => {
    const mw = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    // No proxy headers → key = 'ip:unknown'
    await app.request('/test');
    const r2 = await app.request('/test');
    expect(r2.status).toBe(429);
  });

  it('uses "unknown" as IP when neither proxy header is present (sliding-window)', async () => {
    const mw = createSlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = createTestApp(mw);

    await app.request('/test');
    const r2 = await app.request('/test');
    expect(r2.status).toBe(429);
  });

  it('userId takes priority over X-Forwarded-For in key selection (fixed-window)', async () => {
    const mw = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    // App that sets userId AND sends an IP header
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'prio-user');
      return next();
    });
    app.use('*', mw);
    app.get('/test', (c) => c.json({ ok: true }));

    // Both requests carry a different IP, but userId is the same → same counter
    await app.request('/test', { headers: { 'X-Forwarded-For': '1.0.0.1' } });
    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '2.0.0.2' },
    });
    expect(r2.status).toBe(429);
  });

  it('userId takes priority over X-Forwarded-For in key selection (sliding-window)', async () => {
    const mw = createSlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 1,
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'prio-user-slide');
      return next();
    });
    app.use('*', mw);
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test', { headers: { 'X-Forwarded-For': '1.0.0.1' } });
    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '2.0.0.2' },
    });
    expect(r2.status).toBe(429);
  });
});

// ===========================================================================
// Cross-middleware: interval tracking across both middleware types
// ===========================================================================

describe('activeIntervals set — cross-middleware tracking', () => {
  it('stopAllRateLimiters clears intervals from both middleware types created together', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });
    createSlidingWindowRateLimiter({ windowMs: 5_000, maxRequests: 10 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();

    // Should have called clearInterval exactly twice (one per middleware)
    expect(clearIntervalSpy.mock.calls.length - countBefore).toBe(2);

    clearIntervalSpy.mockRestore();
  });

  it('creating new limiters after stopAllRateLimiters works correctly', async () => {
    // First generation
    createRateLimitMiddleware({ windowMs: 5_000, maxRequests: 10 });
    stopAllRateLimiters();

    // Second generation — should work normally
    const mw = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 3,
      burstLimit: 3,
    });
    const app = createTestApp(mw);

    const responses = await hitN(app, 3);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const blocked = await app.request('/test');
    expect(blocked.status).toBe(429);
  });
});

/**
 * Comprehensive tests for auth, rate-limit, and error-handler middleware.
 *
 * Covers: createAuthMiddleware, createOptionalAuthMiddleware,
 *         createRateLimitMiddleware, createSlidingWindowRateLimiter,
 *         stopAllRateLimiters, errorHandler, notFoundHandler
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// ---------------------------------------------------------------------------
// Set TRUSTED_PROXY before rate-limit module loads (reads env at import time)
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
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { createAuthMiddleware, createOptionalAuthMiddleware } from './auth.js';
import {
  createRateLimitMiddleware,
  createSlidingWindowRateLimiter,
  stopAllRateLimiters,
} from './rate-limit.js';
import { errorHandler, notFoundHandler } from './error-handler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-key-that-is-long-enough-32+';

/**
 * Build a signed HS256 JWT with the given claims.
 */
async function signToken(
  claims: Record<string, unknown>,
  secret: string = JWT_SECRET,
  expiresIn: string = '1h'
) {
  const key = createSecretKey(Buffer.from(secret, 'utf-8'));
  let builder = new SignJWT(claims as Record<string, unknown>).setProtectedHeader({ alg: 'HS256' });
  if (claims.sub) {
    builder = builder.setSubject(claims.sub as string);
  }
  if (expiresIn === 'expired') {
    builder = builder.setExpirationTime(Math.floor(Date.now() / 1000) - 3600);
  } else {
    builder = builder.setExpirationTime(expiresIn);
  }
  return builder.sign(key);
}

// ---------------------------------------------------------------------------
// Cleanup — stop all rate-limiter intervals between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  stopAllRateLimiters();
});

// ==========================================================================
// AUTH MIDDLEWARE
// ==========================================================================

describe('createAuthMiddleware', () => {
  // ---- type: none --------------------------------------------------------

  describe('type: none', () => {
    it('should pass through without any authentication', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ type: 'none' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });
  });

  // ---- type: api-key -----------------------------------------------------

  describe('type: api-key', () => {
    const API_KEYS = ['key-alpha-12345678', 'key-bravo-87654321'];

    function createApp() {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ type: 'api-key', apiKeys: API_KEYS }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));
      return app;
    }

    it('should accept a valid key via Authorization Bearer header', async () => {
      const app = createApp();
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${API_KEYS[0]}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toContain('apikey:');
    });

    it('should accept a valid key via X-API-Key header', async () => {
      const app = createApp();
      const res = await app.request('/test', {
        headers: { 'X-API-Key': API_KEYS[1] },
      });

      expect(res.status).toBe(200);
    });

    it('should return 401 when no API key is provided', async () => {
      const app = createApp();
      const res = await app.request('/test');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('API key required');
    });

    it('should return 403 for an invalid API key', async () => {
      const app = createApp();
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer wrong-key' },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ACCESS_DENIED');
      expect(body.error.message).toBe('Invalid API key');
    });

    it('should return 403 when apiKeys array is empty', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ type: 'api-key', apiKeys: [] }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer anything' },
      });

      expect(res.status).toBe(403);
    });

    it('should set userId with truncated key prefix', async () => {
      const app = createApp();
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${API_KEYS[0]}` },
      });

      const body = await res.json();
      // userId format: apikey:<first-8-chars>...
      expect(body.userId).toBe(`apikey:${API_KEYS[0].slice(0, 8)}...`);
    });

    it('should prefer Authorization Bearer over X-API-Key when both present', async () => {
      const app = createApp();
      const res = await app.request('/test', {
        headers: {
          Authorization: `Bearer ${API_KEYS[0]}`,
          'X-API-Key': API_KEYS[1],
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe(`apikey:${API_KEYS[0].slice(0, 8)}...`);
    });
  });

  // ---- type: jwt ---------------------------------------------------------

  describe('type: jwt', () => {
    function createApp(secret: string = JWT_SECRET) {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ type: 'jwt', jwtSecret: secret }));
      app.get('/test', (c) => c.json({ userId: c.get('userId'), payload: c.get('jwtPayload') }));
      return app;
    }

    it('should accept a valid JWT and set userId + jwtPayload', async () => {
      const app = createApp();
      const token = await signToken({ sub: 'user-42', role: 'admin' });

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-42');
      expect(body.payload.role).toBe('admin');
    });

    it('should return 401 when no token is provided', async () => {
      const app = createApp();
      const res = await app.request('/test');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('JWT token required');
    });

    it('should return 403 for an expired token', async () => {
      const app = createApp();
      const token = await signToken({ sub: 'user-99' }, JWT_SECRET, 'expired');

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ACCESS_DENIED');
    });

    it('should return 403 when jwt secret is shorter than 32 characters', async () => {
      const app = createApp('short-secret');
      const token = await signToken({ sub: 'user-1' }, JWT_SECRET);

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('at least 32 characters');
    });

    it('should return 403 for a token signed with wrong secret', async () => {
      const app = createApp();
      const wrongSecret = 'a-completely-different-secret-that-is-long-enough!!';
      const token = await signToken({ sub: 'user-1' }, wrongSecret);

      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 for a token missing the sub claim', async () => {
      const key = createSecretKey(Buffer.from(JWT_SECRET, 'utf-8'));
      const token = await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(key);

      const app = createApp();
      const res = await app.request('/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('sub');
    });

    it('should return 503 when jwtSecret is not configured', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ type: 'jwt' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('should return 401 when Authorization header lacks Bearer prefix', async () => {
      const app = createApp();
      const token = await signToken({ sub: 'user-1' });

      const res = await app.request('/test', {
        headers: { Authorization: token },
      });

      expect(res.status).toBe(401);
    });
  });
});

// ==========================================================================
// OPTIONAL AUTH MIDDLEWARE
// ==========================================================================

describe('createOptionalAuthMiddleware', () => {
  it('should pass through when no auth is provided (api-key mode)', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys: ['key-123456789'] }));
    app.get('/test', (c) => c.json({ userId: c.get('userId') ?? null }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('should set userId when a valid api-key is provided', async () => {
    const key = 'key-123456789';
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys: [key] }));
    app.get('/test', (c) => c.json({ userId: c.get('userId') ?? null }));

    const res = await app.request('/test', {
      headers: { 'X-API-Key': key },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${key.slice(0, 8)}...`);
  });

  it('should not set userId for an invalid api-key', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys: ['real-key-long'] }));
    app.get('/test', (c) => c.json({ userId: c.get('userId') ?? null }));

    const res = await app.request('/test', {
      headers: { 'X-API-Key': 'fake-key-long' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('should pass through with type none', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'none' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('should set userId and jwtPayload with a valid JWT', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET }));
    app.get('/test', (c) =>
      c.json({ userId: c.get('userId') ?? null, payload: c.get('jwtPayload') ?? null })
    );

    const token = await signToken({ sub: 'user-opt-1' });
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-opt-1');
    expect(body.payload).not.toBeNull();
  });

  it('should pass through with an invalid JWT without blocking', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET }));
    app.get('/test', (c) => c.json({ userId: c.get('userId') ?? null }));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('should pass through without auth header in JWT mode', async () => {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET }));
    app.get('/test', (c) => c.json({ userId: c.get('userId') ?? null }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });
});

// ==========================================================================
// FIXED WINDOW RATE LIMITER
// ==========================================================================

describe('createRateLimitMiddleware', () => {
  function createApp(config: Parameters<typeof createRateLimitMiddleware>[0]) {
    const app = new Hono();
    app.use('*', createRateLimitMiddleware(config));
    app.get('/test', (c) => c.json({ ok: true }));
    app.get('/health', (c) => c.json({ status: 'ok' }));
    app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));
    return app;
  }

  it('should pass through when disabled', async () => {
    const app = createApp({ windowMs: 1000, maxRequests: 1, disabled: true });

    const res1 = await app.request('/test');
    const res2 = await app.request('/test');
    const res3 = await app.request('/test');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
    // No rate limit headers when disabled
    expect(res1.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('should allow requests under the limit and set rate-limit headers', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 5 });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
  });

  it('should decrement remaining header on each request', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 3 });

    const r1 = await app.request('/test');
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2');

    const r2 = await app.request('/test');
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1');

    const r3 = await app.request('/test');
    expect(r3.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('should allow burst requests between maxRequests and burstLimit', async () => {
    // maxRequests=2, burstLimit=4
    const app = createApp({ windowMs: 60_000, maxRequests: 2, burstLimit: 4 });

    await app.request('/test'); // 1 - normal
    await app.request('/test'); // 2 - normal

    const burst = await app.request('/test'); // 3 - burst
    expect(burst.status).toBe(200);
    expect(burst.headers.get('X-RateLimit-Burst')).toBe('true');
    expect(burst.headers.get('X-RateLimit-Burst-Remaining')).toBe('1');
  });

  it('should return 429 when exceeding burst limit', async () => {
    // maxRequests=2, burstLimit=3
    const app = createApp({ windowMs: 60_000, maxRequests: 2, burstLimit: 3 });

    await app.request('/test'); // 1
    await app.request('/test'); // 2
    await app.request('/test'); // 3 - burst

    const blocked = await app.request('/test'); // 4 - over burst
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeDefined();
    const body = await blocked.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('should return 200 in soft-limit mode even when over burst', async () => {
    const app = createApp({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 2,
      softLimit: true,
    });

    await app.request('/test'); // 1 - normal
    await app.request('/test'); // 2 - burst

    const soft = await app.request('/test'); // 3 - over burst, but soft
    expect(soft.status).toBe(200);
    expect(soft.headers.get('X-RateLimit-SoftLimit')).toBe('true');
    expect(soft.headers.get('X-RateLimit-Warning')).toBeDefined();
    expect(soft.headers.get('Retry-After')).toBeDefined();
  });

  it('should exclude configured paths from rate limiting', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 1 });

    await app.request('/test'); // 1 - uses up the limit

    // Default excludePaths includes /health
    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('X-RateLimit-Limit')).toBeNull();

    // /api/v1/health is also excluded by default
    const apiHealthRes = await app.request('/api/v1/health');
    expect(apiHealthRes.status).toBe(200);
    expect(apiHealthRes.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('should exclude custom paths from rate limiting', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        windowMs: 60_000,
        maxRequests: 1,
        excludePaths: ['/skip'],
      })
    );
    app.get('/skip', (c) => c.json({ skipped: true }));
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test'); // uses up limit

    const skipRes = await app.request('/skip');
    expect(skipRes.status).toBe(200);
    expect(skipRes.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('should use X-Forwarded-For header to identify clients', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 1, burstLimit: 1 });

    // Client A
    const r1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    expect(r1.status).toBe(200);

    // Client A again -- over burst
    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    expect(r2.status).toBe(429);

    // Client B -- separate budget
    const r3 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '5.6.7.8' },
    });
    expect(r3.status).toBe(200);
  });

  it('should use only the first IP from X-Forwarded-For', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 1, burstLimit: 1 });

    const r1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2' },
    });
    expect(r1.status).toBe(200);

    // Same first IP but different chain -- should still count as same client
    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.1.1.1, 9.9.9.9' },
    });
    expect(r2.status).toBe(429);
  });
});

// ==========================================================================
// SLIDING WINDOW RATE LIMITER
// ==========================================================================

describe('createSlidingWindowRateLimiter', () => {
  function createApp(config: Parameters<typeof createSlidingWindowRateLimiter>[0]) {
    const app = new Hono();
    app.use('*', createSlidingWindowRateLimiter(config));
    app.get('/test', (c) => c.json({ ok: true }));
    app.get('/health', (c) => c.json({ status: 'ok' }));
    return app;
  }

  it('should pass through when disabled', async () => {
    const app = createApp({ windowMs: 1000, maxRequests: 1, disabled: true });

    const r1 = await app.request('/test');
    const r2 = await app.request('/test');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('should allow requests under the limit with headers', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 5 });

    // Sliding window computes remaining BEFORE recording the current request,
    // so on the first call timestamps.length is 0 and remaining = maxRequests.
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('5');
  });

  it('should return 429 when exceeding burst limit', async () => {
    // maxRequests=2, burstLimit=3
    const app = createApp({ windowMs: 60_000, maxRequests: 2, burstLimit: 3 });

    await app.request('/test'); // 1
    await app.request('/test'); // 2
    await app.request('/test'); // 3 -- fills burst

    const blocked = await app.request('/test'); // 4 -- over burst
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeDefined();
    const body = await blocked.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('should allow soft-limit mode when over burst', async () => {
    const app = createApp({
      windowMs: 60_000,
      maxRequests: 1,
      burstLimit: 2,
      softLimit: true,
    });

    await app.request('/test'); // 1
    await app.request('/test'); // 2 -- fills burst

    const soft = await app.request('/test'); // 3 -- over burst but soft
    expect(soft.status).toBe(200);
    expect(soft.headers.get('X-RateLimit-SoftLimit')).toBe('true');
  });

  it('should exclude configured paths from limiting', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 1, burstLimit: 1 });

    await app.request('/test'); // uses up limit

    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  it('should decrement remaining as requests come in', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 3 });

    // Sliding window sets remaining = maxRequests - timestamps.length
    // computed BEFORE the current timestamp is pushed.
    const r1 = await app.request('/test'); // 0 in store => remaining 3
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('3');

    const r2 = await app.request('/test'); // 1 in store => remaining 2
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('2');

    const r3 = await app.request('/test'); // 2 in store => remaining 1
    expect(r3.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('should use X-Forwarded-For to separate clients', async () => {
    const app = createApp({ windowMs: 60_000, maxRequests: 1, burstLimit: 1 });

    const r1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '10.0.0.1' },
    });
    expect(r1.status).toBe(200);

    // same client -- blocked
    const r2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '10.0.0.1' },
    });
    expect(r2.status).toBe(429);

    // different client -- allowed
    const r3 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '10.0.0.2' },
    });
    expect(r3.status).toBe(200);
  });
});

// ==========================================================================
// stopAllRateLimiters
// ==========================================================================

describe('stopAllRateLimiters', () => {
  it('should clear intervals created by fixed-window limiter', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    // Create a limiter which registers an interval
    createRateLimitMiddleware({ windowMs: 10_000, maxRequests: 100 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(countBefore);

    clearIntervalSpy.mockRestore();
  });

  it('should clear intervals created by sliding-window limiter', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    createSlidingWindowRateLimiter({ windowMs: 10_000, maxRequests: 100 });

    const countBefore = clearIntervalSpy.mock.calls.length;
    stopAllRateLimiters();
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(countBefore);

    clearIntervalSpy.mockRestore();
  });

  it('should be safe to call multiple times', () => {
    createRateLimitMiddleware({ windowMs: 10_000, maxRequests: 10 });
    stopAllRateLimiters();
    // Second call should not throw
    expect(() => stopAllRateLimiters()).not.toThrow();
  });
});

// ==========================================================================
// ERROR HANDLER
// ==========================================================================

describe('errorHandler', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  function createApp(routes: (app: Hono) => void) {
    const app = new Hono();
    routes(app);
    app.onError(errorHandler);
    return app;
  }

  it('should handle HTTPException and return the correct status', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new HTTPException(422, { message: 'Unprocessable' });
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Unprocessable');
    expect(body.meta).toBeDefined();
    expect(body.meta.timestamp).toBeDefined();
  });

  it('should map HTTPException 401 to UNAUTHORIZED code', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new HTTPException(401, { message: 'Not authenticated' });
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should map HTTPException 403 to FORBIDDEN code', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new HTTPException(403, { message: 'Forbidden action' });
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('should map HTTPException 404 to NOT_FOUND code', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new HTTPException(404, { message: 'Missing resource' });
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should map HTTPException 429 to RATE_LIMITED code', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new HTTPException(429, { message: 'Too many' });
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('should handle SyntaxError with JSON in message as 400', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        const err = new SyntaxError('Unexpected token in JSON at position 0');
        throw err;
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Invalid JSON in request body');
  });

  it('should treat Validation failed: errors as 400', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new Error('Validation failed: name is required');
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed: name is required');
  });

  it('should return 500 with generic message for unknown errors', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new Error('Database connection failed');
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('should include error details in development mode', async () => {
    process.env.NODE_ENV = 'development';

    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new Error('Secret database info');
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.details).toBeDefined();
    expect(body.error.details.message).toBe('Secret database info');
  });

  it('should not include error details in production mode', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new Error('Secret database info');
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.details).toBeUndefined();
  });

  it('should include requestId in meta', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('requestId', 'req-abc-123');
      await next();
    });
    app.get('/throw', () => {
      throw new Error('boom');
    });
    app.onError(errorHandler);

    const res = await app.request('/throw');
    const body = await res.json();
    expect(body.meta.requestId).toBe('req-abc-123');
  });

  it('should default requestId to unknown when not set', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new Error('boom');
      });
    });

    const res = await app.request('/throw');
    const body = await res.json();
    expect(body.meta.requestId).toBe('unknown');
  });

  it('should handle SyntaxError without JSON in message as 500', async () => {
    const app = createApp((a) => {
      a.get('/throw', () => {
        throw new SyntaxError('Unexpected identifier');
      });
    });

    const res = await app.request('/throw');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ==========================================================================
// NOT FOUND HANDLER
// ==========================================================================

describe('notFoundHandler', () => {
  function createApp() {
    const app = new Hono();
    app.get('/exists', (c) => c.json({ ok: true }));
    app.notFound(notFoundHandler);
    return app;
  }

  it('should return 404 for unknown routes', async () => {
    const app = createApp();
    const res = await app.request('/nope');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Route not found');
    expect(body.error.message).toContain('/nope');
  });

  it('should include request method in the message', async () => {
    const app = createApp();
    const res = await app.request('/missing', { method: 'POST' });

    const body = await res.json();
    expect(body.error.message).toContain('POST');
    expect(body.error.message).toContain('/missing');
  });

  it('should sanitize special characters from path', async () => {
    const app = createApp();
    const res = await app.request('/test<script>alert(1)</script>');

    const body = await res.json();
    // The regex in notFoundHandler strips non [a-zA-Z0-9/.\-~%] chars
    expect(body.error.message).not.toContain('<');
    expect(body.error.message).not.toContain('>');
    expect(body.error.message).not.toContain('(');
    expect(body.error.message).not.toContain(')');
  });

  it('should default requestId to unknown', async () => {
    const app = createApp();
    const res = await app.request('/ghost');

    const body = await res.json();
    expect(body.meta.requestId).toBe('unknown');
  });

  it('should include timestamp in meta', async () => {
    const app = createApp();
    const res = await app.request('/ghost');

    const body = await res.json();
    expect(body.meta.timestamp).toBeDefined();
    // Should be valid ISO string
    expect(() => new Date(body.meta.timestamp)).not.toThrow();
    expect(new Date(body.meta.timestamp).toISOString()).toBe(body.meta.timestamp);
  });
});

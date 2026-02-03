import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestId } from './request-id.js';
import { timing } from './timing.js';
import { createAuthMiddleware } from './auth.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { errorHandler, notFoundHandler } from './error-handler.js';

describe('Request ID Middleware', () => {
  const app = new Hono();
  app.use('*', requestId);
  app.get('/test', (c) => c.json({ requestId: c.get('requestId') }));

  it('generates request ID if not provided', async () => {
    const res = await app.request('/test');
    const json = await res.json();

    expect(json.requestId).toBeDefined();
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('X-Request-ID')).toBe(json.requestId);
  });

  it('uses provided request ID', async () => {
    const customId = 'custom-request-id-123';
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': customId },
    });
    const json = await res.json();

    expect(json.requestId).toBe(customId);
    expect(res.headers.get('X-Request-ID')).toBe(customId);
  });
});

describe('Timing Middleware', () => {
  const app = new Hono();
  app.use('*', timing);
  app.get('/test', (c) => c.json({ ok: true }));

  it('adds response time header', async () => {
    const res = await app.request('/test');

    const responseTime = res.headers.get('X-Response-Time');
    expect(responseTime).toBeDefined();
    expect(responseTime).toMatch(/^\d+\.\d+ms$/);
  });
});

describe('Auth Middleware', () => {
  describe('API Key Auth', () => {
    const app = new Hono();
    app.use(
      '*',
      createAuthMiddleware({
        type: 'api-key',
        apiKeys: ['valid-key-1', 'valid-key-2'],
      })
    );
    app.get('/test', (c) => c.json({ userId: c.get('userId') }));

    it('accepts valid API key in Authorization header', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer valid-key-1' },
      });

      expect(res.status).toBe(200);
    });

    it('accepts valid API key in X-API-Key header', async () => {
      const res = await app.request('/test', {
        headers: { 'X-API-Key': 'valid-key-2' },
      });

      expect(res.status).toBe(200);
    });

    it('rejects request without API key', async () => {
      const res = await app.request('/test');

      expect(res.status).toBe(401);
    });

    it('rejects invalid API key', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer invalid-key' },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('No Auth', () => {
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'none' }));
    app.get('/test', (c) => c.json({ ok: true }));

    it('allows requests without authentication', async () => {
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });
  });
});

describe('Rate Limit Middleware', () => {
  const createApp = () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        windowMs: 1000,
        maxRequests: 3,
      })
    );
    app.get('/test', (c) => c.json({ ok: true }));
    return app;
  };

  it('allows requests within limit', async () => {
    const app = createApp();

    const res1 = await app.request('/test');
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

    const res2 = await app.request('/test');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('allows burst requests within burst limit', async () => {
    const app = createApp();
    // maxRequests = 3, burstLimit = floor(3 * 1.5) = 4

    await app.request('/test'); // 1 - within limit
    await app.request('/test'); // 2 - within limit
    await app.request('/test'); // 3 - within limit

    const res = await app.request('/test'); // 4 - within burst
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Burst')).toBe('true');
  });

  it('blocks requests over burst limit', async () => {
    const app = createApp();
    // maxRequests = 3, burstLimit = floor(3 * 1.5) = 4
    // So we need 5 requests to exceed the burst limit

    await app.request('/test'); // 1
    await app.request('/test'); // 2
    await app.request('/test'); // 3
    await app.request('/test'); // 4 - burst
    await app.request('/test'); // 5 - exceeds burst

    const res = await app.request('/test'); // 6 - blocked
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
  });
});

describe('Error Handler', () => {
  const app = new Hono();
  app.use('*', requestId);
  app.get('/error', () => {
    throw new Error('Test error');
  });
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  it('handles unexpected errors', async () => {
    const res = await app.request('/error');
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles 404', async () => {
    const res = await app.request('/nonexistent');
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.hoisted(() => {
  delete process.env.TRUSTED_PROXY;
  delete process.env.TRUSTED_PROXY_IPS;
});

import {
  createRateLimitMiddleware,
  createSlidingWindowRateLimiter,
  stopAllRateLimiters,
} from './rate-limit.js';

const originalHost = process.env.HOST;

function createApp(
  middleware:
    ReturnType<typeof createRateLimitMiddleware> | ReturnType<typeof createSlidingWindowRateLimiter>
) {
  const app = new Hono();
  app.use('*', middleware);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

afterEach(() => {
  stopAllRateLimiters();
  if (originalHost === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = originalHost;
  }
});

describe.each([
  ['fixed window', createRateLimitMiddleware],
  ['sliding window', createSlidingWindowRateLimiter],
] as const)('%s direct-client handling', (_name, createLimiter) => {
  it('applies a shared rate limit when the gateway is network-exposed', async () => {
    process.env.HOST = '0.0.0.0';
    const app = createApp(
      createLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      })
    );

    expect((await app.request('/test')).status).toBe(200);
    const blocked = await app.request('/test');

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('1');
  });

  it('keeps direct local development traffic exempt on a loopback bind', async () => {
    process.env.HOST = '127.0.0.1';
    const app = createApp(
      createLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        burstLimit: 1,
      })
    );

    for (let i = 0; i < 3; i++) {
      const response = await app.request('/test');
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    }
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import { setShuttingDown, resetShuttingDown } from '../src/api/routes.ts';

/**
 * Graceful draining tests — R1 CRITICAL audit fix.
 * Validates that after setShuttingDown():
 *   - Authenticated endpoints return 503
 *   - /ping still works (health probes)
 *   - 503 includes proper error body
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  resetShuttingDown();
  await app.close();
});

beforeEach(() => {
  resetShuttingDown();
});

describe('graceful draining — 503 during shutdown', () => {
  it('GET /health returns 200 before shutdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health returns 503 after setShuttingDown()', async () => {
    setShuttingDown();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.type).toBe('service_unavailable');
    expect(body.error.message).toContain('shutting down');
  });

  it('GET /ping still returns 200 during shutdown (health probes)', async () => {
    setShuttingDown();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pong).toBe(true);
  });

  it('POST /v1/chat/completions returns 503 during shutdown', async () => {
    setShuttingDown();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: TEST_AUTH_HEADER,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        model: 'bridge-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /version returns 503 during shutdown', async () => {
    setShuttingDown();
    const res = await app.inject({
      method: 'GET',
      url: '/version',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /metrics returns 503 during shutdown', async () => {
    setShuttingDown();
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(503);
  });

  it('503 response includes Retry-After header', async () => {
    setShuttingDown();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('resetShuttingDown restores normal operation', async () => {
    setShuttingDown();
    // 503 during shutdown
    const res1 = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res1.statusCode).toBe(503);

    // Reset
    resetShuttingDown();

    // 200 after reset
    const res2 = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res2.statusCode).toBe(200);
  });
});

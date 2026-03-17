import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, TEST_AUTH_HEADER } from '../helpers/build-app.ts';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /v1/events', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with empty events when since_id is far future', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?since_id=999999999',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.count).toBe(0);
    expect(body.since_id).toBe(999999999);
  });

  it('returns 200 with since_id=0 (all buffered events)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?since_id=0',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.count).toBe('number');
    expect(body.since_id).toBe(0);
  });

  it('respects limit parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?since_id=0&limit=1',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events.length).toBeLessThanOrEqual(1);
  });

  it('caps limit at 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?since_id=0&limit=9999',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events.length).toBeLessThanOrEqual(200);
  });

  it('accepts project_dir filter without error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?project_dir=%2Fhome%2Fayaz%2Ftest',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });
});

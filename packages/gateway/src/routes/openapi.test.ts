/**
 * OpenAPI routes tests
 *
 * Integration test: registers the OpenAPI routes alongside a handful of
 * fake API endpoints and verifies the served spec covers them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { registerOpenApiRoutes } from './openapi.js';

describe('OpenAPI routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.get('/api/v1/claws', (c) => c.json({ ok: true }));
    app.post('/api/v1/claws/:clawId/start', (c) => c.json({ ok: true }));
    app.get('/health', (c) => c.text('ok'));
    registerOpenApiRoutes(app);
  });

  it('GET /openapi.json returns a valid OpenAPI 3.1 envelope', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const spec = (await res.json()) as Record<string, unknown>;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
  });

  it('includes registered API routes and converts path params', async () => {
    const res = await app.request('/openapi.json');
    const spec = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/api/v1/claws']).toBeDefined();
    expect(spec.paths['/api/v1/claws']!.get).toBeDefined();
    expect(spec.paths['/api/v1/claws/{clawId}/start']).toBeDefined();
    expect(spec.paths['/api/v1/claws/{clawId}/start']!.post).toBeDefined();
  });

  it('excludes /health from the spec', async () => {
    const res = await app.request('/openapi.json');
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/health']).toBeUndefined();
  });

  it('caches the spec across calls', async () => {
    const a = await (await app.request('/openapi.json')).json();
    const b = await (await app.request('/openapi.json')).json();
    expect(a).toEqual(b);
  });

  it('GET /docs serves the Swagger UI HTML', async () => {
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('swagger-ui');
    expect(html).toContain('/openapi.json');
  });

  describe('API-001 production gate', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ENABLE_API_DOCS;
    afterEach(() => {
      process.env.NODE_ENV = prevEnv;
      if (prevFlag === undefined) delete process.env.ENABLE_API_DOCS;
      else process.env.ENABLE_API_DOCS = prevFlag;
    });

    it('does not register docs in production by default', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_API_DOCS;
      const prod = new Hono();
      registerOpenApiRoutes(prod);
      expect((await prod.request('/openapi.json')).status).toBe(404);
      expect((await prod.request('/docs')).status).toBe(404);
    });

    it('registers docs in production when ENABLE_API_DOCS=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_API_DOCS = 'true';
      const prod = new Hono();
      registerOpenApiRoutes(prod);
      expect((await prod.request('/openapi.json')).status).toBe(200);
      expect((await prod.request('/docs')).status).toBe(200);
    });
  });
});

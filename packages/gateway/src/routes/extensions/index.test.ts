/**
 * Extensions Routes - Barrel Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./crud.js', () => ({
  crudRoutes: new Hono().get('/extensions', (c: any) => c.json({ route: 'crud' })),
}));
vi.mock('./install.js', () => ({
  installRoutes: new Hono().post('/extensions/upload', (c: any) => c.json({ route: 'install' })),
}));
vi.mock('./generation.js', () => ({
  generationRoutes: new Hono().post('/extensions/generate', (c: any) =>
    c.json({ route: 'generation' })
  ),
}));
vi.mock('./scanner.js', () => ({
  scannerRoutes: new Hono().get('/extensions/scan', (c: any) => c.json({ route: 'scanner' })),
}));
vi.mock('./audit.js', () => ({
  auditRoutes: new Hono().get('/extensions/:id/audit', (c: any) => c.json({ route: 'audit' })),
}));
vi.mock('./eval.js', () => ({
  evalRoutes: new Hono().post('/extensions/:id/eval/run', (c: any) => c.json({ route: 'eval' })),
}));
vi.mock('./packaging.js', () => ({
  packagingRoutes: new Hono().get('/extensions/:id/package', (c: any) =>
    c.json({ route: 'packaging' })
  ),
}));

import { extensionsRoutes } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extensionsRoutes barrel', () => {
  it('exports a Hono app', () => {
    expect(extensionsRoutes).toBeDefined();
    expect(typeof extensionsRoutes.fetch).toBe('function');
  });

  it('routes GET /extensions to crud router', async () => {
    const res = await extensionsRoutes.request('/extensions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('crud');
  });

  it('routes POST /extensions/upload to install router', async () => {
    const res = await extensionsRoutes.request('/extensions/upload', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('install');
  });

  it('routes POST /extensions/generate to generation router', async () => {
    const res = await extensionsRoutes.request('/extensions/generate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('generation');
  });

  it('routes GET /extensions/scan to scanner router', async () => {
    const res = await extensionsRoutes.request('/extensions/scan');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('scanner');
  });
});

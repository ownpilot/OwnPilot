/**
 * Model Configs Routes - Barrel Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./models.js', () => ({
  modelRoutes: new Hono().get('/models', (c: any) => c.json({ route: 'models' })),
}));
vi.mock('./providers.js', () => ({
  providerRoutes: new Hono().get('/providers', (c: any) => c.json({ route: 'providers' })),
}));
vi.mock('./pricing.js', () => ({
  pricingRoutes: new Hono().get('/sync', (c: any) => c.json({ route: 'pricing' })),
}));

import { modelConfigsRoutes } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('modelConfigsRoutes barrel', () => {
  it('exports a Hono app', () => {
    expect(modelConfigsRoutes).toBeDefined();
    expect(typeof modelConfigsRoutes.fetch).toBe('function');
  });

  it('routes GET /models to model router', async () => {
    const res = await modelConfigsRoutes.request('/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('models');
  });

  it('routes GET /providers to provider router', async () => {
    const res = await modelConfigsRoutes.request('/providers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('providers');
  });

  it('routes GET /sync to pricing router', async () => {
    const res = await modelConfigsRoutes.request('/sync');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('pricing');
  });
});

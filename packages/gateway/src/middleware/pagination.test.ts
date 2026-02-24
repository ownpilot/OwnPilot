/**
 * Pagination Middleware Tests
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { pagination, type PaginationParams } from './pagination.js';

function createApp(config?: Parameters<typeof pagination>[0]) {
  const app = new Hono();
  app.get('/items', pagination(config), (c) => {
    const p = c.get('pagination') as PaginationParams;
    return c.json(p);
  });
  return app;
}

async function getPagination(
  app: ReturnType<typeof createApp>,
  query: string = ''
): Promise<PaginationParams> {
  const res = await app.request(`/items${query ? `?${query}` : ''}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe('Pagination Middleware', () => {
  describe('defaults (no config)', () => {
    const app = createApp();

    it('returns default limit=20 and offset=0 when no query params', async () => {
      const p = await getPagination(app);
      expect(p).toEqual({ limit: 20, offset: 0 });
    });

    it('parses limit and offset from query string', async () => {
      const p = await getPagination(app, 'limit=50&offset=10');
      expect(p).toEqual({ limit: 50, offset: 10 });
    });

    it('clamps limit to minimum of 1', async () => {
      const p = await getPagination(app, 'limit=0');
      expect(p.limit).toBe(1);
    });

    it('clamps limit to maximum of 100 (default maxLimit)', async () => {
      const p = await getPagination(app, 'limit=500');
      expect(p.limit).toBe(100);
    });

    it('clamps negative limit to 1', async () => {
      const p = await getPagination(app, 'limit=-10');
      expect(p.limit).toBe(1);
    });

    it('clamps negative offset to 0', async () => {
      const p = await getPagination(app, 'offset=-5');
      expect(p.offset).toBe(0);
    });

    it('uses default limit when limit is not a number', async () => {
      const p = await getPagination(app, 'limit=abc');
      expect(p.limit).toBe(20);
    });

    it('uses 0 offset when offset is not a number', async () => {
      const p = await getPagination(app, 'offset=abc');
      expect(p.offset).toBe(0);
    });

    it('caps offset to MAX_PAGINATION_OFFSET', async () => {
      const p = await getPagination(app, 'offset=999999');
      expect(p.offset).toBe(10_000);
    });
  });

  describe('custom config', () => {
    it('respects custom defaultLimit', async () => {
      const app = createApp({ defaultLimit: 50 });
      const p = await getPagination(app);
      expect(p.limit).toBe(50);
    });

    it('respects custom maxLimit', async () => {
      const app = createApp({ maxLimit: 200 });
      const p = await getPagination(app, 'limit=300');
      expect(p.limit).toBe(200);
    });

    it('respects custom maxOffset', async () => {
      const app = createApp({ maxOffset: 500 });
      const p = await getPagination(app, 'offset=1000');
      expect(p.offset).toBe(500);
    });

    it('uses custom defaultLimit when query limit is NaN', async () => {
      const app = createApp({ defaultLimit: 75 });
      const p = await getPagination(app, 'limit=xyz');
      expect(p.limit).toBe(75);
    });

    it('custom defaultLimit is still clamped by maxLimit', async () => {
      const app = createApp({ defaultLimit: 200, maxLimit: 50 });
      const p = await getPagination(app);
      expect(p.limit).toBe(50);
    });
  });

  describe('edge cases', () => {
    const app = createApp();

    it('handles limit=1 (minimum valid)', async () => {
      const p = await getPagination(app, 'limit=1');
      expect(p.limit).toBe(1);
    });

    it('handles limit=100 (exactly at default max)', async () => {
      const p = await getPagination(app, 'limit=100');
      expect(p.limit).toBe(100);
    });

    it('handles offset=0 (minimum valid)', async () => {
      const p = await getPagination(app, 'offset=0');
      expect(p.offset).toBe(0);
    });

    it('handles float values by truncating to integer', async () => {
      const p = await getPagination(app, 'limit=10.9&offset=5.7');
      expect(p.limit).toBe(10);
      expect(p.offset).toBe(5);
    });

    it('only affects pagination route, not other routes', async () => {
      const app2 = new Hono();
      app2.get('/items', pagination(), (c) => {
        return c.json(c.get('pagination'));
      });
      app2.get('/other', (c) => {
        return c.json({ pagination: c.get('pagination') ?? null });
      });

      const res = await app2.request('/other');
      const json = await res.json();
      expect(json.pagination).toBeNull();
    });
  });

  describe('middleware chaining', () => {
    it('calls next() and allows handler to run', async () => {
      const app = new Hono();
      app.get('/items', pagination(), (c) => {
        const { limit, offset } = c.get('pagination') as PaginationParams;
        return c.json({ items: [], limit, offset, custom: 'data' });
      });

      const res = await app.request('/items?limit=5&offset=2');
      const json = await res.json();
      expect(json).toEqual({ items: [], limit: 5, offset: 2, custom: 'data' });
    });
  });
});

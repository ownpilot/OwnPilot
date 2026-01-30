import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { healthRoutes } from './health.js';
import { requestId } from '../middleware/request-id.js';

describe('Health Routes', () => {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/health', healthRoutes);

  describe('GET /health', () => {
    it('returns health status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      // Status depends on Docker/DB availability in test environment
      expect(['healthy', 'degraded', 'unhealthy']).toContain(json.data.status);
      expect(json.data.version).toBeDefined();
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
      expect(json.data.checks).toBeInstanceOf(Array);
    });

    it('includes request metadata', async () => {
      const res = await app.request('/health');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });

  describe('GET /health/live', () => {
    it('returns liveness status', async () => {
      const res = await app.request('/health/live');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe('ok');
    });
  });

  describe('GET /health/ready', () => {
    it('returns readiness status', async () => {
      const res = await app.request('/health/ready');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe('ok');
    });
  });
});

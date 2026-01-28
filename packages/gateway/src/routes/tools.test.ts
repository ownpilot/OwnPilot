import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { toolsRoutes } from './tools.js';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

describe('Tools Routes', () => {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/tools', toolsRoutes);
  app.onError(errorHandler);

  describe('GET /tools', () => {
    it('returns list of core tools', async () => {
      const res = await app.request('/tools');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThan(0);

      // Check core tools are present
      const toolNames = json.data.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('get_current_time');
      expect(toolNames).toContain('calculate');
      expect(toolNames).toContain('generate_uuid');
    });

    it('each tool has required fields', async () => {
      const res = await app.request('/tools');
      const json = await res.json();

      for (const tool of json.data) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      }
    });
  });

  describe('GET /tools/:name', () => {
    it('returns tool details', async () => {
      const res = await app.request('/tools/calculate');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('calculate');
      expect(json.data.description).toBeDefined();
      expect(json.data.parameters).toBeDefined();
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/tools/nonexistent');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /tools/:name/execute', () => {
    it('executes calculate tool', async () => {
      const res = await app.request('/tools/calculate/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { expression: '2 + 2' } }),
      });

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tool).toBe('calculate');
      expect(json.data.result).toBe('4');
    });

    it('executes generate_uuid tool', async () => {
      const res = await app.request('/tools/generate_uuid/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tool).toBe('generate_uuid');
      // UUID format check
      expect(json.data.result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/tools/nonexistent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(404);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { toolsRoutes } from './tools.js';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

describe('Tools Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use('*', requestId);
    app.route('/tools', toolsRoutes);
    app.onError(errorHandler);
  });

  // ========================================================================
  // GET /tools
  // ========================================================================

  describe('GET /tools', () => {
    it('returns list of core tools', async () => {
      const res = await app.request('/tools');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThan(0);

      // Check core tools are present (tools have core. namespace prefix)
      const toolNames = json.data.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('core.get_current_time');
      expect(toolNames).toContain('core.calculate');
      expect(toolNames).toContain('core.generate_uuid');
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

    it('returns grouped tools when grouped=true', async () => {
      const res = await app.request('/tools?grouped=true');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.categories).toBeDefined();
      expect(json.data.totalTools).toBeGreaterThan(0);
    });

    it('filters tools with workflowUsable=true', async () => {
      const res = await app.request('/tools?workflowUsable=true');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      // All returned tools should not have workflowUsable === false
      for (const tool of json.data) {
        expect(tool.workflowUsable).not.toBe(false);
      }
    });

    it('filters tools with workflowUsable=false', async () => {
      const res = await app.request('/tools?workflowUsable=false');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      // Only tools explicitly marked workflowUsable=false
      for (const tool of json.data) {
        expect(tool.workflowUsable).toBe(false);
      }
    });
  });

  // ========================================================================
  // GET /tools/meta/categories
  // ========================================================================

  describe('GET /tools/meta/categories', () => {
    it('returns categories with counts', async () => {
      const res = await app.request('/tools/meta/categories');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(typeof json.data).toBe('object');

      // At least one category should exist with a count
      const categories = Object.values(json.data) as Array<{ count: number; icon: string; description: string }>;
      expect(categories.length).toBeGreaterThan(0);

      for (const cat of categories) {
        expect(typeof cat.count).toBe('number');
        expect(cat.count).toBeGreaterThan(0);
        expect(cat.icon).toBeDefined();
        expect(cat.description).toBeDefined();
      }
    });
  });

  // ========================================================================
  // GET /tools/meta/grouped
  // ========================================================================

  describe('GET /tools/meta/grouped', () => {
    it('returns tools grouped by category', async () => {
      const res = await app.request('/tools/meta/grouped');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.categories).toBeDefined();
      expect(json.data.totalTools).toBeGreaterThan(0);
      expect(json.data.totalCategories).toBeGreaterThan(0);

      // Each category has info and tools array
      for (const [_categoryId, cat] of Object.entries(json.data.categories) as Array<[string, { info: unknown; tools: unknown[] }]>) {
        expect(cat.info).toBeDefined();
        expect(cat.tools).toBeInstanceOf(Array);
        expect(cat.tools.length).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // GET /tools/:name
  // ========================================================================

  describe('GET /tools/:name', () => {
    it('returns tool details', async () => {
      const res = await app.request('/tools/calculate');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('core.calculate');
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

    it('finds tool by qualified name', async () => {
      const res = await app.request('/tools/core.calculate');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.name).toBe('core.calculate');
    });
  });

  // ========================================================================
  // GET /tools/:name/source
  // ========================================================================

  describe('GET /tools/:name/source', () => {
    it('returns source code for a known tool', async () => {
      const res = await app.request('/tools/calculate/source');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('calculate');
      expect(json.data.source).toBeDefined();
      expect(typeof json.data.source).toBe('string');
    });

    it('returns 404 for unknown tool source', async () => {
      const res = await app.request('/tools/totally_fake_tool/source');
      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /tools/:name/execute
  // ========================================================================

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
      // Tool returns structured JSON; verify result contains the answer
      const parsed = JSON.parse(json.data.result);
      expect(parsed.result).toBe(4);
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
      // Tool returns structured JSON; extract uuid and check format
      const parsed = JSON.parse(json.data.result);
      expect(parsed.uuid).toMatch(
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

    it('returns duration in response', async () => {
      const res = await app.request('/tools/generate_uuid/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      const json = await res.json();
      expect(typeof json.data.duration).toBe('number');
      expect(json.data.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // POST /tools/:name/stream
  // ========================================================================

  describe('POST /tools/:name/stream', () => {
    it('streams tool execution events', async () => {
      const res = await app.request('/tools/generate_uuid/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const text = await res.text();
      // SSE events should contain start, result, and complete
      expect(text).toContain('event: start');
      expect(text).toContain('event: result');
      expect(text).toContain('event: complete');
    });

    it('streams error event for unknown tool', async () => {
      const res = await app.request('/tools/nonexistent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('event: error');
    });
  });

  // ========================================================================
  // POST /tools/batch
  // ========================================================================

  describe('POST /tools/batch', () => {
    it('executes multiple tools in parallel', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executions: [
            { tool: 'generate_uuid', arguments: {} },
            { tool: 'calculate', arguments: { expression: '1+1' } },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.results).toHaveLength(2);
      expect(json.data.successCount).toBe(2);
      expect(json.data.failureCount).toBe(0);
      expect(typeof json.data.totalDuration).toBe('number');
    });

    it('executes sequentially when parallel=false', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executions: [
            { tool: 'generate_uuid', arguments: {} },
          ],
          parallel: false,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results).toHaveLength(1);
      expect(json.data.successCount).toBe(1);
    });

    it('returns 400 when executions is missing', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when batch size exceeds 20', async () => {
      const executions = Array.from({ length: 21 }, () => ({
        tool: 'generate_uuid',
        arguments: {},
      }));

      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executions }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('maximum');
    });

    it('handles mixed success and failure in batch', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executions: [
            { tool: 'generate_uuid', arguments: {} },
            { tool: 'nonexistent_tool_xyz', arguments: {} },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.successCount).toBe(1);
      expect(json.data.failureCount).toBe(1);
    });

    it('includes duration for each batch result', async () => {
      const res = await app.request('/tools/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executions: [{ tool: 'generate_uuid', arguments: {} }],
        }),
      });

      const json = await res.json();
      expect(typeof json.data.results[0].duration).toBe('number');
    });
  });
});

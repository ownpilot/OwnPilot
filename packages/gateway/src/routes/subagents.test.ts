/**
 * Subagent Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  spawn: vi.fn(),
  getSession: vi.fn(),
  getResult: vi.fn(),
  cancel: vi.fn(),
  listByParent: vi.fn().mockReturnValue([]),
  getHistory: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
};

vi.mock('../services/subagent-service.js', () => ({
  getSubagentService: () => mockService,
}));

// Import after mocks
const { subagentRoutes } = await import('./subagents.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/subagents', subagentRoutes);
  app.onError(errorHandler);
  return app;
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    parentId: 'conv-1',
    parentType: 'chat',
    userId: 'default',
    name: 'Research',
    task: 'Research pricing',
    state: 'running',
    spawnedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    turnsUsed: 0,
    toolCallsUsed: 0,
    tokensUsed: null,
    durationMs: null,
    result: null,
    error: null,
    toolCalls: [],
    provider: 'openai',
    model: 'gpt-4o-mini',
    limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Subagent Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // -------------------------------------------------------------------------
  // GET /
  // -------------------------------------------------------------------------

  describe('GET /subagents', () => {
    it('returns empty array without parentId', async () => {
      const res = await app.request('/subagents');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual([]);
    });

    it('returns sessions when parentId is provided', async () => {
      mockService.listByParent.mockReturnValue([makeSession()]);

      const res = await app.request('/subagents?parentId=conv-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].name).toBe('Research');
    });
  });

  // -------------------------------------------------------------------------
  // POST /
  // -------------------------------------------------------------------------

  describe('POST /subagents', () => {
    it('spawns a subagent and returns 201', async () => {
      mockService.spawn.mockResolvedValue(makeSession({ id: 'sub-new' }));

      const res = await app.request('/subagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Research', task: 'Find pricing data' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('sub-new');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/subagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Do something' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('name');
    });

    it('returns 400 when task is missing', async () => {
      const res = await app.request('/subagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Research' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 500 when spawn fails', async () => {
      mockService.spawn.mockRejectedValue(new Error('Budget exceeded'));

      const res = await app.request('/subagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', task: 'Do it' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Budget exceeded');
    });
  });

  // -------------------------------------------------------------------------
  // GET /history
  // -------------------------------------------------------------------------

  describe('GET /subagents/history', () => {
    it('returns history data', async () => {
      mockService.getHistory.mockResolvedValue({
        entries: [{ id: 'sub-1', name: 'Research', state: 'completed' }],
        total: 1,
      });

      const res = await app.request('/subagents/history?parentId=conv-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET /:id
  // -------------------------------------------------------------------------

  describe('GET /subagents/:id', () => {
    it('returns session by ID', async () => {
      mockService.getSession.mockReturnValue(makeSession({ id: 'sub-42' }));

      const res = await app.request('/subagents/sub-42');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('sub-42');
    });

    it('returns 404 when not found', async () => {
      mockService.getSession.mockReturnValue(null);

      const res = await app.request('/subagents/sub-999');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('not found');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /:id
  // -------------------------------------------------------------------------

  describe('DELETE /subagents/:id', () => {
    it('cancels a subagent and returns success', async () => {
      mockService.cancel.mockReturnValue(true);

      const res = await app.request('/subagents/sub-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('cancelled');
    });

    it('returns 404 when cancel fails', async () => {
      mockService.cancel.mockReturnValue(false);

      const res = await app.request('/subagents/sub-999', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });
});

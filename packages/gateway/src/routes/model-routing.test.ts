/**
 * Model Routing Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAllRouting = vi.fn(() => ({
  chat: { provider: null, model: null, fallbackProvider: null, fallbackModel: null },
  telegram: { provider: null, model: null, fallbackProvider: null, fallbackModel: null },
  pulse: { provider: null, model: null, fallbackProvider: null, fallbackModel: null },
}));

const mockGetProcessRouting = vi.fn(() => ({
  provider: null,
  model: null,
  fallbackProvider: null,
  fallbackModel: null,
}));

const mockResolveForProcess = vi.fn(async () => ({
  provider: 'openai',
  model: 'gpt-4o',
  fallbackProvider: null,
  fallbackModel: null,
  source: 'global' as const,
}));

const mockSetProcessRouting = vi.fn(async () => {});
const mockClearProcessRouting = vi.fn(async () => {});

vi.mock('../services/model-routing.js', () => ({
  getAllRouting: (...args: unknown[]) => mockGetAllRouting(...args),
  getProcessRouting: (...args: unknown[]) => mockGetProcessRouting(...args),
  resolveForProcess: (...args: unknown[]) => mockResolveForProcess(...args),
  setProcessRouting: (...args: unknown[]) => mockSetProcessRouting(...args),
  clearProcessRouting: (...args: unknown[]) => mockClearProcessRouting(...args),
  isValidProcess: (p: string) => ['chat', 'telegram', 'pulse'].includes(p),
  VALID_PROCESSES: ['chat', 'telegram', 'pulse'],
}));

import { modelRoutingRoutes } from './model-routing.js';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = new Hono();
  app.route('/model-routing', modelRoutingRoutes);
  return app;
}

function json(res: Response) {
  return res.json();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('model-routing routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ── GET / ──────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns all routing configs and resolved values', async () => {
      const res = await app.request('/model-routing');
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.data.routing).toBeDefined();
      expect(body.data.resolved).toBeDefined();
      expect(mockGetAllRouting).toHaveBeenCalled();
      expect(mockResolveForProcess).toHaveBeenCalledTimes(3);
    });
  });

  // ── GET /:process ──────────────────────────────────────────────────

  describe('GET /:process', () => {
    it('returns routing for a valid process', async () => {
      const res = await app.request('/model-routing/chat');
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.data.routing).toBeDefined();
      expect(body.data.resolved).toBeDefined();
      expect(mockGetProcessRouting).toHaveBeenCalledWith('chat');
    });

    it('returns 400 for invalid process', async () => {
      const res = await app.request('/model-routing/invalid');
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.success).toBe(false);
    });
  });

  // ── PUT /:process ──────────────────────────────────────────────────

  describe('PUT /:process', () => {
    it('updates routing and returns new state', async () => {
      const payload = { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
      mockGetProcessRouting.mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        fallbackProvider: null,
        fallbackModel: null,
      });

      const res = await app.request('/model-routing/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(mockSetProcessRouting).toHaveBeenCalledWith('chat', payload);
      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.data.routing.provider).toBe('anthropic');
    });

    it('returns 400 for invalid process', async () => {
      const res = await app.request('/model-routing/bad', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.request('/model-routing/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when field is too long', async () => {
      const res = await app.request('/model-routing/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error.message).toContain('too long');
    });

    it('returns 400 when field is not a string', async () => {
      const res = await app.request('/model-routing/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 123 }),
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error.message).toContain('must be a string');
    });

    it('accepts null values for fields', async () => {
      const res = await app.request('/model-routing/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: null, model: null }),
      });
      expect(res.status).toBe(200);
      expect(mockSetProcessRouting).toHaveBeenCalledWith('chat', {
        provider: null,
        model: null,
      });
    });
  });

  // ── DELETE /:process ───────────────────────────────────────────────

  describe('DELETE /:process', () => {
    it('clears routing and returns success', async () => {
      const res = await app.request('/model-routing/telegram', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(mockClearProcessRouting).toHaveBeenCalledWith('telegram');
      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.data.cleared).toBe(true);
    });

    it('returns 400 for invalid process', async () => {
      const res = await app.request('/model-routing/nope', {
        method: 'DELETE',
      });
      expect(res.status).toBe(400);
    });
  });
});

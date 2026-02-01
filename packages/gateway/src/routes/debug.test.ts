/**
 * Debug Routes Tests
 *
 * Integration tests for the debug API endpoints.
 * Mocks getDebugInfo and debugLog from core, plus admin key middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { sampleEntries, mockDebugLog } = vi.hoisted(() => {
  const entries = [
    { id: '1', type: 'request', timestamp: '2026-01-31T10:00:00Z', data: { url: '/chat' } },
    { id: '2', type: 'response', timestamp: '2026-01-31T10:00:01Z', data: { status: 200 } },
    { id: '3', type: 'error', timestamp: '2026-01-31T10:00:02Z', data: { message: 'timeout' } },
    { id: '4', type: 'retry', timestamp: '2026-01-31T10:00:03Z', data: { attempt: 2 } },
    { id: '5', type: 'tool_call', timestamp: '2026-01-31T10:00:04Z', data: { tool: 'search' } },
    { id: '6', type: 'tool_result', timestamp: '2026-01-31T10:00:05Z', data: { success: true } },
    {
      id: '7',
      type: 'sandbox_execution',
      timestamp: '2026-01-31T10:00:06Z',
      data: { language: 'javascript', sandboxed: true, success: true, timedOut: false },
    },
    {
      id: '8',
      type: 'sandbox_execution',
      timestamp: '2026-01-31T10:00:07Z',
      data: { language: 'python', sandboxed: false, success: false, timedOut: true },
    },
  ];

  return {
    sampleEntries: entries,
    mockDebugLog: {
      getRecent: vi.fn((count: number) => entries.slice(-count)),
      clear: vi.fn(),
      isEnabled: vi.fn(() => true),
      setEnabled: vi.fn(),
      getAll: vi.fn(() => [...entries]),
    },
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getDebugInfo: vi.fn(() => ({
      enabled: true,
      summary: { total: 8, errors: 2 },
      entries: [...sampleEntries],
    })),
    debugLog: mockDebugLog,
  };
});

// Import after mocks
const { debugRoutes } = await import('./debug.js');

// ---------------------------------------------------------------------------
// App setup (non-production, no admin key needed)
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/debug', debugRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Debug Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDebugLog.getAll.mockReturnValue([...sampleEntries]);
    mockDebugLog.isEnabled.mockReturnValue(true);
    app = createApp();
  });

  // ========================================================================
  // GET /debug
  // ========================================================================

  describe('GET /debug', () => {
    it('returns debug log entries', async () => {
      const res = await app.request('/debug');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(true);
      expect(json.data.summary.total).toBe(8);
    });

    it('respects count parameter', async () => {
      const res = await app.request('/debug?count=3');

      expect(res.status).toBe(200);
      const json = await res.json();
      // entries are sliced to last `count`
      expect(json.data.entries.length).toBeLessThanOrEqual(3);
    });
  });

  // ========================================================================
  // GET /debug/recent
  // ========================================================================

  describe('GET /debug/recent', () => {
    it('returns recent entries', async () => {
      const res = await app.request('/debug/recent');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.entries).toBeDefined();
      expect(mockDebugLog.getRecent).toHaveBeenCalledWith(10); // default count
    });

    it('accepts custom count', async () => {
      const res = await app.request('/debug/recent?count=5');

      expect(res.status).toBe(200);
      expect(mockDebugLog.getRecent).toHaveBeenCalledWith(5);
    });
  });

  // ========================================================================
  // DELETE /debug
  // ========================================================================

  describe('DELETE /debug', () => {
    it('clears debug log', async () => {
      const res = await app.request('/debug', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('cleared');
      expect(mockDebugLog.clear).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /debug/toggle
  // ========================================================================

  describe('POST /debug/toggle', () => {
    it('toggles debug logging on', async () => {
      mockDebugLog.isEnabled.mockReturnValue(false);

      const res = await app.request('/debug/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      expect(mockDebugLog.setEnabled).toHaveBeenCalledWith(true);
    });

    it('toggles debug logging off', async () => {
      mockDebugLog.isEnabled.mockReturnValue(false);

      const res = await app.request('/debug/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('disabled');
    });
  });

  // ========================================================================
  // GET /debug/errors
  // ========================================================================

  describe('GET /debug/errors', () => {
    it('returns only error and retry entries', async () => {
      const res = await app.request('/debug/errors');

      expect(res.status).toBe(200);
      const json = await res.json();
      // sampleEntries has 1 error + 1 retry = 2
      expect(json.data.count).toBe(2);
      expect(json.data.entries.every((e: { type: string }) => e.type === 'error' || e.type === 'retry')).toBe(true);
    });
  });

  // ========================================================================
  // GET /debug/requests
  // ========================================================================

  describe('GET /debug/requests', () => {
    it('returns only request and response entries', async () => {
      const res = await app.request('/debug/requests');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.count).toBe(2);
      expect(json.data.entries.every((e: { type: string }) => e.type === 'request' || e.type === 'response')).toBe(true);
    });
  });

  // ========================================================================
  // GET /debug/tools
  // ========================================================================

  describe('GET /debug/tools', () => {
    it('returns only tool_call and tool_result entries', async () => {
      const res = await app.request('/debug/tools');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.count).toBe(2);
      expect(json.data.entries.every((e: { type: string }) => e.type === 'tool_call' || e.type === 'tool_result')).toBe(true);
    });
  });

  // ========================================================================
  // GET /debug/sandbox
  // ========================================================================

  describe('GET /debug/sandbox', () => {
    it('returns sandbox executions with stats', async () => {
      const res = await app.request('/debug/sandbox');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.count).toBe(2);
      expect(json.data.stats).toBeDefined();
      expect(json.data.stats.byLanguage.javascript).toBe(1);
      expect(json.data.stats.byLanguage.python).toBe(1);
      expect(json.data.stats.sandboxed).toBe(1);
      expect(json.data.stats.unsandboxed).toBe(1);
      expect(json.data.stats.successful).toBe(1);
      expect(json.data.stats.failed).toBe(1);
      expect(json.data.stats.timedOut).toBe(1);
    });
  });
});

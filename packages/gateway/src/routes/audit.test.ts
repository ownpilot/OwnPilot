/**
 * Audit Log Routes Tests
 *
 * Integration tests for the audit log API endpoints.
 * Mocks getAuditLogger to test query, stats, and filtered views.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleEvents = [
  {
    id: 'evt-1',
    type: 'tool.success',
    severity: 'info',
    actor: { id: 'agent-1', type: 'agent' },
    resource: { id: 'tool-1', type: 'tool' },
    outcome: 'success',
    timestamp: '2026-01-31T10:00:00Z',
    data: { toolName: 'search' },
  },
  {
    id: 'evt-2',
    type: 'system.error',
    severity: 'error',
    actor: { id: 'system', type: 'system' },
    resource: { id: 'session-1', type: 'session' },
    outcome: 'failure',
    timestamp: '2026-01-31T10:01:00Z',
    data: { error: 'Connection failed' },
  },
];

const mockAuditLogger = {
  initialize: vi.fn(),
  query: vi.fn(async () => ({ ok: true, value: sampleEvents })),
  getStats: vi.fn(() => ({ eventCount: 100, lastChecksum: 'abc123' })),
  countEvents: vi.fn(async () => 100),
};

vi.mock('../audit/index.js', () => ({
  getAuditLogger: () => mockAuditLogger,
}));

// Import after mocks
const { auditRoutes } = await import('./audit.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/audit', auditRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /audit
  // ========================================================================

  describe('GET /audit', () => {
    it('returns audit events with count and total', async () => {
      const res = await app.request('/audit');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.events).toHaveLength(2);
      expect(json.data.count).toBe(2);
      expect(json.data.total).toBe(100);
    });

    it('passes query filters to logger', async () => {
      await app.request(
        '/audit?types=tool.success,tool.error&actorType=agent&minSeverity=warn&limit=10&offset=5'
      );

      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ['tool.success', 'tool.error'],
          actorType: 'agent',
          minSeverity: 'warn',
          limit: 10,
          offset: 5,
        })
      );
    });

    it('parses date filters', async () => {
      await app.request('/audit?from=2026-01-01&to=2026-01-31');

      const call = mockAuditLogger.query.mock.calls[0][0];
      expect(call.from).toBeInstanceOf(Date);
      expect(call.to).toBeInstanceOf(Date);
    });

    it('returns 500 when query fails', async () => {
      mockAuditLogger.query.mockResolvedValueOnce({
        ok: false,
        error: { message: 'DB error' },
      });

      const res = await app.request('/audit');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('AUDIT_QUERY_ERROR');
    });
  });

  // ========================================================================
  // GET /audit/stats
  // ========================================================================

  describe('GET /audit/stats', () => {
    it('returns audit statistics', async () => {
      const res = await app.request('/audit/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.eventCount).toBe(100);
      expect(json.data.lastChecksum).toBe('abc123');
    });
  });

  // ========================================================================
  // GET /audit/tools
  // ========================================================================

  describe('GET /audit/tools', () => {
    it('returns tool execution logs', async () => {
      const res = await app.request('/audit/tools');

      expect(res.status).toBe(200);
      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ['tool.execute', 'tool.success', 'tool.error'],
          order: 'desc',
        })
      );
    });

    it('accepts pagination parameters', async () => {
      await app.request('/audit/tools?limit=20&offset=10');

      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          offset: 10,
        })
      );
    });
  });

  // ========================================================================
  // GET /audit/sessions
  // ========================================================================

  describe('GET /audit/sessions', () => {
    it('returns session and message logs', async () => {
      const res = await app.request('/audit/sessions');

      expect(res.status).toBe(200);
      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          types: [
            'session.create',
            'session.destroy',
            'message.receive',
            'message.send',
            'system.error',
          ],
        })
      );
    });
  });

  // ========================================================================
  // GET /audit/errors
  // ========================================================================

  describe('GET /audit/errors', () => {
    it('returns error logs with minSeverity=error', async () => {
      const res = await app.request('/audit/errors');

      expect(res.status).toBe(200);
      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          minSeverity: 'error',
          order: 'desc',
        })
      );
    });
  });

  // ========================================================================
  // GET /audit/request/:requestId
  // ========================================================================

  describe('GET /audit/request/:requestId', () => {
    it('returns events for a specific request in chronological order', async () => {
      const res = await app.request('/audit/request/req-123');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.requestId).toBe('req-123');
      expect(json.data.events).toBeDefined();
      expect(mockAuditLogger.query).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'req-123',
          order: 'asc',
        })
      );
    });
  });
});

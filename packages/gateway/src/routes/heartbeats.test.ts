/**
 * Heartbeats Routes Tests
 *
 * Integration tests for the heartbeats API endpoints.
 * Mocks the HeartbeatService singleton and tests all CRUD, enable/disable,
 * import/export endpoints with both success and error scenarios.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleHeartbeat = {
  id: 'hb-1',
  userId: 'default',
  name: 'Morning briefing',
  scheduleText: 'every day at 9am',
  cronExpression: '0 9 * * *',
  taskDescription: 'Send a morning briefing with weather and calendar',
  enabled: true,
  tags: ['daily'],
  triggerId: 'trigger-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sampleHeartbeat2 = {
  id: 'hb-2',
  userId: 'default',
  name: 'Weekly review',
  scheduleText: 'every monday at 10am',
  cronExpression: '0 10 * * 1',
  taskDescription: 'Generate a weekly review summary',
  enabled: false,
  tags: ['weekly'],
  triggerId: 'trigger-2',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  listHeartbeats: vi.fn(),
  createHeartbeat: vi.fn(),
  getHeartbeat: vi.fn(),
  updateHeartbeat: vi.fn(),
  deleteHeartbeat: vi.fn(),
  enableHeartbeat: vi.fn(),
  disableHeartbeat: vi.fn(),
  importMarkdown: vi.fn(),
  exportMarkdown: vi.fn(),
};

class MockHeartbeatServiceError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'HeartbeatServiceError';
  }
}

vi.mock('../services/heartbeat-service.js', () => ({
  getHeartbeatService: () => mockService,
  HeartbeatService: vi.fn(),
  HeartbeatServiceError: MockHeartbeatServiceError,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getServiceRegistry: () => ({
      get: (token: { key: string }) => {
        if (token.key === 'heartbeat') return mockService;
        throw new Error(`Unexpected token: ${token.key}`);
      },
    }),
    Services: { ...actual.Services, Heartbeat: { key: 'heartbeat' } },
  };
});

// Import after mocks
const { heartbeatsRoutes } = await import('./heartbeats.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/heartbeats', heartbeatsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Heartbeats Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.listHeartbeats.mockResolvedValue([sampleHeartbeat, sampleHeartbeat2]);
    mockService.createHeartbeat.mockResolvedValue(sampleHeartbeat);
    mockService.getHeartbeat.mockImplementation(async (_userId: string, id: string) =>
      id === 'hb-1' ? sampleHeartbeat : null
    );
    mockService.updateHeartbeat.mockImplementation(
      async (_userId: string, id: string, input: Record<string, unknown>) =>
        id === 'hb-1' ? { ...sampleHeartbeat, ...input } : null
    );
    mockService.deleteHeartbeat.mockImplementation(
      async (_userId: string, id: string) => id === 'hb-1'
    );
    mockService.enableHeartbeat.mockImplementation(async (_userId: string, id: string) =>
      id === 'hb-1' ? { ...sampleHeartbeat, enabled: true } : null
    );
    mockService.disableHeartbeat.mockImplementation(async (_userId: string, id: string) =>
      id === 'hb-1' ? { ...sampleHeartbeat, enabled: false } : null
    );
    mockService.importMarkdown.mockResolvedValue({
      created: 1,
      errors: [],
      heartbeats: [sampleHeartbeat],
    });
    mockService.exportMarkdown.mockResolvedValue(
      '## every day at 9am\nSend a morning briefing with weather and calendar'
    );
    app = createApp();
  });

  // ========================================================================
  // GET / - List heartbeats
  // ========================================================================

  describe('GET /heartbeats', () => {
    it('returns all heartbeats', async () => {
      const res = await app.request('/heartbeats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeats).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.heartbeats[0].id).toBe('hb-1');
      expect(json.data.heartbeats[1].id).toBe('hb-2');
    });

    it('passes enabled=true filter to service', async () => {
      mockService.listHeartbeats.mockResolvedValue([sampleHeartbeat]);

      const res = await app.request('/heartbeats?enabled=true');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.heartbeats).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: true,
        limit: 20,
      });
    });

    it('passes enabled=false filter to service', async () => {
      mockService.listHeartbeats.mockResolvedValue([sampleHeartbeat2]);

      const res = await app.request('/heartbeats?enabled=false');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.heartbeats).toHaveLength(1);
      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: false,
        limit: 20,
      });
    });

    it('passes undefined enabled when not specified', async () => {
      await app.request('/heartbeats');

      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: undefined,
        limit: 20,
      });
    });

    it('passes undefined enabled for non-boolean strings', async () => {
      await app.request('/heartbeats?enabled=maybe');

      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: undefined,
        limit: 20,
      });
    });

    it('respects custom limit parameter', async () => {
      await app.request('/heartbeats?limit=5');

      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: undefined,
        limit: 5,
      });
    });

    it('clamps limit to maximum of 100', async () => {
      await app.request('/heartbeats?limit=500');

      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: undefined,
        limit: 100,
      });
    });

    it('clamps limit to minimum of 1', async () => {
      await app.request('/heartbeats?limit=0');

      expect(mockService.listHeartbeats).toHaveBeenCalledWith('default', {
        enabled: undefined,
        limit: 1,
      });
    });

    it('returns empty array when no heartbeats exist', async () => {
      mockService.listHeartbeats.mockResolvedValue([]);

      const res = await app.request('/heartbeats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.heartbeats).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });
  });

  // ========================================================================
  // POST / - Create heartbeat
  // ========================================================================

  describe('POST /heartbeats', () => {
    it('creates a heartbeat with required fields', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'every day at 9am',
          taskDescription: 'Send a morning briefing with weather and calendar',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeat.id).toBe('hb-1');
      expect(json.data.message).toContain('created');
      expect(mockService.createHeartbeat).toHaveBeenCalledWith('default', {
        scheduleText: 'every day at 9am',
        taskDescription: 'Send a morning briefing with weather and calendar',
        name: undefined,
        enabled: undefined,
        tags: undefined,
      });
    });

    it('creates a heartbeat with all optional fields', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'every day at 9am',
          taskDescription: 'Send a morning briefing',
          name: 'Morning briefing',
          enabled: true,
          tags: ['daily', 'morning'],
        }),
      });

      expect(res.status).toBe(201);
      expect(mockService.createHeartbeat).toHaveBeenCalledWith('default', {
        scheduleText: 'every day at 9am',
        taskDescription: 'Send a morning briefing',
        name: 'Morning briefing',
        enabled: true,
        tags: ['daily', 'morning'],
      });
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Invalid JSON');
    });

    it('returns 400 when scheduleText is missing', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskDescription: 'Do something',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('scheduleText');
    });

    it('returns 400 when scheduleText is empty string', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: '   ',
          taskDescription: 'Do something',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('scheduleText');
    });

    it('returns 400 when taskDescription is missing', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'every day at 9am',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('taskDescription');
    });

    it('returns 400 when taskDescription is empty string', async () => {
      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'every day at 9am',
          taskDescription: '   ',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('taskDescription');
    });

    it('returns 400 when service throws HeartbeatServiceError', async () => {
      mockService.createHeartbeat.mockRejectedValue(
        new MockHeartbeatServiceError('Cannot parse schedule', 'PARSE_ERROR')
      );

      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'gibberish schedule',
          taskDescription: 'Do something',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('PARSE_ERROR');
      expect(json.error.message).toContain('Cannot parse schedule');
    });

    it('returns 500 for unexpected errors during creation', async () => {
      mockService.createHeartbeat.mockRejectedValue(new Error('DB connection lost'));

      const res = await app.request('/heartbeats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleText: 'every day at 9am',
          taskDescription: 'Do something',
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CREATE_FAILED');
    });
  });

  // ========================================================================
  // GET /:id - Get heartbeat by ID
  // ========================================================================

  describe('GET /heartbeats/:id', () => {
    it('returns heartbeat details', async () => {
      const res = await app.request('/heartbeats/hb-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeat.id).toBe('hb-1');
      expect(json.data.heartbeat.name).toBe('Morning briefing');
      expect(json.data.heartbeat.scheduleText).toBe('every day at 9am');
      expect(json.data.heartbeat.taskDescription).toBe(
        'Send a morning briefing with weather and calendar'
      );
      expect(json.data.heartbeat.enabled).toBe(true);
      expect(json.data.heartbeat.tags).toEqual(['daily']);
    });

    it('returns 404 for unknown heartbeat', async () => {
      const res = await app.request('/heartbeats/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('not found');
    });

    it('calls service with correct userId and id', async () => {
      await app.request('/heartbeats/hb-1');

      expect(mockService.getHeartbeat).toHaveBeenCalledWith('default', 'hb-1');
    });
  });

  // ========================================================================
  // PATCH /:id - Update heartbeat
  // ========================================================================

  describe('PATCH /heartbeats/:id', () => {
    it('updates heartbeat name', async () => {
      const res = await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated briefing' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeat.name).toBe('Updated briefing');
      expect(json.data.message).toContain('updated');
    });

    it('updates heartbeat scheduleText', async () => {
      const res = await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleText: 'every week on monday' }),
      });

      expect(res.status).toBe(200);
      expect(mockService.updateHeartbeat).toHaveBeenCalledWith('default', 'hb-1', {
        scheduleText: 'every week on monday',
      });
    });

    it('updates heartbeat taskDescription', async () => {
      await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskDescription: 'New task description' }),
      });

      expect(mockService.updateHeartbeat).toHaveBeenCalledWith('default', 'hb-1', {
        taskDescription: 'New task description',
      });
    });

    it('updates heartbeat enabled status', async () => {
      await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(mockService.updateHeartbeat).toHaveBeenCalledWith('default', 'hb-1', {
        enabled: false,
      });
    });

    it('updates heartbeat tags', async () => {
      await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['weekly', 'important'] }),
      });

      expect(mockService.updateHeartbeat).toHaveBeenCalledWith('default', 'hb-1', {
        tags: ['weekly', 'important'],
      });
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Invalid JSON');
    });

    it('returns 404 for unknown heartbeat', async () => {
      const res = await app.request('/heartbeats/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when service throws HeartbeatServiceError', async () => {
      mockService.updateHeartbeat.mockRejectedValue(
        new MockHeartbeatServiceError('Invalid schedule expression', 'PARSE_ERROR')
      );

      const res = await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleText: 'bad schedule' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('PARSE_ERROR');
      expect(json.error.message).toContain('Invalid schedule expression');
    });

    it('returns 500 for unexpected errors during update', async () => {
      mockService.updateHeartbeat.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/heartbeats/hb-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UPDATE_FAILED');
    });
  });

  // ========================================================================
  // DELETE /:id - Delete heartbeat
  // ========================================================================

  describe('DELETE /heartbeats/:id', () => {
    it('deletes a heartbeat', async () => {
      const res = await app.request('/heartbeats/hb-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('deleted');
      expect(mockService.deleteHeartbeat).toHaveBeenCalledWith('default', 'hb-1');
    });

    it('returns 404 for unknown heartbeat', async () => {
      const res = await app.request('/heartbeats/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('not found');
    });
  });

  // ========================================================================
  // POST /:id/enable - Enable heartbeat
  // ========================================================================

  describe('POST /heartbeats/:id/enable', () => {
    it('enables a heartbeat', async () => {
      const res = await app.request('/heartbeats/hb-1/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeat.enabled).toBe(true);
      expect(json.data.message).toContain('enabled');
      expect(mockService.enableHeartbeat).toHaveBeenCalledWith('default', 'hb-1');
    });

    it('returns 404 for unknown heartbeat', async () => {
      const res = await app.request('/heartbeats/nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /:id/disable - Disable heartbeat
  // ========================================================================

  describe('POST /heartbeats/:id/disable', () => {
    it('disables a heartbeat', async () => {
      const res = await app.request('/heartbeats/hb-1/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.heartbeat.enabled).toBe(false);
      expect(json.data.message).toContain('disabled');
      expect(mockService.disableHeartbeat).toHaveBeenCalledWith('default', 'hb-1');
    });

    it('returns 404 for unknown heartbeat', async () => {
      const res = await app.request('/heartbeats/nonexistent/disable', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /import - Import from markdown
  // ========================================================================

  describe('POST /heartbeats/import', () => {
    it('imports heartbeats from markdown', async () => {
      const markdown = '## every day at 9am\nSend a morning briefing';

      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.created).toBe(1);
      expect(json.data.errors).toHaveLength(0);
      expect(json.data.heartbeats).toHaveLength(1);
      expect(mockService.importMarkdown).toHaveBeenCalledWith('default', markdown);
    });

    it('returns import results with errors', async () => {
      mockService.importMarkdown.mockResolvedValue({
        created: 1,
        errors: [{ scheduleText: 'bad schedule', error: 'Cannot parse' }],
        heartbeats: [sampleHeartbeat],
      });

      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: '## bad schedule\nDo stuff\n\n## every day at 9am\nBriefing',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.created).toBe(1);
      expect(json.data.errors).toHaveLength(1);
      expect(json.data.errors[0].scheduleText).toBe('bad schedule');
    });

    it('returns 400 when markdown field is missing', async () => {
      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('markdown');
    });

    it('returns 400 when markdown is not a string', async () => {
      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: 123 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('markdown');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('accepts empty markdown string', async () => {
      mockService.importMarkdown.mockResolvedValue({
        created: 0,
        errors: [],
        heartbeats: [],
      });

      const res = await app.request('/heartbeats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: '' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.created).toBe(0);
    });
  });

  // ========================================================================
  // GET /export - Export as markdown
  // ========================================================================

  describe('GET /heartbeats/export', () => {
    it('exports heartbeats as markdown', async () => {
      mockService.exportMarkdown.mockResolvedValue('# Heartbeats\n- Morning briefing');

      const res = await app.request('/heartbeats/export');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.markdown).toBe('# Heartbeats\n- Morning briefing');
      expect(mockService.exportMarkdown).toHaveBeenCalledWith('default');
    });

    it('returns empty markdown when no heartbeats', async () => {
      mockService.exportMarkdown.mockResolvedValue('');

      const res = await app.request('/heartbeats/export');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.markdown).toBe('');
    });
  });

  // ========================================================================
  // Response structure
  // ========================================================================

  describe('Response structure', () => {
    it('includes meta with requestId and timestamp in success response', async () => {
      const res = await app.request('/heartbeats');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });

    it('includes meta in error response', async () => {
      const res = await app.request('/heartbeats/nonexistent');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});

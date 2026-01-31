/**
 * Triggers Routes Tests
 *
 * Integration tests for the triggers API endpoints.
 * Mocks TriggerService and TriggerEngine to test route logic and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTriggerService = {
  listTriggers: vi.fn(async () => []),
  createTrigger: vi.fn(),
  getTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  getStats: vi.fn(async () => ({ total: 5, enabled: 3, byType: { schedule: 2, event: 1 } })),
  getRecentHistory: vi.fn(async () => []),
  getDueTriggers: vi.fn(async () => []),
  getHistoryForTrigger: vi.fn(async () => []),
  cleanupHistory: vi.fn(async () => 0),
};

const mockTriggerEngine = {
  fireTrigger: vi.fn(),
  isRunning: vi.fn(() => false),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('../services/trigger-service.js', () => ({
  getTriggerService: () => mockTriggerService,
}));

vi.mock('../triggers/index.js', () => ({
  getTriggerEngine: () => mockTriggerEngine,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    validateCronExpression: vi.fn((cron: string) => {
      if (cron === 'invalid') return { valid: false, error: 'Invalid cron expression' };
      return { valid: true };
    }),
  };
});

vi.mock('../middleware/validation.js', () => ({
  validateBody: vi.fn((_schema: unknown, body: unknown) => body),
  createTriggerSchema: {},
  updatePlanStepSchema: {},
}));

// Import after mocks
const { triggersRoutes } = await import('./triggers.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/triggers', triggersRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Triggers Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /triggers
  // ========================================================================

  describe('GET /triggers', () => {
    it('returns triggers list', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't1', name: 'Morning', type: 'schedule', enabled: true },
      ]);

      const res = await app.request('/triggers');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.triggers).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('passes query params to service', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      await app.request('/triggers?userId=u1&type=schedule&enabled=true&limit=5');

      expect(mockTriggerService.listTriggers).toHaveBeenCalledWith('u1', {
        type: 'schedule',
        enabled: true,
        limit: 5,
      });
    });

    it('parses enabled=false correctly', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      await app.request('/triggers?enabled=false');

      expect(mockTriggerService.listTriggers).toHaveBeenCalledWith('default', expect.objectContaining({
        enabled: false,
      }));
    });
  });

  // ========================================================================
  // POST /triggers
  // ========================================================================

  describe('POST /triggers', () => {
    it('creates a trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValue({
        id: 't1',
        name: 'Daily Check',
        type: 'schedule',
        enabled: true,
      });

      const res = await app.request('/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Daily Check',
          type: 'schedule',
          config: { cron: '0 9 * * *' },
          action: { type: 'notification', message: 'Time to check!' },
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.trigger.id).toBe('t1');
    });

    it('rejects schedule trigger without cron', async () => {
      const res = await app.request('/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Trigger',
          type: 'schedule',
          config: {},
          action: { type: 'notification' },
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_CRON');
    });

    it('rejects invalid cron expression', async () => {
      const res = await app.request('/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Cron',
          type: 'schedule',
          config: { cron: 'invalid' },
          action: { type: 'notification' },
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_CRON');
    });
  });

  // ========================================================================
  // GET /triggers/stats
  // ========================================================================

  describe('GET /triggers/stats', () => {
    it('returns trigger statistics', async () => {
      const res = await app.request('/triggers/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(5);
    });
  });

  // ========================================================================
  // GET /triggers/history
  // ========================================================================

  describe('GET /triggers/history', () => {
    it('returns recent trigger history', async () => {
      mockTriggerService.getRecentHistory.mockResolvedValue([
        { id: 'h1', triggerId: 't1', firedAt: '2026-01-31' },
      ]);

      const res = await app.request('/triggers/history');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.history).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  // ========================================================================
  // GET /triggers/due
  // ========================================================================

  describe('GET /triggers/due', () => {
    it('returns due triggers', async () => {
      mockTriggerService.getDueTriggers.mockResolvedValue([
        { id: 't1', name: 'Overdue', nextFireAt: '2026-01-30' },
      ]);

      const res = await app.request('/triggers/due');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.triggers).toHaveLength(1);
    });
  });

  // ========================================================================
  // GET /triggers/:id
  // ========================================================================

  describe('GET /triggers/:id', () => {
    it('returns trigger with recent history', async () => {
      mockTriggerService.getTrigger.mockResolvedValue({
        id: 't1',
        name: 'Morning',
        type: 'schedule',
      });
      mockTriggerService.getHistoryForTrigger.mockResolvedValue([
        { id: 'h1', firedAt: '2026-01-31' },
      ]);

      const res = await app.request('/triggers/t1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('t1');
      expect(json.data.recentHistory).toHaveLength(1);
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);

      const res = await app.request('/triggers/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /triggers/:id
  // ========================================================================

  describe('PATCH /triggers/:id', () => {
    it('updates a trigger', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue({
        id: 't1',
        name: 'Updated',
      });

      const res = await app.request('/triggers/t1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated');
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue(null);

      const res = await app.request('/triggers/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /triggers/:id/enable & disable
  // ========================================================================

  describe('POST /triggers/:id/enable', () => {
    it('enables a trigger', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue({
        id: 't1',
        enabled: true,
      });

      const res = await app.request('/triggers/t1/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('enabled');
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('default', 't1', { enabled: true });
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue(null);

      const res = await app.request('/triggers/nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /triggers/:id/disable', () => {
    it('disables a trigger', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue({
        id: 't1',
        enabled: false,
      });

      const res = await app.request('/triggers/t1/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('disabled');
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('default', 't1', { enabled: false });
    });
  });

  // ========================================================================
  // POST /triggers/:id/fire
  // ========================================================================

  describe('POST /triggers/:id/fire', () => {
    it('fires a trigger manually', async () => {
      mockTriggerService.getTrigger.mockResolvedValue({ id: 't1', name: 'Test' });
      mockTriggerEngine.fireTrigger.mockResolvedValue({ success: true });

      const res = await app.request('/triggers/t1/fire', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);

      const res = await app.request('/triggers/nonexistent/fire', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when fire fails', async () => {
      mockTriggerService.getTrigger.mockResolvedValue({ id: 't1' });
      mockTriggerEngine.fireTrigger.mockResolvedValue({ success: false, error: 'Execution error' });

      const res = await app.request('/triggers/t1/fire', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // DELETE /triggers/:id
  // ========================================================================

  describe('DELETE /triggers/:id', () => {
    it('deletes a trigger', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(true);

      const res = await app.request('/triggers/t1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(false);

      const res = await app.request('/triggers/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /triggers/:id/history
  // ========================================================================

  describe('GET /triggers/:id/history', () => {
    it('returns history for a specific trigger', async () => {
      mockTriggerService.getTrigger.mockResolvedValue({ id: 't1', name: 'Morning' });
      mockTriggerService.getHistoryForTrigger.mockResolvedValue([
        { id: 'h1', firedAt: '2026-01-31' },
      ]);

      const res = await app.request('/triggers/t1/history');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.triggerId).toBe('t1');
      expect(json.data.triggerName).toBe('Morning');
      expect(json.data.history).toHaveLength(1);
    });

    it('returns 404 when trigger not found', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);

      const res = await app.request('/triggers/nonexistent/history');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /triggers/cleanup
  // ========================================================================

  describe('POST /triggers/cleanup', () => {
    it('cleans up old history', async () => {
      mockTriggerService.cleanupHistory.mockResolvedValue(10);

      const res = await app.request('/triggers/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeDays: 30 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deletedCount).toBe(10);
    });
  });

  // ========================================================================
  // Engine control routes
  // ========================================================================

  describe('GET /triggers/engine/status', () => {
    it('returns engine running status', async () => {
      mockTriggerEngine.isRunning.mockReturnValue(true);

      const res = await app.request('/triggers/engine/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.running).toBe(true);
    });
  });

  describe('POST /triggers/engine/start', () => {
    it('starts the trigger engine', async () => {
      mockTriggerEngine.isRunning.mockReturnValue(true);

      const res = await app.request('/triggers/engine/start', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(mockTriggerEngine.start).toHaveBeenCalled();
    });
  });

  describe('POST /triggers/engine/stop', () => {
    it('stops the trigger engine', async () => {
      mockTriggerEngine.isRunning.mockReturnValue(false);

      const res = await app.request('/triggers/engine/stop', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(mockTriggerEngine.stop).toHaveBeenCalled();
    });
  });
});

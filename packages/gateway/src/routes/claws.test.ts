/**
 * Claws Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetClawService } = vi.hoisted(() => {
  return { mockGetClawService: vi.fn() };
});

vi.mock('../services/claw-service.js', () => ({
  getClawService: mockGetClawService,
}));

vi.mock('./helpers.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserId: () => 'user-1',
  };
});

const { clawRoutes } = await import('./claws.js');

// ---------------------------------------------------------------------------
// Test App
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/claws', clawRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Mock Service
// ---------------------------------------------------------------------------

function createMockService() {
  return {
    createClaw: vi.fn(),
    getClaw: vi.fn(),
    listClaws: vi.fn().mockResolvedValue([]),
    updateClaw: vi.fn(),
    deleteClaw: vi.fn(),
    startClaw: vi.fn(),
    pauseClaw: vi.fn(),
    resumeClaw: vi.fn(),
    stopClaw: vi.fn(),
    executeNow: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    listSessions: vi.fn().mockReturnValue([]),
    getHistory: vi.fn(),
    sendMessage: vi.fn(),
    approveEscalation: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claws Routes', () => {
  let app: Hono;
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
    mockGetClawService.mockReturnValue(service);
    app = createApp();
  });

  // ---- List ----

  describe('GET /claws', () => {
    it('should return list of claws', async () => {
      service.listClaws.mockResolvedValue([
        { id: 'claw-1', name: 'Test', mode: 'continuous' },
      ]);
      service.listSessions.mockReturnValue([]);

      const res = await app.request('/claws');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('claw-1');
    });

    it('should include session data when running', async () => {
      service.listClaws.mockResolvedValue([{ id: 'claw-1', name: 'Test' }]);
      service.listSessions.mockReturnValue([
        {
          config: { id: 'claw-1' },
          state: 'running',
          cyclesCompleted: 5,
          totalToolCalls: 20,
          totalCostUsd: 0.05,
          lastCycleAt: null,
          lastCycleDurationMs: null,
          lastCycleError: null,
          startedAt: new Date(),
          stoppedAt: null,
          artifacts: [],
          pendingEscalation: null,
        },
      ]);

      const res = await app.request('/claws');
      const body = await res.json();
      expect(body.data[0].session.state).toBe('running');
      expect(body.data[0].session.cyclesCompleted).toBe(5);
    });
  });

  // ---- Create ----

  describe('POST /claws', () => {
    it('should create a claw', async () => {
      service.createClaw.mockResolvedValue({ id: 'claw-new', name: 'Research' });

      const res = await app.request('/claws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Research', mission: 'Do research' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('claw-new');
    });

    it('should require name', async () => {
      const res = await app.request('/claws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should require mission', async () => {
      const res = await app.request('/claws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should validate mode', async () => {
      const res = await app.request('/claws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', mission: 'test', mode: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- Get ----

  describe('GET /claws/:id', () => {
    it('should return claw with session', async () => {
      service.getClaw.mockResolvedValue({ id: 'claw-1', name: 'Test' });
      service.getSession.mockReturnValue(null);

      const res = await app.request('/claws/claw-1');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.id).toBe('claw-1');
      expect(body.data.session).toBeNull();
    });

    it('should return 404 for missing claw', async () => {
      service.getClaw.mockResolvedValue(null);

      const res = await app.request('/claws/claw-99');
      expect(res.status).toBe(404);
    });
  });

  // ---- Update ----

  describe('PUT /claws/:id', () => {
    it('should update a claw', async () => {
      service.updateClaw.mockResolvedValue({ id: 'claw-1', name: 'Updated' });

      const res = await app.request('/claws/claw-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing claw', async () => {
      service.updateClaw.mockResolvedValue(null);

      const res = await app.request('/claws/claw-99', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ---- Delete ----

  describe('DELETE /claws/:id', () => {
    it('should delete a claw', async () => {
      service.deleteClaw.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing claw', async () => {
      service.deleteClaw.mockResolvedValue(false);

      const res = await app.request('/claws/claw-99', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ---- Lifecycle ----

  describe('POST /claws/:id/start', () => {
    it('should start a claw', async () => {
      service.startClaw.mockResolvedValue({ state: 'running', startedAt: new Date() });

      const res = await app.request('/claws/claw-1/start', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.state).toBe('running');
    });
  });

  describe('POST /claws/:id/pause', () => {
    it('should pause a claw', async () => {
      service.pauseClaw.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/pause', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('should return 404 if not running', async () => {
      service.pauseClaw.mockResolvedValue(false);

      const res = await app.request('/claws/claw-1/pause', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /claws/:id/resume', () => {
    it('should resume a claw', async () => {
      service.resumeClaw.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/resume', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /claws/:id/stop', () => {
    it('should stop a claw', async () => {
      service.stopClaw.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/stop', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /claws/:id/execute', () => {
    it('should execute a cycle', async () => {
      service.executeNow.mockResolvedValue({
        success: true,
        outputMessage: 'Done',
        durationMs: 1000,
      });

      const res = await app.request('/claws/claw-1/execute', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  // ---- Message ----

  describe('POST /claws/:id/message', () => {
    it('should send a message', async () => {
      service.sendMessage.mockResolvedValue(undefined);

      const res = await app.request('/claws/claw-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Check task #5' }),
      });
      expect(res.status).toBe(200);
    });

    it('should require message field', async () => {
      const res = await app.request('/claws/claw-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- History ----

  describe('GET /claws/:id/history', () => {
    it('should return paginated history', async () => {
      service.getHistory.mockResolvedValue({
        entries: [{ id: 'h-1', cycleNumber: 1 }],
        total: 1,
      });

      const res = await app.request('/claws/claw-1/history');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.total).toBe(1);
    });
  });

  // ---- Escalation ----

  describe('POST /claws/:id/approve-escalation', () => {
    it('should approve escalation', async () => {
      service.approveEscalation.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/approve-escalation', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('should return 404 if no pending escalation', async () => {
      service.approveEscalation.mockResolvedValue(false);

      const res = await app.request('/claws/claw-1/approve-escalation', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });
});

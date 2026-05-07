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

const mockGetClawManager = vi.fn().mockReturnValue({
  updateClawConfig: vi.fn(),
});
vi.mock('../services/claw-manager.js', () => ({
  getClawManager: mockGetClawManager,
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
    listClawsPaginated: vi.fn().mockResolvedValue({ claws: [], total: 0 }),
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
    denyEscalation: vi.fn(),
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

  // ---- Stats ----

  describe('GET /claws/stats', () => {
    it('should return aggregate statistics', async () => {
      service.listClaws.mockResolvedValue([
        { id: 'c1', mode: 'continuous' },
        { id: 'c2', mode: 'interval' },
        { id: 'c3', mode: 'continuous' },
      ]);
      service.listSessions.mockReturnValue([
        {
          config: { id: 'c1' },
          state: 'running',
          totalCostUsd: 0.05,
          cyclesCompleted: 10,
          totalToolCalls: 42,
        },
        {
          config: { id: 'c3' },
          state: 'paused',
          totalCostUsd: 0.02,
          cyclesCompleted: 3,
          totalToolCalls: 8,
        },
      ]);

      const res = await app.request('/claws/stats');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.total).toBe(3);
      expect(body.data.running).toBe(1);
      expect(body.data.totalCycles).toBe(13);
      expect(body.data.totalToolCalls).toBe(50);
      expect(body.data.totalCost).toBeCloseTo(0.07);
      expect(body.data.byMode).toEqual({ continuous: 2, interval: 1 });
      expect(body.data.byState.running).toBe(1);
      expect(body.data.byState.paused).toBe(1);
      expect(body.data.byState.stopped).toBe(1);
      expect(body.data.byHealth).toBeDefined();
      expect(body.data.needsAttention).toBeGreaterThanOrEqual(0);
    });

    it('should return empty stats when no claws', async () => {
      service.listClaws.mockResolvedValue([]);
      service.listSessions.mockReturnValue([]);

      const res = await app.request('/claws/stats');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.total).toBe(0);
      expect(body.data.running).toBe(0);
      expect(body.data.totalCost).toBe(0);
    });
  });

  describe('GET /claws/presets', () => {
    it('should return productized claw presets', async () => {
      const res = await app.request('/claws/presets');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.presets.length).toBeGreaterThan(0);
      expect(body.data.presets[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          mission: expect.any(String),
          successCriteria: expect.any(Array),
          deliverables: expect.any(Array),
        })
      );
    });
  });

  describe('GET /claws/recommendations', () => {
    it('should return diagnostics recommendations for weak claws', async () => {
      service.listClaws.mockResolvedValue([
        {
          id: 'claw-1',
          name: 'Weak',
          mode: 'event',
          eventFilters: [],
          missionContract: {
            successCriteria: [],
            deliverables: [],
            constraints: [],
            escalationRules: [],
            evidenceRequired: false,
            minConfidence: 0.8,
          },
          autoStart: false,
          allowedTools: [],
          limits: {},
          depth: 0,
          sandbox: 'auto',
          createdBy: 'user',
        },
      ]);
      service.listSessions.mockReturnValue([]);

      const res = await app.request('/claws/recommendations');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.recommendations).toHaveLength(1);
      expect(body.data.recommendations[0].recommendations[0]).toContain('Add success criteria');
    });
  });

  describe('POST /claws/recommendations/apply', () => {
    it('should apply safe fixes to selected attention claws', async () => {
      const weakClaw = {
        id: 'claw-1',
        name: 'Weak',
        mode: 'single-shot',
        allowedTools: [],
        limits: {},
        autoStart: false,
        depth: 0,
        sandbox: 'auto',
        createdBy: 'user',
      };
      const healthyClaw = {
        id: 'claw-2',
        name: 'Healthy',
        mode: 'single-shot',
        stopCondition: 'on_report',
        missionContract: {
          successCriteria: ['Done'],
          deliverables: ['Report'],
          constraints: ['No risky actions'],
          escalationRules: ['Ask on blockers'],
          evidenceRequired: true,
          minConfidence: 0.8,
        },
        autonomyPolicy: {
          allowSelfModify: false,
          allowSubclaws: true,
          requireEvidence: true,
          destructiveActionPolicy: 'ask',
          filesystemScopes: [],
        },
        allowedTools: [],
        limits: {},
        autoStart: false,
        depth: 0,
        sandbox: 'auto',
        createdBy: 'user',
      };
      service.listClaws.mockResolvedValue([weakClaw, healthyClaw]);
      service.listSessions.mockReturnValue([]);
      service.updateClaw.mockResolvedValue({
        ...weakClaw,
        stopCondition: 'on_report',
      });

      const res = await app.request('/claws/recommendations/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['claw-1', 'claw-2'] }),
      });
      expect(res.status).toBe(200);

      expect(service.updateClaw).toHaveBeenCalledTimes(1);
      expect(service.updateClaw).toHaveBeenCalledWith(
        'claw-1',
        'user-1',
        expect.objectContaining({ stopCondition: 'on_report' })
      );

      const body = await res.json();
      expect(body.data.updated).toBe(1);
      expect(body.data.results[0].clawId).toBe('claw-1');
    });
  });

  describe('GET /claws/:id/doctor', () => {
    it('should preview safe config fixes without updating the claw', async () => {
      service.getClaw.mockResolvedValue({
        id: 'claw-1',
        name: 'Weak',
        mode: 'single-shot',
        eventFilters: [],
        allowedTools: [],
        limits: {},
        autoStart: false,
        depth: 0,
        sandbox: 'auto',
        createdBy: 'user',
      });

      const res = await app.request('/claws/claw-1/doctor');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.applied).toEqual(['mission_contract', 'stop_condition', 'autonomy_policy']);
      expect(body.data.patch.stopCondition).toBe('on_report');
      expect(body.data.patch.missionContract.evidenceRequired).toBe(true);
      expect(service.updateClaw).not.toHaveBeenCalled();
    });
  });

  describe('POST /claws/:id/apply-recommendations', () => {
    it('should apply conservative recommendation fixes and hot-reload config', async () => {
      const weakClaw = {
        id: 'claw-1',
        name: 'Weak',
        mode: 'event',
        eventFilters: [],
        missionContract: {
          successCriteria: [],
          deliverables: [],
          constraints: [],
          escalationRules: [],
          evidenceRequired: false,
          minConfidence: 0.4,
        },
        autonomyPolicy: {
          allowSelfModify: true,
          allowSubclaws: true,
          requireEvidence: false,
          destructiveActionPolicy: 'allow',
          filesystemScopes: [],
        },
        allowedTools: [],
        limits: {},
        autoStart: false,
        depth: 0,
        sandbox: 'auto',
        createdBy: 'user',
      };
      const updatedClaw = {
        ...weakClaw,
        stopCondition: 'idle:3',
        missionContract: {
          successCriteria: ['Mission outcome is complete, specific, and verifiable'],
          deliverables: ['Final artifact or report with decisions and evidence'],
          constraints: ['Do not perform destructive actions without approval'],
          escalationRules: [
            'Escalate when permissions, budget, missing context, or destructive actions block progress',
          ],
          evidenceRequired: true,
          minConfidence: 0.8,
        },
        autonomyPolicy: {
          allowSelfModify: false,
          allowSubclaws: true,
          requireEvidence: true,
          destructiveActionPolicy: 'ask',
          filesystemScopes: [],
        },
      };
      service.getClaw.mockResolvedValue(weakClaw);
      service.updateClaw.mockResolvedValue(updatedClaw);

      const res = await app.request('/claws/claw-1/apply-recommendations', { method: 'POST' });
      expect(res.status).toBe(200);

      expect(service.updateClaw).toHaveBeenCalledWith(
        'claw-1',
        'user-1',
        expect.objectContaining({
          stopCondition: 'idle:3',
          missionContract: expect.objectContaining({
            evidenceRequired: true,
            minConfidence: 0.8,
          }),
          autonomyPolicy: expect.objectContaining({
            allowSelfModify: false,
            requireEvidence: true,
            destructiveActionPolicy: 'ask',
          }),
        })
      );
      expect(mockGetClawManager().updateClawConfig).toHaveBeenCalledWith('claw-1', updatedClaw);

      const body = await res.json();
      expect(body.data.applied).toContain('autonomy_policy');
      expect(body.data.skipped[0]).toContain('event_filters');
    });
  });

  // ---- List ----

  describe('GET /claws', () => {
    it('should return list of claws', async () => {
      service.listClawsPaginated.mockResolvedValue({
        claws: [{ id: 'claw-1', name: 'Test', mode: 'continuous' }],
        total: 1,
      });
      service.listSessions.mockReturnValue([]);

      const res = await app.request('/claws');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.claws).toHaveLength(1);
      expect(body.data.claws[0].id).toBe('claw-1');
    });

    it('should include session data when running', async () => {
      service.listClawsPaginated.mockResolvedValue({
        claws: [{ id: 'claw-1', name: 'Test' }],
        total: 1,
      });
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
      expect(body.data.claws[0].session.state).toBe('running');
      expect(body.data.claws[0].session.cyclesCompleted).toBe(5);
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

    it('should accept interval mode and local sandbox', async () => {
      service.createClaw.mockResolvedValue({ id: 'claw-new', name: 'Research' });

      const res = await app.request('/claws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Research',
          mission: 'Do research',
          mode: 'interval',
          sandbox: 'local',
          interval_ms: 60_000,
        }),
      });

      expect(res.status).toBe(201);
      expect(service.createClaw).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'interval',
          sandbox: 'local',
          intervalMs: 60_000,
        })
      );
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

    it('should map settings payload fields before update', async () => {
      service.updateClaw.mockResolvedValue({ id: 'claw-1', name: 'Updated' });

      const res = await app.request('/claws/claw-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'event',
          interval_ms: 60_000,
          event_filters: ['user.message'],
          auto_start: true,
          stop_condition: null,
          coding_agent_provider: null,
          provider: null,
          model: null,
          preset: 'code-review',
          mission_contract: {
            successCriteria: ['Find actionable issues'],
            deliverables: ['Severity report'],
            evidenceRequired: true,
            minConfidence: 0.8,
          },
          autonomy_policy: {
            allowSelfModify: false,
            allowSubclaws: true,
            destructiveActionPolicy: 'ask',
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(service.updateClaw).toHaveBeenCalledWith(
        'claw-1',
        'user-1',
        expect.objectContaining({
          mode: 'event',
          intervalMs: 60_000,
          eventFilters: ['user.message'],
          autoStart: true,
          stopCondition: null,
          codingAgentProvider: null,
          provider: null,
          model: null,
          preset: 'code-review',
          missionContract: expect.objectContaining({
            successCriteria: ['Find actionable issues'],
          }),
          autonomyPolicy: expect.objectContaining({
            allowSelfModify: false,
            allowSubclaws: true,
          }),
        })
      );
    });

    it('should reject invalid sandbox on update', async () => {
      const res = await app.request('/claws/claw-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox: 'none' }),
      });

      expect(res.status).toBe(400);
      expect(service.updateClaw).not.toHaveBeenCalled();
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

  describe('POST /claws/:id/deny-escalation', () => {
    it('should deny escalation', async () => {
      service.denyEscalation.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/deny-escalation', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.denied).toBe(true);
    });

    it('should pass reason to service', async () => {
      service.denyEscalation.mockResolvedValue(true);

      const res = await app.request('/claws/claw-1/deny-escalation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Not needed' }),
      });
      expect(res.status).toBe(200);
      expect(service.denyEscalation).toHaveBeenCalledWith('claw-1', 'user-1', 'Not needed');
    });

    it('should return 404 if no pending escalation', async () => {
      service.denyEscalation.mockResolvedValue(false);

      const res = await app.request('/claws/claw-1/deny-escalation', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });
});

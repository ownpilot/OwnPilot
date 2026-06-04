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

vi.mock('../services/claw/service.js', () => ({
  getClawService: mockGetClawService,
}));

const mockGetClawManager = vi.fn().mockReturnValue({
  updateClawConfig: vi.fn(),
});
vi.mock('../services/claw/manager.js', () => ({
  getClawManager: mockGetClawManager,
}));

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
    steerClaw: vi.fn(),
    resetFailures: vi.fn(),
    setNextIntent: vi.fn(),
    approveEscalation: vi.fn(),
    denyEscalation: vi.fn(),
    replacePlan: vi.fn(),
    updateTask: vi.fn(),
    splitTask: vi.fn(),
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
        'default',
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
        'default',
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

    it('treats an orphan_recovery lastCycleError as a soft restart signal, not "watch"', async () => {
      // A claw orphaned by a process restart is stamped lastCycleError='orphan_recovery'
      // by the reconciler. It is an infra event, not a cycle fault, so health must stay
      // healthy (with a soft signal) rather than dropping to 'watch'/35.
      service.listClawsPaginated.mockResolvedValue({
        claws: [
          {
            id: 'claw-1',
            name: 'Test',
            mode: 'interval',
            // contractScore >= 60 so the final branch is 'healthy' not contract-'watch'
            missionContract: { successCriteria: ['done'], deliverables: ['report'] },
          },
        ],
        total: 1,
      });
      service.listSessions.mockReturnValue([
        {
          config: { id: 'claw-1' },
          state: 'running',
          cyclesCompleted: 5,
          totalToolCalls: 20,
          totalCostUsd: 0,
          lastCycleAt: null,
          lastCycleDurationMs: null,
          lastCycleError: 'orphan_recovery',
          startedAt: new Date(),
          stoppedAt: null,
          artifacts: [],
          pendingEscalation: null,
        },
      ]);

      const res = await app.request('/claws');
      const body = await res.json();
      const health = body.data.claws[0].health;
      expect(health.status).toBe('healthy');
      expect(health.score).toBe(92);
      expect(health.signals).toContain('recovered from restart');
      expect(health.signals.some((s: string) => s.startsWith('last error:'))).toBe(false);
    });

    it('still flags a genuine lastCycleError as "watch"', async () => {
      service.listClawsPaginated.mockResolvedValue({
        claws: [
          {
            id: 'claw-1',
            name: 'Test',
            mode: 'interval',
            missionContract: { successCriteria: ['done'], deliverables: ['report'] },
          },
        ],
        total: 1,
      });
      service.listSessions.mockReturnValue([
        {
          config: { id: 'claw-1' },
          state: 'running',
          cyclesCompleted: 5,
          totalToolCalls: 20,
          totalCostUsd: 0,
          lastCycleAt: null,
          lastCycleDurationMs: null,
          lastCycleError: 'OpenAI API error: 400',
          startedAt: new Date(),
          stoppedAt: null,
          artifacts: [],
          pendingEscalation: null,
        },
      ]);

      const res = await app.request('/claws');
      const body = await res.json();
      const health = body.data.claws[0].health;
      expect(health.status).toBe('watch');
      expect(health.score).toBe(35);
      expect(health.signals[0]).toContain('last error: OpenAI API error');
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
        'default',
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

  // ---- Next intent ----

  describe('POST /claws/:id/next-intent', () => {
    it('queues an operator directive on a running claw', async () => {
      service.setNextIntent.mockResolvedValue(undefined);
      const res = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'switch to debugging the auth bug' }),
      });
      expect(res.status).toBe(200);
      expect(service.setNextIntent).toHaveBeenCalledWith(
        'claw-1',
        'default',
        'switch to debugging the auth bug'
      );
    });

    it('returns 400 on missing or empty intent', async () => {
      const r1 = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(r1.status).toBe(400);

      const r2 = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: '   ' }),
      });
      expect(r2.status).toBe(400);
    });

    it('returns 400 when service rejects on length', async () => {
      service.setNextIntent.mockRejectedValue(new Error('intent exceeds 500 chars — use foo'));
      const res = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'x'.repeat(600) }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the claw is not found', async () => {
      service.setNextIntent.mockRejectedValue(new Error('Claw not found'));
      const res = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'do the thing' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the claw is not running', async () => {
      service.setNextIntent.mockRejectedValue(new Error('Claw not running'));
      const res = await app.request('/claws/claw-1/next-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'do the thing' }),
      });
      expect(res.status).toBe(409);
    });
  });

  // ---- Reset failures ----

  describe('POST /claws/:id/reset-failures', () => {
    it('clears failures on a running claw', async () => {
      service.resetFailures.mockResolvedValue(undefined);
      const res = await app.request('/claws/claw-1/reset-failures', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(service.resetFailures).toHaveBeenCalledWith('claw-1', 'default');
      const body = (await res.json()) as { data: { reset: boolean } };
      expect(body.data).toEqual({ reset: true });
    });

    it('returns 404 when the claw is not found', async () => {
      service.resetFailures.mockRejectedValue(new Error('Claw not found'));
      const res = await app.request('/claws/claw-1/reset-failures', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the claw is not running', async () => {
      service.resetFailures.mockRejectedValue(new Error('Claw not running'));
      const res = await app.request('/claws/claw-1/reset-failures', { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  // ---- Plan editing ----

  describe('PUT /claws/:id/plan', () => {
    it('replaces the plan with a valid task list', async () => {
      service.replacePlan.mockResolvedValue([
        {
          id: 't1',
          title: 'Survey',
          status: 'pending',
          createdAt: 'x',
          updatedAt: 'x',
          cyclesInProgress: 0,
        },
      ]);
      const res = await app.request('/claws/claw-1/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [{ id: 't1', title: 'Survey' }] }),
      });
      expect(res.status).toBe(200);
      expect(service.replacePlan).toHaveBeenCalledWith('claw-1', 'default', [
        { id: 't1', title: 'Survey' },
      ]);
    });

    it('returns 400 when the service throws a validation error', async () => {
      service.replacePlan.mockRejectedValue(new Error('tasks[0].id must match /.../'));
      const res = await app.request('/claws/claw-1/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [{ id: 'bad id', title: 'x' }] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 when the claw is not running', async () => {
      service.replacePlan.mockRejectedValue(new Error('Claw not running'));
      const res = await app.request('/claws/claw-1/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [] }),
      });
      expect(res.status).toBe(409);
    });

    it('returns 404 when the claw is not found', async () => {
      service.replacePlan.mockRejectedValue(new Error('Claw not found'));
      const res = await app.request('/claws/claw-99/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [] }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /claws/:id/tasks/:taskId', () => {
    it('updates a single task', async () => {
      service.updateTask.mockResolvedValue({
        task: {
          id: 't1',
          title: 'A',
          status: 'completed',
          createdAt: 'x',
          updatedAt: 'y',
        },
        warnings: [],
      });
      const res = await app.request('/claws/claw-1/tasks/t1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', evidence: 'tests green' }),
      });
      expect(res.status).toBe(200);
      // The route merges the URL taskId into the args under `id`.
      expect(service.updateTask).toHaveBeenCalledWith('claw-1', 'default', {
        id: 't1',
        status: 'completed',
        evidence: 'tests green',
      });
    });

    it('returns 404 when the task id is unknown', async () => {
      service.updateTask.mockRejectedValue(new Error('Task "tX" not found.'));
      const res = await app.request('/claws/claw-1/tasks/tX', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 on focus-discipline violation', async () => {
      service.updateTask.mockRejectedValue(
        new Error('Cannot start "t2": task "t1" is already in_progress. ...')
      );
      const res = await app.request('/claws/claw-1/tasks/t2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /claws/:id/tasks/:taskId/split', () => {
    it('atomically splits a task into subtasks', async () => {
      service.splitTask.mockResolvedValue({
        parent: { id: 't1', title: 'A', status: 'blocked' },
        subtasks: [
          { id: 't1.1', title: 'sub1' },
          { id: 't1.2', title: 'sub2' },
        ],
      });
      const res = await app.request('/claws/claw-1/tasks/t1/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtasks: [{ title: 'sub1' }, { title: 'sub2' }],
        }),
      });
      expect(res.status).toBe(200);
      // The route folds the URL taskId into args.task_id so the service
      // gets the same shape regardless of whether the call came from REST
      // or from the tool dispatcher.
      expect(service.splitTask).toHaveBeenCalledWith('claw-1', 'default', {
        task_id: 't1',
        subtasks: [{ title: 'sub1' }, { title: 'sub2' }],
      });
    });

    it('returns 400 when fewer than 2 subtasks are provided', async () => {
      service.splitTask.mockRejectedValue(new Error('subtasks must have at least 2 entries'));
      const res = await app.request('/claws/claw-1/tasks/t1/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtasks: [{ title: 'only' }] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the parent task does not exist', async () => {
      service.splitTask.mockRejectedValue(new Error('Task "tX" not found.'));
      const res = await app.request('/claws/claw-1/tasks/tX/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtasks: [{ title: 'a' }, { title: 'b' }] }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the claw is not running', async () => {
      service.splitTask.mockRejectedValue(new Error('Claw not running'));
      const res = await app.request('/claws/claw-1/tasks/t1/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtasks: [{ title: 'a' }, { title: 'b' }] }),
      });
      expect(res.status).toBe(409);
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

  // ---- Eval ----

  describe('GET /claws/:id/eval', () => {
    it('returns reliability metrics computed from history', async () => {
      service.getClaw.mockResolvedValue({ id: 'claw-1', name: 'Test', mission: 'm' });
      service.getHistory.mockResolvedValue({
        entries: [
          {
            id: 'h-1',
            clawId: 'claw-1',
            cycleNumber: 1,
            entryType: 'cycle',
            success: true,
            toolCalls: [
              { tool: 'core.read_file', args: {}, result: 'ok', success: true, durationMs: 3 },
              {
                tool: 'core.edit_file',
                args: {},
                result: 'Error: oldText not found',
                success: false,
                durationMs: 2,
              },
            ],
            outputMessage: '',
            durationMs: 1000,
            executedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      });

      const res = await app.request('/claws/claw-1/eval');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.toolCalls.total).toBe(2);
      expect(body.data.toolCalls.failed).toBe(1);
      expect(body.data.byTool[0].tool).toBe('core.edit_file');
      expect(typeof body.data.reliabilityScore).toBe('number');
    });

    it('returns 404 when the claw does not exist', async () => {
      service.getClaw.mockResolvedValue(null);
      const res = await app.request('/claws/missing/eval');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /claws/fleet/eval', () => {
    it('aggregates reliability across all claws', async () => {
      service.listClaws.mockResolvedValue([
        { id: 'claw-1', name: 'Alpha' },
        { id: 'claw-2', name: 'Beta' },
      ]);
      service.getHistory.mockImplementation((id: string) =>
        Promise.resolve({
          entries: [
            {
              id: `h-${id}`,
              clawId: id,
              cycleNumber: 1,
              entryType: 'cycle',
              success: true,
              toolCalls: [
                { tool: 'core.read_file', args: {}, result: 'ok', success: true, durationMs: 1 },
                {
                  tool: 'core.edit_file',
                  args: {},
                  result: 'Error: oldText not found',
                  success: false,
                  durationMs: 1,
                },
                {
                  tool: 'core.edit_file',
                  args: {},
                  result: 'Error: oldText not found',
                  success: false,
                  durationMs: 1,
                },
              ],
              outputMessage: '',
              durationMs: 100,
              executedAt: new Date().toISOString(),
            },
          ],
          total: 1,
        })
      );

      const res = await app.request('/claws/fleet/eval');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.clawsEvaluated).toBe(2);
      expect(body.data.totals.toolCalls).toBe(6); // 3 per claw
      // edit_file repeated failure is systemic across both claws
      expect(body.data.topRepeatedFailures[0].tool).toBe('core.edit_file');
      expect(body.data.topRepeatedFailures[0].claws).toBe(2);
      expect(typeof body.data.fleetReliabilityScore).toBe('number');
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
      expect(service.denyEscalation).toHaveBeenCalledWith('claw-1', 'default', 'Not needed');
    });

    it('should return 404 if no pending escalation', async () => {
      service.denyEscalation.mockResolvedValue(false);

      const res = await app.request('/claws/claw-1/deny-escalation', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });
});

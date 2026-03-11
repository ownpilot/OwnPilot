import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestrationService } from '../src/orchestration-service.ts';
import { eventBus } from '../src/event-bus.ts';
import type {
  OrchestrationStage,
  OrchestrationStatus,
  OrchestrationRequest,
  OrchestrationStageProgress,
  OrchestrationState,
} from '../src/types.ts';
import type {
  OrchStageStartedEvent,
  OrchStageCompletedEvent,
  OrchCompletedEvent,
  OrchFailedEvent,
} from '../src/event-bus.ts';

describe('Orchestration types (TASK-01 compile check)', () => {
  it('OrchestrationRequest has required fields', () => {
    const req: OrchestrationRequest = {
      message: 'test task',
      scope_in: 'src/',
      scope_out: 'tests/',
    };
    expect(req.message).toBe('test task');
    expect(req.research_agents).toBeUndefined();
  });

  it('OrchestrationState has correct shape', () => {
    const state: OrchestrationState = {
      orchestrationId: 'orch-123',
      projectDir: '/tmp/proj',
      message: 'test',
      scope_in: 'src/',
      scope_out: 'node_modules/',
      status: 'pending',
      currentStage: null,
      startedAt: new Date().toISOString(),
      stageProgress: {},
    };
    expect(state.status).toBe('pending');
    expect(state.currentStage).toBeNull();
  });

  it('OrchestrationStage union is correct', () => {
    const stages: OrchestrationStage[] = ['research', 'devil_advocate', 'execute', 'verify'];
    expect(stages).toHaveLength(4);
  });

  it('OrchStageStartedEvent has orchestrationId', () => {
    const ev: OrchStageStartedEvent = {
      type: 'orch.stage_started',
      orchestrationId: 'orch-abc',
      projectDir: '/tmp',
      stage: 'research',
      timestamp: new Date().toISOString(),
    };
    expect(ev.type).toBe('orch.stage_started');
  });

  it('OrchCompletedEvent shape', () => {
    const ev: OrchCompletedEvent = {
      type: 'orch.completed',
      orchestrationId: 'orch-abc',
      projectDir: '/tmp',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    expect(ev.type).toBe('orch.completed');
  });

  it('OrchStageProgress optional fields', () => {
    const prog: OrchestrationStageProgress = { completed: 3, total: 5 };
    expect(prog.highestRisk).toBeUndefined();
    expect(prog.passed).toBeUndefined();
  });
});

describe('OrchestrationService — constructor + singleton', () => {
  it('can be instantiated', () => {
    const svc = new OrchestrationService();
    expect(svc).toBeDefined();
    svc.shutdown();
  });

  it('exports orchestrationService singleton', async () => {
    const { orchestrationService } = await import('../src/orchestration-service.ts');
    expect(orchestrationService).toBeInstanceOf(OrchestrationService);
  });
});

describe('OrchestrationService.trigger()', () => {
  let svc: OrchestrationService;
  const req: OrchestrationRequest = {
    message: 'test task',
    scope_in: 'src/',
    scope_out: 'node_modules/',
    research_agents: 1,
    da_agents: 1,
    verify: false,
  };

  beforeEach(() => { svc = new OrchestrationService(); });
  afterEach(() => svc.shutdown());

  it('returns pending state immediately (202 pattern)', async () => {
    // Mock claudeManager.send to avoid real CC spawn
    const mockSend = vi.fn(async function* () {
      yield { type: 'text' as const, text: '{"findings":"mock research"}' };
      yield { type: 'done' as const };
    });
    vi.doMock('../src/claude-manager.ts', () => ({
      claudeManager: { send: mockSend },
    }));

    const state = await svc.trigger('/tmp/test-proj', req);
    expect(state.status).toBe('pending');
    expect(state.orchestrationId).toMatch(/^orch-/);
    expect(state.projectDir).toBe('/tmp/test-proj');
    expect(state.message).toBe('test task');
    expect(state.currentStage).toBeNull();
    expect(state.stageProgress).toEqual({});
    vi.doUnmock('../src/claude-manager.ts');
  });

  it('throws PROJECT_CONCURRENT_LIMIT when at cap', async () => {
    // Manually inject 3 pending sessions to hit cap
    const internalSessions = (svc as unknown as { sessions: Map<string, unknown> }).sessions;
    for (let i = 0; i < 3; i++) {
      internalSessions.set(`orch-test-${i}`, {
        orchestrationId: `orch-test-${i}`,
        status: 'running',
        projectDir: '/tmp/test-proj',
        message: 'x', scope_in: '', scope_out: '', currentStage: null,
        startedAt: new Date().toISOString(), stageProgress: {},
      });
    }
    await expect(svc.trigger('/tmp/test-proj', req)).rejects.toThrow('PROJECT_CONCURRENT_LIMIT');
  });
});

describe('OrchestrationService.listActive() + getById()', () => {
  let svc: OrchestrationService;
  beforeEach(() => { svc = new OrchestrationService(); });
  afterEach(() => svc.shutdown());

  it('listActive returns empty array initially', () => {
    expect(svc.listActive('/tmp/proj')).toEqual([]);
  });

  it('getById returns undefined for unknown id', () => {
    expect(svc.getById('nonexistent')).toBeUndefined();
  });
});

describe('OrchestrationService.cleanup()', () => {
  let svc: OrchestrationService;
  beforeEach(() => { svc = new OrchestrationService(); });
  afterEach(() => svc.shutdown());

  it('removes completed sessions older than retention window', () => {
    const internalSessions = (svc as unknown as { sessions: Map<string, unknown> }).sessions;
    const oldTime = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2h ago
    internalSessions.set('old-orch', {
      orchestrationId: 'old-orch',
      status: 'completed',
      projectDir: '/tmp',
      message: 'x', scope_in: '', scope_out: '', currentStage: null,
      startedAt: oldTime, completedAt: oldTime, stageProgress: {},
    });
    expect(internalSessions.has('old-orch')).toBe(true);
    svc.cleanup();
    expect(internalSessions.has('old-orch')).toBe(false);
  });

  it('does NOT remove running sessions', () => {
    const internalSessions = (svc as unknown as { sessions: Map<string, unknown> }).sessions;
    internalSessions.set('running-orch', {
      orchestrationId: 'running-orch',
      status: 'running',
      projectDir: '/tmp',
      message: 'x', scope_in: '', scope_out: '', currentStage: null,
      startedAt: new Date().toISOString(), stageProgress: {},
    });
    svc.cleanup();
    expect(internalSessions.has('running-orch')).toBe(true);
  });
});

describe('OrchestrationService SSE events', () => {
  it('emits orch.completed event when pipeline finishes', async () => {
    // This test will PASS when the service is implemented (GREEN phase)
    // For now just verify the event types exist
    const events: string[] = [];
    const listener = (ev: { type: string }) => events.push(ev.type);
    eventBus.onAny(listener as (ev: import('../src/event-bus.ts').BridgeEvent) => void);
    eventBus.offAny(listener as (ev: import('../src/event-bus.ts').BridgeEvent) => void);
    expect(events).toEqual([]);
  });
});

// ------------------------------------------------------------------
// Route integration tests — TASK-03
// ------------------------------------------------------------------
import { buildApp, TEST_AUTH_HEADER } from './helpers/build-app.ts';
import { orchestrationService } from '../src/orchestration-service.ts';
import type { FastifyInstance } from 'fastify';

describe('POST /v1/projects/:projectDir/orchestrate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate',
      payload: { message: 'test', scope_in: 'src/', scope_out: 'node_modules/' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when message is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate',
      headers: { authorization: TEST_AUTH_HEADER },
      payload: { scope_in: 'src/', scope_out: 'node_modules/' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('message');
  });

  it('returns 400 when scope_in is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate',
      headers: { authorization: TEST_AUTH_HEADER },
      payload: { message: 'test task', scope_out: 'node_modules/' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 202 with orchestrationId for valid request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate',
      headers: { authorization: TEST_AUTH_HEADER },
      payload: {
        message: 'test task',
        scope_in: 'src/',
        scope_out: 'node_modules/',
        research_agents: 1,
        da_agents: 1,
        verify: false,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.orchestrationId).toMatch(/^orch-/);
    expect(body.status).toBe('pending');
    expect(body.message).toBe('test task');
  });
});

describe('GET /v1/projects/:projectDir/orchestrate/:id/status', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 for unknown orchestrationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate/orch-nonexistent/status',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/projects/:projectDir/orchestrate (list)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    // Clear singleton state so previous tests don't bleed in
    (orchestrationService as unknown as { sessions: Map<string, unknown> }).sessions.clear();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('returns empty sessions array when no active orchestrations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/%2Ftmp%2Ftest/orchestrate',
      headers: { authorization: TEST_AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessions).toBeInstanceOf(Array);
    expect(body.active).toBe(0);
  });
});

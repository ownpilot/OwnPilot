/**
 * Phase 18 Plan 03 — OrchestrationService GSD Integration Tests
 *
 * Tests plan_generation stage + GSD delegation pipeline.
 * TDD: Written BEFORE implementation (RED phase).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestrationService } from '../src/orchestration-service.ts';
import { eventBus } from '../src/event-bus.ts';
import type { OrchestrationStage, GeneratedPlan, OrchestrationRequest } from '../src/types.ts';
import type { BridgeEvent } from '../src/event-bus.ts';

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    send: vi.fn(),
  },
}));

vi.mock('../src/plan-generator.ts', () => ({
  generatePlans: vi.fn(),
  writePlanFiles: vi.fn(),
}));

vi.mock('../src/gsd-orchestration.ts', () => ({
  gsdOrchestration: {
    trigger: vi.fn(),
    getStatus: vi.fn(),
    listActive: vi.fn().mockReturnValue([]),
  },
}));

// Import mocked modules (resolved after hoisted mocks)
import { claudeManager } from '../src/claude-manager.ts';
import { generatePlans, writePlanFiles } from '../src/plan-generator.ts';
import { gsdOrchestration } from '../src/gsd-orchestration.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_PLAN: GeneratedPlan = {
  phaseNumber: 19,
  phaseTitle: 'test phase',
  plans: [
    {
      planId: '01',
      title: 'test plan',
      wave: 1,
      dependsOn: [],
      tdd: true,
      goal: 'test goal',
      tasks: ['task 1'],
      testStrategy: 'unit tests',
      estimatedFiles: ['src/foo.ts'],
    },
  ],
};

const BASE_REQ: OrchestrationRequest = {
  message: 'implement feature X',
  scope_in: 'src/',
  scope_out: 'node_modules/',
  research_agents: 1,
  da_agents: 1,
  verify: false,
};

const GSD_SESSION_COMPLETED = {
  gsdSessionId: 'gsd-test-123',
  conversationId: 'conv-123',
  projectDir: '/tmp/proj',
  command: 'execute-phase' as const,
  args: {},
  status: 'completed' as const,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// TASK-01: OrchestrationStage type includes plan_generation
// ---------------------------------------------------------------------------

describe('OrchestrationStage type includes plan_generation (TASK-01)', () => {
  it('plan_generation is a valid OrchestrationStage value', () => {
    const stage: OrchestrationStage = 'plan_generation';
    expect(stage).toBe('plan_generation');
  });

  it('stage union has 5 members including plan_generation', () => {
    const stages: OrchestrationStage[] = [
      'research',
      'devil_advocate',
      'plan_generation',
      'execute',
      'verify',
    ];
    expect(stages).toHaveLength(5);
    expect(stages).toContain('plan_generation');
  });
});

// ---------------------------------------------------------------------------
// TASK-02: plan_generation stage fires events
// ---------------------------------------------------------------------------

describe('OrchestrationService — plan_generation stage events', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });

    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockResolvedValue(['path/to/19-01-PLAN.md']);
    vi.mocked(gsdOrchestration.trigger).mockResolvedValue({ ...GSD_SESSION_COMPLETED });
    vi.mocked(gsdOrchestration.getStatus).mockReturnValue({ ...GSD_SESSION_COMPLETED });

    process.env.ORCH_GSD_POLL_MS = '10';
    process.env.ORCH_GSD_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('fires orch.stage_started and orch.stage_completed for plan_generation', async () => {
    const stageEvents: string[] = [];
    const listener = (ev: BridgeEvent) => {
      if (ev.type === 'orch.stage_started' || ev.type === 'orch.stage_completed') {
        stageEvents.push(`${ev.type}:${'stage' in ev ? ev.stage : ''}`);
      }
    };
    eventBus.onAny(listener);

    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    eventBus.offAny(listener);

    expect(stageEvents).toContain('orch.stage_started:plan_generation');
    expect(stageEvents).toContain('orch.stage_completed:plan_generation');
  });

  it('calls generatePlans with correct input derived from request', async () => {
    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    expect(generatePlans).toHaveBeenCalledWith(
      expect.objectContaining({
        message: BASE_REQ.message,
        scopeIn: BASE_REQ.scope_in,
        scopeOut: BASE_REQ.scope_out,
        projectDir: '/tmp/proj',
        researchFindings: expect.any(Array),
        daRiskScore: expect.any(Number),
      }),
    );
  });

  it('calls writePlanFiles with generated plan', async () => {
    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    expect(writePlanFiles).toHaveBeenCalledWith(
      '/tmp/proj',
      MOCK_PLAN,
      BASE_REQ.scope_in,
      BASE_REQ.scope_out,
    );
  });

  it('stage_completed event includes planCount in data', async () => {
    let planGenerationCompletedData: unknown;
    const listener = (ev: BridgeEvent) => {
      if (ev.type === 'orch.stage_completed' && 'stage' in ev && ev.stage === 'plan_generation') {
        planGenerationCompletedData = 'data' in ev ? ev.data : undefined;
      }
    };
    eventBus.onAny(listener);

    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    eventBus.offAny(listener);

    expect(planGenerationCompletedData).toEqual(
      expect.objectContaining({ planCount: MOCK_PLAN.plans.length }),
    );
  });
});

// ---------------------------------------------------------------------------
// TASK-03 + TASK-04: Full pipeline flow
// ---------------------------------------------------------------------------

describe('OrchestrationService — full pipeline flow', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });

    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockResolvedValue([]);

    const gsdState = {
      gsdSessionId: 'gsd-pipeline-456',
      conversationId: 'conv-456',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'pending' as const,
      startedAt: new Date().toISOString(),
    };
    vi.mocked(gsdOrchestration.trigger).mockResolvedValue(gsdState);
    vi.mocked(gsdOrchestration.getStatus).mockReturnValue({
      ...gsdState,
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
    });

    process.env.ORCH_GSD_POLL_MS = '10';
    process.env.ORCH_GSD_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('pipeline stages fire in order: research → DA → plan_generation → execute', async () => {
    const stageOrder: string[] = [];
    const listener = (ev: BridgeEvent) => {
      if (ev.type === 'orch.stage_started' && 'stage' in ev) {
        stageOrder.push(ev.stage as string);
      }
    };
    eventBus.onAny(listener);

    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 400));

    eventBus.offAny(listener);

    expect(stageOrder).toEqual(['research', 'devil_advocate', 'plan_generation', 'execute']);
  });

  it('pipeline emits orch.completed and sets status=completed', async () => {
    let completedFired = false;
    const listener = (ev: BridgeEvent) => {
      if (ev.type === 'orch.completed') completedFired = true;
    };
    eventBus.onAny(listener);

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 400));

    eventBus.offAny(listener);

    expect(completedFired).toBe(true);
    expect(svc.getById(state.orchestrationId)?.status).toBe('completed');
  });

  it('gsdOrchestration.trigger is called with execute-phase command', async () => {
    await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 400));

    expect(gsdOrchestration.trigger).toHaveBeenCalledWith(
      '/tmp/proj',
      expect.objectContaining({ command: 'execute-phase' }),
    );
  });
});

// ---------------------------------------------------------------------------
// TASK-03: GSD polling — completed
// ---------------------------------------------------------------------------

describe('OrchestrationService — GSD polling completed', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });
    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockResolvedValue([]);

    process.env.ORCH_GSD_POLL_MS = '10';
    process.env.ORCH_GSD_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('completes pipeline when GSD status is completed on first poll', async () => {
    vi.mocked(gsdOrchestration.trigger).mockResolvedValue({
      gsdSessionId: 'gsd-poll-complete',
      conversationId: 'conv-poll',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'pending' as const,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(gsdOrchestration.getStatus).mockReturnValue({
      gsdSessionId: 'gsd-poll-complete',
      conversationId: 'conv-poll',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'completed' as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 400));

    expect(svc.getById(state.orchestrationId)?.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// TASK-03: GSD polling — failed
// ---------------------------------------------------------------------------

describe('OrchestrationService — GSD polling failed', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });
    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockResolvedValue([]);

    process.env.ORCH_GSD_POLL_MS = '10';
    process.env.ORCH_GSD_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('pipeline fails when GSD status is failed', async () => {
    vi.mocked(gsdOrchestration.trigger).mockResolvedValue({
      gsdSessionId: 'gsd-poll-fail',
      conversationId: 'conv-poll-fail',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'pending' as const,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(gsdOrchestration.getStatus).mockReturnValue({
      gsdSessionId: 'gsd-poll-fail',
      conversationId: 'conv-poll-fail',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'failed' as const,
      error: 'GSD task failed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 400));

    const finalState = svc.getById(state.orchestrationId);
    expect(finalState?.status).toBe('failed');
    expect(finalState?.error).toContain('GSD execution failed');
  });
});

// ---------------------------------------------------------------------------
// TASK-03: GSD polling — timeout
// ---------------------------------------------------------------------------

describe('OrchestrationService — GSD polling timeout', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });
    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockResolvedValue([]);
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('pipeline fails with timeout error when GSD stays running', async () => {
    process.env.ORCH_GSD_TIMEOUT_MS = '80';
    process.env.ORCH_GSD_POLL_MS = '10';

    vi.mocked(gsdOrchestration.trigger).mockResolvedValue({
      gsdSessionId: 'gsd-poll-timeout',
      conversationId: 'conv-poll-timeout',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'pending' as const,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(gsdOrchestration.getStatus).mockReturnValue({
      gsdSessionId: 'gsd-poll-timeout',
      conversationId: 'conv-poll-timeout',
      projectDir: '/tmp/proj',
      command: 'execute-phase' as const,
      args: {},
      status: 'running' as const,
      startedAt: new Date().toISOString(),
    });

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 600)); // wait well past the 80ms timeout

    const finalState = svc.getById(state.orchestrationId);
    expect(finalState?.status).toBe('failed');
    expect(finalState?.error).toContain('timed out');
  });
});

// ---------------------------------------------------------------------------
// plan_generation error propagates to pipeline failure
// ---------------------------------------------------------------------------

describe('OrchestrationService — plan_generation error propagation', () => {
  let svc: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrchestrationService();

    vi.mocked(claudeManager.send).mockImplementation(async function* () {
      yield { type: 'text' as const, text: '{"risk": 3, "reason": "low risk"}' };
    });

    process.env.ORCH_GSD_POLL_MS = '10';
    process.env.ORCH_GSD_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    svc.shutdown();
    delete process.env.ORCH_GSD_POLL_MS;
    delete process.env.ORCH_GSD_TIMEOUT_MS;
  });

  it('generatePlans failure causes pipeline status=failed with original error', async () => {
    vi.mocked(generatePlans).mockRejectedValue(new Error('CC synthesis failed: invalid JSON'));
    vi.mocked(writePlanFiles).mockResolvedValue([]);

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    const finalState = svc.getById(state.orchestrationId);
    expect(finalState?.status).toBe('failed');
    expect(finalState?.error).toContain('CC synthesis failed');
  });

  it('writePlanFiles failure causes pipeline to fail', async () => {
    vi.mocked(generatePlans).mockResolvedValue(MOCK_PLAN);
    vi.mocked(writePlanFiles).mockRejectedValue(new Error('EACCES: permission denied'));

    const state = await svc.trigger('/tmp/proj', BASE_REQ);
    await new Promise(r => setTimeout(r, 300));

    const finalState = svc.getById(state.orchestrationId);
    expect(finalState?.status).toBe('failed');
    expect(finalState?.error).toContain('EACCES');
  });
});

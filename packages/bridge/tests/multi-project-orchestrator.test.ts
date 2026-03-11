/**
 * Multi-Project Orchestrator Tests (H6)
 *
 * TDD: RED phase — written BEFORE implementation.
 *
 * Tests cover:
 * - trigger() synchronous state creation + wave assignment
 * - trigger() validation: cycle, missing ref, duplicate IDs
 * - trigger() auto-ID resolution from dir basename
 * - runOrchestration() all complete → status 'completed'
 * - runOrchestration() dependency failure → cancellation chain
 * - runOrchestration() all fail → status 'failed'
 * - runOrchestration() some complete some fail → status 'partial'
 * - runOrchestration() wave ordering enforced
 * - SSE events emitted correctly
 * - getById() / listAll()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../src/event-bus.ts';
import type { BridgeEvent } from '../src/event-bus.ts';
import type { GsdSessionState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Mock gsdOrchestration BEFORE importing MultiProjectOrchestrator
// ---------------------------------------------------------------------------

const { mockGsdTrigger, mockGsdGetStatus } = vi.hoisted(() => ({
  mockGsdTrigger: vi.fn(),
  mockGsdGetStatus: vi.fn(),
}));

vi.mock('../src/gsd-orchestration.ts', () => ({
  gsdOrchestration: {
    trigger: mockGsdTrigger,
    getStatus: mockGsdGetStatus,
    listActive: vi.fn().mockReturnValue([]),
  },
}));

import { MultiProjectOrchestrator } from '../src/multi-project-orchestrator.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGsdState(overrides: Partial<GsdSessionState> = {}): GsdSessionState {
  return {
    gsdSessionId: 'gsd-' + Math.random().toString(36).slice(2),
    conversationId: 'conv-' + Math.random().toString(36).slice(2),
    projectDir: '/tmp/proj',
    command: 'execute-phase',
    args: {},
    status: 'pending',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function collectEvents(eventName: string): BridgeEvent[] {
  const events: BridgeEvent[] = [];
  eventBus.on(eventName as BridgeEvent['type'], (e) => events.push(e as BridgeEvent));
  return events;
}

/** Wait for async pipeline to complete */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MultiProjectOrchestrator — trigger() synchronous state', () => {
  let orchestrator: MultiProjectOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: GSD session immediately completes (no waiting)
    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });
    orchestrator = new MultiProjectOrchestrator({ pollIntervalMs: 1 });
  });

  afterEach(() => {
    orchestrator.shutdown();
  });

  it('returns state with multiOrchId immediately', async () => {
    const state = await orchestrator.trigger([
      { dir: '/tmp/proj-a', command: 'execute-phase' },
    ]);
    expect(state.multiOrchId).toMatch(/^multi-orch-/);
    expect(state.status).toBe('pending');
    expect(state.startedAt).toBeDefined();
  });

  it('assigns project IDs from id field when provided', async () => {
    const state = await orchestrator.trigger([
      { id: 'alpha', dir: '/tmp/proj-a', command: 'execute-phase' },
      { id: 'beta', dir: '/tmp/proj-b', command: 'execute-phase' },
    ]);
    const ids = state.projects.map((p) => p.id);
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });

  it('auto-resolves project IDs from dir basename when id not provided', async () => {
    const state = await orchestrator.trigger([
      { dir: '/home/user/my-project', command: 'execute-phase' },
      { dir: '/home/user/other-project', command: 'plan-phase' },
    ]);
    const ids = state.projects.map((p) => p.id);
    expect(ids).toContain('my-project');
    expect(ids).toContain('other-project');
  });

  it('assigns wave 1 to all independent projects', async () => {
    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
      { id: 'c', dir: '/tmp/c', command: 'execute-phase' },
    ]);
    expect(state.totalWaves).toBe(1);
    for (const p of state.projects) {
      expect(p.wave).toBe(1);
    }
  });

  it('assigns correct waves for a dependency chain A→B', async () => {
    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase', depends_on: ['a'] },
    ]);
    expect(state.totalWaves).toBe(2);
    const a = state.projects.find((p) => p.id === 'a')!;
    const b = state.projects.find((p) => p.id === 'b')!;
    expect(a.wave).toBe(1);
    expect(b.wave).toBe(2);
  });

  it('assigns correct waves for fan-out: A→C, B→C (A and B parallel, C after both)', async () => {
    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
      { id: 'c', dir: '/tmp/c', command: 'execute-phase', depends_on: ['a', 'b'] },
    ]);
    expect(state.totalWaves).toBe(2);
    const a = state.projects.find((p) => p.id === 'a')!;
    const b = state.projects.find((p) => p.id === 'b')!;
    const c = state.projects.find((p) => p.id === 'c')!;
    expect(a.wave).toBe(1);
    expect(b.wave).toBe(1);
    expect(c.wave).toBe(2);
  });

  it('all projects start with status pending', async () => {
    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
    ]);
    for (const p of state.projects) {
      expect(p.status).toBe('pending');
    }
  });

  it('throws on cyclic dependency', async () => {
    await expect(
      orchestrator.trigger([
        { id: 'a', dir: '/tmp/a', command: 'execute-phase', depends_on: ['b'] },
        { id: 'b', dir: '/tmp/b', command: 'execute-phase', depends_on: ['a'] },
      ]),
    ).rejects.toThrow(/cycle/i);
  });

  it('throws on missing dependency reference', async () => {
    await expect(
      orchestrator.trigger([
        { id: 'a', dir: '/tmp/a', command: 'execute-phase', depends_on: ['nonexistent'] },
      ]),
    ).rejects.toThrow(/Missing reference/i);
  });

  it('throws on duplicate project IDs', async () => {
    await expect(
      orchestrator.trigger([
        { id: 'same', dir: '/tmp/a', command: 'execute-phase' },
        { id: 'same', dir: '/tmp/b', command: 'execute-phase' },
      ]),
    ).rejects.toThrow(/Duplicate/i);
  });

  it('throws on empty items array', async () => {
    await expect(orchestrator.trigger([])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runOrchestration() — async pipeline behaviour
// ---------------------------------------------------------------------------

describe('MultiProjectOrchestrator — runOrchestration() pipeline', () => {
  let orchestrator: MultiProjectOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new MultiProjectOrchestrator({ pollIntervalMs: 1 });
  });

  afterEach(() => {
    orchestrator.shutdown();
  });

  it('status transitions to completed when all projects succeed', async () => {
    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    expect(final.status).toBe('completed');
    expect(final.completedAt).toBeDefined();
    for (const p of final.projects) {
      expect(p.status).toBe('completed');
    }
  });

  it('assigns gsdSessionId to each project after trigger', async () => {
    const gsdSessionA = makeGsdState({ gsdSessionId: 'gsd-aaa', status: 'completed' });
    const gsdSessionB = makeGsdState({ gsdSessionId: 'gsd-bbb', status: 'completed' });
    mockGsdTrigger.mockResolvedValueOnce(gsdSessionA).mockResolvedValueOnce(gsdSessionB);
    mockGsdGetStatus.mockImplementation((id: string) => {
      if (id === 'gsd-aaa') return { ...gsdSessionA, status: 'completed' };
      if (id === 'gsd-bbb') return { ...gsdSessionB, status: 'completed' };
    });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    const projA = final.projects.find((p) => p.id === 'a')!;
    const projB = final.projects.find((p) => p.id === 'b')!;
    expect(projA.gsdSessionId).toBe('gsd-aaa');
    expect(projB.gsdSessionId).toBe('gsd-bbb');
  });

  it('status transitions to failed when all projects fail', async () => {
    const gsdSession = makeGsdState({ status: 'failed', error: 'build error' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'failed', error: 'build error' });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    expect(final.status).toBe('failed');
    expect(final.projects[0].status).toBe('failed');
    expect(final.projects[0].error).toBeTruthy();
  });

  it('cancels dependent project when dependency fails → status partial', async () => {
    const gsdFail = makeGsdState({ gsdSessionId: 'gsd-fail', status: 'failed', error: 'oops' });
    mockGsdTrigger.mockResolvedValue(gsdFail);
    mockGsdGetStatus.mockReturnValue({ ...gsdFail, status: 'failed' });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase', depends_on: ['a'] },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    const projA = final.projects.find((p) => p.id === 'a')!;
    const projB = final.projects.find((p) => p.id === 'b')!;

    expect(projA.status).toBe('failed');
    expect(projB.status).toBe('cancelled');
    // One failed (a), one cancelled (b) but zero completed → 'failed' overall
    expect(final.status).toBe('failed');
  });

  it('status partial when some complete and some fail', async () => {
    // A succeeds, B fails (no dependency between them)
    const gsdA = makeGsdState({ gsdSessionId: 'gsd-a', status: 'completed' });
    const gsdB = makeGsdState({ gsdSessionId: 'gsd-b', status: 'failed', error: 'error' });
    mockGsdTrigger
      .mockResolvedValueOnce(gsdA)
      .mockResolvedValueOnce(gsdB);
    mockGsdGetStatus.mockImplementation((id: string) => {
      if (id === 'gsd-a') return { ...gsdA, status: 'completed' };
      if (id === 'gsd-b') return { ...gsdB, status: 'failed' };
    });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    expect(final.status).toBe('partial');
  });

  it('wave ordering: project-b GSD trigger fires AFTER project-a completes', async () => {
    const triggerOrder: string[] = [];
    const gsdA = makeGsdState({ gsdSessionId: 'gsd-a-wave', status: 'completed' });
    const gsdB = makeGsdState({ gsdSessionId: 'gsd-b-wave', status: 'completed' });

    mockGsdTrigger.mockImplementation(async (dir: string) => {
      if (dir === '/tmp/wave-a') {
        triggerOrder.push('a');
        return gsdA;
      }
      triggerOrder.push('b');
      return gsdB;
    });
    mockGsdGetStatus.mockImplementation((id: string) => {
      if (id === 'gsd-a-wave') return { ...gsdA, status: 'completed' };
      if (id === 'gsd-b-wave') return { ...gsdB, status: 'completed' };
    });

    await orchestrator.trigger([
      { id: 'a', dir: '/tmp/wave-a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/wave-b', command: 'execute-phase', depends_on: ['a'] },
    ]);

    await wait(200);

    expect(triggerOrder).toEqual(['a', 'b']);
  });

  it('phase number is passed as GSD command argument', async () => {
    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });

    await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase', phase: 5 },
    ]);

    await wait(200);

    expect(mockGsdTrigger).toHaveBeenCalledWith(
      '/tmp/a',
      expect.objectContaining({ command: 'execute-phase 5' }),
    );
  });

  it('gsdOrchestration.trigger() failure marks project as failed', async () => {
    mockGsdTrigger.mockRejectedValue(new Error('quota exceeded'));

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
    ]);

    await wait(200);

    const final = orchestrator.getById(state.multiOrchId)!;
    expect(final.projects[0].status).toBe('failed');
    expect(final.projects[0].error).toContain('quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// SSE events
// ---------------------------------------------------------------------------

describe('MultiProjectOrchestrator — SSE events', () => {
  let orchestrator: MultiProjectOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new MultiProjectOrchestrator({ pollIntervalMs: 1 });
  });

  afterEach(() => {
    orchestrator.shutdown();
    eventBus.removeAllListeners();
  });

  it('emits multi_project.started event', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('multi_project.started' as BridgeEvent['type'], (e) =>
      events.push(e as BridgeEvent),
    );

    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });

    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
    ]);

    await wait(200);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events[0] as { multiOrchId: string }).multiOrchId).toBe(state.multiOrchId);
  });

  it('emits multi_project.project_completed for each completed project', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('multi_project.project_completed' as BridgeEvent['type'], (e) =>
      events.push(e as BridgeEvent),
    );

    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });

    await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase' },
    ]);

    await wait(200);

    expect(events.length).toBe(2);
  });

  it('emits multi_project.project_cancelled for cancelled project', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('multi_project.project_cancelled' as BridgeEvent['type'], (e) =>
      events.push(e as BridgeEvent),
    );

    const gsdFail = makeGsdState({ status: 'failed', error: 'oops' });
    mockGsdTrigger.mockResolvedValue(gsdFail);
    mockGsdGetStatus.mockReturnValue({ ...gsdFail, status: 'failed' });

    await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
      { id: 'b', dir: '/tmp/b', command: 'execute-phase', depends_on: ['a'] },
    ]);

    await wait(200);

    expect(events.length).toBe(1);
    expect((events[0] as { projectId: string }).projectId).toBe('b');
  });

  it('emits multi_project.completed with final status', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('multi_project.completed' as BridgeEvent['type'], (e) =>
      events.push(e as BridgeEvent),
    );

    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });

    await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
    ]);

    await wait(200);

    expect(events.length).toBe(1);
    expect((events[0] as { status: string }).status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// getById() / listAll()
// ---------------------------------------------------------------------------

describe('MultiProjectOrchestrator — getById() / listAll()', () => {
  let orchestrator: MultiProjectOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    const gsdSession = makeGsdState({ status: 'completed' });
    mockGsdTrigger.mockResolvedValue(gsdSession);
    mockGsdGetStatus.mockReturnValue({ ...gsdSession, status: 'completed' });
    orchestrator = new MultiProjectOrchestrator({ pollIntervalMs: 1 });
  });

  afterEach(() => {
    orchestrator.shutdown();
  });

  it('getById() returns state by multiOrchId', async () => {
    const state = await orchestrator.trigger([
      { id: 'a', dir: '/tmp/a', command: 'execute-phase' },
    ]);
    const found = orchestrator.getById(state.multiOrchId);
    expect(found).toBeDefined();
    expect(found!.multiOrchId).toBe(state.multiOrchId);
  });

  it('getById() returns undefined for unknown id', () => {
    expect(orchestrator.getById('nonexistent')).toBeUndefined();
  });

  it('listAll() returns all triggered sessions', async () => {
    const s1 = await orchestrator.trigger([{ id: 'a', dir: '/tmp/a', command: 'execute-phase' }]);
    const s2 = await orchestrator.trigger([{ id: 'x', dir: '/tmp/x', command: 'plan-phase' }]);
    const all = orchestrator.listAll();
    const ids = all.map((s) => s.multiOrchId);
    expect(ids).toContain(s1.multiOrchId);
    expect(ids).toContain(s2.multiOrchId);
  });
});

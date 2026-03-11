/**
 * ReflectionService Tests (H7)
 *
 * TDD: RED phase — written BEFORE implementation.
 *
 * Tests cover:
 * - trigger() synchronous state creation
 * - Pipeline: all checks pass → status 'passed', no CC fix
 * - Pipeline: check fails → CC fix → checks pass → status 'passed'
 * - Pipeline: check fails → CC fix fails 3 times → status 'failed'
 * - SSE events emitted
 * - getById() / listByProject()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../src/event-bus.ts';
import type { BridgeEvent } from '../src/event-bus.ts';
import type { QualityGateResult, ReflectState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Mock QualityGate and claudeManager
// ---------------------------------------------------------------------------

const { MockQualityGate, mockQualityGateRun, mockClaudeSend } = vi.hoisted(() => {
  const mockQualityGateRun = vi.fn();
  const mockClaudeSend = vi.fn();
  function MockQualityGate(this: { run: typeof mockQualityGateRun }) {
    this.run = mockQualityGateRun;
  }
  return { MockQualityGate, mockQualityGateRun, mockClaudeSend };
});

vi.mock('../src/quality-gate.ts', () => ({
  QualityGate: MockQualityGate,
}));

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    send: mockClaudeSend,
  },
}));

import { ReflectionService } from '../src/reflection-service.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makePassedResult(): QualityGateResult {
  return {
    passed: true,
    checks: [
      { name: 'tests', passed: true, details: '42 tests passed' },
      { name: 'scope_drift', passed: true, details: 'No drift' },
      { name: 'commit_quality', passed: true, details: 'All conventional' },
    ],
    timestamp: new Date().toISOString(),
  };
}

function makeFailedResult(failedCheck = 'tests'): QualityGateResult {
  return {
    passed: false,
    checks: [
      {
        name: failedCheck as 'tests' | 'scope_drift' | 'commit_quality',
        passed: false,
        details: 'Check failed',
        issues: ['issue 1'],
      },
      { name: 'scope_drift', passed: true, details: 'No drift' },
      { name: 'commit_quality', passed: true, details: 'All conventional' },
    ],
    timestamp: new Date().toISOString(),
  };
}

// Async generator that yields text chunks (simulates claudeManager.send)
async function* makeTextStream(text: string) {
  yield { type: 'text' as const, text };
}

// ---------------------------------------------------------------------------
// trigger() synchronous
// ---------------------------------------------------------------------------

describe('ReflectionService — trigger() synchronous', () => {
  let service: ReflectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQualityGateRun.mockResolvedValue(makePassedResult());
    service = new ReflectionService({ maxAttempts: 3 });
  });

  afterEach(() => service.shutdown());

  it('returns state with reflectId immediately', async () => {
    const state = await service.trigger('/tmp/proj');
    expect(state.reflectId).toMatch(/^reflect-/);
    expect(state.status).toBe('pending');
    expect(state.startedAt).toBeDefined();
    expect(state.projectDir).toBe('/tmp/proj');
  });

  it('stores scopeIn in state', async () => {
    const state = await service.trigger('/tmp/proj', 'src/');
    expect(state.scopeIn).toBe('src/');
  });

  it('starts with empty attempts array', async () => {
    const state = await service.trigger('/tmp/proj');
    expect(state.attempts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pipeline — happy path
// ---------------------------------------------------------------------------

describe('ReflectionService — pipeline happy path', () => {
  let service: ReflectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReflectionService({ maxAttempts: 3 });
  });

  afterEach(() => service.shutdown());

  it('status transitions to passed when all checks pass', async () => {
    mockQualityGateRun.mockResolvedValue(makePassedResult());

    const state = await service.trigger('/tmp/proj', 'src/');
    await wait(200);

    const final = service.getById(state.reflectId)!;
    expect(final.status).toBe('passed');
    expect(final.completedAt).toBeDefined();
    expect(final.finalResult?.passed).toBe(true);
  });

  it('records one attempt when checks pass on first try', async () => {
    mockQualityGateRun.mockResolvedValue(makePassedResult());

    const state = await service.trigger('/tmp/proj');
    await wait(200);

    const final = service.getById(state.reflectId)!;
    expect(final.attempts).toHaveLength(1);
    expect(final.attempts[0].attempt).toBe(1);
    expect(final.attempts[0].result.passed).toBe(true);
    expect(final.attempts[0].fixApplied).toBe(false);
  });

  it('does NOT spawn CC fix when checks pass', async () => {
    mockQualityGateRun.mockResolvedValue(makePassedResult());

    const state = await service.trigger('/tmp/proj');
    await wait(200);

    expect(mockClaudeSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pipeline — fix loop
// ---------------------------------------------------------------------------

describe('ReflectionService — fix loop', () => {
  let service: ReflectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClaudeSend.mockReturnValue(makeTextStream('Fixed the issue'));
    service = new ReflectionService({ maxAttempts: 3 });
  });

  afterEach(() => service.shutdown());

  it('spawns CC fix when first check fails, succeeds on 2nd attempt → passed', async () => {
    mockQualityGateRun
      .mockResolvedValueOnce(makeFailedResult('tests'))  // attempt 1: fail
      .mockResolvedValueOnce(makePassedResult());          // attempt 2: pass

    const state = await service.trigger('/tmp/proj', 'src/');
    await wait(300);

    const final = service.getById(state.reflectId)!;
    expect(final.status).toBe('passed');
    expect(final.attempts).toHaveLength(2);
    expect(final.attempts[0].fixApplied).toBe(true);
    expect(final.attempts[0].fixConversationId).toBeDefined();
    expect(mockClaudeSend).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxAttempts and status failed when all fail', async () => {
    mockQualityGateRun.mockResolvedValue(makeFailedResult('tests'));

    const state = await service.trigger('/tmp/proj', 'src/');
    await wait(500);

    const final = service.getById(state.reflectId)!;
    expect(final.status).toBe('failed');
    // 3 gate runs: attempt 1 fail + attempt 2 fail + attempt 3 fail
    expect(final.attempts).toHaveLength(3);
    // CC fix called on attempts 1 and 2 (not 3 — no point fixing after last attempt)
    expect(mockClaudeSend).toHaveBeenCalledTimes(2);
  });

  it('fix CC prompt includes failing issues', async () => {
    mockQualityGateRun
      .mockResolvedValueOnce(makeFailedResult('tests'))
      .mockResolvedValueOnce(makePassedResult());

    await service.trigger('/tmp/proj', 'src/');
    await wait(300);

    const sendCall = mockClaudeSend.mock.calls[0];
    const prompt = sendCall[1] as string;
    expect(prompt).toMatch(/issue|fail|quality/i);
  });

  it('fix CC conversationId is unique per attempt', async () => {
    mockQualityGateRun
      .mockResolvedValueOnce(makeFailedResult('tests'))
      .mockResolvedValueOnce(makeFailedResult('tests'))
      .mockResolvedValueOnce(makePassedResult());

    const state = await service.trigger('/tmp/proj');
    await wait(500);

    const final = service.getById(state.reflectId)!;
    const id1 = final.attempts[0].fixConversationId;
    const id2 = final.attempts[1].fixConversationId;
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// SSE events
// ---------------------------------------------------------------------------

describe('ReflectionService — SSE events', () => {
  let service: ReflectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReflectionService({ maxAttempts: 3 });
  });

  afterEach(() => {
    service.shutdown();
    eventBus.removeAllListeners();
  });

  it('emits reflect.started event', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('reflect.started' as BridgeEvent['type'], (e) => events.push(e as BridgeEvent));

    mockQualityGateRun.mockResolvedValue(makePassedResult());
    const state = await service.trigger('/tmp/proj');
    await wait(200);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events[0] as { reflectId: string }).reflectId).toBe(state.reflectId);
  });

  it('emits reflect.check_completed for each check', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('reflect.check_completed' as BridgeEvent['type'], (e) => events.push(e as BridgeEvent));

    mockQualityGateRun.mockResolvedValue(makePassedResult());
    await service.trigger('/tmp/proj');
    await wait(200);

    // 3 checks × 1 attempt = 3 events
    expect(events.length).toBe(3);
  });

  it('emits reflect.passed when all checks pass', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('reflect.passed' as BridgeEvent['type'], (e) => events.push(e as BridgeEvent));

    mockQualityGateRun.mockResolvedValue(makePassedResult());
    const state = await service.trigger('/tmp/proj');
    await wait(200);

    expect(events.length).toBe(1);
    expect((events[0] as { reflectId: string }).reflectId).toBe(state.reflectId);
  });

  it('emits reflect.failed when max attempts exhausted', async () => {
    const events: BridgeEvent[] = [];
    eventBus.on('reflect.failed' as BridgeEvent['type'], (e) => events.push(e as BridgeEvent));

    mockQualityGateRun.mockResolvedValue(makeFailedResult('tests'));
    mockClaudeSend.mockReturnValue(makeTextStream('tried to fix'));

    const state = await service.trigger('/tmp/proj');
    await wait(500);

    expect(events.length).toBe(1);
    expect((events[0] as { reflectId: string }).reflectId).toBe(state.reflectId);
  });
});

// ---------------------------------------------------------------------------
// getById() / listByProject()
// ---------------------------------------------------------------------------

describe('ReflectionService — getById() / listByProject()', () => {
  let service: ReflectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQualityGateRun.mockResolvedValue(makePassedResult());
    service = new ReflectionService({ maxAttempts: 3 });
  });

  afterEach(() => service.shutdown());

  it('getById() returns state', async () => {
    const state = await service.trigger('/tmp/proj');
    expect(service.getById(state.reflectId)).toBeDefined();
  });

  it('getById() returns undefined for unknown id', () => {
    expect(service.getById('unknown')).toBeUndefined();
  });

  it('listByProject() returns sessions for that projectDir', async () => {
    await service.trigger('/tmp/proj-x');
    await service.trigger('/tmp/proj-x');
    await service.trigger('/tmp/proj-y');

    const xSessions = service.listByProject('/tmp/proj-x');
    const ySessions = service.listByProject('/tmp/proj-y');
    expect(xSessions).toHaveLength(2);
    expect(ySessions).toHaveLength(1);
  });
});

/**
 * Unit tests for GsdOrchestrationService
 *
 * Tests cover:
 * - trigger() returns pending state immediately (fire-and-forget)
 * - status transitions: pending -> running -> completed/failed
 * - getStatus() lookups (found and not found)
 * - config overrides forwarded to claudeManager
 * - listActive() filtering by projectDir and status
 * - system prompt built from buildSystemPrompt()
 * - synchronous PROJECT_CONCURRENT_LIMIT pre-check
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the module under test
// vi.hoisted() ensures variables are initialized before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockSend, mockSetConfigOverrides, mockGetOrCreate, mockBuildSystemPrompt, mockEmit } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSetConfigOverrides: vi.fn(),
  mockGetOrCreate: vi.fn(),
  mockBuildSystemPrompt: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    send: mockSend,
    setConfigOverrides: mockSetConfigOverrides,
    getOrCreate: mockGetOrCreate,
  },
}));

vi.mock('../src/gsd-adapter.ts', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

vi.mock('../src/event-bus.ts', () => ({
  eventBus: { emit: mockEmit },
}));

// Mock logger to avoid noise
vi.mock('../src/utils/logger.ts', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are set up
// ---------------------------------------------------------------------------

import { GsdOrchestrationService } from '../src/gsd-orchestration.ts';
import type { GsdTriggerRequest, GsdProgressState } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh service instance (avoids state leakage between tests). */
function makeService() {
  return new GsdOrchestrationService();
}

/** Build an async generator that yields the given chunks. */
async function* makeStream(...chunks: Array<{ type: string; text?: string; error?: string; usage?: unknown }>) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GsdOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: buildSystemPrompt resolves immediately
    mockBuildSystemPrompt.mockResolvedValue('# GSD System Prompt');
    // Default: send yields a successful stream
    mockSend.mockReturnValue(makeStream(
      { type: 'text', text: 'Working...' },
      { type: 'done', usage: { input_tokens: 10, output_tokens: 20 } },
    ));
  });

  // -------------------------------------------------------------------------
  // Test 1: trigger() returns GsdSessionState with status='pending' immediately
  // -------------------------------------------------------------------------
  it('Test 1: trigger() returns a GsdSessionState with status=pending immediately', async () => {
    const service = makeService();
    const req: GsdTriggerRequest = {
      command: 'execute-phase',
      args: { phase: 3 },
    };

    const state = await service.trigger('/home/ayaz/myproject', req);

    expect(state).toBeDefined();
    expect(state.status).toBe('pending');
    expect(state.command).toBe('execute-phase');
    expect(state.projectDir).toBe('/home/ayaz/myproject');
    expect(state.gsdSessionId).toMatch(/^gsd-/);
    expect(state.conversationId).toMatch(/^gsd-/);
    expect(state.startedAt).toBeDefined();
    expect(typeof state.startedAt).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test 2: trigger() sets status to 'running' when the CC stream starts
  // -------------------------------------------------------------------------
  it('Test 2: trigger() transitions status to running when CC stream starts', async () => {
    const service = makeService();

    // Use a stream that blocks mid-way — so we can observe 'running' status
    // before the stream completes.
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });
    let statusDuringStream: string | undefined;

    mockSend.mockImplementation(async function* () {
      // At this point status should be 'running' — capture it for assertion
      statusDuringStream = service.getStatus(state.gsdSessionId)?.status;
      // Hold the stream until test releases it
      yield { type: 'text', text: 'Hello' };
      await barrier;
      yield { type: 'done' };
    });

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/myproject', req);

    // Wait for setImmediate to fire and the first chunk to be yielded
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // Status captured inside stream should be 'running'
    expect(statusDuringStream).toBe('running');

    // Release the barrier so the test can finish cleanly
    resolveBarrier();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  // -------------------------------------------------------------------------
  // Test 3: trigger() sets status to 'completed' after stream drains successfully
  // -------------------------------------------------------------------------
  it('Test 3: trigger() sets status to completed after successful stream drain', async () => {
    const service = makeService();

    // Resolve after stream fully consumed
    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'text', text: 'All done' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/myproject', req);

    // Wait for stream to fully drain
    await streamDonePromise;
    // Allow microtasks to flush (status update after done)
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = service.getStatus(state.gsdSessionId);
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 4: trigger() sets status to 'failed' if CC stream yields error chunk
  // -------------------------------------------------------------------------
  it('Test 4: trigger() sets status to failed with error string if CC stream yields error chunk', async () => {
    const service = makeService();

    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'error', error: 'CC process crashed' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/myproject', req);

    await streamDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = service.getStatus(state.gsdSessionId);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('CC process crashed');
    expect(updated?.completedAt).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 5: getStatus(gsdSessionId) returns current state after trigger()
  // -------------------------------------------------------------------------
  it('Test 5: getStatus(gsdSessionId) returns current state after trigger()', async () => {
    const service = makeService();
    const req: GsdTriggerRequest = { command: 'execute-phase', args: { phase: 1 } };
    const state = await service.trigger('/home/ayaz/proj', req);

    const found = service.getStatus(state.gsdSessionId);
    expect(found).toBeDefined();
    expect(found?.gsdSessionId).toBe(state.gsdSessionId);
    expect(found?.command).toBe('execute-phase');
  });

  // -------------------------------------------------------------------------
  // Test 6: getStatus('nonexistent') returns undefined
  // -------------------------------------------------------------------------
  it('Test 6: getStatus("nonexistent") returns undefined', () => {
    const service = makeService();
    const result = service.getStatus('nonexistent-id');
    expect(result).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 7: trigger() with config {model:'opus'} calls claudeManager.setConfigOverrides
  // -------------------------------------------------------------------------
  it('Test 7: trigger() with config.model=opus calls setConfigOverrides({model:opus})', async () => {
    const service = makeService();
    const req: GsdTriggerRequest = {
      command: 'execute-phase',
      config: { model: 'opus' },
    };

    const state = await service.trigger('/home/ayaz/proj', req);

    expect(mockSetConfigOverrides).toHaveBeenCalledWith(
      state.conversationId,
      { model: 'opus' }
    );
  });

  // -------------------------------------------------------------------------
  // Test 8: listActive() returns only sessions with status pending|running for given projectDir
  // -------------------------------------------------------------------------
  it('Test 8: listActive() returns only pending/running sessions for given projectDir', async () => {
    const service = makeService();

    // Create sessions for two projects
    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const stateA1 = await service.trigger('/home/ayaz/projA', req);
    const stateA2 = await service.trigger('/home/ayaz/projA', req);
    const stateB = await service.trigger('/home/ayaz/projB', req);

    // All start as pending — projA should have 2 active
    const activeA = service.listActive('/home/ayaz/projA');
    expect(activeA).toHaveLength(2);
    expect(activeA.every((s) => s.projectDir === '/home/ayaz/projA')).toBe(true);
    expect(activeA.every((s) => ['pending', 'running'].includes(s.status))).toBe(true);

    // projB should have 1 active
    const activeB = service.listActive('/home/ayaz/projB');
    expect(activeB).toHaveLength(1);
    expect(activeB[0].gsdSessionId).toBe(stateB.gsdSessionId);

    // listActive() without projectDir returns all active across projects
    const allActive = service.listActive();
    expect(allActive.length).toBeGreaterThanOrEqual(3);

    // Suppress unused variable warnings
    void stateA1;
    void stateA2;
  });

  // -------------------------------------------------------------------------
  // Test 9: trigger() builds system prompt from buildSystemPrompt(command, projectDir)
  // -------------------------------------------------------------------------
  it('Test 9: trigger() builds system prompt via buildSystemPrompt(command, projectDir)', async () => {
    const service = makeService();
    const req: GsdTriggerRequest = { command: 'execute-phase', args: { phase: 2 } };

    await service.trigger('/home/ayaz/myproject', req);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'execute-phase',
      '/home/ayaz/myproject'
    );
  });

  // -------------------------------------------------------------------------
  // Test 10: trigger() throws synchronously with code='PROJECT_CONCURRENT_LIMIT'
  //          when listActive(projectDir).length >= MAX_CONCURRENT_PER_PROJECT
  // -------------------------------------------------------------------------
  it('Test 10: trigger() throws PROJECT_CONCURRENT_LIMIT synchronously when per-project quota exceeded', async () => {
    const service = makeService();

    // Fill up 5 pending sessions for the same project (max is 5)
    const req: GsdTriggerRequest = { command: 'execute-phase' };
    for (let i = 0; i < 5; i++) {
      await service.trigger('/home/ayaz/quota-proj', req);
    }

    // The 6th trigger must throw synchronously with the correct error code
    await expect(service.trigger('/home/ayaz/quota-proj', req)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as Error & { code?: string };
        return e.code === 'PROJECT_CONCURRENT_LIMIT';
      }
    );
  });

  // -------------------------------------------------------------------------
  // Additional: trigger() sends user message in correct format
  // -------------------------------------------------------------------------
  it('Bonus: trigger() sends message to claudeManager.send in correct format', async () => {
    const service = makeService();
    const req: GsdTriggerRequest = {
      command: 'execute-phase',
      args: { phase: 3 },
    };

    const state = await service.trigger('/home/ayaz/proj', req);

    // Give the fire-and-forget block a chance to start
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSend).toHaveBeenCalledWith(
      state.conversationId,
      expect.stringContaining('execute-phase'),
      '/home/ayaz/proj',
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// GSD Phase Lifecycle Events
// ---------------------------------------------------------------------------

describe('GSD Phase Lifecycle Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSystemPrompt.mockResolvedValue('# GSD System Prompt');
    mockSend.mockReturnValue(makeStream(
      { type: 'text', text: 'Working...' },
      { type: 'done', usage: { input_tokens: 10, output_tokens: 20 } },
    ));
  });

  // -------------------------------------------------------------------------
  // Test A: trigger() emits gsd.phase_started when transitioning to running
  // -------------------------------------------------------------------------
  it('Test A: trigger() emits gsd.phase_started with correct fields when session starts running', async () => {
    const service = makeService();

    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'text', text: 'Working...' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/proj', req);

    await streamDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Check that gsd.phase_started was emitted
    const startedCall = mockEmit.mock.calls.find(([event]) => event === 'gsd.phase_started');
    expect(startedCall).toBeDefined();
    const [, payload] = startedCall!;
    expect(payload.type).toBe('gsd.phase_started');
    expect(payload.gsdSessionId).toBe(state.gsdSessionId);
    expect(payload.projectDir).toBe('/home/ayaz/proj');
    expect(payload.command).toBe('execute-phase');
    expect(typeof payload.timestamp).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test B: trigger() emits gsd.phase_completed on successful stream
  // -------------------------------------------------------------------------
  it('Test B: trigger() emits gsd.phase_completed with correct fields on successful stream', async () => {
    const service = makeService();

    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'text', text: 'Done' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/proj', req);

    await streamDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const completedCall = mockEmit.mock.calls.find(([event]) => event === 'gsd.phase_completed');
    expect(completedCall).toBeDefined();
    const [, payload] = completedCall!;
    expect(payload.type).toBe('gsd.phase_completed');
    expect(payload.gsdSessionId).toBe(state.gsdSessionId);
    expect(payload.projectDir).toBe('/home/ayaz/proj');
    expect(payload.command).toBe('execute-phase');
    expect(payload.planNumber).toBe(0);
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(payload.commitHash).toBe('');
    expect(typeof payload.timestamp).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test C: trigger() emits gsd.phase_error when stream yields error chunk
  // -------------------------------------------------------------------------
  it('Test C: trigger() emits gsd.phase_error when CC stream yields error chunk', async () => {
    const service = makeService();

    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'error', error: 'CC process crashed' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/proj', req);

    await streamDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const errorCall = mockEmit.mock.calls.find(([event]) => event === 'gsd.phase_error');
    expect(errorCall).toBeDefined();
    const [, payload] = errorCall!;
    expect(payload.type).toBe('gsd.phase_error');
    expect(payload.gsdSessionId).toBe(state.gsdSessionId);
    expect(payload.projectDir).toBe('/home/ayaz/proj');
    expect(payload.command).toBe('execute-phase');
    expect(payload.error).toBe('CC process crashed');
    expect(typeof payload.timestamp).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test D: trigger() emits gsd.phase_error when claudeManager.send() throws
  // -------------------------------------------------------------------------
  it('Test D: trigger() emits gsd.phase_error when claudeManager.send() throws an exception', async () => {
    const service = makeService();

    let throwDone!: () => void;
    const throwDonePromise = new Promise<void>((resolve) => { throwDone = resolve; });

    mockSend.mockImplementation(async function* () {
      throwDone();
      throw new Error('spawn failed');
    });

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/proj', req);

    await throwDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const errorCall = mockEmit.mock.calls.find(([event]) => event === 'gsd.phase_error');
    expect(errorCall).toBeDefined();
    const [, payload] = errorCall!;
    expect(payload.type).toBe('gsd.phase_error');
    expect(payload.gsdSessionId).toBe(state.gsdSessionId);
    expect(payload.error).toBe('spawn failed');
  });

  // -------------------------------------------------------------------------
  // Test E: getProgress() returns GsdProgressState with correct fields
  // -------------------------------------------------------------------------
  it('Test E: getProgress() returns GsdProgressState with correct fields after trigger()', async () => {
    const service = makeService();

    let streamDone!: () => void;
    const streamDonePromise = new Promise<void>((resolve) => { streamDone = resolve; });

    mockSend.mockReturnValue((async function* () {
      yield { type: 'text', text: 'Done' };
      yield { type: 'done' };
      streamDone();
    })());

    const req: GsdTriggerRequest = { command: 'execute-phase' };
    const state = await service.trigger('/home/ayaz/proj', req);

    await streamDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const progress: GsdProgressState | undefined = service.getProgress(state.gsdSessionId);
    expect(progress).toBeDefined();
    expect(progress!.gsdSessionId).toBe(state.gsdSessionId);
    expect(progress!.projectDir).toBe('/home/ayaz/proj');
    expect(progress!.command).toBe('execute-phase');
    expect(progress!.phaseNumber).toBe(0);
    expect(progress!.plansCompleted).toBe(0);
    expect(progress!.plansTotal).toBe(0);
    expect(progress!.status).toBe('completed');
    expect(progress!.completionPercent).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Test F: getProgress() returns undefined for unknown gsdSessionId
  // -------------------------------------------------------------------------
  it('Test F: getProgress() returns undefined for unknown gsdSessionId', () => {
    const service = makeService();
    const result = service.getProgress('unknown-id');
    expect(result).toBeUndefined();
  });
});

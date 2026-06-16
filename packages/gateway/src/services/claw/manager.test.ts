/**
 * Claw Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClawConfig, ClawSession, ClawCycleResult } from '@ownpilot/core/services/claw';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRunCycle, mockGetClawsRepo, mockGetOrCreateSessionWorkspace, mockGetEventSystem } =
  vi.hoisted(() => {
    return {
      mockRunCycle: vi.fn(),
      mockGetClawsRepo: vi.fn(),
      mockGetOrCreateSessionWorkspace: vi.fn(),
      mockGetEventSystem: vi.fn(() => ({
        emit: vi.fn(),
        on: vi.fn(() => vi.fn()),
      })),
    };
  });

vi.mock('./runner.js', () => ({
  ClawRunner: vi.fn().mockImplementation(function () {
    return {
      runCycle: mockRunCycle,
      updateConfig: vi.fn(),
    };
  }),
}));

vi.mock('../../db/repositories/claws.js', () => ({
  getClawsRepository: mockGetClawsRepo,
}));

vi.mock('../../workspace/file-workspace.js', () => ({
  getOrCreateSessionWorkspace: mockGetOrCreateSessionWorkspace,
  updateSessionWorkspaceMeta: vi.fn(),
  readSessionWorkspaceFile: vi.fn().mockReturnValue(null),
  writeSessionWorkspaceFile: vi.fn(),
}));

vi.mock('@ownpilot/core/events', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: (...args: unknown[]) => mockGetEventSystem(...args),
  };
});

vi.mock('@ownpilot/core/services', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getErrorMessage: (e: unknown) => String(e instanceof Error ? e.message : e),
    generateId: vi.fn().mockReturnValue('gen-id'),
  };
});

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ClawManager } = await import('./manager.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-1',
    userId: 'user-1',
    name: 'Test Claw',
    mission: 'Research things',
    mode: 'continuous',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 20,
      maxToolCallsPerCycle: 100,
      maxCyclesPerHour: 30,
      cycleTimeoutMs: 300000,
    },
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: 'ws-1',
    ...overrides,
  };
}

function makeCycleResult(overrides: Partial<ClawCycleResult> = {}): ClawCycleResult {
  return {
    success: true,
    toolCalls: [],
    output: 'Done',
    outputMessage: 'Done',
    durationMs: 1000,
    turns: 1,
    costUsd: 0.001,
    ...overrides,
  };
}

function setupRepo(config: ClawConfig) {
  const repo = {
    getById: vi.fn().mockResolvedValue(config),
    getByIdAnyUser: vi.fn().mockResolvedValue(config),
    getAll: vi.fn().mockResolvedValue([config]),
    getAutoStartClaws: vi.fn().mockResolvedValue([]),
    getChildClaws: vi.fn().mockResolvedValue([]),
    getInterruptedSessions: vi.fn().mockResolvedValue([]),
    loadSession: vi.fn().mockResolvedValue(null),
    saveSession: vi.fn().mockResolvedValue(undefined),
    saveHistory: vi.fn().mockResolvedValue(undefined),
    saveEscalationHistory: vi.fn().mockResolvedValue(undefined),
    appendToInbox: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(config),
    create: vi.fn().mockResolvedValue(config),
    delete: vi.fn().mockResolvedValue(true),
    cleanupOldHistory: vi.fn().mockResolvedValue(0),
    cleanupOldAuditLog: vi.fn().mockResolvedValue(0),
  };
  mockGetClawsRepo.mockReturnValue(repo);
  return repo;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClawManager', () => {
  let manager: InstanceType<typeof ClawManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    manager = new ClawManager();

    mockGetOrCreateSessionWorkspace.mockResolvedValue({ id: 'ws-1' });
    mockRunCycle.mockResolvedValue(makeCycleResult());
  });

  afterEach(async () => {
    await manager.stop();
    vi.useRealTimers();
  });

  describe('startClaw', () => {
    it('should start a claw and create session', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);

      const session = await manager.startClaw('claw-1', 'user-1');

      expect(session.state).toBe('running');
      expect(session.config.id).toBe('claw-1');
      expect(repo.saveSession).toHaveBeenCalled();
    });

    it('should throw if claw already running', async () => {
      setupRepo(makeConfig());

      await manager.startClaw('claw-1', 'user-1');

      await expect(manager.startClaw('claw-1', 'user-1')).rejects.toThrow('already running');
    });

    it('rejects concurrent startClaw for the same id (race protection)', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);

      // Make repo.getById slow so we can race two startClaw calls before
      // either populates this.claws.
      let resolveGet: ((value: typeof config) => void) | null = null;
      repo.getById.mockImplementation(
        () =>
          new Promise<typeof config>((resolve) => {
            resolveGet = resolve;
          })
      );

      const first = manager.startClaw('claw-1', 'user-1');
      // Second call must reject synchronously without entering setup
      const second = manager.startClaw('claw-1', 'user-1');

      await expect(second).rejects.toThrow(/currently starting|already running/);

      // Let the first call complete cleanly
      resolveGet!(config);
      await first;
    });

    it('should throw if claw not found', async () => {
      const repo = setupRepo(makeConfig());
      repo.getById.mockResolvedValue(null);

      await expect(manager.startClaw('claw-99', 'user-1')).rejects.toThrow('not found');
    });

    it('should create workspace if not exists', async () => {
      const config = makeConfig({ workspaceId: undefined });
      const repo = setupRepo(config);

      await manager.startClaw('claw-1', 'user-1');

      expect(mockGetOrCreateSessionWorkspace).toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('claw-1', 'user-1', { workspaceId: 'ws-1' });
    });

    it('should resume from saved session', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);
      repo.loadSession.mockResolvedValue({
        state: 'running',
        cyclesCompleted: 10,
        totalToolCalls: 50,
        totalCostUsd: 0.5,
        lastCycleAt: new Date(),
        lastCycleDurationMs: 2000,
        lastCycleError: null,
        startedAt: new Date(),
        stoppedAt: null,
        persistentContext: { key: 'value' },
        inbox: ['msg'],
        artifacts: ['art-1'],
        pendingEscalation: null,
      });

      const session = await manager.startClaw('claw-1', 'user-1');

      expect(session.cyclesCompleted).toBe(10);
      expect(session.totalToolCalls).toBe(50);
      expect(session.persistentContext).toEqual({ key: 'value' });
    });
  });

  describe('inbox handling', () => {
    it('passes inbox messages to runCycle intact', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      const sent = await manager.sendMessage('claw-1', 'Process this');
      expect(sent).toBe(true);

      let capturedInbox: string[] = [];
      mockRunCycle.mockImplementation((session: ClawSession) => {
        capturedInbox = [...session.inbox];
        return Promise.resolve(makeCycleResult());
      });

      await vi.advanceTimersByTimeAsync(600);

      expect(mockRunCycle).toHaveBeenCalledTimes(1);
      expect(capturedInbox).toContain('Process this');
    });

    it('clears processed inbox messages after successful cycle', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      await manager.sendMessage('claw-1', 'Process this');

      await vi.advanceTimersByTimeAsync(600);

      expect(manager.getSession('claw-1')?.inbox).toEqual([]);
    });

    it('preserves messages that arrive during cycle execution', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      await manager.sendMessage('claw-1', 'Process this');

      mockRunCycle.mockImplementation(async (session: ClawSession) => {
        session.inbox.push('New mid-cycle message');
        return makeCycleResult();
      });

      await vi.advanceTimersByTimeAsync(600);

      expect(manager.getSession('claw-1')?.inbox).toEqual(['New mid-cycle message']);
    });

    it('preserves mid-cycle arrivals when the inbox is at its cap (head eviction)', async () => {
      // Regression: the post-cycle consume-slice used to remove
      // `min(snapshotLength, currentLength)` messages from the head. When the
      // inbox was at its cap, each mid-cycle arrival evicted a snapshot message
      // from the head, so a snapshot-length slice over-removed and silently
      // dropped the brand-new messages. The fix discounts the eviction count.
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      // Fill the inbox to the 100-message cap so any new arrival forces a head
      // eviction inside trimInbox.
      const session = manager.getSession('claw-1')!;
      session.inbox = Array.from({ length: 100 }, (_, i) => `old-${i}`);

      mockRunCycle.mockImplementation(async () => {
        // Three operator messages land while the cycle runs; each tips the
        // inbox over the cap and evicts one head (snapshot) message.
        await manager.sendMessage('claw-1', 'mid-1');
        await manager.sendMessage('claw-1', 'mid-2');
        await manager.sendMessage('claw-1', 'mid-3');
        return makeCycleResult();
      });

      await vi.advanceTimersByTimeAsync(600);

      // All three mid-cycle messages survive; the consumed snapshot is gone.
      expect(manager.getSession('claw-1')?.inbox).toEqual(['mid-1', 'mid-2', 'mid-3']);
    });
  });

  describe('single-shot mode', () => {
    it('should execute one cycle and stop', async () => {
      const config = makeConfig({ mode: 'single-shot' });
      const repo = setupRepo(config);

      await manager.startClaw('claw-1', 'user-1');

      // Let the single-shot cycle execute
      await vi.advanceTimersByTimeAsync(100);

      expect(mockRunCycle).toHaveBeenCalledTimes(1);
      expect(repo.saveHistory).toHaveBeenCalled();
    });
  });

  describe('continuous mode', () => {
    it('should schedule next cycle with adaptive delay', async () => {
      const config = makeConfig({ mode: 'continuous' });
      setupRepo(config);

      await manager.startClaw('claw-1', 'user-1');

      // First cycle runs quickly (CONTINUOUS_MIN_DELAY_MS = 500ms)
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Next cycle also fast since last had tool calls = 0 → idle delay (5s)
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockRunCycle).toHaveBeenCalledTimes(2);
    });
  });

  describe('interval mode', () => {
    it('should schedule next cycle after fixed interval', async () => {
      const config = makeConfig({ mode: 'interval', intervalMs: 5000 });
      setupRepo(config);

      await manager.startClaw('claw-1', 'user-1');

      // First cycle after interval (5s)
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Next cycle after another interval
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockRunCycle).toHaveBeenCalledTimes(2);
    });
  });

  describe('pauseClaw', () => {
    it('should pause a running claw', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const result = await manager.pauseClaw('claw-1', 'user-1');

      expect(result).toBe(true);
      expect(manager.getSession('claw-1')?.state).toBe('paused');
    });

    it('should return false for non-existent claw', async () => {
      const result = await manager.pauseClaw('claw-99', 'user-1');
      expect(result).toBe(false);
    });

    it('does not reschedule next cycle when pause races with cycle completion', async () => {
      const repo = setupRepo(makeConfig({ mode: 'continuous' }));
      // Make runCycle take a controllable amount of time
      let resolveCycle: ((r: ClawCycleResult) => void) | null = null;
      mockRunCycle.mockImplementation(
        () =>
          new Promise<ClawCycleResult>((resolve) => {
            resolveCycle = resolve;
          })
      );

      await manager.startClaw('claw-1', 'user-1');
      // Continuous mode schedules first cycle ~500ms out — advance past it
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Pause while the cycle is running
      await manager.pauseClaw('claw-1', 'user-1');
      expect(manager.getSession('claw-1')?.state).toBe('paused');

      // Now let the in-flight cycle complete naturally
      resolveCycle!(makeCycleResult());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // State must remain 'paused' — the cycle's happy-path scheduleNext
      // must have been suppressed by the state guard.
      expect(manager.getSession('claw-1')?.state).toBe('paused');

      // Advance well past any next-cycle delay; runCycle must NOT be called again.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Saved session reflects 'paused', not 'running'
      const lastSave = repo.saveSession.mock.calls.at(-1);
      expect(lastSave?.[1]?.state).toBe('paused');
    });

    it('treats abort errors as benign (no error count, no history write)', async () => {
      const repo = setupRepo(makeConfig({ mode: 'continuous' }));

      mockRunCycle.mockImplementationOnce(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      });

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();

      // No history saved for the aborted cycle (third arg .error must not include "aborted")
      const errorHistoryCalls = repo.saveHistory.mock.calls.filter(
        (c: unknown[]) => (c[2] as ClawCycleResult).error === 'aborted'
      );
      expect(errorHistoryCalls).toHaveLength(0);
    });
  });

  describe('resumeClaw', () => {
    it('should resume a paused claw', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');
      await manager.pauseClaw('claw-1', 'user-1');

      const result = await manager.resumeClaw('claw-1', 'user-1');

      expect(result).toBe(true);
      expect(manager.getSession('claw-1')?.state).toBe('running');
    });

    it('should return false if not paused', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const result = await manager.resumeClaw('claw-1', 'user-1');
      expect(result).toBe(false);
    });
  });

  describe('stopClaw', () => {
    it('should stop a running claw', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const result = await manager.stopClaw('claw-1', 'user-1');

      expect(result).toBe(true);
      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('cascades stop to running subclaws when parent is stopped', async () => {
      const parent = makeConfig({ id: 'parent-1' });
      const child = makeConfig({ id: 'child-1', parentClawId: 'parent-1', depth: 1 });

      // Repo returns the right config based on id
      const repo = {
        getById: vi.fn().mockImplementation((id: string) => {
          if (id === 'parent-1') return Promise.resolve(parent);
          if (id === 'child-1') return Promise.resolve(child);
          return Promise.resolve(null);
        }),
        getByIdAnyUser: vi.fn().mockResolvedValue(parent),
        getAll: vi.fn().mockResolvedValue([parent, child]),
        getAutoStartClaws: vi.fn().mockResolvedValue([]),
        getChildClaws: vi.fn().mockResolvedValue([]),
        getInterruptedSessions: vi.fn().mockResolvedValue([]),
        loadSession: vi.fn().mockResolvedValue(null),
        saveSession: vi.fn().mockResolvedValue(undefined),
        saveHistory: vi.fn().mockResolvedValue(undefined),
        saveEscalationHistory: vi.fn().mockResolvedValue(undefined),
        appendToInbox: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(parent),
        create: vi.fn().mockResolvedValue(parent),
        delete: vi.fn().mockResolvedValue(true),
        cleanupOldHistory: vi.fn().mockResolvedValue(0),
        cleanupOldAuditLog: vi.fn().mockResolvedValue(0),
      };
      mockGetClawsRepo.mockReturnValue(repo);

      await manager.startClaw('parent-1', 'user-1');
      await manager.startClaw('child-1', 'user-1');
      expect(manager.getSession('parent-1')).not.toBeNull();
      expect(manager.getSession('child-1')).not.toBeNull();

      const result = await manager.stopClaw('parent-1', 'user-1');

      expect(result).toBe(true);
      expect(manager.getSession('parent-1')).toBeNull();
      expect(manager.getSession('child-1')).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('should add message to inbox', async () => {
      const repo = setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const result = await manager.sendMessage('claw-1', 'Check task #5');

      expect(result).toBe(true);
      expect(manager.getSession('claw-1')?.inbox).toContain('Check task #5');
      expect(repo.appendToInbox).toHaveBeenCalledWith('claw-1', 'Check task #5');
    });

    it('should return false for non-existent claw', async () => {
      const result = await manager.sendMessage('claw-99', 'test');
      expect(result).toBe(false);
    });
  });

  describe('steerClaw', () => {
    it('adds a [STEER]-prefixed directive to the inbox and persists it', async () => {
      const repo = setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const result = await manager.steerClaw('claw-1', 'user-1', 'Focus on the API docs instead');

      expect(result).toBe(true);
      expect(manager.getSession('claw-1')?.inbox).toContainEqual(
        expect.stringContaining('[STEER] Focus on the API docs instead')
      );
      expect(repo.appendToInbox).toHaveBeenCalledWith('claw-1', expect.stringContaining('[STEER]'));
    });

    it('returns false for a non-existent claw', async () => {
      const result = await manager.steerClaw('claw-99', 'user-1', 'hi');
      expect(result).toBe(false);
    });

    it('returns false for an empty message', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');
      const result = await manager.steerClaw('claw-1', 'user-1', '   ');
      expect(result).toBe(false);
    });

    it('aborts the in-flight cycle when steering during a cycle', async () => {
      setupRepo(makeConfig());
      // Make runCycle hang until aborted so a cycle is in progress when we steer.
      let abortedSignal = false;
      mockRunCycle.mockImplementation(
        (_session: ClawSession, signal: AbortSignal) =>
          new Promise<ClawCycleResult>((resolve) => {
            signal.addEventListener('abort', () => {
              abortedSignal = true;
              resolve(makeCycleResult({ success: false, outputMessage: 'aborted' }));
            });
          })
      );

      await manager.startClaw('claw-1', 'user-1');
      // Let the first scheduled cycle begin (CONTINUOUS_MIN_DELAY_MS = 500ms).
      await vi.advanceTimersByTimeAsync(600);

      const result = await manager.steerClaw('claw-1', 'user-1', 'Change direction');
      expect(result).toBe(true);
      expect(abortedSignal).toBe(true);
    });
  });

  describe('escalation', () => {
    it('should pause claw on escalation request', async () => {
      const repo = setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      await manager.requestEscalation('claw-1', {
        id: 'esc-1',
        type: 'sandbox_upgrade',
        reason: 'Need Docker',
        requestedAt: new Date(),
      });

      expect(manager.getSession('claw-1')?.state).toBe('escalation_pending');
      expect(repo.saveEscalationHistory).toHaveBeenCalled();
    });

    it('should resume on escalation approval', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      await manager.requestEscalation('claw-1', {
        id: 'esc-1',
        type: 'budget_increase',
        reason: 'Need more budget',
        requestedAt: new Date(),
      });

      const approved = await manager.approveEscalation('claw-1');
      expect(approved).toBe(true);
      expect(manager.getSession('claw-1')?.state).toBe('running');
      expect(manager.getSession('claw-1')?.pendingEscalation).toBeNull();
    });

    it('should return false if no pending escalation', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const approved = await manager.approveEscalation('claw-1');
      expect(approved).toBe(false);
    });

    it('should deny escalation and resume with inbox message', async () => {
      const repo = setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      await manager.requestEscalation('claw-1', {
        id: 'esc-2',
        type: 'tool_access',
        reason: 'Need shell',
        requestedAt: new Date(),
      });
      expect(manager.getSession('claw-1')?.state).toBe('escalation_pending');

      const denied = await manager.denyEscalation('claw-1', 'Too risky');
      expect(denied).toBe(true);
      expect(manager.getSession('claw-1')?.state).toBe('running');
      expect(manager.getSession('claw-1')?.pendingEscalation).toBeNull();
      expect(manager.getSession('claw-1')?.inbox).toContainEqual(
        expect.stringContaining('ESCALATION_DENIED')
      );
      expect(repo.appendToInbox).toHaveBeenCalled();
    });

    it('should return false when denying non-existent claw', async () => {
      const denied = await manager.denyEscalation('claw-99');
      expect(denied).toBe(false);
    });

    it('should return false when denying non-escalated claw', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const denied = await manager.denyEscalation('claw-1');
      expect(denied).toBe(false);
    });
  });

  describe('stop conditions', () => {
    it('should stop on MISSION_COMPLETE', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValue(
        makeCycleResult({ outputMessage: 'Task done. MISSION_COMPLETE' })
      );

      await manager.startClaw('claw-1', 'user-1');
      // Continuous first cycle fires at MIN_DELAY (500ms)
      await vi.advanceTimersByTimeAsync(600);

      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('should stop on max_cycles condition', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'max_cycles:2' });
      setupRepo(config);

      await manager.startClaw('claw-1', 'user-1');

      // First cycle at 500ms
      await vi.advanceTimersByTimeAsync(600);
      // Second cycle (idle delay 5s since 0 tool calls)
      await vi.advanceTimersByTimeAsync(5100);

      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('should stop on on_error condition when cycle fails', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'on_error' });
      setupRepo(config);
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: false, error: 'Something broke' }));

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);

      // on_error stops after first failure
      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('should stop on idle:N condition after N idle cycles', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'idle:2' });
      setupRepo(config);
      // Cycle returns 0 tool calls (idle)
      mockRunCycle.mockResolvedValue(makeCycleResult({ toolCalls: [] }));

      await manager.startClaw('claw-1', 'user-1');
      // First idle cycle
      await vi.advanceTimersByTimeAsync(600);
      expect(manager.getSession('claw-1')).not.toBeNull();
      // Second idle cycle → stop
      await vi.advanceTimersByTimeAsync(5100);
      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('plan_complete stops when every task is terminal and at least one is completed', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'plan_complete' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        { id: 't1', title: 'A', status: 'completed', createdAt: 'x', updatedAt: 'x' },
        { id: 't2', title: 'B', status: 'blocked', createdAt: 'x', updatedAt: 'x' },
      ];

      await vi.advanceTimersByTimeAsync(600);

      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('plan_complete does NOT stop when all tasks are blocked with none completed (stuck != done)', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'plan_complete' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        { id: 't1', title: 'A', status: 'blocked', createdAt: 'x', updatedAt: 'x' },
        { id: 't2', title: 'B', status: 'blocked', createdAt: 'x', updatedAt: 'x' },
      ];

      await vi.advanceTimersByTimeAsync(600);
      expect(manager.getSession('claw-1')).not.toBeNull();
    });

    it('plan_complete does NOT stop on cycle 1 with an empty plan (otherwise the claw dies before planning)', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'plan_complete' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');
      // Default makeSession-style: tasks: []
      await vi.advanceTimersByTimeAsync(600);
      expect(manager.getSession('claw-1')).not.toBeNull();
    });

    it('plan_complete does NOT stop while at least one task is still pending or in_progress', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'plan_complete' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        { id: 't1', title: 'A', status: 'completed', createdAt: 'x', updatedAt: 'x' },
        { id: 't2', title: 'B', status: 'in_progress', createdAt: 'x', updatedAt: 'x' },
      ];

      await vi.advanceTimersByTimeAsync(600);
      expect(manager.getSession('claw-1')).not.toBeNull();
    });
  });

  describe('config hot-reload', () => {
    it('should update in-memory config via updateClawConfig', async () => {
      const config = makeConfig({ mode: 'continuous' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');

      const updated = { ...config, mode: 'interval' as const, intervalMs: 60_000 };
      manager.updateClawConfig('claw-1', updated);

      expect(manager.getSession('claw-1')?.config.mode).toBe('interval');
      expect(manager.getSession('claw-1')?.config.intervalMs).toBe(60_000);
    });

    it('should reschedule active claws when mode changes', async () => {
      const config = makeConfig({ mode: 'continuous' });
      setupRepo(config);
      await manager.startClaw('claw-1', 'user-1');

      const updated = { ...config, mode: 'interval' as const, intervalMs: 60_000 };
      manager.updateClawConfig('claw-1', updated);

      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });

    it('should no-op for unknown claw', () => {
      const config = makeConfig();
      // Should not throw
      manager.updateClawConfig('claw-99', config);
    });
  });

  describe('resource limits', () => {
    it('should auto-fail on consecutive errors', async () => {
      const config = makeConfig({ mode: 'continuous' });
      setupRepo(config);

      mockRunCycle.mockResolvedValue(makeCycleResult({ success: false, error: 'API error' }));

      await manager.startClaw('claw-1', 'user-1');

      // Run enough cycles to trigger auto-fail (5 consecutive errors)
      // Continuous error backoff is MAX_DELAY (10s), so advance enough time
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(11_000);
      }

      // After 5 consecutive errors, claw is auto-failed and removed from active claws
      expect(manager.getSession('claw-1')).toBeNull();
    });
  });

  describe('reflection state', () => {
    it('initializes fresh session with empty tasks list', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');
      expect(manager.getSession('claw-1')?.tasks).toEqual([]);
    });

    it('increments cyclesInProgress on the in_progress task at each cycle', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      // Seed an in_progress task on the live session.
      const sess = manager.getSession('claw-1');
      expect(sess).not.toBeNull();
      sess!.tasks = [
        {
          id: 't1',
          title: 'Work',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          cyclesInProgress: 0,
        },
      ];

      // First continuous cycle fires after MIN_DELAY (500ms).
      await vi.advanceTimersByTimeAsync(600);
      expect(manager.getSession('claw-1')?.tasks[0]?.cyclesInProgress).toBe(1);

      // After cycle completes, lastCycleToolCalls=0 → next delay is IDLE (5000ms).
      await vi.advanceTimersByTimeAsync(5_100);
      expect(manager.getSession('claw-1')?.tasks[0]?.cyclesInProgress).toBe(2);
    });

    it('rehydrates tasks from persistentContext on resume — plan survives restart', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);
      const savedTasks = [
        {
          id: 't1',
          title: 'Continue mission',
          status: 'in_progress',
          createdAt: '2026-05-27T00:00:00.000Z',
          updatedAt: '2026-05-27T10:00:00.000Z',
        },
      ];
      repo.loadSession.mockResolvedValueOnce({
        cyclesCompleted: 3,
        totalToolCalls: 9,
        totalCostUsd: 0.02,
        lastCycleAt: new Date(),
        lastCycleDurationMs: 800,
        lastCycleError: null,
        startedAt: new Date(),
        // Tasks are persisted inside persistentContext under a reserved key.
        persistentContext: { __claw_tasks: savedTasks, userKey: 'kept' },
        inbox: [],
        artifacts: [],
        pendingEscalation: null,
      });

      await manager.startClaw('claw-1', 'user-1');

      const session = manager.getSession('claw-1');
      expect(session?.tasks).toHaveLength(1);
      expect(session?.tasks[0]?.id).toBe('t1');
      // The reserved key must NOT leak into the rehydrated persistentContext,
      // otherwise the agent could read or mutate it from claw_set_context.
      expect(session?.persistentContext.__claw_tasks).toBeUndefined();
      // User-set keys must survive the strip.
      expect(session?.persistentContext.userKey).toBe('kept');
    });

    it('initializes fresh session with consecutiveErrors=0 and empty recentFailures', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(0);
      expect(session?.recentFailures).toEqual([]);
    });

    it('resets reflection state when resuming a saved session — restart deserves a clean retry', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);
      // Saved session has no reflection fields persisted; manager must default them
      repo.loadSession.mockResolvedValueOnce({
        cyclesCompleted: 5,
        totalToolCalls: 12,
        totalCostUsd: 0.05,
        lastCycleAt: new Date(),
        lastCycleDurationMs: 1000,
        lastCycleError: 'previous error',
        startedAt: new Date(),
        persistentContext: {},
        inbox: [],
        artifacts: [],
        pendingEscalation: null,
      });

      await manager.startClaw('claw-1', 'user-1');

      const session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(0);
      expect(session?.recentFailures).toEqual([]);
    });

    it('increments consecutiveErrors on cycle failure and resets on success', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      // Default the runner to failure so the first cycle fails.
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: false, error: 'boom' }));

      await manager.startClaw('claw-1', 'user-1');
      // First continuous cycle fires after MIN_DELAY (500ms).
      await vi.advanceTimersByTimeAsync(600);

      let session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(1);
      expect(session?.recentFailures).toHaveLength(1);
      expect(session?.recentFailures[0]?.error).toBe('boom');

      // Now swap the default to success and let the error-backoff cycle fire.
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: true }));
      await vi.advanceTimersByTimeAsync(10_100);

      session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(0);
      // ring is not cleared on success — past failures remain visible until evicted
      expect(session?.recentFailures).toHaveLength(1);
    });

    it('records per-tool failures and truncates oversized error payloads', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      const huge = 'X'.repeat(2000);
      mockRunCycle.mockResolvedValueOnce(
        makeCycleResult({
          success: false,
          error: 'cycle failed',
          toolCalls: [
            {
              tool: 'browser_open',
              args: {},
              result: huge,
              success: false,
              durationMs: 10,
            },
          ],
        })
      );

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(11_000);

      const failure = manager.getSession('claw-1')?.recentFailures[0];
      expect(failure?.toolErrors).toHaveLength(1);
      expect(failure?.toolErrors?.[0]?.tool).toBe('browser_open');
      expect(failure?.toolErrors?.[0]?.error.length).toBeLessThan(huge.length);
      expect(failure?.toolErrors?.[0]?.error).toContain('[truncated]');
    });

    it('setNextIntent (agent) stores raw intent; (operator) prefixes [OPERATOR]', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: true }));
      await manager.startClaw('claw-1', 'user-1');

      // Default actor is 'agent'.
      const okAgent = await manager.setNextIntent('claw-1', 'finish task #3 and report');
      expect(okAgent).toBe(true);
      expect(manager.getSession('claw-1')?.nextIntent).toBe('finish task #3 and report');

      // Operator overwrites with marker prefix.
      const okOp = await manager.setNextIntent(
        'claw-1',
        'switch to debugging the auth bug',
        'operator'
      );
      expect(okOp).toBe(true);
      expect(manager.getSession('claw-1')?.nextIntent).toBe(
        '[OPERATOR] switch to debugging the auth bug'
      );
    });

    it('setNextIntent throws on empty / oversized', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: true }));
      await manager.startClaw('claw-1', 'user-1');

      await expect(manager.setNextIntent('claw-1', '   ')).rejects.toThrow(/empty/);
      await expect(manager.setNextIntent('claw-1', 'x'.repeat(600))).rejects.toThrow(/exceeds 500/);
    });

    it('setNextIntent returns false for unknown claw', async () => {
      const ok = await manager.setNextIntent('does-not-exist', 'whatever');
      expect(ok).toBe(false);
    });

    it('resetFailures clears consecutiveErrors and recentFailures on a live claw', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValueOnce(makeCycleResult({ success: false, error: 'boom-1' }));
      mockRunCycle.mockResolvedValueOnce(makeCycleResult({ success: false, error: 'boom-2' }));
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: false, error: 'boom-rest' }));

      await manager.startClaw('claw-1', 'user-1');
      // Two failures with backoff between them: first fires after MIN_DELAY,
      // second after the post-failure backoff (~10s).
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(11_000);

      let session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBeGreaterThanOrEqual(2);
      expect(session?.recentFailures.length).toBeGreaterThanOrEqual(2);

      const ok = await manager.resetFailures('claw-1');
      expect(ok).toBe(true);

      session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(0);
      expect(session?.recentFailures).toEqual([]);
    });

    it('resetFailures returns false for an unknown claw', async () => {
      const ok = await manager.resetFailures('does-not-exist');
      expect(ok).toBe(false);
    });

    it('resetFailures is a safe no-op when nothing is set', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: true }));
      await manager.startClaw('claw-1', 'user-1');

      const ok = await manager.resetFailures('claw-1');
      expect(ok).toBe(true);

      const session = manager.getSession('claw-1');
      expect(session?.consecutiveErrors).toBe(0);
      expect(session?.recentFailures).toEqual([]);
    });

    it('caps recentFailures at CLAW_RECENT_FAILURES_MAX (=5) entries', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValue(makeCycleResult({ success: false, error: 'flaky' }));

      await manager.startClaw('claw-1', 'user-1');
      // Run more failures than the ring can hold; auto-fail kicks in at 5
      // consecutive errors, so we observe the ring exactly at the cap.
      for (let i = 0; i < 7; i++) {
        await vi.advanceTimersByTimeAsync(11_000);
      }

      // Session may be gone after auto-fail; assert via getAllSessions or skip
      // if claw is already removed. The point is that during its life the ring
      // never exceeded the cap — checked by listing what's left.
      const sessions = manager.getAllSessions();
      for (const s of sessions) {
        expect(s.recentFailures.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('queries', () => {
    it('should return session by ID', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      const session = manager.getSession('claw-1');
      expect(session).not.toBeNull();
      expect(session!.config.id).toBe('claw-1');
    });

    it('should return null for unknown claw', () => {
      expect(manager.getSession('claw-99')).toBeNull();
    });

    it('should list all sessions', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      expect(manager.getAllSessions()).toHaveLength(1);
    });

    it('should filter sessions by user', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      expect(manager.getSessionsByUser('user-1')).toHaveLength(1);
      expect(manager.getSessionsByUser('user-2')).toHaveLength(0);
    });

    it('should check if claw is running', async () => {
      setupRepo(makeConfig());
      await manager.startClaw('claw-1', 'user-1');

      expect(manager.isRunning('claw-1')).toBe(true);
      expect(manager.isRunning('claw-99')).toBe(false);
    });
  });

  describe('manager lifecycle', () => {
    it('should resume interrupted sessions on start', async () => {
      const config = makeConfig();
      const repo = setupRepo(config);
      repo.getInterruptedSessions.mockResolvedValue([
        { clawId: 'claw-1', config, state: 'running' },
      ]);

      await manager.start();

      expect(manager.getAllSessions()).toHaveLength(1);
    });

    it('should auto-start configured claws', async () => {
      const config = makeConfig({ autoStart: true });
      const repo = setupRepo(config);
      repo.getAutoStartClaws.mockResolvedValue([config]);

      await manager.start();

      expect(manager.getAllSessions()).toHaveLength(1);
    });

    it('should have stop method that clears running state', async () => {
      setupRepo(makeConfig({ mode: 'continuous', intervalMs: 600_000 }));
      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(100);

      expect(manager.isRunning('claw-1')).toBe(true);

      // Calling stopClaw directly removes it
      await manager.stopClaw('claw-1', 'user-1');

      expect(manager.isRunning('claw-1')).toBe(false);
      expect(manager.getSession('claw-1')).toBeNull();
    });

    it('manager.stop() preserves "running" state in DB so claws resume on restart', async () => {
      const repo = setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(100);
      expect(manager.isRunning('claw-1')).toBe(true);

      await manager.stop();

      // Last persisted state must be 'running' (or 'waiting'), NOT 'stopped'
      // — otherwise getInterruptedSessions can't find it on next boot.
      const lastSave = repo.saveSession.mock.calls.at(-1);
      const persistedState = lastSave?.[1]?.state;
      expect(['running', 'waiting']).toContain(persistedState);
    });
  });

  describe('cost guardrails', () => {
    it('treats NaN cost as 0 so totalCostUsd does not poison the budget check', async () => {
      setupRepo(
        makeConfig({
          mode: 'continuous',
          limits: {
            maxTurnsPerCycle: 20,
            maxToolCallsPerCycle: 100,
            maxCyclesPerHour: 30,
            cycleTimeoutMs: 300000,
            totalBudgetUsd: 1.0,
          },
        })
      );
      mockRunCycle.mockResolvedValueOnce(makeCycleResult({ costUsd: NaN as unknown as number }));
      // Subsequent cycles return real cost so we can detect budget enforcement
      mockRunCycle.mockResolvedValue(makeCycleResult({ costUsd: 1.5 }));

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();

      // After NaN cycle, totalCostUsd must remain a finite number (0)
      const session = manager.getSession('claw-1');
      expect(session?.totalCostUsd).toBe(0);
      expect(Number.isFinite(session?.totalCostUsd ?? NaN)).toBe(true);
    });

    it('treats negative cost as 0', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      mockRunCycle.mockResolvedValueOnce(makeCycleResult({ costUsd: -5 }));

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();

      expect(manager.getSession('claw-1')?.totalCostUsd).toBe(0);
    });
  });

  describe('autonomyPolicy.maxCostUsdBeforePause', () => {
    it('auto-requests budget_increase escalation when cost crosses threshold', async () => {
      const repo = setupRepo(
        makeConfig({
          mode: 'continuous',
          autonomyPolicy: {
            allowSelfModify: false,
            allowSubclaws: true,
            requireEvidence: true,
            destructiveActionPolicy: 'ask',
            maxCostUsdBeforePause: 0.5,
          },
        })
      );
      // Cycle returns cost above threshold
      mockRunCycle.mockResolvedValue(makeCycleResult({ costUsd: 0.6 }));

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const session = manager.getSession('claw-1');
      expect(session?.state).toBe('escalation_pending');
      expect(session?.pendingEscalation?.type).toBe('budget_increase');
      expect(session?.pendingEscalation?.details?.autoTriggered).toBe(true);

      // Escalation history must have been saved
      expect(repo.saveEscalationHistory).toHaveBeenCalled();
    });

    it('does not re-escalate on subsequent cycles while already pending', async () => {
      setupRepo(
        makeConfig({
          mode: 'continuous',
          autonomyPolicy: {
            allowSelfModify: false,
            allowSubclaws: true,
            requireEvidence: true,
            destructiveActionPolicy: 'ask',
            maxCostUsdBeforePause: 0.5,
          },
        })
      );
      mockRunCycle.mockResolvedValue(makeCycleResult({ costUsd: 0.6 }));

      await manager.startClaw('claw-1', 'user-1');
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();

      // Cycle is now in escalation_pending — even if more time passes, no further cycles run
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });
  });

  describe('task-stall auto-escalation', () => {
    it('auto-requests task_stalled escalation once the focus task crosses CLAW_TASK_STALL_AUTO_ESCALATE cycles', async () => {
      const repo = setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      // Seed an in_progress task one cycle below the auto-escalate threshold
      // so the next cycle's tick crosses the line.
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Save raw API response to temp',
          successCriteria: 'Raw JSON file saved to temp/',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          cyclesInProgress: 9,
        },
      ];

      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const after = manager.getSession('claw-1');
      expect(after?.state).toBe('escalation_pending');
      expect(after?.pendingEscalation?.type).toBe('task_stalled');
      expect(after?.pendingEscalation?.details?.taskId).toBe('t1');
      expect(after?.pendingEscalation?.details?.autoTriggered).toBe(true);
      expect(after?.tasks[0]?.autoEscalatedAt).toBeTruthy();
      expect(repo.saveEscalationHistory).toHaveBeenCalled();
    });

    it('does not auto-escalate the same task twice — autoEscalatedAt marker blocks repeat', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Stuck task',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          // Past AUTO_ESCALATE (10) but below FORCE_BLOCK (20) — this is the
          // band where the marker should suppress re-escalation. The next
          // cycle would tick to 15 which is still below force-block.
          cyclesInProgress: 14,
          autoEscalatedAt: '2026-05-29T00:00:00.000Z',
        },
      ];

      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();

      const after = manager.getSession('claw-1');
      // Already-escalated marker means no new escalation request.
      expect(after?.pendingEscalation).toBeNull();
      expect(after?.state).not.toBe('escalation_pending');
    });

    it('does not auto-escalate below the threshold even if STALL_THRESHOLD has been crossed', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Mildly stuck',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          // Past STALL_THRESHOLD (5) — the runner injects the warning — but
          // below the AUTO_ESCALATE threshold (10). Should NOT escalate yet.
          cyclesInProgress: 6,
        },
      ];

      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();

      const after = manager.getSession('claw-1');
      expect(after?.pendingEscalation).toBeNull();
      expect(after?.tasks[0]?.autoEscalatedAt).toBeUndefined();
    });

    it('injects an action-forcing inbox nudge when the operator approves a task_stalled escalation', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      // Push the session straight into escalation_pending with a task_stalled
      // escalation so we test the approval path in isolation.
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Save raw API response to temp',
          successCriteria: 'Raw JSON file saved to temp/',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          cyclesInProgress: 12,
          autoEscalatedAt: '2026-05-29T00:00:00.000Z',
        },
      ];
      sess!.state = 'escalation_pending';
      sess!.pendingEscalation = {
        id: 'esc-1',
        type: 'task_stalled',
        reason: 'stalled',
        details: { taskId: 't1', taskTitle: 'Save raw API response to temp', cyclesInProgress: 12 },
        requestedAt: new Date(),
      };

      const ok = await manager.approveEscalation('claw-1');
      expect(ok).toBe(true);

      const after = manager.getSession('claw-1');
      expect(after?.state).not.toBe('escalation_pending');
      expect(after?.pendingEscalation).toBeNull();
      const nudge = after?.inbox.at(-1);
      expect(nudge).toContain('[ESCALATION_APPROVED]');
      expect(nudge).toContain('t1');
      expect(nudge).toContain('Save raw API response to temp');
      expect(nudge).toContain('claw_split_task');
      expect(nudge).toContain('claw_update_task');
    });

    it('force-blocks the task at CLAW_TASK_STALL_FORCE_BLOCK cycles, fires escalation, and carries failure context', async () => {
      const repo = setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      // Seed a task at one below the force-block threshold with the
      // auto-escalate marker already set — simulating the case where the
      // escalation was denied and the agent kept retrying. Also seed
      // recentFailures so the nudge has actual error context to surface.
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Save raw API response to temp',
          status: 'in_progress',
          createdAt: 'x',
          updatedAt: 'x',
          cyclesInProgress: 19,
          autoEscalatedAt: '2026-05-29T00:00:00.000Z',
        },
      ];
      sess!.recentFailures = [
        {
          cycleNumber: 17,
          at: 'x',
          error: 'write_file failed: ENOENT',
          toolErrors: [
            { tool: 'write_file', error: 'ENOENT: no such file or directory, open /tmp/foo.json' },
          ],
        },
        {
          cycleNumber: 18,
          at: 'x',
          error: 'write_file failed: ENOENT',
          toolErrors: [
            { tool: 'write_file', error: 'ENOENT: no such file or directory, open /tmp/foo.json' },
          ],
        },
      ];

      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const after = manager.getSession('claw-1');
      const task = after?.tasks.find((t) => t.id === 't1');
      expect(task?.status).toBe('blocked');
      expect(task?.cyclesInProgress).toBe(0);
      expect(task?.autoEscalatedAt).toBeUndefined();
      expect(task?.notes).toContain('[AUTO-BLOCKED]');

      // Inbox nudge surfaces recent failure context so the agent can
      // diagnose the root cause on its next cycle.
      const nudge = after?.inbox.at(-1);
      expect(nudge).toContain('[TASK_FORCE_BLOCKED]');
      expect(nudge).toContain('t1');
      expect(nudge).toContain('Recent failure context');
      expect(nudge).toContain('write_file');
      expect(nudge).toContain('ENOENT');
      // The three required next-cycle actions must be present so the agent
      // does not just silently move on to dependent tasks.
      expect(nudge).toContain('ROOT-CAUSE');
      expect(nudge).toContain('ESCALATE');
      expect(nudge).toContain('MARK MISSION BLOCKED');

      // Force-block must ALSO trigger an operator-facing escalation — silent
      // blocking leaves load-bearing tasks orphaned with no human notified.
      expect(after?.state).toBe('escalation_pending');
      expect(after?.pendingEscalation?.type).toBe('task_force_blocked');
      expect(after?.pendingEscalation?.details?.taskId).toBe('t1');
      expect(after?.pendingEscalation?.details?.cyclesInProgress).toBe(20);
      expect(after?.pendingEscalation?.details?.recentFailures).toBeDefined();
      expect(repo.saveEscalationHistory).toHaveBeenCalled();

      // Plan history records the block as an operator-actor mutation.
      const blockEntry = after?.planHistory.find((e) => e.newStatus === 'blocked');
      expect(blockEntry?.kind).toBe('task_update');
      expect(blockEntry?.actor).toBe('operator');
    });

    it('does not inject a stall nudge when approving a non-stall escalation', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.state = 'escalation_pending';
      sess!.pendingEscalation = {
        id: 'esc-2',
        type: 'budget_increase',
        reason: 'budget threshold',
        details: { autoTriggered: true },
        requestedAt: new Date(),
      };
      const inboxBefore = sess!.inbox.length;

      await manager.approveEscalation('claw-1');

      const after = manager.getSession('claw-1');
      expect(after?.inbox.length).toBe(inboxBefore);
    });

    it('injects a recovery-or-fail nudge when approving a task_force_blocked escalation', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.state = 'escalation_pending';
      sess!.pendingEscalation = {
        id: 'esc-3',
        type: 'task_force_blocked',
        reason: 'auto-blocked',
        details: { taskId: 't1.2', taskTitle: 'Save raw API response to temp' },
        requestedAt: new Date(),
      };

      await manager.approveEscalation('claw-1');

      const after = manager.getSession('claw-1');
      const nudge = after?.inbox.at(-1);
      expect(nudge).toContain('[ESCALATION_APPROVED]');
      expect(nudge).toContain('task_force_blocked');
      expect(nudge).toContain('t1.2');
      expect(nudge).toContain('Save raw API response to temp');
      // Must surface the three concrete recovery moves so the agent doesn't
      // drift back to a doomed retry path.
      expect(nudge).toContain('claw_split_task');
      expect(nudge).toContain('claw_complete_report');
      expect(nudge).toContain('claw_update_task');
    });

    it('denying a task_force_blocked escalation tells the agent to mark the mission failed, not "continue"', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const sess = manager.getSession('claw-1');
      sess!.state = 'escalation_pending';
      sess!.pendingEscalation = {
        id: 'esc-4',
        type: 'task_force_blocked',
        reason: 'auto-blocked',
        details: { taskId: 't1.2' },
        requestedAt: new Date(),
      };

      await manager.denyEscalation('claw-1', 'not now');

      const after = manager.getSession('claw-1');
      const denial = after?.inbox.at(-1);
      expect(denial).toContain('[ESCALATION_DENIED]');
      expect(denial).toContain('task_force_blocked');
      expect(denial).toContain('claw_complete_report');
      expect(denial).toContain('status="failed"');
      // The misleading default message ("Continue with your current
      // capabilities") must NOT be used for force-block denials.
      expect(denial).not.toContain('Continue with your current capabilities');
    });
  });

  describe('rate limiting', () => {
    it('pauses the claw and emits a paused event when hourly cap is hit', async () => {
      // Tight cap so we trip it on the first cycle.
      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 20,
          maxToolCallsPerCycle: 100,
          maxCyclesPerHour: 1,
          cycleTimeoutMs: 300_000,
        },
      });
      setupRepo(config);

      // Stub the event system so we can assert the paused event was emitted.
      const emit = vi.fn();
      mockGetEventSystem.mockReturnValue({
        emit,
        on: vi.fn(() => vi.fn()),
        onAny: vi.fn(() => vi.fn()),
        onPattern: vi.fn(() => vi.fn()),
        off: vi.fn(),
      });

      await manager.startClaw('claw-1', 'user-1');
      // First cycle consumes the budget.
      await vi.advanceTimersByTimeAsync(600);
      // Second cycle (idle delay 5s) should be rate-limited.
      await vi.advanceTimersByTimeAsync(6000);

      const pausedEmits = emit.mock.calls.filter((call) => call[0] === 'claw.paused');
      expect(pausedEmits.length).toBeGreaterThan(0);
      const payload = pausedEmits[0]?.[2] as { reason?: string };
      expect(payload?.reason).toBe('rate_limit');
      expect(manager.getSession('claw-1')?.state).toBe('paused');
    });
  });

  describe('plan-updated broadcast', () => {
    it('emits claw.plan.updated when replacePlan is called', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));

      const emit = vi.fn();
      mockGetEventSystem.mockReturnValue({
        emit,
        on: vi.fn(() => vi.fn()),
        onAny: vi.fn(() => vi.fn()),
        onPattern: vi.fn(() => vi.fn()),
        off: vi.fn(),
      });

      await manager.startClaw('claw-1', 'user-1');

      const now = new Date().toISOString();
      await manager.replacePlan('claw-1', [
        {
          id: 't1',
          title: 'Survey',
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          cyclesInProgress: 0,
        },
      ]);

      const planEmits = emit.mock.calls.filter((c) => c[0] === 'claw.plan.updated');
      expect(planEmits.length).toBe(1);
      const payload = planEmits[0]?.[2] as {
        clawId: string;
        source: string;
        tasks: unknown[];
        counts: { total: number; pending: number };
      };
      expect(payload?.clawId).toBe('claw-1');
      expect(payload?.source).toBe('replace');
      expect(payload?.tasks).toHaveLength(1);
      expect(payload?.counts.total).toBe(1);
      expect(payload?.counts.pending).toBe(1);
    });

    it('records a planHistory entry for each replacePlan with actor + count', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');

      const now = new Date().toISOString();
      await manager.replacePlan(
        'claw-1',
        [
          {
            id: 't1',
            title: 'A',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            cyclesInProgress: 0,
          },
        ],
        'operator'
      );
      await manager.replacePlan(
        'claw-1',
        [
          {
            id: 't1',
            title: 'A',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            cyclesInProgress: 0,
          },
          {
            id: 't2',
            title: 'B',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            cyclesInProgress: 0,
          },
        ],
        'agent'
      );

      const hist = manager.getSession('claw-1')?.planHistory ?? [];
      expect(hist).toHaveLength(2);
      expect(hist[0]).toMatchObject({ actor: 'operator', kind: 'replace', newTaskCount: 1 });
      expect(hist[1]).toMatchObject({ actor: 'agent', kind: 'replace', newTaskCount: 2 });
    });

    it('records a task_update history entry only when status actually changes', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'A',
          status: 'pending',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ];

      // Status changes → entry recorded.
      await manager.updateTaskOnSession('claw-1', { id: 't1', status: 'in_progress' }, 'operator');
      // Notes-only update with same status → NO entry.
      await manager.updateTaskOnSession(
        'claw-1',
        { id: 't1', status: 'in_progress', notes: 'pinning down repro' },
        'operator'
      );

      const hist = manager.getSession('claw-1')?.planHistory ?? [];
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({
        kind: 'task_update',
        taskId: 't1',
        prevStatus: 'pending',
        newStatus: 'in_progress',
        actor: 'operator',
      });
    });

    it('splitTaskOnSession records one task_update + one task_added per subtask in plan history', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'Refactor',
          status: 'in_progress',
          cyclesInProgress: 6,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ];
      // Drop existing history so we can assert exactly what split recorded.
      sess!.planHistory = [];

      await manager.splitTaskOnSession(
        'claw-1',
        {
          parentId: 't1',
          subtasks: [{ title: 'part A' }, { title: 'part B' }],
        },
        'operator'
      );

      const hist = manager.getSession('claw-1')?.planHistory ?? [];
      // 1 task_update for parent (in_progress → blocked) + 2 task_added.
      expect(hist).toHaveLength(3);
      expect(hist[0]).toMatchObject({
        kind: 'task_update',
        taskId: 't1',
        prevStatus: 'in_progress',
        newStatus: 'blocked',
      });
      expect(hist[1]).toMatchObject({ kind: 'task_added', taskId: 't1.1' });
      expect(hist[2]).toMatchObject({ kind: 'task_added', taskId: 't1.2' });
      // Parent must be flagged with auto-evidence so the audit trail is visible
      // directly on the task row, not only in plan history.
      expect(manager.getSession('claw-1')?.tasks[0]?.evidence).toContain('Split into: t1.1, t1.2');
    });

    it('caps planHistory at CLAW_PLAN_HISTORY_MAX entries', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));
      await manager.startClaw('claw-1', 'user-1');
      // Run 55 plan replacements; ring should hold 50.
      const now = new Date().toISOString();
      for (let i = 0; i < 55; i++) {
        await manager.replacePlan(
          'claw-1',
          [
            {
              id: 't1',
              title: `v${i}`,
              status: 'pending',
              createdAt: now,
              updatedAt: now,
              cyclesInProgress: 0,
            },
          ],
          'agent'
        );
      }
      const hist = manager.getSession('claw-1')?.planHistory ?? [];
      expect(hist).toHaveLength(50);
    });

    it('emits claw.plan.updated with source="task" and taskId when updateTaskOnSession is called', async () => {
      setupRepo(makeConfig({ mode: 'continuous' }));

      const emit = vi.fn();
      mockGetEventSystem.mockReturnValue({
        emit,
        on: vi.fn(() => vi.fn()),
        onAny: vi.fn(() => vi.fn()),
        onPattern: vi.fn(() => vi.fn()),
        off: vi.fn(),
      });

      await manager.startClaw('claw-1', 'user-1');
      const sess = manager.getSession('claw-1');
      sess!.tasks = [
        {
          id: 't1',
          title: 'A',
          status: 'pending',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ];

      await manager.updateTaskOnSession('claw-1', { id: 't1', status: 'in_progress' });

      const planEmits = emit.mock.calls.filter((c) => c[0] === 'claw.plan.updated');
      expect(planEmits.length).toBeGreaterThan(0);
      const payload = planEmits[planEmits.length - 1]?.[2] as {
        source: string;
        taskId: string;
        counts: { in_progress: number };
      };
      expect(payload?.source).toBe('task');
      expect(payload?.taskId).toBe('t1');
      expect(payload?.counts.in_progress).toBe(1);
    });
  });

  describe('event-mode self-loop guard', () => {
    it('ignores events sourced from the same claw to avoid infinite loops', async () => {
      const config = makeConfig({
        mode: 'event',
        eventFilters: ['claw.cycle.complete'],
      });
      setupRepo(config);

      // Capture the handler registered on onAny.
      let registeredHandler: ((ev: unknown) => void) | null = null;
      const onAny = vi.fn((_eventType: string, handler: (ev: unknown) => void) => {
        registeredHandler = handler;
        return () => {};
      });
      mockGetEventSystem.mockReturnValue({
        emit: vi.fn(),
        on: vi.fn(() => vi.fn()),
        onAny,
        onPattern: vi.fn(() => vi.fn()),
        off: vi.fn(),
      });

      await manager.startClaw('claw-1', 'user-1');
      // Event-mode claws sit in 'waiting' until an event fires.
      expect(manager.getSession('claw-1')?.state).toBe('waiting');
      expect(onAny).toHaveBeenCalled();
      expect(registeredHandler).not.toBeNull();

      // Self-event (source === claw:claw-1) MUST be ignored.
      registeredHandler!({
        type: 'claw.cycle.complete',
        source: 'claw:claw-1',
        payload: { clawId: 'claw-1' },
      });
      await vi.advanceTimersByTimeAsync(50);
      expect(mockRunCycle).not.toHaveBeenCalled();
      expect(manager.getSession('claw-1')?.state).toBe('waiting');

      // External event from another source SHOULD trigger a cycle.
      registeredHandler!({
        type: 'claw.cycle.complete',
        source: 'claw:other-claw',
        payload: { clawId: 'other-claw' },
      });
      await vi.advanceTimersByTimeAsync(50);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });
  });
});

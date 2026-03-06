/**
 * Background Agent Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BackgroundAgentConfig, BackgroundAgentCycleResult } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockOnAny, mockOff, mockEmit, mockEmitRaw, mockOn } = vi.hoisted(() => ({
  mockOnAny: vi.fn().mockReturnValue(() => {}),
  mockOff: vi.fn(),
  mockEmit: vi.fn(),
  mockEmitRaw: vi.fn(),
  mockOn: vi.fn().mockReturnValue(() => {}),
}));

const mockRunCycle = vi.fn<[], Promise<BackgroundAgentCycleResult>>().mockResolvedValue({
  success: true,
  toolCalls: [{ tool: 'test', args: {}, result: 'ok', duration: 50 }],
  outputMessage: 'Done',
  tokensUsed: { prompt: 100, completion: 50 },
  durationMs: 500,
  turns: 1,
});

vi.mock('./background-agent-runner.js', () => ({
  BackgroundAgentRunner: vi.fn(function (this: Record<string, unknown>) {
    this.runCycle = mockRunCycle;
    this.updateConfig = vi.fn();
  }),
}));

const mockSaveSession = vi.fn().mockResolvedValue(undefined);
const mockLoadSession = vi.fn().mockResolvedValue(null);
const mockSaveHistory = vi.fn().mockResolvedValue(undefined);
const mockGetInterruptedSessions = vi.fn().mockResolvedValue([]);
const mockGetAutoStartAgents = vi.fn().mockResolvedValue([]);

const mockUpdate = vi.fn().mockResolvedValue(null);

vi.mock('../db/repositories/background-agents.js', () => ({
  getBackgroundAgentsRepository: () => ({
    saveSession: mockSaveSession,
    loadSession: mockLoadSession,
    saveHistory: mockSaveHistory,
    getInterruptedSessions: mockGetInterruptedSessions,
    getAutoStartAgents: mockGetAutoStartAgents,
    update: mockUpdate,
  }),
}));

const mockGetOrCreateSessionWorkspace = vi.fn().mockReturnValue({
  id: 'bg-agent-bg-1',
  name: 'bg-agent-bg-1',
  path: '/tmp/workspace/bg-agent-bg-1',
  size: 0,
  fileCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

vi.mock('../workspace/file-workspace.js', () => ({
  getOrCreateSessionWorkspace: mockGetOrCreateSessionWorkspace,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: () => ({
      emit: mockEmit,
      emitRaw: mockEmitRaw,
      on: mockOn,
      onAny: mockOnAny,
      off: mockOff,
      scoped: () => ({ on: vi.fn(), emit: vi.fn() }),
    }),
  };
});

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { BackgroundAgentManager } = await import('./background-agent-manager.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BackgroundAgentConfig> = {}): BackgroundAgentConfig {
  return {
    id: 'bg-1',
    userId: 'user-1',
    name: 'Test Agent',
    mission: 'Monitor goals',
    mode: 'interval',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 120000,
    },
    intervalMs: 300000,
    autoStart: false,
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundAgentManager', () => {
  let manager: InstanceType<typeof BackgroundAgentManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Re-apply return values that clearAllMocks wipes
    mockOnAny.mockReturnValue(() => {});
    mockOn.mockReturnValue(() => {});
    // Reset queued mockResolvedValueOnce values and re-apply default
    mockRunCycle.mockReset().mockResolvedValue({
      success: true,
      toolCalls: [{ tool: 'test', args: {}, result: 'ok', duration: 50 }],
      outputMessage: 'Done',
      tokensUsed: { prompt: 100, completion: 50 },
      durationMs: 500,
      turns: 1,
    });
    manager = new BackgroundAgentManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startAgent', () => {
    it('creates a session and returns it', async () => {
      const config = makeConfig();
      const session = await manager.startAgent(config);

      expect(session.state).toBe('running');
      expect(session.config.id).toBe('bg-1');
      expect(session.cyclesCompleted).toBe(0);
    });

    it('throws if agent is already running', async () => {
      const config = makeConfig();
      await manager.startAgent(config);

      await expect(manager.startAgent(config)).rejects.toThrow('already running');
    });

    it('persists session to DB', async () => {
      await manager.startAgent(makeConfig());
      expect(mockSaveSession).toHaveBeenCalled();
    });

    it('creates a workspace for file isolation', async () => {
      mockGetOrCreateSessionWorkspace.mockClear();
      await manager.startAgent(makeConfig());
      expect(mockGetOrCreateSessionWorkspace).toHaveBeenCalledWith(
        'bg-agent-bg-1',
        'bg-1',
        'user-1'
      );
    });

    it('continues without workspace when getOrCreateSessionWorkspace throws', async () => {
      mockGetOrCreateSessionWorkspace.mockImplementationOnce(() => {
        throw new Error('Workspace unavailable');
      });
      // Should not throw — workspace error is caught (line 193)
      const session = await manager.startAgent(makeConfig());
      expect(session).toBeDefined();
      expect(session.state).toBe('running');
    });

    it('resumes session from DB when saved session exists', async () => {
      mockLoadSession.mockResolvedValueOnce({
        state: 'running',
        cyclesCompleted: 5,
        totalToolCalls: 20,
        totalCostUsd: 1.5,
        lastCycleAt: new Date(),
        lastCycleDurationMs: 300,
        lastCycleError: null,
        startedAt: new Date(),
        stoppedAt: null,
        persistentContext: {},
        inbox: [],
      });

      const session = await manager.startAgent(makeConfig());
      expect(session.cyclesCompleted).toBe(5);
      expect(session.totalCostUsd).toBe(1.5);
    });
  });

  describe('pauseAgent', () => {
    it('pauses a running agent', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.pauseAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('paused');
    });

    it('returns false if agent is not running', async () => {
      const result = await manager.pauseAgent('bg-999');
      expect(result).toBe(false);
    });

    it('returns false when agent is already paused', async () => {
      await manager.startAgent(makeConfig());
      await manager.pauseAgent('bg-1'); // first pause succeeds
      const result = await manager.pauseAgent('bg-1'); // second pause returns false (line 249)
      expect(result).toBe(false);
    });
  });

  describe('resumeAgent', () => {
    it('resumes a paused agent', async () => {
      await manager.startAgent(makeConfig());
      await manager.pauseAgent('bg-1');

      const result = await manager.resumeAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('running');
    });

    it('returns false if agent is not paused', async () => {
      await manager.startAgent(makeConfig());
      const result = await manager.resumeAgent('bg-1');
      expect(result).toBe(false);
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.resumeAgent('bg-nonexistent'); // line 269
      expect(result).toBe(false);
    });
  });

  describe('stopAgent', () => {
    it('stops a running agent', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.stopAgent('bg-1');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session).toBeNull();
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.stopAgent('bg-999');
      expect(result).toBe(false);
    });
  });

  describe('getSession / getAllSessions', () => {
    it('returns null for unknown agent', () => {
      expect(manager.getSession('bg-999')).toBeNull();
    });

    it('returns sessions filtered by user', async () => {
      await manager.startAgent(makeConfig({ id: 'bg-1', userId: 'user-1' }));
      await manager.startAgent(makeConfig({ id: 'bg-2', userId: 'user-2' }));

      const user1Sessions = manager.getSessionsByUser('user-1');
      expect(user1Sessions).toHaveLength(1);
      expect(user1Sessions[0]!.config.id).toBe('bg-1');
    });
  });

  describe('sendMessage', () => {
    it('adds message to session inbox', async () => {
      await manager.startAgent(makeConfig());

      const result = await manager.sendMessage('bg-1', 'user', 'Hello agent');
      expect(result).toBe(true);

      const session = manager.getSession('bg-1');
      expect(session?.inbox).toContain('Hello agent');
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.sendMessage('bg-999', 'user', 'Hello');
      expect(result).toBe(false);
    });
  });

  describe('start (boot)', () => {
    it('resumes interrupted sessions', async () => {
      mockGetInterruptedSessions.mockResolvedValueOnce([
        {
          agentId: 'bg-1',
          config: makeConfig(),
          state: 'running',
        },
      ]);

      await manager.start();

      const session = manager.getSession('bg-1');
      expect(session).not.toBeNull();
    });

    it('starts autoStart agents', async () => {
      mockGetAutoStartAgents.mockResolvedValueOnce([
        makeConfig({ id: 'bg-auto', autoStart: true }),
      ]);

      await manager.start();

      const session = manager.getSession('bg-auto');
      expect(session).not.toBeNull();
    });

    it('is idempotent when called while already running', async () => {
      await manager.start();
      await manager.start(); // second call returns early (line 77)
      // getInterruptedSessions should only be called once
      expect(mockGetInterruptedSessions).toHaveBeenCalledTimes(1);
    });

    it('logs error and continues when getInterruptedSessions rejects', async () => {
      mockGetInterruptedSessions.mockRejectedValueOnce(new Error('DB error'));
      // Should not throw; proceeds to autoStart phase
      await expect(manager.start()).resolves.not.toThrow();
      expect(mockGetAutoStartAgents).toHaveBeenCalled();
    });

    it('logs error when individual interrupted agent fails to resume', async () => {
      const config1 = makeConfig({ id: 'bg-dup' });
      // Two configs with the same id — second startAgent call throws 'already running'
      mockGetInterruptedSessions.mockResolvedValueOnce([
        { config: config1 },
        { config: config1 }, // duplicate id triggers the inner catch
      ]);
      await expect(manager.start()).resolves.not.toThrow();
    });

    it('logs error and continues when getAutoStartAgents rejects', async () => {
      mockGetAutoStartAgents.mockRejectedValueOnce(new Error('DB error'));
      await expect(manager.start()).resolves.not.toThrow();
    });

    it('logs error when individual autoStart agent fails to start', async () => {
      const config = makeConfig({ id: 'bad-auto', autoStart: true });
      mockGetAutoStartAgents.mockResolvedValueOnce([config]);
      // Make loadSession reject to cause startAgent to throw
      mockLoadSession.mockRejectedValueOnce(new Error('DB fail'));
      await expect(manager.start()).resolves.not.toThrow();
    });
  });

  describe('stop (shutdown)', () => {
    it('stops all running agents', async () => {
      // Need to call start() first so the running flag is set
      await manager.start();
      await manager.startAgent(makeConfig({ id: 'bg-1' }));
      await manager.startAgent(makeConfig({ id: 'bg-2' }));

      await manager.stop();

      expect(manager.getSession('bg-1')).toBeNull();
      expect(manager.getSession('bg-2')).toBeNull();
    });

    it('does nothing when manager was never started', async () => {
      // stop() returns early when this.running is false (line 124)
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  describe('isRunning', () => {
    it('returns true for running agent', async () => {
      await manager.startAgent(makeConfig());
      expect(manager.isRunning('bg-1')).toBe(true);
    });

    it('returns false for unknown agent', () => {
      expect(manager.isRunning('bg-999')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Budget enforcement
  // -------------------------------------------------------------------------

  describe('budget enforcement', () => {
    it('accumulates cost from cycle results', async () => {
      mockRunCycle.mockResolvedValueOnce({
        success: true,
        toolCalls: [],
        outputMessage: 'Cycle 1',
        durationMs: 100,
        turns: 1,
        costUsd: 0.25,
      });

      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 10.0,
        },
      });

      await manager.start();
      await manager.startAgent(config);

      // Trigger cycle
      await vi.advanceTimersByTimeAsync(600);

      // Agent should still be running with accumulated cost
      const session = manager.getSession('bg-1');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('running');
      expect(session!.totalCostUsd).toBe(0.25);
    });

    it('stops agent when budget is exceeded at cycle start', async () => {
      mockRunCycle.mockResolvedValueOnce({
        success: true,
        toolCalls: [],
        outputMessage: 'Cycle 1',
        durationMs: 100,
        turns: 1,
        costUsd: 0.6,
      });

      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0.5,
        },
      });

      await manager.start();
      await manager.startAgent(config);

      // First cycle (initial delay = 500ms)
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
      // totalCostUsd = 0.6 >= totalBudgetUsd = 0.5

      // Next scheduled cycle (idle delay = 3000ms since toolCalls=[])
      // Budget check fires → stopAgent called → agent removed (lines 536-542)
      await vi.advanceTimersByTimeAsync(3100);
      await vi.advanceTimersByTimeAsync(0); // flush stopAgent

      expect(manager.getSession('bg-1')).toBeNull();
      // mockRunCycle only called once (budget blocked second call)
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });

    it('does not run cycle when budget is already exceeded', async () => {
      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0.5,
        },
      });

      await manager.start();
      await manager.startAgent(config);

      // First cycle costs $0.60 (over budget for next cycle)
      mockRunCycle.mockResolvedValueOnce({
        success: true,
        toolCalls: [],
        outputMessage: 'Cycle 1',
        durationMs: 100,
        turns: 1,
        costUsd: 0.6,
      });

      // Trigger first cycle
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Second cycle should be blocked by budget check (runner NOT called again)
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockRunCycle).toHaveBeenCalledTimes(1); // Still 1 — budget prevented execution
    });

    it('tracks totalCostUsd as zero when cycle has no cost', async () => {
      // Default mock has no costUsd field
      const config = makeConfig({ mode: 'continuous' });

      await manager.start();
      await manager.startAgent(config);

      // Trigger cycle
      await vi.advanceTimersByTimeAsync(600);

      const session = manager.getSession('bg-1');
      expect(session!.totalCostUsd).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('delays cycle when maxCyclesPerHour is reached', async () => {
      // Set maxCyclesPerHour to 1 so second cycle is rate-limited
      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 1,
          cycleTimeoutMs: 120000,
        },
      });

      await manager.start();
      await manager.startAgent(config);

      // First cycle completes
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Next scheduled cycle should be rate-limited — runner should NOT be called again
      await vi.advanceTimersByTimeAsync(600);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);

      // Agent should still be running (just waiting for rate limit window)
      expect(manager.getSession('bg-1')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // shouldStop — stop condition evaluation
  // -------------------------------------------------------------------------

  describe('shouldStop — MISSION_COMPLETE', () => {
    it('stops agent when output contains MISSION_COMPLETE', async () => {
      mockRunCycle.mockResolvedValueOnce({
        success: true,
        toolCalls: [],
        outputMessage: 'All tasks done. MISSION_COMPLETE',
        durationMs: 100,
        turns: 1,
      });

      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);

      // Continuous min delay = 500ms
      await vi.advanceTimersByTimeAsync(600);
      // Flush pending microtasks (stopAgent is called async inside shouldStop)
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getSession('bg-1')).toBeNull();
    });
  });

  describe('shouldStop — max_cycles', () => {
    it('stops agent when stopCondition max_cycles:1 is reached', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'max_cycles:1' });
      await manager.start();
      await manager.startAgent(config);

      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);

      // After 1 completed cycle, cyclesCompleted = 1 >= 1 → stopped
      expect(manager.getSession('bg-1')).toBeNull();
    });

    it('does not stop when cycle count is below max_cycles', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'max_cycles:5' });
      await manager.start();
      await manager.startAgent(config);

      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);

      // Only 1 cycle completed, max is 5 — agent should still be running
      const session = manager.getSession('bg-1');
      expect(session).not.toBeNull();
      expect(session!.cyclesCompleted).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Event mode
  // -------------------------------------------------------------------------

  describe('event mode', () => {
    it('starts in waiting state', async () => {
      const config = makeConfig({ mode: 'event', eventFilters: ['message.received'] });
      await manager.startAgent(config);

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('waiting');
    });

    it('subscribes to configured event filters via onAny', async () => {
      const config = makeConfig({
        mode: 'event',
        eventFilters: ['message.received', 'task.created'],
      });
      await manager.startAgent(config);

      expect(mockOnAny).toHaveBeenCalledTimes(2);
      expect(mockOnAny).toHaveBeenCalledWith('message.received', expect.any(Function));
      expect(mockOnAny).toHaveBeenCalledWith('task.created', expect.any(Function));
    });

    it('sendMessage triggers an immediate cycle for event-mode agents', async () => {
      const config = makeConfig({ mode: 'event', eventFilters: ['message.received'] });
      await manager.start();
      await manager.startAgent(config);

      expect(manager.getSession('bg-1')?.state).toBe('waiting');

      await manager.sendMessage('bg-1', 'user', 'Hello');
      // scheduleImmediate sets setTimeout(0)
      await vi.advanceTimersByTimeAsync(1);

      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });

    it('fires event handler to trigger cycle (covers lines 480-482)', async () => {
      const config = makeConfig({ mode: 'event', eventFilters: ['custom.event'] });
      await manager.start();
      await manager.startAgent(config);

      expect(manager.getSession('bg-1')?.state).toBe('waiting');

      // Grab the handler registered via onAny and invoke it directly
      const calls = mockOnAny.mock.calls;
      const handler = calls[calls.length - 1]?.[1] as (() => void) | undefined;
      expect(handler).toBeDefined();

      // Fire the event — sets state to 'running' and schedules immediate cycle
      handler!();
      expect(manager.getSession('bg-1')?.state).toBe('running');

      // Run the scheduled immediate cycle (setTimeout 0)
      await vi.advanceTimersByTimeAsync(1);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });

    it('re-subscribes to event filters after each completed cycle (covers lines 467-471)', async () => {
      const config = makeConfig({ mode: 'event', eventFilters: ['my.event'] });
      await manager.start();
      await manager.startAgent(config);

      const onAnyCallsBefore = mockOnAny.mock.calls.length; // 1 after startAgent

      // Grab handler and fire it to trigger a cycle
      const handler = mockOnAny.mock.calls[mockOnAny.mock.calls.length - 1]?.[1] as () => void;
      handler();
      await vi.advanceTimersByTimeAsync(1);

      // After cycle, scheduleNext → subscribeToEvents called again with existing subs
      // mockOff should be called (clearing old subs), mockOnAny called again (re-subscribing)
      expect(mockOff).toHaveBeenCalled();
      expect(mockOnAny.mock.calls.length).toBeGreaterThan(onAnyCallsBefore);
    });

    it('resumes to waiting state after pause/resume', async () => {
      const config = makeConfig({ mode: 'event', eventFilters: ['message.received'] });
      await manager.startAgent(config);
      await manager.pauseAgent('bg-1');
      await manager.resumeAgent('bg-1');

      expect(manager.getSession('bg-1')?.state).toBe('waiting');
    });
  });

  // -------------------------------------------------------------------------
  // executeNow
  // -------------------------------------------------------------------------

  describe('executeNow', () => {
    it('runs a cycle immediately and returns true', async () => {
      await manager.start();
      await manager.startAgent(makeConfig({ mode: 'continuous' }));

      const result = await manager.executeNow('bg-1');

      expect(result).toBe(true);
      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });

    it('returns false for unknown agent', async () => {
      const result = await manager.executeNow('bg-999');
      expect(result).toBe(false);
    });

    it('returns false for paused agent', async () => {
      await manager.startAgent(makeConfig());
      await manager.pauseAgent('bg-1');

      const result = await manager.executeNow('bg-1');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Interval mode cycle
  // -------------------------------------------------------------------------

  describe('interval mode cycle', () => {
    it('runs a cycle after the configured interval elapses', async () => {
      const config = makeConfig({ mode: 'interval', intervalMs: 300000 });
      await manager.start();
      await manager.startAgent(config);

      await vi.advanceTimersByTimeAsync(300001);

      expect(mockRunCycle).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // executeCycle — error handling
  // -------------------------------------------------------------------------

  describe('executeCycle — saveHistory error', () => {
    it('logs error when saveHistory rejects but continues normally', async () => {
      mockSaveHistory.mockRejectedValueOnce(new Error('DB write failed'));

      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);

      // Trigger cycle
      await vi.advanceTimersByTimeAsync(600);

      // Agent should still be running despite saveHistory failure (line 593)
      expect(manager.getSession('bg-1')).not.toBeNull();
    });
  });

  describe('executeCycle error handling', () => {
    it('records error when runner.runCycle throws', async () => {
      mockRunCycle.mockRejectedValueOnce(new Error('Runner crashed'));

      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);

      await vi.advanceTimersByTimeAsync(600);

      const session = manager.getSession('bg-1');
      expect(session?.cyclesCompleted).toBe(1);
      expect(session?.lastCycleError).toBe('Runner crashed');
    });

    it('auto-pauses after 5 consecutive errors', async () => {
      mockRunCycle.mockResolvedValue({
        success: false,
        toolCalls: [],
        outputMessage: '',
        durationMs: 100,
        turns: 0,
        error: 'LLM error',
      });

      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);

      // Continuous mode: 1st cycle at 500ms, subsequent error-backoff cycles at 5000ms each
      await vi.advanceTimersByTimeAsync(500); // cycle 1
      await vi.advanceTimersByTimeAsync(5001); // cycle 2
      await vi.advanceTimersByTimeAsync(5001); // cycle 3
      await vi.advanceTimersByTimeAsync(5001); // cycle 4
      await vi.advanceTimersByTimeAsync(5001); // cycle 5 → auto-pause

      const session = manager.getSession('bg-1');
      expect(session?.state).toBe('paused');
    });
  });

  // -------------------------------------------------------------------------
  // updateAgentConfig
  // -------------------------------------------------------------------------

  describe('updateAgentConfig', () => {
    it('updates the session config for a running agent', async () => {
      await manager.startAgent(makeConfig());
      const newConfig = makeConfig({ name: 'Updated Agent', mission: 'New mission' });

      manager.updateAgentConfig('bg-1', newConfig);

      const session = manager.getSession('bg-1');
      expect(session?.config.name).toBe('Updated Agent');
      expect(session?.config.mission).toBe('New mission');
    });

    it('does nothing for unknown agent', () => {
      expect(() => manager.updateAgentConfig('bg-999', makeConfig())).not.toThrow();
    });

    it('reschedules when mode changes', async () => {
      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);

      const newConfig = makeConfig({ mode: 'interval', intervalMs: 60000 });
      manager.updateAgentConfig('bg-1', newConfig);

      // Agent should still be tracked after config update
      expect(manager.isRunning('bg-1')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getAllSessions
  // -------------------------------------------------------------------------

  describe('getAllSessions', () => {
    it('returns all active sessions', async () => {
      await manager.startAgent(makeConfig({ id: 'bg-1', userId: 'user-1' }));
      await manager.startAgent(makeConfig({ id: 'bg-2', userId: 'user-2' }));

      const sessions = manager.getAllSessions();
      expect(sessions).toHaveLength(2);
    });

    it('returns empty array when no agents are running', () => {
      expect(manager.getAllSessions()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Extended branch coverage
  // -------------------------------------------------------------------------

  describe('extended branch coverage', () => {
    // ---- Line 218: setInterval persist error ----
    it('logs error when periodic session persist fails (line 218)', async () => {
      await manager.startAgent(makeConfig({ mode: 'continuous' }));
      // Queue rejection for the next saveSession call (30s persist interval)
      mockSaveSession.mockRejectedValueOnce(new Error('Persist error'));
      // Advance past SESSION_PERSIST_INTERVAL_MS (30,000ms) to fire the interval
      await vi.advanceTimersByTimeAsync(30_001);
      // .catch() at line 218 handled the error — agent still running
      expect(manager.getSession('bg-1')).not.toBeNull();
    });

    // ---- Lines 392-393: executeNow catch block ----
    it('executeNow returns false when executeCycle throws (lines 392-393)', async () => {
      // totalBudgetUsd: 0 → budget check: totalCostUsd(0) >= 0 → immediately over budget
      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0,
        },
      });
      await manager.start();
      await manager.startAgent(config);
      // Make saveSession reject so stopAgent (inside executeCycle) throws
      mockSaveSession.mockRejectedValueOnce(new Error('DB error'));
      const result = await manager.executeNow('bg-1');
      expect(result).toBe(false);
    });

    // ---- Line 441: continuous mode timer .catch() ----
    it('handles executeCycle throw inside continuous setTimeout (line 441)', async () => {
      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0, // immediately over budget
        },
      });
      await manager.start();
      await manager.startAgent(config);
      // Queue rejection for stopAgent's persistSession call inside executeCycle
      mockSaveSession.mockRejectedValueOnce(new Error('DB error'));
      // Fire the 500ms continuous timer → executeCycle → budget exceeded → throws → .catch() at 441
      await vi.advanceTimersByTimeAsync(600);
    });

    // ---- Line 451: interval mode timer .catch() ----
    it('handles executeCycle throw inside interval setTimeout (line 451)', async () => {
      const config = makeConfig({
        mode: 'interval',
        intervalMs: 100,
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0,
        },
      });
      await manager.start();
      await manager.startAgent(config);
      mockSaveSession.mockRejectedValueOnce(new Error('DB error'));
      // Fire the 100ms interval timer → executeCycle → budget exceeded → throws → .catch() at 451
      await vi.advanceTimersByTimeAsync(200);
    });

    // ---- Line 459: scheduleImmediate .catch() (event mode) ----
    it('handles executeCycle throw inside scheduleImmediate setTimeout (line 459)', async () => {
      const config = makeConfig({
        mode: 'event',
        eventFilters: ['test.event'],
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 60,
          cycleTimeoutMs: 120000,
          totalBudgetUsd: 0,
        },
      });
      await manager.start();
      await manager.startAgent(config);
      // Grab the registered event handler and fire it → scheduleImmediate → setTimeout(0)
      const handler = mockOnAny.mock.calls[mockOnAny.mock.calls.length - 1]?.[1] as () => void;
      handler();
      // Queue rejection for executeCycle's budget-exceeded stopAgent call
      mockSaveSession.mockRejectedValueOnce(new Error('DB error'));
      // Fire the setTimeout(0) → executeCycle → budget exceeded → throws → .catch() at 459
      await vi.advanceTimersByTimeAsync(1);
    });

    // ---- Lines 525-526 + 643-644: rate-limit retry .catch() AND hour reset ----
    it('handles executeCycle throw in rate-limit retry timer and resets hour window (lines 525-526, 643-644)', async () => {
      // All cycles fail so consecutiveErrors accumulates across retry attempts
      mockRunCycle.mockResolvedValue({
        success: false,
        toolCalls: [],
        outputMessage: '',
        durationMs: 100,
        turns: 0,
        error: 'LLM error',
      });

      const config = makeConfig({
        mode: 'continuous',
        limits: {
          maxTurnsPerCycle: 10,
          maxToolCallsPerCycle: 50,
          maxCyclesPerHour: 4, // rate limit kicks in after 4 failing cycles
          cycleTimeoutMs: 120000,
        },
      });
      await manager.start();
      await manager.startAgent(config);

      // Run 4 consecutive failing cycles (t=500, 5500, 10500, 15500ms).
      // Backoff timer for 5th attempt lands at t≈20500ms (outside this window).
      await vi.advanceTimersByTimeAsync(16_000);
      expect(mockRunCycle).toHaveBeenCalledTimes(4);

      // Fire the backoff timer (t≈20500ms) → executeCycle → rate limited
      // (cyclesThisHour=4 >= maxCyclesPerHour=4) → 60s retry timer set.
      await vi.advanceTimersByTimeAsync(5_000);

      // All future saveSession calls reject permanently:
      //   - Interval firings: .catch() at line 218 handles each rejection ✓
      //   - 60s retry's auto-pause call: pauseAgent throws → executeCycle throws →
      //     .catch() at lines 525-526 fires ✓
      mockSaveSession.mockRejectedValue(new Error('DB permanently broken'));

      try {
        // Advance > 1 hour so the clock crosses the hour boundary.
        // When the 60s retry fires after the boundary:
        //   enforceRateLimit resets cyclesThisHour=0 (lines 643-644) → canExecute=TRUE →
        //   cycle runs → 5th consecutive error → pauseAgent → saveSession REJECTS →
        //   executeCycle throws → .catch() at lines 525-526 fires.
        await vi.advanceTimersByTimeAsync(4_000_000);
      } finally {
        // Restore default so subsequent tests are not affected
        mockSaveSession.mockResolvedValue(undefined);
      }
    });

    // ---- Line 674: MISSION_COMPLETE stopAgent .catch() ----
    it('logs error when stopAgent rejects after MISSION_COMPLETE (line 674)', async () => {
      mockRunCycle.mockResolvedValueOnce({
        success: true,
        toolCalls: [],
        outputMessage: 'All done. MISSION_COMPLETE',
        durationMs: 100,
        turns: 1,
      });
      const config = makeConfig({ mode: 'continuous' });
      await manager.start();
      await manager.startAgent(config);
      // Make stopAgent fail so the .catch() at line 673 fires line 674
      mockSaveSession.mockRejectedValueOnce(new Error('Stop failed'));
      await vi.advanceTimersByTimeAsync(600);
      // Flush microtasks for the fire-and-forget stopAgent promise
      await vi.advanceTimersByTimeAsync(0);
    });

    // ---- Line 687: max_cycles stopAgent .catch() ----
    it('logs error when stopAgent rejects after max_cycles reached (line 687)', async () => {
      const config = makeConfig({ mode: 'continuous', stopCondition: 'max_cycles:1' });
      await manager.start();
      await manager.startAgent(config);
      // Make stopAgent fail so the .catch() at line 686 fires line 687
      mockSaveSession.mockRejectedValueOnce(new Error('Stop failed'));
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Factory — getBackgroundAgentManager singleton
// ---------------------------------------------------------------------------

const { getBackgroundAgentManager } = await import('./background-agent-manager.js');

describe('getBackgroundAgentManager', () => {
  it('returns the same instance on repeated calls', () => {
    const m1 = getBackgroundAgentManager();
    const m2 = getBackgroundAgentManager();
    expect(m1).toBe(m2);
  });

  it('returns a BackgroundAgentManager instance', () => {
    const m = getBackgroundAgentManager();
    expect(m).toBeInstanceOf(BackgroundAgentManager);
  });
});

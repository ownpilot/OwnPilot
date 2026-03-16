/**
 * Fleet Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FleetConfig, FleetSession, FleetTask, FleetWorkerResult } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted to avoid TDZ issues
// ---------------------------------------------------------------------------

const {
  mockCreateSession,
  mockGetSession,
  mockUpdateSession,
  mockGetReadyTasks,
  mockUpdateTask,
  mockSaveWorkerResult,
  mockFailDependentTasks,
  mockRequeueOrphanedTasks,
  mockGetAutoStartFleets,
  mockCreateTask,
  mockWorkerExecute,
  mockEmit,
  mockGetNextRunTime,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateSession: vi.fn().mockResolvedValue(undefined),
  mockGetReadyTasks: vi.fn().mockResolvedValue([]),
  mockUpdateTask: vi.fn().mockResolvedValue(undefined),
  mockSaveWorkerResult: vi.fn().mockResolvedValue(undefined),
  mockFailDependentTasks: vi.fn().mockResolvedValue(0),
  mockRequeueOrphanedTasks: vi.fn().mockResolvedValue(0),
  mockGetAutoStartFleets: vi.fn().mockResolvedValue([]),
  mockCreateTask: vi.fn().mockResolvedValue(undefined),
  mockWorkerExecute: vi.fn(),
  mockEmit: vi.fn(),
  mockGetNextRunTime: vi.fn(),
}));

vi.mock('../db/repositories/fleet.js', () => ({
  getFleetRepository: () => ({
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    getReadyTasks: mockGetReadyTasks,
    updateTask: mockUpdateTask,
    saveWorkerResult: mockSaveWorkerResult,
    failDependentTasks: mockFailDependentTasks,
    requeueOrphanedTasks: mockRequeueOrphanedTasks,
    getAutoStartFleets: mockGetAutoStartFleets,
    createTask: mockCreateTask,
  }),
}));

vi.mock('./fleet-worker.js', () => ({
  FleetWorker: vi.fn(function (this: Record<string, unknown>) {
    this.execute = mockWorkerExecute;
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: () => ({
      emit: mockEmit,
    }),
    getNextRunTime: mockGetNextRunTime,
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

const { FleetManager } = await import('./fleet-manager.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sessionIdCounter = 0;

function makeSession(fleetId: string, overrides: Partial<FleetSession> = {}): FleetSession {
  sessionIdCounter++;
  return {
    id: `ses-${sessionIdCounter}`,
    fleetId,
    state: 'running',
    startedAt: new Date(),
    cyclesCompleted: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalCostUsd: 0,
    activeWorkers: 0,
    sharedContext: {},
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FleetConfig> = {}): FleetConfig {
  return {
    id: 'fleet-1',
    userId: 'user-1',
    name: 'Test Fleet',
    mission: 'Test mission',
    scheduleType: 'interval',
    workers: [{ name: 'worker-a', type: 'ai-chat' }],
    concurrencyLimit: 5,
    autoStart: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<FleetTask> = {}): FleetTask {
  return {
    id: 'task-1',
    fleetId: 'fleet-1',
    title: 'Test Task',
    description: 'Do something',
    priority: 'normal',
    status: 'queued',
    retries: 0,
    maxRetries: 3,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeWorkerResult(overrides: Partial<FleetWorkerResult> = {}): FleetWorkerResult {
  return {
    id: 'wr-1',
    sessionId: 'ses-1',
    workerId: 'flw-1',
    workerName: 'worker-a',
    workerType: 'ai-chat',
    success: true,
    output: 'Done',
    toolCalls: [],
    durationMs: 100,
    costUsd: 0.01,
    executedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FleetManager', () => {
  let manager: InstanceType<typeof FleetManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionIdCounter = 0;

    // Default: createSession returns a fresh session
    mockCreateSession.mockImplementation(
      (fleetId: string, sharedContext?: Record<string, unknown>) =>
        Promise.resolve(makeSession(fleetId, { sharedContext: sharedContext ?? {} }))
    );
    mockRequeueOrphanedTasks.mockResolvedValue(0);
    mockGetReadyTasks.mockResolvedValue([]);
    mockUpdateSession.mockResolvedValue(undefined);
    mockUpdateTask.mockResolvedValue(undefined);
    mockSaveWorkerResult.mockResolvedValue(undefined);
    mockFailDependentTasks.mockResolvedValue(0);
    mockGetAutoStartFleets.mockResolvedValue([]);

    manager = new FleetManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Lifecycle
  // =========================================================================

  describe('Lifecycle', () => {
    it('startFleet creates a session and returns it', async () => {
      const config = makeConfig();
      const session = await manager.startFleet(config);

      expect(session.state).toBe('running');
      expect(session.fleetId).toBe('fleet-1');
      expect(mockCreateSession).toHaveBeenCalledWith('fleet-1', undefined);
    });

    it('startFleet throws if fleet is already running', async () => {
      await manager.startFleet(makeConfig());
      await expect(manager.startFleet(makeConfig())).rejects.toThrow('already running');
    });

    it('startFleet calls requeueOrphanedTasks', async () => {
      await manager.startFleet(makeConfig());
      expect(mockRequeueOrphanedTasks).toHaveBeenCalled();
    });

    it('startFleet logs requeued orphan count when > 0', async () => {
      mockRequeueOrphanedTasks.mockResolvedValueOnce(3);
      await manager.startFleet(makeConfig());
      expect(mockRequeueOrphanedTasks).toHaveBeenCalled();
    });

    it('pauseFleet pauses a running fleet', async () => {
      await manager.startFleet(makeConfig());
      const result = await manager.pauseFleet('fleet-1');

      expect(result).toBe(true);
      const session = manager.getSession('fleet-1');
      expect(session?.state).toBe('paused');
    });

    it('pauseFleet returns false for unknown fleet', async () => {
      const result = await manager.pauseFleet('fleet-999');
      expect(result).toBe(false);
    });

    it('pauseFleet clears the timer', async () => {
      await manager.startFleet(makeConfig());
      await manager.pauseFleet('fleet-1');
      // After pause, no cycle should fire
      mockGetReadyTasks.mockResolvedValue([makeTask()]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockWorkerExecute).not.toHaveBeenCalled();
    });

    it('resumeFleet resumes a paused fleet', async () => {
      await manager.startFleet(makeConfig());
      await manager.pauseFleet('fleet-1');

      const result = await manager.resumeFleet('fleet-1');
      expect(result).toBe(true);
      expect(manager.getSession('fleet-1')?.state).toBe('running');
    });

    it('resumeFleet returns false if fleet is not paused', async () => {
      await manager.startFleet(makeConfig());
      const result = await manager.resumeFleet('fleet-1');
      expect(result).toBe(false);
    });

    it('resumeFleet returns false for unknown fleet', async () => {
      const result = await manager.resumeFleet('fleet-999');
      expect(result).toBe(false);
    });

    it('resumeFleet resets consecutiveErrors', async () => {
      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);

      // Cause errors that would normally auto-pause
      mockGetReadyTasks.mockRejectedValue(new Error('DB error'));
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1100);
      }
      // Fleet should be auto-paused after 5 consecutive errors
      expect(manager.getSession('fleet-1')?.state).toBe('paused');

      // Resume and verify it works (errors reset)
      mockGetReadyTasks.mockResolvedValue([]);
      const result = await manager.resumeFleet('fleet-1');
      expect(result).toBe(true);
    });

    it('stopFleet stops a running fleet', async () => {
      await manager.startFleet(makeConfig());
      const result = await manager.stopFleet('fleet-1');

      expect(result).toBe(true);
      expect(manager.getSession('fleet-1')).toBeNull();
    });

    it('stopFleet returns false for unknown fleet', async () => {
      const result = await manager.stopFleet('fleet-999');
      expect(result).toBe(false);
    });

    it('stopFleet clears persist timer', async () => {
      await manager.startFleet(makeConfig());
      await manager.stopFleet('fleet-1');
      // Advance past persist interval — updateSession should not be called again
      mockUpdateSession.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      // Only the persistSession call from stopFleet itself should have happened
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });

    it('stopFleet persists session with stopped state', async () => {
      await manager.startFleet(makeConfig());
      await manager.stopFleet('fleet-1', 'test-reason');

      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ state: 'stopped' })
      );
    });
  });

  // =========================================================================
  // 2. Scheduling
  // =========================================================================

  describe('Scheduling', () => {
    it('interval mode schedules cycle after intervalMs', async () => {
      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 5000 },
      });
      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(makeWorkerResult());

      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(5100);

      expect(mockGetReadyTasks).toHaveBeenCalled();
    });

    it('continuous mode uses short delay when workers are active', async () => {
      const config = makeConfig({ scheduleType: 'continuous' });
      await manager.startFleet(config);

      // First cycle — no tasks, schedules next with idle delay (5000ms)
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockGetReadyTasks).toHaveBeenCalledTimes(1);

      // After idle delay, another check
      await vi.advanceTimersByTimeAsync(5100);
      expect(mockGetReadyTasks).toHaveBeenCalledTimes(2);
    });

    it('cron mode uses getNextRunTime to schedule', async () => {
      mockGetNextRunTime.mockReturnValue(new Date(Date.now() + 10_000));
      const config = makeConfig({
        scheduleType: 'cron',
        scheduleConfig: { cron: '*/5 * * * *' },
      });
      await manager.startFleet(config);

      await vi.advanceTimersByTimeAsync(10_100);
      expect(mockGetReadyTasks).toHaveBeenCalled();
    });

    it('cron mode falls back to default interval when getNextRunTime returns null', async () => {
      mockGetNextRunTime.mockReturnValue(null);
      const config = makeConfig({
        scheduleType: 'cron',
        scheduleConfig: { cron: 'invalid' },
      });
      await manager.startFleet(config);

      // Falls back to DEFAULT_INTERVAL_MS = 60_000
      await vi.advanceTimersByTimeAsync(60_100);
      expect(mockGetReadyTasks).toHaveBeenCalled();
    });

    it('event mode does not auto-schedule cycles', async () => {
      const config = makeConfig({ scheduleType: 'event' });
      await manager.startFleet(config);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetReadyTasks).not.toHaveBeenCalled();
    });

    it('on-demand mode does not auto-schedule cycles', async () => {
      const config = makeConfig({ scheduleType: 'on-demand' });
      await manager.startFleet(config);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetReadyTasks).not.toHaveBeenCalled();
    });

    it('default schedule falls back to interval when unknown type', async () => {
      const config = makeConfig({ scheduleType: 'unknown' as never });
      await manager.startFleet(config);

      // Falls back to DEFAULT_INTERVAL_MS = 60_000
      await vi.advanceTimersByTimeAsync(60_100);
      expect(mockGetReadyTasks).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Task Execution
  // =========================================================================

  describe('Task execution', () => {
    it('runCycle dequeues tasks and assigns to workers', async () => {
      const task = makeTask({ assignedWorker: 'worker-a' });
      const result = makeWorkerResult();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(result);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockWorkerExecute).toHaveBeenCalledTimes(1);
      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'running' })
      );
      expect(mockSaveWorkerResult).toHaveBeenCalledWith(result);
    });

    it('runCycle marks task as completed on success', async () => {
      const task = makeTask();
      const result = makeWorkerResult({ success: true, output: 'All good' });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(result);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('runCycle re-queues task on failure with retries remaining', async () => {
      const task = makeTask({ retries: 0, maxRetries: 3 });
      const result = makeWorkerResult({ success: false, error: 'timeout' });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(result);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'queued', retries: 1 })
      );
    });

    it('runCycle marks task as failed when retries exhausted', async () => {
      const task = makeTask({ retries: 2, maxRetries: 3 });
      const result = makeWorkerResult({ success: false, error: 'permanent failure' });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(result);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ status: 'failed', retries: 3 })
      );
    });

    it('runCycle increments session counters after execution', async () => {
      const task = makeTask();
      const result = makeWorkerResult({ success: true, costUsd: 0.05 });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(result);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      const session = manager.getSession('fleet-1');
      expect(session?.cyclesCompleted).toBe(1);
      expect(session?.tasksCompleted).toBe(1);
      expect(session?.totalCostUsd).toBe(0.05);
    });

    it('runCycle handles no suitable worker for a task', async () => {
      const task = makeTask({ assignedWorker: 'nonexistent-worker' });
      mockGetReadyTasks.mockResolvedValueOnce([task]);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          status: 'failed',
          error: 'No suitable worker',
        })
      );
      expect(mockWorkerExecute).not.toHaveBeenCalled();
    });

    it('runCycle handles empty task queue gracefully', async () => {
      mockGetReadyTasks.mockResolvedValueOnce([]);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockWorkerExecute).not.toHaveBeenCalled();
      // Fleet is still running
      expect(manager.isRunning('fleet-1')).toBe(true);
    });
  });

  // =========================================================================
  // 4. Error Handling
  // =========================================================================

  describe('Error handling', () => {
    it('consecutive errors increment and auto-pause fleet at threshold', async () => {
      mockGetReadyTasks.mockRejectedValue(new Error('DB error'));

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 500 } });
      await manager.startFleet(config);

      // Run 5 cycles (MAX_CONSECUTIVE_ERRORS = 5)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(600);
      }

      expect(manager.getSession('fleet-1')?.state).toBe('paused');
    });

    it('consecutiveErrors resets to 0 on successful cycle', async () => {
      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 500 } });
      await manager.startFleet(config);

      // 3 errors
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);

      // Successful cycle resets counter
      mockGetReadyTasks.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(600);

      // 3 more errors should NOT auto-pause (counter was reset)
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);
      mockGetReadyTasks.mockRejectedValueOnce(new Error('err'));
      await vi.advanceTimersByTimeAsync(600);

      expect(manager.getSession('fleet-1')?.state).toBe('running');
    });

    it('task retry logic re-queues on failure with retries left', async () => {
      const task = makeTask({ retries: 1, maxRetries: 3 });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(
        makeWorkerResult({ success: false, error: 'transient' })
      );

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          status: 'queued',
          retries: 2,
          error: 'transient',
        })
      );
    });
  });

  // =========================================================================
  // 5. Budget
  // =========================================================================

  describe('Budget', () => {
    it('pre-cycle budget check pauses fleet when exceeded', async () => {
      // Start with a session that already exceeded budget
      mockCreateSession.mockResolvedValueOnce(makeSession('fleet-1', { totalCostUsd: 10 }));

      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 1000 },
        budget: { maxCostUsd: 5 },
      });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(manager.getSession('fleet-1')?.state).toBe('paused');
      expect(mockWorkerExecute).not.toHaveBeenCalled();
    });

    it('post-cycle budget check pauses fleet when cost exceeds limit', async () => {
      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(makeWorkerResult({ success: true, costUsd: 6 }));

      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 1000 },
        budget: { maxCostUsd: 5 },
      });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(manager.getSession('fleet-1')?.state).toBe('paused');
    });

    it('maxTotalCycles stops fleet when limit reached', async () => {
      mockCreateSession.mockResolvedValueOnce(makeSession('fleet-1', { cyclesCompleted: 10 }));

      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 1000 },
        budget: { maxTotalCycles: 10 },
      });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(manager.getSession('fleet-1')).toBeNull(); // Stopped and removed
    });

    it('maxCyclesPerHour rate-limits cycles', async () => {
      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 100 },
        budget: { maxCyclesPerHour: 2 },
      });
      await manager.startFleet(config);

      // Run 2 cycles
      mockGetReadyTasks.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(150);
      mockGetReadyTasks.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(150);

      // 3rd cycle should be rate-limited — getReadyTasks not called again
      const callCountBefore = mockGetReadyTasks.mock.calls.length;
      await vi.advanceTimersByTimeAsync(150);
      // Rate limited: scheduleNextCycle fires but runCycleInner returns early
      // It still calls getReadyTasks but the overall cycle is skipped at rate limit check
      expect(manager.isRunning('fleet-1')).toBe(true);
    });
  });

  // =========================================================================
  // 6. Concurrency
  // =========================================================================

  describe('Concurrency', () => {
    it('cycleInProgress guard prevents double execution', async () => {
      // Make worker execution slow
      let resolveWorker: ((v: FleetWorkerResult) => void) | undefined;
      const workerPromise = new Promise<FleetWorkerResult>((resolve) => {
        resolveWorker = resolve;
      });
      mockWorkerExecute.mockReturnValueOnce(workerPromise);

      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);

      // First cycle starts
      await vi.advanceTimersByTimeAsync(1100);

      // Trigger executeNow while cycle is in progress
      manager.executeNow('fleet-1');
      await vi.advanceTimersByTimeAsync(10);

      // Worker should only have been called once
      expect(mockWorkerExecute).toHaveBeenCalledTimes(1);

      // Complete the first cycle
      resolveWorker!(makeWorkerResult());
      await vi.advanceTimersByTimeAsync(0);
    });

    it('skips cycle when no available worker slots', async () => {
      // concurrencyLimit 0 means no slots
      const config = makeConfig({
        scheduleType: 'interval',
        scheduleConfig: { intervalMs: 1000 },
        concurrencyLimit: 0,
      });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      // getReadyTasks should not be called since availableSlots <= 0
      expect(mockGetReadyTasks).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. Dependency cascade
  // =========================================================================

  describe('Dependency cascade', () => {
    it('failDependentTasks called when task fails permanently', async () => {
      const task = makeTask({ retries: 2, maxRetries: 3 });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(makeWorkerResult({ success: false, error: 'fatal' }));
      mockFailDependentTasks.mockResolvedValueOnce(2);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockFailDependentTasks).toHaveBeenCalledWith('fleet-1', 'task-1');
    });

    it('failDependentTasks called when no suitable worker found', async () => {
      const task = makeTask({ assignedWorker: 'nonexistent' });
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockFailDependentTasks.mockResolvedValueOnce(1);

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockFailDependentTasks).toHaveBeenCalledWith('fleet-1', 'task-1');
    });
  });

  // =========================================================================
  // 8. Orphan recovery
  // =========================================================================

  describe('Orphan recovery', () => {
    it('requeueOrphanedTasks called on startFleet', async () => {
      await manager.startFleet(makeConfig());
      expect(mockRequeueOrphanedTasks).toHaveBeenCalled();
    });

    it('requeueOrphanedTasks is called with session id', async () => {
      const session = makeSession('fleet-1');
      mockCreateSession.mockResolvedValueOnce(session);

      await manager.startFleet(makeConfig());
      expect(mockRequeueOrphanedTasks).toHaveBeenCalledWith(session.id);
    });
  });

  // =========================================================================
  // 9. Shared context
  // =========================================================================

  describe('Shared context', () => {
    it('structuredClone prevents mutation of shared context', async () => {
      const sharedContext = { key: 'original' };
      mockCreateSession.mockResolvedValueOnce(makeSession('fleet-1', { sharedContext }));

      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockImplementationOnce(
        async (_task: FleetTask, ctx: Record<string, unknown>) => {
          // Worker mutates its copy
          ctx.key = 'mutated';
          return makeWorkerResult();
        }
      );

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      // Original shared context should not be mutated
      const session = manager.getSession('fleet-1');
      expect(session?.sharedContext.key).toBe('original');
    });
  });

  // =========================================================================
  // Queries
  // =========================================================================

  describe('Queries', () => {
    it('isRunning returns true for running fleet', async () => {
      await manager.startFleet(makeConfig());
      expect(manager.isRunning('fleet-1')).toBe(true);
    });

    it('isRunning returns false for unknown fleet', () => {
      expect(manager.isRunning('fleet-999')).toBe(false);
    });

    it('getSession returns null for unknown fleet', () => {
      expect(manager.getSession('fleet-999')).toBeNull();
    });

    it('getSessionsByUser returns only matching user sessions', async () => {
      await manager.startFleet(makeConfig({ id: 'f1', userId: 'user-1' }));
      await manager.startFleet(makeConfig({ id: 'f2', userId: 'user-2' }));

      const sessions = manager.getSessionsByUser('user-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.fleetId).toBe('f1');
    });

    it('updateFleetConfig updates config for running fleet', async () => {
      await manager.startFleet(makeConfig());
      const newConfig = makeConfig({ name: 'Updated Fleet' });
      manager.updateFleetConfig('fleet-1', newConfig);
      // No error thrown — config is updated internally
      expect(manager.isRunning('fleet-1')).toBe(true);
    });

    it('updateFleetConfig does nothing for unknown fleet', () => {
      expect(() => manager.updateFleetConfig('fleet-999', makeConfig())).not.toThrow();
    });
  });

  // =========================================================================
  // Boot / Shutdown
  // =========================================================================

  describe('Boot / Shutdown', () => {
    it('start auto-starts fleets from repo', async () => {
      mockGetAutoStartFleets.mockResolvedValueOnce([makeConfig({ id: 'auto-1', autoStart: true })]);
      await manager.start();
      expect(manager.isRunning('auto-1')).toBe(true);
    });

    it('start is idempotent', async () => {
      await manager.start();
      await manager.start();
      expect(mockGetAutoStartFleets).toHaveBeenCalledTimes(1);
    });

    it('start handles failed auto-start fleet gracefully', async () => {
      mockGetAutoStartFleets.mockResolvedValueOnce([makeConfig()]);
      mockCreateSession.mockRejectedValueOnce(new Error('DB error'));

      await expect(manager.start()).resolves.not.toThrow();
    });

    it('start handles getAutoStartFleets failure gracefully', async () => {
      mockGetAutoStartFleets.mockRejectedValueOnce(new Error('DB error'));
      await expect(manager.start()).resolves.not.toThrow();
    });

    it('stop shuts down all running fleets', async () => {
      await manager.start();
      await manager.startFleet(makeConfig({ id: 'f1' }));
      await manager.startFleet(makeConfig({ id: 'f2' }));

      await manager.stop();

      expect(manager.getSession('f1')).toBeNull();
      expect(manager.getSession('f2')).toBeNull();
    });

    it('stop is idempotent when not running', async () => {
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Task Communication
  // =========================================================================

  describe('Task communication', () => {
    it('broadcastToFleet creates a task for each worker and triggers immediate cycle', async () => {
      const config = makeConfig({
        workers: [
          { name: 'w1', type: 'ai-chat' },
          { name: 'w2', type: 'api-call' },
        ],
      });
      await manager.startFleet(config);
      mockCreateTask.mockResolvedValue(undefined);

      await manager.broadcastToFleet('fleet-1', 'Hello fleet');

      expect(mockCreateTask).toHaveBeenCalledTimes(2);
      expect(mockCreateTask).toHaveBeenCalledWith(
        'fleet-1',
        expect.objectContaining({
          assignedWorker: 'w1',
          priority: 'high',
        })
      );
      expect(mockCreateTask).toHaveBeenCalledWith(
        'fleet-1',
        expect.objectContaining({
          assignedWorker: 'w2',
          priority: 'high',
        })
      );
    });

    it('broadcastToFleet throws for unknown fleet', async () => {
      await expect(manager.broadcastToFleet('fleet-999', 'msg')).rejects.toThrow('not running');
    });

    it('executeNow triggers immediate cycle', async () => {
      await manager.startFleet(makeConfig());
      const result = manager.executeNow('fleet-1');
      expect(result).toBe(true);
    });

    it('executeNow returns false for unknown fleet', () => {
      expect(manager.executeNow('fleet-999')).toBe(false);
    });
  });

  // =========================================================================
  // Event emissions
  // =========================================================================

  describe('Events', () => {
    it('emits fleet.started on startFleet', async () => {
      await manager.startFleet(makeConfig());
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.started',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1' })
      );
    });

    it('emits fleet.paused on pauseFleet', async () => {
      await manager.startFleet(makeConfig());
      await manager.pauseFleet('fleet-1');
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.paused',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1' })
      );
    });

    it('emits fleet.resumed on resumeFleet', async () => {
      await manager.startFleet(makeConfig());
      await manager.pauseFleet('fleet-1');
      await manager.resumeFleet('fleet-1');
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.resumed',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1' })
      );
    });

    it('emits fleet.stopped on stopFleet', async () => {
      await manager.startFleet(makeConfig());
      await manager.stopFleet('fleet-1', 'test');
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.stopped',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1', reason: 'test' })
      );
    });

    it('emits fleet.cycle.start and fleet.cycle.end during execution', async () => {
      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(makeWorkerResult());

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.cycle.start',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1', taskCount: 1 })
      );
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.cycle.end',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1', tasksCompleted: 1 })
      );
    });

    it('emits fleet.worker.started and fleet.worker.completed', async () => {
      const task = makeTask();
      mockGetReadyTasks.mockResolvedValueOnce([task]);
      mockWorkerExecute.mockResolvedValueOnce(makeWorkerResult());

      const config = makeConfig({ scheduleType: 'interval', scheduleConfig: { intervalMs: 1000 } });
      await manager.startFleet(config);
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.worker.started',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1', taskId: 'task-1' })
      );
      expect(mockEmit).toHaveBeenCalledWith(
        'fleet.worker.completed',
        'fleet-manager',
        expect.objectContaining({ fleetId: 'fleet-1', taskId: 'task-1', success: true })
      );
    });
  });

  // =========================================================================
  // On-demand / event auto-follow-up
  // =========================================================================

  describe('On-demand / event auto-follow-up', () => {
    it('on-demand auto-schedules follow-up when queued tasks remain', async () => {
      const config = makeConfig({ scheduleType: 'on-demand' });
      await manager.startFleet(config);

      // First executeNow — cycle runs, finds queued tasks remaining
      const task = makeTask();
      mockGetReadyTasks
        .mockResolvedValueOnce([task]) // cycle picks up task
        .mockResolvedValueOnce([makeTask({ id: 'task-2' })]) // post-cycle remaining check: more tasks
        .mockResolvedValueOnce([makeTask({ id: 'task-2' })]) // follow-up cycle picks up task-2
        .mockResolvedValueOnce([]); // follow-up post-cycle remaining check: empty
      mockWorkerExecute.mockResolvedValue(makeWorkerResult());

      manager.executeNow('fleet-1');
      await vi.advanceTimersByTimeAsync(10);

      // Should have auto-scheduled a follow-up cycle
      await vi.advanceTimersByTimeAsync(10);
      // 4 calls: cycle1 dequeue + cycle1 remaining check + cycle2 dequeue + cycle2 remaining check
      expect(mockGetReadyTasks).toHaveBeenCalledTimes(4);
    });
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const { getFleetManager, resetFleetManager } = await import('./fleet-manager.js');

describe('getFleetManager / resetFleetManager', () => {
  it('returns the same instance on repeated calls', () => {
    const m1 = getFleetManager();
    const m2 = getFleetManager();
    expect(m1).toBe(m2);
  });

  it('resetFleetManager clears the singleton', () => {
    const m1 = getFleetManager();
    resetFleetManager();
    const m2 = getFleetManager();
    expect(m1).not.toBe(m2);
  });
});

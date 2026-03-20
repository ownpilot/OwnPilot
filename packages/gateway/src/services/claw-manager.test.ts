/**
 * Claw Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClawConfig, ClawSession, ClawCycleResult } from '@ownpilot/core';

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

vi.mock('./claw-runner.js', () => ({
  ClawRunner: vi.fn().mockImplementation(function () {
    return {
      runCycle: mockRunCycle,
      updateConfig: vi.fn(),
    };
  }),
}));

vi.mock('../db/repositories/claws.js', () => ({
  getClawsRepository: mockGetClawsRepo,
}));

vi.mock('../workspace/file-workspace.js', () => ({
  getOrCreateSessionWorkspace: mockGetOrCreateSessionWorkspace,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: (...args: unknown[]) => mockGetEventSystem(...args),
    getErrorMessage: (e: unknown) => String(e instanceof Error ? e.message : e),
    generateId: vi.fn().mockReturnValue('gen-id'),
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

const { ClawManager } = await import('./claw-manager.js');

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
  });
});

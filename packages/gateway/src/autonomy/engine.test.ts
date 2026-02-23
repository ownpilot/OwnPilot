/**
 * Tests for the Autonomy Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutonomyEngine, stopAutonomyEngine } from './engine.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('./context.js', () => ({
  gatherPulseContext: vi.fn().mockResolvedValue({
    userId: 'test-user',
    gatheredAt: new Date(),
    timeContext: { hour: 10, dayOfWeek: 1, isWeekend: false },
    goals: { active: [], stale: [], upcoming: [] },
    memories: { total: 0, recentCount: 0, avgImportance: 0.5 },
    activity: { daysSinceLastActivity: 0, hasRecentActivity: true },
    systemHealth: { pendingApprovals: 0, triggerErrors: 0 },
  }),
}));

vi.mock('./evaluator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./evaluator.js')>();
  return {
    ...actual,
    evaluatePulseContext: vi.fn().mockReturnValue({
      shouldCallLLM: false,
      signals: [],
      urgencyScore: 0,
    }),
  };
});

vi.mock('./executor.js', () => ({
  executePulseActions: vi.fn().mockResolvedValue({ results: [], updatedActionTimes: {} }),
  DEFAULT_ACTION_COOLDOWNS: {
    create_memory: 30,
    update_goal_progress: 60,
    send_notification: 15,
    run_memory_cleanup: 360,
  },
}));

vi.mock('./reporter.js', () => ({
  reportPulseResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/repositories/settings.js', () => ({
  settingsRepo: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../db/repositories/autonomy-log.js', () => ({
  createAutonomyLogRepo: () => ({
    insert: vi.fn().mockResolvedValue('log-1'),
    getRecent: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({
      totalPulses: 0,
      llmCallRate: 0,
      avgDurationMs: 0,
      actionsExecuted: 0,
    }),
    cleanup: vi.fn().mockResolvedValue(0),
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    generateId: (_prefix?: string) => 'test-id',
  };
});

// ============================================================================
// Tests
// ============================================================================

describe('AutonomyEngine', () => {
  let engine: AutonomyEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    stopAutonomyEngine();
    engine = new AutonomyEngine({
      userId: 'test-user',
      minIntervalMs: 1000,
      maxIntervalMs: 5000,
    });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ============================================================================
  // Lifecycle
  // ============================================================================

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(engine.isRunning()).toBe(false);
      engine.start();
      expect(engine.isRunning()).toBe(true);
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });

    it('start is idempotent', () => {
      engine.start();
      engine.start();
      expect(engine.isRunning()).toBe(true);
    });

    it('stop is idempotent', () => {
      engine.start();
      engine.stop();
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });

    it('does not start if disabled', () => {
      const disabled = new AutonomyEngine({ userId: 'u1', enabled: false });
      disabled.start();
      expect(disabled.isRunning()).toBe(false);
    });
  });

  // ============================================================================
  // runPulse
  // ============================================================================

  describe('runPulse', () => {
    it('returns a PulseResult', async () => {
      const result = await engine.runPulse('test-user', true);

      expect(result.pulseId).toBe('test-id');
      expect(result.userId).toBe('test-user');
      expect(result.manual).toBe(true);
      expect(result.signalsFound).toBe(0);
      expect(result.llmCalled).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('marks manual flag correctly', async () => {
      const manual = await engine.runPulse('test-user', true);
      expect(manual.manual).toBe(true);

      const auto = await engine.runPulse('test-user', false);
      expect(auto.manual).toBe(false);
    });

    it('handles errors without crashing', async () => {
      const { gatherPulseContext } = await import('./context.js');
      (gatherPulseContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Gather failed')
      );

      const result = await engine.runPulse('test-user', true);

      expect(result.error).toContain('Gather failed');
      expect(result.signalsFound).toBe(0);
    });
  });

  // ============================================================================
  // Settings
  // ============================================================================

  describe('settings', () => {
    it('getStatus returns current config', () => {
      const status = engine.getStatus();

      expect(status.running).toBe(false);
      expect(status.enabled).toBe(true);
      expect(status.config.userId).toBe('test-user');
      expect(status.config.minIntervalMs).toBe(1000);
      expect(status.config.maxIntervalMs).toBe(5000);
    });

    it('updateSettings changes config', () => {
      engine.updateSettings({ maxActions: 3 });
      const status = engine.getStatus();
      expect(status.config.maxActions).toBe(3);
    });

    it('updateSettings stops engine when disabled', () => {
      engine.start();
      expect(engine.isRunning()).toBe(true);

      engine.updateSettings({ enabled: false });
      expect(engine.isRunning()).toBe(false);
    });

    it('updateSettings starts engine when enabled', () => {
      engine.updateSettings({ enabled: true });
      expect(engine.isRunning()).toBe(true);
      engine.stop();
    });

    it('setBroadcaster sets the broadcaster', () => {
      const broadcaster = vi.fn();
      engine.setBroadcaster(broadcaster);
      // No assertion on internal state — tested via runPulse + reporter mock
    });
  });

  // ============================================================================
  // Execution lock
  // ============================================================================

  describe('execution lock', () => {
    it('prevents concurrent execution', async () => {
      const { gatherPulseContext } = await import('./context.js');

      // Make gatherPulseContext slow so we can test concurrency
      let resolveGather!: () => void;
      (gatherPulseContext as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => new Promise<unknown>((resolve) => {
          resolveGather = () => resolve({
            userId: 'test-user',
            gatheredAt: new Date(),
            timeContext: { hour: 10, dayOfWeek: 1, isWeekend: false },
            goals: { active: [], stale: [], upcoming: [] },
            memories: { total: 0, recentCount: 0, avgImportance: 0.5 },
            activity: { daysSinceLastActivity: 0, hasRecentActivity: true },
            systemHealth: { pendingApprovals: 0, triggerErrors: 0 },
          });
        })
      );

      // Start first pulse (will block on gatherPulseContext)
      const first = engine.runPulse('test-user', true);

      // Second pulse should return immediately with error
      const second = await engine.runPulse('test-user', true);
      expect(second.error).toBe('Pulse already in progress');
      expect(second.durationMs).toBe(0);

      // Let the first one finish
      resolveGather();
      const firstResult = await first;
      expect(firstResult.error).toBeUndefined();
    });

    it('getStatus exposes activePulse as null when idle', () => {
      const status = engine.getStatus();
      expect(status.activePulse).toBeNull();
    });

    it('broadcasts stage events through broadcaster', async () => {
      const broadcaster = vi.fn();
      engine.setBroadcaster(broadcaster);

      await engine.runPulse('test-user', true);

      // Should have received: started, gathering, evaluating, executing, reporting, completed
      const activityCalls = broadcaster.mock.calls.filter(
        ([event]: [string]) => event === 'pulse:activity'
      );
      expect(activityCalls.length).toBeGreaterThanOrEqual(5);

      // First event should be 'started'
      expect(activityCalls[0][1].status).toBe('started');
      expect(activityCalls[0][1].stage).toBe('starting');

      // Last event should be 'completed'
      const lastCall = activityCalls[activityCalls.length - 1];
      expect(lastCall[1].status).toBe('completed');
      expect(lastCall[1].stage).toBe('done');
      expect(lastCall[1].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('releases lock on error', async () => {
      const { gatherPulseContext } = await import('./context.js');
      (gatherPulseContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Gather failed')
      );

      const errorResult = await engine.runPulse('test-user', true);
      expect(errorResult.error).toContain('Gather failed');

      // Lock should be released — next pulse succeeds
      const successResult = await engine.runPulse('test-user', true);
      expect(successResult.error).toBeUndefined();
    });

    it('broadcasts error event on failure', async () => {
      const broadcaster = vi.fn();
      engine.setBroadcaster(broadcaster);

      const { gatherPulseContext } = await import('./context.js');
      (gatherPulseContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Boom')
      );

      await engine.runPulse('test-user', true);

      const errorCalls = broadcaster.mock.calls.filter(
        ([event, data]: [string, Record<string, unknown>]) =>
          event === 'pulse:activity' && data.status === 'error'
      );
      expect(errorCalls.length).toBe(1);
      expect(errorCalls[0][1].error).toContain('Boom');
    });
  });

  // ============================================================================
  // Quiet hours
  // ============================================================================

  describe('quiet hours', () => {
    it('getStatus includes quiet hours', () => {
      const status = engine.getStatus();
      expect(status.config.quietHoursStart).toBeDefined();
      expect(status.config.quietHoursEnd).toBeDefined();
    });
  });

  // ============================================================================
  // getRecentLogs / getStats
  // ============================================================================

  describe('logs and stats', () => {
    it('getRecentLogs returns empty array', async () => {
      const logs = await engine.getRecentLogs('test-user');
      expect(logs).toEqual([]);
    });

    it('getStats returns zero stats', async () => {
      const stats = await engine.getStats('test-user');
      expect(stats.totalPulses).toBe(0);
      expect(stats.llmCallRate).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.actionsExecuted).toBe(0);
    });
  });
});

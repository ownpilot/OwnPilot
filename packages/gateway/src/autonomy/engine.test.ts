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
  executePulseActions: vi.fn().mockResolvedValue([]),
}));

vi.mock('./reporter.js', () => ({
  reportPulseResult: vi.fn().mockResolvedValue(undefined),
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

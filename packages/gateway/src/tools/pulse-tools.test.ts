/**
 * Pulse Tools Tests
 *
 * Tests the executePulseTool function and PULSE_TOOLS definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEngine = {
  getStatus: vi.fn(),
  runPulse: vi.fn(),
  updateSettings: vi.fn(),
  getRecentLogs: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../autonomy/engine.js', () => ({
  getAutonomyEngine: () => mockEngine,
}));

import { PULSE_TOOLS, executePulseTool } from './pulse-tools.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pulse Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // PULSE_TOOLS definitions
  // ========================================================================

  describe('PULSE_TOOLS', () => {
    it('exports 4 tool definitions', () => {
      expect(PULSE_TOOLS).toHaveLength(4);
    });

    it('all tools have required fields', () => {
      for (const tool of PULSE_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Automation');
      }
    });

    it('contains expected tool names', () => {
      const names = PULSE_TOOLS.map((t) => t.name);
      expect(names).toContain('get_pulse_status');
      expect(names).toContain('run_pulse_now');
      expect(names).toContain('update_pulse_settings');
      expect(names).toContain('get_pulse_history');
    });

    it('all tools have workflowUsable set to false', () => {
      for (const tool of PULSE_TOOLS) {
        expect(tool.workflowUsable).toBe(false);
      }
    });
  });

  // ========================================================================
  // get_pulse_status
  // ========================================================================

  describe('get_pulse_status', () => {
    it('returns engine status without last pulse', async () => {
      mockEngine.getStatus.mockReturnValue({
        running: true,
        enabled: true,
        config: {
          minIntervalMs: 300_000,
          maxIntervalMs: 900_000,
          maxActions: 5,
          quietHoursStart: 22,
          quietHoursEnd: 7,
        },
        lastPulse: null,
      });

      const result = await executePulseTool('get_pulse_status', {});

      expect(result.success).toBe(true);
      const status = result.result as Record<string, unknown>;
      expect(status.running).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.minIntervalMinutes).toBe(5);
      expect(status.maxIntervalMinutes).toBe(15);
      expect(status.maxActions).toBe(5);
      expect(status.quietHours).toBe('22:00 - 7:00');
      expect(status.lastPulse).toBeNull();
    });

    it('returns engine status with last pulse', async () => {
      const pulsedAt = new Date('2026-02-24T10:00:00Z');
      mockEngine.getStatus.mockReturnValue({
        running: true,
        enabled: true,
        config: {
          minIntervalMs: 300_000,
          maxIntervalMs: 900_000,
          maxActions: 5,
          quietHoursStart: 22,
          quietHoursEnd: 7,
        },
        lastPulse: {
          pulsedAt,
          signalsFound: 3,
          urgencyScore: 0.75,
        },
      });

      const result = await executePulseTool('get_pulse_status', {});

      expect(result.success).toBe(true);
      const status = result.result as Record<string, unknown>;
      const lastPulse = status.lastPulse as Record<string, unknown>;
      expect(lastPulse).not.toBeNull();
      expect(lastPulse.pulsedAt).toBe(pulsedAt.toISOString());
      expect(lastPulse.signalsFound).toBe(3);
      expect(lastPulse.urgencyScore).toBe(0.75);
    });
  });

  // ========================================================================
  // run_pulse_now
  // ========================================================================

  describe('run_pulse_now', () => {
    it('runs a pulse and returns formatted result', async () => {
      mockEngine.runPulse.mockResolvedValue({
        pulseId: 'pulse-123',
        signalsFound: 2,
        llmCalled: true,
        actionsExecuted: [{ type: 'notify' }, { type: 'memorize' }],
        reportMessage: 'Pulse completed',
        urgencyScore: 0.6,
        durationMs: 1500,
        error: null,
      });

      const result = await executePulseTool('run_pulse_now', {}, 'user-1');

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.pulseId).toBe('pulse-123');
      expect(data.signalsFound).toBe(2);
      expect(data.llmCalled).toBe(true);
      expect(data.actionsExecuted).toBe(2);
      expect(data.reportMessage).toBe('Pulse completed');
      expect(data.urgencyScore).toBe(0.6);
      expect(data.durationMs).toBe(1500);
      expect(data.error).toBeNull();
      expect(mockEngine.runPulse).toHaveBeenCalledWith('user-1', true);
    });

    it('uses default userId when not provided', async () => {
      mockEngine.runPulse.mockResolvedValue({
        pulseId: 'pulse-456',
        signalsFound: 0,
        llmCalled: false,
        actionsExecuted: [],
        reportMessage: '',
        urgencyScore: 0,
        durationMs: 100,
        error: null,
      });

      await executePulseTool('run_pulse_now', {});

      expect(mockEngine.runPulse).toHaveBeenCalledWith('default', true);
    });

    it('returns error when pulse throws', async () => {
      mockEngine.runPulse.mockRejectedValue(new Error('Engine crashed'));

      const result = await executePulseTool('run_pulse_now', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Engine crashed');
    });
  });

  // ========================================================================
  // update_pulse_settings
  // ========================================================================

  describe('update_pulse_settings', () => {
    it('updates settings and returns new status', async () => {
      mockEngine.updateSettings.mockImplementation(() => {});
      mockEngine.getStatus.mockReturnValue({
        running: false,
        enabled: false,
        config: {
          minIntervalMs: 600_000,
          maxIntervalMs: 1_800_000,
          maxActions: 3,
          quietHoursStart: 23,
          quietHoursEnd: 8,
        },
      });

      const result = await executePulseTool('update_pulse_settings', {
        enabled: false,
        min_interval_minutes: 10,
        max_interval_minutes: 30,
        max_actions: 3,
        quiet_hours_start: 23,
        quiet_hours_end: 8,
      });

      expect(result.success).toBe(true);
      expect(mockEngine.updateSettings).toHaveBeenCalledWith({
        enabled: false,
        minIntervalMs: 600_000,
        maxIntervalMs: 1_800_000,
        maxActions: 3,
        quietHoursStart: 23,
        quietHoursEnd: 8,
      });

      const data = result.result as Record<string, unknown>;
      expect(data.message).toBe('Pulse settings updated.');
      expect(data.running).toBe(false);
      expect(data.enabled).toBe(false);
      expect(data.minIntervalMinutes).toBe(10);
      expect(data.maxIntervalMinutes).toBe(30);
    });

    it('handles partial settings update', async () => {
      mockEngine.updateSettings.mockImplementation(() => {});
      mockEngine.getStatus.mockReturnValue({
        running: true,
        enabled: true,
        config: {
          minIntervalMs: 300_000,
          maxIntervalMs: 900_000,
          maxActions: 5,
          quietHoursStart: 22,
          quietHoursEnd: 7,
        },
      });

      const result = await executePulseTool('update_pulse_settings', {
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockEngine.updateSettings).toHaveBeenCalledWith({
        enabled: true,
        minIntervalMs: undefined,
        maxIntervalMs: undefined,
        maxActions: undefined,
        quietHoursStart: undefined,
        quietHoursEnd: undefined,
      });
    });

    it('returns error when updateSettings throws', async () => {
      mockEngine.updateSettings.mockImplementation(() => {
        throw new Error('Invalid interval range');
      });

      const result = await executePulseTool('update_pulse_settings', {
        min_interval_minutes: -5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid interval range');
    });
  });

  // ========================================================================
  // get_pulse_history
  // ========================================================================

  describe('get_pulse_history', () => {
    it('returns formatted logs and stats', async () => {
      const pulsedAt = new Date('2026-02-24T10:00:00Z');
      mockEngine.getRecentLogs.mockResolvedValue([
        {
          id: 'log-1',
          pulsedAt,
          durationMs: 500,
          signalsFound: 2,
          llmCalled: true,
          actionsCount: 1,
          reportMsg: 'Done',
          error: null,
          manual: false,
        },
      ]);
      mockEngine.getStats.mockResolvedValue({
        totalPulses: 100,
        llmCallRate: 0.45,
        avgDurationMs: 750.5,
        actionsExecuted: 200,
      });

      const result = await executePulseTool('get_pulse_history', { limit: 5 }, 'user-1');

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      const stats = data.stats as Record<string, unknown>;
      expect(stats.totalPulses).toBe(100);
      expect(stats.llmCallRate).toBe('45.0%');
      expect(stats.avgDurationMs).toBe(751);
      expect(stats.actionsExecuted).toBe(200);

      const logs = data.recentLogs as Record<string, unknown>[];
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('log-1');
      expect(logs[0].pulsedAt).toBe(pulsedAt.toISOString());
      expect(logs[0].llmCalled).toBe(true);
      expect(logs[0].manual).toBe(false);

      expect(mockEngine.getRecentLogs).toHaveBeenCalledWith('user-1', 5);
      expect(mockEngine.getStats).toHaveBeenCalledWith('user-1');
    });

    it('clamps limit to valid range (min 1, max 50)', async () => {
      mockEngine.getRecentLogs.mockResolvedValue([]);
      mockEngine.getStats.mockResolvedValue({
        totalPulses: 0,
        llmCallRate: 0,
        avgDurationMs: 0,
        actionsExecuted: 0,
      });

      // Test with limit exceeding max
      await executePulseTool('get_pulse_history', { limit: 100 });
      expect(mockEngine.getRecentLogs).toHaveBeenCalledWith('default', 50);

      // Test with negative limit
      mockEngine.getRecentLogs.mockClear();
      await executePulseTool('get_pulse_history', { limit: -5 });
      expect(mockEngine.getRecentLogs).toHaveBeenCalledWith('default', 1);
    });

    it('defaults limit to 10', async () => {
      mockEngine.getRecentLogs.mockResolvedValue([]);
      mockEngine.getStats.mockResolvedValue({
        totalPulses: 0,
        llmCallRate: 0,
        avgDurationMs: 0,
        actionsExecuted: 0,
      });

      await executePulseTool('get_pulse_history', {});

      expect(mockEngine.getRecentLogs).toHaveBeenCalledWith('default', 10);
    });

    it('returns error when getRecentLogs throws', async () => {
      mockEngine.getRecentLogs.mockRejectedValue(new Error('DB connection lost'));
      mockEngine.getStats.mockResolvedValue({
        totalPulses: 0,
        llmCallRate: 0,
        avgDurationMs: 0,
        actionsExecuted: 0,
      });

      const result = await executePulseTool('get_pulse_history', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection lost');
    });

    it('returns error when getStats throws', async () => {
      mockEngine.getRecentLogs.mockResolvedValue([]);
      mockEngine.getStats.mockRejectedValue(new Error('Stats error'));

      const result = await executePulseTool('get_pulse_history', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Stats error');
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executePulseTool('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown pulse tool');
    });
  });
});

/**
 * Trigger Tools Tests
 *
 * Tests the executeTriggerTool function and TRIGGER_TOOLS definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTriggerService = {
  createTrigger: vi.fn(),
  listTriggers: vi.fn(async () => []),
  getTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  getStats: vi.fn(async () => ({ total: 5, enabled: 3, firedThisWeek: 10, successRate: 0.9 })),
};

vi.mock('../services/trigger-service.js', () => ({
  getTriggerService: () => mockTriggerService,
}));

const mockTriggerEngine = {
  fireTrigger: vi.fn(async () => ({ success: true })),
};

vi.mock('../triggers/index.js', () => ({
  getTriggerEngine: () => mockTriggerEngine,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { trigger: mockTriggerService };
        return services[token.name];
      }),
    })),
  };
});

import { TRIGGER_TOOLS, executeTriggerTool } from './trigger-tools.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trigger Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // TRIGGER_TOOLS definitions
  // ========================================================================

  describe('TRIGGER_TOOLS', () => {
    it('exports 6 tool definitions', () => {
      expect(TRIGGER_TOOLS).toHaveLength(6);
    });

    it('all tools have required fields', () => {
      for (const tool of TRIGGER_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Automation');
      }
    });

    it('contains expected tool names', () => {
      const names = TRIGGER_TOOLS.map((t) => t.name);
      expect(names).toContain('create_trigger');
      expect(names).toContain('list_triggers');
      expect(names).toContain('enable_trigger');
      expect(names).toContain('fire_trigger');
      expect(names).toContain('delete_trigger');
      expect(names).toContain('trigger_stats');
    });
  });

  // ========================================================================
  // create_trigger
  // ========================================================================

  describe('create_trigger', () => {
    it('creates a schedule trigger with cron', async () => {
      mockTriggerService.createTrigger.mockResolvedValue({
        id: 't1',
        name: 'Daily Report',
        type: 'schedule',
        enabled: true,
        nextFire: new Date('2025-01-02T08:00:00Z'),
      });

      const result = await executeTriggerTool(
        'create_trigger',
        {
          name: 'Daily Report',
          type: 'schedule',
          cron: '0 8 * * *',
          action_type: 'chat',
          action_payload: { prompt: 'Generate report' },
        },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          name: 'Daily Report',
          type: 'schedule',
          config: { cron: '0 8 * * *', timezone: 'local' },
        })
      );
    });

    it('rejects schedule trigger without cron', async () => {
      const result = await executeTriggerTool('create_trigger', {
        name: 'Bad Trigger',
        type: 'schedule',
        action_type: 'notification',
        action_payload: { message: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cron');
    });

    it('creates an event trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValue({
        id: 't2',
        name: 'Goal Alert',
        type: 'event',
        enabled: true,
        nextFire: null,
      });

      const result = await executeTriggerTool('create_trigger', {
        name: 'Goal Alert',
        type: 'event',
        event_type: 'goal_completed',
        action_type: 'notification',
        action_payload: { message: 'Goal done!' },
      });

      expect(result.success).toBe(true);
      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          config: { eventType: 'goal_completed' },
        })
      );
    });

    it('rejects event trigger without event_type', async () => {
      const result = await executeTriggerTool('create_trigger', {
        name: 'Bad Event',
        type: 'event',
        action_type: 'notification',
        action_payload: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('event_type');
    });

    it('creates a condition trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValue({
        id: 't3',
        name: 'Stale Check',
        type: 'condition',
        enabled: true,
        nextFire: null,
      });

      const result = await executeTriggerTool('create_trigger', {
        name: 'Stale Check',
        type: 'condition',
        condition: 'stale_goals',
        threshold: 5,
        action_type: 'goal_check',
        action_payload: { staleDays: 5 },
      });

      expect(result.success).toBe(true);
      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          config: { condition: 'stale_goals', threshold: 5, checkInterval: 60 },
        })
      );
    });

    it('rejects condition trigger without condition', async () => {
      const result = await executeTriggerTool('create_trigger', {
        name: 'Bad Condition',
        type: 'condition',
        action_type: 'notification',
        action_payload: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('condition');
    });

    it('handles service errors gracefully', async () => {
      mockTriggerService.createTrigger.mockRejectedValue(new Error('Validation failed'));

      const result = await executeTriggerTool('create_trigger', {
        name: 'Failing',
        type: 'webhook',
        action_type: 'notification',
        action_payload: { message: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation failed');
    });
  });

  // ========================================================================
  // list_triggers
  // ========================================================================

  describe('list_triggers', () => {
    it('returns formatted trigger list', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        {
          id: 't1',
          name: 'Daily',
          type: 'schedule',
          enabled: true,
          priority: 5,
          lastFired: new Date('2025-01-01'),
          nextFire: new Date('2025-01-02'),
          fireCount: 10,
          description: 'Daily trigger',
          action: { type: 'chat', payload: {} },
        },
      ]);

      const result = await executeTriggerTool('list_triggers', { type: 'schedule' }, 'user-1');

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1);
      expect((result.result as Record<string, unknown>[])[0]).toMatchObject({
        id: 't1',
        name: 'Daily',
        type: 'schedule',
        enabled: true,
        actionType: 'chat',
      });
    });
  });

  // ========================================================================
  // enable_trigger
  // ========================================================================

  describe('enable_trigger', () => {
    it('enables a trigger', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue({ id: 't1', enabled: true });

      const result = await executeTriggerTool('enable_trigger', {
        trigger_id: 't1',
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('default', 't1', {
        enabled: true,
      });
    });

    it('returns error when trigger not found', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue(null);

      const result = await executeTriggerTool('enable_trigger', {
        trigger_id: 'nonexistent',
        enabled: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ========================================================================
  // fire_trigger
  // ========================================================================

  describe('fire_trigger', () => {
    it('fires a trigger manually', async () => {
      mockTriggerService.getTrigger.mockResolvedValue({ id: 't1', name: 'Test' });

      const result = await executeTriggerTool('fire_trigger', { trigger_id: 't1' });

      expect(result.success).toBe(true);
      expect(mockTriggerEngine.fireTrigger).toHaveBeenCalledWith('t1');
    });

    it('returns error when trigger not found', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);

      const result = await executeTriggerTool('fire_trigger', { trigger_id: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ========================================================================
  // delete_trigger
  // ========================================================================

  describe('delete_trigger', () => {
    it('deletes a trigger', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(true);

      const result = await executeTriggerTool('delete_trigger', { trigger_id: 't1' });

      expect(result.success).toBe(true);
    });

    it('returns error when trigger not found', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(false);

      const result = await executeTriggerTool('delete_trigger', { trigger_id: 'nonexistent' });

      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // trigger_stats
  // ========================================================================

  describe('trigger_stats', () => {
    it('returns stats from service', async () => {
      const result = await executeTriggerTool('trigger_stats', {}, 'user-1');

      expect(result.success).toBe(true);
      expect(mockTriggerService.getStats).toHaveBeenCalledWith('user-1');
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeTriggerTool('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown trigger tool');
    });
  });
});

describe('workflowUsable flag', () => {
  it('all trigger tools are marked workflowUsable: false', () => {
    for (const def of TRIGGER_TOOLS) {
      expect(def.workflowUsable, `${def.name} should have workflowUsable: false`).toBe(false);
    }
  });
});

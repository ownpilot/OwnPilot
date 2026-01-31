/**
 * Proactive Triggers Tests
 *
 * Tests the proactive trigger management functions:
 * - initializeDefaultTriggers
 * - getProactiveStatus
 * - enableProactiveFeature / disableProactiveFeature
 * - enableAllProactive / disableAllProactive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTriggerService = {
  listTriggers: vi.fn(async () => []),
  createTrigger: vi.fn(async (_userId: string, input: any) => ({
    id: `t-${input.name}`,
    ...input,
    enabled: input.enabled ?? false,
    lastFired: null,
    fireCount: 0,
  })),
  updateTrigger: vi.fn(async () => ({})),
};

vi.mock('../services/trigger-service.js', () => ({
  getTriggerService: () => mockTriggerService,
}));

import {
  DEFAULT_TRIGGERS,
  initializeDefaultTriggers,
  getProactiveStatus,
  enableProactiveFeature,
  disableProactiveFeature,
  enableAllProactive,
  disableAllProactive,
} from './proactive.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Proactive Triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // DEFAULT_TRIGGERS
  // ========================================================================

  describe('DEFAULT_TRIGGERS', () => {
    it('contains at least 5 default triggers', () => {
      expect(DEFAULT_TRIGGERS.length).toBeGreaterThanOrEqual(5);
    });

    it('all default triggers are disabled by default', () => {
      for (const trigger of DEFAULT_TRIGGERS) {
        expect(trigger.enabled).toBe(false);
      }
    });

    it('each trigger has required fields', () => {
      for (const trigger of DEFAULT_TRIGGERS) {
        expect(trigger.name).toBeTruthy();
        expect(trigger.description).toBeTruthy();
        expect(trigger.type).toBeTruthy();
        expect(trigger.config).toBeDefined();
        expect(trigger.action).toBeDefined();
        expect(typeof trigger.priority).toBe('number');
      }
    });
  });

  // ========================================================================
  // initializeDefaultTriggers
  // ========================================================================

  describe('initializeDefaultTriggers', () => {
    it('creates all triggers when none exist', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      const result = await initializeDefaultTriggers('user-1');

      expect(result.created).toBe(DEFAULT_TRIGGERS.length);
      expect(result.skipped).toBe(0);
      expect(mockTriggerService.createTrigger).toHaveBeenCalledTimes(DEFAULT_TRIGGERS.length);
    });

    it('skips triggers that already exist', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { name: DEFAULT_TRIGGERS[0]!.name },
        { name: DEFAULT_TRIGGERS[1]!.name },
      ]);

      const result = await initializeDefaultTriggers('user-1');

      expect(result.skipped).toBe(2);
      expect(result.created).toBe(DEFAULT_TRIGGERS.length - 2);
    });

    it('skips all when all exist', async () => {
      mockTriggerService.listTriggers.mockResolvedValue(
        DEFAULT_TRIGGERS.map((t) => ({ name: t.name }))
      );

      const result = await initializeDefaultTriggers('user-1');

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(DEFAULT_TRIGGERS.length);
      expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
    });

    it('counts create failures as skipped', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockTriggerService.createTrigger.mockRejectedValueOnce(new Error('DB error'));

      const result = await initializeDefaultTriggers('user-1');

      // First trigger fails, rest succeed
      expect(result.skipped).toBe(1);
      expect(result.created).toBe(DEFAULT_TRIGGERS.length - 1);
    });

    it('defaults to userId "default"', async () => {
      mockTriggerService.listTriggers.mockResolvedValue(
        DEFAULT_TRIGGERS.map((t) => ({ name: t.name }))
      );

      await initializeDefaultTriggers();

      expect(mockTriggerService.listTriggers).toHaveBeenCalledWith('default', { limit: 100 });
    });
  });

  // ========================================================================
  // getProactiveStatus
  // ========================================================================

  describe('getProactiveStatus', () => {
    it('returns status of proactive triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        {
          name: DEFAULT_TRIGGERS[0]!.name,
          enabled: true,
          lastFired: new Date('2025-01-01'),
          fireCount: 5,
        },
        {
          name: DEFAULT_TRIGGERS[1]!.name,
          enabled: false,
          lastFired: null,
          fireCount: 0,
        },
        {
          name: 'Custom Non-Default Trigger',
          enabled: true,
          lastFired: null,
          fireCount: 0,
        },
      ]);

      const status = await getProactiveStatus('user-1');

      // Should only include default triggers, not custom ones
      expect(status.triggers).toHaveLength(2);
      expect(status.enabledCount).toBe(1);
      expect(status.totalFires).toBe(5);
    });

    it('returns empty when no triggers exist', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      const status = await getProactiveStatus('user-1');

      expect(status.triggers).toHaveLength(0);
      expect(status.enabledCount).toBe(0);
      expect(status.totalFires).toBe(0);
    });
  });

  // ========================================================================
  // enableProactiveFeature / disableProactiveFeature
  // ========================================================================

  describe('enableProactiveFeature', () => {
    it('enables a trigger by name', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't1', name: 'Morning Briefing', enabled: false },
      ]);

      const result = await enableProactiveFeature('Morning Briefing', 'user-1');

      expect(result).toBe(true);
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 't1', { enabled: true });
    });

    it('returns false when trigger not found', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      const result = await enableProactiveFeature('Nonexistent', 'user-1');

      expect(result).toBe(false);
      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
    });
  });

  describe('disableProactiveFeature', () => {
    it('disables a trigger by name', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't1', name: 'Morning Briefing', enabled: true },
      ]);

      const result = await disableProactiveFeature('Morning Briefing', 'user-1');

      expect(result).toBe(true);
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 't1', { enabled: false });
    });

    it('returns false when trigger not found', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([]);

      const result = await disableProactiveFeature('Nonexistent', 'user-1');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // enableAllProactive / disableAllProactive
  // ========================================================================

  describe('enableAllProactive', () => {
    it('enables all disabled default triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue(
        DEFAULT_TRIGGERS.map((t, i) => ({
          id: `t${i}`,
          name: t.name,
          enabled: false,
        }))
      );

      const count = await enableAllProactive('user-1');

      expect(count).toBe(DEFAULT_TRIGGERS.length);
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledTimes(DEFAULT_TRIGGERS.length);
    });

    it('skips already enabled triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't0', name: DEFAULT_TRIGGERS[0]!.name, enabled: true },
        { id: 't1', name: DEFAULT_TRIGGERS[1]!.name, enabled: false },
      ]);

      const count = await enableAllProactive('user-1');

      expect(count).toBe(1); // Only the disabled one
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledOnce();
    });

    it('skips non-default triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 'custom', name: 'My Custom Trigger', enabled: false },
      ]);

      const count = await enableAllProactive('user-1');

      expect(count).toBe(0);
      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
    });
  });

  describe('disableAllProactive', () => {
    it('disables all enabled default triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue(
        DEFAULT_TRIGGERS.map((t, i) => ({
          id: `t${i}`,
          name: t.name,
          enabled: true,
        }))
      );

      const count = await disableAllProactive('user-1');

      expect(count).toBe(DEFAULT_TRIGGERS.length);
    });

    it('skips already disabled triggers', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't0', name: DEFAULT_TRIGGERS[0]!.name, enabled: false },
        { id: 't1', name: DEFAULT_TRIGGERS[1]!.name, enabled: true },
      ]);

      const count = await disableAllProactive('user-1');

      expect(count).toBe(1);
    });
  });
});

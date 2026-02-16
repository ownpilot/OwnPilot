/**
 * TriggerServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTriggerService = vi.hoisted(() => ({
  createTrigger: vi.fn(),
  getTrigger: vi.fn(),
  listTriggers: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  getDueTriggers: vi.fn(),
  getByEventType: vi.fn(),
  getConditionTriggers: vi.fn(),
  markFired: vi.fn(),
  logExecution: vi.fn(),
  getRecentHistory: vi.fn(),
  getHistoryForTrigger: vi.fn(),
  cleanupHistory: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('./trigger-service.js', () => ({
  getTriggerService: () => mockTriggerService,
}));

import { TriggerServiceImpl } from './trigger-service-impl.js';

const mockTrigger = {
  id: 'trig-1',
  userId: 'user-1',
  name: 'Daily Check',
  description: 'Check goals daily',
  type: 'schedule' as const,
  config: { cron: '0 9 * * *' },
  action: { type: 'goal_check' as const, payload: {} },
  enabled: true,
  priority: 5,
  lastFired: null,
  nextFire: new Date('2025-01-02T09:00:00Z'),
  fireCount: 0,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockHistory = {
  id: 'hist-1',
  triggerId: 'trig-1',
  triggerName: 'Test Trigger',
  firedAt: new Date('2024-06-01T09:00:00Z'),
  status: 'success' as const,
  result: { checked: 3 },
  error: null,
  durationMs: 150,
};

describe('TriggerServiceImpl', () => {
  let service: TriggerServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TriggerServiceImpl();
  });

  describe('createTrigger', () => {
    it('creates a trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValue(mockTrigger);

      const result = await service.createTrigger('user-1', {
        name: 'Daily Check',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
        action: { type: 'goal_check', payload: {} },
      });

      expect(result.id).toBe('trig-1');
      expect(result.name).toBe('Daily Check');
    });
  });

  describe('getTrigger', () => {
    it('returns trigger by ID', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(mockTrigger);

      const result = await service.getTrigger('user-1', 'trig-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('trig-1');
    });

    it('returns null for unknown trigger', async () => {
      mockTriggerService.getTrigger.mockResolvedValue(null);
      expect(await service.getTrigger('user-1', 'nonexistent')).toBeNull();
    });
  });

  describe('listTriggers', () => {
    it('lists triggers with query', async () => {
      mockTriggerService.listTriggers.mockResolvedValue([mockTrigger]);

      const result = await service.listTriggers('user-1', { type: 'schedule', enabled: true });
      expect(result).toHaveLength(1);
      expect(mockTriggerService.listTriggers).toHaveBeenCalledWith('user-1', {
        type: 'schedule',
        enabled: true,
      });
    });
  });

  describe('updateTrigger', () => {
    it('updates and returns trigger', async () => {
      const updated = { ...mockTrigger, name: 'Updated' };
      mockTriggerService.updateTrigger.mockResolvedValue(updated);

      const result = await service.updateTrigger('user-1', 'trig-1', { name: 'Updated' });
      expect(result!.name).toBe('Updated');
    });

    it('returns null for unknown trigger', async () => {
      mockTriggerService.updateTrigger.mockResolvedValue(null);
      expect(await service.updateTrigger('user-1', 'nonexistent', { name: 'x' })).toBeNull();
    });
  });

  describe('deleteTrigger', () => {
    it('deletes a trigger', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(true);
      expect(await service.deleteTrigger('user-1', 'trig-1')).toBe(true);
    });

    it('returns false for unknown trigger', async () => {
      mockTriggerService.deleteTrigger.mockResolvedValue(false);
      expect(await service.deleteTrigger('user-1', 'nonexistent')).toBe(false);
    });
  });

  describe('getDueTriggers', () => {
    it('returns due triggers', async () => {
      mockTriggerService.getDueTriggers.mockResolvedValue([mockTrigger]);

      const result = await service.getDueTriggers('user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getByEventType', () => {
    it('returns triggers for event type', async () => {
      const eventTrigger = { ...mockTrigger, type: 'event' as const };
      mockTriggerService.getByEventType.mockResolvedValue([eventTrigger]);

      const result = await service.getByEventType('user-1', 'goal_completed');
      expect(result).toHaveLength(1);
      expect(mockTriggerService.getByEventType).toHaveBeenCalledWith('user-1', 'goal_completed');
    });
  });

  describe('getConditionTriggers', () => {
    it('returns condition triggers', async () => {
      mockTriggerService.getConditionTriggers.mockResolvedValue([]);

      const result = await service.getConditionTriggers('user-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('markFired', () => {
    it('delegates to service', async () => {
      mockTriggerService.markFired.mockResolvedValue(undefined);

      await service.markFired('user-1', 'trig-1', '2025-01-03T09:00:00Z');
      expect(mockTriggerService.markFired).toHaveBeenCalledWith(
        'user-1',
        'trig-1',
        '2025-01-03T09:00:00Z',
      );
    });
  });

  describe('logExecution', () => {
    it('logs execution with all parameters', async () => {
      mockTriggerService.logExecution.mockResolvedValue(undefined);

      await service.logExecution('user-1', 'trig-1', 'Test Trigger', 'success', { checked: 3 }, undefined, 150);
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'user-1',
        'trig-1',
        'Test Trigger',
        'success',
        { checked: 3 },
        undefined,
        150,
      );
    });

    it('logs failure with error', async () => {
      mockTriggerService.logExecution.mockResolvedValue(undefined);

      await service.logExecution('user-1', 'trig-1', 'Test Trigger', 'failure', undefined, 'timeout');
      expect(mockTriggerService.logExecution).toHaveBeenCalledWith(
        'user-1',
        'trig-1',
        'Test Trigger',
        'failure',
        undefined,
        'timeout',
        undefined,
      );
    });
  });

  describe('getRecentHistory', () => {
    it('returns recent history', async () => {
      mockTriggerService.getRecentHistory.mockResolvedValue({ history: [mockHistory], total: 1 });

      const result = await service.getRecentHistory('user-1', { limit: 10 });
      expect(result.history).toHaveLength(1);
      expect(result.history[0].status).toBe('success');
      expect(mockTriggerService.getRecentHistory).toHaveBeenCalledWith('user-1', { limit: 10 });
    });
  });

  describe('getHistoryForTrigger', () => {
    it('returns history for specific trigger', async () => {
      mockTriggerService.getHistoryForTrigger.mockResolvedValue({ history: [mockHistory], total: 1 });

      const result = await service.getHistoryForTrigger('user-1', 'trig-1', { limit: 5 });
      expect(result.history).toHaveLength(1);
      expect(mockTriggerService.getHistoryForTrigger).toHaveBeenCalledWith('user-1', 'trig-1', { limit: 5 });
    });
  });

  describe('cleanupHistory', () => {
    it('cleans up old history', async () => {
      mockTriggerService.cleanupHistory.mockResolvedValue(15);

      const result = await service.cleanupHistory('user-1', 60);
      expect(result).toBe(15);
      expect(mockTriggerService.cleanupHistory).toHaveBeenCalledWith('user-1', 60);
    });
  });

  describe('getStats', () => {
    it('returns trigger statistics', async () => {
      const stats = {
        total: 10,
        enabled: 7,
        byType: { schedule: 4, event: 3, condition: 2, webhook: 1 },
        totalFires: 100,
        firesThisWeek: 14,
        successRate: 0.95,
      };
      mockTriggerService.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result.total).toBe(10);
      expect(result.enabled).toBe(7);
      expect(result.successRate).toBe(0.95);
    });
  });
});

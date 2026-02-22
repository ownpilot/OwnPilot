/**
 * TriggerService Tests
 *
 * Tests for business logic, validation, event emission,
 * execution tracking, and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerService, TriggerServiceError } from './trigger-service.js';
import type { Trigger, TriggerHistory } from '../db/repositories/triggers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn((type: string, category: string, source: string, data: unknown) => ({
    type,
    category,
    source,
    data,
    timestamp: new Date().toISOString(),
  })),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

const mockRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getDueTriggers: vi.fn(),
  getByEventType: vi.fn(),
  getConditionTriggers: vi.fn(),
  markFired: vi.fn(),
  logExecution: vi.fn(),
  getRecentHistory: vi.fn(),
  getHistoryForTrigger: vi.fn(),
  cleanupHistory: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/triggers.js', () => ({
  TriggersRepository: vi.fn(),
  createTriggersRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trg-1',
    userId: 'user-1',
    name: 'Daily reminder',
    type: 'schedule',
    enabled: true,
    config: { cron: '0 9 * * *' },
    lastFired: null,
    nextFire: null,
    fireCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Trigger;
}

function fakeHistory(overrides: Partial<TriggerHistory> = {}): TriggerHistory {
  return {
    id: 'hist-1',
    triggerId: 'trg-1',
    triggerName: 'Test Trigger',
    status: 'success',
    result: { ok: true },
    error: null,
    durationMs: 120,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as TriggerHistory;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriggerService', () => {
  let service: TriggerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TriggerService();
  });

  // ========================================================================
  // CRUD
  // ========================================================================

  describe('createTrigger', () => {
    it('creates a trigger and emits resource.created', async () => {
      const trigger = fakeTrigger();
      mockRepo.create.mockResolvedValue(trigger);

      const result = await service.createTrigger('user-1', {
        name: 'Daily reminder',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
      });

      expect(result).toBe(trigger);
      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Daily reminder',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
      });
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'trigger', id: 'trg-1' },
        })
      );
    });

    it('throws VALIDATION_ERROR when name is empty', async () => {
      await expect(
        service.createTrigger('user-1', {
          name: '',
          type: 'schedule',
          config: {},
        })
      ).rejects.toThrow(/Name is required/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when name is whitespace only', async () => {
      await expect(
        service.createTrigger('user-1', {
          name: '   ',
          type: 'schedule',
          config: {},
        })
      ).rejects.toThrow(TriggerServiceError);
    });
  });

  describe('getTrigger', () => {
    it('returns trigger when found', async () => {
      const trigger = fakeTrigger();
      mockRepo.get.mockResolvedValue(trigger);

      const result = await service.getTrigger('user-1', 'trg-1');
      expect(result).toBe(trigger);
      expect(mockRepo.get).toHaveBeenCalledWith('trg-1');
    });

    it('returns null when not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.getTrigger('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('listTriggers', () => {
    it('delegates to repo with query', async () => {
      mockRepo.list.mockResolvedValue([fakeTrigger()]);
      const result = await service.listTriggers('user-1', { enabled: true });
      expect(result).toHaveLength(1);
      expect(mockRepo.list).toHaveBeenCalledWith({ enabled: true });
    });

    it('passes empty query when none provided', async () => {
      mockRepo.list.mockResolvedValue([]);
      await service.listTriggers('user-1');
      expect(mockRepo.list).toHaveBeenCalledWith({});
    });
  });

  describe('updateTrigger', () => {
    it('updates and emits resource.updated', async () => {
      const updated = fakeTrigger({ name: 'Updated name' });
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateTrigger('user-1', 'trg-1', { name: 'Updated name' });

      expect(result).toBe(updated);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'trigger', id: 'trg-1' }),
        })
      );
    });

    it('does not emit when trigger not found', async () => {
      mockRepo.update.mockResolvedValue(null);
      const result = await service.updateTrigger('user-1', 'missing', { name: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deleteTrigger', () => {
    it('deletes and emits resource.deleted', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deleteTrigger('user-1', 'trg-1');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'trigger', id: 'trg-1' },
        })
      );
    });

    it('does not emit when trigger not found', async () => {
      mockRepo.delete.mockResolvedValue(false);
      const result = await service.deleteTrigger('user-1', 'missing');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Queries
  // ========================================================================

  describe('query methods', () => {
    it('getDueTriggers delegates to repo', async () => {
      mockRepo.getDueTriggers.mockResolvedValue([fakeTrigger()]);
      const result = await service.getDueTriggers('user-1');
      expect(result).toHaveLength(1);
      expect(mockRepo.getDueTriggers).toHaveBeenCalled();
    });

    it('getByEventType delegates to repo', async () => {
      mockRepo.getByEventType.mockResolvedValue([fakeTrigger()]);
      const result = await service.getByEventType('user-1', 'chat_completed');
      expect(result).toHaveLength(1);
      expect(mockRepo.getByEventType).toHaveBeenCalledWith('chat_completed');
    });

    it('getConditionTriggers delegates to repo', async () => {
      mockRepo.getConditionTriggers.mockResolvedValue([]);
      await service.getConditionTriggers('user-1');
      expect(mockRepo.getConditionTriggers).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Execution Tracking
  // ========================================================================

  describe('execution tracking', () => {
    it('markFired delegates to repo', async () => {
      mockRepo.markFired.mockResolvedValue(undefined);
      await service.markFired('user-1', 'trg-1', '2025-01-02T09:00:00Z');
      expect(mockRepo.markFired).toHaveBeenCalledWith('trg-1', '2025-01-02T09:00:00Z');
    });

    it('markFired works without nextFire', async () => {
      mockRepo.markFired.mockResolvedValue(undefined);
      await service.markFired('user-1', 'trg-1');
      expect(mockRepo.markFired).toHaveBeenCalledWith('trg-1', undefined);
    });

    it('logExecution delegates to repo with all params', async () => {
      mockRepo.logExecution.mockResolvedValue(undefined);
      await service.logExecution(
        'user-1',
        'trg-1',
        'Test Trigger',
        'success',
        { ok: true },
        undefined,
        150
      );
      expect(mockRepo.logExecution).toHaveBeenCalledWith(
        'trg-1',
        'Test Trigger',
        'success',
        { ok: true },
        undefined,
        150
      );
    });

    it('logExecution delegates failure with error', async () => {
      mockRepo.logExecution.mockResolvedValue(undefined);
      await service.logExecution(
        'user-1',
        'trg-1',
        'Test Trigger',
        'failure',
        undefined,
        'timeout',
        5000
      );
      expect(mockRepo.logExecution).toHaveBeenCalledWith(
        'trg-1',
        'Test Trigger',
        'failure',
        undefined,
        'timeout',
        5000
      );
    });

    it('getRecentHistory delegates with default query', async () => {
      mockRepo.getRecentHistory.mockResolvedValue({ rows: [fakeHistory()], total: 1 });
      const result = await service.getRecentHistory('user-1');
      expect(result.history).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockRepo.getRecentHistory).toHaveBeenCalledWith({});
    });

    it('getRecentHistory delegates with custom limit', async () => {
      mockRepo.getRecentHistory.mockResolvedValue({ rows: [], total: 0 });
      await service.getRecentHistory('user-1', { limit: 5 });
      expect(mockRepo.getRecentHistory).toHaveBeenCalledWith({ limit: 5 });
    });

    it('getHistoryForTrigger delegates to repo', async () => {
      mockRepo.getHistoryForTrigger.mockResolvedValue({ rows: [fakeHistory()], total: 1 });
      const result = await service.getHistoryForTrigger('user-1', 'trg-1', { limit: 10 });
      expect(result.history).toHaveLength(1);
      expect(mockRepo.getHistoryForTrigger).toHaveBeenCalledWith('trg-1', { limit: 10 });
    });

    it('cleanupHistory delegates with default maxAgeDays', async () => {
      mockRepo.cleanupHistory.mockResolvedValue(5);
      const result = await service.cleanupHistory('user-1');
      expect(result).toBe(5);
      expect(mockRepo.cleanupHistory).toHaveBeenCalledWith(30);
    });

    it('cleanupHistory delegates with custom maxAgeDays', async () => {
      mockRepo.cleanupHistory.mockResolvedValue(10);
      const result = await service.cleanupHistory('user-1', 7);
      expect(result).toBe(10);
      expect(mockRepo.cleanupHistory).toHaveBeenCalledWith(7);
    });
  });

  // ========================================================================
  // Stats
  // ========================================================================

  describe('getStats', () => {
    it('delegates to repo', async () => {
      const stats = {
        total: 10,
        enabled: 7,
        byType: { schedule: 5, event: 2 },
        totalFires: 100,
        firesThisWeek: 15,
        successRate: 0.95,
      };
      mockRepo.getStats.mockResolvedValue(stats);

      const result = await service.getStats('user-1');
      expect(result).toEqual(stats);
      expect(mockRepo.getStats).toHaveBeenCalled();
    });
  });
});

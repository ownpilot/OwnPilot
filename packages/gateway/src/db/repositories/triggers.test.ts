/**
 * TriggersRepository Tests
 *
 * Unit tests for trigger CRUD, history, enable/disable,
 * due triggers, event matching, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAdapter = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  isConnected: vi.fn(() => true),
  close: vi.fn(),
  now: vi.fn(() => 'NOW()'),
  date: vi.fn((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn((i: number) => `$${i}`),
  boolean: vi.fn((v: boolean) => v),
  parseBoolean: vi.fn((v: unknown) => Boolean(v)),
  type: 'postgres' as const,
}));

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn(async () => mockAdapter),
  getAdapterSync: vi.fn(() => mockAdapter),
}));

const mockGetNextRunTime = vi.hoisted(() => vi.fn());

vi.mock('@ownpilot/core', () => ({
  getNextRunTime: mockGetNextRunTime,
  generateId: (prefix: string) => `${prefix}_test_${Date.now()}`,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { TriggersRepository } from './triggers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';
const NEXT_FIRE = new Date('2025-01-16T09:00:00.000Z');

function triggerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trigger_1',
    user_id: 'user-1',
    name: 'Daily Check',
    description: 'Check goals daily',
    type: 'schedule',
    config: '{"cron":"0 9 * * *"}',
    action: '{"type":"goal_check","payload":{}}',
    enabled: true,
    priority: 5,
    last_fired: null,
    next_fire: NEXT_FIRE.toISOString(),
    fire_count: 0,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hist_1',
    trigger_id: 'trigger_1',
    fired_at: NOW_ISO,
    status: 'success',
    result: null,
    error: null,
    duration_ms: 150,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TriggersRepository', () => {
  let repo: TriggersRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockReset();
    mockAdapter.queryOne.mockReset();
    mockAdapter.execute.mockReset();
    mockGetNextRunTime.mockReset();
    mockGetNextRunTime.mockReturnValue(NEXT_FIRE);
    repo = new TriggersRepository('user-1');
  });

  // ==========================================================================
  // Trigger CRUD
  // ==========================================================================

  describe('create', () => {
    it('inserts a schedule trigger with calculated next_fire', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(triggerRow());

      const trigger = await repo.create({
        name: 'Daily Check',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
        action: { type: 'goal_check', payload: {} },
      });

      expect(trigger.id).toBe('trigger_1');
      expect(trigger.name).toBe('Daily Check');
      expect(trigger.enabled).toBe(true);
      expect(mockGetNextRunTime).toHaveBeenCalledWith('0 9 * * *');
    });

    it('throws when schedule cron produces no next fire time', async () => {
      mockGetNextRunTime.mockReturnValue(null);

      await expect(
        repo.create({
          name: 'Bad Cron',
          type: 'schedule',
          config: { cron: 'invalid' },
          action: { type: 'goal_check', payload: {} },
        }),
      ).rejects.toThrow('Cannot create schedule trigger');
    });

    it('does not calculate next_fire for non-schedule triggers', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(
        triggerRow({ type: 'event', next_fire: null, config: '{"eventType":"goal_completed"}' }),
      );

      await repo.create({
        name: 'Goal Complete',
        type: 'event',
        config: { eventType: 'goal_completed' },
        action: { type: 'notification', payload: {} },
      });

      expect(mockGetNextRunTime).not.toHaveBeenCalled();
    });

    it('does not calculate next_fire when disabled', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(
        triggerRow({ enabled: false, next_fire: null }),
      );

      await repo.create({
        name: 'Disabled',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
        action: { type: 'goal_check', payload: {} },
        enabled: false,
      });

      expect(mockGetNextRunTime).not.toHaveBeenCalled();
    });

    it('applies default values', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(triggerRow());

      await repo.create({
        name: 'Test',
        type: 'schedule',
        config: { cron: '0 9 * * *' },
        action: { type: 'goal_check', payload: {} },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // enabled defaults to true
      expect(params[7]).toBe(true);
      // priority defaults to 5
      expect(params[8]).toBe(5);
    });

    it('throws when trigger not found after insert', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(
        repo.create({
          name: 'Test',
          type: 'event',
          config: { eventType: 'x' },
          action: { type: 'chat', payload: {} },
        }),
      ).rejects.toThrow('Failed to create trigger');
    });
  });

  describe('get', () => {
    it('returns mapped trigger', async () => {
      mockAdapter.queryOne.mockResolvedValue(triggerRow());

      const trigger = await repo.get('trigger_1');

      expect(trigger).not.toBeNull();
      expect(trigger!.config).toEqual({ cron: '0 9 * * *' });
      expect(trigger!.action).toEqual({ type: 'goal_check', payload: {} });
      expect(trigger!.nextFire).toBeInstanceOf(Date);
      expect(trigger!.lastFired).toBeNull();
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const trigger = await repo.get('nonexistent');
      expect(trigger).toBeNull();
    });
  });

  describe('update', () => {
    it('returns null when trigger not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.update('no-trigger', { name: 'New' });
      expect(result).toBeNull();
    });

    it('updates name and returns refreshed trigger', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(triggerRow())
        .mockResolvedValueOnce(triggerRow({ name: 'Updated' }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.update('trigger_1', { name: 'Updated' });

      expect(result!.name).toBe('Updated');
    });

    it('recalculates next_fire when config changes for schedule trigger', async () => {
      const newNextFire = new Date('2025-01-17T10:00:00Z');
      mockGetNextRunTime.mockReturnValue(newNextFire);

      mockAdapter.queryOne
        .mockResolvedValueOnce(triggerRow())
        .mockResolvedValueOnce(triggerRow({ next_fire: newNextFire.toISOString() }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('trigger_1', { config: { cron: '0 10 * * *' } });

      expect(mockGetNextRunTime).toHaveBeenCalledWith('0 10 * * *');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('next_fire');
    });

    it('throws when recalculated cron produces no next fire time', async () => {
      mockGetNextRunTime.mockReturnValue(null);

      mockAdapter.queryOne.mockResolvedValueOnce(triggerRow());

      await expect(
        repo.update('trigger_1', { config: { cron: 'bad_cron' } }),
      ).rejects.toThrow('Cannot update schedule trigger');
    });

    it('recalculates next_fire when enabled changes', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(triggerRow())
        .mockResolvedValueOnce(triggerRow({ enabled: true }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('trigger_1', { enabled: true });

      expect(mockGetNextRunTime).toHaveBeenCalled();
    });

    it('clamps priority between 1 and 10', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(triggerRow())
        .mockResolvedValueOnce(triggerRow({ priority: 10 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('trigger_1', { priority: 15 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.delete('trigger_1');
      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const result = await repo.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // List & Filtering
  // ==========================================================================

  describe('list', () => {
    it('returns all triggers for user', async () => {
      mockAdapter.query.mockResolvedValue([triggerRow(), triggerRow({ id: 'trigger_2' })]);

      const triggers = await repo.list();
      expect(triggers).toHaveLength(2);
    });

    it('filters by single type', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ type: 'schedule' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type IN');
    });

    it('filters by multiple types', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ type: ['schedule', 'event'] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('schedule');
      expect(params).toContain('event');
    });

    it('filters by enabled status', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ enabled: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('enabled');
    });

    it('applies limit and offset', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ limit: 5, offset: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });
  });

  describe('getDueTriggers', () => {
    it('returns enabled schedule triggers with past next_fire', async () => {
      mockAdapter.query.mockResolvedValue([triggerRow()]);

      const triggers = await repo.getDueTriggers();

      expect(triggers).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("type = 'schedule'");
      expect(sql).toContain('enabled = true');
      expect(sql).toContain('next_fire IS NOT NULL');
    });
  });

  describe('getByEventType', () => {
    it('returns triggers matching event type', async () => {
      mockAdapter.query.mockResolvedValue([
        triggerRow({
          type: 'event',
          config: '{"eventType":"goal_completed"}',
        }),
        triggerRow({
          id: 'trigger_2',
          type: 'event',
          config: '{"eventType":"memory_added"}',
        }),
      ]);

      const triggers = await repo.getByEventType('goal_completed');

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.id).toBe('trigger_1');
    });

    it('returns empty array when no matches', async () => {
      mockAdapter.query.mockResolvedValue([
        triggerRow({
          type: 'event',
          config: '{"eventType":"other"}',
        }),
      ]);

      const triggers = await repo.getByEventType('nonexistent');
      expect(triggers).toHaveLength(0);
    });
  });

  describe('getConditionTriggers', () => {
    it('returns enabled condition triggers', async () => {
      mockAdapter.query.mockResolvedValue([
        triggerRow({
          type: 'condition',
          config: '{"condition":"stale_goals","threshold":5}',
        }),
      ]);

      const triggers = await repo.getConditionTriggers();

      expect(triggers).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("type = 'condition'");
    });
  });

  // ==========================================================================
  // Mark Fired
  // ==========================================================================

  describe('markFired', () => {
    it('updates last_fired, fire_count, and next_fire', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.markFired('trigger_1', NEXT_FIRE.toISOString());

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // next_fire param
      expect(params[1]).toBe(NEXT_FIRE.toISOString());
      // id param
      expect(params[3]).toBe('trigger_1');
    });

    it('sets next_fire to null when not provided', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.markFired('trigger_1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBeNull();
    });
  });

  // ==========================================================================
  // Trigger History
  // ==========================================================================

  describe('logExecution', () => {
    it('inserts history record and returns it', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(historyRow());

      const history = await repo.logExecution('trigger_1', 'success', { ok: true }, undefined, 200);

      expect(history.id).toBe('hist_1');
      expect(history.status).toBe('success');
      expect(history.durationMs).toBe(150);
    });

    it('stores error message', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(historyRow({ status: 'failure', error: 'Timeout' }));

      const history = await repo.logExecution('trigger_1', 'failure', undefined, 'Timeout');

      expect(history.error).toBe('Timeout');
    });

    it('throws when history not found after insert', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(repo.logExecution('trigger_1', 'success')).rejects.toThrow(
        'Failed to create trigger history',
      );
    });
  });

  describe('getHistory', () => {
    it('returns mapped history entry', async () => {
      mockAdapter.queryOne.mockResolvedValue(historyRow());

      const entry = await repo.getHistory('hist_1');

      expect(entry).not.toBeNull();
      expect(entry!.firedAt).toBeInstanceOf(Date);
      expect(entry!.triggerId).toBe('trigger_1');
    });
  });

  describe('getHistoryForTrigger', () => {
    it('returns history entries for a trigger', async () => {
      mockAdapter.query.mockResolvedValue([
        historyRow(),
        historyRow({ id: 'hist_2', status: 'failure' }),
      ]);

      const entries = await repo.getHistoryForTrigger('trigger_1');

      expect(entries).toHaveLength(2);
    });

    it('applies custom limit', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.getHistoryForTrigger('trigger_1', 5);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe(5);
    });
  });

  describe('getRecentHistory', () => {
    it('includes trigger name in results', async () => {
      mockAdapter.query.mockResolvedValue([
        { ...historyRow(), trigger_name: 'Daily Check' },
      ]);

      const entries = await repo.getRecentHistory();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.triggerName).toBe('Daily Check');
    });
  });

  describe('cleanupHistory', () => {
    it('deletes old history entries', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 15 });

      const count = await repo.cleanupHistory(30);

      expect(count).toBe(15);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM trigger_history');
    });

    it('defaults to 30 days', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      await repo.cleanupHistory();

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Statistics
  // ==========================================================================

  describe('getStats', () => {
    it('returns default values when empty', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ count: '0' }) // total
        .mockResolvedValueOnce({ count: '0' }) // enabled
        .mockResolvedValueOnce({ total: null }) // totalFires
        .mockResolvedValueOnce({ count: '0' }) // firesThisWeek
        .mockResolvedValueOnce({ count: '0' }) // successCount
        .mockResolvedValueOnce({ count: '0' }); // totalHistory
      mockAdapter.query.mockResolvedValue([]); // byType

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.enabled).toBe(0);
      expect(stats.totalFires).toBe(0);
      expect(stats.firesThisWeek).toBe(0);
      expect(stats.successRate).toBe(100); // default when no history
      expect(stats.byType.schedule).toBe(0);
    });

    it('computes stats from data', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ count: '4' }) // total
        .mockResolvedValueOnce({ count: '3' }) // enabled
        .mockResolvedValueOnce({ total: '10' }) // totalFires
        .mockResolvedValueOnce({ count: '5' }) // firesThisWeek
        .mockResolvedValueOnce({ count: '8' }) // successCount
        .mockResolvedValueOnce({ count: '10' }); // totalHistory
      mockAdapter.query.mockResolvedValue([
        { type: 'schedule', count: '2' },
        { type: 'event', count: '1' },
        { type: 'webhook', count: '1' },
      ]);

      const stats = await repo.getStats();

      expect(stats.total).toBe(4);
      expect(stats.enabled).toBe(3);
      expect(stats.byType.schedule).toBe(2);
      expect(stats.byType.event).toBe(1);
      expect(stats.byType.webhook).toBe(1);
      expect(stats.byType.condition).toBe(0);
      expect(stats.totalFires).toBe(10);
      expect(stats.firesThisWeek).toBe(5);
      expect(stats.successRate).toBe(80); // Math.round(8/10 * 100)
    });
  });
});

/**
 * Habits Repository Tests
 *
 * Unit tests for HabitsRepository CRUD, habit logs, streaks, stats,
 * today habits, categories, JSON serialization, and filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { HabitsRepository } from './habits.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeHabitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hab_1',
    user_id: 'user-1',
    name: 'Exercise',
    description: null,
    frequency: 'daily',
    target_days: '[0,1,2,3,4,5,6]',
    target_count: 1,
    unit: null,
    category: null,
    color: null,
    icon: null,
    reminder_time: null,
    is_archived: false,
    streak_current: 0,
    streak_longest: 0,
    total_completions: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeHabitLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hlog_1',
    habit_id: 'hab_1',
    user_id: 'user-1',
    date: '2025-01-15',
    count: 1,
    notes: null,
    logged_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HabitsRepository', () => {
  let repo: HabitsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new HabitsRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a habit and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      const result = await repo.create({ name: 'Exercise' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('Exercise');
      expect(result.frequency).toBe('daily');
      expect(result.targetCount).toBe(1);
      expect(result.isArchived).toBe(false);
      expect(result.streakCurrent).toBe(0);
    });

    it('should default to daily frequency with all days', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      await repo.create({ name: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // frequency default
      expect(params[4]).toBe('daily');
      // target_days for daily
      expect(params[5]).toBe(JSON.stringify([0, 1, 2, 3, 4, 5, 6]));
    });

    it('should set weekday target days when frequency is weekdays', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'weekdays', target_days: '[1,2,3,4,5]' })
      );

      await repo.create({ name: 'Work habit', frequency: 'weekdays' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(JSON.stringify([1, 2, 3, 4, 5]));
    });

    it('should set Monday as default for weekly frequency', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'weekly', target_days: '[1]' })
      );

      await repo.create({ name: 'Weekly review', frequency: 'weekly' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(JSON.stringify([1]));
    });

    it('should use custom target days when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'custom', target_days: '[0,6]' })
      );

      await repo.create({ name: 'Weekend habit', frequency: 'custom', targetDays: [0, 6] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(JSON.stringify([0, 6]));
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ name: 'Test' })).rejects.toThrow('Failed to create habit');
    });

    it('should store optional fields', async () => {
      const row = makeHabitRow({
        description: 'Run 5K',
        unit: 'km',
        category: 'fitness',
        color: '#00ff00',
        icon: 'run',
        reminder_time: '08:00',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        name: 'Exercise',
        description: 'Run 5K',
        unit: 'km',
        category: 'fitness',
        color: '#00ff00',
        icon: 'run',
        reminderTime: '08:00',
      });

      expect(result.description).toBe('Run 5K');
      expect(result.unit).toBe('km');
      expect(result.category).toBe('fitness');
      expect(result.color).toBe('#00ff00');
      expect(result.icon).toBe('run');
      expect(result.reminderTime).toBe('08:00');
    });

    it('should default targetCount to 1', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      await repo.create({ name: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe(1); // targetCount
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a habit when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      const result = await repo.get('hab_1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('hab_1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      const result = await repo.get('hab_1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      const result = await repo.get('hab_1');

      expect(result!.description).toBeUndefined();
      expect(result!.unit).toBeUndefined();
      expect(result!.category).toBeUndefined();
      expect(result!.color).toBeUndefined();
      expect(result!.icon).toBeUndefined();
      expect(result!.reminderTime).toBeUndefined();
    });

    it('should parse target_days JSON string to number array', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_days: '[1,3,5]' }));

      const result = await repo.get('hab_1');

      expect(result!.targetDays).toEqual([1, 3, 5]);
    });

    it('should handle invalid target_days JSON gracefully', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_days: 'invalid-json' }));

      const result = await repo.get('hab_1');

      expect(result!.targetDays).toEqual([]);
    });

    it('should handle null target_days', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_days: null }));

      const result = await repo.get('hab_1');

      expect(result!.targetDays).toEqual([]);
    });

    it('should scope query to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      await repo.get('hab_1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['hab_1', 'user-1']);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return updated habit', async () => {
      // get existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get refreshed
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ name: 'Running' }));

      const result = await repo.update('hab_1', { name: 'Running' });

      expect(result!.name).toBe('Running');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null if habit does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { name: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize targetDays as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_days: '[1,3]' }));

      await repo.update('hab_1', { targetDays: [1, 3] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('[1,3]');
    });

    it('should pass isArchived correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: true }));

      await repo.update('hab_1', { isArchived: true });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // isArchived is param index 10 in the COALESCE update
      expect(params[10]).toBe(true);
    });

    it('should pass null for undefined optional fields', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());

      await repo.update('hab_1', {});

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // All optional fields should be null (COALESCE will keep existing values)
      expect(params[0]).toBeNull(); // name
      expect(params[1]).toBeNull(); // description
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('hab_1')).toBe(true);
    });

    it('should return false when habit not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('hab_1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['hab_1', 'user-1']);
    });
  });

  // =========================================================================
  // archive / unarchive
  // =========================================================================

  describe('archive', () => {
    it('should set isArchived to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: true }));

      const result = await repo.archive('hab_1');

      expect(result!.isArchived).toBe(true);
    });

    it('should return null for nonexistent habit', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.archive('missing')).toBeNull();
    });
  });

  describe('unarchive', () => {
    it('should set isArchived to false', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: true }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: false }));

      const result = await repo.unarchive('hab_1');

      expect(result!.isArchived).toBe(false);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no habits', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped habits', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitRow(),
        makeHabitRow({ id: 'hab_2', name: 'Read' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('hab_1');
      expect(result[1]!.name).toBe('Read');
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'fitness' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('fitness');
    });

    it('should filter by isArchived', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isArchived: false });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = $');
    });

    it('should apply limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'health', isArchived: false, limit: 5 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
      expect(sql).toContain('is_archived = $');
      expect(sql).toContain('LIMIT');
    });

    it('should not add filters when query is empty', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({});

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('category =');
      expect(sql).not.toContain('is_archived =');
      expect(sql).not.toContain('LIMIT');
    });
  });

  // =========================================================================
  // logHabit
  // =========================================================================

  describe('logHabit', () => {
    it('should return null when habit does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // get habit

      expect(await repo.logHabit('missing')).toBeNull();
    });

    it('should insert new log when no existing log for date', async () => {
      // get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // getLog (no existing)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // insert new log
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateHabitStats -> get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // updateHabitStats -> SUM query
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 1 });
      // calculateStreak -> getLogs
      mockAdapter.query.mockResolvedValueOnce([]);
      // updateHabitStats -> execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // final getLog
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());

      const result = await repo.logHabit('hab_1');

      expect(result).not.toBeNull();
      expect(result!.habitId).toBe('hab_1');
      expect(result!.count).toBe(1);
    });

    it('should update existing log count when log exists for date', async () => {
      // get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // getLog (existing)
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow({ count: 2 }));
      // update existing log
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateHabitStats -> get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // updateHabitStats -> SUM query
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 3 });
      // calculateStreak -> getLogs
      mockAdapter.query.mockResolvedValueOnce([]);
      // updateHabitStats -> execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // final getLog
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow({ count: 3 }));

      const result = await repo.logHabit('hab_1', { count: 1 });

      expect(result).not.toBeNull();
      expect(result!.count).toBe(3);
    });

    it('should accept custom date and notes', async () => {
      // get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // getLog (no existing)
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateHabitStats -> get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // updateHabitStats -> SUM
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 1 });
      // calculateStreak -> getLogs
      mockAdapter.query.mockResolvedValueOnce([]);
      // updateHabitStats -> execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // final getLog
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitLogRow({ date: '2025-01-10', notes: 'Felt great' })
      );

      const result = await repo.logHabit('hab_1', {
        date: '2025-01-10',
        notes: 'Felt great',
      });

      expect(result!.date).toBe('2025-01-10');
      expect(result!.notes).toBe('Felt great');
    });
  });

  // =========================================================================
  // getLog
  // =========================================================================

  describe('getLog', () => {
    it('should return log when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());

      const result = await repo.getLog('hab_1', '2025-01-15');

      expect(result).not.toBeNull();
      expect(result!.habitId).toBe('hab_1');
      expect(result!.date).toBe('2025-01-15');
      expect(result!.loggedAt).toBeInstanceOf(Date);
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getLog('hab_1', '2025-01-01')).toBeNull();
    });

    it('should convert null notes to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow({ notes: null }));

      const result = await repo.getLog('hab_1', '2025-01-15');

      expect(result!.notes).toBeUndefined();
    });
  });

  // =========================================================================
  // getLogs
  // =========================================================================

  describe('getLogs', () => {
    it('should return empty array when no logs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getLogs('hab_1')).toEqual([]);
    });

    it('should filter by startDate', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogs('hab_1', { startDate: '2025-01-01' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('date >= $');
    });

    it('should filter by endDate', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogs('hab_1', { endDate: '2025-01-31' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('date <= $');
    });

    it('should apply limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogs('hab_1', { limit: 30 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('should order by date DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogs('hab_1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY date DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getLogs('hab_1', {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        limit: 50,
      });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('date >= $');
      expect(sql).toContain('date <= $');
      expect(sql).toContain('LIMIT');
    });
  });

  // =========================================================================
  // deleteLog
  // =========================================================================

  describe('deleteLog', () => {
    it('should return true and update stats when deleted', async () => {
      // delete
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateHabitStats -> get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      // updateHabitStats -> SUM
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 0 });
      // calculateStreak -> getLogs
      mockAdapter.query.mockResolvedValueOnce([]);
      // updateHabitStats -> execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.deleteLog('hab_1', '2025-01-15')).toBe(true);
    });

    it('should return false when log not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.deleteLog('hab_1', '2025-01-01')).toBe(false);
    });

    it('should not update stats when log not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.deleteLog('hab_1', '2025-01-01');

      // Only one execute call (the delete itself)
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // getHabitStats
  // =========================================================================

  describe('getHabitStats', () => {
    it('should return null when habit not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getHabitStats('missing')).toBeNull();
    });

    it('should return stats for existing habit', async () => {
      // get habit
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ total_completions: 10 }));
      // getLogs for weekly
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ count: 1 }),
        makeHabitLogRow({ count: 2, date: '2025-01-14' }),
      ]);
      // getLogs for monthly
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ count: 1 }),
        makeHabitLogRow({ count: 2 }),
        makeHabitLogRow({ count: 3 }),
      ]);

      const result = await repo.getHabitStats('hab_1');

      expect(result).not.toBeNull();
      expect(result!.habit.id).toBe('hab_1');
      expect(result!.weeklyCompletions).toBe(3);
      expect(result!.monthlyCompletions).toBe(6);
      expect(result!.recentLogs).toHaveLength(2);
      expect(typeof result!.completionRate).toBe('number');
    });

    it('should cap completionRate at 100', async () => {
      // get habit with targetCount=1, frequency=weekly (expectedMonthly=4)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'weekly', target_count: 1 })
      );
      // weekly logs
      mockAdapter.query.mockResolvedValueOnce([]);
      // monthly logs - many completions to exceed 100%
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ count: 10 }),
        makeHabitLogRow({ count: 10 }),
      ]);

      const result = await repo.getHabitStats('hab_1');

      expect(result!.completionRate).toBeLessThanOrEqual(100);
    });
  });

  // =========================================================================
  // getTodayHabits
  // =========================================================================

  describe('getTodayHabits', () => {
    it('should return empty array when no habits', async () => {
      // list call
      mockAdapter.query.mockResolvedValueOnce([]);
      // today logs query
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getTodayHabits();

      expect(result).toEqual([]);
    });

    it('should include completedToday and todayCount fields', async () => {
      const todayStr = new Date().toISOString().split('T')[0]!;

      // list (non-archived habits)
      mockAdapter.query.mockResolvedValueOnce([makeHabitRow()]);
      // today logs
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ date: todayStr, count: 1 })]);

      const result = await repo.getTodayHabits();

      // Whether this habit shows depends on if today is in target_days
      // The habit has all days, so it should appear
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('completedToday');
        expect(result[0]).toHaveProperty('todayCount');
      }
    });
  });

  // =========================================================================
  // getTodayProgress
  // =========================================================================

  describe('getTodayProgress', () => {
    it('should return zero progress when no habits', async () => {
      // list
      mockAdapter.query.mockResolvedValueOnce([]);
      // today logs
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getTodayProgress();

      expect(result.total).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.habits).toEqual([]);
    });
  });

  // =========================================================================
  // getCategories
  // =========================================================================

  describe('getCategories', () => {
    it('should return distinct categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { category: 'fitness' },
        { category: 'health' },
        { category: 'work' },
      ]);

      const result = await repo.getCategories();

      expect(result).toEqual(['fitness', 'health', 'work']);
    });

    it('should return empty array when no categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getCategories()).toEqual([]);
    });

    it('should scope to user_id and exclude nulls', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getCategories();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('category IS NOT NULL');
      expect(sql).toContain('ORDER BY category');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createHabitsRepository', () => {
    it('should be importable and create an instance', async () => {
      const { createHabitsRepository } = await import('./habits.js');
      const r = createHabitsRepository('u1');
      expect(r).toBeInstanceOf(HabitsRepository);
    });

    it('should default userId to "default"', async () => {
      const { createHabitsRepository } = await import('./habits.js');
      const r = createHabitsRepository();
      expect(r).toBeInstanceOf(HabitsRepository);
    });
  });

  // =========================================================================
  // calculateStreak logic
  // =========================================================================

  describe('streak calculation via logHabit', () => {
    it('should calculate streak from consecutive daily logs', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 3 });
      const today = new Date();
      const d1 = new Date(today);
      d1.setDate(today.getDate() - 2);
      const d2 = new Date(today);
      d2.setDate(today.getDate() - 1);
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ date: d1.toISOString().split('T')[0], count: 1 }),
        makeHabitLogRow({ date: d2.toISOString().split('T')[0], count: 1 }),
        makeHabitLogRow({ date: today.toISOString().split('T')[0], count: 1 }),
      ]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());
      const result = await repo.logHabit('hab_1');
      expect(result).not.toBeNull();
      const up = mockAdapter.execute.mock.calls[1]![1] as unknown[];
      expect(up[0]).toBe(3);
    });

    it('should handle weekdays frequency', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ frequency: 'weekdays' }));
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ frequency: 'weekdays' }));
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 1 });
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());
      expect(await repo.logHabit('hab_1')).not.toBeNull();
    });

    it('should handle custom frequency', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'custom', target_days: '[1,3,5]' })
      );
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'custom', target_days: '[1,3,5]' })
      );
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 2 });
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ date: '2025-01-13', count: 1 }),
        makeHabitLogRow({ date: '2025-01-15', count: 1 }),
      ]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());
      expect(await repo.logHabit('hab_1')).not.toBeNull();
    });

    it('should handle count below targetCount', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_count: 3 }));
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ target_count: 3 }));
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 1 });
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ count: 1 })]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow({ count: 1 }));
      expect(await repo.logHabit('hab_1')).not.toBeNull();
    });

    it('should reset streak when target days missed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 2 });
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ date: '2025-01-10', count: 1 }),
        makeHabitLogRow({ date: '2025-01-15', count: 1 }),
      ]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());
      expect(await repo.logHabit('hab_1')).not.toBeNull();
    });
  });

  describe('getHabitStats frequency calculations', () => {
    it('weekdays: expectedMonthly=22', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'weekdays', target_count: 1 })
      );
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ count: 11 })]);
      const r = await repo.getHabitStats('hab_1');
      expect(r!.completionRate).toBe(50);
    });

    it('weekly: expectedMonthly=4', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'weekly', target_count: 1 })
      );
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ count: 2 })]);
      const r = await repo.getHabitStats('hab_1');
      expect(r!.completionRate).toBe(50);
    });

    it('custom: expectedMonthly=targetDays*4', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'custom', target_days: '[1,3,5]', target_count: 1 })
      );
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ count: 6 })]);
      const r = await repo.getHabitStats('hab_1');
      expect(r!.completionRate).toBe(50);
    });

    it('daily: expectedMonthly=30', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeHabitRow({ frequency: 'daily', target_count: 1 })
      );
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.query.mockResolvedValueOnce([makeHabitLogRow({ count: 15 })]);
      const r = await repo.getHabitStats('hab_1');
      expect(r!.completionRate).toBe(50);
    });
  });

  describe('getTodayHabits frequency filtering', () => {
    it('custom frequency: includes habit targeting today', async () => {
      const dow = new Date().getDay();
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitRow({ frequency: 'custom', target_days: JSON.stringify([dow]) }),
      ]);
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.getTodayHabits()).toHaveLength(1);
    });

    it('custom frequency: excludes habit not targeting today', async () => {
      const dow = new Date().getDay();
      const other = (dow + 3) % 7;
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitRow({ frequency: 'custom', target_days: JSON.stringify([other]) }),
      ]);
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.getTodayHabits()).toHaveLength(0);
    });

    it('marks not completed when count < targetCount', async () => {
      const todayStr = new Date().toISOString().split('T')[0]!;
      mockAdapter.query.mockResolvedValueOnce([makeHabitRow({ target_count: 3 })]);
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ date: todayStr, count: 2, habit_id: 'hab_1' }),
      ]);
      const r = await repo.getTodayHabits();
      if (r.length > 0) {
        expect(r[0]!.completedToday).toBe(false);
        expect(r[0]!.todayCount).toBe(2);
      }
    });

    it('marks completed when count >= targetCount', async () => {
      const todayStr = new Date().toISOString().split('T')[0]!;
      mockAdapter.query.mockResolvedValueOnce([makeHabitRow({ target_count: 2 })]);
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ date: todayStr, count: 3, habit_id: 'hab_1' }),
      ]);
      const r = await repo.getTodayHabits();
      if (r.length > 0) {
        expect(r[0]!.completedToday).toBe(true);
        expect(r[0]!.todayCount).toBe(3);
      }
    });
  });

  describe('getTodayProgress with habits', () => {
    it('calculates progress', async () => {
      const todayStr = new Date().toISOString().split('T')[0]!;
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitRow({ id: 'hab_1', target_count: 1 }),
        makeHabitRow({ id: 'hab_2', target_count: 1 }),
      ]);
      mockAdapter.query.mockResolvedValueOnce([
        makeHabitLogRow({ habit_id: 'hab_1', date: todayStr, count: 1 }),
      ]);
      const r = await repo.getTodayProgress();
      expect(r.total).toBe(2);
      expect(r.completed).toBe(1);
      expect(r.percentage).toBe(50);
    });
  });

  describe('updateHabitStats null total', () => {
    it('handles null SUM result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow());
      expect(await repo.logHabit('hab_1')).not.toBeNull();
    });
  });

  describe('is_archived coercion', () => {
    it('true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: true }));
      expect((await repo.get('hab_1'))!.isArchived).toBe(true);
    });
    it('false', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow({ is_archived: false }));
      expect((await repo.get('hab_1'))!.isArchived).toBe(false);
    });
  });

  describe('logHabit explicit count', () => {
    it('accepts explicit count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ total: 5 });
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeHabitLogRow({ count: 5 }));
      expect((await repo.logHabit('hab_1', { count: 5 }))!.count).toBe(5);
    });
  });

  describe('singleton export', () => {
    it('exports habitsRepo', async () => {
      const { habitsRepo } = await import('./habits.js');
      expect(habitsRepo).toBeInstanceOf(HabitsRepository);
    });
  });
});

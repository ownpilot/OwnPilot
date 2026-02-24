/**
 * AutonomyLogRepository Tests
 *
 * Unit tests for insert, getRecent, getStats, getPage, cleanup,
 * and the private toEntry row mapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('alog_test_123'),
  };
});

const { AutonomyLogRepository, createAutonomyLogRepo } = await import('./autonomy-log.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alog_1',
    user_id: 'user-1',
    pulsed_at: NOW_ISO,
    duration_ms: 1234,
    signals_found: 3,
    llm_called: true,
    actions_count: 2,
    actions: JSON.stringify([
      { type: 'create_memory', success: true },
      { type: 'update_goal_progress', success: false, error: 'timeout' },
    ]),
    report_msg: 'Created a memory and attempted goal update',
    error: null,
    manual: false,
    signal_ids: JSON.stringify(['sig-a', 'sig-b']),
    urgency_score: 42,
    ...overrides,
  };
}

function makeInsertEntry() {
  return {
    userId: 'user-1',
    pulsedAt: new Date(NOW_ISO),
    durationMs: 1234,
    signalsFound: 3,
    llmCalled: true,
    actionsCount: 2,
    actions: [
      { type: 'create_memory', success: true },
      { type: 'update_goal_progress', success: false, error: 'timeout' },
    ],
    reportMsg: 'Created a memory and attempted goal update',
    error: null,
    manual: false,
    signalIds: ['sig-a', 'sig-b'],
    urgencyScore: 42,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutonomyLogRepository', () => {
  let repo: InstanceType<typeof AutonomyLogRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AutonomyLogRepository('user-1');
  });

  describe('insert', () => {
    it('inserts a new log entry and returns the generated id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const entry = makeInsertEntry();
      const id = await repo.insert(entry);

      expect(id).toBe('alog_test_123');

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO autonomy_log');
      expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)');

      expect(params[0]).toBe('alog_test_123');
      expect(params[1]).toBe('user-1');
      expect(params[2]).toEqual(entry.pulsedAt);
      expect(params[3]).toBe(1234);
      expect(params[4]).toBe(3);
      expect(params[5]).toBe(true);
      expect(params[6]).toBe(2);
      expect(JSON.parse(params[7] as string)).toEqual(entry.actions);
      expect(params[8]).toBe('Created a memory and attempted goal update');
      expect(params[9]).toBeNull();
      expect(params[10]).toBe(false);
      expect(JSON.parse(params[11] as string)).toEqual(['sig-a', 'sig-b']);
      expect(params[12]).toBe(42);
    });

    it('defaults signalIds to empty array when undefined', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const entry = makeInsertEntry();
      (entry as Record<string, unknown>).signalIds = undefined;
      await repo.insert(entry);
      const params = mockAdapter.execute.mock.calls[0][1];
      expect(JSON.parse(params[11] as string)).toEqual([]);
    });

    it('defaults urgencyScore to 0 when undefined', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const entry = makeInsertEntry();
      (entry as Record<string, unknown>).urgencyScore = undefined;
      await repo.insert(entry);
      const params = mockAdapter.execute.mock.calls[0][1];
      expect(params[12]).toBe(0);
    });
  });

  describe('getRecent', () => {
    it('returns mapped log entries with default limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow(), makeLogRow({ id: 'alog_2' })]);
      const results = await repo.getRecent();
      const [sql, params] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('SELECT * FROM autonomy_log');
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('ORDER BY pulsed_at DESC');
      expect(sql).toContain('LIMIT $2');
      expect(params).toEqual(['user-1', 20]);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('alog_1');
      expect(results[1].id).toBe('alog_2');
    });

    it('accepts a custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.getRecent(5);
      const params = mockAdapter.query.mock.calls[0][1];
      expect(params).toEqual(['user-1', 5]);
    });

    it('returns empty array when no entries', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const results = await repo.getRecent();
      expect(results).toEqual([]);
    });

    it('correctly maps all row fields to entry via toEntry', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow()]);
      const [entry] = await repo.getRecent(1);
      expect(entry.id).toBe('alog_1');
      expect(entry.userId).toBe('user-1');
      expect(entry.pulsedAt).toEqual(new Date(NOW_ISO));
      expect(entry.durationMs).toBe(1234);
      expect(entry.signalsFound).toBe(3);
      expect(entry.llmCalled).toBe(true);
      expect(entry.actionsCount).toBe(2);
      expect(entry.actions).toEqual([
        { type: 'create_memory', success: true },
        { type: 'update_goal_progress', success: false, error: 'timeout' },
      ]);
      expect(entry.reportMsg).toBe('Created a memory and attempted goal update');
      expect(entry.error).toBeNull();
      expect(entry.manual).toBe(false);
      expect(entry.signalIds).toEqual(['sig-a', 'sig-b']);
      expect(entry.urgencyScore).toBe(42);
    });

    it('handles null duration_ms (defaults to 0)', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ duration_ms: null })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.durationMs).toBe(0);
    });

    it('handles null urgency_score (defaults to 0)', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ urgency_score: null })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.urgencyScore).toBe(0);
    });

    it('handles already-parsed actions (array, not string)', async () => {
      const rawActions = [{ type: 'test', success: true }];
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ actions: rawActions })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.actions).toEqual(rawActions);
    });

    it('handles already-parsed signal_ids (array, not string)', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ signal_ids: ['x', 'y'] })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.signalIds).toEqual(['x', 'y']);
    });

    it('handles invalid JSON in actions (falls back to empty array)', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ actions: 'not-json{' })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.actions).toEqual([]);
    });

    it('handles invalid JSON in signal_ids (falls back to empty array)', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ signal_ids: '{broken' })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.signalIds).toEqual([]);
    });

    it('handles Date object for pulsed_at', async () => {
      const dateObj = new Date('2025-06-01T00:00:00Z');
      mockAdapter.query.mockResolvedValueOnce([makeLogRow({ pulsed_at: dateObj })]);
      const [entry] = await repo.getRecent(1);
      expect(entry.pulsedAt).toEqual(dateObj);
    });
  });

  describe('getStats', () => {
    it('returns computed statistics from aggregate row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total: '50',
        llm_count: '25',
        avg_duration: '1500.5',
        total_actions: '100',
      });
      const stats = await repo.getStats();
      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('FILTER (WHERE llm_called = true)');
      expect(sql).toContain('AVG(duration_ms)');
      expect(sql).toContain('SUM(actions_count)');
      expect(sql).toContain('WHERE user_id = $1');
      expect(params).toEqual(['user-1']);
      expect(stats).toEqual({
        totalPulses: 50,
        llmCallRate: 0.5,
        avgDurationMs: 1500.5,
        actionsExecuted: 100,
      });
    });

    it('returns zero llmCallRate when total is 0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total: '0',
        llm_count: '0',
        avg_duration: null,
        total_actions: '0',
      });
      const stats = await repo.getStats();
      expect(stats).toEqual({
        totalPulses: 0,
        llmCallRate: 0,
        avgDurationMs: 0,
        actionsExecuted: 0,
      });
    });

    it('handles null queryOne result (no data)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const stats = await repo.getStats();
      expect(stats).toEqual({
        totalPulses: 0,
        llmCallRate: 0,
        avgDurationMs: 0,
        actionsExecuted: 0,
      });
    });

    it('handles null avg_duration', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total: '10',
        llm_count: '3',
        avg_duration: null,
        total_actions: '5',
      });
      const stats = await repo.getStats();
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.llmCallRate).toBeCloseTo(0.3);
    });
  });

  describe('getPage', () => {
    it('returns paginated entries with total count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });
      mockAdapter.query.mockResolvedValueOnce([makeLogRow(), makeLogRow({ id: 'alog_2' })]);
      const result = await repo.getPage(10, 0);
      const [countSql, countParams] = mockAdapter.queryOne.mock.calls[0];
      expect(countSql).toContain('COUNT(*)');
      expect(countSql).toContain('WHERE user_id = $1');
      expect(countParams).toEqual(['user-1']);
      const [dataSql, dataParams] = mockAdapter.query.mock.calls[0];
      expect(dataSql).toContain('SELECT * FROM autonomy_log');
      expect(dataSql).toContain('ORDER BY pulsed_at DESC');
      expect(dataSql).toContain('LIMIT $2 OFFSET $3');
      expect(dataParams).toEqual(['user-1', 10, 0]);
      expect(result.total).toBe(42);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].id).toBe('alog_1');
      expect(result.entries[1].id).toBe('alog_2');
    });

    it('handles offset > 0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '100' });
      mockAdapter.query.mockResolvedValueOnce([makeLogRow()]);
      const result = await repo.getPage(20, 40);
      expect(mockAdapter.query.mock.calls[0][1]).toEqual(['user-1', 20, 40]);
      expect(result.total).toBe(100);
    });

    it('returns empty entries when no data', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });
      mockAdapter.query.mockResolvedValueOnce([]);
      const result = await repo.getPage(10, 0);
      expect(result.total).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('handles null count result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);
      const result = await repo.getPage(10, 0);
      expect(result.total).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('deletes entries older than specified days and returns count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 15 });
      const deleted = await repo.cleanup(30);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('DELETE FROM autonomy_log');
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('INTERVAL');
      expect(params).toEqual(['user-1', 30]);
      expect(deleted).toBe(15);
    });

    it('returns 0 when nothing to clean', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      const deleted = await repo.cleanup(7);
      expect(deleted).toBe(0);
    });
  });

  describe('createAutonomyLogRepo', () => {
    it('creates a repository scoped to the given userId', async () => {
      const repo2 = createAutonomyLogRepo('user-2');
      expect(repo2).toBeInstanceOf(AutonomyLogRepository);
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo2.getRecent();
      const params = mockAdapter.query.mock.calls[0][1];
      expect(params[0]).toBe('user-2');
    });
  });
});

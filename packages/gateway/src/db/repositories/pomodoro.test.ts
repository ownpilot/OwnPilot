/**
 * Pomodoro Repository Tests
 *
 * Unit tests for PomodoroRepository sessions, settings, daily stats,
 * streaks, and total stats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { PomodoroRepository } from './pomodoro.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pom_1',
    user_id: 'user-1',
    type: 'work',
    status: 'running',
    task_description: null,
    duration_minutes: 25,
    started_at: NOW,
    completed_at: null,
    interrupted_at: null,
    interruption_reason: null,
    ...overrides,
  };
}

function makeSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    work_duration: 25,
    short_break_duration: 5,
    long_break_duration: 15,
    sessions_before_long_break: 4,
    auto_start_breaks: false,
    auto_start_work: false,
    updated_at: NOW,
    ...overrides,
  };
}

function makeDailyStatsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pds_user-1_2025-01-15',
    user_id: 'user-1',
    date: '2025-01-15',
    completed_sessions: 3,
    total_work_minutes: 75,
    total_break_minutes: 15,
    interruptions: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PomodoroRepository', () => {
  let repo: PomodoroRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PomodoroRepository('user-1');
  });

  // =========================================================================
  // startSession
  // =========================================================================

  describe('startSession', () => {
    it('should insert a session and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.startSession({
        type: 'work',
        durationMinutes: 25,
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.type).toBe('work');
      expect(result.status).toBe('running');
      expect(result.durationMinutes).toBe(25);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('should accept optional taskDescription', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ task_description: 'Write tests' }),
      );

      const result = await repo.startSession({
        type: 'work',
        durationMinutes: 25,
        taskDescription: 'Write tests',
      });

      expect(result.taskDescription).toBe('Write tests');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.startSession({ type: 'work', durationMinutes: 25 }),
      ).rejects.toThrow('Failed to create pomodoro session');
    });

    it('should set status to running in the INSERT', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      await repo.startSession({ type: 'work', durationMinutes: 25 });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("'running'");
    });

    it('should pass null for missing taskDescription', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      await repo.startSession({ type: 'short_break', durationMinutes: 5 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // taskDescription is param index 3
      expect(params[3]).toBeNull();
    });
  });

  // =========================================================================
  // getSession
  // =========================================================================

  describe('getSession', () => {
    it('should return session when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.getSession('pom_1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('pom_1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getSession('missing')).toBeNull();
    });

    it('should parse dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({
          completed_at: NOW,
          interrupted_at: NOW,
        }),
      );

      const result = await repo.getSession('pom_1');

      expect(result!.startedAt).toBeInstanceOf(Date);
      expect(result!.completedAt).toBeInstanceOf(Date);
      expect(result!.interruptedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.getSession('pom_1');

      expect(result!.taskDescription).toBeUndefined();
      expect(result!.completedAt).toBeUndefined();
      expect(result!.interruptedAt).toBeUndefined();
      expect(result!.interruptionReason).toBeUndefined();
    });

    it('should scope query to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getSession('pom_1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['pom_1', 'user-1']);
    });
  });

  // =========================================================================
  // getActiveSession
  // =========================================================================

  describe('getActiveSession', () => {
    it('should return running session', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.getActiveSession();

      expect(result).not.toBeNull();
      expect(result!.status).toBe('running');
    });

    it('should return null when no active session', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getActiveSession()).toBeNull();
    });

    it('should filter by running status and user', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getActiveSession();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('ORDER BY started_at DESC');
      expect(sql).toContain('LIMIT 1');
    });
  });

  // =========================================================================
  // completeSession
  // =========================================================================

  describe('completeSession', () => {
    it('should return null when session not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.completeSession('missing')).toBeNull();
    });

    it('should return null when session is not running', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ status: 'completed' }),
      );

      expect(await repo.completeSession('pom_1')).toBeNull();
    });

    it('should set status to completed and update daily stats', async () => {
      // getSession (check status)
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateDailyStats -> query existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeDailyStatsRow());
      // updateDailyStats -> execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSession (return)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ status: 'completed', completed_at: NOW }),
      );

      const result = await repo.completeSession('pom_1');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.completedAt).toBeInstanceOf(Date);
    });

    it('should create new daily stats if none exist', async () => {
      // getSession
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());
      // execute update session
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateDailyStats -> no existing
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // updateDailyStats -> insert new
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSession (return)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ status: 'completed', completed_at: NOW }),
      );

      const result = await repo.completeSession('pom_1');

      expect(result!.status).toBe('completed');
      // Should have 2 execute calls: update session + insert daily stats
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // interruptSession
  // =========================================================================

  describe('interruptSession', () => {
    it('should return null when session not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.interruptSession('missing')).toBeNull();
    });

    it('should return null when session is not running', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ status: 'completed' }),
      );

      expect(await repo.interruptSession('pom_1')).toBeNull();
    });

    it('should set status to interrupted with reason', async () => {
      // getSession
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateDailyStats -> existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeDailyStatsRow());
      // updateDailyStats -> execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSession (return)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({
          status: 'interrupted',
          interrupted_at: NOW,
          interruption_reason: 'Meeting',
        }),
      );

      const result = await repo.interruptSession('pom_1', 'Meeting');

      expect(result!.status).toBe('interrupted');
      expect(result!.interruptionReason).toBe('Meeting');
    });

    it('should handle no reason provided', async () => {
      // getSession
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // updateDailyStats -> existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeDailyStatsRow());
      // updateDailyStats -> execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSession (return)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ status: 'interrupted', interrupted_at: NOW }),
      );

      await repo.interruptSession('pom_1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // reason param should be null
      expect(params[1]).toBeNull();
    });
  });

  // =========================================================================
  // listSessions
  // =========================================================================

  describe('listSessions', () => {
    it('should return empty array when no sessions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.listSessions()).toEqual([]);
    });

    it('should return mapped sessions', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSessionRow(),
        makeSessionRow({ id: 'pom_2', type: 'short_break' }),
      ]);

      const result = await repo.listSessions();

      expect(result).toHaveLength(2);
      expect(result[0]!.type).toBe('work');
      expect(result[1]!.type).toBe('short_break');
    });

    it('should filter by type', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listSessions({ type: 'work' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('work');
    });

    it('should filter by status', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listSessions({ status: 'completed' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('completed');
    });

    it('should apply limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listSessions({ limit: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('should order by started_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listSessions();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY started_at DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listSessions({ type: 'work', status: 'completed', limit: 5 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('type = $');
      expect(sql).toContain('status = $');
      expect(sql).toContain('LIMIT');
    });
  });

  // =========================================================================
  // getSettings
  // =========================================================================

  describe('getSettings', () => {
    it('should return settings when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());

      const result = await repo.getSettings();

      expect(result.userId).toBe('user-1');
      expect(result.workDuration).toBe(25);
      expect(result.shortBreakDuration).toBe(5);
      expect(result.longBreakDuration).toBe(15);
      expect(result.sessionsBeforeLongBreak).toBe(4);
      expect(result.autoStartBreaks).toBe(false);
      expect(result.autoStartWork).toBe(false);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should create default settings when not found', async () => {
      // First getSettings call -> null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // createDefaultSettings -> execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // Recursive getSettings call -> returns settings
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());

      const result = await repo.getSettings();

      expect(result.workDuration).toBe(25);
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // updateSettings
  // =========================================================================

  describe('updateSettings', () => {
    it('should update settings and return them', async () => {
      // getSettings -> existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSettings (return)
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow({ work_duration: 30 }));

      const result = await repo.updateSettings({ workDuration: 30 });

      expect(result.workDuration).toBe(30);
    });

    it('should pass null for unset fields in COALESCE', async () => {
      // getSettings
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSettings (return)
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());

      await repo.updateSettings({ workDuration: 30 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(30);
      expect(params[1]).toBeNull(); // shortBreakDuration
      expect(params[2]).toBeNull(); // longBreakDuration
      expect(params[3]).toBeNull(); // sessionsBeforeLongBreak
      expect(params[4]).toBeNull(); // autoStartBreaks
      expect(params[5]).toBeNull(); // autoStartWork
    });

    it('should update multiple settings at once', async () => {
      // getSettings
      mockAdapter.queryOne.mockResolvedValueOnce(makeSettingsRow());
      // execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getSettings (return)
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSettingsRow({
          work_duration: 30,
          short_break_duration: 10,
          auto_start_breaks: true,
        }),
      );

      const result = await repo.updateSettings({
        workDuration: 30,
        shortBreakDuration: 10,
        autoStartBreaks: true,
      });

      expect(result.workDuration).toBe(30);
      expect(result.shortBreakDuration).toBe(10);
      expect(result.autoStartBreaks).toBe(true);
    });
  });

  // =========================================================================
  // getDailyStats
  // =========================================================================

  describe('getDailyStats', () => {
    it('should return stats for specific date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDailyStatsRow());

      const result = await repo.getDailyStats('2025-01-15');

      expect(result).not.toBeNull();
      expect(result!.date).toBe('2025-01-15');
      expect(result!.completedSessions).toBe(3);
      expect(result!.totalWorkMinutes).toBe(75);
      expect(result!.totalBreakMinutes).toBe(15);
      expect(result!.interruptions).toBe(1);
    });

    it('should return null when no stats for date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getDailyStats('2025-01-01')).toBeNull();
    });

    it('should default to today when no date provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getDailyStats();

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      const todayStr = new Date().toISOString().split('T')[0]!;
      expect(params[1]).toBe(todayStr);
    });
  });

  // =========================================================================
  // getStatsRange
  // =========================================================================

  describe('getStatsRange', () => {
    it('should return stats for date range', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeDailyStatsRow({ date: '2025-01-14' }),
        makeDailyStatsRow({ date: '2025-01-15' }),
      ]);

      const result = await repo.getStatsRange('2025-01-14', '2025-01-15');

      expect(result).toHaveLength(2);
      expect(result[0]!.date).toBe('2025-01-14');
      expect(result[1]!.date).toBe('2025-01-15');
    });

    it('should return empty array when no stats in range', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getStatsRange('2025-02-01', '2025-02-28')).toEqual([]);
    });

    it('should filter by user_id, startDate, and endDate', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getStatsRange('2025-01-01', '2025-01-31');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('date >= $2');
      expect(sql).toContain('date <= $3');
      expect(sql).toContain('ORDER BY date ASC');
    });
  });

  // =========================================================================
  // getStreak
  // =========================================================================

  describe('getStreak', () => {
    it('should return 0 when no stats', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getStreak()).toBe(0);
    });

    it('should return streak count for consecutive days', async () => {
      // Build date strings using local date formatting to match how
      // getStreak() constructs "today" via new Date() + setHours(0,0,0,0)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);

      // Format as YYYY-MM-DD using local date parts (not UTC)
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      mockAdapter.query.mockResolvedValueOnce([
        makeDailyStatsRow({
          date: fmt(today),
          completed_sessions: 2,
        }),
        makeDailyStatsRow({
          date: fmt(yesterday),
          completed_sessions: 1,
        }),
        makeDailyStatsRow({
          date: fmt(twoDaysAgo),
          completed_sessions: 3,
        }),
      ]);

      const streak = await repo.getStreak();

      expect(streak).toBe(3);
    });

    it('should return 0 when last session was more than 1 day ago', async () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      mockAdapter.query.mockResolvedValueOnce([
        makeDailyStatsRow({
          date: fmt(threeDaysAgo),
          completed_sessions: 1,
        }),
      ]);

      const streak = await repo.getStreak();

      expect(streak).toBe(0);
    });

    it('should query for completed_sessions > 0 ordered by date DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getStreak();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_sessions > 0');
      expect(sql).toContain('ORDER BY date DESC');
    });
  });

  // =========================================================================
  // getTotalStats
  // =========================================================================

  describe('getTotalStats', () => {
    it('should return aggregated totals', async () => {
      // SUM query
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_sessions: 50,
        total_work: 1250,
        total_break: 250,
        total_interruptions: 10,
      });
      // getStreak -> query
      mockAdapter.query.mockResolvedValueOnce([]);
      // best streak -> query
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getTotalStats();

      expect(result.totalSessions).toBe(50);
      expect(result.totalWorkMinutes).toBe(1250);
      expect(result.totalBreakMinutes).toBe(250);
      expect(result.totalInterruptions).toBe(10);
      expect(result.currentStreak).toBe(0);
      expect(result.bestStreak).toBe(0);
    });

    it('should return zeros when no data', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // getStreak
      mockAdapter.query.mockResolvedValueOnce([]);
      // best streak
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getTotalStats();

      expect(result.totalSessions).toBe(0);
      expect(result.totalWorkMinutes).toBe(0);
      expect(result.totalBreakMinutes).toBe(0);
      expect(result.totalInterruptions).toBe(0);
    });

    it('should calculate best streak from consecutive dates', async () => {
      // SUM query
      mockAdapter.queryOne.mockResolvedValueOnce({
        total_sessions: 5,
        total_work: 125,
        total_break: 25,
        total_interruptions: 2,
      });
      // getStreak -> query (DESC)
      mockAdapter.query.mockResolvedValueOnce([]);
      // best streak -> query (ASC)
      mockAdapter.query.mockResolvedValueOnce([
        makeDailyStatsRow({ date: '2025-01-10', completed_sessions: 1 }),
        makeDailyStatsRow({ date: '2025-01-11', completed_sessions: 2 }),
        makeDailyStatsRow({ date: '2025-01-12', completed_sessions: 1 }),
        // gap
        makeDailyStatsRow({ date: '2025-01-14', completed_sessions: 1 }),
      ]);

      const result = await repo.getTotalStats();

      expect(result.bestStreak).toBe(3); // Jan 10-12
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createPomodoroRepository', () => {
    it('should be importable and create an instance', async () => {
      const { createPomodoroRepository } = await import('./pomodoro.js');
      const r = createPomodoroRepository('u1');
      expect(r).toBeInstanceOf(PomodoroRepository);
    });

    it('should default userId to "default"', async () => {
      const { createPomodoroRepository } = await import('./pomodoro.js');
      const r = createPomodoroRepository();
      expect(r).toBeInstanceOf(PomodoroRepository);
    });
  });
});

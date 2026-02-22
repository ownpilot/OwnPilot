/**
 * Calendar Repository Tests
 *
 * Unit tests for CalendarRepository CRUD, date range queries, recurring events,
 * search, and pagination.
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

import { CalendarRepository } from './calendar.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    user_id: 'user-1',
    title: 'Team Meeting',
    description: null,
    location: null,
    start_time: '2025-01-20T10:00:00.000Z',
    end_time: '2025-01-20T11:00:00.000Z',
    all_day: false,
    timezone: 'UTC',
    recurrence: null,
    reminder_minutes: null,
    category: null,
    tags: '[]',
    color: null,
    external_id: null,
    external_source: null,
    attendees: '[]',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalendarRepository', () => {
  let repo: CalendarRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CalendarRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert an event and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      const result = await repo.create({
        title: 'Team Meeting',
        startTime: '2025-01-20T10:00:00.000Z',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.title).toBe('Team Meeting');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.allDay).toBe(false);
      expect(result.timezone).toBe('UTC');
      expect(result.tags).toEqual([]);
      expect(result.attendees).toEqual([]);
    });

    it('should accept Date objects for startTime and endTime', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      await repo.create({
        title: 'Meeting',
        startTime: new Date('2025-01-20T10:00:00.000Z'),
        endTime: new Date('2025-01-20T11:00:00.000Z'),
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // startTime and endTime should be ISO strings
      expect(params[5]).toBe('2025-01-20T10:00:00.000Z');
      expect(params[6]).toBe('2025-01-20T11:00:00.000Z');
    });

    it('should accept string dates for startTime and endTime', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      await repo.create({
        title: 'Meeting',
        startTime: '2025-01-20T10:00:00.000Z',
        endTime: '2025-01-20T11:00:00.000Z',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('2025-01-20T10:00:00.000Z');
      expect(params[6]).toBe('2025-01-20T11:00:00.000Z');
    });

    it('should store all optional fields', async () => {
      const row = makeEventRow({
        description: 'Weekly standup',
        location: 'Room A',
        all_day: true,
        timezone: 'America/New_York',
        recurrence: 'RRULE:FREQ=WEEKLY',
        reminder_minutes: 15,
        category: 'work',
        tags: '["meeting"]',
        color: '#0000ff',
        external_id: 'ext-123',
        external_source: 'google',
        attendees: '["alice@example.com"]',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        title: 'Meeting',
        startTime: '2025-01-20T10:00:00.000Z',
        description: 'Weekly standup',
        location: 'Room A',
        allDay: true,
        timezone: 'America/New_York',
        recurrence: 'RRULE:FREQ=WEEKLY',
        reminderMinutes: 15,
        category: 'work',
        tags: ['meeting'],
        color: '#0000ff',
        externalId: 'ext-123',
        externalSource: 'google',
        attendees: ['alice@example.com'],
      });

      expect(result.description).toBe('Weekly standup');
      expect(result.location).toBe('Room A');
      expect(result.allDay).toBe(true);
      expect(result.recurrence).toBe('RRULE:FREQ=WEEKLY');
      expect(result.reminderMinutes).toBe(15);
      expect(result.attendees).toEqual(['alice@example.com']);
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ title: 'X', startTime: NOW })).rejects.toThrow(
        'Failed to create calendar event'
      );
    });

    it('should default timezone to UTC', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      await repo.create({ title: 'Test', startTime: NOW });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe('UTC');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return an event when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      const result = await repo.get('evt-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('evt-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      const result = await repo.get('evt-1');

      expect(result!.startTime).toBeInstanceOf(Date);
      expect(result!.endTime).toBeInstanceOf(Date);
      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should leave endTime undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow({ end_time: null }));

      const result = await repo.get('evt-1');

      expect(result!.endTime).toBeUndefined();
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      const result = await repo.get('evt-1');

      expect(result!.description).toBeUndefined();
      expect(result!.location).toBeUndefined();
      expect(result!.recurrence).toBeUndefined();
      expect(result!.reminderMinutes).toBeUndefined();
      expect(result!.category).toBeUndefined();
    });
  });

  // =========================================================================
  // getByExternalId
  // =========================================================================

  describe('getByExternalId', () => {
    it('should query by external_id, external_source, and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeEventRow({ external_id: 'ext-1', external_source: 'google' })
      );

      const result = await repo.getByExternalId('ext-1', 'google');

      expect(result).not.toBeNull();
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('external_id = $1');
      expect(sql).toContain('external_source = $2');
      expect(sql).toContain('user_id = $3');
    });

    it('should return null for unknown external ID', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByExternalId('unknown', 'google')).toBeNull();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated event', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow({ title: 'Updated' }));

      const result = await repo.update('evt-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null if event does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { title: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      const result = await repo.update('evt-1', {});

      expect(result!.id).toBe('evt-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should convert Date to ISO string for startTime update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      await repo.update('evt-1', {
        startTime: new Date('2025-03-01T09:00:00.000Z'),
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('2025-03-01T09:00:00.000Z');
    });

    it('should serialize tags and attendees on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());

      await repo.update('evt-1', {
        tags: ['important'],
        attendees: ['bob@example.com'],
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('["important"]');
      expect(params[1]).toBe('["bob@example.com"]');
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeEventRow({ title: 'New Title', location: 'Room B', reminder_minutes: 30 })
      );

      const result = await repo.update('evt-1', {
        title: 'New Title',
        location: 'Room B',
        reminderMinutes: 30,
      });

      expect(result!.title).toBe('New Title');
      expect(result!.location).toBe('Room B');
      expect(result!.reminderMinutes).toBe(30);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('evt-1')).toBe(true);
    });

    it('should return false when event not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('evt-1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['evt-1', 'user-1']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no events', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped events', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeEventRow({ id: 'evt-1' }),
        makeEventRow({ id: 'evt-2', title: 'Second' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
    });

    it('should filter by startAfter with string', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ startAfter: '2025-01-01T00:00:00.000Z' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
    });

    it('should filter by startAfter with Date', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ startAfter: new Date('2025-01-01') });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
    });

    it('should filter by startBefore', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ startBefore: '2025-02-01T00:00:00.000Z' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time <= $');
    });

    it('should filter by date range (startAfter + startBefore)', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({
        startAfter: '2025-01-01T00:00:00.000Z',
        startBefore: '2025-01-31T23:59:59.000Z',
      });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
      expect(sql).toContain('start_time <= $');
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'work' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
    });

    it('should search by title, description, and location', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'standup' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('title ILIKE');
      expect(sql).toContain('description ILIKE');
      expect(sql).toContain('location ILIKE');
    });

    it('should apply pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should order by start_time ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY start_time ASC');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '50%_off' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%50\\%\\_off%');
    });
  });

  // =========================================================================
  // Date range convenience methods
  // =========================================================================

  describe('getToday', () => {
    it('should query for today date range', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getToday();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
      expect(sql).toContain('start_time <= $');
    });
  });

  describe('getUpcoming', () => {
    it('should query for upcoming events within N days', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getUpcoming(14);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
      expect(sql).toContain('start_time <= $');
    });

    it('should default to 7 days', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getUpcoming();

      // Just verify it runs without error and queries correctly
      expect(mockAdapter.query).toHaveBeenCalledOnce();
    });
  });

  describe('getByDateRange', () => {
    it('should query for events in the given range', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const start = new Date('2025-01-01');
      const end = new Date('2025-01-31');
      await repo.getByDateRange(start, end);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('start_time >= $');
      expect(sql).toContain('start_time <= $');
    });
  });

  // =========================================================================
  // Recurring events
  // =========================================================================

  describe('recurring events', () => {
    it('should store recurrence rule on create', async () => {
      const row = makeEventRow({ recurrence: 'RRULE:FREQ=DAILY' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        title: 'Daily Standup',
        startTime: '2025-01-20T09:00:00.000Z',
        recurrence: 'RRULE:FREQ=DAILY',
      });

      expect(result.recurrence).toBe('RRULE:FREQ=DAILY');
    });

    it('should update recurrence rule', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow({ recurrence: 'RRULE:FREQ=DAILY' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow({ recurrence: 'RRULE:FREQ=WEEKLY' }));

      const result = await repo.update('evt-1', { recurrence: 'RRULE:FREQ=WEEKLY' });

      expect(result!.recurrence).toBe('RRULE:FREQ=WEEKLY');
    });

    it('should return recurrence as undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeEventRow({ recurrence: null }));

      const result = await repo.get('evt-1');

      expect(result!.recurrence).toBeUndefined();
    });
  });

  // =========================================================================
  // getUpcomingReminders
  // =========================================================================

  describe('getUpcomingReminders', () => {
    it('should query events with upcoming reminders', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getUpcomingReminders(30);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('reminder_minutes IS NOT NULL');
      expect(sql).toContain('start_time >');
    });

    it('should default to 30 minutes', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getUpcomingReminders();

      expect(mockAdapter.query).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Other methods
  // =========================================================================

  describe('getCategories', () => {
    it('should return distinct categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ category: 'personal' }, { category: 'work' }]);

      expect(await repo.getCategories()).toEqual(['personal', 'work']);
    });
  });

  describe('count', () => {
    it('should return count of events', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '12' });

      expect(await repo.count()).toBe(12);
    });

    it('should return 0 when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('should delegate to list with search and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('standup', 10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%standup%');
      expect(params).toContain(10);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createCalendarRepository', () => {
    it('should be importable', async () => {
      const { createCalendarRepository } = await import('./calendar.js');
      const r = createCalendarRepository('u1');
      expect(r).toBeInstanceOf(CalendarRepository);
    });
  });
});

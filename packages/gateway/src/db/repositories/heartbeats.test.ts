/**
 * Heartbeats Repository Tests
 *
 * Unit tests for HeartbeatsRepository CRUD, filtering, and JSON parsing.
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

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@ownpilot/core', () => ({
  generateId: vi.fn().mockReturnValue('hb-generated-id'),
}));

const { HeartbeatsRepository, createHeartbeatsRepository } = await import('./heartbeats.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hb-1',
    user_id: 'default',
    name: 'Test Beat',
    schedule_text: 'every day',
    cron: '0 9 * * *',
    task_description: 'Do something',
    trigger_id: null,
    enabled: true,
    tags: '[]',
    metadata: '{}',
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatsRepository', () => {
  let repo: InstanceType<typeof HeartbeatsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new HeartbeatsRepository('default');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a heartbeat and return it', async () => {
      const row = makeRow({ id: 'hb-generated-id' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        name: 'Test Beat',
        scheduleText: 'every day',
        cron: '0 9 * * *',
        taskDescription: 'Do something',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('hb-generated-id');
      expect(result.name).toBe('Test Beat');
      expect(result.cron).toBe('0 9 * * *');
      expect(result.tags).toEqual([]);
      expect(result.metadata).toEqual({});
    });

    it('should serialize tags and metadata as JSON', async () => {
      const row = makeRow({
        id: 'hb-generated-id',
        tags: '["tag1","tag2"]',
        metadata: '{"key":"value"}',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        name: 'Test',
        scheduleText: 'daily',
        cron: '0 0 * * *',
        taskDescription: 'task',
        tags: ['tag1', 'tag2'],
        metadata: { key: 'value' },
      });

      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.metadata).toEqual({ key: 'value' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe('["tag1","tag2"]');
      expect(params[9]).toBe('{"key":"value"}');
    });

    it('should default enabled to true', async () => {
      const row = makeRow({ id: 'hb-generated-id' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({
        name: 'Test',
        scheduleText: 'daily',
        cron: '0 0 * * *',
        taskDescription: 'task',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[7]).toBe(true); // enabled !== false → true
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          name: 'Test',
          scheduleText: 'daily',
          cron: '0 0 * * *',
          taskDescription: 'task',
        })
      ).rejects.toThrow('Failed to create heartbeat');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a heartbeat when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const result = await repo.get('hb-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('hb-1');
      expect(result!.userId).toBe('default');
      expect(result!.scheduleText).toBe('every day');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should include user_id in the query', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('hb-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['hb-1', 'default']);
    });

    it('should parse dates as Date objects', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const result = await repo.get('hb-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated heartbeat', async () => {
      const original = makeRow();
      const updated = makeRow({ name: 'Updated Beat' });

      // get existing
      mockAdapter.queryOne.mockResolvedValueOnce(original);
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get updated
      mockAdapter.queryOne.mockResolvedValueOnce(updated);

      const result = await repo.update('hb-1', { name: 'Updated Beat' });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated Beat');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when heartbeat does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('nonexistent', { name: 'New' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize tags and metadata on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeRow({ tags: '["a","b"]', metadata: '{"x":1}' })
      );

      await repo.update('hb-1', { tags: ['a', 'b'], metadata: { x: 1 } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // updated_at is $1, tags is next, metadata is next
      expect(params).toContain('["a","b"]');
      expect(params).toContain('{"x":1}');
    });

    it('should build dynamic SET clause for partial updates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ cron: '0 0 * * *', enabled: false }));

      await repo.update('hb-1', { cron: '0 0 * * *', enabled: false });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('cron = $');
      expect(sql).toContain('enabled = $');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('hb-1')).toBe(true);
    });

    it('should return false when heartbeat not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('nonexistent')).toBe(false);
    });

    it('should include user_id in the WHERE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('hb-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['hb-1', 'default']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no heartbeats', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result).toEqual([]);
    });

    it('should return mapped heartbeats', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ id: 'hb-1' }),
        makeRow({ id: 'hb-2', name: 'Second' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('hb-1');
      expect(result[1]!.id).toBe('hb-2');
    });

    it('should filter by enabled', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ enabled: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('enabled = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(true);
    });

    it('should apply LIMIT and OFFSET', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should not add enabled filter when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({});

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('enabled = $');
    });
  });

  // =========================================================================
  // getByTriggerId
  // =========================================================================

  describe('getByTriggerId', () => {
    it('should return a heartbeat when found by trigger_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ trigger_id: 'tr-1' }));

      const result = await repo.getByTriggerId('tr-1');

      expect(result).not.toBeNull();
      expect(result!.triggerId).toBe('tr-1');
    });

    it('should return null when trigger_id not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getByTriggerId('tr-unknown');

      expect(result).toBeNull();
    });

    it('should query by trigger_id and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getByTriggerId('tr-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('trigger_id = $1');
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['tr-1', 'default']);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count of heartbeats', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      expect(await repo.count()).toBe(42);
    });

    it('should return 0 when no rows', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should filter by enabled when provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      await repo.count(true);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('enabled = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', true]);
    });

    it('should not filter by enabled when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '10' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).not.toContain('enabled = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });
  });

  // =========================================================================
  // JSON parsing
  // =========================================================================

  describe('JSON parsing', () => {
    it('should parse tags from JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ tags: '["a","b","c"]' }));

      const result = await repo.get('hb-1');

      expect(result!.tags).toEqual(['a', 'b', 'c']);
    });

    it('should parse metadata from JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ metadata: '{"key":"value","num":42}' }));

      const result = await repo.get('hb-1');

      expect(result!.metadata).toEqual({ key: 'value', num: 42 });
    });

    it('should fallback to defaults for invalid JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeRow({ tags: 'invalid-json', metadata: 'bad' })
      );

      const result = await repo.get('hb-1');

      expect(result!.tags).toEqual([]);
      expect(result!.metadata).toEqual({});
    });

    it('should handle already-parsed JSON (PostgreSQL JSONB)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ tags: ['x', 'y'], metadata: { z: 1 } }));

      const result = await repo.get('hb-1');

      expect(result!.tags).toEqual(['x', 'y']);
      expect(result!.metadata).toEqual({ z: 1 });
    });
  });

  // =========================================================================
  // Factory function
  // =========================================================================

  describe('createHeartbeatsRepository', () => {
    it('should create a HeartbeatsRepository with the given userId', () => {
      const r = createHeartbeatsRepository('user-42');
      expect(r).toBeInstanceOf(HeartbeatsRepository);
    });

    it('should default userId to "default"', () => {
      const r = createHeartbeatsRepository();
      expect(r).toBeInstanceOf(HeartbeatsRepository);
    });
  });
});

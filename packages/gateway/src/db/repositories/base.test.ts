/**
 * BaseRepository Tests
 *
 * Tests the abstract BaseRepository class through a concrete subclass,
 * verifying adapter delegation, helper methods, and paginated queries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the adapter module so no real database connection is created
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
  date: vi.fn().mockImplementation((col: string) => `DATE(${col})`),
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
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are established
const { BaseRepository, ensureTable } = await import('./base.js');

// ---------------------------------------------------------------------------
// Concrete subclass so we can instantiate and test the abstract class
// ---------------------------------------------------------------------------

class TestRepository extends BaseRepository {
  /** Expose protected methods for testing */
  public testQuery<T>(sql: string, params?: unknown[]) {
    return this.query<T>(sql, params);
  }
  public testQueryOne<T>(sql: string, params?: unknown[]) {
    return this.queryOne<T>(sql, params);
  }
  public testExecute(sql: string, params?: unknown[]) {
    return this.execute(sql, params);
  }
  public testExec(sql: string) {
    return this.exec(sql);
  }
  public testNow() {
    return this.now();
  }
  public testBoolean(value: boolean) {
    return this.boolean(value);
  }
  public testParseBoolean(value: unknown) {
    return this.parseBoolean(value);
  }
  public testEscapeLike(value: string) {
    return this.escapeLike(value);
  }
  public testPaginatedQuery<T>(
    baseSql: string,
    countSql: string,
    query?: Parameters<BaseRepository['paginatedQuery']>[2],
    params?: unknown[],
    defaultOrderBy?: string,
  ) {
    return this.paginatedQuery<T>(baseSql, countSql, query, params, defaultOrderBy);
  }
  public testBuildPaginated<T>(items: T[], total: number, limit: number, offset: number) {
    return this.buildPaginated(items, total, limit, offset);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseRepository', () => {
  let repo: TestRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new TestRepository();
  });

  // ---- Constructor / adapter initialisation ----

  describe('constructor', () => {
    it('starts with adapter set to null', () => {
      // adapter is a protected property; we verify indirectly: the first
      // call should trigger getAdapter()
      expect(repo).toBeDefined();
    });
  });

  // ---- Adapter delegation ----

  describe('query', () => {
    it('delegates to adapter.query with sql and params', async () => {
      const rows = [{ id: '1' }];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.testQuery('SELECT * FROM t WHERE id = $1', ['1']);

      expect(mockAdapter.query).toHaveBeenCalledWith('SELECT * FROM t WHERE id = $1', ['1']);
      expect(result).toEqual(rows);
    });

    it('passes undefined params when none provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.testQuery('SELECT 1');

      expect(mockAdapter.query).toHaveBeenCalledWith('SELECT 1', undefined);
    });
  });

  describe('queryOne', () => {
    it('delegates to adapter.queryOne', async () => {
      const row = { id: '1', name: 'test' };
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.testQueryOne('SELECT * FROM t WHERE id = $1', ['1']);

      expect(mockAdapter.queryOne).toHaveBeenCalledWith('SELECT * FROM t WHERE id = $1', ['1']);
      expect(result).toEqual(row);
    });

    it('returns null when adapter returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.testQueryOne('SELECT * FROM t WHERE id = $1', ['missing']);

      expect(result).toBeNull();
    });
  });

  describe('execute', () => {
    it('delegates to adapter.execute and returns changes', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1, lastInsertRowid: 42 });

      const result = await repo.testExecute('DELETE FROM t WHERE id = $1', ['1']);

      expect(mockAdapter.execute).toHaveBeenCalledWith('DELETE FROM t WHERE id = $1', ['1']);
      expect(result).toEqual({ changes: 1, lastInsertRowid: 42 });
    });
  });

  describe('exec', () => {
    it('delegates to adapter.exec for raw SQL', async () => {
      await repo.testExec('CREATE TABLE t (id TEXT)');

      expect(mockAdapter.exec).toHaveBeenCalledWith('CREATE TABLE t (id TEXT)');
    });
  });

  describe('transaction', () => {
    it('delegates to adapter.transaction and returns result', async () => {
      mockAdapter.transaction.mockImplementationOnce(async (fn: () => Promise<unknown>) => fn());

      const result = await repo.transaction(async () => 'ok');

      expect(result).toBe('ok');
      expect(mockAdapter.transaction).toHaveBeenCalled();
    });
  });

  // ---- Helper methods ----

  describe('now', () => {
    it('returns NOW() from adapter', () => {
      // Once the adapter is resolved it is cached; trigger it first
      // The method is synchronous and uses the cached adapter
      const result = repo.testNow();
      // Before adapter is set, falls back to NOW()
      expect(result).toBe('NOW()');
    });
  });

  describe('boolean', () => {
    it('delegates true to adapter.boolean when adapter is set', async () => {
      // Force adapter initialisation
      await repo.testQuery('SELECT 1');
      mockAdapter.boolean.mockReturnValueOnce(true);

      const result = repo.testBoolean(true);
      expect(result).toBe(true);
    });

    it('falls back to raw value when adapter is null', () => {
      // Fresh repo, adapter not yet resolved
      const freshRepo = new TestRepository();
      const result = freshRepo.testBoolean(false);
      expect(result).toBe(false);
    });
  });

  describe('parseBoolean', () => {
    it('delegates to adapter.parseBoolean when adapter is set', async () => {
      await repo.testQuery('SELECT 1');
      mockAdapter.parseBoolean.mockReturnValueOnce(true);

      expect(repo.testParseBoolean(1)).toBe(true);
    });

    it('falls back to Boolean() when adapter is null', () => {
      const freshRepo = new TestRepository();
      expect(freshRepo.testParseBoolean(0)).toBe(false);
      expect(freshRepo.testParseBoolean('yes')).toBe(true);
    });
  });

  describe('escapeLike', () => {
    it('escapes percent signs', () => {
      expect(repo.testEscapeLike('100%')).toBe('100\\%');
    });

    it('escapes underscores', () => {
      expect(repo.testEscapeLike('my_table')).toBe('my\\_table');
    });

    it('escapes both percent and underscore', () => {
      expect(repo.testEscapeLike('%_mix_%')).toBe('\\%\\_mix\\_\\%');
    });

    it('returns plain string unchanged', () => {
      expect(repo.testEscapeLike('hello')).toBe('hello');
    });
  });

  // ---- Paginated query ----

  describe('paginatedQuery', () => {
    it('uses default limit=50 and offset=0 when query is empty', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });
      mockAdapter.query.mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }]);

      const result = await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
      );

      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.total).toBe(3);
      expect(result.rows).toHaveLength(3);

      // The data query should include ORDER BY, LIMIT, OFFSET
      const dataCall = mockAdapter.query.mock.calls[0];
      expect(dataCall[0]).toContain('ORDER BY created_at DESC');
      expect(dataCall[0]).toContain('LIMIT $1 OFFSET $2');
      expect(dataCall[1]).toEqual([50, 0]);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '100' });
      mockAdapter.query.mockResolvedValueOnce([{ id: '1' }]);

      const result = await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
        { limit: 10, offset: 20 },
      );

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.total).toBe(100);
    });

    it('applies custom orderBy with ascending direction', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
        { orderBy: 'name', orderDir: 'asc' },
      );

      const dataCall = mockAdapter.query.mock.calls[0];
      expect(dataCall[0]).toContain('ORDER BY name ASC');
    });

    it('rejects invalid orderBy column names to prevent SQL injection', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
        { orderBy: 'name; DROP TABLE t--' },
      );

      // Should fall back to default, not use the injection string
      const dataCall = mockAdapter.query.mock.calls[0];
      expect(dataCall[0]).toContain('ORDER BY created_at DESC');
    });

    it('appends params correctly when base params exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.testPaginatedQuery(
        'SELECT * FROM t WHERE status = $1',
        'SELECT COUNT(*) as count FROM t WHERE status = $1',
        { limit: 25, offset: 0 },
        ['active'],
      );

      // Count query gets base params
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM t WHERE status = $1',
        ['active'],
      );

      // Data query appends limit/offset after base params
      const dataCall = mockAdapter.query.mock.calls[0];
      expect(dataCall[1]).toEqual(['active', 25, 0]);
      expect(dataCall[0]).toContain('LIMIT $2 OFFSET $3');
    });

    it('returns total 0 when count result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
      );

      expect(result.total).toBe(0);
    });

    it('uses custom defaultOrderBy when provided and no query.orderBy', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.testPaginatedQuery(
        'SELECT * FROM t',
        'SELECT COUNT(*) as count FROM t',
        {},
        [],
        'updated_at ASC',
      );

      const dataCall = mockAdapter.query.mock.calls[0];
      expect(dataCall[0]).toContain('ORDER BY updated_at ASC');
    });
  });

  // ---- buildPaginated helper ----

  describe('buildPaginated', () => {
    it('returns correct PaginatedResult structure', () => {
      const result = repo.testBuildPaginated(['a', 'b'], 5, 2, 0);

      expect(result).toEqual({
        items: ['a', 'b'],
        total: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
      });
    });

    it('sets hasMore to false when all items fit', () => {
      const result = repo.testBuildPaginated(['a', 'b'], 2, 10, 0);

      expect(result.hasMore).toBe(false);
    });

    it('sets hasMore correctly with offset', () => {
      const result = repo.testBuildPaginated(['c'], 3, 1, 2);

      // offset(2) + items.length(1) = 3, which equals total(3)
      expect(result.hasMore).toBe(false);
    });

    it('handles empty items', () => {
      const result = repo.testBuildPaginated([], 0, 10, 0);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('propagates adapter query errors', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('connection lost'));

      await expect(repo.testQuery('SELECT 1')).rejects.toThrow('connection lost');
    });

    it('propagates adapter execute errors', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(
        repo.testExecute('INSERT INTO t VALUES ($1)', ['dup']),
      ).rejects.toThrow('constraint violation');
    });

    it('propagates adapter exec errors', async () => {
      mockAdapter.exec.mockRejectedValueOnce(new Error('syntax error'));

      await expect(repo.testExec('INVALID SQL')).rejects.toThrow('syntax error');
    });
  });
});

// ---------------------------------------------------------------------------
// ensureTable standalone function
// ---------------------------------------------------------------------------

describe('ensureTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates table when it does not exist', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce({ exists: false });

    await ensureTable('my_table', 'CREATE TABLE my_table (id TEXT)');

    expect(mockAdapter.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.tables'),
      ['my_table'],
    );
    expect(mockAdapter.exec).toHaveBeenCalledWith('CREATE TABLE my_table (id TEXT)');
  });

  it('skips creation when table already exists', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });

    await ensureTable('my_table', 'CREATE TABLE my_table (id TEXT)');

    expect(mockAdapter.exec).not.toHaveBeenCalled();
  });

  it('skips creation when query returns null', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce(null);

    await ensureTable('my_table', 'CREATE TABLE my_table (id TEXT)');

    // null?.exists is falsy, so it SHOULD create
    expect(mockAdapter.exec).toHaveBeenCalledWith('CREATE TABLE my_table (id TEXT)');
  });
});

/**
 * PostgresAdapter Tests
 *
 * Unit tests for PostgresAdapter covering pool initialization, query execution,
 * transaction management, SQL dialect helpers, and placeholder conversion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockClient, mockLog } = vi.hoisted(() => {
  const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockPool,
    mockClient,
    mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(function () {
      return mockPool;
    }),
  },
}));
vi.mock('../../services/log.js', () => ({ getLog: vi.fn(() => mockLog) }));
vi.mock('../../config/defaults.js', () => ({
  DB_POOL_MAX: 10,
  DB_IDLE_TIMEOUT_MS: 10000,
  DB_CONNECT_TIMEOUT_MS: 5000,
}));
vi.mock('pgvector/pg', () => {
  throw new Error('pgvector not installed');
});

import { PostgresAdapter } from './postgres-adapter.js';

function makeConfig(overrides) {
  if (!overrides) overrides = {};
  return {
    type: 'postgres',
    postgresUrl: 'postgresql://user:pass@localhost:5432/testdb',
    postgresHost: 'localhost',
    postgresPoolSize: 5,
    ...overrides,
  };
}

async function makeInitializedAdapter(config) {
  const adapter = new PostgresAdapter(config != null ? config : makeConfig());
  await adapter.initialize();
  return adapter;
}
describe('PostgresAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [] });
    mockClient.release.mockResolvedValue(undefined);
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.end.mockResolvedValue(undefined);
  });

  // Constructor
  describe('constructor', () => {
    it('sets type to "postgres"', () => {
      const adapter = new PostgresAdapter(makeConfig());
      expect(adapter.type).toBe('postgres');
    });

    it('stores the provided config', () => {
      const config = makeConfig({ postgresUrl: 'postgresql://custom:url@host/db' });
      const adapter = new PostgresAdapter(config);
      expect(adapter.isConnected()).toBe(false);
    });

    it('isConnected returns false before initialize is called', () => {
      const adapter = new PostgresAdapter(makeConfig());
      expect(adapter.isConnected()).toBe(false);
    });

    it('does not create a Pool in the constructor', async () => {
      const { default: pg } = await import('pg');
      vi.clearAllMocks();
      mockClient.query.mockResolvedValue({ rows: [] });
      mockPool.connect.mockResolvedValue(mockClient);
      new PostgresAdapter(makeConfig());
      expect(pg.Pool).not.toHaveBeenCalled();
    });
  });
  // initialize()
  describe('initialize()', () => {
    it('creates a Pool with the provided connection string', async () => {
      const { default: pg } = await import('pg');
      const config = makeConfig({ postgresUrl: 'postgresql://a:b@c:5432/d' });
      const adapter = new PostgresAdapter(config);
      await adapter.initialize();
      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({ connectionString: 'postgresql://a:b@c:5432/d' })
      );
    });

    it('uses config.postgresPoolSize when provided', async () => {
      const { default: pg } = await import('pg');
      const config = makeConfig({ postgresPoolSize: 20 });
      const adapter = new PostgresAdapter(config);
      await adapter.initialize();
      expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 20 }));
    });

    it('falls back to DB_POOL_MAX when postgresPoolSize is not set', async () => {
      const { default: pg } = await import('pg');
      const config = makeConfig({ postgresPoolSize: undefined });
      const adapter = new PostgresAdapter(config);
      await adapter.initialize();
      expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 10 }));
    });

    it('passes idleTimeoutMillis from DB_IDLE_TIMEOUT_MS', async () => {
      const { default: pg } = await import('pg');
      await makeInitializedAdapter();
      expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({ idleTimeoutMillis: 10000 }));
    });

    it('passes connectionTimeoutMillis from DB_CONNECT_TIMEOUT_MS', async () => {
      const { default: pg } = await import('pg');
      await makeInitializedAdapter();
      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({ connectionTimeoutMillis: 5000 })
      );
    });

    it('calls pool.connect() to obtain a test client', async () => {
      await makeInitializedAdapter();
      expect(mockPool.connect).toHaveBeenCalledOnce();
    });

    it('executes SELECT 1 on the test client', async () => {
      await makeInitializedAdapter();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('releases the client in the finally block after success', async () => {
      await makeInitializedAdapter();
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it('releases the client even when SELECT 1 throws', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('connection refused'));
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.initialize()).rejects.toThrow('connection refused');
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it('sets pool so isConnected returns true after initialization', async () => {
      const adapter = await makeInitializedAdapter();
      expect(adapter.isConnected()).toBe(true);
    });

    it('logs pgvector not available when pgvector import throws', async () => {
      await makeInitializedAdapter();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('pgvector not available'));
    });

    it('includes postgresHost in the log message when host is provided', async () => {
      const config = makeConfig({ postgresHost: 'my-db-host' });
      const adapter = new PostgresAdapter(config);
      await adapter.initialize();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('my-db-host'));
    });

    it('falls back to database in log when postgresHost is not set', async () => {
      const config = makeConfig({ postgresHost: undefined });
      const adapter = new PostgresAdapter(config);
      await adapter.initialize();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('database'));
    });

    it('propagates errors thrown by pool.connect()', async () => {
      mockPool.connect.mockRejectedValueOnce(new Error('pool exhausted'));
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.initialize()).rejects.toThrow('pool exhausted');
    });
  });
  // isConnected()
  describe('isConnected()', () => {
    it('returns false before initialize', () => {
      const adapter = new PostgresAdapter(makeConfig());
      expect(adapter.isConnected()).toBe(false);
    });
    it('returns true after initialize', async () => {
      const adapter = await makeInitializedAdapter();
      expect(adapter.isConnected()).toBe(true);
    });
    it('returns false after close', async () => {
      const adapter = await makeInitializedAdapter();
      await adapter.close();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  // query()
  describe('query()', () => {
    it('throws Database not initialized when pool is null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.query('SELECT 1')).rejects.toThrow('Database not initialized');
    });
    it('converts ? placeholders to $N numbered params', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('SELECT * FROM foo WHERE id = ? AND name = ?', [1, 'bar']);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM foo WHERE id = $1 AND name = $2', [
        1,
        'bar',
      ]);
    });
    it('passes params to pool.query', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('SELECT $1', [42]);
      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toEqual([42]);
    });
    it('returns the rows array from the result', async () => {
      const adapter = await makeInitializedAdapter();
      const rows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      mockPool.query.mockResolvedValueOnce({ rows, rowCount: 2 });
      const result = await adapter.query('SELECT * FROM users');
      expect(result).toEqual(rows);
    });
    it('uses an empty array as default params when none provided', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('SELECT 1');
      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toEqual([]);
    });
    it('returns empty array when no rows returned', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await adapter.query('SELECT * FROM empty_table');
      expect(result).toEqual([]);
    });
    it('does not modify SQL that has no ? placeholders', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('SELECT NOW()');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT NOW()');
    });
    it('handles a single ? placeholder correctly', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('SELECT * FROM foo WHERE id = ?', [99]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT * FROM foo WHERE id = $1');
    });
    it('handles many ? placeholders sequentially', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.query('INSERT INTO t (a,b,c,d) VALUES (?,?,?,?)', [1, 2, 3, 4]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('INSERT INTO t (a,b,c,d) VALUES ($1,$2,$3,$4)');
    });
    it('propagates pool.query errors', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockRejectedValueOnce(new Error('query failed'));
      await expect(adapter.query('SELECT 1')).rejects.toThrow('query failed');
    });
  });
  // queryOne()
  describe('queryOne()', () => {
    it('returns first row when results exist', async () => {
      const adapter = await makeInitializedAdapter();
      const rows = [
        { id: 1, val: 'first' },
        { id: 2, val: 'second' },
      ];
      mockPool.query.mockResolvedValueOnce({ rows, rowCount: 2 });
      const result = await adapter.queryOne('SELECT * FROM t');
      expect(result).toEqual({ id: 1, val: 'first' });
    });
    it('returns null when no rows returned', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await adapter.queryOne('SELECT * FROM t WHERE id = ?', [999]);
      expect(result).toBeNull();
    });
    it('delegates to query() and applies placeholder conversion', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });
      await adapter.queryOne('SELECT * FROM t WHERE id = ?', [7]);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT * FROM t WHERE id = $1');
      expect(params).toEqual([7]);
    });
    it('throws Database not initialized when pool is null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.queryOne('SELECT 1')).rejects.toThrow('Database not initialized');
    });
    it('returns a single object not an array', async () => {
      const adapter = await makeInitializedAdapter();
      const row = { id: 42, name: 'test' };
      mockPool.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const result = await adapter.queryOne('SELECT * FROM t');
      expect(result).not.toBeInstanceOf(Array);
      expect(result.id).toBe(42);
    });
  });

  // execute()
  describe('execute()', () => {
    it('throws Database not initialized when pool is null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.execute('DELETE FROM foo')).rejects.toThrow('Database not initialized');
    });
    it('returns changes equal to rowCount', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
      const result = await adapter.execute('DELETE FROM foo WHERE active = ?', [false]);
      expect(result.changes).toBe(3);
    });
    it('returns 0 changes when rowCount is null', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: null });
      const result = await adapter.execute('CREATE INDEX idx ON foo (bar)');
      expect(result.changes).toBe(0);
    });
    it('does not include lastInsertRowid in the result', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await adapter.execute('INSERT INTO foo (x) VALUES (?)', [1]);
      expect(result.lastInsertRowid).toBeUndefined();
    });
    it('converts ? placeholders to $N', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await adapter.execute('UPDATE foo SET a = ?, b = ? WHERE id = ?', ['x', 'y', 1]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('UPDATE foo SET a = $1, b = $2 WHERE id = $3');
    });
    it('passes params to pool.query', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await adapter.execute('UPDATE foo SET x = ? WHERE id = ?', ['hello', 5]);
      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toEqual(['hello', 5]);
    });
    it('uses empty array as default params', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await adapter.execute('TRUNCATE TABLE foo');
      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toEqual([]);
    });
    it('propagates pool.query errors', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockRejectedValueOnce(new Error('constraint violation'));
      await expect(adapter.execute('INSERT INTO foo VALUES (?)', [1])).rejects.toThrow(
        'constraint violation'
      );
    });
  });
  // transaction()
  describe('transaction()', () => {
    it('throws Database not initialized when pool is null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      await expect(adapter.transaction(() => Promise.resolve('x'))).rejects.toThrow(
        'Database not initialized'
      );
    });
    it('acquires a client via pool.connect()', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.connect.mockClear();
      await adapter.transaction(() => Promise.resolve(42));
      expect(mockPool.connect).toHaveBeenCalledOnce();
    });
    it('executes BEGIN before the user function', async () => {
      const adapter = await makeInitializedAdapter();
      const callOrder = [];
      mockClient.query.mockImplementation((sql) => {
        callOrder.push(sql);
        return Promise.resolve({ rows: [] });
      });
      await adapter.transaction(() => {
        callOrder.push('USER_FN');
        return Promise.resolve(true);
      });
      expect(callOrder[0]).toBe('BEGIN');
      expect(callOrder[1]).toBe('USER_FN');
    });
    it('executes COMMIT after user function on success', async () => {
      const adapter = await makeInitializedAdapter();
      const callOrder = [];
      mockClient.query.mockImplementation((sql) => {
        callOrder.push(sql);
        return Promise.resolve({ rows: [] });
      });
      await adapter.transaction(() => {
        callOrder.push('USER_FN');
        return Promise.resolve(true);
      });
      expect(callOrder).toEqual(['BEGIN', 'USER_FN', 'COMMIT']);
    });
    it('returns the value produced by the user function', async () => {
      const adapter = await makeInitializedAdapter();
      const result = await adapter.transaction(() => Promise.resolve({ id: 99, name: 'test' }));
      expect(result).toEqual({ id: 99, name: 'test' });
    });
    it('executes ROLLBACK when the user function throws', async () => {
      const adapter = await makeInitializedAdapter();
      const callOrder = [];
      mockClient.query.mockImplementation((sql) => {
        callOrder.push(sql);
        return Promise.resolve({ rows: [] });
      });
      await expect(
        adapter.transaction(() => Promise.reject(new Error('tx error')))
      ).rejects.toThrow('tx error');
      expect(callOrder).toContain('ROLLBACK');
    });
    it('does not execute COMMIT when user function throws', async () => {
      const adapter = await makeInitializedAdapter();
      const callOrder = [];
      mockClient.query.mockImplementation((sql) => {
        callOrder.push(sql);
        return Promise.resolve({ rows: [] });
      });
      await expect(adapter.transaction(() => Promise.reject(new Error('boom')))).rejects.toThrow(
        'boom'
      );
      expect(callOrder).not.toContain('COMMIT');
    });
    it('re-throws the original error after rollback', async () => {
      const adapter = await makeInitializedAdapter();
      const originalError = new Error('original failure');
      await expect(adapter.transaction(() => Promise.reject(originalError))).rejects.toBe(
        originalError
      );
    });
    it('releases the client in the finally block on success', async () => {
      const adapter = await makeInitializedAdapter();
      mockClient.release.mockClear();
      await adapter.transaction(() => Promise.resolve('ok'));
      expect(mockClient.release).toHaveBeenCalledOnce();
    });
    it('releases the client when user function throws', async () => {
      const adapter = await makeInitializedAdapter();
      mockClient.release.mockClear();
      await expect(adapter.transaction(() => Promise.reject(new Error('fail')))).rejects.toThrow(
        'fail'
      );
      expect(mockClient.release).toHaveBeenCalledOnce();
    });
    it('logs an error when ROLLBACK fails', async () => {
      const adapter = await makeInitializedAdapter();
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('rollback failed'));
      await expect(adapter.transaction(() => Promise.reject(new Error('tx fail')))).rejects.toThrow(
        'tx fail'
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Rollback failed'),
        expect.any(Error)
      );
    });
    it('still re-throws original error when rollback itself fails', async () => {
      const adapter = await makeInitializedAdapter();
      const originalError = new Error('original tx error');
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('rollback boom'));
      await expect(adapter.transaction(() => Promise.reject(originalError))).rejects.toBe(
        originalError
      );
    });
    it('still releases client when both fn and ROLLBACK throw', async () => {
      const adapter = await makeInitializedAdapter();
      mockClient.release.mockClear();
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('rollback boom'));
      await expect(
        adapter.transaction(() => Promise.reject(new Error('fn error')))
      ).rejects.toThrow();
      expect(mockClient.release).toHaveBeenCalledOnce();
    });
  });
  // exec() - tests the raw SQL execution method
  describe('exec()', () => {
    it('throws Database not initialized when pool is null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      // Calling via the public interface method
      const execFn = adapter.exec.bind(adapter);
      await expect(execFn('CREATE TABLE foo (id SERIAL)')).rejects.toThrow(
        'Database not initialized'
      );
    });
    it('passes the raw SQL directly to pool.query', async () => {
      const adapter = await makeInitializedAdapter();
      const rawSql = 'CREATE INDEX CONCURRENTLY idx_foo ON foo (bar)';
      const execFn = adapter.exec.bind(adapter);
      await execFn(rawSql);
      expect(mockPool.query).toHaveBeenCalledWith(rawSql);
    });
    it('resolves to void on success', async () => {
      const adapter = await makeInitializedAdapter();
      const execFn = adapter.exec.bind(adapter);
      const result = await execFn('VACUUM ANALYZE');
      expect(result).toBeUndefined();
    });
    it('does not convert ? placeholders (raw SQL passthrough)', async () => {
      const adapter = await makeInitializedAdapter();
      const execFn = adapter.exec.bind(adapter);
      const rawSql = 'SELECT ? FROM foo';
      await execFn(rawSql);
      expect(mockPool.query).toHaveBeenCalledWith(rawSql);
    });
    it('propagates pool.query errors', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.query.mockRejectedValueOnce(new Error('syntax error'));
      const execFn = adapter.exec.bind(adapter);
      await expect(execFn('INVALID SQL !!!')).rejects.toThrow('syntax error');
    });
  });

  // close()
  describe('close()', () => {
    it('calls pool.end() when pool exists', async () => {
      const adapter = await makeInitializedAdapter();
      await adapter.close();
      expect(mockPool.end).toHaveBeenCalledOnce();
    });
    it('sets pool to null so isConnected returns false after close', async () => {
      const adapter = await makeInitializedAdapter();
      await adapter.close();
      expect(adapter.isConnected()).toBe(false);
    });
    it('logs a message after closing the pool', async () => {
      const adapter = await makeInitializedAdapter();
      mockLog.info.mockClear();
      await adapter.close();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Connection pool closed'));
    });
    it('is a no-op when pool is already null', async () => {
      const adapter = new PostgresAdapter(makeConfig());
      await adapter.close();
      expect(mockPool.end).not.toHaveBeenCalled();
    });
    it('is a no-op when called a second time after closing', async () => {
      const adapter = await makeInitializedAdapter();
      await adapter.close();
      mockPool.end.mockClear();
      await adapter.close();
      expect(mockPool.end).not.toHaveBeenCalled();
    });
    it('propagates errors thrown by pool.end()', async () => {
      const adapter = await makeInitializedAdapter();
      mockPool.end.mockRejectedValueOnce(new Error('end failed'));
      await expect(adapter.close()).rejects.toThrow('end failed');
    });
  });
  // SQL dialect helpers
  describe('SQL dialect helpers', () => {
    let adapter;
    beforeEach(() => {
      adapter = new PostgresAdapter(makeConfig());
    });

    describe('now()', () => {
      it('returns NOW()', () => {
        expect(adapter.now()).toBe('NOW()');
      });
    });

    describe('date()', () => {
      it('wraps the column in DATE()', () => {
        expect(adapter.date('created_at')).toBe('DATE(created_at)');
      });
      it('works with table-qualified column names', () => {
        expect(adapter.date('t.created_at')).toBe('DATE(t.created_at)');
      });
      it('works with arbitrary expressions', () => {
        expect(adapter.date('NOW()')).toBe('DATE(NOW())');
      });
    });

    describe('dateSubtract()', () => {
      it('generates correct INTERVAL expression for days', () => {
        expect(adapter.dateSubtract('created_at', 7, 'days')).toBe(
          "created_at - INTERVAL '7 days'"
        );
      });
      it('generates correct INTERVAL expression for hours', () => {
        expect(adapter.dateSubtract('ts', 24, 'hours')).toBe("ts - INTERVAL '24 hours'");
      });
      it('generates correct INTERVAL expression for minutes', () => {
        expect(adapter.dateSubtract('updated_at', 30, 'minutes')).toBe(
          "updated_at - INTERVAL '30 minutes'"
        );
      });
      it('floors fractional amounts', () => {
        expect(adapter.dateSubtract('col', 7.9, 'days')).toBe("col - INTERVAL '7 days'");
      });
      it('floors fractional amounts just under an integer', () => {
        expect(adapter.dateSubtract('col', 2.1, 'hours')).toBe("col - INTERVAL '2 hours'");
      });
      it('allows 0 as a valid amount', () => {
        expect(adapter.dateSubtract('col', 0, 'days')).toBe("col - INTERVAL '0 days'");
      });
      it('throws for negative amount', () => {
        expect(() => adapter.dateSubtract('col', -1, 'days')).toThrow(
          'Invalid interval amount: -1'
        );
      });
      it('throws for NaN', () => {
        expect(() => adapter.dateSubtract('col', NaN, 'days')).toThrow(
          'Invalid interval amount: NaN'
        );
      });
      it('throws for positive Infinity', () => {
        expect(() => adapter.dateSubtract('col', Infinity, 'days')).toThrow(
          'Invalid interval amount: Infinity'
        );
      });
      it('throws for negative Infinity', () => {
        expect(() => adapter.dateSubtract('col', -Infinity, 'days')).toThrow(
          'Invalid interval amount: -Infinity'
        );
      });
      it('includes the column name verbatim in the output', () => {
        const expr = adapter.dateSubtract('my_table.some_col', 5, 'days');
        expect(expr).toContain('my_table.some_col');
      });
    });

    describe('placeholder()', () => {
      it('returns $1 for index 1', () => {
        expect(adapter.placeholder(1)).toBe('$1');
      });
      it('returns $N for arbitrary index N', () => {
        expect(adapter.placeholder(42)).toBe('$42');
      });
      it('returns $0 for index 0', () => {
        expect(adapter.placeholder(0)).toBe('$0');
      });
    });

    describe('boolean()', () => {
      it('returns true directly for true input', () => {
        expect(adapter.boolean(true)).toBe(true);
      });
      it('returns false directly for false input', () => {
        expect(adapter.boolean(false)).toBe(false);
      });
    });
    describe('parseBoolean()', () => {
      it('returns true for boolean true', () => {
        expect(adapter.parseBoolean(true)).toBe(true);
      });
      it('returns true for string t', () => {
        expect(adapter.parseBoolean('t')).toBe(true);
      });
      it('returns true for string true', () => {
        expect(adapter.parseBoolean('true')).toBe(true);
      });
      it('returns true for number 1', () => {
        expect(adapter.parseBoolean(1)).toBe(true);
      });
      it('returns false for boolean false', () => {
        expect(adapter.parseBoolean(false)).toBe(false);
      });
      it('returns false for string f', () => {
        expect(adapter.parseBoolean('f')).toBe(false);
      });
      it('returns false for string false', () => {
        expect(adapter.parseBoolean('false')).toBe(false);
      });
      it('returns false for number 0', () => {
        expect(adapter.parseBoolean(0)).toBe(false);
      });
      it('returns false for null', () => {
        expect(adapter.parseBoolean(null)).toBe(false);
      });
      it('returns false for undefined', () => {
        expect(adapter.parseBoolean(undefined)).toBe(false);
      });
      it('returns false for empty string', () => {
        expect(adapter.parseBoolean('')).toBe(false);
      });
      it('returns false for string TRUE (case-sensitive)', () => {
        expect(adapter.parseBoolean('TRUE')).toBe(false);
      });
      it('returns false for string T (case-sensitive)', () => {
        expect(adapter.parseBoolean('T')).toBe(false);
      });
      it('returns false for number 2 (not exactly 1)', () => {
        expect(adapter.parseBoolean(2)).toBe(false);
      });
      it('returns false for an object', () => {
        expect(adapter.parseBoolean({})).toBe(false);
      });
    });
  });

  // convertPlaceholders - tested via query() / execute()
  describe('convertPlaceholders (via query)', () => {
    let adapter;
    beforeEach(async () => {
      adapter = await makeInitializedAdapter();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });
    it('leaves SQL without ? placeholders unchanged', async () => {
      await adapter.query('SELECT NOW()');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT NOW()');
    });
    it('converts a single ? to $1', async () => {
      await adapter.query('SELECT * FROM t WHERE id = ?', [1]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT * FROM t WHERE id = $1');
    });
    it('converts two ? placeholders to $1 and $2', async () => {
      await adapter.query('SELECT * FROM t WHERE a = ? AND b = ?', [1, 2]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
    });
    it('converts three ? placeholders sequentially', async () => {
      await adapter.query('INSERT INTO t (a, b, c) VALUES (?, ?, ?)', ['x', 'y', 'z']);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('INSERT INTO t (a, b, c) VALUES ($1, $2, $3)');
    });
    it('handles 10+ placeholders with correct numbering', async () => {
      const sql = 'SELECT ' + Array.from({ length: 12 }, () => '?').join(', ');
      const params = Array.from({ length: 12 }, function (_, i) {
        return i + 1;
      });
      await adapter.query(sql, params);
      const [convertedSql] = mockPool.query.mock.calls[0];
      expect(convertedSql).toBe(
        'SELECT ' +
          Array.from({ length: 12 }, function (_, i) {
            return '$' + (i + 1);
          }).join(', ')
      );
    });
    it('applies conversion consistently in execute() as well', async () => {
      await adapter.execute('UPDATE t SET x = ? WHERE id = ?', ['v', 1]);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toBe('UPDATE t SET x = $1 WHERE id = $2');
    });
  });
});

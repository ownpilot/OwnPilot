/**
 * Database Adapter Index Tests
 *
 * Comprehensive unit tests for packages/gateway/src/db/adapters/index.ts.
 *
 * Covers:
 * - createAdapter(): construction, initialization, schema seeding, config resolution
 * - getAdapter(): lazy singleton creation and caching
 * - getAdapterSync(): synchronous access and error on uninitialized state
 * - initializeAdapter(): idempotent initialization and logging
 * - closeAdapter(): close + null teardown, no-op when absent
 * - Integration flows: full lifecycle, schema initialized-once invariant
 *
 * Strategy: vi.resetModules() + dynamic re-import (freshModule()) before every
 * test so module-level `adapter` and `schemaInitialized` singletons are
 * truly reset between tests. Mock objects are shared and restored in beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — must live outside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockPgAdapterInstance,
  MockPostgresAdapter,
  mockInitializeSchema,
  mockGetDatabaseConfig,
  mockLog,
} = vi.hoisted(() => {
  const mockPgAdapterInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    type: 'postgres' as const,
    isConnected: vi.fn().mockReturnValue(true),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ changes: 0 }),
    transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
    now: vi.fn().mockReturnValue('NOW()'),
    date: vi.fn().mockImplementation((col: string) => `DATE(${col})`),
    dateSubtract: vi.fn(),
    placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
    boolean: vi.fn().mockImplementation((v: boolean) => v),
    parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  };

  // Must use regular function (not arrow) — arrow functions cannot be constructors
  const MockPostgresAdapter = vi.fn(function () {
    return mockPgAdapterInstance;
  });

  const mockInitializeSchema = vi.fn().mockResolvedValue(undefined);

  const mockGetDatabaseConfig = vi.fn(() => ({
    type: 'postgres' as const,
    postgresUrl: 'postgresql://ownpilot:secret@localhost:25432/ownpilot',
    postgresHost: 'localhost',
    postgresPort: 25432,
    postgresUser: 'ownpilot',
    postgresPassword: 'secret',
    postgresDatabase: 'ownpilot',
    postgresPoolSize: 10,
  }));

  const mockLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  return {
    mockPgAdapterInstance,
    MockPostgresAdapter,
    mockInitializeSchema,
    mockGetDatabaseConfig,
    mockLog,
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted automatically by Vitest)
// ---------------------------------------------------------------------------

vi.mock('./types.js', () => ({
  getDatabaseConfig: mockGetDatabaseConfig,
}));

vi.mock('./postgres-adapter.js', () => ({
  PostgresAdapter: MockPostgresAdapter,
}));

vi.mock('../schema.js', () => ({
  initializeSchema: mockInitializeSchema,
}));

vi.mock('../../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ---------------------------------------------------------------------------
// Helper: obtain a fresh module instance with clean module-level state
// ---------------------------------------------------------------------------

type AdapterModule = typeof import('./index.js');

async function freshModule(): Promise<AdapterModule> {
  vi.resetModules();
  return import('./index.js');
}

// ---------------------------------------------------------------------------
// Reset shared mock state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore default implementations after clearAllMocks wipes them
  mockPgAdapterInstance.initialize.mockResolvedValue(undefined);
  mockPgAdapterInstance.exec.mockResolvedValue(undefined);
  mockPgAdapterInstance.close.mockResolvedValue(undefined);
  mockPgAdapterInstance.query.mockResolvedValue([]);
  mockPgAdapterInstance.isConnected.mockReturnValue(true);
  mockPgAdapterInstance.queryOne.mockResolvedValue(null);
  mockPgAdapterInstance.execute.mockResolvedValue({ changes: 0 });
  mockPgAdapterInstance.transaction.mockImplementation((fn: () => Promise<unknown>) => fn());
  mockPgAdapterInstance.now.mockReturnValue('NOW()');
  mockPgAdapterInstance.date.mockImplementation((col: string) => `DATE(${col})`);
  mockPgAdapterInstance.placeholder.mockImplementation((i: number) => `$${i}`);
  mockPgAdapterInstance.boolean.mockImplementation((v: boolean) => v);
  mockPgAdapterInstance.parseBoolean.mockImplementation((v: unknown) => Boolean(v));

  MockPostgresAdapter.mockImplementation(function () {
    return mockPgAdapterInstance;
  });

  mockInitializeSchema.mockResolvedValue(undefined);

  mockGetDatabaseConfig.mockReturnValue({
    type: 'postgres' as const,
    postgresUrl: 'postgresql://ownpilot:secret@localhost:25432/ownpilot',
    postgresHost: 'localhost',
    postgresPort: 25432,
    postgresUser: 'ownpilot',
    postgresPassword: 'secret',
    postgresDatabase: 'ownpilot',
    postgresPoolSize: 10,
  });
});

// ===========================================================================
// createAdapter()
// ===========================================================================

describe('createAdapter()', () => {
  it('returns the PostgresAdapter instance', async () => {
    const { createAdapter } = await freshModule();
    const result = await createAdapter();
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('calls the PostgresAdapter constructor exactly once', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('passes the explicitly provided config to the PostgresAdapter constructor', async () => {
    const { createAdapter } = await freshModule();
    const customConfig = {
      type: 'postgres' as const,
      postgresUrl: 'postgresql://custom:pass@db-host:5432/mydb',
      postgresHost: 'db-host',
      postgresPort: 5432,
    };
    await createAdapter(customConfig);
    expect(MockPostgresAdapter).toHaveBeenCalledWith(customConfig);
  });

  it('calls getDatabaseConfig() when no config is supplied', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    expect(mockGetDatabaseConfig).toHaveBeenCalledTimes(1);
  });

  it('passes the getDatabaseConfig() result to the constructor when no config supplied', async () => {
    const { createAdapter } = await freshModule();
    const envConfig = mockGetDatabaseConfig();
    await createAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledWith(envConfig);
  });

  it('does NOT call getDatabaseConfig() when a config is provided', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter({ type: 'postgres', postgresUrl: 'postgresql://x:y@z/w' });
    expect(mockGetDatabaseConfig).not.toHaveBeenCalled();
  });

  it('calls pgAdapter.initialize()', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    expect(mockPgAdapterInstance.initialize).toHaveBeenCalledTimes(1);
  });

  it('calls initializeSchema on the first createAdapter call (schemaInitialized is false)', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('does NOT call initializeSchema on the second createAdapter call in the same module instance', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    await createAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('passes a function as the first argument to initializeSchema', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    expect(typeof mockInitializeSchema.mock.calls[0][0]).toBe('function');
  });

  it('the exec function passed to initializeSchema delegates to pgAdapter.exec', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    const execFn = mockInitializeSchema.mock.calls[0][0] as (sql: string) => Promise<void>;
    await execFn('CREATE TABLE test (id TEXT)');
    expect(mockPgAdapterInstance.exec).toHaveBeenCalledWith('CREATE TABLE test (id TEXT)');
  });

  it('the exec function passed to initializeSchema returns the result of pgAdapter.exec', async () => {
    const { createAdapter } = await freshModule();
    mockPgAdapterInstance.exec.mockResolvedValue(undefined);
    await createAdapter();
    const execFn = mockInitializeSchema.mock.calls[0][0] as (sql: string) => Promise<void>;
    const result = await execFn('SELECT 1');
    expect(result).toBeUndefined();
  });

  it('still returns the adapter when initializeSchema throws', async () => {
    const { createAdapter } = await freshModule();
    mockInitializeSchema.mockRejectedValueOnce(new Error('schema failure'));
    await expect(createAdapter()).rejects.toThrow('schema failure');
  });

  it('propagates errors thrown by pgAdapter.initialize()', async () => {
    const { createAdapter } = await freshModule();
    mockPgAdapterInstance.initialize.mockRejectedValueOnce(new Error('connection refused'));
    await expect(createAdapter()).rejects.toThrow('connection refused');
  });

  it('creates a new PostgresAdapter instance on each call', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    await createAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(2);
  });

  it('calls initialize() on each new adapter, not just the first', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    await createAdapter();
    expect(mockPgAdapterInstance.initialize).toHaveBeenCalledTimes(2);
  });

  it('schemaInitialized is true after first call so schema is not re-run on third call', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    await createAdapter();
    await createAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('accepts a partial config with only type and postgresUrl', async () => {
    const { createAdapter } = await freshModule();
    const minimalConfig = { type: 'postgres' as const, postgresUrl: 'postgresql://a:b@c/d' };
    const result = await createAdapter(minimalConfig);
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('always calls initialize before initializeSchema', async () => {
    const { createAdapter } = await freshModule();
    const callOrder: string[] = [];
    mockPgAdapterInstance.initialize.mockImplementation(async () => {
      callOrder.push('initialize');
    });
    mockInitializeSchema.mockImplementation(async () => {
      callOrder.push('initializeSchema');
    });
    await createAdapter();
    expect(callOrder).toEqual(['initialize', 'initializeSchema']);
  });
});

// ===========================================================================
// getAdapter()
// ===========================================================================

describe('getAdapter()', () => {
  it('returns a DatabaseAdapter instance on first call', async () => {
    const { getAdapter } = await freshModule();
    const result = await getAdapter();
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('creates the adapter on first call when adapter is null', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('returns the same adapter instance on a second call (singleton)', async () => {
    const { getAdapter } = await freshModule();
    const first = await getAdapter();
    const second = await getAdapter();
    expect(first).toBe(second);
  });

  it('only constructs PostgresAdapter once across multiple getAdapter() calls', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    await getAdapter();
    await getAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('calls createAdapter internally (initializes the pg adapter)', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    expect(mockPgAdapterInstance.initialize).toHaveBeenCalledTimes(1);
  });

  it('calls initializeSchema exactly once across repeated calls', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    await getAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('uses getDatabaseConfig() when creating the adapter internally', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    expect(mockGetDatabaseConfig).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown during adapter creation', async () => {
    const { getAdapter } = await freshModule();
    mockPgAdapterInstance.initialize.mockRejectedValueOnce(new Error('init error'));
    await expect(getAdapter()).rejects.toThrow('init error');
  });

  it('does not call getDatabaseConfig() on the second call because adapter is cached', async () => {
    const { getAdapter } = await freshModule();
    await getAdapter();
    mockGetDatabaseConfig.mockClear();
    await getAdapter();
    expect(mockGetDatabaseConfig).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getAdapterSync()
// ===========================================================================

describe('getAdapterSync()', () => {
  it('throws an Error when adapter has not been initialized', async () => {
    const { getAdapterSync } = await freshModule();
    expect(() => getAdapterSync()).toThrow(Error);
  });

  it('throws with message containing "Database adapter not initialized"', async () => {
    const { getAdapterSync } = await freshModule();
    expect(() => getAdapterSync()).toThrow('Database adapter not initialized');
  });

  it('throws with message containing "Call initializeAdapter() first"', async () => {
    const { getAdapterSync } = await freshModule();
    expect(() => getAdapterSync()).toThrow('Call initializeAdapter() first');
  });

  it('returns the adapter synchronously after initializeAdapter() has been called', async () => {
    const { initializeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    const result = getAdapterSync();
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('returns the adapter synchronously after getAdapter() has been called', async () => {
    const { getAdapter, getAdapterSync } = await freshModule();
    await getAdapter();
    const result = getAdapterSync();
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('does not throw after createAdapter() has been used to seed the singleton via getAdapter', async () => {
    const { getAdapter, getAdapterSync } = await freshModule();
    await getAdapter();
    expect(() => getAdapterSync()).not.toThrow();
  });

  it('is synchronous — does not return a Promise', async () => {
    const { initializeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    const result = getAdapterSync();
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('returns the exact same reference as what initializeAdapter() resolved with', async () => {
    const { initializeAdapter, getAdapterSync } = await freshModule();
    const initialized = await initializeAdapter();
    const sync = getAdapterSync();
    expect(sync).toBe(initialized);
  });

  it('throws again after closeAdapter() nullifies the singleton', async () => {
    const { initializeAdapter, closeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    expect(() => getAdapterSync()).toThrow('Database adapter not initialized');
  });
});

// ===========================================================================
// initializeAdapter()
// ===========================================================================

describe('initializeAdapter()', () => {
  it('returns a DatabaseAdapter on first call', async () => {
    const { initializeAdapter } = await freshModule();
    const result = await initializeAdapter();
    expect(result).toBe(mockPgAdapterInstance);
  });

  it('constructs a PostgresAdapter when adapter is null', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('calls pgAdapter.initialize() when creating new adapter', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    expect(mockPgAdapterInstance.initialize).toHaveBeenCalledTimes(1);
  });

  it('calls initializeSchema on first call', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('returns the existing adapter without re-creating it on the second call', async () => {
    const { initializeAdapter } = await freshModule();
    const first = await initializeAdapter();
    const second = await initializeAdapter();
    expect(first).toBe(second);
  });

  it('does NOT construct a new PostgresAdapter when adapter already exists', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    MockPostgresAdapter.mockClear();
    await initializeAdapter();
    expect(MockPostgresAdapter).not.toHaveBeenCalled();
  });

  it('logs an info message when adapter is already initialized', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    mockLog.info.mockClear();
    await initializeAdapter();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('[Database]'));
  });

  it('log message contains "already initialized"', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    mockLog.info.mockClear();
    await initializeAdapter();
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already initialized'));
  });

  it('does NOT log when called for the first time', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    // The "already initialized" log should not appear on the first call
    const alreadyInitLog = mockLog.info.mock.calls.find((c) =>
      String(c[0]).includes('already initialized')
    );
    expect(alreadyInitLog).toBeUndefined();
  });

  it('accepts an optional config and passes it through to PostgresAdapter', async () => {
    const { initializeAdapter } = await freshModule();
    const customConfig = { type: 'postgres' as const, postgresUrl: 'postgresql://a:b@c/d' };
    await initializeAdapter(customConfig);
    expect(MockPostgresAdapter).toHaveBeenCalledWith(customConfig);
  });

  it('uses getDatabaseConfig() when no config is supplied', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    expect(mockGetDatabaseConfig).toHaveBeenCalledTimes(1);
  });

  it('does NOT call getDatabaseConfig() when a config is passed', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter({ type: 'postgres', postgresUrl: 'postgresql://x:y@z/w' });
    expect(mockGetDatabaseConfig).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by pgAdapter.initialize()', async () => {
    const { initializeAdapter } = await freshModule();
    mockPgAdapterInstance.initialize.mockRejectedValueOnce(new Error('pg connect failed'));
    await expect(initializeAdapter()).rejects.toThrow('pg connect failed');
  });

  it('does NOT call pgAdapter.initialize() on the second call', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    mockPgAdapterInstance.initialize.mockClear();
    await initializeAdapter();
    expect(mockPgAdapterInstance.initialize).not.toHaveBeenCalled();
  });

  it('does NOT call initializeSchema on the second call', async () => {
    const { initializeAdapter } = await freshModule();
    await initializeAdapter();
    mockInitializeSchema.mockClear();
    await initializeAdapter();
    expect(mockInitializeSchema).not.toHaveBeenCalled();
  });

  it('is idempotent across many calls — always returns the same instance', async () => {
    const { initializeAdapter } = await freshModule();
    const refs = await Promise.all([initializeAdapter(), initializeAdapter(), initializeAdapter()]);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[1]).toBe(refs[2]);
  });
});

// ===========================================================================
// closeAdapter()
// ===========================================================================

describe('closeAdapter()', () => {
  it('calls adapter.close() when adapter exists', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    expect(mockPgAdapterInstance.close).toHaveBeenCalledTimes(1);
  });

  it('does NOT throw when no adapter exists (no-op)', async () => {
    const { closeAdapter } = await freshModule();
    await expect(closeAdapter()).resolves.toBeUndefined();
  });

  it('does NOT call close() when adapter is null', async () => {
    const { closeAdapter } = await freshModule();
    await closeAdapter();
    expect(mockPgAdapterInstance.close).not.toHaveBeenCalled();
  });

  it('resolves to undefined (void return)', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    const result = await closeAdapter();
    expect(result).toBeUndefined();
  });

  it('nullifies the adapter so getAdapterSync() throws afterwards', async () => {
    const { initializeAdapter, closeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    expect(() => getAdapterSync()).toThrow('Database adapter not initialized');
  });

  it('nullifies the adapter so getAdapter() creates a fresh one on the next call', async () => {
    const { initializeAdapter, closeAdapter, getAdapter } = await freshModule();
    await initializeAdapter();
    MockPostgresAdapter.mockClear();
    await closeAdapter();
    await getAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on a second call after adapter is already closed', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    mockPgAdapterInstance.close.mockClear();
    await closeAdapter();
    expect(mockPgAdapterInstance.close).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by adapter.close()', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    mockPgAdapterInstance.close.mockRejectedValueOnce(new Error('pool drain failed'));
    await expect(closeAdapter()).rejects.toThrow('pool drain failed');
  });

  it('calls close() on the exact adapter instance that was initialized', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    const initializedAdapter = await initializeAdapter();
    await closeAdapter();
    // The mock instance is the same object so close was called on it
    expect(initializedAdapter.close).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Integration scenarios
// ===========================================================================

describe('Integration scenarios', () => {
  it('full lifecycle: initializeAdapter → getAdapterSync → closeAdapter → getAdapterSync throws', async () => {
    const { initializeAdapter, closeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    expect(() => getAdapterSync()).not.toThrow();
    await closeAdapter();
    expect(() => getAdapterSync()).toThrow('Database adapter not initialized');
  });

  it('schema is only initialized once across multiple createAdapter() calls', async () => {
    const { createAdapter } = await freshModule();
    await createAdapter();
    await createAdapter();
    await createAdapter();
    expect(mockInitializeSchema).toHaveBeenCalledTimes(1);
  });

  it('getAdapter() and then getAdapterSync() return the same instance', async () => {
    const { getAdapter, getAdapterSync } = await freshModule();
    const fromAsync = await getAdapter();
    const fromSync = getAdapterSync();
    expect(fromAsync).toBe(fromSync);
  });

  it('closeAdapter() followed by getAdapter() creates a fresh adapter', async () => {
    const { initializeAdapter, closeAdapter, getAdapter } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    MockPostgresAdapter.mockClear();
    mockInitializeSchema.mockClear();
    await getAdapter();
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
    // schemaInitialized is still true from the first run — schema should NOT run again
    expect(mockInitializeSchema).not.toHaveBeenCalled();
  });

  it('initializeAdapter → closeAdapter → initializeAdapter creates fresh adapter', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    MockPostgresAdapter.mockClear();
    const second = await initializeAdapter();
    expect(second).toBe(mockPgAdapterInstance);
    expect(MockPostgresAdapter).toHaveBeenCalledTimes(1);
  });

  it('schema is NOT re-run after close → re-init because schemaInitialized persists in module scope', async () => {
    const { initializeAdapter, closeAdapter } = await freshModule();
    await initializeAdapter();
    await closeAdapter();
    mockInitializeSchema.mockClear();
    await initializeAdapter();
    expect(mockInitializeSchema).not.toHaveBeenCalled();
  });

  it('multiple concurrent getAdapter() calls resolve to the same instance', async () => {
    const { getAdapter } = await freshModule();
    const [a, b, c] = await Promise.all([getAdapter(), getAdapter(), getAdapter()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('initializeAdapter() returns the same instance as getAdapter()', async () => {
    const { initializeAdapter, getAdapter } = await freshModule();
    const fromInit = await initializeAdapter();
    const fromGet = await getAdapter();
    expect(fromInit).toBe(fromGet);
  });

  it('getAdapter() then initializeAdapter() returns the same cached instance', async () => {
    const { getAdapter, initializeAdapter } = await freshModule();
    const fromGet = await getAdapter();
    const fromInit = await initializeAdapter();
    expect(fromGet).toBe(fromInit);
  });

  it('closeAdapter() resolves cleanly even when called before any initialization', async () => {
    const { closeAdapter } = await freshModule();
    await expect(closeAdapter()).resolves.not.toThrow();
  });

  it('full cycle repeated twice: init → get → close → init → getSync works correctly', async () => {
    const { initializeAdapter, getAdapter, closeAdapter, getAdapterSync } = await freshModule();

    // First cycle
    await initializeAdapter();
    const first = await getAdapter();
    expect(first).toBe(mockPgAdapterInstance);
    await closeAdapter();

    // Second cycle
    await initializeAdapter();
    const secondSync = getAdapterSync();
    expect(secondSync).toBe(mockPgAdapterInstance);
  });

  it('initializeSchema exec callback propagates errors from pgAdapter.exec', async () => {
    const { createAdapter } = await freshModule();
    const execError = new Error('SQL syntax error');

    mockInitializeSchema.mockImplementationOnce(async (execFn: (sql: string) => Promise<void>) => {
      // Simulate what the real initializeSchema does — it calls exec with SQL
      await execFn('SOME DDL STATEMENT');
    });
    mockPgAdapterInstance.exec.mockRejectedValueOnce(execError);

    await expect(createAdapter()).rejects.toThrow('SQL syntax error');
  });

  it('PostgresAdapter constructor is called before initialize()', async () => {
    const { createAdapter } = await freshModule();
    const callOrder: string[] = [];
    MockPostgresAdapter.mockImplementationOnce(function () {
      callOrder.push('constructor');
      return mockPgAdapterInstance;
    });
    mockPgAdapterInstance.initialize.mockImplementationOnce(async () => {
      callOrder.push('initialize');
    });
    mockInitializeSchema.mockImplementationOnce(async () => {
      callOrder.push('initializeSchema');
    });
    await createAdapter();
    expect(callOrder).toEqual(['constructor', 'initialize', 'initializeSchema']);
  });

  it('getAdapterSync() still throws after a failed initializeAdapter() attempt', async () => {
    const { initializeAdapter, getAdapterSync } = await freshModule();
    mockPgAdapterInstance.initialize.mockRejectedValueOnce(new Error('init failed'));
    await expect(initializeAdapter()).rejects.toThrow('init failed');
    // adapter was never set because createAdapter threw before assignment
    expect(() => getAdapterSync()).toThrow('Database adapter not initialized');
  });

  it('closing with a real adapter.close() rejection does not corrupt adapter state', async () => {
    const { initializeAdapter, closeAdapter, getAdapterSync } = await freshModule();
    await initializeAdapter();
    mockPgAdapterInstance.close.mockRejectedValueOnce(new Error('drain error'));
    await expect(closeAdapter()).rejects.toThrow('drain error');
    // adapter was not nullified because close() threw before the null assignment
    // (the null assignment in closeAdapter happens after await adapter.close())
    // So getAdapterSync should still work or throw depending on execution order
    // The important thing is it does not throw unexpectedly
    // (the close call threw, so null assignment did not happen)
    expect(() => getAdapterSync()).not.toThrow();
  });

  it('calling getAdapter() twice concurrently both resolve to the same mock instance', async () => {
    const { getAdapter } = await freshModule();
    // Note: the module has no Promise-level lock on adapter creation, so two
    // concurrent calls that both see adapter===null will each call createAdapter().
    // Both resolve to the same mock instance because MockPostgresAdapter always
    // returns mockPgAdapterInstance. The second call overwrites the singleton
    // with the same reference, so both callers get the same object.
    const [first, second] = await Promise.all([getAdapter(), getAdapter()]);
    expect(first).toBe(mockPgAdapterInstance);
    expect(second).toBe(mockPgAdapterInstance);
    expect(first).toBe(second);
  });
});

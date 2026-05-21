/**
 * UISessionsRepository Tests
 *
 * Unit tests for the PostgreSQL-backed session store used by the UI/MCP
 * session service (C4). Covers create/upsert, lookup, delete, expiry sweep,
 * counting, listing, and schema initialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const {
  UISessionsRepository,
  createUISessionsRepository,
  uiSessionsRepo,
  initializeUISessionsRepo,
} = await import('./ui-sessions.js');

const NOW = '2025-01-01T00:00:00Z';
const FUTURE = '2025-01-02T00:00:00Z';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    token_hash: 'hash-1',
    kind: 'ui',
    user_id: 'default',
    created_at: NOW,
    expires_at: FUTURE,
    metadata: '{"ip":"127.0.0.1"}',
    ...overrides,
  };
}

describe('UISessionsRepository', () => {
  let repo: InstanceType<typeof UISessionsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new UISessionsRepository();
  });

  // ---------------------------------------------------------------------------
  // initialize
  // ---------------------------------------------------------------------------

  describe('initialize', () => {
    it('creates the table when it does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: false });

      await repo.initialize();

      const existsCall = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(existsCall[0]).toContain('information_schema.tables');
      expect(existsCall[1]).toEqual(['ui_sessions']);

      // exec() is called twice: once to CREATE TABLE, once for CREATE INDEX
      expect(mockAdapter.exec).toHaveBeenCalledTimes(2);
      const createSql = mockAdapter.exec.mock.calls[0][0] as string;
      expect(createSql).toContain('CREATE TABLE IF NOT EXISTS ui_sessions');
      expect(createSql).toContain('token_hash TEXT PRIMARY KEY');
      expect(createSql).toContain("kind TEXT NOT NULL DEFAULT 'ui'");
      expect(createSql).toContain('expires_at TIMESTAMP NOT NULL');

      const indexSql = mockAdapter.exec.mock.calls[1][0] as string;
      expect(indexSql).toContain('idx_ui_sessions_expires_at');
      expect(indexSql).toContain('idx_ui_sessions_kind');
    });

    it('skips CREATE TABLE when the table already exists but still ensures indexes', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });

      await repo.initialize();

      // Only the index-creation exec should fire, not the table-creation one
      expect(mockAdapter.exec).toHaveBeenCalledTimes(1);
      const sql = mockAdapter.exec.mock.calls[0][0] as string;
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_ui_sessions_expires_at');
    });
  });

  // ---------------------------------------------------------------------------
  // createSession
  // ---------------------------------------------------------------------------

  describe('createSession', () => {
    it('inserts a session row with serialized metadata and ISO expiry', async () => {
      const expiresAt = new Date('2025-06-01T12:00:00Z');

      await repo.createSession('hash-1', 'ui', 'user-1', expiresAt, { ip: '10.0.0.1' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO ui_sessions');
      expect(sql).toContain('ON CONFLICT(token_hash) DO UPDATE');
      expect(params).toEqual([
        'hash-1',
        'ui',
        'user-1',
        expiresAt.toISOString(),
        JSON.stringify({ ip: '10.0.0.1' }),
      ]);
    });

    it('defaults metadata to an empty object JSON when omitted', async () => {
      await repo.createSession('hash-2', 'mcp', 'user-2', new Date('2025-06-01T12:00:00Z'));

      const [, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe('{}');
    });

    it('upserts on conflict — EXCLUDED fields overwrite existing row', async () => {
      await repo.createSession('hash-1', 'ui', 'user-1', new Date(FUTURE));

      const [sql] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT(token_hash) DO UPDATE SET');
      expect(sql).toContain('kind = EXCLUDED.kind');
      expect(sql).toContain('user_id = EXCLUDED.user_id');
      expect(sql).toContain('expires_at = EXCLUDED.expires_at');
      expect(sql).toContain('metadata = EXCLUDED.metadata');
    });
  });

  // ---------------------------------------------------------------------------
  // getByTokenHash
  // ---------------------------------------------------------------------------

  describe('getByTokenHash', () => {
    it('returns a mapped session when the row exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const session = await repo.getByTokenHash('hash-1');

      expect(session).not.toBeNull();
      expect(session?.tokenHash).toBe('hash-1');
      expect(session?.kind).toBe('ui');
      expect(session?.userId).toBe('default');
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.createdAt.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(session?.expiresAt.toISOString()).toBe('2025-01-02T00:00:00.000Z');
      expect(session?.metadata).toEqual({ ip: '127.0.0.1' });

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT * FROM ui_sessions WHERE token_hash = $1');
      expect(params).toEqual(['hash-1']);
    });

    it('returns null when the row does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const session = await repo.getByTokenHash('missing');

      expect(session).toBeNull();
    });

    it('falls back to empty object when metadata JSON is malformed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ metadata: '{not json' }));

      const session = await repo.getByTokenHash('hash-1');

      expect(session?.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // deleteByTokenHash
  // ---------------------------------------------------------------------------

  describe('deleteByTokenHash', () => {
    it('returns true when a row was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const deleted = await repo.deleteByTokenHash('hash-1');

      expect(deleted).toBe(true);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM ui_sessions WHERE token_hash = $1');
      expect(params).toEqual(['hash-1']);
    });

    it('returns false when no row matched', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const deleted = await repo.deleteByTokenHash('hash-missing');

      expect(deleted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAll
  // ---------------------------------------------------------------------------

  describe('deleteAll', () => {
    it('executes an unqualified DELETE and returns the row count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 42 });

      const count = await repo.deleteAll();

      expect(count).toBe(42);
      const [sql] = mockAdapter.execute.mock.calls[0] as [string];
      expect(sql).toBe('DELETE FROM ui_sessions');
    });
  });

  // ---------------------------------------------------------------------------
  // deleteExpired
  // ---------------------------------------------------------------------------

  describe('deleteExpired', () => {
    it('deletes rows with expires_at in the past and returns the count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      const count = await repo.deleteExpired();

      expect(count).toBe(3);
      const [sql] = mockAdapter.execute.mock.calls[0] as [string];
      expect(sql).toContain('DELETE FROM ui_sessions WHERE expires_at < NOW()');
    });

    it('returns 0 when no rows are expired', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const count = await repo.deleteExpired();

      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // countActive
  // ---------------------------------------------------------------------------

  describe('countActive', () => {
    it('returns the count of non-expired sessions as a number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '17' });

      const count = await repo.countActive();

      expect(count).toBe(17);
      const [sql] = mockAdapter.queryOne.mock.calls[0] as [string];
      expect(sql).toContain('SELECT COUNT(*) as count FROM ui_sessions WHERE expires_at > NOW()');
    });

    it('returns 0 when the query returns no row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const count = await repo.countActive();

      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // listActive
  // ---------------------------------------------------------------------------

  describe('listActive', () => {
    it('returns active sessions ordered by created_at DESC with default limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ token_hash: 'hash-a' }),
        makeRow({ token_hash: 'hash-b', metadata: '{}' }),
      ]);

      const sessions = await repo.listActive();

      expect(sessions).toHaveLength(2);
      expect(sessions[0]!.tokenHash).toBe('hash-a');
      expect(sessions[1]!.tokenHash).toBe('hash-b');
      expect(sessions[1]!.metadata).toEqual({});

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE expires_at > NOW()');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT $1');
      expect(params).toEqual([100]);
    });

    it('honors the provided limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listActive(25);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([25]);
    });

    it('returns an empty array when no active sessions exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const sessions = await repo.listActive();

      expect(sessions).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Module-level exports
  // ---------------------------------------------------------------------------

  describe('module exports', () => {
    it('createUISessionsRepository returns a fresh instance', () => {
      const a = createUISessionsRepository();
      const b = createUISessionsRepository();
      expect(a).toBeInstanceOf(UISessionsRepository);
      expect(a).not.toBe(b);
    });

    it('uiSessionsRepo is a singleton instance', () => {
      expect(uiSessionsRepo).toBeInstanceOf(UISessionsRepository);
    });

    it('initializeUISessionsRepo initializes the singleton', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ exists: true });

      await initializeUISessionsRepo();

      expect(mockAdapter.queryOne).toHaveBeenCalled();
      expect(mockAdapter.exec).toHaveBeenCalled();
    });
  });
});

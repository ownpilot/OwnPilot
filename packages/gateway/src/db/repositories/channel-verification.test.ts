/**
 * ChannelVerificationRepository Tests
 *
 * Tests token generation, findValidToken, consumeToken, cleanupExpired,
 * listByUser, revokeAll, and row-to-entity mapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock adapter
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
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock crypto to produce deterministic values
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('generated-uuid'),
    randomInt: vi.fn().mockReturnValue(123456),
  };
});

const { ChannelVerificationRepository, createChannelVerificationRepository } =
  await import('./channel-verification.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    ownpilot_user_id: 'user-1',
    token: '123456',
    platform: null,
    expires_at: '2024-06-01T12:15:00Z',
    is_used: false,
    used_by_channel_user_id: null,
    created_at: '2024-06-01T12:00:00Z',
    used_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelVerificationRepository', () => {
  let repo: InstanceType<typeof ChannelVerificationRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelVerificationRepository();
  });

  // ---- generateToken ----

  describe('generateToken', () => {
    it('generates a PIN token by default', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.generateToken('user-1');

      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_verification_tokens'),
        expect.arrayContaining(['generated-uuid', 'user-1'])
      );
    });

    it('uses default TTL of 15 minutes', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const before = Date.now();
      const result = await repo.generateToken('user-1');
      const after = Date.now();

      // expiresAt should be ~15 minutes from now
      const expiresMs = result.expiresAt.getTime();
      const fifteenMin = 15 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + fifteenMin - 100);
      expect(expiresMs).toBeLessThanOrEqual(after + fifteenMin + 100);
    });

    it('respects custom TTL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const before = Date.now();
      const result = await repo.generateToken('user-1', { ttlMinutes: 30 });
      const after = Date.now();

      const expiresMs = result.expiresAt.getTime();
      const thirtyMin = 30 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + thirtyMin - 100);
      expect(expiresMs).toBeLessThanOrEqual(after + thirtyMin + 100);
    });

    it('passes platform when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.generateToken('user-1', { platform: 'telegram' });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('telegram');
    });

    it('passes null platform when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.generateToken('user-1');

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBeNull();
    });

    it('generates a token type when specified', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      // With mocked randomInt always returning 123456, the token type
      // still uses the same mock but exercises the code path
      const result = await repo.generateToken('user-1', { type: 'token' });

      expect(result.token).toBeDefined();
    });

    it('generates a PIN type when specified', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.generateToken('user-1', { type: 'pin' });

      expect(result.token).toBeDefined();
    });
  });

  // ---- findValidToken ----

  describe('findValidToken', () => {
    it('returns a valid token when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow());

      const result = await repo.findValidToken('123456');

      expect(result).not.toBeNull();
      expect(result!.token).toBe('123456');
      expect(result!.isUsed).toBe(false);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('token = $1');
      expect(sql).toContain('is_used = FALSE');
      expect(sql).toContain('expires_at > NOW()');
    });

    it('returns null when no valid token found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.findValidToken('invalid');

      expect(result).toBeNull();
    });

    it('passes platform filter when provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow({ platform: 'telegram' }));

      await repo.findValidToken('123456', 'telegram');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.any(String), ['123456', 'telegram']);
    });

    it('passes null platform when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.findValidToken('123456');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.any(String), ['123456', null]);
    });
  });

  // ---- consumeToken ----

  describe('consumeToken', () => {
    it('marks a token as used', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.consumeToken('tok-1', 'cu-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_used = TRUE'),
        ['cu-1', 'tok-1']
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('used_at = NOW()');
      expect(sql).toContain('used_by_channel_user_id = $1');
    });
  });

  // ---- cleanupExpired ----

  describe('cleanupExpired', () => {
    it('deletes expired unused tokens and returns count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      const result = await repo.cleanupExpired();

      expect(result).toBe(3);
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('expires_at < NOW()');
      expect(sql).toContain('is_used = FALSE');
    });

    it('returns 0 when no expired tokens', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.cleanupExpired();

      expect(result).toBe(0);
    });
  });

  // ---- listByUser ----

  describe('listByUser', () => {
    it('returns active tokens for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeTokenRow({ id: 'tok-1' }),
        makeTokenRow({ id: 'tok-2' }),
      ]);

      const result = await repo.listByUser('user-1');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ownpilot_user_id = $1');
      expect(sql).toContain('is_used = FALSE');
      expect(sql).toContain('expires_at > NOW()');
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('returns empty array when no active tokens', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByUser('user-empty');

      expect(result).toEqual([]);
    });
  });

  // ---- revokeAll ----

  describe('revokeAll', () => {
    it('deletes all active tokens for a user and returns count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 4 });

      const result = await repo.revokeAll('user-1');

      expect(result).toBe(4);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_verification_tokens'),
        ['user-1']
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('ownpilot_user_id = $1');
      expect(sql).toContain('is_used = FALSE');
    });

    it('returns 0 when no tokens to revoke', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.revokeAll('user-empty');

      expect(result).toBe(0);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('creates Dates from string timestamps', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTokenRow({
          expires_at: '2024-06-01T12:15:00Z',
          created_at: '2024-06-01T12:00:00Z',
        })
      );

      const result = await repo.findValidToken('123456');

      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(result!.expiresAt.toISOString()).toBe('2024-06-01T12:15:00.000Z');
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe('2024-06-01T12:00:00.000Z');
    });

    it('maps usedAt when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTokenRow({
          is_used: true,
          used_at: '2024-06-01T12:05:00Z',
          used_by_channel_user_id: 'cu-1',
        })
      );

      const result = await repo.findValidToken('123456');

      expect(result!.usedAt).toBeInstanceOf(Date);
      expect(result!.usedAt!.toISOString()).toBe('2024-06-01T12:05:00.000Z');
      expect(result!.usedByChannelUserId).toBe('cu-1');
    });

    it('sets usedAt to null when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow());

      const result = await repo.findValidToken('123456');

      expect(result!.usedAt).toBeNull();
      expect(result!.usedByChannelUserId).toBeNull();
    });

    it('maps platform when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow({ platform: 'telegram' }));

      const result = await repo.findValidToken('123456');

      expect(result!.platform).toBe('telegram');
    });

    it('sets platform to null when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow({ platform: null }));

      const result = await repo.findValidToken('123456');

      expect(result!.platform).toBeNull();
    });

    it('maps isUsed boolean', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTokenRow({ is_used: true }));

      const result = await repo.findValidToken('123456');

      expect(result!.isUsed).toBe(true);
    });
  });

  // ---- Factory ----

  describe('createChannelVerificationRepository', () => {
    it('returns a ChannelVerificationRepository instance', () => {
      const r = createChannelVerificationRepository();
      expect(r).toBeInstanceOf(ChannelVerificationRepository);
    });
  });
});

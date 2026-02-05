/**
 * ChannelUsersRepository Tests
 *
 * Tests CRUD operations, findByPlatform, findOrCreate, verification,
 * block/unblock, list with filters, and row-to-entity mapping.
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

// Mock randomUUID to produce deterministic IDs
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('generated-uuid'),
  };
});

const { ChannelUsersRepository, createChannelUsersRepository } =
  await import('./channel-users.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cu-1',
    ownpilot_user_id: 'default',
    platform: 'telegram',
    platform_user_id: '12345',
    platform_username: null,
    display_name: null,
    avatar_url: null,
    is_verified: false,
    verified_at: null,
    verification_method: null,
    is_blocked: false,
    metadata: '{}',
    first_seen_at: '2024-06-01T12:00:00Z',
    last_seen_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelUsersRepository', () => {
  let repo: InstanceType<typeof ChannelUsersRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelUsersRepository();
  });

  // ---- findByPlatform ----

  describe('findByPlatform', () => {
    it('returns a channel user when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserRow());

      const result = await repo.findByPlatform('telegram', '12345');

      expect(result).not.toBeNull();
      expect(result!.platform).toBe('telegram');
      expect(result!.platformUserId).toBe('12345');
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('platform = $1');
      expect(sql).toContain('platform_user_id = $2');
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.findByPlatform('telegram', '99999');

      expect(result).toBeNull();
    });
  });

  // ---- findByOwnpilotUser ----

  describe('findByOwnpilotUser', () => {
    it('returns all channel users for an ownpilot user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeUserRow({ id: 'cu-1', platform: 'telegram' }),
        makeUserRow({ id: 'cu-2', platform: 'discord' }),
      ]);

      const result = await repo.findByOwnpilotUser('user-1');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ownpilot_user_id = $1');
      expect(sql).toContain('ORDER BY last_seen_at DESC');
    });

    it('returns empty array when no users found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.findByOwnpilotUser('user-unknown');

      expect(result).toEqual([]);
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns a user when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserRow());

      const result = await repo.getById('cu-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('cu-1');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['cu-1'],
      );
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a user and returns the mapped entity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ id: 'generated-uuid' }),
      );

      const result = await repo.create({
        platform: 'telegram',
        platformUserId: '12345',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_users'),
        [
          'generated-uuid',
          'default',
          'telegram',
          '12345',
          null,
          null,
          null,
          '{}',
        ],
      );
      expect(result.id).toBe('generated-uuid');
      expect(result.ownpilotUserId).toBe('default');
    });

    it('passes all optional fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({
          id: 'generated-uuid',
          ownpilot_user_id: 'user-1',
          platform_username: 'alice_tg',
          display_name: 'Alice',
          avatar_url: 'https://avatar.png',
          metadata: '{"lang":"en"}',
        }),
      );

      const result = await repo.create({
        ownpilotUserId: 'user-1',
        platform: 'telegram',
        platformUserId: '12345',
        platformUsername: 'alice_tg',
        displayName: 'Alice',
        avatarUrl: 'https://avatar.png',
        metadata: { lang: 'en' },
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_users'),
        [
          'generated-uuid',
          'user-1',
          'telegram',
          '12345',
          'alice_tg',
          'Alice',
          'https://avatar.png',
          '{"lang":"en"}',
        ],
      );
      expect(result.platformUsername).toBe('alice_tg');
      expect(result.displayName).toBe('Alice');
      expect(result.avatarUrl).toBe('https://avatar.png');
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          platform: 'telegram',
          platformUserId: '12345',
        }),
      ).rejects.toThrow('Failed to create channel user');
    });
  });

  // ---- findOrCreate ----

  describe('findOrCreate', () => {
    it('returns existing user with updated last_seen_at', async () => {
      // findByPlatform finds existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserRow());
      // update call
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.findOrCreate({
        platform: 'telegram',
        platformUserId: '12345',
        displayName: 'Updated Name',
      });

      expect(result.id).toBe('cu-1');
      expect(result.lastSeenAt).toBeInstanceOf(Date);
      // Should update display info
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET last_seen_at = NOW()'),
        expect.arrayContaining(['Updated Name']),
      );
    });

    it('creates a new user when none exists', async () => {
      // findByPlatform returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // create: execute + getById
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ id: 'generated-uuid' }),
      );

      const result = await repo.findOrCreate({
        platform: 'discord',
        platformUserId: '67890',
      });

      expect(result.id).toBe('generated-uuid');
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_users'),
        expect.any(Array),
      );
    });

    it('passes null for COALESCE when optional fields not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.findOrCreate({
        platform: 'telegram',
        platformUserId: '12345',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE'),
        [null, null, null, 'cu-1'],
      );
    });
  });

  // ---- markVerified ----

  describe('markVerified', () => {
    it('marks a user as verified with method and ownpilot user', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.markVerified('cu-1', 'user-1', 'pin');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_verified = TRUE'),
        ['pin', 'user-1', 'cu-1'],
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('verified_at = NOW()');
      expect(sql).toContain('verification_method = $1');
      expect(sql).toContain('ownpilot_user_id = $2');
    });
  });

  // ---- block / unblock ----

  describe('block', () => {
    it('sets is_blocked to TRUE', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.block('cu-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_blocked = TRUE'),
        ['cu-1'],
      );
    });
  });

  describe('unblock', () => {
    it('sets is_blocked to FALSE', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.unblock('cu-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_blocked = FALSE'),
        ['cu-1'],
      );
    });
  });

  // ---- list ----

  describe('list', () => {
    it('returns all users with default pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeUserRow({ id: 'cu-1' }),
        makeUserRow({ id: 'cu-2' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY last_seen_at DESC');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('filters by platform', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ platform: 'telegram' });

      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('platform = $');
      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('telegram');
    });

    it('filters by isVerified', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isVerified: true });

      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('is_verified = $');
      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(true);
    });

    it('combines platform and isVerified filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ platform: 'discord', isVerified: false });

      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('platform = $');
      expect(sql).toContain('is_verified = $');
      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('discord');
      expect(params).toContain(false);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 25, offset: 50 });

      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(25);
      expect(params).toContain(50);
    });

    it('uses default limit 100 and offset 0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(100);
      expect(params).toContain(0);
    });

    it('returns empty array when no users match', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list({ platform: 'nonexistent' });

      expect(result).toEqual([]);
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a user is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('cu-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_users WHERE id = $1'),
        ['cu-1'],
      );
    });

    it('returns false when user not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses metadata JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ metadata: '{"lang":"en","source":"bot"}' }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.metadata).toEqual({ lang: 'en', source: 'bot' });
    });

    it('handles already-parsed metadata object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ metadata: { already: 'parsed' } }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.metadata).toEqual({ already: 'parsed' });
    });

    it('handles empty metadata string as empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ metadata: '' }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.metadata).toEqual({});
    });

    it('converts null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeUserRow());

      const result = await repo.getById('cu-1');

      expect(result!.platformUsername).toBeUndefined();
      expect(result!.displayName).toBeUndefined();
      expect(result!.avatarUrl).toBeUndefined();
      expect(result!.verifiedAt).toBeUndefined();
    });

    it('maps non-null optional fields', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({
          platform_username: 'alice_tg',
          display_name: 'Alice',
          avatar_url: 'https://avatar.png',
          is_verified: true,
          verified_at: '2024-06-01T14:00:00Z',
          verification_method: 'pin',
        }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.platformUsername).toBe('alice_tg');
      expect(result!.displayName).toBe('Alice');
      expect(result!.avatarUrl).toBe('https://avatar.png');
      expect(result!.isVerified).toBe(true);
      expect(result!.verifiedAt).toBeInstanceOf(Date);
      expect(result!.verifiedAt!.toISOString()).toBe('2024-06-01T14:00:00.000Z');
      expect(result!.verificationMethod).toBe('pin');
    });

    it('maps all verification methods', async () => {
      for (const method of ['pin', 'oauth', 'whitelist', 'admin'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(
          makeUserRow({ verification_method: method }),
        );

        const result = await repo.getById('cu-1');

        expect(result!.verificationMethod).toBe(method);
      }
    });

    it('creates Dates from string timestamps', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({
          first_seen_at: '2024-01-15T10:30:00Z',
          last_seen_at: '2024-06-15T14:00:00Z',
        }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.firstSeenAt).toBeInstanceOf(Date);
      expect(result!.firstSeenAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
      expect(result!.lastSeenAt).toBeInstanceOf(Date);
      expect(result!.lastSeenAt.toISOString()).toBe('2024-06-15T14:00:00.000Z');
    });

    it('maps isBlocked boolean', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeUserRow({ is_blocked: true }),
      );

      const result = await repo.getById('cu-1');

      expect(result!.isBlocked).toBe(true);
    });
  });

  // ---- Factory ----

  describe('createChannelUsersRepository', () => {
    it('returns a ChannelUsersRepository instance', () => {
      const r = createChannelUsersRepository();
      expect(r).toBeInstanceOf(ChannelUsersRepository);
    });
  });
});

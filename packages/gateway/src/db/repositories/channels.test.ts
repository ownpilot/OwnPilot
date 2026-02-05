/**
 * ChannelsRepository Tests
 *
 * Tests CRUD operations, status management, config updates,
 * and row-to-entity mapping for the channels table.
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

const { ChannelsRepository } = await import('./channels.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    type: 'telegram',
    name: 'My Telegram',
    status: 'disconnected',
    config: '{"token":"abc"}',
    created_at: '2024-06-01T12:00:00Z',
    connected_at: null,
    last_activity_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelsRepository', () => {
  let repo: InstanceType<typeof ChannelsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelsRepository();
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a channel and returns the mapped entity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeChannelRow());

      const result = await repo.create({
        id: 'ch-1',
        type: 'telegram',
        name: 'My Telegram',
        config: { token: 'abc' },
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channels'),
        ['ch-1', 'telegram', 'My Telegram', '{"token":"abc"}'],
      );

      expect(result.id).toBe('ch-1');
      expect(result.type).toBe('telegram');
      expect(result.name).toBe('My Telegram');
      expect(result.status).toBe('disconnected');
      expect(result.config).toEqual({ token: 'abc' });
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.connectedAt).toBeUndefined();
      expect(result.lastActivityAt).toBeUndefined();
    });

    it('uses empty config when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ config: '{}' }),
      );

      await repo.create({
        id: 'ch-2',
        type: 'slack',
        name: 'Slack Channel',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channels'),
        ['ch-2', 'slack', 'Slack Channel', '{}'],
      );
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({ id: 'ch-fail', type: 'test', name: 'Test' }),
      ).rejects.toThrow('Failed to create channel');
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns a channel when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeChannelRow());

      const result = await repo.getById('ch-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ch-1');
      expect(result!.type).toBe('telegram');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['ch-1'],
      );
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });

    it('maps connected_at and last_activity_at when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({
          status: 'connected',
          connected_at: '2024-06-01T14:00:00Z',
          last_activity_at: '2024-06-01T15:30:00Z',
        }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.connectedAt).toBeInstanceOf(Date);
      expect(result!.connectedAt!.toISOString()).toBe('2024-06-01T14:00:00.000Z');
      expect(result!.lastActivityAt).toBeInstanceOf(Date);
      expect(result!.lastActivityAt!.toISOString()).toBe('2024-06-01T15:30:00.000Z');
    });
  });

  // ---- getByType ----

  describe('getByType', () => {
    it('returns channels filtered by type', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeChannelRow({ id: 'ch-1' }),
        makeChannelRow({ id: 'ch-2', name: 'Second Telegram' }),
      ]);

      const result = await repo.getByType('telegram');

      expect(result).toHaveLength(2);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE type = $1'),
        ['telegram'],
      );
    });

    it('returns empty array when no channels match', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByType('discord');

      expect(result).toEqual([]);
    });
  });

  // ---- getAll ----

  describe('getAll', () => {
    it('returns all channels ordered by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeChannelRow({ id: 'ch-1' }),
        makeChannelRow({ id: 'ch-2', type: 'slack' }),
      ]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  // ---- getConnected ----

  describe('getConnected', () => {
    it('returns only connected channels', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeChannelRow({
          status: 'connected',
          connected_at: '2024-06-01T14:00:00Z',
        }),
      ]);

      const result = await repo.getConnected();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('connected');
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("WHERE status = 'connected'");
    });
  });

  // ---- updateStatus ----

  describe('updateStatus', () => {
    it('updates status to connected and sets connected_at', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'connected');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET status = $1'),
        ['connected', 'connected', 'ch-1'],
      );
    });

    it('updates status to disconnected', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'disconnected');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET status = $1'),
        ['disconnected', 'disconnected', 'ch-1'],
      );
    });

    it('updates status to error', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'error');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET status = $1'),
        ['error', 'error', 'ch-1'],
      );
    });
  });

  // ---- updateLastActivity ----

  describe('updateLastActivity', () => {
    it('updates last_activity_at to NOW()', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET last_activity_at = NOW()'),
        ['ch-1'],
      );
    });
  });

  // ---- updateConfig ----

  describe('updateConfig', () => {
    it('serialises and stores new config', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateConfig('ch-1', { token: 'new-token', webhookUrl: 'https://example.com' });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET config = $1'),
        ['{"token":"new-token","webhookUrl":"https://example.com"}', 'ch-1'],
      );
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a channel is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('ch-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channels WHERE id = $1'),
        ['ch-1'],
      );
    });

    it('returns false when channel not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- count ----

  describe('count', () => {
    it('returns total channel count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });

      const result = await repo.count();

      expect(result).toBe(7);
    });

    it('returns 0 when query result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });

  // ---- countByStatus ----

  describe('countByStatus', () => {
    it('returns count filtered by status', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      const result = await repo.countByStatus('connected');

      expect(result).toBe(3);
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        ['connected'],
      );
    });

    it('returns 0 for status with no channels', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      const result = await repo.countByStatus('error');

      expect(result).toBe(0);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses config JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ config: '{"webhook":true}' }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.config).toEqual({ webhook: true });
    });

    it('handles already-parsed config object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ config: { already: 'parsed' } }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.config).toEqual({ already: 'parsed' });
    });

    it('handles empty config string as empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ config: '' }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.config).toEqual({});
    });

    it('sets connectedAt to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ connected_at: null }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.connectedAt).toBeUndefined();
    });

    it('sets lastActivityAt to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeChannelRow({ last_activity_at: null }),
      );

      const result = await repo.getById('ch-1');

      expect(result!.lastActivityAt).toBeUndefined();
    });

    it('maps all valid status values', async () => {
      for (const status of ['connected', 'disconnected', 'connecting', 'error'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(makeChannelRow({ status }));

        const result = await repo.getById('ch-1');

        expect(result!.status).toBe(status);
      }
    });
  });
});

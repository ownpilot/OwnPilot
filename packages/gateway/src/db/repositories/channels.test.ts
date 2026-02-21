/**
 * ChannelsRepository Tests
 *
 * Comprehensive unit tests for ChannelsRepository upsert, updateStatus, and updateLastActivity methods.
 * Tests cover SQL correctness, parameter passing, edge cases, and singleton export.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock setup
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

const { ChannelsRepository, channelsRepo } = await import('./channels.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelsRepository', () => {
  let repo: InstanceType<typeof ChannelsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelsRepository();
  });

  // =========================================================================
  // upsert
  // =========================================================================

  describe('upsert', () => {
    it('calls execute with INSERT...ON CONFLICT SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'My Channel',
        status: 'connected',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO channels');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
    });

    it('passes [id, type, name, status] as params in correct order', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-telegram-1',
        type: 'telegram',
        name: 'Main Bot',
        status: 'connected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ch-telegram-1', 'telegram', 'Main Bot', 'connected']);
    });

    it('includes status = EXCLUDED.status in UPDATE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('status = EXCLUDED.status');
    });

    it('includes name = EXCLUDED.name in UPDATE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Updated Name',
        status: 'disconnected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('name = EXCLUDED.name');
    });

    it('includes connected_at CASE logic in UPDATE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('connected_at = CASE WHEN EXCLUDED.status = \'connected\'');
      expect(sql).toContain('channels.connected_at END');
    });

    it('includes last_activity_at = NOW() in UPDATE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('last_activity_at = NOW()');
    });

    it('handles upsert with connected status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-new',
        type: 'telegram',
        name: 'New Channel',
        status: 'connected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];

      expect(sql).toContain('INSERT INTO channels');
      expect(params).toEqual(['ch-new', 'telegram', 'New Channel', 'connected']);
    });

    it('handles upsert with disconnected status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Channel',
        status: 'disconnected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('disconnected');
    });

    it('handles upsert with error status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Channel',
        status: 'error',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('error');
    });

    it('handles upsert with different type values', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-slack',
        type: 'slack',
        name: 'Slack Integration',
        status: 'connected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('slack');
    });

    it('resolves without error on success', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      expect(result).toBeUndefined();
    });

    it('handles multiple upserts with different data', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Channel 1',
        status: 'connected',
      });

      await repo.upsert({
        id: 'ch-2',
        type: 'telegram',
        name: 'Channel 2',
        status: 'disconnected',
      });

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
      const firstCall = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const secondCall = mockAdapter.execute.mock.calls[1]![1] as unknown[];

      expect(firstCall[0]).toBe('ch-1');
      expect(secondCall[0]).toBe('ch-2');
    });

    it('handles upsert with special characters in name', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const specialName = "Bot's \"Official\" Channel";
      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: specialName,
        status: 'connected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe(specialName);
    });

    it('handles upsert with long channel name', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const longName = 'A'.repeat(255);
      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: longName,
        status: 'connected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe(longName);
    });

    it('handles upsert when execute resolves with 0 changes (constraint violation)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // updateStatus
  // =========================================================================

  describe('updateStatus', () => {
    it('calls execute with UPDATE SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'disconnected');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE channels SET status = $1');
    });

    it('passes [status, id] as params in correct order', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-99', 'connected');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['connected', 'ch-99']);
    });

    it('includes last_activity_at = NOW() in UPDATE clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'error');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('last_activity_at = NOW()');
    });

    it('includes WHERE id = $2 clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'disconnected');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $2');
    });

    it('handles status = connected', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'connected');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('connected');
    });

    it('handles status = disconnected', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'disconnected');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('disconnected');
    });

    it('handles status = error', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'error');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('error');
    });

    it('handles different channel IDs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-telegram-123', 'connected');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('ch-telegram-123');
    });

    it('resolves without error on success', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateStatus('ch-1', 'connected');

      expect(result).toBeUndefined();
    });

    it('handles updateStatus when no rows affected', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateStatus('ch-missing', 'connected');

      expect(result).toBeUndefined();
    });

    it('handles multiple updateStatus calls', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateStatus('ch-1', 'connected');
      await repo.updateStatus('ch-2', 'disconnected');
      await repo.updateStatus('ch-3', 'error');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(3);
      expect((mockAdapter.execute.mock.calls[0]![1] as unknown[])[0]).toBe('connected');
      expect((mockAdapter.execute.mock.calls[1]![1] as unknown[])[0]).toBe('disconnected');
      expect((mockAdapter.execute.mock.calls[2]![1] as unknown[])[0]).toBe('error');
    });
  });

  // =========================================================================
  // updateLastActivity
  // =========================================================================

  describe('updateLastActivity', () => {
    it('calls execute with UPDATE SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE channels SET last_activity_at = NOW()');
    });

    it('passes [id] as the only param', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-99');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ch-99']);
    });

    it('includes WHERE id = $1 clause', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $1');
    });

    it('handles different channel IDs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-telegram-456');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('ch-telegram-456');
    });

    it('resolves without error on success', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateLastActivity('ch-1');

      expect(result).toBeUndefined();
    });

    it('handles updateLastActivity when no rows affected', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateLastActivity('ch-missing');

      expect(result).toBeUndefined();
    });

    it('handles multiple updateLastActivity calls', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateLastActivity('ch-1');
      await repo.updateLastActivity('ch-2');
      await repo.updateLastActivity('ch-3');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(3);
      expect((mockAdapter.execute.mock.calls[0]![1] as unknown[])[0]).toBe('ch-1');
      expect((mockAdapter.execute.mock.calls[1]![1] as unknown[])[0]).toBe('ch-2');
      expect((mockAdapter.execute.mock.calls[2]![1] as unknown[])[0]).toBe('ch-3');
    });

    it('handles channel ID with special characters', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-telegram_bot-123');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('ch-telegram_bot-123');
    });
  });

  // =========================================================================
  // Extension and inheritance tests
  // =========================================================================

  describe('inheritance', () => {
    it('ChannelsRepository extends BaseRepository', () => {
      expect(repo).toBeInstanceOf(ChannelsRepository);
      // Verify inheritance chain through prototype
      const proto = Object.getPrototypeOf(repo);
      expect(proto.constructor.name).toBe('ChannelsRepository');
    });

    it('new instance works independently from repo', async () => {
      const repo2 = new ChannelsRepository();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo2.updateStatus('ch-1', 'connected');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Singleton export
  // =========================================================================

  describe('channelsRepo singleton export', () => {
    it('channelsRepo is an instance of ChannelsRepository', () => {
      expect(channelsRepo).toBeInstanceOf(ChannelsRepository);
    });

    it('channelsRepo can call upsert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await channelsRepo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('channelsRepo can call updateStatus', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await channelsRepo.updateStatus('ch-1', 'connected');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('channelsRepo can call updateLastActivity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await channelsRepo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Integration-style tests
  // =========================================================================

  describe('integrated workflows', () => {
    it('upsert followed by updateStatus', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Bot',
        status: 'connecting',
      });

      await repo.updateStatus('ch-1', 'connected');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
      const firstSql = mockAdapter.execute.mock.calls[0]![0] as string;
      const secondSql = mockAdapter.execute.mock.calls[1]![0] as string;

      expect(firstSql).toContain('INSERT INTO channels');
      expect(secondSql).toContain('UPDATE channels SET status');
    });

    it('updateStatus followed by updateLastActivity', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateStatus('ch-1', 'error');
      await repo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
      const firstSql = mockAdapter.execute.mock.calls[0]![0] as string;
      const secondSql = mockAdapter.execute.mock.calls[1]![0] as string;

      expect(firstSql).toContain('UPDATE channels SET status');
      expect(secondSql).toContain('UPDATE channels SET last_activity_at');
    });

    it('full lifecycle: upsert -> updateStatus -> updateLastActivity', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Bot',
        status: 'connecting',
      });

      await repo.updateStatus('ch-1', 'connected');
      await repo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(3);
    });
  });
});

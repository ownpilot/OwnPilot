/**
 * Channels Repository Tests
 *
 * Unit tests for ChannelsRepository upsert, updateStatus, and updateLastActivity.
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
    it('should call execute with ON CONFLICT SQL', async () => {
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
      expect(sql).toContain('status = EXCLUDED.status');
      expect(sql).toContain('name = EXCLUDED.name');
    });

    it('should pass params in correct order', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'My Channel',
        status: 'connected',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ch-1', 'telegram', 'My Channel', 'connected']);
    });

    it('should handle connected_at conditionally in SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.upsert({
        id: 'ch-1',
        type: 'telegram',
        name: 'Test',
        status: 'connected',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("EXCLUDED.status = 'connected'");
      expect(sql).toContain('connected_at');
    });
  });

  // =========================================================================
  // updateStatus
  // =========================================================================

  describe('updateStatus', () => {
    it('should call execute with UPDATE SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'disconnected');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE channels SET status = $1');
      expect(sql).toContain('last_activity_at = NOW()');
      expect(sql).toContain('WHERE id = $2');
    });

    it('should pass status and id as params', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('ch-1', 'error');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['error', 'ch-1']);
    });
  });

  // =========================================================================
  // updateLastActivity
  // =========================================================================

  describe('updateLastActivity', () => {
    it('should call execute with UPDATE SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-1');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE channels SET last_activity_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
    });

    it('should pass id as the only param', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateLastActivity('ch-99');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ch-99']);
    });
  });

  // =========================================================================
  // Singleton export
  // =========================================================================

  describe('channelsRepo singleton', () => {
    it('should be an instance of ChannelsRepository', () => {
      expect(channelsRepo).toBeInstanceOf(ChannelsRepository);
    });
  });
});

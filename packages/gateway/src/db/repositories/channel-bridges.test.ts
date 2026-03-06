/**
 * ChannelBridgesRepository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateId: vi.fn(() => 'bridge-test-id') };
});

const { ChannelBridgesRepository } = await import('./channel-bridges.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBridgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bridge-1',
    source_channel_id: 'ch-src',
    target_channel_id: 'ch-tgt',
    direction: 'unidirectional',
    filter_pattern: null,
    enabled: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelBridgesRepository', () => {
  let repo: ChannelBridgesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new ChannelBridgesRepository();
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('returns empty array when no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.getAll()).toEqual([]);
    });

    it('maps multiple rows to UCPBridgeConfig objects', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeBridgeRow({ id: 'b1' }),
        makeBridgeRow({ id: 'b2', direction: 'bidirectional' }),
      ]);
      const result = await repo.getAll();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b1');
      expect(result[1].direction).toBe('bidirectional');
    });

    it('maps filterPattern null → undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeBridgeRow({ filter_pattern: null })]);
      const result = await repo.getAll();
      expect(result[0].filterPattern).toBeUndefined();
    });

    it('maps filterPattern string when present', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeBridgeRow({ filter_pattern: 'support:*' })]);
      const result = await repo.getAll();
      expect(result[0].filterPattern).toBe('support:*');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('returns null when not found', async () => {
      expect(await repo.getById('missing')).toBeNull();
    });

    it('returns mapped bridge when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBridgeRow({ id: 'b-42' }));
      const result = await repo.getById('b-42');
      expect(result?.id).toBe('b-42');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(params[0]).toBe('b-42');
    });

    it('parses createdAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeBridgeRow());
      const result = await repo.getById('b-1');
      expect(result?.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // getByChannel
  // =========================================================================

  describe('getByChannel', () => {
    it('returns bridges where channel is source or target', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeBridgeRow({ source_channel_id: 'ch-x' })]);
      const result = await repo.getByChannel('ch-x');
      expect(result).toHaveLength(1);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('source_channel_id = $1 OR target_channel_id = $1');
      expect(sql).toContain('enabled = true');
      expect(params[0]).toBe('ch-x');
    });

    it('returns empty array when no matching bridges', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.getByChannel('no-channel')).toEqual([]);
    });
  });

  // =========================================================================
  // save
  // =========================================================================

  describe('save', () => {
    it('inserts and returns the constructed config', async () => {
      const config = {
        sourceChannelId: 'src-ch',
        targetChannelId: 'tgt-ch',
        direction: 'unidirectional' as const,
        enabled: true,
      };
      const result = await repo.save(config);
      expect(result.id).toBe('bridge-test-id');
      expect(result.sourceChannelId).toBe('src-ch');
      expect(result.targetChannelId).toBe('tgt-ch');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('passes filter_pattern as null when not provided', async () => {
      await repo.save({
        sourceChannelId: 's',
        targetChannelId: 't',
        direction: 'bidirectional',
        enabled: true,
      });
      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBeNull(); // filterPattern
    });

    it('passes filter_pattern string when provided', async () => {
      await repo.save({
        sourceChannelId: 's',
        targetChannelId: 't',
        direction: 'unidirectional',
        filterPattern: 'prefix:*',
        enabled: false,
      });
      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe('prefix:*');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('returns early when no changes', async () => {
      await repo.update('b-1', {});
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('sets enabled field', async () => {
      await repo.update('b-1', { enabled: false });
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('enabled =');
      expect(params).toContain(false);
      expect(params).toContain('b-1');
    });

    it('sets direction field', async () => {
      await repo.update('b-1', { direction: 'bidirectional' });
      const [sql] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('direction =');
    });

    it('sets filterPattern field', async () => {
      await repo.update('b-1', { filterPattern: 'test:*' });
      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params).toContain('test:*');
    });

    it('sets multiple fields at once', async () => {
      await repo.update('b-1', {
        enabled: true,
        direction: 'unidirectional',
        sourceChannelId: 'new-src',
      });
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('source_channel_id =');
      expect(sql).toContain('direction =');
      expect(sql).toContain('enabled =');
      expect(params).toContain('b-1');
    });

    it('sets targetChannelId field (lines 107-108)', async () => {
      await repo.update('b-1', { targetChannelId: 'new-tgt' });
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('target_channel_id =');
      expect(params).toContain('new-tgt');
    });
  });

  // =========================================================================
  // remove
  // =========================================================================

  describe('remove', () => {
    it('executes DELETE for the given id', async () => {
      await repo.remove('b-99');
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM channel_bridges');
      expect(params[0]).toBe('b-99');
    });
  });
});

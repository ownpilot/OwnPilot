/**
 * ChannelAssetsRepository Tests
 *
 * Tests the ChannelAssetsRepository class, verifying CRUD operations,
 * row-to-record mapping, and asset lifecycle management.
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

// Import after mocks are established
const { ChannelAssetsRepository, createChannelAssetsRepository, channelAssetsRepo } = await import(
  './channel-assets.js'
);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockAssetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'asset-123',
    channel_message_id: 'msg-456',
    channel_plugin_id: 'plugin-telegram',
    platform: 'telegram',
    platform_chat_id: 'chat-789',
    conversation_id: 'conv-abc',
    type: 'image',
    mime_type: 'image/jpeg',
    filename: 'photo.jpg',
    size: '1024',
    storage_path: '/storage/assets/asset-123.jpg',
    sha256: 'abc123def456',
    metadata: '{"width": 800, "height": 600}',
    expires_at: '2026-12-31T23:59:59Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createCreateInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'asset-123',
    channelMessageId: 'msg-456',
    channelPluginId: 'plugin-telegram',
    platform: 'telegram',
    platformChatId: 'chat-789',
    conversationId: 'conv-abc',
    type: 'image' as const,
    mimeType: 'image/jpeg',
    filename: 'photo.jpg',
    size: 1024,
    storagePath: '/storage/assets/asset-123.jpg',
    sha256: 'abc123def456',
    metadata: { width: 800, height: 600 },
    expiresAt: '2026-12-31T23:59:59Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelAssetsRepository', () => {
  let repo: ChannelAssetsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createChannelAssetsRepository();
  });

  // ---- create() ----

  describe('create', () => {
    it('creates a channel asset with all fields', async () => {
      const input = createCreateInput();
      const mockRow = createMockAssetRow();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.create(input);

      // Verify INSERT was called with correct SQL and params
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO channel_assets');
      expect(sql).toContain('id, channel_message_id, channel_plugin_id');
      expect(params).toHaveLength(14);
      expect(params[0]).toBe(input.id);
      expect(params[1]).toBe(input.channelMessageId);
      expect(params[6]).toBe(input.type);
      expect(params[7]).toBe(input.mimeType);
      expect(params[12]).toBe(JSON.stringify(input.metadata));

      // Verify result is properly mapped
      expect(result.id).toBe(input.id);
      expect(result.channelMessageId).toBe(input.channelMessageId);
      expect(result.type).toBe(input.type);
      expect(result.metadata).toEqual(input.metadata);
    });

    it('creates a channel asset with minimal fields', async () => {
      const input = {
        id: 'asset-min',
        channelMessageId: 'msg-min',
        channelPluginId: 'plugin-test',
        platform: 'test',
        platformChatId: 'chat-min',
        type: 'file' as const,
        mimeType: 'application/pdf',
        expiresAt: '2026-12-31T23:59:59Z',
      };
      const mockRow = createMockAssetRow({
        id: 'asset-min',
        channel_message_id: 'msg-min',
        type: 'file',
        mime_type: 'application/pdf',
        filename: null,
        size: null,
        storage_path: null,
        sha256: null,
        conversation_id: null,
        metadata: '{}',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.create(input);

      // Verify optional fields are passed as null
      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[5]).toBeNull(); // conversation_id
      expect(params[8]).toBeNull(); // filename
      expect(params[9]).toBeNull(); // size
      expect(params[10]).toBeNull(); // storage_path
      expect(params[11]).toBeNull(); // sha256
      expect(params[12]).toBe('{}'); // metadata

      // Verify result has undefined for null fields
      expect(result.filename).toBeUndefined();
      expect(result.size).toBeUndefined();
      expect(result.storagePath).toBeUndefined();
      expect(result.sha256).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
      expect(result.metadata).toEqual({});
    });

    it('handles different asset types', async () => {
      const types = ['image', 'audio', 'video', 'file'] as const;

      for (const type of types) {
        vi.clearAllMocks();
        const input = createCreateInput({ type, mimeType: `test/${type}` });
        const mockRow = createMockAssetRow({ type, mime_type: `test/${type}` });

        mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
        mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

        const result = await repo.create(input);
        expect(result.type).toBe(type);
      }
    });

    it('throws error when getById returns null after creation', async () => {
      const input = createCreateInput();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create(input)).rejects.toThrow('Failed to create channel asset');
    });
  });

  // ---- getById() ----

  describe('getById', () => {
    it('returns mapped record when asset exists', async () => {
      const mockRow = createMockAssetRow();
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT * FROM channel_assets WHERE id = $1',
        ['asset-123']
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('asset-123');
      expect(result?.channelMessageId).toBe('msg-456');
      expect(result?.channelPluginId).toBe('plugin-telegram');
      expect(result?.platform).toBe('telegram');
      expect(result?.platformChatId).toBe('chat-789');
      expect(result?.conversationId).toBe('conv-abc');
      expect(result?.type).toBe('image');
      expect(result?.mimeType).toBe('image/jpeg');
      expect(result?.filename).toBe('photo.jpg');
      expect(result?.size).toBe(1024);
      expect(result?.storagePath).toBe('/storage/assets/asset-123.jpg');
      expect(result?.sha256).toBe('abc123def456');
      expect(result?.metadata).toEqual({ width: 800, height: 600 });
      expect(result?.expiresAt).toBe('2026-12-31T23:59:59Z');
      expect(result?.createdAt).toBe('2026-01-01T00:00:00Z');
    });

    it('returns null when asset does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('correctly handles numeric size conversion', async () => {
      const mockRow = createMockAssetRow({ size: '2048' });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.size).toBe(2048);
      expect(typeof result?.size).toBe('number');
    });

    it('handles null conversation_id correctly', async () => {
      const mockRow = createMockAssetRow({ conversation_id: null });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.conversationId).toBeUndefined();
    });

    it('handles empty metadata JSON', async () => {
      const mockRow = createMockAssetRow({ metadata: '{}' });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.metadata).toEqual({});
    });

    it('handles complex nested metadata', async () => {
      const complexMetadata = {
        exif: { camera: 'Canon', iso: 400 },
        thumbnails: [{ width: 100, height: 100, url: '/thumb.jpg' }],
        tags: ['vacation', 'beach'],
      };
      const mockRow = createMockAssetRow({ metadata: JSON.stringify(complexMetadata) });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.metadata).toEqual(complexMetadata);
    });
  });

  // ---- linkConversation() ----

  describe('linkConversation', () => {
    it('updates assets with conversation_id when assetIds is not empty', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });

      await repo.linkConversation(['asset-1', 'asset-2'], 'conv-xyz');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        `UPDATE channel_assets
       SET conversation_id = $1
       WHERE id = ANY($2::text[]) AND conversation_id IS NULL`,
        ['conv-xyz', ['asset-1', 'asset-2']]
      );
    });

    it('does nothing when assetIds array is empty', async () => {
      await repo.linkConversation([], 'conv-xyz');

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('only updates assets without existing conversation_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.linkConversation(['asset-1', 'asset-2'], 'conv-new');

      // The SQL includes the condition: AND conversation_id IS NULL
      const [sql] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('conversation_id IS NULL');
    });
  });

  // ---- listExpired() ----

  describe('listExpired', () => {
    it('returns expired assets ordered by expires_at', async () => {
      const mockRows = [
        createMockAssetRow({ id: 'asset-1', expires_at: '2026-01-01T00:00:00Z' }),
        createMockAssetRow({ id: 'asset-2', expires_at: '2026-01-02T00:00:00Z' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const nowIso = '2026-06-01T00:00:00Z';
      const result = await repo.listExpired(nowIso);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        `SELECT * FROM channel_assets WHERE expires_at <= $1 ORDER BY expires_at ASC LIMIT 100`,
        [nowIso]
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('asset-1');
      expect(result[1].id).toBe('asset-2');
    });

    it('returns empty array when no expired assets', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listExpired('2026-06-01T00:00:00Z');

      expect(result).toEqual([]);
    });

    it('respects the 100 item limit', async () => {
      const mockRows = Array.from({ length: 100 }, (_, i) =>
        createMockAssetRow({ id: `asset-${i}` })
      );
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const result = await repo.listExpired('2026-06-01T00:00:00Z');

      expect(result).toHaveLength(100);
      const [sql] = mockAdapter.query.mock.calls[0];
      expect(sql).toContain('LIMIT 100');
    });
  });

  // ---- deleteMany() ----

  describe('deleteMany', () => {
    it('deletes multiple assets by id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      await repo.deleteMany(['asset-1', 'asset-2', 'asset-3']);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        `DELETE FROM channel_assets WHERE id = ANY($1::text[])`,
        [['asset-1', 'asset-2', 'asset-3']]
      );
    });

    it('does nothing when assetIds array is empty', async () => {
      await repo.deleteMany([]);

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('handles single asset deletion', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deleteMany(['asset-1']);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        `DELETE FROM channel_assets WHERE id = ANY($1::text[])`,
        [['asset-1']]
      );
    });
  });

  // ---- singleton instance ----

  describe('channelAssetsRepo singleton', () => {
    it('is exported as a singleton instance', () => {
      expect(channelAssetsRepo).toBeInstanceOf(ChannelAssetsRepository);
    });

    it('createChannelAssetsRepository creates new instances', () => {
      const repo1 = createChannelAssetsRepository();
      const repo2 = createChannelAssetsRepository();

      expect(repo1).toBeInstanceOf(ChannelAssetsRepository);
      expect(repo2).toBeInstanceOf(ChannelAssetsRepository);
      expect(repo1).not.toBe(repo2);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('propagates database errors on create', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('connection failed'));

      await expect(repo.create(createCreateInput())).rejects.toThrow('connection failed');
    });

    it('propagates database errors on getById', async () => {
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('query timeout'));

      await expect(repo.getById('asset-123')).rejects.toThrow('query timeout');
    });

    it('propagates database errors on linkConversation', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.linkConversation(['asset-1'], 'conv-1')).rejects.toThrow(
        'constraint violation'
      );
    });

    it('propagates database errors on listExpired', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.listExpired('2026-06-01T00:00:00Z')).rejects.toThrow('disk full');
    });

    it('propagates database errors on deleteMany', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.deleteMany(['asset-1'])).rejects.toThrow('permission denied');
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('handles metadata with special characters', async () => {
      const metadata = { description: 'Photo with "quotes" and \n newlines' };
      const mockRow = createMockAssetRow({ metadata: JSON.stringify(metadata) });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.metadata).toEqual(metadata);
    });

    it('handles undefined optional fields during create', async () => {
      const input = {
        id: 'asset-edge',
        channelMessageId: 'msg-edge',
        channelPluginId: 'plugin-edge',
        platform: 'test',
        platformChatId: 'chat-edge',
        type: 'image' as const,
        mimeType: 'image/png',
        expiresAt: '2026-12-31T23:59:59Z',
        // All optional fields intentionally omitted
      };
      const mockRow = createMockAssetRow({
        id: 'asset-edge',
        conversation_id: null,
        filename: null,
        size: null,
        storage_path: null,
        sha256: null,
        metadata: '{}',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.create(input);

      expect(result.conversationId).toBeUndefined();
      expect(result.filename).toBeUndefined();
      expect(result.size).toBeUndefined();
    });

    it('handles size as string "0" correctly', async () => {
      const mockRow = createMockAssetRow({ size: '0' });
      mockAdapter.queryOne.mockResolvedValueOnce(mockRow);

      const result = await repo.getById('asset-123');

      expect(result?.size).toBe(0);
    });
  });
});

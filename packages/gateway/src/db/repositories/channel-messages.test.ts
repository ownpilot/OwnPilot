/**
 * ChannelMessagesRepository Tests
 *
 * Tests CRUD operations, inbox/outbox queries, search, pagination,
 * and row-to-entity mapping for the channel_messages table.
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

const { ChannelMessagesRepository, createChannelMessagesRepository } =
  await import('./channel-messages.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    channel_id: 'ch-1',
    external_id: null,
    direction: 'inbound',
    sender_id: null,
    sender_name: null,
    content: 'Hello world',
    content_type: 'text',
    attachments: null,
    reply_to_id: null,
    metadata: '{}',
    created_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelMessagesRepository', () => {
  let repo: InstanceType<typeof ChannelMessagesRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelMessagesRepository();
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a message and returns the mapped entity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.create({
        id: 'msg-1',
        channelId: 'ch-1',
        direction: 'inbound',
        content: 'Hello world',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_messages'),
        [
          'msg-1',
          'ch-1',
          null,
          'inbound',
          null,
          null,
          'Hello world',
          'text',
          null,
          null,
          '{}',
        ],
      );

      expect(result.id).toBe('msg-1');
      expect(result.channelId).toBe('ch-1');
      expect(result.direction).toBe('inbound');
      expect(result.content).toBe('Hello world');
      expect(result.contentType).toBe('text');
      expect(result.metadata).toEqual({});
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('passes all optional fields correctly', async () => {
      const attachments = [{ type: 'image', url: 'https://img.png', name: 'photo.png' }];
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({
          external_id: 'ext-1',
          sender_id: 'user-1',
          sender_name: 'Alice',
          content_type: 'markdown',
          attachments: JSON.stringify(attachments),
          reply_to_id: 'msg-0',
          metadata: '{"source":"api"}',
        }),
      );

      const result = await repo.create({
        id: 'msg-1',
        channelId: 'ch-1',
        externalId: 'ext-1',
        direction: 'outbound',
        senderId: 'user-1',
        senderName: 'Alice',
        content: 'Reply here',
        contentType: 'markdown',
        attachments,
        replyToId: 'msg-0',
        metadata: { source: 'api' },
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_messages'),
        [
          'msg-1',
          'ch-1',
          'ext-1',
          'outbound',
          'user-1',
          'Alice',
          'Reply here',
          'markdown',
          JSON.stringify(attachments),
          'msg-0',
          '{"source":"api"}',
        ],
      );

      expect(result.externalId).toBe('ext-1');
      expect(result.senderId).toBe('user-1');
      expect(result.senderName).toBe('Alice');
      expect(result.attachments).toEqual(attachments);
      expect(result.replyToId).toBe('msg-0');
      expect(result.metadata).toEqual({ source: 'api' });
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          id: 'msg-fail',
          channelId: 'ch-1',
          direction: 'inbound',
          content: 'Test',
        }),
      ).rejects.toThrow('Failed to create channel message');
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns a message when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.getById('msg-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('msg-1');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['msg-1'],
      );
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });
  });

  // ---- getByChannel ----

  describe('getByChannel', () => {
    it('returns messages for a channel ordered by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1' }),
        makeMessageRow({ id: 'msg-2' }),
      ]);

      const result = await repo.getByChannel('ch-1');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('WHERE channel_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('uses default limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByChannel('ch-1');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['ch-1', 100, 0],
      );
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByChannel('ch-1', 25, 50);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['ch-1', 25, 50],
      );
    });

    it('returns empty array when no messages exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByChannel('ch-empty');

      expect(result).toEqual([]);
    });
  });

  // ---- getInbox ----

  describe('getInbox', () => {
    it('returns inbound messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ direction: 'inbound' }),
      ]);

      const result = await repo.getInbox();

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("direction = 'inbound'");
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('uses default limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getInbox();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 0],
      );
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getInbox(10, 20);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        [10, 20],
      );
    });
  });

  // ---- getOutbox ----

  describe('getOutbox', () => {
    it('returns outbound messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ direction: 'outbound' }),
      ]);

      const result = await repo.getOutbox();

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("direction = 'outbound'");
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getOutbox(5, 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        [5, 10],
      );
    });
  });

  // ---- getRecent ----

  describe('getRecent', () => {
    it('returns recent messages for a channel in ascending order', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1' }),
        makeMessageRow({ id: 'msg-2' }),
      ]);

      const result = await repo.getRecent('ch-1', 10);

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('WHERE channel_id = $1');
      expect(sql).toContain('ORDER BY created_at ASC');
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['ch-1', 10],
      );
    });

    it('returns empty array when no messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getRecent('ch-empty', 5);

      expect(result).toEqual([]);
    });
  });

  // ---- search ----

  describe('search', () => {
    it('searches messages by content ILIKE', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ content: 'Hello world' }),
      ]);

      const result = await repo.search('hello');

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ILIKE');
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('uses default limit of 50', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('test');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['%test%', 50],
      );
    });

    it('applies custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('test', 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['%test%', 10],
      );
    });

    it('escapes LIKE wildcards in search query', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('100%_match');

      const params = mockAdapter.query.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('%100\\%\\_match%');
    });

    it('returns empty array when no results', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.search('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a message is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('msg-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_messages WHERE id = $1'),
        ['msg-1'],
      );
    });

    it('returns false when message not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- deleteByChannel ----

  describe('deleteByChannel', () => {
    it('returns number of deleted messages', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 });

      const result = await repo.deleteByChannel('ch-1');

      expect(result).toBe(5);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_messages WHERE channel_id = $1'),
        ['ch-1'],
      );
    });

    it('returns 0 when no messages to delete', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteByChannel('ch-empty');

      expect(result).toBe(0);
    });
  });

  // ---- count ----

  describe('count', () => {
    it('returns total count when no channelId provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      const result = await repo.count();

      expect(result).toBe(42);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE channel_id');
    });

    it('returns count filtered by channelId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '10' });

      const result = await repo.count('ch-1');

      expect(result).toBe(10);
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE channel_id = $1'),
        ['ch-1'],
      );
    });

    it('returns 0 when result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });

  // ---- countInbox ----

  describe('countInbox', () => {
    it('returns inbound message count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '15' });

      const result = await repo.countInbox();

      expect(result).toBe(15);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain("direction = 'inbound'");
    });

    it('returns 0 when result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countInbox();

      expect(result).toBe(0);
    });
  });

  // ---- deleteAll ----

  describe('deleteAll', () => {
    it('returns number of deleted messages', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 12 });

      const result = await repo.deleteAll();

      expect(result).toBe(12);
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM channel_messages');
      expect(sql).not.toContain('WHERE');
    });

    it('returns 0 when no messages exist', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteAll();

      expect(result).toBe(0);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses attachments JSON string', async () => {
      const attachments = [{ type: 'file', url: 'https://f.com/a.pdf' }];
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ attachments: JSON.stringify(attachments) }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toEqual(attachments);
    });

    it('handles already-parsed attachments object', async () => {
      const attachments = [{ type: 'image', url: 'https://img.png' }];
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ attachments }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toEqual(attachments);
    });

    it('sets attachments to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ attachments: null }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toBeUndefined();
    });

    it('parses metadata JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ metadata: '{"key":"value"}' }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.metadata).toEqual({ key: 'value' });
    });

    it('handles already-parsed metadata object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ metadata: { already: 'parsed' } }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.metadata).toEqual({ already: 'parsed' });
    });

    it('handles empty metadata string as empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ metadata: '' }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.metadata).toEqual({});
    });

    it('converts null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.getById('msg-1');

      expect(result!.externalId).toBeUndefined();
      expect(result!.senderId).toBeUndefined();
      expect(result!.senderName).toBeUndefined();
      expect(result!.replyToId).toBeUndefined();
    });

    it('maps non-null optional fields correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({
          external_id: 'ext-123',
          sender_id: 'user-1',
          sender_name: 'Alice',
          reply_to_id: 'msg-0',
        }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.externalId).toBe('ext-123');
      expect(result!.senderId).toBe('user-1');
      expect(result!.senderName).toBe('Alice');
      expect(result!.replyToId).toBe('msg-0');
    });

    it('maps direction correctly for both values', async () => {
      for (const direction of ['inbound', 'outbound'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(
          makeMessageRow({ direction }),
        );

        const result = await repo.getById('msg-1');

        expect(result!.direction).toBe(direction);
      }
    });

    it('creates a Date from created_at string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ created_at: '2024-01-15T10:30:00Z' }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  // ---- Factory ----

  describe('createChannelMessagesRepository', () => {
    it('returns a ChannelMessagesRepository instance', () => {
      const r = createChannelMessagesRepository();
      expect(r).toBeInstanceOf(ChannelMessagesRepository);
    });
  });
});

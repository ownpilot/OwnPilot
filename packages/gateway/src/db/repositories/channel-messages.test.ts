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
          null,
          '{}',
        ]
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
        })
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
          null,
          '{"source":"api"}',
        ]
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
        })
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
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [
        'msg-1',
      ]);
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

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['ch-1', 100, 0]);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByChannel('ch-1', 25, 50);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['ch-1', 25, 50]);
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
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ direction: 'inbound' })]);

      const result = await repo.getInbox();

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("direction = 'inbound'");
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('uses default limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getInbox();

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [100, 0]);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getInbox(10, 20);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [10, 20]);
    });
  });

  // ---- getOutbox ----

  describe('getOutbox', () => {
    it('returns outbound messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ direction: 'outbound' })]);

      const result = await repo.getOutbox();

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("direction = 'outbound'");
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getOutbox(5, 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [5, 10]);
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
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['ch-1', 10]);
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
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: 'Hello world' })]);

      const result = await repo.search('hello');

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ILIKE');
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('uses default limit of 50', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('test');

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['%test%', 50]);
    });

    it('applies custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('test', 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['%test%', 10]);
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
        ['msg-1']
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
    it('returns count and ids of deleted messages', async () => {
      const rows = [
        { id: 'msg-1' },
        { id: 'msg-2' },
        { id: 'msg-3' },
        { id: 'msg-4' },
        { id: 'msg-5' },
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.deleteByChannel('ch-1');

      expect(result).toEqual({ count: 5, ids: ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'] });
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_messages WHERE channel_id = $1'),
        ['ch-1']
      );
    });

    it('returns count 0 and empty ids when no messages to delete', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.deleteByChannel('ch-empty');

      expect(result).toEqual({ count: 0, ids: [] });
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
        ['ch-1']
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
        makeMessageRow({ attachments: JSON.stringify(attachments) })
      );

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toEqual(attachments);
    });

    it('handles already-parsed attachments object', async () => {
      const attachments = [{ type: 'image', url: 'https://img.png' }];
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ attachments }));

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toEqual(attachments);
    });

    it('sets attachments to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ attachments: null }));

      const result = await repo.getById('msg-1');

      expect(result!.attachments).toBeUndefined();
    });

    it('parses metadata JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ metadata: '{"key":"value"}' }));

      const result = await repo.getById('msg-1');

      expect(result!.metadata).toEqual({ key: 'value' });
    });

    it('handles already-parsed metadata object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ metadata: { already: 'parsed' } })
      );

      const result = await repo.getById('msg-1');

      expect(result!.metadata).toEqual({ already: 'parsed' });
    });

    it('handles empty metadata string as empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ metadata: '' }));

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
        })
      );

      const result = await repo.getById('msg-1');

      expect(result!.externalId).toBe('ext-123');
      expect(result!.senderId).toBe('user-1');
      expect(result!.senderName).toBe('Alice');
      expect(result!.replyToId).toBe('msg-0');
    });

    it('maps direction correctly for both values', async () => {
      for (const direction of ['inbound', 'outbound'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ direction }));

        const result = await repo.getById('msg-1');

        expect(result!.direction).toBe(direction);
      }
    });

    it('creates a Date from created_at string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ created_at: '2024-01-15T10:30:00Z' })
      );

      const result = await repo.getById('msg-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  // ---- getByConversation ----

  describe('getByConversation', () => {
    it('returns messages for a conversation ordered by created_at ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1', conversation_id: 'conv-1' }),
        makeMessageRow({ id: 'msg-2', conversation_id: 'conv-1' }),
      ]);

      const result = await repo.getByConversation('conv-1');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('WHERE conversation_id = $1');
      expect(sql).toContain('ORDER BY created_at ASC');
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['conv-1', 100, 0]);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByConversation('conv-1', 20, 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['conv-1', 20, 10]);
    });
  });

  // ---- getAll ----

  describe('getAll', () => {
    it('returns all messages when no channelId provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow(), makeMessageRow({ id: 'msg-2' })]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE channel_id');
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [100, 0]);
    });

    it('returns messages filtered by channelId when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);

      const result = await repo.getAll({ channelId: 'ch-1' });

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('WHERE channel_id = $1');
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['ch-1', 100, 0]);
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll({ limit: 25, offset: 50 });

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [25, 50]);
    });

    it('applies custom limit and offset with channelId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll({ channelId: 'ch-2', limit: 10, offset: 5 });

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['ch-2', 10, 5]);
    });
  });

  // ---- linkConversation ----

  describe('linkConversation', () => {
    it('updates conversation_id when null', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.linkConversation('msg-1', 'conv-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE channel_messages SET conversation_id = $1'),
        ['conv-1', 'msg-1']
      );
    });
  });

  // ---- countSince ----

  describe('countSince', () => {
    it('returns count of messages since a date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });
      const since = new Date('2024-01-01T00:00:00Z');

      const result = await repo.countSince('ch-1', since);

      expect(result).toBe(7);
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= $2'),
        ['ch-1', since.toISOString()]
      );
    });

    it('returns 0 when result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countSince('ch-1', new Date());

      expect(result).toBe(0);
    });
  });

  // ---- lastMessageAt ----

  describe('lastMessageAt', () => {
    it('returns a Date when a message exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ created_at: '2024-06-01T12:00:00Z' });

      const result = await repo.lastMessageAt('ch-1');

      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2024-06-01T12:00:00.000Z');
    });

    it('returns null when no messages exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.lastMessageAt('ch-empty');

      expect(result).toBeNull();
    });
  });

  // ---- getDistinctChats ----

  describe('getDistinctChats', () => {
    it('returns distinct chat list and total', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          chat_jid: '123@s.whatsapp.net',
          display_name: 'Alice',
          is_group: 'false',
          message_count: '5',
          last_message_at: '2024-06-01T12:00:00Z',
          total_count: '1',
        },
      ]);

      const result = await repo.getDistinctChats('channel.whatsapp', 20, 0);

      expect(result.total).toBe(1);
      expect(result.chats).toHaveLength(1);
      expect(result.chats[0]!.id).toBe('123@s.whatsapp.net');
      expect(result.chats[0]!.displayName).toBe('Alice');
      expect(result.chats[0]!.isGroup).toBe(false);
      expect(result.chats[0]!.messageCount).toBe(5);
      expect(result.chats[0]!.platform).toBe('whatsapp');
    });

    it('returns empty chats and total 0 when no results', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getDistinctChats('ch-1');

      expect(result.total).toBe(0);
      expect(result.chats).toHaveLength(0);
    });

    it('extracts platform from channelId with dot', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          chat_jid: '456@g.us',
          display_name: null,
          is_group: 'true',
          message_count: '10',
          last_message_at: '2024-06-02T00:00:00Z',
          total_count: '1',
        },
      ]);

      const result = await repo.getDistinctChats('plugin.telegram');

      expect(result.chats[0]!.platform).toBe('telegram');
      expect(result.chats[0]!.isGroup).toBe(true);
    });
  });

  // ---- getByChat ----

  describe('getByChat', () => {
    it('returns messages and total for a chat JID', async () => {
      const row = { ...makeMessageRow(), total_count: '3' };
      mockAdapter.query.mockResolvedValueOnce([row, row, row]);

      const result = await repo.getByChat('ch-1', '123@s.whatsapp.net', 50, 0);

      expect(result.total).toBe(3);
      expect(result.messages).toHaveLength(3);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("metadata->>'jid' = $2");
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [
        'ch-1',
        '123@s.whatsapp.net',
        50,
        0,
      ]);
    });

    it('returns empty messages and total 0 when no results', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByChat('ch-1', 'jid', 50, 0);

      expect(result.total).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });

  // ---- createBatch ----

  describe('createBatch', () => {
    it('returns 0 for empty batch', async () => {
      const result = await repo.createBatch([]);

      expect(result).toBe(0);
      expect(mockAdapter.transaction).not.toHaveBeenCalled();
    });

    it('inserts rows and counts successful insertions', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.createBatch([
        { id: 'msg-1', channelId: 'ch-1', direction: 'inbound', content: 'Hello' },
        { id: 'msg-2', channelId: 'ch-1', direction: 'outbound', content: 'World' },
      ]);

      expect(result).toBe(2);
      expect(mockAdapter.transaction).toHaveBeenCalled();
    });

    it('counts only rows where changes > 0 (deduplication)', async () => {
      // First row inserted, second skipped (ON CONFLICT DO NOTHING → changes: 0)
      mockAdapter.execute
        .mockResolvedValueOnce({ changes: 1 })
        .mockResolvedValueOnce({ changes: 0 });

      const result = await repo.createBatch([
        { id: 'msg-new', channelId: 'ch-1', direction: 'inbound', content: 'New' },
        { id: 'msg-dup', channelId: 'ch-1', direction: 'inbound', content: 'Dup' },
      ]);

      expect(result).toBe(1);
    });

    it('continues processing on row-level errors', async () => {
      mockAdapter.execute
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ changes: 1 });

      const result = await repo.createBatch([
        { id: 'msg-err', channelId: 'ch-1', direction: 'inbound', content: 'Fail' },
        { id: 'msg-ok', channelId: 'ch-1', direction: 'inbound', content: 'OK' },
      ]);

      expect(result).toBe(1);
    });

    it('passes correct INSERT SQL with ON CONFLICT DO NOTHING', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.createBatch([
        {
          id: 'msg-1',
          channelId: 'ch-1',
          direction: 'inbound',
          content: 'Test',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]);

      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
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

/**
 * ChannelSessionsRepository Tests
 *
 * Tests CRUD operations, findActive, findOrCreate, linkConversation,
 * touchLastMessage, deactivate, and row-to-entity mapping.
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

// Mock randomUUID to produce deterministic IDs
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('generated-uuid'),
  };
});

const { ChannelSessionsRepository, createChannelSessionsRepository } =
  await import('./channel-sessions.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    channel_user_id: 'cu-1',
    channel_plugin_id: 'cp-1',
    platform_chat_id: 'chat-1',
    conversation_id: null,
    is_active: true,
    context: '{}',
    created_at: '2024-06-01T12:00:00Z',
    last_message_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelSessionsRepository', () => {
  let repo: InstanceType<typeof ChannelSessionsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChannelSessionsRepository();
  });

  // ---- findActive ----

  describe('findActive', () => {
    it('returns an active session when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.findActive('cu-1', 'cp-1', 'chat-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('sess-1');
      expect(result!.channelUserId).toBe('cu-1');
      expect(result!.channelPluginId).toBe('cp-1');
      expect(result!.platformChatId).toBe('chat-1');
      expect(result!.isActive).toBe(true);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('channel_user_id = $1');
      expect(sql).toContain('channel_plugin_id = $2');
      expect(sql).toContain('platform_chat_id = $3');
      expect(sql).toContain('is_active = TRUE');
    });

    it('returns null when no active session exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.findActive('cu-1', 'cp-1', 'chat-1');

      expect(result).toBeNull();
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns a session when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.getById('sess-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('sess-1');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [
        'sess-1',
      ]);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });
  });

  // ---- findByConversation ----

  describe('findByConversation', () => {
    it('returns an active session by conversation ID', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ conversation_id: 'conv-1' }));

      const result = await repo.findByConversation('conv-1');

      expect(result).not.toBeNull();
      expect(result!.conversationId).toBe('conv-1');
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('conversation_id = $1');
      expect(sql).toContain('is_active = TRUE');
      expect(sql).toContain('ORDER BY last_message_at DESC');
    });

    it('returns null when no session for conversation', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.findByConversation('conv-missing');

      expect(result).toBeNull();
    });
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a session and returns the mapped entity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ id: 'generated-uuid' }));

      const result = await repo.create({
        channelUserId: 'cu-1',
        channelPluginId: 'cp-1',
        platformChatId: 'chat-1',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_sessions'),
        ['generated-uuid', 'cu-1', 'cp-1', 'chat-1', null, '{}']
      );
      expect(result.id).toBe('generated-uuid');
      expect(result.channelUserId).toBe('cu-1');
    });

    it('passes conversationId and context when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({
          id: 'generated-uuid',
          conversation_id: 'conv-1',
          context: '{"key":"value"}',
        })
      );

      const result = await repo.create({
        channelUserId: 'cu-1',
        channelPluginId: 'cp-1',
        platformChatId: 'chat-1',
        conversationId: 'conv-1',
        context: { key: 'value' },
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO channel_sessions'),
        ['generated-uuid', 'cu-1', 'cp-1', 'chat-1', 'conv-1', '{"key":"value"}']
      );
      expect(result.conversationId).toBe('conv-1');
      expect(result.context).toEqual({ key: 'value' });
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          channelUserId: 'cu-1',
          channelPluginId: 'cp-1',
          platformChatId: 'chat-1',
        })
      ).rejects.toThrow('Failed to create channel session');
    });
  });

  // ---- findOrCreate ----

  describe('findOrCreate', () => {
    it('returns existing session when found', async () => {
      // findActive returns a session
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow());

      const result = await repo.findOrCreate({
        channelUserId: 'cu-1',
        channelPluginId: 'cp-1',
        platformChatId: 'chat-1',
      });

      expect(result.id).toBe('sess-1');
      // execute should NOT be called (no insert)
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('creates a new session when none exists', async () => {
      // findActive returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // create: execute + getById
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ id: 'generated-uuid' }));

      const result = await repo.findOrCreate({
        channelUserId: 'cu-1',
        channelPluginId: 'cp-1',
        platformChatId: 'chat-1',
      });

      expect(result.id).toBe('generated-uuid');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });
  });

  // ---- linkConversation ----

  describe('linkConversation', () => {
    it('updates the conversation_id for a session', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.linkConversation('sess-1', 'conv-42');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET conversation_id = $1'),
        ['conv-42', 'sess-1']
      );
    });
  });

  // ---- touchLastMessage ----

  describe('touchLastMessage', () => {
    it('updates last_message_at to NOW()', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.touchLastMessage('sess-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET last_message_at = NOW()'),
        ['sess-1']
      );
    });
  });

  // ---- deactivate ----

  describe('deactivate', () => {
    it('sets is_active to FALSE', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deactivate('sess-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_active = FALSE'),
        ['sess-1']
      );
    });
  });

  // ---- listByUser ----

  describe('listByUser', () => {
    it('returns active sessions for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSessionRow({ id: 'sess-1' }),
        makeSessionRow({ id: 'sess-2' }),
      ]);

      const result = await repo.listByUser('cu-1');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('channel_user_id = $1');
      expect(sql).toContain('is_active = TRUE');
      expect(sql).toContain('ORDER BY last_message_at DESC');
      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['cu-1']);
    });

    it('returns empty array when no sessions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByUser('cu-empty');

      expect(result).toEqual([]);
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a session is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('sess-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM channel_sessions WHERE id = $1'),
        ['sess-1']
      );
    });

    it('returns false when session not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses context JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ context: '{"lang":"en","mode":"chat"}' })
      );

      const result = await repo.getById('sess-1');

      expect(result!.context).toEqual({ lang: 'en', mode: 'chat' });
    });

    it('handles already-parsed context object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({ context: { already: 'parsed' } })
      );

      const result = await repo.getById('sess-1');

      expect(result!.context).toEqual({ already: 'parsed' });
    });

    it('handles empty context string as empty object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ context: '' }));

      const result = await repo.getById('sess-1');

      expect(result!.context).toEqual({});
    });

    it('sets conversationId to null when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ conversation_id: null }));

      const result = await repo.getById('sess-1');

      expect(result!.conversationId).toBeNull();
    });

    it('maps conversationId when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ conversation_id: 'conv-123' }));

      const result = await repo.getById('sess-1');

      expect(result!.conversationId).toBe('conv-123');
    });

    it('creates Dates from string timestamps', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSessionRow({
          created_at: '2024-01-15T10:30:00Z',
          last_message_at: '2024-01-15T11:00:00Z',
        })
      );

      const result = await repo.getById('sess-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
      expect(result!.lastMessageAt).toBeInstanceOf(Date);
      expect(result!.lastMessageAt!.toISOString()).toBe('2024-01-15T11:00:00.000Z');
    });

    it('sets lastMessageAt to null when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ last_message_at: null }));

      const result = await repo.getById('sess-1');

      expect(result!.lastMessageAt).toBeNull();
    });

    it('maps isActive boolean correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSessionRow({ is_active: false }));

      const result = await repo.getById('sess-1');

      expect(result!.isActive).toBe(false);
    });
  });

  // ---- Factory ----

  describe('createChannelSessionsRepository', () => {
    it('returns a ChannelSessionsRepository instance', () => {
      const r = createChannelSessionsRepository();
      expect(r).toBeInstanceOf(ChannelSessionsRepository);
    });
  });
});

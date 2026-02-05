/**
 * MessagesRepository Tests
 *
 * Tests CRUD operations, conversation linking, tool call serialisation,
 * and row-to-entity mapping for the messages table.
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

const { MessagesRepository } = await import('./messages.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user',
    content: 'Hello world',
    tool_calls: null,
    tool_call_id: null,
    created_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

const sampleToolCalls = [
  { id: 'tc-1', name: 'search', arguments: '{"q":"test"}' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessagesRepository', () => {
  let repo: InstanceType<typeof MessagesRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MessagesRepository();
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a basic user message and returns the mapped entity', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.create({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hello world',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        ['msg-1', 'conv-1', 'user', 'Hello world', null, null],
      );

      expect(result.id).toBe('msg-1');
      expect(result.conversationId).toBe('conv-1');
      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello world');
      expect(result.toolCalls).toBeUndefined();
      expect(result.toolCallId).toBeUndefined();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('serialises toolCalls to JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({
          role: 'assistant',
          tool_calls: JSON.stringify(sampleToolCalls),
        }),
      );

      const result = await repo.create({
        id: 'msg-2',
        conversationId: 'conv-1',
        role: 'assistant',
        content: '',
        toolCalls: sampleToolCalls,
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        ['msg-2', 'conv-1', 'assistant', '', JSON.stringify(sampleToolCalls), null],
      );

      expect(result.toolCalls).toEqual(sampleToolCalls);
    });

    it('stores toolCallId for tool role messages', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({
          role: 'tool',
          content: '{"result": 42}',
          tool_call_id: 'tc-1',
        }),
      );

      const result = await repo.create({
        id: 'msg-3',
        conversationId: 'conv-1',
        role: 'tool',
        content: '{"result": 42}',
        toolCallId: 'tc-1',
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        ['msg-3', 'conv-1', 'tool', '{"result": 42}', null, 'tc-1'],
      );

      expect(result.toolCallId).toBe('tc-1');
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          id: 'msg-fail',
          conversationId: 'conv-1',
          role: 'user',
          content: 'test',
        }),
      ).rejects.toThrow('Failed to create message');
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

  // ---- getByConversation ----

  describe('getByConversation', () => {
    it('returns all messages for a conversation ordered by created_at ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1' }),
        makeMessageRow({ id: 'msg-2', content: 'Reply' }),
      ]);

      const result = await repo.getByConversation('conv-1');

      expect(result).toHaveLength(2);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at ASC'),
        ['conv-1'],
      );
    });

    it('applies limit when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);

      await repo.getByConversation('conv-1', 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['conv-1', 10],
      );
    });

    it('does not include LIMIT clause when no limit given', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByConversation('conv-1');

      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('LIMIT');
    });

    it('returns empty array when no messages found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByConversation('empty-conv');

      expect(result).toEqual([]);
    });
  });

  // ---- getRecent ----

  describe('getRecent', () => {
    it('returns recent messages in ascending order', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-older' }),
        makeMessageRow({ id: 'msg-newer' }),
      ]);

      const result = await repo.getRecent('conv-1', 5);

      expect(result).toHaveLength(2);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['conv-1', 5],
      );
      // The outer query orders ASC for chronological display
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY created_at ASC');
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a message is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('msg-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM messages WHERE id = $1'),
        ['msg-1'],
      );
    });

    it('returns false when message not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- deleteByConversation ----

  describe('deleteByConversation', () => {
    it('deletes all messages for a conversation and returns count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 15 });

      const result = await repo.deleteByConversation('conv-1');

      expect(result).toBe(15);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM messages WHERE conversation_id = $1'),
        ['conv-1'],
      );
    });

    it('returns 0 when conversation has no messages', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteByConversation('empty-conv');

      expect(result).toBe(0);
    });
  });

  // ---- count ----

  describe('count', () => {
    it('returns total message count when no conversationId given', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '100' });

      const result = await repo.count();

      expect(result).toBe(100);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).not.toContain('conversation_id');
    });

    it('returns count filtered by conversationId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      const result = await repo.count('conv-1');

      expect(result).toBe(5);
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE conversation_id = $1'),
        ['conv-1'],
      );
    });

    it('returns 0 when query result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses tool_calls JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ tool_calls: JSON.stringify(sampleToolCalls) }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.toolCalls).toEqual(sampleToolCalls);
    });

    it('handles already-parsed tool_calls object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ tool_calls: sampleToolCalls }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.toolCalls).toEqual(sampleToolCalls);
    });

    it('sets toolCalls to undefined for invalid JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ tool_calls: '{broken json' }),
      );

      const result = await repo.getById('msg-1');

      expect(result!.toolCalls).toBeUndefined();
    });

    it('maps all role types correctly', async () => {
      for (const role of ['system', 'user', 'assistant', 'tool'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow({ role }));

        const result = await repo.getById('msg-1');

        expect(result!.role).toBe(role);
      }
    });
  });
});

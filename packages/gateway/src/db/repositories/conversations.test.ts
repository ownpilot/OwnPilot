/**
 * ConversationsRepository Tests
 *
 * Tests CRUD operations, row-to-entity mapping, and edge cases
 * for the conversations table.
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

const { ConversationsRepository } = await import('./conversations.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    agent_name: 'assistant',
    system_prompt: 'You are helpful.',
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:30:00Z',
    metadata: '{"key":"value"}',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationsRepository', () => {
  let repo: InstanceType<typeof ConversationsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ConversationsRepository();
  });

  // ---- create ----

  describe('create', () => {
    it('inserts a row and returns the mapped conversation', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.create({
        id: 'conv-1',
        agentName: 'assistant',
        systemPrompt: 'You are helpful.',
        metadata: { key: 'value' },
      });

      // Verify INSERT was called with correct params
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversations'),
        ['conv-1', 'assistant', 'You are helpful.', '{"key":"value"}']
      );

      // Verify the returned entity is properly mapped
      expect(result.id).toBe('conv-1');
      expect(result.agentName).toBe('assistant');
      expect(result.systemPrompt).toBe('You are helpful.');
      expect(result.metadata).toEqual({ key: 'value' });
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('uses defaults for optional fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({ system_prompt: null, metadata: '{}' })
      );

      const result = await repo.create({
        id: 'conv-2',
        agentName: 'bot',
      });

      // systemPrompt should be undefined, metadata should be empty object
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO conversations'),
        ['conv-2', 'bot', null, '{}']
      );
      expect(result.systemPrompt).toBeUndefined();
      expect(result.metadata).toEqual({});
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ id: 'conv-3', agentName: 'bot' })).rejects.toThrow(
        'Failed to create conversation'
      );
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns a conversation when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.getById('conv-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-1');
      expect(result!.agentName).toBe('assistant');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [
        'conv-1',
      ]);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });

    it('handles null system_prompt as undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ system_prompt: null }));

      const result = await repo.getById('conv-1');

      expect(result!.systemPrompt).toBeUndefined();
    });

    it('handles non-string metadata gracefully', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({ metadata: { already: 'parsed' } })
      );

      const result = await repo.getById('conv-1');

      expect(result!.metadata).toEqual({ already: 'parsed' });
    });
  });

  // ---- getByAgent ----

  describe('getByAgent', () => {
    it('returns conversations filtered by agent name', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeConversationRow(),
        makeConversationRow({ id: 'conv-2' }),
      ]);

      const result = await repo.getByAgent('assistant');

      expect(result).toHaveLength(2);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE agent_name = $1'),
        ['assistant', 50]
      );
    });

    it('respects custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeConversationRow()]);

      await repo.getByAgent('assistant', 10);

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), [
        'assistant',
        10,
      ]);
    });

    it('returns empty array when no conversations found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByAgent('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ---- getAll ----

  describe('getAll', () => {
    it('returns paginated conversations with defaults', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeConversationRow()]);

      const result = await repo.getAll();

      expect(result).toHaveLength(1);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [100, 0]
      );
    });

    it('passes custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll(25, 50);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [25, 50]
      );
    });
  });

  // ---- updateTimestamp ----

  describe('updateTimestamp', () => {
    it('updates the updated_at field', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateTimestamp('conv-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversations SET updated_at'),
        ['conv-1']
      );
    });
  });

  // ---- updateSystemPrompt ----

  describe('updateSystemPrompt', () => {
    it('updates system_prompt and timestamp', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateSystemPrompt('conv-1', 'New prompt');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET system_prompt = $1'),
        ['New prompt', 'conv-1']
      );
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a row is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('conv-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM conversations WHERE id = $1'),
        ['conv-1']
      );
    });

    it('returns false when no row matches', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ---- count ----

  describe('count', () => {
    it('returns total number of conversations', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      const result = await repo.count();

      expect(result).toBe(42);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('conversations');
    });

    it('returns 0 when query result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses ISO date strings into Date objects', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({
          created_at: '2024-01-15T08:30:00.000Z',
          updated_at: '2024-02-20T16:45:00.000Z',
        })
      );

      const result = await repo.getById('conv-1');

      expect(result!.createdAt.toISOString()).toBe('2024-01-15T08:30:00.000Z');
      expect(result!.updatedAt.toISOString()).toBe('2024-02-20T16:45:00.000Z');
    });

    it('handles empty metadata string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ metadata: '' }));

      const result = await repo.getById('conv-1');

      expect(result!.metadata).toEqual({});
    });
  });
});

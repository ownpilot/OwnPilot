/**
 * Chat Repository Tests
 *
 * Unit tests for ChatRepository: conversations CRUD, messages CRUD,
 * filtering, pagination, JSON serialization, and utility methods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { ChatRepository } from './chat.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeConversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    user_id: 'user-1',
    title: 'Test Conversation',
    agent_id: null,
    agent_name: null,
    provider: null,
    model: null,
    system_prompt: null,
    message_count: 0,
    is_archived: false,
    created_at: NOW,
    updated_at: NOW,
    metadata: '{}',
    ...overrides,
  };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user',
    content: 'Hello world',
    provider: null,
    model: null,
    tool_calls: null,
    tool_call_id: null,
    trace: null,
    is_error: false,
    input_tokens: null,
    output_tokens: null,
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatRepository', () => {
  let repo: ChatRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChatRepository('user-1');
  });

  // =========================================================================
  // createConversation
  // =========================================================================

  describe('createConversation', () => {
    it('should insert a conversation and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.createConversation({ title: 'Test Conversation' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.title).toBe('Test Conversation');
      expect(result.userId).toBe('user-1');
      expect(result.messageCount).toBe(0);
      expect(result.isArchived).toBe(false);
    });

    it('should pass optional fields correctly', async () => {
      const row = makeConversationRow({
        agent_id: 'agent-1',
        agent_name: 'My Agent',
        provider: 'openai',
        model: 'gpt-4',
        system_prompt: 'You are helpful',
        metadata: '{"key":"value"}',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.createConversation({
        title: 'Test',
        agentId: 'agent-1',
        agentName: 'My Agent',
        provider: 'openai',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
        metadata: { key: 'value' },
      });

      expect(result.agentId).toBe('agent-1');
      expect(result.agentName).toBe('My Agent');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.systemPrompt).toBe('You are helpful');
      expect(result.metadata).toEqual({ key: 'value' });
    });

    it('should serialize metadata as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ metadata: '{"foo":"bar"}' }));

      await repo.createConversation({ title: 'Test', metadata: { foo: 'bar' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe('{"foo":"bar"}');
    });

    it('should default metadata to empty object when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      await repo.createConversation({ title: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe('{}');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.createConversation({ title: 'Test' }))
        .rejects.toThrow('Failed to create conversation');
    });

    it('should set null for undefined optional fields', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      await repo.createConversation({});

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // title, agentId, agentName, provider, model, systemPrompt should be null
      expect(params[2]).toBeNull();
      expect(params[3]).toBeNull();
      expect(params[4]).toBeNull();
      expect(params[5]).toBeNull();
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });

  // =========================================================================
  // getConversation
  // =========================================================================

  describe('getConversation', () => {
    it('should return a conversation when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.getConversation('conv-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getConversation('missing')).toBeNull();
    });

    it('should parse dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.getConversation('conv-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should parse metadata JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({ metadata: '{"theme":"dark"}' }),
      );

      const result = await repo.getConversation('conv-1');

      expect(result!.metadata).toEqual({ theme: 'dark' });
    });

    it('should handle empty metadata string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({ metadata: '' }),
      );

      const result = await repo.getConversation('conv-1');

      expect(result!.metadata).toEqual({});
    });

    it('should scope query to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getConversation('conv-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['conv-1', 'user-1']);
    });
  });

  // =========================================================================
  // listConversations
  // =========================================================================

  describe('listConversations', () => {
    it('should return empty array when no conversations', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.listConversations()).toEqual([]);
    });

    it('should return mapped conversations', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeConversationRow({ id: 'conv-1' }),
        makeConversationRow({ id: 'conv-2', title: 'Second' }),
      ]);

      const result = await repo.listConversations();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('conv-1');
      expect(result[1]!.id).toBe('conv-2');
    });

    it('should filter by agentId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ agentId: 'agent-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('agent_id = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('agent-1');
    });

    it('should filter by isArchived', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ isArchived: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(true);
    });

    it('should search by title and agent_name', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ search: 'hello' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('title ILIKE');
      expect(sql).toContain('agent_name ILIKE');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ search: '50%_off' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%50\\%\\_off%');
    });

    it('should apply pagination with LIMIT and OFFSET', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should use default limit=50 and offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(50);
      expect(params).toContain(0);
    });

    it('should order by updated_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY updated_at DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listConversations({ agentId: 'agent-1', isArchived: false, search: 'test' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('agent_id = $2');
      expect(sql).toContain('is_archived = $3');
      expect(sql).toContain('ILIKE');
    });
  });

  // =========================================================================
  // updateConversation
  // =========================================================================

  describe('updateConversation', () => {
    it('should update fields and return the updated conversation', async () => {
      // updateConversation builds sets then calls execute, then getConversation (queryOne)
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: 'Updated' }));

      const result = await repo.updateConversation('conv-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return the conversation when no real updates', async () => {
      // When sets.length === 1 (only 'updated_at = NOW()'), it skips execute and returns getConversation
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.updateConversation('conv-1', {});

      expect(result!.id).toBe('conv-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update title', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: 'New Title' }));

      await repo.updateConversation('conv-1', { title: 'New Title' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('title = $1');
    });

    it('should update isArchived', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ is_archived: true }));

      const result = await repo.updateConversation('conv-1', { isArchived: true });

      expect(result!.isArchived).toBe(true);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('is_archived = $');
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeConversationRow({ title: 'X', provider: 'anthropic', model: 'claude-3' }),
      );

      const result = await repo.updateConversation('conv-1', {
        title: 'X',
        provider: 'anthropic',
        model: 'claude-3',
      });

      expect(result!.title).toBe('X');
      expect(result!.provider).toBe('anthropic');
      expect(result!.model).toBe('claude-3');
    });

    it('should return null when conversation does not exist', async () => {
      // updateConversation calls execute, then getConversation which returns null (default)
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateConversation('missing', { title: 'X' });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // deleteConversation
  // =========================================================================

  describe('deleteConversation', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.deleteConversation('conv-1')).toBe(true);
    });

    it('should return false when conversation not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.deleteConversation('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deleteConversation('conv-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['conv-1', 'user-1']);
    });
  });

  // =========================================================================
  // generateTitle
  // =========================================================================

  describe('generateTitle', () => {
    it('should generate title from first message content (short)', async () => {
      // getMessages returns one message
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: 'Short message' })]);
      // updateConversation: execute + getConversation
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: 'Short message' }));

      const title = await repo.generateTitle('conv-1');

      expect(title).toBe('Short message');
    });

    it('should truncate long content to 50 chars with ellipsis', async () => {
      const longContent = 'A'.repeat(60);
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: longContent })]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: longContent.slice(0, 50) + '...' }));

      const title = await repo.generateTitle('conv-1');

      expect(title).toBe('A'.repeat(50) + '...');
    });

    it('should return null when no messages exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const title = await repo.generateTitle('conv-1');

      expect(title).toBeNull();
    });

    it('should not add ellipsis for exactly 50 char content', async () => {
      const content50 = 'B'.repeat(50);
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: content50 })]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: content50 }));

      const title = await repo.generateTitle('conv-1');

      expect(title).toBe(content50);
      expect(title!.length).toBe(50);
    });
  });

  // =========================================================================
  // addMessage
  // =========================================================================

  describe('addMessage', () => {
    it('should insert a message and update conversation count', async () => {
      // INSERT message
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // UPDATE conversation message_count
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getMessage
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.addMessage({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hello world',
      });

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Hello world');
      expect(result.role).toBe('user');
      expect(result.conversationId).toBe('conv-1');
    });

    it('should serialize toolCalls as JSON', async () => {
      const toolCalls = [{ id: 'tc-1', type: 'function', function: { name: 'test', arguments: '{}' } }];
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ tool_calls: JSON.stringify(toolCalls) }),
      );

      await repo.addMessage({
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'response',
        toolCalls,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe(JSON.stringify(toolCalls));
    });

    it('should serialize trace as JSON', async () => {
      const trace = { step: 1, action: 'search' };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ trace: JSON.stringify(trace) }),
      );

      await repo.addMessage({
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'result',
        trace,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe(JSON.stringify(trace));
    });

    it('should set null for optional fields when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      await repo.addMessage({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hello',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBeNull(); // provider
      expect(params[5]).toBeNull(); // model
      expect(params[6]).toBeNull(); // toolCalls
      expect(params[7]).toBeNull(); // toolCallId
      expect(params[8]).toBeNull(); // trace
      expect(params[9]).toBe(false); // isError
      expect(params[10]).toBeNull(); // inputTokens
      expect(params[11]).toBeNull(); // outputTokens
    });

    it('should update conversation message_count', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      await repo.addMessage({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hello',
      });

      const secondExecuteSql = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(secondExecuteSql).toContain('message_count = message_count + 1');
      expect(secondExecuteSql).toContain('updated_at = NOW()');
    });

    it('should throw when getMessage returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.addMessage({ conversationId: 'conv-1', role: 'user', content: 'Hello' }),
      ).rejects.toThrow('Failed to create message');
    });

    it('should pass token counts when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ input_tokens: 50, output_tokens: 100 }),
      );

      await repo.addMessage({
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Response',
        inputTokens: 50,
        outputTokens: 100,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[10]).toBe(50);
      expect(params[11]).toBe(100);
    });
  });

  // =========================================================================
  // getMessage
  // =========================================================================

  describe('getMessage', () => {
    it('should return a message when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.getMessage('msg-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('msg-1');
      expect(result!.role).toBe('user');
      expect(result!.content).toBe('Hello world');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getMessage('missing')).toBeNull();
    });

    it('should parse createdAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.getMessage('msg-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should parse toolCalls JSON', async () => {
      const toolCalls = [{ id: 'tc-1', type: 'function' }];
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ tool_calls: JSON.stringify(toolCalls) }),
      );

      const result = await repo.getMessage('msg-1');

      expect(result!.toolCalls).toEqual(toolCalls);
    });

    it('should parse trace JSON', async () => {
      const trace = { step: 1 };
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeMessageRow({ trace: JSON.stringify(trace) }),
      );

      const result = await repo.getMessage('msg-1');

      expect(result!.trace).toEqual(trace);
    });

    it('should return null for toolCalls and trace when null in row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());

      const result = await repo.getMessage('msg-1');

      expect(result!.toolCalls).toBeNull();
      expect(result!.trace).toBeNull();
    });
  });

  // =========================================================================
  // getMessages
  // =========================================================================

  describe('getMessages', () => {
    it('should return messages for a conversation', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1' }),
        makeMessageRow({ id: 'msg-2', content: 'Hi' }),
      ]);

      const result = await repo.getMessages('conv-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('msg-1');
      expect(result[1]!.id).toBe('msg-2');
    });

    it('should return empty array when no messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getMessages('conv-1')).toEqual([]);
    });

    it('should apply beforeId filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getMessages('conv-1', { beforeId: 'msg-5' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('created_at < (SELECT created_at FROM messages WHERE id = $2)');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('msg-5');
    });

    it('should apply pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getMessages('conv-1', { limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should default to limit=100, offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getMessages('conv-1');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(100);
      expect(params).toContain(0);
    });

    it('should order by created_at ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getMessages('conv-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at ASC');
    });
  });

  // =========================================================================
  // deleteMessage
  // =========================================================================

  describe('deleteMessage', () => {
    it('should delete a message and decrement conversation count', async () => {
      // getMessage (to get conversationId)
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());
      // DELETE message
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // UPDATE conversation count
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteMessage('msg-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
      const updateSql = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(updateSql).toContain('message_count = message_count - 1');
    });

    it('should return false when message does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.deleteMessage('missing');

      expect(result).toBe(false);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should not update conversation count when delete changes=0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeMessageRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteMessage('msg-1');

      expect(result).toBe(false);
      // Only one execute call (the DELETE), no UPDATE call
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // getOrCreateConversation
  // =========================================================================

  describe('getOrCreateConversation', () => {
    it('should return existing conversation when id is provided and found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());

      const result = await repo.getOrCreateConversation('conv-1', { title: 'New' });

      expect(result.id).toBe('conv-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should create new conversation when id is null', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: 'New' }));

      const result = await repo.getOrCreateConversation(null, { title: 'New' });

      expect(result.title).toBe('New');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should create new conversation when id is provided but not found', async () => {
      // getConversation returns null
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      // createConversation: execute + getConversation
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow({ title: 'Fallback' }));

      const result = await repo.getOrCreateConversation('nonexistent', { title: 'Fallback' });

      expect(result.title).toBe('Fallback');
    });
  });

  // =========================================================================
  // getConversationWithMessages
  // =========================================================================

  describe('getConversationWithMessages', () => {
    it('should return conversation and messages', async () => {
      // getConversation
      mockAdapter.queryOne.mockResolvedValueOnce(makeConversationRow());
      // getMessages
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ id: 'msg-1' }),
        makeMessageRow({ id: 'msg-2' }),
      ]);

      const result = await repo.getConversationWithMessages('conv-1');

      expect(result).not.toBeNull();
      expect(result!.conversation.id).toBe('conv-1');
      expect(result!.messages).toHaveLength(2);
    });

    it('should return null when conversation not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getConversationWithMessages('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getRecentConversations
  // =========================================================================

  describe('getRecentConversations', () => {
    it('should return conversations with last message preview', async () => {
      // listConversations
      mockAdapter.query.mockResolvedValueOnce([makeConversationRow()]);
      // getMessages for the conversation (limit: 1)
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: 'Hello world' })]);

      const result = await repo.getRecentConversations(20);

      expect(result).toHaveLength(1);
      expect(result[0]!.lastMessage).toBe('Hello world');
      expect(result[0]!.lastMessageAt).toBeInstanceOf(Date);
    });

    it('should handle conversations with no messages', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeConversationRow()]);
      mockAdapter.query.mockResolvedValueOnce([]); // No messages

      const result = await repo.getRecentConversations();

      expect(result).toHaveLength(1);
      expect(result[0]!.lastMessage).toBeUndefined();
      expect(result[0]!.lastMessageAt).toBeUndefined();
    });

    it('should truncate last message to 100 chars', async () => {
      const longContent = 'X'.repeat(200);
      mockAdapter.query.mockResolvedValueOnce([makeConversationRow()]);
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ content: longContent })]);

      const result = await repo.getRecentConversations();

      expect(result[0]!.lastMessage).toBe('X'.repeat(100));
    });

    it('should return empty array when no conversations', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getRecentConversations();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createChatRepository', () => {
    it('should be importable and return ChatRepository instance', async () => {
      const { createChatRepository } = await import('./chat.js');
      const r = createChatRepository('u1');
      expect(r).toBeInstanceOf(ChatRepository);
    });

    it('should default to "default" userId', async () => {
      const { createChatRepository } = await import('./chat.js');
      const r = createChatRepository();
      expect(r).toBeInstanceOf(ChatRepository);
    });
  });
});

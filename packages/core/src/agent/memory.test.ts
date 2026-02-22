import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationMemory, createMemory } from './memory.js';

describe('ConversationMemory', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
  });

  describe('create', () => {
    it('creates a new conversation', () => {
      const conversation = memory.create('You are a helpful assistant.');

      expect(conversation.id).toBeDefined();
      expect(conversation.systemPrompt).toBe('You are a helpful assistant.');
      expect(conversation.messages).toHaveLength(0);
      expect(conversation.createdAt).toBeInstanceOf(Date);
      expect(conversation.updatedAt).toBeInstanceOf(Date);
    });

    it('creates conversation without system prompt', () => {
      const conversation = memory.create();

      expect(conversation.systemPrompt).toBeUndefined();
      expect(conversation.messages).toHaveLength(0);
    });

    it('creates conversation with metadata', () => {
      const conversation = memory.create('System', { userId: 'user-1' });

      expect(conversation.metadata).toEqual({ userId: 'user-1' });
    });
  });

  describe('get', () => {
    it('retrieves existing conversation', () => {
      const created = memory.create('System prompt');
      const retrieved = memory.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('returns undefined for non-existent conversation', () => {
      const retrieved = memory.get('nonexistent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for existing conversation', () => {
      const conversation = memory.create();
      expect(memory.has(conversation.id)).toBe(true);
    });

    it('returns false for non-existent conversation', () => {
      expect(memory.has('nonexistent')).toBe(false);
    });
  });

  describe('getAllIds', () => {
    it('lists all conversation IDs', () => {
      memory.create('Prompt 1');
      memory.create('Prompt 2');
      memory.create('Prompt 3');

      const ids = memory.getAllIds();
      expect(ids).toHaveLength(3);
    });

    it('returns empty array when no conversations', () => {
      const ids = memory.getAllIds();
      expect(ids).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('deletes existing conversation', () => {
      const conversation = memory.create('Test');
      const deleted = memory.delete(conversation.id);

      expect(deleted).toBe(true);
      expect(memory.get(conversation.id)).toBeUndefined();
    });

    it('returns false for non-existent conversation', () => {
      const deleted = memory.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('message management', () => {
    it('adds user message', () => {
      const conversation = memory.create();
      memory.addUserMessage(conversation.id, 'Hello!');

      const updated = memory.get(conversation.id);
      expect(updated?.messages).toHaveLength(1);
      expect(updated?.messages[0].role).toBe('user');
      expect(updated?.messages[0].content).toBe('Hello!');
    });

    it('adds assistant message', () => {
      const conversation = memory.create();
      memory.addAssistantMessage(conversation.id, 'Hi there!');

      const updated = memory.get(conversation.id);
      expect(updated?.messages).toHaveLength(1);
      expect(updated?.messages[0].role).toBe('assistant');
      expect(updated?.messages[0].content).toBe('Hi there!');
    });

    it('adds assistant message with tool calls', () => {
      const conversation = memory.create();
      memory.addAssistantMessage(conversation.id, '', [
        { id: 'call1', name: 'get_time', arguments: '{}' },
      ]);

      const updated = memory.get(conversation.id);
      expect(updated?.messages[0].toolCalls).toHaveLength(1);
      expect(updated?.messages[0].toolCalls?.[0].name).toBe('get_time');
    });

    it('adds tool results', () => {
      const conversation = memory.create();
      memory.addToolResults(conversation.id, [
        { toolCallId: 'call1', content: '{"time": "12:00"}' },
        { toolCallId: 'call2', content: '{"data": "test"}' },
      ]);

      const updated = memory.get(conversation.id);
      expect(updated?.messages).toHaveLength(1);
      expect(updated?.messages[0].role).toBe('tool');
      expect(updated?.messages[0].toolResults).toHaveLength(2);
    });

    it('updates system prompt', () => {
      const conversation = memory.create('Original prompt');
      memory.updateSystemPrompt(conversation.id, 'New prompt');

      const updated = memory.get(conversation.id);
      expect(updated?.systemPrompt).toBe('New prompt');
    });

    it('adds system prompt if none exists', () => {
      const conversation = memory.create();
      memory.updateSystemPrompt(conversation.id, 'New prompt');

      const updated = memory.get(conversation.id);
      expect(updated?.systemPrompt).toBe('New prompt');
    });
  });

  describe('getContextMessages', () => {
    it('returns messages for conversation', () => {
      const conversation = memory.create();
      memory.addUserMessage(conversation.id, 'User message');
      memory.addAssistantMessage(conversation.id, 'Assistant message');

      const messages = memory.getContextMessages(conversation.id);
      expect(messages).toHaveLength(2);
    });

    it('returns empty array for non-existent conversation', () => {
      const messages = memory.getContextMessages('nonexistent');
      expect(messages).toHaveLength(0);
    });

    it('truncates tool results in messages older than the last 4', () => {
      const conversation = memory.create();
      const longContent = 'x'.repeat(3000); // exceeds 2000 char limit

      // Add 5 messages so the first one is outside the 4-message safe zone
      memory.addUserMessage(conversation.id, 'msg 1');
      memory.addToolResults(conversation.id, [{ toolCallId: 'tc1', content: longContent }]);
      memory.addUserMessage(conversation.id, 'msg 2');
      memory.addUserMessage(conversation.id, 'msg 3');
      memory.addUserMessage(conversation.id, 'msg 4');
      memory.addUserMessage(conversation.id, 'msg 5');

      const messages = memory.getContextMessages(conversation.id);
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.toolResults![0]!.content).toContain('[...truncated]');
      expect(toolMsg!.toolResults![0]!.content.length).toBeLessThan(longContent.length);
    });

    it('does NOT truncate tool results in the last 4 messages', () => {
      const conversation = memory.create();
      const longContent = 'y'.repeat(3000);

      // Add exactly 4 messages — all within safe zone
      memory.addUserMessage(conversation.id, 'msg 1');
      memory.addToolResults(conversation.id, [{ toolCallId: 'tc1', content: longContent }]);
      memory.addUserMessage(conversation.id, 'msg 2');
      memory.addUserMessage(conversation.id, 'msg 3');

      const messages = memory.getContextMessages(conversation.id);
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.toolResults![0]!.content).toBe(longContent); // intact
    });

    it('does NOT truncate tool results within 2000 chars', () => {
      const conversation = memory.create();
      const shortContent = 'z'.repeat(100);

      // Add 6 messages so first tool result is outside safe zone
      for (let i = 0; i < 4; i++) memory.addUserMessage(conversation.id, `msg ${i}`);
      memory.addToolResults(conversation.id, [{ toolCallId: 'tc1', content: shortContent }]);
      memory.addUserMessage(conversation.id, 'msg 5');
      memory.addUserMessage(conversation.id, 'msg 6');

      const messages = memory.getContextMessages(conversation.id);
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg!.toolResults![0]!.content).toBe(shortContent); // not truncated
    });
  });

  describe('getFullContext', () => {
    it('includes system message first', () => {
      const conversation = memory.create('System prompt');
      memory.addUserMessage(conversation.id, 'Hello');
      memory.addAssistantMessage(conversation.id, 'Hi there');

      const context = memory.getFullContext(conversation.id);
      expect(context.length).toBe(3);
      expect(context[0].role).toBe('system');
      expect(context[0].content).toBe('System prompt');
    });

    it('returns only messages when no system prompt', () => {
      const conversation = memory.create();
      memory.addUserMessage(conversation.id, 'Hello');

      const context = memory.getFullContext(conversation.id);
      expect(context.length).toBe(1);
      expect(context[0].role).toBe('user');
    });
  });

  describe('fork', () => {
    it('creates a copy of conversation', () => {
      const original = memory.create('System');
      memory.addUserMessage(original.id, 'Hello');
      memory.addAssistantMessage(original.id, 'Hi');

      const forked = memory.fork(original.id);

      expect(forked).toBeDefined();
      expect(forked?.id).not.toBe(original.id);
      expect(forked?.messages).toHaveLength(2);
      expect(forked?.messages[0].content).toBe('Hello');
      expect(forked?.metadata?.forkedFrom).toBe(original.id);
    });

    it('forked conversation is independent', () => {
      const original = memory.create('System');
      memory.addUserMessage(original.id, 'Hello');

      const forked = memory.fork(original.id);
      memory.addUserMessage(forked!.id, 'New message');

      const originalConv = memory.get(original.id);
      const forkedConv = memory.get(forked!.id);

      expect(originalConv?.messages).toHaveLength(1);
      expect(forkedConv?.messages).toHaveLength(2);
    });

    it('returns undefined for non-existent conversation', () => {
      const forked = memory.fork('nonexistent');
      expect(forked).toBeUndefined();
    });
  });

  describe('clearMessages', () => {
    it('clears all messages', () => {
      const conversation = memory.create('System prompt');
      memory.addUserMessage(conversation.id, 'Hello');
      memory.addAssistantMessage(conversation.id, 'Hi');

      memory.clearMessages(conversation.id);

      const updated = memory.get(conversation.id);
      expect(updated?.messages).toHaveLength(0);
      expect(updated?.systemPrompt).toBe('System prompt'); // System prompt preserved
    });

    it('returns false for non-existent conversation', () => {
      const result = memory.clearMessages('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('updateMetadata', () => {
    it('updates metadata', () => {
      const conversation = memory.create('System', { key1: 'value1' });
      memory.updateMetadata(conversation.id, { key2: 'value2' });

      const updated = memory.get(conversation.id);
      expect(updated?.metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('getStats', () => {
    it('returns conversation statistics', () => {
      const conversation = memory.create('System');
      memory.addUserMessage(conversation.id, 'Hello world');
      memory.addAssistantMessage(conversation.id, 'Hi there');

      const stats = memory.getStats(conversation.id);
      expect(stats).toBeDefined();
      expect(stats?.messageCount).toBe(2);
      expect(stats?.estimatedTokens).toBeGreaterThan(0);
    });

    it('returns undefined for non-existent conversation', () => {
      const stats = memory.getStats('nonexistent');
      expect(stats).toBeUndefined();
    });
  });

  describe('export/import', () => {
    it('exports conversation to JSON', () => {
      const conversation = memory.create('System');
      memory.addUserMessage(conversation.id, 'Hello');

      const json = memory.export(conversation.id);
      expect(json).toBeDefined();

      const parsed = JSON.parse(json!);
      expect(parsed.id).toBe(conversation.id);
      expect(parsed.systemPrompt).toBe('System');
    });

    it('imports conversation from JSON', () => {
      const conversation = memory.create('System');
      memory.addUserMessage(conversation.id, 'Hello');

      const json = memory.export(conversation.id);
      memory.delete(conversation.id);

      const imported = memory.import(json!);
      expect(imported).toBeDefined();
      expect(imported?.id).toBe(conversation.id);
    });

    it('returns undefined for invalid JSON', () => {
      const imported = memory.import('invalid json');
      expect(imported).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('clears all conversations', () => {
      memory.create('Test 1');
      memory.create('Test 2');

      memory.clear();

      expect(memory.getCount()).toBe(0);
    });
  });
});

describe('createMemory', () => {
  it('creates memory with default config', () => {
    const memory = createMemory();
    expect(memory).toBeInstanceOf(ConversationMemory);
  });

  it('creates memory with custom config', () => {
    const memory = createMemory({ maxTokens: 1000, maxMessages: 50 });
    expect(memory).toBeInstanceOf(ConversationMemory);
  });
});

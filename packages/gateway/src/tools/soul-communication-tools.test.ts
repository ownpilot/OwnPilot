/**
 * Soul Communication Tools Tests
 *
 * Unit tests for executeSoulCommunicationTool — send_agent_message,
 * read_agent_inbox, reply_to_agent, unknown tool, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mock agent-messages repository
// ---------------------------------------------------------------------------

const mockRepo = {
  create: vi.fn().mockResolvedValue(undefined),
  findForAgent: vi.fn().mockResolvedValue([]),
  findByThread: vi.fn().mockResolvedValue([]),
  markAsRead: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: vi.fn(() => mockRepo),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('generated-id'),
  };
});

const { executeSoulCommunicationTool } = await import('./soul-communication-tools.js');

// ---------------------------------------------------------------------------
// Helper — build a minimal AgentMessage
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    from: 'agent-a',
    to: 'agent-b',
    type: 'coordination',
    subject: 'Hello',
    content: 'Hi there',
    attachments: [],
    priority: 'normal',
    threadId: 'thread-1',
    requiresResponse: false,
    status: 'sent',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeSoulCommunicationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.create.mockResolvedValue(undefined);
    mockRepo.findForAgent.mockResolvedValue([]);
    mockRepo.findByThread.mockResolvedValue([]);
    mockRepo.markAsRead.mockResolvedValue(undefined);
  });

  // =========================================================================
  // send_agent_message
  // =========================================================================

  describe('send_agent_message', () => {
    it('returns error when to_agent is missing', async () => {
      const result = await executeSoulCommunicationTool(
        'send_agent_message',
        { content: 'hello' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('to_agent and content are required');
    });

    it('returns error when content is missing', async () => {
      const result = await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('to_agent and content are required');
    });

    it('returns error when both to_agent and content are missing', async () => {
      const result = await executeSoulCommunicationTool('send_agent_message', {}, 'agent-a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('to_agent and content are required');
    });

    it('creates message in repo with correct fields', async () => {
      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('msg-abc').mockReturnValueOnce('thread-xyz');

      const result = await executeSoulCommunicationTool(
        'send_agent_message',
        {
          to_agent: 'agent-b',
          content: 'Hello agent-b',
          type: 'task',
          subject: 'Work request',
          priority: 'high',
          requires_response: true,
        },
        'agent-a'
      );

      expect(result.success).toBe(true);
      expect(mockRepo.create).toHaveBeenCalledOnce();

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.id).toBe('msg-abc');
      expect(created.from).toBe('agent-a');
      expect(created.to).toBe('agent-b');
      expect(created.type).toBe('task');
      expect(created.subject).toBe('Work request');
      expect(created.content).toBe('Hello agent-b');
      expect(created.priority).toBe('high');
      expect(created.threadId).toBe('thread-xyz');
      expect(created.requiresResponse).toBe(true);
      expect(created.status).toBe('sent');
    });

    it('returns { messageId, threadId, to, status: sent }', async () => {
      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('msg-abc').mockReturnValueOnce('thread-xyz');

      const result = await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b', content: 'Hello' },
        'agent-a'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        messageId: 'msg-abc',
        threadId: 'thread-xyz',
        to: 'agent-b',
        status: 'sent',
      });
    });

    it('uses generateId for both msgId and threadId', async () => {
      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('msg-111').mockReturnValueOnce('thread-222');

      await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b', content: 'Hello' },
        'agent-a'
      );

      expect(generateId).toHaveBeenCalledWith('msg');
      expect(generateId).toHaveBeenCalledWith('thread');

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.id).toBe('msg-111');
      expect(created.threadId).toBe('thread-222');
    });

    it('defaults type to coordination when not provided', async () => {
      await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b', content: 'Hello' },
        'agent-a'
      );

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.type).toBe('coordination');
    });

    it('defaults priority to normal when not provided', async () => {
      await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b', content: 'Hello' },
        'agent-a'
      );

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.priority).toBe('normal');
    });

    it('uses unknown as agentId when userId is not provided', async () => {
      await executeSoulCommunicationTool('send_agent_message', {
        to_agent: 'agent-b',
        content: 'Hello',
      });

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.from).toBe('unknown');
    });
  });

  // =========================================================================
  // read_agent_inbox
  // =========================================================================

  describe('read_agent_inbox', () => {
    it('calls findForAgent with unreadOnly: true and limit: 20 by default', async () => {
      await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(mockRepo.findForAgent).toHaveBeenCalledOnce();
      expect(mockRepo.findForAgent).toHaveBeenCalledWith('agent-a', {
        unreadOnly: true,
        fromAgent: undefined,
        limit: 20,
      });
    });

    it('marks messages as read', async () => {
      const messages = [makeMessage({ id: 'msg-1' }), makeMessage({ id: 'msg-2' })];
      mockRepo.findForAgent.mockResolvedValueOnce(messages);

      await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(mockRepo.markAsRead).toHaveBeenCalledOnce();
      expect(mockRepo.markAsRead).toHaveBeenCalledWith(['msg-1', 'msg-2']);
    });

    it('does not call markAsRead when inbox is empty', async () => {
      mockRepo.findForAgent.mockResolvedValueOnce([]);

      await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(mockRepo.markAsRead).not.toHaveBeenCalled();
    });

    it('returns { count, messages } with mapped fields', async () => {
      const createdAt = new Date('2024-06-01T12:00:00Z');
      const messages = [makeMessage({ id: 'msg-1', from: 'agent-b', createdAt })];
      mockRepo.findForAgent.mockResolvedValueOnce(messages);

      const result = await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        count: 1,
        messages: [
          {
            id: 'msg-1',
            from: 'agent-b',
            type: 'coordination',
            subject: 'Hello',
            content: 'Hi there',
            priority: 'normal',
            threadId: 'thread-1',
            requiresResponse: false,
            createdAt: createdAt.toISOString(),
          },
        ],
      });
    });

    it('passes unread_only=false as unreadOnly: false', async () => {
      await executeSoulCommunicationTool('read_agent_inbox', { unread_only: false }, 'agent-a');

      expect(mockRepo.findForAgent).toHaveBeenCalledWith('agent-a', {
        unreadOnly: false,
        fromAgent: undefined,
        limit: 20,
      });
    });

    it('passes from_agent param through to findForAgent', async () => {
      await executeSoulCommunicationTool('read_agent_inbox', { from_agent: 'agent-b' }, 'agent-a');

      expect(mockRepo.findForAgent).toHaveBeenCalledWith('agent-a', {
        unreadOnly: true,
        fromAgent: 'agent-b',
        limit: 20,
      });
    });

    it('returns count: 0 and empty messages array when inbox is empty', async () => {
      const result = await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ count: 0, messages: [] });
    });
  });

  // =========================================================================
  // reply_to_agent
  // =========================================================================

  describe('reply_to_agent', () => {
    it('returns error when thread_id is missing', async () => {
      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { content: 'reply here' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('thread_id and content are required');
    });

    it('returns error when content is missing', async () => {
      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('thread_id and content are required');
    });

    it('returns error when both thread_id and content are missing', async () => {
      const result = await executeSoulCommunicationTool('reply_to_agent', {}, 'agent-a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('thread_id and content are required');
    });

    it('returns error when thread not found (empty array from findByThread)', async () => {
      mockRepo.findByThread.mockResolvedValueOnce([]);

      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-999', content: 'reply' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Thread not found');
    });

    it('replies to lastMsg.to when lastMsg.from === agentId', async () => {
      // lastMsg was sent BY agent-a TO agent-b → reply to agent-b
      const lastMsg = makeMessage({ from: 'agent-a', to: 'agent-b', threadId: 'thread-1' });
      mockRepo.findByThread.mockResolvedValueOnce([lastMsg]);

      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('reply-msg-id');

      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'my reply' },
        'agent-a'
      );

      expect(result.success).toBe(true);
      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.to).toBe('agent-b');
    });

    it('replies to lastMsg.from when lastMsg.from !== agentId', async () => {
      // lastMsg was sent BY agent-b TO agent-a → reply to agent-b
      const lastMsg = makeMessage({ from: 'agent-b', to: 'agent-a', threadId: 'thread-1' });
      mockRepo.findByThread.mockResolvedValueOnce([lastMsg]);

      await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'my reply' },
        'agent-a'
      );

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.to).toBe('agent-b');
    });

    it('creates reply with Re: prefix on subject and same threadId', async () => {
      const lastMsg = makeMessage({
        from: 'agent-b',
        to: 'agent-a',
        subject: 'Original Subject',
        threadId: 'thread-1',
      });
      mockRepo.findByThread.mockResolvedValueOnce([lastMsg]);

      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('reply-msg-id');

      await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'my reply' },
        'agent-a'
      );

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      expect(created.subject).toBe('Re: Original Subject');
      expect(created.threadId).toBe('thread-1');
      expect(created.content).toBe('my reply');
      expect(created.status).toBe('sent');
    });

    it('returns { messageId, threadId, to, status: sent }', async () => {
      const lastMsg = makeMessage({ from: 'agent-b', to: 'agent-a', threadId: 'thread-1' });
      mockRepo.findByThread.mockResolvedValueOnce([lastMsg]);

      const { generateId } = await import('@ownpilot/core');
      vi.mocked(generateId).mockReturnValueOnce('reply-msg-id');

      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'reply content' },
        'agent-a'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        messageId: 'reply-msg-id',
        threadId: 'thread-1',
        to: 'agent-b',
        status: 'sent',
      });
    });

    it('uses the last message in the thread for determining recipient', async () => {
      // Multi-message thread; only the last one should matter
      const firstMsg = makeMessage({
        id: 'msg-1',
        from: 'agent-a',
        to: 'agent-b',
        threadId: 'thread-1',
      });
      const lastMsg = makeMessage({
        id: 'msg-2',
        from: 'agent-b',
        to: 'agent-a',
        subject: 'Last',
        threadId: 'thread-1',
      });
      mockRepo.findByThread.mockResolvedValueOnce([firstMsg, lastMsg]);

      await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'final reply' },
        'agent-a'
      );

      const created = mockRepo.create.mock.calls[0]![0] as AgentMessage;
      // lastMsg.from is agent-b (not agentId=agent-a), so reply to agent-b
      expect(created.to).toBe('agent-b');
      expect(created.subject).toBe('Re: Last');
    });
  });

  // =========================================================================
  // Unknown tool
  // =========================================================================

  describe('unknown tool', () => {
    it('returns { success: false, error: "Unknown soul communication tool: ..." }', async () => {
      const result = await executeSoulCommunicationTool('nonexistent_tool', {}, 'agent-a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown soul communication tool: nonexistent_tool');
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('returns { success: false, error: message } when repo throws on send', async () => {
      mockRepo.create.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await executeSoulCommunicationTool(
        'send_agent_message',
        { to_agent: 'agent-b', content: 'Hello' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
    });

    it('returns { success: false, error: message } when repo throws on inbox read', async () => {
      mockRepo.findForAgent.mockRejectedValueOnce(new Error('Query timeout'));

      const result = await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query timeout');
    });

    it('returns { success: false, error: message } when repo throws on reply', async () => {
      const lastMsg = makeMessage({ from: 'agent-b', to: 'agent-a', threadId: 'thread-1' });
      mockRepo.findByThread.mockResolvedValueOnce([lastMsg]);
      mockRepo.create.mockRejectedValueOnce(new Error('Insert failed'));

      const result = await executeSoulCommunicationTool(
        'reply_to_agent',
        { thread_id: 'thread-1', content: 'reply' },
        'agent-a'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insert failed');
    });

    it('returns { success: false, error: message } when markAsRead throws', async () => {
      mockRepo.findForAgent.mockResolvedValueOnce([makeMessage()]);
      mockRepo.markAsRead.mockRejectedValueOnce(new Error('Update failed'));

      const result = await executeSoulCommunicationTool('read_agent_inbox', {}, 'agent-a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });
});

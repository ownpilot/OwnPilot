/**
 * Soul Communication Tools — Executor
 *
 * Executes send_agent_message, read_agent_inbox, reply_to_agent
 * using the AgentMessagesRepository.
 */

import { generateId, getErrorMessage, SOUL_COMMUNICATION_TOOLS } from '@ownpilot/core';
import type { AgentMessage } from '@ownpilot/core';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
import type { ToolExecutionResult } from '../services/tool-executor.js';

export { SOUL_COMMUNICATION_TOOLS };

export async function executeSoulCommunicationTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<ToolExecutionResult> {
  const agentId = userId ?? 'unknown';
  try {
    switch (toolName) {
      case 'send_agent_message':
        return await handleSendMessage(args, agentId);
      case 'read_agent_inbox':
        return await handleReadInbox(args, agentId);
      case 'reply_to_agent':
        return await handleReply(args, agentId);
      default:
        return { success: false, error: `Unknown soul communication tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

async function handleSendMessage(
  args: Record<string, unknown>,
  fromAgentId: string
): Promise<ToolExecutionResult> {
  const toAgent = String(args.to_agent ?? '');
  const type = String(args.type ?? 'coordination');
  const subject = String(args.subject ?? '');
  const content = String(args.content ?? '');
  const priority = String(args.priority ?? 'normal');
  const requiresResponse = Boolean(args.requires_response ?? false);

  if (!toAgent || !content) {
    return { success: false, error: 'to_agent and content are required' };
  }

  const msgId = generateId('msg');
  const threadId = generateId('thread');

  const message: AgentMessage = {
    id: msgId,
    from: fromAgentId,
    to: toAgent,
    type: type as AgentMessage['type'],
    subject,
    content,
    attachments: [],
    priority: priority as AgentMessage['priority'],
    threadId,
    requiresResponse,
    status: 'sent',
    createdAt: new Date(),
  };

  const repo = getAgentMessagesRepository();
  await repo.create(message);

  return {
    success: true,
    result: {
      messageId: msgId,
      threadId,
      to: toAgent,
      status: 'sent',
    },
  };
}

async function handleReadInbox(
  args: Record<string, unknown>,
  agentId: string
): Promise<ToolExecutionResult> {
  const unreadOnly = args.unread_only !== false; // default true
  const fromAgent = args.from_agent ? String(args.from_agent) : undefined;

  const repo = getAgentMessagesRepository();
  const messages = await repo.findForAgent(agentId, {
    unreadOnly,
    fromAgent,
    limit: 20,
  });

  // Mark fetched messages as read
  if (messages.length > 0) {
    await repo.markAsRead(messages.map((m) => m.id));
  }

  return {
    success: true,
    result: {
      count: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        from: m.from,
        type: m.type,
        subject: m.subject,
        content: m.content,
        priority: m.priority,
        threadId: m.threadId,
        requiresResponse: m.requiresResponse,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  };
}

async function handleReply(
  args: Record<string, unknown>,
  agentId: string
): Promise<ToolExecutionResult> {
  const threadId = String(args.thread_id ?? '');
  const content = String(args.content ?? '');

  if (!threadId || !content) {
    return { success: false, error: 'thread_id and content are required' };
  }

  // Find the thread to determine the recipient
  const repo = getAgentMessagesRepository();
  const thread = await repo.findByThread(threadId);
  if (thread.length === 0) {
    return { success: false, error: 'Thread not found' };
  }

  // Reply to the other participant in the thread
  const lastMsg = thread[thread.length - 1]!;
  const toAgent = lastMsg.from === agentId ? lastMsg.to : lastMsg.from;

  const msgId = generateId('msg');
  const message: AgentMessage = {
    id: msgId,
    from: agentId,
    to: toAgent,
    type: lastMsg.type,
    subject: `Re: ${lastMsg.subject}`,
    content,
    attachments: [],
    priority: lastMsg.priority,
    threadId,
    requiresResponse: false,
    status: 'sent',
    createdAt: new Date(),
  };

  await repo.create(message);

  return {
    success: true,
    result: {
      messageId: msgId,
      threadId,
      to: toAgent,
      status: 'sent',
    },
  };
}

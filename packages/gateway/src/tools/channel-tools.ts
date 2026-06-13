/**
 * Channel Tools — Executor
 *
 * Exposes the channel subsystem to agents (Claws, soul heartbeats, chat) via
 * the standard tool-call path. Without these tools an agent had no way to
 * reach Telegram / WhatsApp / Discord / etc. except through hard-wired
 * triggers, which is what made autonomous Claws feel locked away from the
 * outside world.
 *
 *   - send_channel_message    — send to one channel + chat id
 *   - broadcast_channel_message — fan-out to one platform or all channels
 *   - list_channels           — list installed channel plugins + status
 *   - get_channel_inbox       — read recent inbound messages
 */

import type { ToolDefinition, ChannelOutgoingMessage } from '@ownpilot/core/channels';
import { getErrorMessage } from '@ownpilot/core/services';
import { getChannelService, hasChannelService } from '@ownpilot/core/channels';
import { channelMessagesRepo } from '../db/repositories/channels/messages.js';
import { ChatRepository } from '../db/repositories/chat/index.js';
import type { ToolExecutionResult } from '../services/tool/executor.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelTools');

// ============================================================
// Tool Definitions
// ============================================================

export const CHANNEL_TOOLS: ToolDefinition[] = [
  {
    name: 'send_channel_message',
    description:
      'Send a text message to a specific channel + chat. Use list_channels first to discover installed channel plugin IDs (e.g. "telegram", "discord"). Use get_channel_inbox to learn the platform chat IDs you can reply to. Returns the platform message ID on success.',
    category: 'channels',
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description:
            'Channel plugin ID (e.g. "telegram", "whatsapp-plugin", "discord"). Get from list_channels.',
        },
        chat_id: {
          type: 'string',
          description:
            'Platform-specific chat / room / user ID to send to. For Telegram this is the chat ID; for Discord the channel ID; etc. Get from get_channel_inbox or your trigger payload.',
        },
        text: {
          type: 'string',
          description: 'Message text content',
        },
        reply_to_id: {
          type: 'string',
          description:
            'Optional platform message ID to reply to (when the channel supports threading)',
        },
      },
      required: ['channel', 'chat_id', 'text'],
    },
  },
  {
    name: 'broadcast_channel_message',
    description:
      'Broadcast a message. With "platform" set, sends to every connected channel on that platform (e.g. all Telegram bots). Without "platform", sends to every connected channel across every platform. Use sparingly — this can be noisy.',
    category: 'channels',
    parameters: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description:
            'Optional platform filter (e.g. "telegram", "discord"). Omit to broadcast to every connected channel on every platform.',
        },
        chat_id: {
          type: 'string',
          description:
            'Platform chat ID. Required because each plugin needs to know which chat to post to. For a true "any chat" broadcast use the per-channel inbox to pick chats first.',
        },
        text: {
          type: 'string',
          description: 'Message text content',
        },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'list_channels',
    description:
      'List installed channel plugins with their platform and connection status. Use this to discover which channel IDs are available for send_channel_message.',
    category: 'channels',
    parameters: {
      type: 'object',
      properties: {
        connected_only: {
          type: 'boolean',
          description: 'Filter to only channels currently connected (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_channel_inbox',
    description:
      'Read recent inbound messages from channels (Telegram / Discord / WhatsApp / etc.). Use to see what users have sent so you can reply. Returns sender, content, timestamps, and IDs needed for send_channel_message.',
    category: 'channels',
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Filter to a specific channel plugin ID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max messages to return (default 20, max 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_conversations',
    description:
      'Search conversation history using natural language. Returns matching conversations ranked by relevance. Use this to find past discussions — e.g. "did we discuss X last week?"',
    category: 'channels',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (natural language)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20, max 100)',
        },
      },
      required: ['query'],
    },
  },
];

export const CHANNEL_TOOL_NAMES = CHANNEL_TOOLS.map((t) => t.name);

// ============================================================
// Executor
// ============================================================

export async function executeChannelTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<ToolExecutionResult> {
  try {
    switch (toolName) {
      case 'send_channel_message':
        return await handleSend(args, userId);
      case 'broadcast_channel_message':
        return await handleBroadcast(args, userId);
      case 'list_channels':
        return await handleList(args);
      case 'get_channel_inbox':
        return await handleInbox(args);
      case 'search_conversations':
        return await handleSearch(args, userId);
      default:
        return { success: false, error: `Unknown channel tool: ${toolName}` };
    }
  } catch (err) {
    log.error(`channel tool failed: ${toolName}`, { error: getErrorMessage(err) });
    return { success: false, error: getErrorMessage(err) };
  }
}

// ============================================================
// Handlers
// ============================================================

async function handleSend(
  args: Record<string, unknown>,
  userId: string | undefined
): Promise<ToolExecutionResult> {
  const channel = String(args.channel ?? '').trim();
  const chatId = String(args.chat_id ?? '').trim();
  const text = String(args.text ?? '').trim();
  const replyToId = args.reply_to_id ? String(args.reply_to_id).trim() : undefined;

  if (!channel || !chatId || !text) {
    return { success: false, error: 'channel, chat_id, and text are required' };
  }

  if (!hasChannelService()) {
    return { success: false, error: 'Channel service is not initialized' };
  }
  const svc = getChannelService();

  const message: ChannelOutgoingMessage = {
    platformChatId: chatId,
    text,
    ...(replyToId ? { replyToId } : {}),
  };

  const platformMessageId = await svc.send(channel, message);

  return {
    success: true,
    result: {
      channel,
      chatId,
      platformMessageId,
      sentBy: userId ?? 'unknown',
    },
  };
}

async function handleBroadcast(
  args: Record<string, unknown>,
  userId: string | undefined
): Promise<ToolExecutionResult> {
  const platform = args.platform ? String(args.platform).trim() : undefined;
  const chatId = String(args.chat_id ?? '').trim();
  const text = String(args.text ?? '').trim();

  if (!chatId || !text) {
    return { success: false, error: 'chat_id and text are required' };
  }

  if (!hasChannelService()) {
    return { success: false, error: 'Channel service is not initialized' };
  }
  const svc = getChannelService();

  const message: ChannelOutgoingMessage = {
    platformChatId: chatId,
    text,
  };

  const deliveries = platform
    ? await svc.broadcast(platform, message)
    : await svc.broadcastAll(message);

  return {
    success: true,
    result: {
      platform: platform ?? 'all',
      deliveredCount: deliveries.size,
      deliveries: Array.from(deliveries.entries()).map(([pluginId, msgId]) => ({
        channel: pluginId,
        platformMessageId: msgId,
      })),
      sentBy: userId ?? 'unknown',
    },
  };
}

async function handleList(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const connectedOnly = Boolean(args.connected_only);

  if (!hasChannelService()) {
    return { success: false, error: 'Channel service is not initialized' };
  }
  const svc = getChannelService();

  let channels = svc.listChannels();
  if (connectedOnly) {
    channels = channels.filter((c) => c.status === 'connected');
  }

  return {
    success: true,
    result: {
      count: channels.length,
      channels: channels.map((c) => ({
        id: c.pluginId,
        platform: c.platform,
        name: c.name,
        status: c.status,
      })),
    },
  };
}

async function handleInbox(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const channel = args.channel ? String(args.channel).trim() : undefined;
  const rawLimit = args.limit ? Number(args.limit) : 20;
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

  const messages = channel
    ? await channelMessagesRepo.getByChannel(channel, limit)
    : await channelMessagesRepo.getInbox(limit);

  return {
    success: true,
    result: {
      count: messages.length,
      messages: messages
        .filter((m) => m.direction === 'inbound')
        .map((m) => ({
          id: m.id,
          channel: m.channelId,
          externalId: m.externalId,
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          replyToId: m.replyToId,
          conversationId: m.conversationId,
          createdAt: m.createdAt.toISOString(),
        })),
    },
  };
}

async function handleSearch(
  args: Record<string, unknown>,
  userId?: string
): Promise<ToolExecutionResult> {
  const query = String(args.query ?? '').trim();
  const rawLimit = args.limit ? Number(args.limit) : 20;
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  const chatRepo = new ChatRepository(userId ?? 'default');
  const results = await chatRepo.searchConversations(query, { limit });

  return {
    success: true,
    result: {
      count: results.length,
      query,
      conversations: results.map((conv) => ({
        id: conv.id,
        title: conv.title,
        agentName: conv.agentName,
        provider: conv.provider,
        model: conv.model,
        messageCount: conv.messageCount,
        isArchived: conv.isArchived,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        ftsRank: conv.ftsRank,
      })),
    },
  };
}

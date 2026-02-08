/**
 * Channel Routes
 *
 * REST API endpoints for channel management.
 * Uses unified IChannelService for all channel operations.
 */

import { Hono } from 'hono';
import { getChannelService, getDefaultPluginRegistry } from '@ownpilot/core';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { apiResponse, apiError, getIntParam, ERROR_CODES, sanitizeId } from './helpers.js';

export const channelRoutes = new Hono();

// In-memory read tracking (message IDs that have been read)
const readMessageIds = new Set<string>();

/**
 * GET /channels/messages/inbox - Get all messages from all channels (DB-backed)
 */
channelRoutes.get('/messages/inbox', async (c) => {
  const channelId = c.req.query('channelId');
  const limit = getIntParam(c, 'limit', 100, 1, 500);
  const offset = getIntParam(c, 'offset', 0, 0);

  try {
    const messagesRepo = new ChannelMessagesRepository();
    const dbMessages = await messagesRepo.getAll({ channelId: channelId ?? undefined, limit, offset });

    const messages = dbMessages.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      channelType: 'telegram' as const,
      sender: {
        id: m.senderId ?? (m.direction === 'outbound' ? 'assistant' : 'unknown'),
        name: m.senderName ?? (m.direction === 'outbound' ? 'Assistant' : 'Unknown'),
      },
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      read: m.direction === 'outbound' || readMessageIds.has(m.id),
      replied: false,
      direction: m.direction === 'inbound' ? 'incoming' as const : 'outgoing' as const,
      replyTo: m.replyToId,
      metadata: m.metadata,
    }));

    const unreadCount = messages.filter((m) => !m.read).length;

    return apiResponse(c, {
      messages,
      total: messages.length,
      unreadCount,
    });
  } catch (error) {
    return apiError(c, {
      code: ERROR_CODES.FETCH_FAILED,
      message: error instanceof Error ? error.message : 'Failed to fetch inbox',
    }, 500);
  }
});

/**
 * POST /channels/messages/:messageId/read - Mark message as read
 */
channelRoutes.post('/messages/:messageId/read', (c) => {
  const messageId = c.req.param('messageId');
  readMessageIds.add(messageId);
  return apiResponse(c, { messageId, read: true });
});

/**
 * GET /channels/status - Channel status summary
 */
channelRoutes.get('/status', (c) => {
  const service = getChannelService();
  const channels = service.listChannels();

  const byPlatform: Record<string, number> = {};
  for (const ch of channels) {
    byPlatform[ch.platform] = (byPlatform[ch.platform] ?? 0) + 1;
  }

  return apiResponse(c, {
    total: channels.length,
    connected: channels.filter((c) => c.status === 'connected').length,
    disconnected: channels.filter((c) => c.status === 'disconnected').length,
    error: channels.filter((c) => c.status === 'error').length,
    byPlatform,
  });
});

/**
 * GET /channels - List all channels
 */
channelRoutes.get('/', (c) => {
  const service = getChannelService();
  const channels = service.listChannels();

  return apiResponse(c, {
    channels: channels.map((ch) => {
      // Try to get bot info from the channel API (e.g. Telegram username)
      const api = service.getChannel(ch.pluginId);
      const botInfo = api && 'getBotInfo' in api && typeof (api as Record<string, unknown>).getBotInfo === 'function'
        ? (api as unknown as { getBotInfo(): { username?: string; firstName?: string } | null }).getBotInfo()
        : null;

      return {
        id: ch.pluginId,
        type: ch.platform,
        name: ch.name,
        status: ch.status,
        icon: ch.icon,
        ...(botInfo && { botInfo: { username: botInfo.username, firstName: botInfo.firstName } }),
      };
    }),
    summary: {
      total: channels.length,
      connected: channels.filter((c) => c.status === 'connected').length,
    },
    availablePlatforms: [...new Set(channels.map((ch) => ch.platform))],
  });
});

/**
 * POST /channels/:id/connect - Connect a channel plugin
 */
channelRoutes.post('/:id/connect', async (c) => {
  const pluginId = c.req.param('id');
  try {
    const service = getChannelService();
    await service.connect(pluginId);
    return apiResponse(c, { pluginId, status: 'connected' });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.CONNECTION_FAILED, message: error instanceof Error ? error.message : 'Failed to connect channel' }, 500);
  }
});

/**
 * POST /channels/:id/disconnect - Disconnect a channel plugin
 */
channelRoutes.post('/:id/disconnect', async (c) => {
  const pluginId = c.req.param('id');
  try {
    const service = getChannelService();
    await service.disconnect(pluginId);
    return apiResponse(c, { pluginId, status: 'disconnected' });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.DISCONNECT_FAILED, message: error instanceof Error ? error.message : 'Failed to disconnect channel' }, 500);
  }
});

/**
 * GET /channels/:id - Get channel details
 */
channelRoutes.get('/:id', (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Channel ${sanitizeId(pluginId)} not found` }, 404);
  }

  return apiResponse(c, {
    id: pluginId,
    platform: api.getPlatform(),
    status: api.getStatus(),
  });
});

/**
 * POST /channels/:id/send - Send message to a channel
 */
channelRoutes.post('/:id/send', async (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Channel ${sanitizeId(pluginId)} not found` }, 404);
  }

  try {
    const body = await c.req.json<{
      text?: string;
      content?: string;
      chatId?: string;
      replyToId?: string;
    }>();

    const text = body.text ?? body.content;
    let chatId = body.chatId;

    if (!text) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'text (or content) is required' }, 400);
    }

    // If chatId not provided, try to use the first allowed_user from Config Center
    // (in Telegram, private chat ID == user ID)
    if (!chatId) {
      const registry = await getDefaultPluginRegistry();
      const plugin = registry.get(pluginId);
      const requiredServices = plugin?.manifest.requiredServices as Array<{ name: string }> | undefined;
      if (requiredServices?.length) {
        const raw = configServicesRepo.getFieldValue(requiredServices[0]!.name, 'allowed_users');
        if (typeof raw === 'string' && raw.trim()) {
          chatId = raw.split(',')[0]!.trim();
        }
      }
    }

    if (!chatId) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'chatId is required (configure allowed_users in Config Center for auto-resolve)' }, 400);
    }

    const messageId = await service.send(pluginId, {
      platformChatId: chatId,
      text,
      replyToId: body.replyToId,
    });

    return apiResponse(c, { messageId, pluginId, chatId });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SEND_FAILED, message: error instanceof Error ? error.message : 'Failed to send message' }, 500);
  }
});

/**
 * GET /channels/:id/messages - Get messages for a channel
 */
channelRoutes.get('/:id/messages', async (c) => {
  const channelId = c.req.param('id');
  const limit = getIntParam(c, 'limit', 50, 1, 200);
  const offset = getIntParam(c, 'offset', 0, 0);

  try {
    const messagesRepo = new ChannelMessagesRepository();
    const messages = await messagesRepo.getByChannel(channelId, limit, offset);

    return apiResponse(c, { messages, count: messages.length, limit, offset });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.FETCH_FAILED, message: error instanceof Error ? error.message : 'Failed to fetch messages' }, 500);
  }
});

/**
 * No-op: incoming messages are persisted via ChannelMessagesRepository in service-impl.
 * Kept for API compatibility with service-impl imports.
 */
export function addIncomingMessage(
  _channelId: string,
  _platform: string,
  _message: {
    id: string;
    sender: { id: string; name: string; avatar?: string };
    content: string;
    timestamp: string;
    platformChatId?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  // DB persistence handled by ChannelMessagesRepository
}

/**
 * No-op: outgoing messages are persisted via ChannelMessagesRepository in service-impl.
 */
export function addOutgoingMessage(
  _channelId: string,
  _platform: string,
  _message: {
    id: string;
    content: string;
    timestamp: string;
    replyTo?: string;
    platformChatId?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  // DB persistence handled by ChannelMessagesRepository
}

/**
 * No-op: replied status tracked in DB via message threading.
 */
export function markMessageReplied(_messageId: string): void {
  // DB persistence handled by ChannelMessagesRepository
}

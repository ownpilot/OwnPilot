/**
 * Channel Routes
 *
 * REST API endpoints for channel management.
 * Uses unified IChannelService for all channel operations.
 */

import { Hono } from 'hono';
import { getChannelService } from '@ownpilot/core';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { apiResponse, apiError } from './helpers.js'
import { ERROR_CODES } from './helpers.js';

export const channelRoutes = new Hono();

// In-memory message store for inbox display
const messageStore: Map<
  string,
  Array<{
    id: string;
    channelId: string;
    platform: string;
    sender: { id: string; name: string; avatar?: string };
    content: string;
    timestamp: string;
    read: boolean;
    replied: boolean;
  }>
> = new Map();

/**
 * GET /channels/messages/inbox - Get all messages from all channels
 */
channelRoutes.get('/messages/inbox', (c) => {
  const filter = c.req.query('filter') ?? 'all';
  const platform = c.req.query('platform');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  let allMessages: (typeof messageStore extends Map<string, infer T> ? T : never) = [];

  for (const messages of messageStore.values()) {
    allMessages = allMessages.concat(messages);
  }

  if (filter === 'unread') {
    allMessages = allMessages.filter((m) => !m.read);
  } else if (filter === 'unanswered') {
    allMessages = allMessages.filter((m) => !m.replied);
  }

  if (platform) {
    allMessages = allMessages.filter((m) => m.platform === platform);
  }

  allMessages.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  allMessages = allMessages.slice(0, limit);

  return apiResponse(c, {
    messages: allMessages,
    total: allMessages.length,
    unreadCount: allMessages.filter((m) => !m.read).length,
  });
});

/**
 * POST /channels/messages/:messageId/read - Mark message as read
 */
channelRoutes.post('/messages/:messageId/read', (c) => {
  const messageId = c.req.param('messageId');
  for (const messages of messageStore.values()) {
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      msg.read = true;
      return apiResponse(c, { messageId, read: true });
    }
  }
  return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Message ${messageId} not found` }, 404);
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
    channels: channels.map((ch) => ({
      id: ch.pluginId,
      platform: ch.platform,
      name: ch.name,
      status: ch.status,
      icon: ch.icon,
    })),
    summary: {
      total: channels.length,
      connected: channels.filter((c) => c.status === 'connected').length,
    },
    availablePlatforms: [
      'telegram',
      'whatsapp',
      'discord',
      'slack',
      'line',
      'matrix',
    ],
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
    return c.json(
      {
        success: false,
        error: {
          code: 'CONNECTION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to connect channel',
        },
      },
      500
    );
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
    return c.json(
      {
        success: false,
        error: {
          code: 'DISCONNECT_FAILED',
          message: error instanceof Error ? error.message : 'Failed to disconnect channel',
        },
      },
      500
    );
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: `Channel ${pluginId} not found` } },
      404
    );
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: `Channel ${pluginId} not found` } },
      404
    );
  }

  try {
    const body = await c.req.json<{
      text: string;
      chatId: string;
      replyToId?: string;
    }>();

    if (!body.text || !body.chatId) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.INVALID_REQUEST, message: 'text and chatId are required' } },
        400
      );
    }

    const messageId = await service.send(pluginId, {
      platformChatId: body.chatId,
      text: body.text,
      replyToId: body.replyToId,
    });

    return apiResponse(c, { messageId, pluginId, chatId: body.chatId });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: error instanceof Error ? error.message : 'Failed to send message',
        },
      },
      500
    );
  }
});

/**
 * GET /channels/:id/messages - Get messages for a channel
 */
channelRoutes.get('/:id/messages', async (c) => {
  const channelId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  try {
    const messagesRepo = new ChannelMessagesRepository();
    const messages = await messagesRepo.getByChannel(channelId, limit, offset);

    return apiResponse(c, { messages, count: messages.length, limit, offset });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: error instanceof Error ? error.message : 'Failed to fetch messages',
        },
      },
      500
    );
  }
});

/**
 * Helper: add incoming message to in-memory store
 */
export function addIncomingMessage(
  channelId: string,
  platform: string,
  message: {
    id: string;
    sender: { id: string; name: string; avatar?: string };
    content: string;
    timestamp: string;
  }
): void {
  if (!messageStore.has(channelId)) {
    messageStore.set(channelId, []);
  }
  messageStore.get(channelId)!.push({
    ...message,
    channelId,
    platform,
    read: false,
    replied: false,
  });
}

/**
 * Helper: mark message as replied
 */
export function markMessageReplied(messageId: string): void {
  for (const messages of messageStore.values()) {
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      msg.replied = true;
      break;
    }
  }
}

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
import { apiResponse, apiError, ERROR_CODES, notFoundError, getErrorMessage } from './helpers.js';
import { pagination } from '../middleware/pagination.js';
import { refreshChannelApi } from '../plugins/init.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelRoutes');

export const channelRoutes = new Hono();

// In-memory read tracking (message IDs that have been read)
const MAX_READ_IDS = 2000;
const readMessageIds = new Set<string>();

function addReadMessageId(id: string): void {
  if (readMessageIds.size >= MAX_READ_IDS) {
    readMessageIds.delete(readMessageIds.values().next().value!);
  }
  readMessageIds.add(id);
}

interface ChannelAPIWithBotInfo {
  getBotInfo(): { username?: string; firstName?: string } | null;
}

function hasBotInfo(api: unknown): api is ChannelAPIWithBotInfo {
  return (
    typeof api === 'object' &&
    api !== null &&
    'getBotInfo' in api &&
    typeof (api as Record<string, unknown>).getBotInfo === 'function'
  );
}

/** Extract bot info from a channel API if available. */
function getChannelBotInfo(api: unknown): { username?: string; firstName?: string } | null {
  if (!hasBotInfo(api)) return null;
  return api.getBotInfo();
}

/**
 * GET /channels/messages/inbox - Get all messages from all channels (DB-backed)
 */
channelRoutes.get(
  '/messages/inbox',
  pagination({ defaultLimit: 100, maxLimit: 500 }),
  async (c) => {
    const channelId = c.req.query('channelId');
    const { limit, offset } = c.get('pagination')!;

    try {
      const messagesRepo = new ChannelMessagesRepository();
      const [dbMessages, total] = await Promise.all([
        messagesRepo.getAll({ channelId: channelId ?? undefined, limit, offset }),
        messagesRepo.count(channelId ?? undefined),
      ]);

      const messages = dbMessages.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        channelType: (m.channelId?.split('.')[1] ?? 'telegram') as string,
        sender: {
          id: m.senderId ?? (m.direction === 'outbound' ? 'assistant' : 'unknown'),
          name: m.senderName ?? (m.direction === 'outbound' ? 'Assistant' : 'Unknown'),
        },
        content: m.content,
        timestamp: m.createdAt.toISOString(),
        read: m.direction === 'outbound' || readMessageIds.has(m.id),
        replied: false,
        direction: m.direction === 'inbound' ? ('incoming' as const) : ('outgoing' as const),
        replyTo: m.replyToId,
        metadata: m.metadata,
      }));

      const unreadCount = messages.filter((m) => !m.read).length;

      return apiResponse(c, {
        messages,
        total,
        unreadCount,
      });
    } catch (error) {
      return apiError(
        c,
        {
          code: ERROR_CODES.FETCH_FAILED,
          message: getErrorMessage(error, 'Failed to fetch inbox'),
        },
        500
      );
    }
  }
);

/**
 * POST /channels/messages/:messageId/read - Mark message as read
 */
channelRoutes.post('/messages/:messageId/read', (c) => {
  const messageId = c.req.param('messageId');
  addReadMessageId(messageId);
  return apiResponse(c, { messageId, read: true });
});

/**
 * DELETE /channels/messages - Clear all inbox messages
 */
channelRoutes.delete('/messages', async (c) => {
  try {
    const channelId = c.req.query('channelId');
    const messagesRepo = new ChannelMessagesRepository();

    let deleted: number;
    if (channelId) {
      deleted = await messagesRepo.deleteByChannel(channelId);
    } else {
      deleted = await messagesRepo.deleteAll();
    }

    // Clear read tracking
    readMessageIds.clear();

    wsGateway.broadcast('data:changed', { entity: 'channel', action: 'deleted' });

    return apiResponse(c, { deleted });
  } catch (error) {
    log.error('Failed to clear messages:', error);
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(error, 'Failed to clear messages'),
      },
      500
    );
  }
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
      const botInfo = getChannelBotInfo(service.getChannel(ch.pluginId));

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
      disconnected: channels.filter((c) => c.status !== 'connected').length,
    },
    availableTypes: [...new Set(channels.map((ch) => ch.platform))],
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
    wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated', id: pluginId });
    return apiResponse(c, { pluginId, status: 'connected' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONNECTION_FAILED,
        message: getErrorMessage(error, 'Failed to connect channel'),
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
    wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated', id: pluginId });
    return apiResponse(c, { pluginId, status: 'disconnected' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.DISCONNECT_FAILED,
        message: getErrorMessage(error, 'Failed to disconnect channel'),
      },
      500
    );
  }
});

/**
 * POST /channels/:id/reconnect - Disconnect then reconnect a channel plugin
 *
 * Useful after updating config (e.g. webhook URL) to apply changes.
 */
channelRoutes.post('/:id/reconnect', async (c) => {
  const pluginId = c.req.param('id');
  try {
    await refreshChannelApi(pluginId);
    const service = getChannelService();
    try {
      await service.disconnect(pluginId);
    } catch {
      /* may already be disconnected */
    }
    await service.connect(pluginId);
    wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated', id: pluginId });
    return apiResponse(c, { pluginId, status: 'reconnected' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONNECTION_FAILED,
        message: getErrorMessage(error, 'Failed to reconnect channel'),
      },
      500
    );
  }
});

/**
 * POST /channels/:id/setup - Quick channel setup
 *
 * Saves config to Config Center and connects the channel in one step.
 * Body: { config: { bot_token: string, ... } }
 */
channelRoutes.post('/:id/setup', async (c) => {
  const pluginId = c.req.param('id');
  const body = await c.req.json<{ config?: Record<string, unknown> }>().catch(() => null);

  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }

  try {
    if (!body.config || typeof body.config !== 'object') {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'config object is required' },
        400
      );
    }

    // 1. Find the plugin and its required service
    const registry = await getDefaultPluginRegistry();
    const plugin = registry.get(pluginId);
    if (!plugin) {
      return notFoundError(c, 'Channel', pluginId);
    }

    const requiredServices = plugin.manifest.requiredServices as
      | Array<{ name: string }>
      | undefined;
    if (!requiredServices?.length) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'Channel has no required services' },
        400
      );
    }

    const serviceName = requiredServices[0]!.name;

    // 2. Create or update Config Center entry
    const existingEntry = configServicesRepo.getDefaultEntry(serviceName);
    if (existingEntry) {
      await configServicesRepo.updateEntry(existingEntry.id, {
        data: { ...existingEntry.data, ...body.config },
      });
    } else {
      await configServicesRepo.createEntry(serviceName, {
        label: 'Default',
        data: body.config,
      });
    }

    // 3. Broadcast config change
    wsGateway.broadcast('data:changed', {
      entity: 'config_service',
      action: existingEntry ? 'updated' : 'created',
      id: serviceName,
    });

    // 4. Refresh channel API with updated config
    await refreshChannelApi(pluginId);

    // 5. (Re)connect the channel
    const service = getChannelService();
    try {
      await service.disconnect(pluginId);
    } catch {
      /* may already be disconnected */
    }
    await service.connect(pluginId);

    // 6. Get bot info for response
    const api = service.getChannel(pluginId);
    const botInfo = hasBotInfo(api) ? await api.getBotInfo() : null;

    return apiResponse(c, {
      pluginId,
      status: 'connected',
      ...(botInfo && { botInfo: { username: botInfo.username, firstName: botInfo.firstName } }),
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONNECTION_FAILED,
        message: getErrorMessage(error, 'Channel setup failed'),
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
  const channels = service.listChannels();
  const ch = channels.find((x) => x.pluginId === pluginId);

  if (!ch) {
    return notFoundError(c, 'Channel', pluginId);
  }

  const botInfo = getChannelBotInfo(service.getChannel(pluginId));

  return apiResponse(c, {
    id: ch.pluginId,
    type: ch.platform,
    name: ch.name,
    status: ch.status,
    icon: ch.icon,
    ...(botInfo && { botInfo: { username: botInfo.username, firstName: botInfo.firstName } }),
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
    return notFoundError(c, 'Channel', pluginId);
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
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'text (or content) is required' },
        400
      );
    }

    // If chatId not provided, try to use the first allowed_user from Config Center
    // (in Telegram, private chat ID == user ID)
    if (!chatId) {
      const registry = await getDefaultPluginRegistry();
      const plugin = registry.get(pluginId);
      const requiredServices = plugin?.manifest.requiredServices as
        | Array<{ name: string }>
        | undefined;
      if (requiredServices?.length) {
        const raw = configServicesRepo.getFieldValue(requiredServices[0]!.name, 'allowed_users');
        if (typeof raw === 'string' && raw.trim()) {
          chatId = raw.split(',')[0]!.trim();
        }
      }
    }

    if (!chatId) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'chatId is required (configure allowed_users in Config Center for auto-resolve)',
        },
        400
      );
    }

    const messageId = await service.send(pluginId, {
      platformChatId: chatId,
      text,
      replyToId: body.replyToId,
    });

    return apiResponse(c, { messageId, pluginId, chatId });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.SEND_FAILED, message: getErrorMessage(error, 'Failed to send message') },
      500
    );
  }
});

/**
 * POST /channels/:id/reply - Reply to a Telegram conversation from web UI
 *
 * Sends a message, saves it to channel_messages, and broadcasts via WebSocket.
 */
channelRoutes.post('/:id/reply', async (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return notFoundError(c, 'Channel', pluginId);
  }

  if (api.getStatus() !== 'connected') {
    return apiError(
      c,
      { code: ERROR_CODES.CONNECTION_FAILED, message: 'Channel is not connected' },
      400
    );
  }

  try {
    const body = await c.req.json<{
      text?: string;
      platformChatId?: string;
      replyToMessageId?: string;
    }>();

    const text = body.text?.trim();
    if (!text) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'text is required' }, 400);
    }
    if (text.length > 4096) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'text must be 4096 characters or less' },
        400
      );
    }

    let chatId = body.platformChatId;

    // If chatId not provided, try to resolve from Config Center
    if (!chatId) {
      const registry = await getDefaultPluginRegistry();
      const plugin = registry.get(pluginId);
      const requiredServices = plugin?.manifest.requiredServices as
        | Array<{ name: string }>
        | undefined;
      if (requiredServices?.length) {
        const raw = configServicesRepo.getFieldValue(requiredServices[0]!.name, 'allowed_users');
        if (typeof raw === 'string' && raw.trim()) {
          chatId = raw.split(',')[0]!.trim();
        }
      }
    }

    if (!chatId) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'platformChatId is required' },
        400
      );
    }

    // Send the message via channel API
    const platformMessageId = await service.send(pluginId, {
      platformChatId: chatId,
      text,
      replyToId: body.replyToMessageId,
    });

    // Save to channel_messages
    const messageId = `${pluginId}:reply:${platformMessageId}`;
    try {
      const messagesRepo = new ChannelMessagesRepository();
      await messagesRepo.create({
        id: messageId,
        channelId: pluginId,
        externalId: platformMessageId,
        direction: 'outbound',
        senderId: 'web-ui',
        senderName: 'You',
        content: text,
        contentType: 'text',
        replyToId: body.replyToMessageId,
        metadata: { platformChatId: chatId, source: 'web-ui-reply' },
      });
    } catch (error) {
      // Non-critical — message was sent, just DB save failed
      log.warn('Failed to save reply to channel_messages', { error: getErrorMessage(error) });
    }

    // Broadcast to WebSocket
    wsGateway.broadcast('channel:message', {
      id: messageId,
      channelId: pluginId,
      channelType: api.getPlatform(),
      sender: 'You',
      content: text,
      timestamp: new Date().toISOString(),
      direction: 'outgoing',
    });

    return apiResponse(c, { messageId, platformMessageId });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.SEND_FAILED, message: getErrorMessage(error, 'Failed to send reply') },
      500
    );
  }
});

/**
 * GET /channels/:id/messages - Get messages for a channel
 */
channelRoutes.get('/:id/messages', pagination({ defaultLimit: 50, maxLimit: 200 }), async (c) => {
  const channelId = c.req.param('id');
  const { limit, offset } = c.get('pagination')!;

  try {
    const messagesRepo = new ChannelMessagesRepository();
    const messages = await messagesRepo.getByChannel(channelId, limit, offset);

    return apiResponse(c, { messages, count: messages.length, limit, offset });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch messages'),
      },
      500
    );
  }
});

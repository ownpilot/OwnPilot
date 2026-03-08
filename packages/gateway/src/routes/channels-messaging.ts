/**
 * Channel Messaging Routes
 *
 * Send and reply endpoints for channel communication.
 */

import { Hono } from 'hono';
import { getChannelService, getDefaultPluginRegistry } from '@ownpilot/core';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { apiResponse, apiError, ERROR_CODES, notFoundError, getErrorMessage } from './helpers.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelMessaging');

export const channelMessagingRoutes = new Hono();

/**
 * POST /:id/send - Send message to a channel
 */
channelMessagingRoutes.post('/:id/send', async (c) => {
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

    // If chatId not provided, auto-resolve from Config Center:
    // For WhatsApp: use my_phone (self-chat). For Telegram/others: use allowed_users.
    if (!chatId) {
      const registry = await getDefaultPluginRegistry();
      const plugin = registry.get(pluginId);
      const requiredServices = plugin?.manifest.requiredServices as
        | Array<{ name: string }>
        | undefined;
      if (requiredServices?.length) {
        const svcName = requiredServices[0]!.name;
        // Try my_phone first (WhatsApp self-chat), then allowed_users (Telegram)
        const myPhone = configServicesRepo.getFieldValue(svcName, 'my_phone');
        const allowedUsers = configServicesRepo.getFieldValue(svcName, 'allowed_users');
        const resolved = (myPhone as string) || (allowedUsers as string);
        if (typeof resolved === 'string' && resolved.trim()) {
          chatId = resolved.split(',')[0]!.trim();
        }
      }
    }

    if (!chatId) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'chatId is required. For WhatsApp: configure My Phone Number in Config Center.',
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
 * POST /:id/reply - Reply to a Telegram conversation from web UI
 *
 * Sends a message, saves it to channel_messages, and broadcasts via WebSocket.
 */
channelMessagingRoutes.post('/:id/reply', async (c) => {
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

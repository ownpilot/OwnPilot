/**
 * Channel Routes
 *
 * REST API endpoints for channel management (Telegram, Discord, Slack, etc.)
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import { channelManager } from '../channels/index.js';
import type { ChannelType } from '../ws/types.js';
import type { TelegramAdapter } from '../channels/adapters/telegram.js';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';

export const channelRoutes = new Hono();

// In-memory message store for demo/development
const messageStore: Map<string, Array<{
  id: string;
  channelId: string;
  channelType: ChannelType;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  timestamp: string;
  read: boolean;
  replied: boolean;
}>> = new Map();

/**
 * GET /channels/messages/inbox - Get all messages from all channels
 * NOTE: Must be defined BEFORE /:id to avoid route collision
 */
channelRoutes.get('/messages/inbox', (c) => {
  const filter = c.req.query('filter') ?? 'all'; // all, unread, unanswered
  const channelType = c.req.query('channelType') as ChannelType | undefined;
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  // Collect all messages
  let allMessages: typeof messageStore extends Map<string, infer T> ? T : never = [];

  for (const messages of messageStore.values()) {
    allMessages = allMessages.concat(messages);
  }

  // Apply filters
  if (filter === 'unread') {
    allMessages = allMessages.filter((m) => !m.read);
  } else if (filter === 'unanswered') {
    allMessages = allMessages.filter((m) => !m.replied);
  }

  if (channelType) {
    allMessages = allMessages.filter((m) => m.channelType === channelType);
  }

  // Sort by timestamp (newest first)
  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Limit
  allMessages = allMessages.slice(0, limit);

  const response: ApiResponse = {
    success: true,
    data: {
      messages: allMessages,
      total: allMessages.length,
      unreadCount: allMessages.filter((m) => !m.read).length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * POST /channels/messages/:messageId/read - Mark message as read
 * NOTE: Must be defined BEFORE /:id to avoid route collision
 */
channelRoutes.post('/messages/:messageId/read', (c) => {
  const messageId = c.req.param('messageId');

  // Find and update message
  for (const messages of messageStore.values()) {
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      message.read = true;

      const response: ApiResponse = {
        success: true,
        data: { messageId, read: true },
        meta: {
          requestId: c.get('requestId') ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      };

      return c.json(response);
    }
  }

  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Message ${messageId} not found`,
      },
    },
    404
  );
});

/**
 * GET /channels/status - Get channel status summary
 * NOTE: Must be defined BEFORE /:id to avoid route collision
 */
channelRoutes.get('/status', (c) => {
  const status = channelManager.getStatus();

  const response: ApiResponse = {
    success: true,
    data: status,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /channels - List all channels
 */
channelRoutes.get('/', (c) => {
  const channels = channelManager.getAll().map((adapter) => {
    const channelInfo: Record<string, unknown> = {
      id: adapter.id,
      type: adapter.type,
      name: adapter.name,
      status: adapter.status,
    };

    // Add bot info for Telegram channels
    if (adapter.type === 'telegram') {
      const telegramAdapter = adapter as unknown as TelegramAdapter;
      if (telegramAdapter.botInfo) {
        channelInfo.botInfo = {
          username: telegramAdapter.botInfo.username,
          firstName: telegramAdapter.botInfo.firstName,
        };
      }
    }

    return channelInfo;
  });

  const status = channelManager.getStatus();

  const response: ApiResponse = {
    success: true,
    data: {
      channels,
      summary: status,
      availableTypes: ['telegram', 'discord', 'slack', 'matrix', 'whatsapp', 'signal', 'webchat'],
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * POST /channels - Connect a new channel
 */
channelRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      id?: string;
      type: ChannelType;
      name: string;
      config: Record<string, unknown>;
    }>();

    if (!body.type || !body.name) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'type and name are required',
          },
        },
        400
      );
    }

    // Generate ID if not provided
    const channelId = body.id || `${body.type}-${Date.now()}`;

    // Check if channel already exists in memory
    if (channelManager.has(channelId)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CHANNEL_EXISTS',
            message: `Channel ${channelId} already exists`,
          },
        },
        409
      );
    }

    // Import repository
    const { channelsRepo } = await import('../db/repositories/channels.js');

    // Check if channel exists in database
    const existingChannel = await channelsRepo.getById(channelId);
    if (existingChannel) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CHANNEL_EXISTS',
            message: `Channel ${channelId} already exists in database`,
          },
        },
        409
      );
    }

    // Save to database first
    await channelsRepo.create({
      id: channelId,
      type: body.type,
      name: body.name,
      config: body.config,
    });

    // Connect the channel
    const adapter = await channelManager.connect({
      id: channelId,
      type: body.type,
      name: body.name,
      ...body.config,
    } as Parameters<typeof channelManager.connect>[0]);

    // Update status in database
    channelsRepo.updateStatus(channelId, 'connected');

    const response: ApiResponse = {
      success: true,
      data: {
        id: adapter.id,
        type: adapter.type,
        name: adapter.name,
        status: adapter.status,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 201);
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
 * GET /channels/:id - Get channel details
 */
channelRoutes.get('/:id', (c) => {
  const channelId = c.req.param('id');
  const adapter = channelManager.get(channelId);

  if (!adapter) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Channel ${channelId} not found`,
        },
      },
      404
    );
  }

  const channelData: Record<string, unknown> = {
    id: adapter.id,
    type: adapter.type,
    name: adapter.name,
    status: adapter.status,
  };

  // Add bot info for Telegram channels
  if (adapter.type === 'telegram') {
    const telegramAdapter = adapter as unknown as TelegramAdapter;
    if (telegramAdapter.botInfo) {
      channelData.botInfo = {
        username: telegramAdapter.botInfo.username,
        firstName: telegramAdapter.botInfo.firstName,
        id: telegramAdapter.botInfo.id,
      };
    }
  }

  const response: ApiResponse = {
    success: true,
    data: channelData,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * DELETE /channels/:id - Disconnect and remove a channel
 */
channelRoutes.delete('/:id', async (c) => {
  const channelId = c.req.param('id');
  const { channelsRepo } = await import('../db/repositories/channels.js');

  // Check database first
  const dbChannel = channelsRepo.getById(channelId);
  if (!dbChannel && !channelManager.has(channelId)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Channel ${channelId} not found`,
        },
      },
      404
    );
  }

  try {
    // Disconnect from memory if connected
    if (channelManager.has(channelId)) {
      await channelManager.disconnect(channelId);
    }

    // Remove from database
    channelsRepo.delete(channelId);

    const response: ApiResponse = {
      success: true,
      data: {
        id: channelId,
        disconnected: true,
        deleted: true,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
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
 * POST /channels/:id/send - Send message to a channel
 */
channelRoutes.post('/:id/send', async (c) => {
  const channelId = c.req.param('id');

  if (!channelManager.has(channelId)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Channel ${channelId} not found`,
        },
      },
      404
    );
  }

  try {
    const body = await c.req.json<{
      content: string;
      chatId?: string | number;
      attachments?: Array<{ type: string; url: string; name?: string }>;
      replyToId?: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.content) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'content is required',
          },
        },
        400
      );
    }

    // Resolve the outgoing channelId:
    // If chatId is provided, compose "adapterId:chatId" format for adapters that need it (e.g. Telegram)
    // Otherwise fall back to metadata.chatId, then try database lookup for the most recent chat
    let chatId = body.chatId ?? body.metadata?.chatId;

    // Auto-resolve chatId for Telegram channels when not provided
    const adapter = channelManager.get(channelId);
    if (!chatId && adapter?.type === 'telegram') {
      try {
        const messagesRepo = new ChannelMessagesRepository();
        const recentMessages = await messagesRepo.getByChannel(channelId, 1);
        if (recentMessages.length > 0 && recentMessages[0]!.metadata?.chatId) {
          chatId = recentMessages[0]!.metadata.chatId as string | number;
        }
      } catch {
        // Database lookup failed, continue without chatId (adapter will throw clear error)
      }
    }

    const outgoingChannelId = chatId ? `${channelId}:${chatId}` : channelId;

    // Map attachments to proper format
    type AttachmentType = 'image' | 'file' | 'audio' | 'video';
    const mappedAttachments = body.attachments?.map((a) => {
      let attachType: AttachmentType = 'file';
      if (a.type === 'image' || a.type === 'file' || a.type === 'audio' || a.type === 'video') {
        attachType = a.type;
      }
      return {
        type: attachType,
        url: a.url,
        mimeType: a.type.includes('/') ? a.type : 'application/octet-stream',
        filename: a.name,
      };
    });

    const messageId = await channelManager.send(channelId, {
      channelId: outgoingChannelId,
      content: body.content,
      attachments: mappedAttachments,
      replyToId: body.replyToId,
      metadata: body.metadata,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        messageId,
        channelId,
        sent: true,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
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
 * Helper function to add incoming message to store (called by channel adapters)
 */
export function addIncomingMessage(
  channelId: string,
  channelType: ChannelType,
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
    channelType,
    read: false,
    replied: false,
  });
}

/**
 * Helper function to mark message as replied
 */
export function markMessageReplied(messageId: string): void {
  for (const messages of messageStore.values()) {
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      message.replied = true;
      break;
    }
  }
}

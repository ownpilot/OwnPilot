/**
 * Channel Routes
 *
 * REST API endpoints for channel management.
 * Uses unified IChannelService for all channel operations.
 *
 * Implementation split:
 * - channels-inbox.ts:     Inbox endpoints (list, mark read, clear)
 * - channels-groups.ts:    WhatsApp group management endpoints
 * - channels-messaging.ts: Send/reply endpoints
 * - channels.ts:           Channel CRUD, connection, setup (this file)
 */

import { Hono } from 'hono';
import { getChannelService, getDefaultPluginRegistry } from '@ownpilot/core';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { channelUsersRepo } from '../db/repositories/channel-users.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { pagination } from '../middleware/pagination.js';
import { refreshChannelApi } from '../plugins/init.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

// Import sub-routes
import { channelInboxRoutes } from './channels-inbox.js';
import { channelGroupsRoutes } from './channels-groups.js';
import { channelMessagingRoutes } from './channels-messaging.js';

const log = getLog('ChannelRoutes');

export const channelRoutes = new Hono();

// Mount sub-routes
channelRoutes.route('/', channelInboxRoutes);
channelRoutes.route('/', channelGroupsRoutes);
channelRoutes.route('/', channelMessagingRoutes);

interface ChannelAPIWithBotInfo {
  getBotInfo(): { username?: string; firstName?: string } | null;
}

interface ChannelAPIWithQrCode {
  getQrCode(): string | null;
}

function hasBotInfo(api: unknown): api is ChannelAPIWithBotInfo {
  return (
    typeof api === 'object' &&
    api !== null &&
    'getBotInfo' in api &&
    typeof (api as Record<string, unknown>).getBotInfo === 'function'
  );
}

function hasQrCode(api: unknown): api is ChannelAPIWithQrCode {
  return (
    typeof api === 'object' &&
    api !== null &&
    'getQrCode' in api &&
    typeof (api as Record<string, unknown>).getQrCode === 'function'
  );
}

/** Extract bot info from a channel API if available. */
function getChannelBotInfo(api: unknown): { username?: string; firstName?: string } | null {
  if (!hasBotInfo(api)) return null;
  return api.getBotInfo();
}

/**
 * GET /status - Channel status summary
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
 * GET /pairing - Return per-channel pairing keys and owner status
 */
channelRoutes.get('/pairing', async (c) => {
  const { getPairingKey, getOwnerUserId } = await import('../services/pairing-service.js');
  const service = getChannelService();
  const channelList = service.listChannels();

  const channelPairings = await Promise.all(
    channelList.map(async (ch) => {
      const key = await getPairingKey(ch.pluginId);
      const ownerUserId = await getOwnerUserId(ch.platform);
      return {
        pluginId: ch.pluginId,
        platform: ch.platform,
        name: ch.name,
        key,
        claimed: !!ownerUserId,
        ownerUserId: ownerUserId ?? null,
      };
    })
  );

  const hasAnyOwner = channelPairings.some((ch) => ch.claimed);
  return apiResponse(c, { channels: channelPairings, hasAnyOwner });
});

/**
 * GET / - List all channels
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
 * POST /:id/connect - Connect a channel plugin
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
 * POST /:id/disconnect - Disconnect a channel plugin
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
 * POST /:id/logout - Logout and clear session data for a channel
 *
 * Unlike disconnect (which preserves session for quick reconnect),
 * logout clears all session data — next connect will require re-authentication
 * (e.g. new QR scan for WhatsApp, new bot token for Telegram).
 */
channelRoutes.post('/:id/logout', async (c) => {
  const pluginId = c.req.param('id');
  try {
    const service = getChannelService();
    await service.logout(pluginId);
    wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated', id: pluginId });
    return apiResponse(c, { pluginId, status: 'logged_out' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.DISCONNECT_FAILED,
        message: getErrorMessage(error, 'Failed to logout channel'),
      },
      500
    );
  }
});

/**
 * POST /:id/reconnect - Disconnect then reconnect a channel plugin
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
 * POST /:id/revoke-owner - Revoke ownership and rotate pairing key
 */
channelRoutes.post('/:id/revoke-owner', async (c) => {
  const pluginId = c.req.param('id');
  const { revokeOwnership, getPairingKey } = await import('../services/pairing-service.js');
  const service = getChannelService();
  const channel = service.listChannels().find((ch) => ch.pluginId === pluginId);
  if (!channel) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Channel not found' }, 404);
  }
  await revokeOwnership(pluginId, channel.platform);
  const newKey = await getPairingKey(pluginId);
  log.info('Ownership revoked via API', { pluginId, platform: channel.platform });
  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated', id: pluginId });
  return apiResponse(c, { pluginId, platform: channel.platform, newKey });
});

/**
 * POST /:id/setup - Quick channel setup
 *
 * Saves config to Config Center and connects the channel in one step.
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

    // 6. Get bot/connection info for response
    const api = service.getChannel(pluginId);
    const botInfo = hasBotInfo(api) ? api.getBotInfo() : null;
    const actualStatus = api?.getStatus() ?? 'connected';

    return apiResponse(c, {
      pluginId,
      status: actualStatus,
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
 * GET /:id/qr - Get QR code for WhatsApp authentication
 */
channelRoutes.get('/:id/qr', (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return notFoundError(c, 'Channel', pluginId);
  }

  const qr = hasQrCode(api) ? api.getQrCode() : null;
  const botInfo = hasBotInfo(api) ? api.getBotInfo() : null;

  return apiResponse(c, {
    qr,
    status: api.getStatus(),
    ...(botInfo && { botInfo }),
  });
});

/**
 * GET /:id/users - List users who have interacted with a channel
 */
channelRoutes.get('/:id/users', async (c) => {
  const pluginId = c.req.param('id');
  const platform = pluginId.split('.')[1] ?? '';

  try {
    const users = await channelUsersRepo.list({ platform, limit: 100, offset: 0 });

    return apiResponse(c, {
      users: users.map((u) => ({
        id: u.id,
        platform: u.platform,
        platformUserId: u.platformUserId,
        platformUsername: u.platformUsername,
        displayName: u.displayName,
        isVerified: u.isVerified,
        isBlocked: u.isBlocked,
        lastSeenAt: u.lastSeenAt.toISOString(),
      })),
      count: users.length,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch channel users'),
      },
      500
    );
  }
});

/**
 * GET /:id/stats - Message statistics for a channel
 */
channelRoutes.get('/:id/stats', async (c) => {
  const channelId = c.req.param('id');

  try {
    const messagesRepo = new ChannelMessagesRepository();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const [total, today, week, lastActivityAt] = await Promise.all([
      messagesRepo.count(channelId),
      messagesRepo.countSince(channelId, todayStart),
      messagesRepo.countSince(channelId, weekStart),
      messagesRepo.lastMessageAt(channelId),
    ]);

    return apiResponse(c, {
      totalMessages: total,
      todayMessages: today,
      weekMessages: week,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch channel stats'),
      },
      500
    );
  }
});

/**
 * GET /:id/chats - List distinct chats from message history
 */
channelRoutes.get('/:id/chats', async (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const channels = service.listChannels();
  const ch = channels.find((x) => x.pluginId === pluginId);

  if (!ch) {
    return notFoundError(c, 'Channel', pluginId);
  }

  try {
    const { limit, offset } = getPaginationParams(c, 20, 100);
    const messagesRepo = new ChannelMessagesRepository();
    const result = await messagesRepo.getDistinctChats(pluginId, limit, offset);
    return apiResponse(c, { chats: result.chats, count: result.chats.length, total: result.total });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch chats'),
      },
      500
    );
  }
});

/**
 * GET /:id - Get channel details
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
 * GET /:id/messages - Get messages for a channel
 */
channelRoutes.get('/:id/messages', pagination({ defaultLimit: 50, maxLimit: 200 }), async (c) => {
  const channelId = c.req.param('id');
  const { limit, offset } = c.get('pagination')!;
  const chatId = c.req.query('chatId');

  // Validate chatId format — must contain @ domain suffix (prevents arbitrary string injection into metadata query)
  if (chatId !== undefined && (chatId.length === 0 || !chatId.includes('@'))) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Invalid chatId format — must include @ domain suffix',
      },
      400
    );
  }

  try {
    const messagesRepo = new ChannelMessagesRepository();

    // If chatId provided, filter by specific chat JID (group or DM)
    if (chatId) {
      const result = await messagesRepo.getByChat(channelId, chatId, limit, offset);
      return apiResponse(c, {
        messages: result.messages,
        count: result.messages.length,
        total: result.total,
        limit,
        offset,
      });
    }

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

/**
 * Channel Routes
 *
 * REST API endpoints for channel management.
 * Uses unified IChannelService for all channel operations.
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

interface ChannelAPIWithGroups {
  listGroups(includeParticipants?: boolean): Promise<unknown[]>;
  getGroup(groupJid: string): Promise<unknown>;
}

function hasGroups(api: unknown): api is ChannelAPIWithGroups {
  return (
    typeof api === 'object' &&
    api !== null &&
    'listGroups' in api &&
    typeof (api as Record<string, unknown>).listGroups === 'function' &&
    'getGroup' in api &&
    typeof (api as Record<string, unknown>).getGroup === 'function'
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
      const result = await messagesRepo.deleteByChannel(channelId);
      deleted = result.count;
      // Evict only the deleted channel's message IDs from the read-tracking cache
      for (const id of result.ids) {
        readMessageIds.delete(id);
      }
    } else {
      deleted = await messagesRepo.deleteAll();
      readMessageIds.clear();
    }

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
 * GET /channels/pairing - Return per-channel pairing keys and owner status
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
 * POST /channels/:id/logout - Logout and clear session data for a channel
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
 * POST /channels/:id/revoke-owner - Revoke ownership and rotate pairing key
 *
 * Clears the owner for this channel's platform and generates a new pairing key
 * so a fresh /connect claim can be made.
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
 * GET /channels/:id/qr - Get QR code for WhatsApp authentication
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
 * GET /channels/:id/users - List users who have interacted with a channel
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
 * GET /channels/:id/stats - Message statistics for a channel
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
 * GET /channels/:id/groups - List WhatsApp groups
 */
channelRoutes.get('/:id/groups', async (c) => {
  const pluginId = c.req.param('id');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return notFoundError(c, 'Channel', pluginId);
  }

  if (api.getStatus() !== 'connected') {
    return apiError(
      c,
      { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Channel is not connected' },
      503
    );
  }

  if (!hasGroups(api)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Channel does not support group listing' },
      400
    );
  }

  try {
    const includeParticipants = c.req.query('includeParticipants') === 'true';
    const groups = await api.listGroups(includeParticipants);
    return apiResponse(c, { groups, count: groups.length });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch groups'),
      },
      500
    );
  }
});

/**
 * GET /channels/:id/groups/:groupJid - Get single group details
 */
channelRoutes.get('/:id/groups/:groupJid', async (c) => {
  const pluginId = c.req.param('id');
  const rawGroupJid = c.req.param('groupJid');
  const service = getChannelService();
  const api = service.getChannel(pluginId);

  if (!api) {
    return notFoundError(c, 'Channel', pluginId);
  }

  if (api.getStatus() !== 'connected') {
    return apiError(
      c,
      { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Channel is not connected' },
      503
    );
  }

  if (!hasGroups(api)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Channel does not support group listing' },
      400
    );
  }

  // Decode URL-encoded JID and auto-append @g.us if missing
  let groupJid: string;
  try {
    groupJid = decodeURIComponent(rawGroupJid);
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID encoding' },
      400
    );
  }
  if (!groupJid.includes('@')) {
    groupJid = `${groupJid}@g.us`;
  }

  // Validate JID format: numeric prefix + @g.us (prevents injection of arbitrary strings into Baileys)
  if (!/^\d[\d-]*@g\.us$/.test(groupJid)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID format' },
      400
    );
  }

  try {
    const group = await api.getGroup(groupJid);
    return apiResponse(c, group);
  } catch (error) {
    const msg = getErrorMessage(error, '');
    if (
      msg.includes('not-authorized') ||
      msg.includes('item-not-found') ||
      msg.includes('not found')
    ) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Group not found' }, 404);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch group'),
      },
      500
    );
  }
});

/**
 * GET /channels/:id/groups/:groupJid/messages - Get messages for a specific group
 * Returns messages from DB (no WhatsApp API call — anti-ban safe).
 */
channelRoutes.get('/:id/groups/:groupJid/messages', async (c) => {
  const pluginId = c.req.param('id');
  const rawGroupJid = c.req.param('groupJid');

  // Decode URL-encoded JID and auto-append @g.us if missing
  let groupJid: string;
  try {
    groupJid = decodeURIComponent(rawGroupJid);
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID encoding' },
      400
    );
  }
  if (!groupJid.includes('@')) {
    groupJid = `${groupJid}@g.us`;
  }

  // Validate JID format: numeric prefix + @g.us (prevents injection)
  if (!/^\d[\d-]*@g\.us$/.test(groupJid)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID format' },
      400
    );
  }

  try {
    const { limit, offset } = getPaginationParams(c, 50, 200);
    const messagesRepo = new ChannelMessagesRepository();
    const result = await messagesRepo.getByChat(pluginId, groupJid, limit, offset);
    return apiResponse(c, {
      messages: result.messages,
      count: result.messages.length,
      total: result.total,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.FETCH_FAILED,
        message: getErrorMessage(error, 'Failed to fetch group messages'),
      },
      500
    );
  }
});

/**
 * POST /channels/:id/groups/:groupJid/sync - Trigger on-demand history fetch for a group
 * Result arrives async via messaging-history.set event — check messages endpoint later.
 */
channelRoutes.post('/:id/groups/:groupJid/sync', async (c) => {
  const pluginId = c.req.param('id');
  const rawGroupJid = c.req.param('groupJid');

  let groupJid: string;
  try {
    groupJid = decodeURIComponent(rawGroupJid);
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID encoding' },
      400
    );
  }
  if (!groupJid.includes('@')) {
    groupJid = `${groupJid}@g.us`;
  }
  if (!/^\d[\d-]*@g\.us$/.test(groupJid)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid group JID format' },
      400
    );
  }

  try {
    const service = getChannelService();
    const api = service.getChannel(pluginId) as unknown as Record<string, unknown> | null;
    if (!api || typeof api.fetchGroupHistory !== 'function') {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_REQUEST, message: 'Channel does not support history fetch' },
        501
      );
    }

    const rawCount = parseInt(c.req.query('count') ?? '50', 10);
    const count = isNaN(rawCount) || rawCount < 1 ? 50 : rawCount;
    const sessionId = await (
      api.fetchGroupHistory as (jid: string, count: number) => Promise<string>
    )(groupJid, Math.min(count, 50));

    return apiResponse(
      c,
      {
        status: 'accepted',
        message: 'History fetch requested — messages will arrive asynchronously via history sync',
        sessionId,
        groupJid,
      },
      202
    );
  } catch (error) {
    const msg = getErrorMessage(error, 'Failed to trigger history fetch');
    const status = msg.includes('Rate limited') ? 429 : 500;
    return apiError(c, { code: ERROR_CODES.FETCH_FAILED, message: msg }, status);
  }
});

/**
 * GET /channels/:id/chats - List distinct chats from message history
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

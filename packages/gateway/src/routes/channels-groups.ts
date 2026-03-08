/**
 * Channel Groups Routes
 *
 * WhatsApp group management: list groups, get group details,
 * fetch group messages, trigger history sync.
 */

import { Hono } from 'hono';
import { getChannelService } from '@ownpilot/core';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  getIntParam,
  getPaginationParams,
} from './helpers.js';

export const channelGroupsRoutes = new Hono();

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

/** Decode and normalize a group JID from a URL parameter. */
function decodeGroupJid(
  rawJid: string
): { ok: true; jid: string } | { ok: false; error: string } {
  let jid: string;
  try {
    jid = decodeURIComponent(rawJid);
  } catch {
    return { ok: false, error: 'Invalid group JID encoding' };
  }
  if (!jid.includes('@')) {
    jid = `${jid}@g.us`;
  }
  // Validate JID format: numeric prefix + @g.us (prevents injection)
  if (!/^\d[\d-]*@g\.us$/.test(jid)) {
    return { ok: false, error: 'Invalid group JID format' };
  }
  return { ok: true, jid };
}

/**
 * GET /:id/groups - List WhatsApp groups
 */
channelGroupsRoutes.get('/:id/groups', async (c) => {
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
 * GET /:id/groups/:groupJid - Get single group details
 */
channelGroupsRoutes.get('/:id/groups/:groupJid', async (c) => {
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

  const decoded = decodeGroupJid(rawGroupJid);
  if (!decoded.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: decoded.error }, 400);
  }

  try {
    const group = await api.getGroup(decoded.jid);
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
 * GET /:id/groups/:groupJid/messages - Get messages for a specific group
 * Returns messages from DB (no WhatsApp API call — anti-ban safe).
 */
channelGroupsRoutes.get('/:id/groups/:groupJid/messages', async (c) => {
  const pluginId = c.req.param('id');
  const rawGroupJid = c.req.param('groupJid');

  const decoded = decodeGroupJid(rawGroupJid);
  if (!decoded.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: decoded.error }, 400);
  }

  try {
    const { limit, offset } = getPaginationParams(c, 50, 200);
    const messagesRepo = new ChannelMessagesRepository();
    const result = await messagesRepo.getByChat(pluginId, decoded.jid, limit, offset);
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
 * POST /:id/groups/:groupJid/sync - Trigger on-demand history fetch for a group
 * Result arrives async via messaging-history.set event — check messages endpoint later.
 */
channelGroupsRoutes.post('/:id/groups/:groupJid/sync', async (c) => {
  const pluginId = c.req.param('id');
  const rawGroupJid = c.req.param('groupJid');

  const decoded = decodeGroupJid(rawGroupJid);
  if (!decoded.ok) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: decoded.error }, 400);
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

    const count = getIntParam(c, 'count', 50, 1, 50);
    const sessionId = await (
      api.fetchGroupHistory as (jid: string, count: number) => Promise<string>
    )(decoded.jid, count);

    return apiResponse(
      c,
      {
        status: 'accepted',
        message: 'History fetch requested — messages will arrive asynchronously via history sync',
        sessionId,
        groupJid: decoded.jid,
      },
      202
    );
  } catch (error) {
    const msg = getErrorMessage(error, 'Failed to trigger history fetch');
    const status = msg.includes('Rate limited') ? 429 : 500;
    return apiError(c, { code: ERROR_CODES.FETCH_FAILED, message: msg }, status);
  }
});

/**
 * Channel Inbox Routes
 *
 * DB-backed inbox endpoints: list all messages, mark read, clear.
 */

import { Hono } from 'hono';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { pagination } from '../middleware/pagination.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelInbox');

export const channelInboxRoutes = new Hono();

// In-memory read tracking (message IDs that have been read)
const MAX_READ_IDS = 2000;
export const readMessageIds = new Set<string>();

export function addReadMessageId(id: string): void {
  if (readMessageIds.size >= MAX_READ_IDS) {
    readMessageIds.delete(readMessageIds.values().next().value!);
  }
  readMessageIds.add(id);
}

/**
 * GET /messages/inbox - Get all messages from all channels (DB-backed)
 */
channelInboxRoutes.get(
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
 * POST /messages/:messageId/read - Mark message as read
 */
channelInboxRoutes.post('/messages/:messageId/read', (c) => {
  const messageId = c.req.param('messageId');
  addReadMessageId(messageId);
  return apiResponse(c, { messageId, read: true });
});

/**
 * DELETE /messages - Clear all inbox messages
 */
channelInboxRoutes.delete('/messages', async (c) => {
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

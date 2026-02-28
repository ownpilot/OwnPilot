/**
 * Channel Messages Repository (PostgreSQL)
 *
 * Stores incoming and outgoing messages from channels (inbox)
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';

export interface ChannelMessage {
  id: string;
  channelId: string;
  externalId?: string;
  direction: 'inbound' | 'outbound';
  senderId?: string;
  senderName?: string;
  content: string;
  contentType: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
  replyToId?: string;
  conversationId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface ChannelMessageRow {
  id: string;
  channel_id: string;
  external_id: string | null;
  direction: string;
  sender_id: string | null;
  sender_name: string | null;
  content: string;
  content_type: string;
  attachments: string | null;
  reply_to_id: string | null;
  conversation_id: string | null;
  metadata: string;
  created_at: string;
}

function rowToChannelMessage(row: ChannelMessageRow): ChannelMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    externalId: row.external_id ?? undefined,
    direction: row.direction as ChannelMessage['direction'],
    senderId: row.sender_id ?? undefined,
    senderName: row.sender_name ?? undefined,
    content: row.content,
    contentType: row.content_type,
    attachments: parseJsonFieldNullable(row.attachments) ?? undefined,
    replyToId: row.reply_to_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    metadata: parseJsonField(row.metadata, {}),
    createdAt: new Date(row.created_at),
  };
}

export class ChannelMessagesRepository extends BaseRepository {
  async create(data: {
    id: string;
    channelId: string;
    externalId?: string;
    direction: ChannelMessage['direction'];
    senderId?: string;
    senderName?: string;
    content: string;
    contentType?: string;
    attachments?: ChannelMessage['attachments'];
    replyToId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChannelMessage> {
    await this.execute(
      `INSERT INTO channel_messages (
        id, channel_id, external_id, direction, sender_id, sender_name,
        content, content_type, attachments, reply_to_id, conversation_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        data.id,
        data.channelId,
        data.externalId ?? null,
        data.direction,
        data.senderId ?? null,
        data.senderName ?? null,
        data.content,
        data.contentType ?? 'text',
        data.attachments ? JSON.stringify(data.attachments) : null,
        data.replyToId ?? null,
        data.conversationId ?? null,
        JSON.stringify(data.metadata ?? {}),
      ]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create channel message');
    return result;
  }

  async getById(id: string): Promise<ChannelMessage | null> {
    const row = await this.queryOne<ChannelMessageRow>(
      `SELECT * FROM channel_messages WHERE id = $1`,
      [id]
    );
    return row ? rowToChannelMessage(row) : null;
  }

  async getByChannel(channelId: string, limit = 100, offset = 0): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE channel_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [channelId, limit, offset]
    );
    return rows.map(rowToChannelMessage);
  }

  async getByConversation(
    conversationId: string,
    limit = 100,
    offset = 0
  ): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    return rows.map(rowToChannelMessage);
  }

  async getInbox(limit = 100, offset = 0): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE direction = 'inbound'
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToChannelMessage);
  }

  async getOutbox(limit = 100, offset = 0): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE direction = 'outbound'
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToChannelMessage);
  }

  async getAll(options?: {
    channelId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ChannelMessage[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    if (options?.channelId) {
      const rows = await this.query<ChannelMessageRow>(
        `SELECT * FROM channel_messages
         WHERE channel_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [options.channelId, limit, offset]
      );
      return rows.map(rowToChannelMessage);
    }

    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToChannelMessage);
  }

  async getRecent(channelId: string, count: number): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM (
        SELECT * FROM channel_messages
        WHERE channel_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) subq ORDER BY created_at ASC`,
      [channelId, count]
    );
    return rows.map(rowToChannelMessage);
  }

  async search(searchQuery: string, limit = 50): Promise<ChannelMessage[]> {
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${this.escapeLike(searchQuery)}%`, limit]
    );
    return rows.map(rowToChannelMessage);
  }

  async linkConversation(id: string, conversationId: string): Promise<void> {
    await this.execute(
      `UPDATE channel_messages SET conversation_id = $1 WHERE id = $2 AND conversation_id IS NULL`,
      [conversationId, id]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM channel_messages WHERE id = $1`, [id]);
    return result.changes > 0;
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const result = await this.execute(`DELETE FROM channel_messages WHERE channel_id = $1`, [
      channelId,
    ]);
    return result.changes;
  }

  async deleteAll(): Promise<number> {
    const result = await this.execute(`DELETE FROM channel_messages`);
    return result.changes;
  }

  async count(channelId?: string): Promise<number> {
    if (channelId) {
      const row = await this.queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM channel_messages WHERE channel_id = $1`,
        [channelId]
      );
      return parseInt(row?.count ?? '0', 10);
    }

    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM channel_messages`
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async countSince(channelId: string, since: Date): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM channel_messages WHERE channel_id = $1 AND created_at >= $2`,
      [channelId, since.toISOString()]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async lastMessageAt(channelId: string): Promise<Date | null> {
    const row = await this.queryOne<{ created_at: string }>(
      `SELECT created_at FROM channel_messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [channelId]
    );
    return row ? new Date(row.created_at) : null;
  }

  async countInbox(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM channel_messages WHERE direction = 'inbound'`
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const channelMessagesRepo = new ChannelMessagesRepository();

// Factory function
export function createChannelMessagesRepository(): ChannelMessagesRepository {
  return new ChannelMessagesRepository();
}

/**
 * Channel Messages Repository
 *
 * Stores incoming and outgoing messages from channels (inbox)
 */

import { getDatabase } from '../connection.js';

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
    attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    replyToId: row.reply_to_id ?? undefined,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: new Date(row.created_at),
  };
}

export class ChannelMessagesRepository {
  private db = getDatabase();

  create(data: {
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
    metadata?: Record<string, unknown>;
  }): ChannelMessage {
    const stmt = this.db.prepare(`
      INSERT INTO channel_messages (
        id, channel_id, external_id, direction, sender_id, sender_name,
        content, content_type, attachments, reply_to_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
      JSON.stringify(data.metadata ?? {})
    );

    return this.getById(data.id)!;
  }

  getById(id: string): ChannelMessage | null {
    const stmt = this.db.prepare<string, ChannelMessageRow>(`
      SELECT * FROM channel_messages WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToChannelMessage(row) : null;
  }

  getByChannel(channelId: string, limit = 100, offset = 0): ChannelMessage[] {
    const stmt = this.db.prepare<[string, number, number], ChannelMessageRow>(`
      SELECT * FROM channel_messages
      WHERE channel_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(channelId, limit, offset).map(rowToChannelMessage);
  }

  getInbox(limit = 100, offset = 0): ChannelMessage[] {
    const stmt = this.db.prepare<[number, number], ChannelMessageRow>(`
      SELECT * FROM channel_messages
      WHERE direction = 'inbound'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset).map(rowToChannelMessage);
  }

  getOutbox(limit = 100, offset = 0): ChannelMessage[] {
    const stmt = this.db.prepare<[number, number], ChannelMessageRow>(`
      SELECT * FROM channel_messages
      WHERE direction = 'outbound'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset).map(rowToChannelMessage);
  }

  getRecent(channelId: string, count: number): ChannelMessage[] {
    const stmt = this.db.prepare<[string, number], ChannelMessageRow>(`
      SELECT * FROM (
        SELECT * FROM channel_messages
        WHERE channel_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC
    `);

    return stmt.all(channelId, count).map(rowToChannelMessage);
  }

  search(query: string, limit = 50): ChannelMessage[] {
    const stmt = this.db.prepare<[string, number], ChannelMessageRow>(`
      SELECT * FROM channel_messages
      WHERE content LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(`%${query}%`, limit).map(rowToChannelMessage);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM channel_messages WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteByChannel(channelId: string): number {
    const stmt = this.db.prepare(`DELETE FROM channel_messages WHERE channel_id = ?`);
    const result = stmt.run(channelId);
    return result.changes;
  }

  count(channelId?: string): number {
    if (channelId) {
      const stmt = this.db.prepare<string, { count: number }>(`
        SELECT COUNT(*) as count FROM channel_messages WHERE channel_id = ?
      `);
      return stmt.get(channelId)?.count ?? 0;
    }

    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM channel_messages
    `);
    return stmt.get()?.count ?? 0;
  }

  countInbox(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM channel_messages WHERE direction = 'inbound'
    `);
    return stmt.get()?.count ?? 0;
  }
}

export const channelMessagesRepo = new ChannelMessagesRepository();

/**
 * Channel Messages Repository (PostgreSQL)
 *
 * Stores incoming and outgoing messages from channels (inbox)
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';
import type { WhatsAppDocumentMetadata } from '../../channels/plugins/whatsapp/message-parser.js';

export interface ChannelMessageAttachment {
  type: string;
  url: string;
  name?: string;
  /** MIME type (e.g. image/jpeg, application/octet-stream) */
  mimeType?: string;
  /** Original filename for documents */
  filename?: string;
  /** Binary content as base64 string */
  data?: string;
  /** File size in bytes */
  size?: number;
  /** Local disk path for binary files (e.g. SOR files written to /app/data/sor-files/) */
  local_path?: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  externalId?: string;
  direction: 'inbound' | 'outbound';
  senderId?: string;
  senderName?: string;
  content: string;
  contentType: string;
  attachments?: ChannelMessageAttachment[];
  replyToId?: string;
  conversationId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Serialize an attachment array for DB storage.
 * Converts Uint8Array/Buffer data to base64 string so JSON.stringify works correctly.
 */
export function serializeAttachments(
  attachments: Array<{
    type: string;
    url?: string;
    name?: string;
    mimeType?: string;
    filename?: string;
    data?: Uint8Array | Buffer | string;
    size?: number;
    local_path?: string;
  }>
): ChannelMessageAttachment[] {
  return attachments.map((a) => {
    let dataStr: string | undefined;
    if (a.data instanceof Uint8Array || Buffer.isBuffer(a.data)) {
      dataStr = Buffer.from(a.data as Uint8Array).toString('base64');
    } else if (typeof a.data === 'string') {
      dataStr = a.data;
    }
    return {
      type: a.type,
      url: a.url ?? '',
      name: a.name,
      mimeType: a.mimeType,
      filename: a.filename,
      data: dataStr,
      size: a.size ?? (a.data ? (a.data as Uint8Array).length : undefined),
      local_path: a.local_path,
    };
  });
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

/** Input attachment type — accepts Uint8Array/Buffer for binary data before serialization */
export type ChannelMessageAttachmentInput = {
  type: string;
  url?: string;
  name?: string;
  mimeType?: string;
  filename?: string;
  data?: Uint8Array | Buffer | string;
  size?: number;
  /** Local disk path set after writing binary to disk (e.g. SOR files) */
  local_path?: string;
};

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
    attachments?: ChannelMessageAttachmentInput[];
    replyToId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChannelMessage> {
    const serialized = data.attachments ? serializeAttachments(data.attachments) : null;
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
        serialized ? JSON.stringify(serialized) : null,
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

  /**
   * Replace attachments JSON for an existing message.
   * Used by retry-media flow after downloading missing binary payload.
   */
  async updateAttachments(id: string, attachments: ChannelMessageAttachmentInput[]): Promise<boolean> {
    const serialized = serializeAttachments(attachments);
    const result = await this.execute(
      `UPDATE channel_messages SET attachments = $1 WHERE id = $2`,
      [JSON.stringify(serialized), id]
    );
    return result.changes > 0;
  }

  /**
   * Enrich existing message metadata with media fields (mediaKey, directPath, url).
   * Used after history sync re-delivers messages that already exist in DB —
   * createBatch ON CONFLICT DO NOTHING skips the insert, so we merge media
   * fields from the fresh proto into the existing row.
   *
   * Only updates if the existing row is MISSING mediaKey (won't overwrite).
   */
  async enrichMediaMetadata(
    id: string,
    documentMeta: Partial<WhatsAppDocumentMetadata>
  ): Promise<boolean> {
    if (!documentMeta.mediaKey) return false;
    const patch = JSON.stringify({
      mediaKey: documentMeta.mediaKey,
      directPath: documentMeta.directPath ?? null,
      url: documentMeta.url ?? null,
      hasMediaKey: true,
      hasUrl: Boolean(documentMeta.url),
      hasDirectPath: Boolean(documentMeta.directPath),
    });
    const result = await this.execute(
      `UPDATE channel_messages
       SET metadata = jsonb_set(
         metadata,
         '{document}',
         COALESCE(metadata->'document', '{}'::jsonb) || $2::jsonb
       )
       WHERE id = $1
         AND (metadata->'document'->>'mediaKey' IS NULL OR metadata->'document'->>'mediaKey' = '')`,
      [id, patch]
    );
    return result.changes > 0;
  }

  /**
   * Batch enrich multiple messages with media metadata in a single SQL round-trip.
   * Replaces the N+1 loop of individual enrichMediaMetadata() calls.
   * Uses CTE + VALUES for O(1) DB round-trips instead of O(N).
   */
  async enrichMediaMetadataBatch(
    items: Array<{ id: string; documentMeta: Partial<WhatsAppDocumentMetadata> }>
  ): Promise<number> {
    const filtered = items.filter((item) => item.documentMeta.mediaKey);
    if (filtered.length === 0) return 0;

    const BATCH_SIZE = 500;
    let totalUpdated = 0;

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        const paramIdx = j * 2;
        values.push(`($${paramIdx + 1}, $${paramIdx + 2}::jsonb)`);
        params.push(
          item.id,
          JSON.stringify({
            mediaKey: item.documentMeta.mediaKey,
            directPath: item.documentMeta.directPath ?? null,
            url: item.documentMeta.url ?? null,
            hasMediaKey: true,
            hasUrl: Boolean(item.documentMeta.url),
            hasDirectPath: Boolean(item.documentMeta.directPath),
          })
        );
      }

      const result = await this.execute(
        `WITH batch_updates(id, patch) AS (VALUES ${values.join(', ')})
         UPDATE channel_messages m
         SET metadata = jsonb_set(
           m.metadata,
           '{document}',
           COALESCE(m.metadata->'document', '{}'::jsonb) || b.patch
         )
         FROM batch_updates b
         WHERE m.id = b.id
           AND (m.metadata->'document'->>'mediaKey' IS NULL OR m.metadata->'document'->>'mediaKey' = '')`,
        params
      );
      totalUpdated += result.changes;
    }

    return totalUpdated;
  }

  /**
   * Find messages needing media recovery: have document metadata but missing mediaKey or data.
   * Supports optional date range and group JID filtering.
   */
  async getAttachmentsNeedingRecovery(
    channelId: string,
    opts?: { groupJid?: string; dateFrom?: Date; dateTo?: Date; needsKey?: boolean; needsData?: boolean; limit?: number }
  ): Promise<ChannelMessage[]> {
    const conditions = [`channel_id = $1`, `metadata->'document' IS NOT NULL`];
    const params: unknown[] = [channelId];
    let idx = 2;

    if (opts?.groupJid) {
      conditions.push(`metadata->>'jid' = $${idx}`);
      params.push(opts.groupJid);
      idx++;
    }
    if (opts?.dateFrom) {
      conditions.push(`created_at >= $${idx}`);
      params.push(opts.dateFrom.toISOString());
      idx++;
    }
    if (opts?.dateTo) {
      conditions.push(`created_at <= $${idx}`);
      params.push(opts.dateTo.toISOString());
      idx++;
    }
    if (opts?.needsKey) {
      conditions.push(`(metadata->'document'->>'mediaKey' IS NULL OR metadata->'document'->>'mediaKey' = '')`);
    }
    if (opts?.needsData) {
      // Note: checks only first attachment (index 0) — WhatsApp documents are single-attachment
      conditions.push(`(attachments->0->>'data' IS NULL OR attachments->0->>'data' = '')`);
    }

    const queryLimit = opts?.limit ? Math.min(opts.limit, 1000) : 1000;
    const rows = await this.query<ChannelMessageRow>(
      `SELECT * FROM channel_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT ${queryLimit}`,
      params
    );
    return rows.map((r) => rowToChannelMessage(r));
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

  /**
   * Get distinct chats (by JID) for a channel, with message count and last activity.
   * Groups on metadata->>'jid' to unify DM and group conversations.
   */
  async getDistinctChats(
    channelId: string,
    limit = 20,
    offset = 0
  ): Promise<{
    chats: Array<{
      id: string;
      displayName: string | null;
      platform: string;
      messageCount: number;
      lastMessageAt: string;
      isGroup?: boolean;
    }>;
    total: number;
  }> {
    const rows = await this.query<{
      chat_jid: string;
      display_name: string | null;
      is_group: string | null;
      message_count: string;
      last_message_at: string;
      total_count: string;
    }>(
      `SELECT
         g.chat_jid,
         (SELECT m2.sender_name FROM channel_messages m2
          WHERE m2.metadata->>'jid' = g.chat_jid
            AND m2.channel_id = $1
          ORDER BY m2.created_at DESC LIMIT 1) AS display_name,
         g.is_group,
         g.message_count,
         g.last_message_at,
         g.total_count
       FROM (
         SELECT
           metadata->>'jid'     AS chat_jid,
           MAX(metadata->>'isGroup') AS is_group,
           COUNT(*)              AS message_count,
           MAX(created_at)       AS last_message_at,
           COUNT(*) OVER()       AS total_count
         FROM channel_messages
         WHERE channel_id = $1
           AND direction = 'inbound'
           AND metadata->>'jid' IS NOT NULL
         GROUP BY metadata->>'jid'
         ORDER BY last_message_at DESC
         LIMIT $2 OFFSET $3
       ) g`,
      [channelId, limit, offset]
    );

    const platform = channelId.includes('.') ? channelId.split('.').pop() ?? channelId : channelId;
    const total = rows.length > 0 ? parseInt(rows[0]!.total_count, 10) : 0;

    return {
      chats: rows.map((r) => ({
        id: r.chat_jid,
        displayName: r.display_name ?? null,
        platform,
        messageCount: parseInt(r.message_count, 10),
        lastMessageAt: r.last_message_at,
        isGroup: r.is_group === 'true',
      })),
      total,
    };
  }

  /**
   * Get messages for a specific chat (group or DM) by JID.
   * Filters on metadata->>'jid' which stores the full chat JID
   * (e.g., "120363xxx@g.us" for groups, "316xxx@s.whatsapp.net" for DMs).
   */
  async getByChat(
    channelId: string,
    chatJid: string,
    limit = 50,
    offset = 0
  ): Promise<{ messages: ChannelMessage[]; total: number }> {
    const rows = await this.query<ChannelMessageRow & { total_count: string }>(
      `SELECT
         *,
         COUNT(*) OVER() AS total_count
       FROM channel_messages
       WHERE channel_id = $1
         AND metadata->>'jid' = $2
       ORDER BY created_at ASC
       LIMIT $3 OFFSET $4`,
      [channelId, chatJid, limit, offset]
    );

    const total = rows.length > 0 ? parseInt(rows[0]!.total_count, 10) : 0;

    return {
      messages: rows.map((r) => rowToChannelMessage(r)),
      total,
    };
  }

  /**
   * Get the latest message for a specific chat JID in a channel.
   * Useful as an anchor when requesting additional history from the provider.
   */
  async getLatestByChat(channelId: string, chatJid: string): Promise<ChannelMessage | null> {
    const row = await this.queryOne<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE channel_id = $1
         AND metadata->>'jid' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [channelId, chatJid]
    );
    return row ? rowToChannelMessage(row) : null;
  }

  /**
   * Get the oldest message for a specific chat JID in a channel.
   * Useful as an "oldest known" anchor for provider-side history backfill requests.
   */
  async getOldestByChat(channelId: string, chatJid: string): Promise<ChannelMessage | null> {
    const row = await this.queryOne<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE channel_id = $1
         AND metadata->>'jid' = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [channelId, chatJid]
    );
    return row ? rowToChannelMessage(row) : null;
  }

  /**
   * Get the earliest message strictly newer than a timestamp for a chat.
   * Useful when an API expects an "oldest known" anchor and we want to
   * include a specific older target message in the returned history window.
   */
  async getNextByChatAfter(
    channelId: string,
    chatJid: string,
    createdAfter: Date
  ): Promise<ChannelMessage | null> {
    const row = await this.queryOne<ChannelMessageRow>(
      `SELECT * FROM channel_messages
       WHERE channel_id = $1
         AND metadata->>'jid' = $2
         AND created_at > $3
       ORDER BY created_at ASC
       LIMIT 1`,
      [channelId, chatJid, createdAfter.toISOString()]
    );
    return row ? rowToChannelMessage(row) : null;
  }

  /**
   * Batch insert messages with deduplication (ON CONFLICT DO NOTHING).
   * Used for history sync — processes in chunks of 100 for memory safety.
   */
  async createBatch(rows: Array<{
    id: string;
    channelId: string;
    externalId?: string;
    direction: ChannelMessage['direction'];
    senderId?: string;
    senderName?: string;
    content: string;
    contentType?: string;
    attachments?: ChannelMessageAttachmentInput[];
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  }>): Promise<number> {
    if (rows.length === 0) return 0;
    let inserted = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await this.transaction(async () => {
        for (const data of batch) {
          try {
            const serialized = data.attachments ? serializeAttachments(data.attachments) : null;
            const result = await this.execute(
              `INSERT INTO channel_messages (
                id, channel_id, external_id, direction, sender_id, sender_name,
                content, content_type, attachments, metadata, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO NOTHING`,
              [
                data.id,
                data.channelId,
                data.externalId ?? null,
                data.direction,
                data.senderId ?? null,
                data.senderName ?? null,
                data.content,
                data.contentType ?? 'text',
                serialized ? JSON.stringify(serialized) : null,
                JSON.stringify(data.metadata ?? {}),
                data.createdAt ? data.createdAt.toISOString() : new Date().toISOString(),
              ]
            );
            if (result.changes > 0) {
              inserted++;
              continue;
            }

            // Conflict path: if row already exists with missing attachment binary,
            // repair it using the fresh attachment payload from history sync.
            if (serialized && serialized.length > 0) {
              const repaired = await this.repairMissingAttachmentData(data.id, serialized);
              if (repaired) inserted++;
            }
          } catch (err) {
            // ON CONFLICT DO NOTHING won't throw — this catches real DB errors
            console.warn('[createBatch] Row insert failed:', { id: data.id, error: String(err) });
          }
        }
      });
      // Yield event loop between batches (WAHA pattern)
      if (i + BATCH_SIZE < rows.length) {
        await new Promise(r => setTimeout(r, 1));
      }
    }
    return inserted;
  }

  /**
   * Fill missing attachment.data for an existing row when a duplicate message arrives
   * with binary payload (history re-sync, retry, etc.).
   */
  private async repairMissingAttachmentData(
    id: string,
    incoming: ChannelMessageAttachment[]
  ): Promise<boolean> {
    const incomingHasBinary = incoming.some((a) => typeof a.data === 'string' && a.data.length > 0);
    if (!incomingHasBinary) return false;

    const existing = await this.getById(id);
    if (!existing?.attachments || existing.attachments.length === 0) return false;

    const merged: ChannelMessageAttachment[] = [];
    const maxLen = Math.max(existing.attachments.length, incoming.length);
    let changed = false;

    for (let index = 0; index < maxLen; index++) {
      const current = existing.attachments[index];
      const next = incoming[index];

      if (!current && next) {
        const hasData = typeof next.data === 'string' && next.data.length > 0;
        merged.push(next);
        if (hasData) changed = true;
        continue;
      }

      if (!current) continue;
      if (!next) {
        merged.push(current);
        continue;
      }

      const currentMissing = !current.data || current.data.length === 0;
      const nextHasData = typeof next.data === 'string' && next.data.length > 0;

      if (currentMissing && nextHasData) {
        changed = true;
        merged.push({
          ...current,
          type: next.type ?? current.type,
          url: next.url ?? current.url,
          name: next.name ?? current.name,
          mimeType: next.mimeType ?? current.mimeType,
          filename: next.filename ?? current.filename,
          size: next.size ?? current.size,
          data: next.data,
        });
      } else {
        merged.push(current);
      }
    }

    if (!changed) return false;

    const result = await this.execute(
      `UPDATE channel_messages SET attachments = $1 WHERE id = $2`,
      [JSON.stringify(merged), id]
    );
    return result.changes > 0;
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

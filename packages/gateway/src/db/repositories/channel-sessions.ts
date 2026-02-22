/**
 * Channel Sessions Repository (PostgreSQL)
 *
 * Tracks per-channel conversation state. Each session links
 * a channel user + plugin + chat to an OwnPilot conversation.
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository, parseJsonField } from './base.js';

// ============================================================================
// Entity Types
// ============================================================================

export interface ChannelSessionEntity {
  id: string;
  channelUserId: string;
  channelPluginId: string;
  platformChatId: string;
  conversationId: string | null;
  isActive: boolean;
  context: Record<string, unknown>;
  createdAt: Date;
  lastMessageAt: Date | null;
}

export interface CreateChannelSessionInput {
  channelUserId: string;
  channelPluginId: string;
  platformChatId: string;
  conversationId?: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Row Type
// ============================================================================

interface ChannelSessionRow {
  id: string;
  channel_user_id: string;
  channel_plugin_id: string;
  platform_chat_id: string;
  conversation_id: string | null;
  is_active: boolean;
  context: string | Record<string, unknown>;
  created_at: string;
  last_message_at: string | null;
}

function rowToEntity(row: ChannelSessionRow): ChannelSessionEntity {
  return {
    id: row.id,
    channelUserId: row.channel_user_id,
    channelPluginId: row.channel_plugin_id,
    platformChatId: row.platform_chat_id,
    conversationId: row.conversation_id,
    isActive: row.is_active,
    context: parseJsonField(row.context, {}),
    createdAt: new Date(row.created_at),
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ChannelSessionsRepository extends BaseRepository {
  /**
   * Find the active session for a user on a specific channel plugin + chat.
   */
  async findActive(
    channelUserId: string,
    channelPluginId: string,
    platformChatId: string
  ): Promise<ChannelSessionEntity | null> {
    const row = await this.queryOne<ChannelSessionRow>(
      `SELECT * FROM channel_sessions
       WHERE channel_user_id = $1 AND channel_plugin_id = $2
         AND platform_chat_id = $3 AND is_active = TRUE`,
      [channelUserId, channelPluginId, platformChatId]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Get by ID.
   */
  async getById(id: string): Promise<ChannelSessionEntity | null> {
    const row = await this.queryOne<ChannelSessionRow>(
      `SELECT * FROM channel_sessions WHERE id = $1`,
      [id]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Find by conversation ID.
   */
  async findByConversation(conversationId: string): Promise<ChannelSessionEntity | null> {
    const row = await this.queryOne<ChannelSessionRow>(
      `SELECT * FROM channel_sessions
       WHERE conversation_id = $1 AND is_active = TRUE
       ORDER BY last_message_at DESC`,
      [conversationId]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Create a new session.
   */
  async create(input: CreateChannelSessionInput): Promise<ChannelSessionEntity> {
    const id = randomUUID();
    await this.execute(
      `INSERT INTO channel_sessions (id, channel_user_id, channel_plugin_id, platform_chat_id, conversation_id, context)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.channelUserId,
        input.channelPluginId,
        input.platformChatId,
        input.conversationId ?? null,
        JSON.stringify(input.context ?? {}),
      ]
    );
    const result = await this.getById(id);
    if (!result) throw new Error('Failed to create channel session');
    return result;
  }

  /**
   * Find or create an active session.
   * Uses find-then-create with retry to handle concurrent requests safely.
   */
  async findOrCreate(input: CreateChannelSessionInput): Promise<ChannelSessionEntity> {
    const existing = await this.findActive(
      input.channelUserId,
      input.channelPluginId,
      input.platformChatId
    );
    if (existing) return existing;

    try {
      return await this.create(input);
    } catch {
      // Concurrent insert may have succeeded — retry lookup
      const retried = await this.findActive(
        input.channelUserId,
        input.channelPluginId,
        input.platformChatId
      );
      if (retried) return retried;
      throw new Error('Failed to find or create channel session');
    }
  }

  /**
   * Update the conversation link for a session.
   */
  async linkConversation(sessionId: string, conversationId: string): Promise<void> {
    await this.execute(`UPDATE channel_sessions SET conversation_id = $1 WHERE id = $2`, [
      conversationId,
      sessionId,
    ]);
  }

  /**
   * Touch last_message_at.
   */
  async touchLastMessage(sessionId: string): Promise<void> {
    await this.execute(`UPDATE channel_sessions SET last_message_at = NOW() WHERE id = $1`, [
      sessionId,
    ]);
  }

  /**
   * Deactivate a session.
   */
  async deactivate(sessionId: string): Promise<void> {
    await this.execute(`UPDATE channel_sessions SET is_active = FALSE WHERE id = $1`, [sessionId]);
  }

  /**
   * List all active sessions for a channel user.
   */
  async listByUser(channelUserId: string): Promise<ChannelSessionEntity[]> {
    const rows = await this.query<ChannelSessionRow>(
      `SELECT * FROM channel_sessions
       WHERE channel_user_id = $1 AND is_active = TRUE
       ORDER BY last_message_at DESC NULLS LAST`,
      [channelUserId]
    );
    return rows.map(rowToEntity);
  }

  /**
   * Merge key-value pairs into the session context (JSONB).
   */
  async updateContext(sessionId: string, context: Record<string, unknown>): Promise<void> {
    await this.execute(`UPDATE channel_sessions SET context = context || $1::jsonb WHERE id = $2`, [
      JSON.stringify(context),
      sessionId,
    ]);
  }

  /**
   * Delete a session.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM channel_sessions WHERE id = $1`, [id]);
    return result.changes > 0;
  }

  /**
   * Cleanup old inactive sessions (or sessions with no activity beyond maxAgeDays).
   * Returns the number of deleted sessions.
   */
  async cleanupOld(maxAgeDays = 90): Promise<number> {
    const result = await this.execute(
      `DELETE FROM channel_sessions
       WHERE is_active = FALSE
          OR (last_message_at IS NOT NULL AND last_message_at < NOW() - INTERVAL '1 day' * $1)
          OR (last_message_at IS NULL AND created_at < NOW() - INTERVAL '1 day' * $1)`,
      [maxAgeDays]
    );
    return result.changes;
  }
}

// Singleton + factory
export const channelSessionsRepo = new ChannelSessionsRepository();

export function createChannelSessionsRepository(): ChannelSessionsRepository {
  return new ChannelSessionsRepository();
}

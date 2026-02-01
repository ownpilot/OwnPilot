/**
 * Channel Users Repository (PostgreSQL)
 *
 * Maps platform identities (Telegram user, Discord user, etc.)
 * to OwnPilot user IDs for cross-channel identity.
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository } from './base.js';

// ============================================================================
// Entity Types
// ============================================================================

export interface ChannelUserEntity {
  id: string;
  ownpilotUserId: string;
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  avatarUrl?: string;
  isVerified: boolean;
  verifiedAt?: Date;
  verificationMethod?: 'pin' | 'oauth' | 'whitelist' | 'admin';
  isBlocked: boolean;
  metadata: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface CreateChannelUserInput {
  ownpilotUserId?: string;
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Row Type (DB representation)
// ============================================================================

interface ChannelUserRow {
  id: string;
  ownpilot_user_id: string;
  platform: string;
  platform_user_id: string;
  platform_username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verification_method: string | null;
  is_blocked: boolean;
  metadata: string | Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
}

function rowToEntity(row: ChannelUserRow): ChannelUserEntity {
  return {
    id: row.id,
    ownpilotUserId: row.ownpilot_user_id,
    platform: row.platform,
    platformUserId: row.platform_user_id,
    platformUsername: row.platform_username ?? undefined,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    isVerified: row.is_verified,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
    verificationMethod: row.verification_method as ChannelUserEntity['verificationMethod'],
    isBlocked: row.is_blocked,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata || '{}')
        : (row.metadata || {}),
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ChannelUsersRepository extends BaseRepository {
  /**
   * Find a channel user by platform + platform user ID.
   */
  async findByPlatform(
    platform: string,
    platformUserId: string
  ): Promise<ChannelUserEntity | null> {
    const row = await this.queryOne<ChannelUserRow>(
      `SELECT * FROM channel_users WHERE platform = $1 AND platform_user_id = $2`,
      [platform, platformUserId]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Find all channel users linked to an OwnPilot user.
   */
  async findByOwnpilotUser(ownpilotUserId: string): Promise<ChannelUserEntity[]> {
    const rows = await this.query<ChannelUserRow>(
      `SELECT * FROM channel_users WHERE ownpilot_user_id = $1 ORDER BY last_seen_at DESC`,
      [ownpilotUserId]
    );
    return rows.map(rowToEntity);
  }

  /**
   * Get by ID.
   */
  async getById(id: string): Promise<ChannelUserEntity | null> {
    const row = await this.queryOne<ChannelUserRow>(
      `SELECT * FROM channel_users WHERE id = $1`,
      [id]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Create a new channel user (first seen on a platform).
   */
  async create(input: CreateChannelUserInput): Promise<ChannelUserEntity> {
    const id = randomUUID();
    await this.execute(
      `INSERT INTO channel_users (id, ownpilot_user_id, platform, platform_user_id, platform_username, display_name, avatar_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.ownpilotUserId ?? 'default',
        input.platform,
        input.platformUserId,
        input.platformUsername ?? null,
        input.displayName ?? null,
        input.avatarUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    const result = await this.getById(id);
    if (!result) throw new Error('Failed to create channel user');
    return result;
  }

  /**
   * Find or create a channel user. Updates last_seen_at and display info on find.
   */
  async findOrCreate(input: CreateChannelUserInput): Promise<ChannelUserEntity> {
    const existing = await this.findByPlatform(input.platform, input.platformUserId);
    if (existing) {
      // Update last seen and display info
      await this.execute(
        `UPDATE channel_users SET last_seen_at = NOW(),
          display_name = COALESCE($1, display_name),
          platform_username = COALESCE($2, platform_username),
          avatar_url = COALESCE($3, avatar_url)
         WHERE id = $4`,
        [
          input.displayName ?? null,
          input.platformUsername ?? null,
          input.avatarUrl ?? null,
          existing.id,
        ]
      );
      return { ...existing, lastSeenAt: new Date() };
    }
    return this.create(input);
  }

  /**
   * Mark a channel user as verified.
   */
  async markVerified(
    id: string,
    ownpilotUserId: string,
    method: ChannelUserEntity['verificationMethod']
  ): Promise<void> {
    await this.execute(
      `UPDATE channel_users SET is_verified = TRUE, verified_at = NOW(),
        verification_method = $1, ownpilot_user_id = $2
       WHERE id = $3`,
      [method, ownpilotUserId, id]
    );
  }

  /**
   * Block a channel user.
   */
  async block(id: string): Promise<void> {
    await this.execute(
      `UPDATE channel_users SET is_blocked = TRUE WHERE id = $1`,
      [id]
    );
  }

  /**
   * Unblock a channel user.
   */
  async unblock(id: string): Promise<void> {
    await this.execute(
      `UPDATE channel_users SET is_blocked = FALSE WHERE id = $1`,
      [id]
    );
  }

  /**
   * List all channel users, optionally filtered.
   */
  async list(options?: {
    platform?: string;
    isVerified?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ChannelUserEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.platform) {
      conditions.push(`platform = $${paramIndex++}`);
      params.push(options.platform);
    }
    if (options?.isVerified !== undefined) {
      conditions.push(`is_verified = $${paramIndex++}`);
      params.push(options.isVerified);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = await this.query<ChannelUserRow>(
      `SELECT * FROM channel_users ${where} ORDER BY last_seen_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );
    return rows.map(rowToEntity);
  }

  /**
   * Delete a channel user.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM channel_users WHERE id = $1`,
      [id]
    );
    return result.changes > 0;
  }
}

// Singleton + factory
export const channelUsersRepo = new ChannelUsersRepository();

export function createChannelUsersRepository(): ChannelUsersRepository {
  return new ChannelUsersRepository();
}

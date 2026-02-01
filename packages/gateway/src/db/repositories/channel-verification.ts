/**
 * Channel Verification Tokens Repository (PostgreSQL)
 *
 * Manages PIN/token-based verification for channel users.
 * Tokens are generated in the UI and consumed via /connect commands
 * on channel platforms.
 */

import { randomUUID, randomInt } from 'node:crypto';
import { BaseRepository } from './base.js';

// ============================================================================
// Entity Types
// ============================================================================

export interface ChannelVerificationTokenEntity {
  id: string;
  ownpilotUserId: string;
  token: string;
  platform: string | null;
  expiresAt: Date;
  isUsed: boolean;
  usedByChannelUserId: string | null;
  createdAt: Date;
  usedAt: Date | null;
}

// ============================================================================
// Row Type
// ============================================================================

interface TokenRow {
  id: string;
  ownpilot_user_id: string;
  token: string;
  platform: string | null;
  expires_at: string;
  is_used: boolean;
  used_by_channel_user_id: string | null;
  created_at: string;
  used_at: string | null;
}

function rowToEntity(row: TokenRow): ChannelVerificationTokenEntity {
  return {
    id: row.id,
    ownpilotUserId: row.ownpilot_user_id,
    token: row.token,
    platform: row.platform,
    expiresAt: new Date(row.expires_at),
    isUsed: row.is_used,
    usedByChannelUserId: row.used_by_channel_user_id,
    createdAt: new Date(row.created_at),
    usedAt: row.used_at ? new Date(row.used_at) : null,
  };
}

// ============================================================================
// Token Generation
// ============================================================================

/** Generate a 6-digit numeric PIN. */
function generatePin(): string {
  return String(randomInt(100000, 999999));
}

/** Generate a short alphanumeric token. */
function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I/L)
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars[randomInt(0, chars.length)];
  }
  return token;
}

// ============================================================================
// Repository
// ============================================================================

export class ChannelVerificationRepository extends BaseRepository {
  /**
   * Generate a new verification token.
   */
  async generateToken(
    ownpilotUserId: string,
    options?: {
      platform?: string;
      ttlMinutes?: number;
      type?: 'pin' | 'token';
    }
  ): Promise<{ token: string; expiresAt: Date }> {
    const id = randomUUID();
    const token = options?.type === 'token' ? generateToken() : generatePin();
    const ttlMinutes = options?.ttlMinutes ?? 15;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.execute(
      `INSERT INTO channel_verification_tokens (id, ownpilot_user_id, token, platform, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, ownpilotUserId, token, options?.platform ?? null, expiresAt.toISOString()]
    );

    return { token, expiresAt };
  }

  /**
   * Look up a valid (not expired, not used) token.
   */
  async findValidToken(
    token: string,
    platform?: string
  ): Promise<ChannelVerificationTokenEntity | null> {
    const row = await this.queryOne<TokenRow>(
      `SELECT * FROM channel_verification_tokens
       WHERE token = $1 AND is_used = FALSE AND expires_at > NOW()
         AND (platform IS NULL OR platform = $2)`,
      [token, platform ?? null]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Consume a token (mark as used).
   */
  async consumeToken(tokenId: string, channelUserId: string): Promise<void> {
    await this.execute(
      `UPDATE channel_verification_tokens
       SET is_used = TRUE, used_at = NOW(), used_by_channel_user_id = $1
       WHERE id = $2`,
      [channelUserId, tokenId]
    );
  }

  /**
   * Clean up expired tokens.
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.execute(
      `DELETE FROM channel_verification_tokens WHERE expires_at < NOW() AND is_used = FALSE`
    );
    return result.changes;
  }

  /**
   * List active tokens for a user.
   */
  async listByUser(ownpilotUserId: string): Promise<ChannelVerificationTokenEntity[]> {
    const rows = await this.query<TokenRow>(
      `SELECT * FROM channel_verification_tokens
       WHERE ownpilot_user_id = $1 AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [ownpilotUserId]
    );
    return rows.map(rowToEntity);
  }

  /**
   * Revoke all active tokens for a user.
   */
  async revokeAll(ownpilotUserId: string): Promise<number> {
    const result = await this.execute(
      `DELETE FROM channel_verification_tokens
       WHERE ownpilot_user_id = $1 AND is_used = FALSE`,
      [ownpilotUserId]
    );
    return result.changes;
  }
}

// Singleton + factory
export const channelVerificationRepo = new ChannelVerificationRepository();

export function createChannelVerificationRepository(): ChannelVerificationRepository {
  return new ChannelVerificationRepository();
}

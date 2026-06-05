/**
 * DM Pairing Requests Repository (PostgreSQL)
 *
 * Manages pending 6-digit pairing codes for non-owner DM senders.
 * When a DM arrives from a non-owner who is not yet pending approval,
 * a code is generated and stored here. The owner approves via dashboard
 * which marks the code as used and marks the user as active.
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository } from '../base.js';

// ============================================================================
// Entity Types
// ============================================================================

interface DmPairingRequestEntity {
  id: string;
  platform: string;
  platformUserId: string;
  code: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt?: Date;
}

interface CreateDmPairingRequestInput {
  platform: string;
  platformUserId: string;
  code: string;
  expiresInMinutes?: number;
}

// ============================================================================
// Row Type (DB representation)
// ============================================================================

interface DmPairingRequestRow {
  id: string;
  platform: string;
  platform_user_id: string;
  code: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

function rowToEntity(row: DmPairingRequestRow): DmPairingRequestEntity {
  return {
    id: row.id,
    platform: row.platform,
    platformUserId: row.platform_user_id,
    code: row.code,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    usedAt: row.used_at ? new Date(row.used_at) : undefined,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class DmPairingRequestsRepository extends BaseRepository {
  /**
   * Create a pending pairing code for a platform+user pair.
   * Replaces any existing pending code for the same platform+user.
   */
  async create(input: CreateDmPairingRequestInput): Promise<DmPairingRequestEntity> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 10) * 60 * 1000);

    // Delete any existing pending codes for this platform+user
    await this.execute(
      `DELETE FROM dm_pairing_requests
       WHERE platform = $1 AND platform_user_id = $2 AND used_at IS NULL`,
      [input.platform, input.platformUserId]
    );

    await this.execute(
      `INSERT INTO dm_pairing_requests (id, platform, platform_user_id, code, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.platform, input.platformUserId, input.code, expiresAt.toISOString()]
    );

    const result = await this.getById(id);
    if (!result) throw new Error('Failed to create DM pairing request');
    return result;
  }

  /**
   * Get by ID.
   */
  async getById(id: string): Promise<DmPairingRequestEntity | null> {
    const row = await this.queryOne<DmPairingRequestRow>(
      `SELECT * FROM dm_pairing_requests WHERE id = $1`,
      [id]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Find a valid (non-expired, unused) code for a platform+user.
   */
  async findValidToken(
    platform: string,
    platformUserId: string
  ): Promise<DmPairingRequestEntity | null> {
    const row = await this.queryOne<DmPairingRequestRow>(
      `SELECT * FROM dm_pairing_requests
       WHERE platform = $1 AND platform_user_id = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [platform, platformUserId]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Find a valid token by code + platform.
   */
  async findByCode(code: string, platform: string): Promise<DmPairingRequestEntity | null> {
    const row = await this.queryOne<DmPairingRequestRow>(
      `SELECT * FROM dm_pairing_requests
       WHERE code = $1 AND platform = $2
         AND used_at IS NULL
         AND expires_at > NOW()`,
      [code, platform]
    );
    return row ? rowToEntity(row) : null;
  }

  /**
   * Mark a token as used.
   */
  async markUsed(id: string): Promise<void> {
    await this.execute(`UPDATE dm_pairing_requests SET used_at = NOW() WHERE id = $1`, [id]);
  }

  /**
   * Clean up expired tokens (called periodically).
   */
  async deleteExpired(): Promise<number> {
    const result = await this.execute(`DELETE FROM dm_pairing_requests WHERE expires_at < NOW()`);
    return result.changes ?? 0;
  }

  /**
   * List all pending tokens for a platform.
   */
  async listPending(platform?: string): Promise<DmPairingRequestEntity[]> {
    const sql = `SELECT * FROM dm_pairing_requests
      WHERE used_at IS NULL AND expires_at > NOW()
      ${platform ? ' AND platform = $1' : ''}
      ORDER BY created_at DESC`;
    const rows = await this.query<DmPairingRequestRow>(sql, platform ? [platform] : []);
    return rows.map(rowToEntity);
  }
}

export const dmPairingRequestsRepo = new DmPairingRequestsRepository();

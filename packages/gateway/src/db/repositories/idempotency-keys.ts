/**
 * Idempotency Keys Repository
 *
 * Manages API-level idempotency for duplicate request handling.
 * Keys expire after 24 hours to keep the table bounded.
 */

import { BaseRepository } from './base.js';

const TABLE = 'idempotency_keys';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface IdempotencyRecord {
  key: string;
  result: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export class IdempotencyKeysRepository extends BaseRepository {
  /**
   * Get the cached result for an idempotency key if it exists and is not expired.
   * Returns null if the key does not exist or has expired.
   */
  async getRecord(key: string): Promise<IdempotencyRecord | null> {
    const sql = `
      SELECT key, result, created_at, expires_at
      FROM ${TABLE}
      WHERE key = $1 AND expires_at > NOW()
    `;
    const rows = await this.query<{
      key: string;
      result: unknown;
      created_at: Date;
      expires_at: Date;
    }>(sql, [key]);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      key: row.key,
      result: row.result,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Store a result for an idempotency key with a TTL.
   */
  async setRecord(key: string, result: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const sql = `
      INSERT INTO ${TABLE} (key, result, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '${Math.round(ttlMs)} milliseconds')
      ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at
    `;
    await this.execute(sql, [key, JSON.stringify(result)]);
  }

  /**
   * Delete an idempotency key.
   */
  async deleteKey(key: string): Promise<void> {
    await this.execute(`DELETE FROM ${TABLE} WHERE key = $1`, [key]);
  }

  /**
   * Purge all expired idempotency keys.
   * Called periodically to keep the table bounded.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.execute(`DELETE FROM ${TABLE} WHERE expires_at <= NOW()`);
    return result.changes;
  }

  /**
   * Get the count of active (non-expired) idempotency keys.
   */
  async countActive(): Promise<number> {
    const rows = await this.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${TABLE} WHERE expires_at > NOW()`
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}

// Singleton
let _repo: IdempotencyKeysRepository | null = null;

export function getIdempotencyKeysRepository(): IdempotencyKeysRepository {
  if (!_repo) _repo = new IdempotencyKeysRepository();
  return _repo;
}
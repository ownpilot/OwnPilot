/**
 * Embedding Cache Repository
 *
 * LRU cache for embedding vectors. Avoids redundant API calls
 * by storing SHA-256 content hashes mapped to embedding vectors.
 */

import { createHash } from 'node:crypto';
import { BaseRepository } from './base.js';
import { getLog } from '../../services/log.js';
import { EMBEDDING_CACHE_EVICTION_DAYS } from '../../config/defaults.js';

const log = getLog('EmbeddingCache');

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingCacheEntry {
  id: string;
  contentHash: string;
  modelName: string;
  embedding: number[];
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
}

interface EmbeddingCacheRow {
  id: string;
  content_hash: string;
  model_name: string;
  embedding: number[] | string;
  created_at: string;
  last_used_at: string;
  use_count: number;
}

// ============================================================================
// Repository
// ============================================================================

export class EmbeddingCacheRepository extends BaseRepository {
  /**
   * Generate SHA-256 hash for content normalization.
   */
  static contentHash(text: string): string {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  /**
   * Look up a cached embedding by content hash + model.
   * Updates last_used_at and use_count on hit (fire-and-forget).
   */
  async lookup(
    contentHash: string,
    modelName = 'text-embedding-3-small',
  ): Promise<number[] | null> {
    const row = await this.queryOne<EmbeddingCacheRow>(
      `SELECT * FROM embedding_cache
       WHERE content_hash = $1 AND model_name = $2`,
      [contentHash, modelName],
    );
    if (!row) return null;

    // Touch (fire-and-forget)
    this.execute(
      `UPDATE embedding_cache
       SET last_used_at = NOW(), use_count = use_count + 1
       WHERE id = $1`,
      [row.id],
    ).catch(() => {});

    return parseEmbedding(row.embedding);
  }

  /**
   * Store a new embedding in the cache.
   * On conflict (same hash+model), just touch the existing entry.
   */
  async store(
    contentHash: string,
    modelName: string,
    embedding: number[],
  ): Promise<void> {
    const id = crypto.randomUUID();
    await this.execute(
      `INSERT INTO embedding_cache (id, content_hash, model_name, embedding, created_at, last_used_at, use_count)
       VALUES ($1, $2, $3, $4::vector, NOW(), NOW(), 1)
       ON CONFLICT (content_hash, model_name) DO UPDATE SET
         last_used_at = NOW(),
         use_count = embedding_cache.use_count + 1`,
      [id, contentHash, modelName, JSON.stringify(embedding)],
    );
  }

  /**
   * LRU eviction: delete entries not used in the last N days.
   */
  async evict(daysUnused: number = EMBEDDING_CACHE_EVICTION_DAYS): Promise<number> {
    const result = await this.execute(
      `DELETE FROM embedding_cache
       WHERE last_used_at < NOW() - ($1 || ' days')::INTERVAL`,
      [daysUnused],
    );
    if (result.changes > 0) {
      log.info(`Evicted ${result.changes} stale embedding cache entries`);
    }
    return result.changes;
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<{ total: number; totalHits: number }> {
    const row = await this.queryOne<{ total: string; total_hits: string }>(
      `SELECT COUNT(*) as total, COALESCE(SUM(use_count), 0) as total_hits
       FROM embedding_cache`,
    );
    return {
      total: Number(row?.total ?? 0),
      totalHits: Number(row?.total_hits ?? 0),
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseEmbedding(value: number[] | string): number[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

// ============================================================================
// Singleton
// ============================================================================

export const embeddingCacheRepo = new EmbeddingCacheRepository();

/**
 * Memories Repository
 *
 * Persistent memory storage for the autonomous AI assistant.
 * Stores facts, preferences, conversation summaries, and events.
 */

import { BaseRepository, parseJsonField } from './base.js';
import type { StandardQuery } from './interfaces.js';
import {
  getEventBus,
  createEvent,
  EventTypes,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import { RRF_K } from '../../config/defaults.js';

export type MemoryType = 'fact' | 'preference' | 'conversation' | 'event' | 'skill';
export type MatchType = 'hybrid' | 'vector' | 'fts' | 'keyword';

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  source?: string;
  sourceId?: string;
  importance: number;
  tags: string[];
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  embedding?: number[];
  source?: string;
  sourceId?: string;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryInput {
  content?: string;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery extends StandardQuery {
  type?: MemoryType;
  types?: MemoryType[];
  minImportance?: number;
  tags?: string[];
  source?: string;
  orderBy?: 'importance' | 'created' | 'accessed' | 'relevance';
}

interface MemoryRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  embedding: number[] | string | null;
  search_vector: string | null; // tsvector — populated by trigger, not read in app
  source: string | null;
  source_id: string | null;
  importance: number;
  tags: string;
  accessed_count: number;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
  metadata: string;
}

function parseEmbedding(value: number[] | string | null): number[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  // pgvector may return string format "[0.1,0.2,...]" if types not registered
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as MemoryType,
    content: row.content,
    embedding: parseEmbedding(row.embedding),
    source: row.source ?? undefined,
    sourceId: row.source_id ?? undefined,
    importance: row.importance,
    tags: parseJsonField<string[]>(row.tags, []),
    accessCount: row.accessed_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastAccessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
  };
}

export class MemoriesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  /**
   * Get a memory by ID (standard interface alias)
   */
  async getById(id: string): Promise<Memory | null> {
    return this.get(id, false);
  }

  /**
   * Create a new memory
   */
  async create(input: CreateMemoryInput): Promise<Memory> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `
      INSERT INTO memories (id, user_id, type, content, embedding, source, source_id, importance, tags, accessed_count, created_at, updated_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12)
    `,
      [
        id,
        this.userId,
        input.type,
        input.content,
        input.embedding ? JSON.stringify(input.embedding) : null,
        input.source ?? null,
        input.sourceId ?? null,
        input.importance ?? 0.5,
        JSON.stringify(input.tags ?? []),
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    const memory = await this.get(id);
    if (!memory) throw new Error('Failed to create memory');

    getEventBus().emit(
      createEvent<ResourceCreatedData>(
        EventTypes.RESOURCE_CREATED,
        'resource',
        'memories-repository',
        { resourceType: 'memory', id }
      )
    );

    return memory;
  }

  /**
   * Get a memory by ID (updates accessed timestamp)
   */
  async get(id: string, trackAccess = true): Promise<Memory | null> {
    const row = await this.queryOne<MemoryRow>(
      `SELECT * FROM memories WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );

    if (!row) return null;

    if (trackAccess) {
      await this.trackAccess(id);
    }

    return rowToMemory(row);
  }

  /**
   * Update a memory
   */
  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    const existing = await this.get(id, false);
    if (!existing) return null;

    const now = new Date().toISOString();

    await this.execute(
      `
      UPDATE memories SET
        content = COALESCE($1, content),
        importance = COALESCE($2, importance),
        tags = COALESCE($3, tags),
        metadata = COALESCE($4, metadata),
        updated_at = $5
      WHERE id = $6 AND user_id = $7
    `,
      [
        input.content ?? null,
        input.importance ?? null,
        input.tags ? JSON.stringify(input.tags) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        id,
        this.userId,
      ]
    );

    const updated = await this.get(id, false);

    if (updated) {
      getEventBus().emit(
        createEvent<ResourceUpdatedData>(
          EventTypes.RESOURCE_UPDATED,
          'resource',
          'memories-repository',
          { resourceType: 'memory', id, changes: input }
        )
      );
    }

    return updated;
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM memories WHERE id = $1 AND user_id = $2`, [
      id,
      this.userId,
    ]);
    const deleted = result.changes > 0;

    if (deleted) {
      getEventBus().emit(
        createEvent<ResourceDeletedData>(
          EventTypes.RESOURCE_DELETED,
          'resource',
          'memories-repository',
          { resourceType: 'memory', id }
        )
      );
    }

    return deleted;
  }

  /**
   * Track memory access (updates accessed_at and accessed_count)
   */
  private async trackAccess(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.execute(
      `
      UPDATE memories SET
        accessed_at = $1,
        accessed_count = accessed_count + 1
      WHERE id = $2 AND user_id = $3
    `,
      [now, id, this.userId]
    );
  }

  /**
   * List memories with filters
   */
  async list(query: MemoryQuery = {}): Promise<Memory[]> {
    let sql = `SELECT * FROM memories WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(query.type);
    }

    if (query.types && query.types.length > 0) {
      const placeholders = query.types.map(() => `$${paramIndex++}`).join(', ');
      sql += ` AND type IN (${placeholders})`;
      params.push(...query.types);
    }

    if (query.minImportance !== undefined) {
      sql += ` AND importance >= $${paramIndex++}`;
      params.push(query.minImportance);
    }

    if (query.source) {
      sql += ` AND source = $${paramIndex++}`;
      params.push(query.source);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags ILIKE $${paramIndex++}`;
        params.push(`%"${this.escapeLike(tag)}"%`);
      }
    }

    if (query.search) {
      sql += ` AND content ILIKE $${paramIndex++}`;
      params.push(`%${this.escapeLike(query.search)}%`);
    }

    // Order by
    switch (query.orderBy) {
      case 'importance':
        sql += ` ORDER BY importance DESC, updated_at DESC`;
        break;
      case 'accessed':
        sql += ` ORDER BY accessed_at DESC NULLS LAST, importance DESC`;
        break;
      case 'relevance':
        // For text search, order by importance and recency
        sql += ` ORDER BY importance DESC, accessed_at DESC NULLS LAST`;
        break;
      case 'created':
      default:
        sql += ` ORDER BY created_at DESC`;
        break;
    }

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  }

  /**
   * Search memories by content
   */
  async search(
    query: string,
    options: { type?: MemoryType; limit?: number } = {}
  ): Promise<Memory[]> {
    return this.list({
      search: query,
      type: options.type,
      limit: options.limit ?? 20,
      orderBy: 'relevance',
    });
  }

  /**
   * Get recent memories
   */
  async getRecent(limit = 10, type?: MemoryType): Promise<Memory[]> {
    return this.list({
      type,
      limit,
      orderBy: 'created',
    });
  }

  /**
   * Get important memories (above threshold)
   */
  async getImportant(threshold = 0.7, limit = 20): Promise<Memory[]> {
    return this.list({
      minImportance: threshold,
      limit,
      orderBy: 'importance',
    });
  }

  /**
   * Get frequently accessed memories
   */
  async getFrequentlyAccessed(limit = 10): Promise<Memory[]> {
    const rows = await this.query<MemoryRow>(
      `
      SELECT * FROM memories
      WHERE user_id = $1 AND accessed_count > 0
      ORDER BY accessed_count DESC, importance DESC
      LIMIT $2
    `,
      [this.userId, limit]
    );

    return rows.map(rowToMemory);
  }

  /**
   * Get memories by source (e.g., conversation_id)
   */
  async getBySource(source: string, sourceId?: string): Promise<Memory[]> {
    let sql = `SELECT * FROM memories WHERE user_id = $1 AND source = $2`;
    const params: unknown[] = [this.userId, source];

    if (sourceId) {
      sql += ` AND source_id = $3`;
      params.push(sourceId);
    }

    sql += ` ORDER BY created_at DESC`;

    const rows = await this.query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  }

  /**
   * Decay memory importance over time
   * Memories that have not been accessed recently lose importance
   */
  async decay(options: { daysThreshold?: number; decayFactor?: number } = {}): Promise<number> {
    const daysThreshold = options.daysThreshold ?? 30;
    const decayFactor = options.decayFactor ?? 0.9;

    const result = await this.execute(
      `
      UPDATE memories SET
        importance = importance * $1,
        updated_at = NOW()
      WHERE user_id = $2
        AND importance > 0.1
        AND (accessed_at IS NULL OR accessed_at < NOW() - ($3 || ' days')::INTERVAL)
        AND created_at < NOW() - ($4 || ' days')::INTERVAL
    `,
      [decayFactor, this.userId, daysThreshold, daysThreshold]
    );
    return result.changes;
  }

  /**
   * Clean up low-importance memories
   */
  async cleanup(options: { maxAge?: number; minImportance?: number } = {}): Promise<number> {
    const maxAge = options.maxAge ?? 90; // days
    const minImportance = options.minImportance ?? 0.1;

    const result = await this.execute(
      `
      DELETE FROM memories
      WHERE user_id = $1
        AND importance < $2
        AND created_at < NOW() - ($3 || ' days')::INTERVAL
        AND (accessed_at IS NULL OR accessed_at < NOW() - ($4 || ' days')::INTERVAL)
    `,
      [this.userId, minImportance, maxAge, maxAge]
    );
    return result.changes;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
    recentCount: number;
  }> {
    const typeRows = await this.query<{ type: string; count: number }>(
      `
      SELECT type, COUNT(*) as count FROM memories
      WHERE user_id = $1
      GROUP BY type
    `,
      [this.userId]
    );

    const statsRow = await this.queryOne<{ total: number; avg_importance: number }>(
      `
      SELECT COUNT(*) as total, AVG(importance) as avg_importance
      FROM memories WHERE user_id = $1
    `,
      [this.userId]
    );

    const recentRow = await this.queryOne<{ count: number }>(
      `
      SELECT COUNT(*) as count FROM memories
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    `,
      [this.userId]
    );

    const byType: Record<MemoryType, number> = {
      fact: 0,
      preference: 0,
      conversation: 0,
      event: 0,
      skill: 0,
    };

    for (const row of typeRows) {
      byType[row.type as MemoryType] = Number(row.count);
    }

    return {
      total: Number(statsRow?.total ?? 0),
      byType,
      avgImportance: Number(statsRow?.avg_importance ?? 0),
      recentCount: Number(recentRow?.count ?? 0),
    };
  }

  /**
   * Search memories by embedding similarity using pgvector cosine distance.
   * Returns memories ordered by similarity (closest first).
   */
  async searchByEmbedding(
    embedding: number[],
    options: {
      type?: MemoryType;
      limit?: number;
      threshold?: number;
      minImportance?: number;
    } = {}
  ): Promise<Array<Memory & { similarity: number }>> {
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0.0;

    const conditions: string[] = ['user_id = $1', 'embedding IS NOT NULL'];
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    // Embedding parameter for distance calculation
    const embeddingParamIdx = paramIndex++;
    params.push(JSON.stringify(embedding));

    if (options.type) {
      conditions.push(`type = $${paramIndex}`);
      params.push(options.type);
      paramIndex++;
    }

    if (options.minImportance !== undefined) {
      conditions.push(`importance >= $${paramIndex}`);
      params.push(options.minImportance);
      paramIndex++;
    }

    if (threshold > 0) {
      conditions.push(`(1 - (embedding <=> $${embeddingParamIdx}::vector)) >= $${paramIndex}`);
      params.push(threshold);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT *,
        1 - (embedding <=> $${embeddingParamIdx}::vector) AS similarity
      FROM memories
      WHERE ${whereClause}
      ORDER BY embedding <=> $${embeddingParamIdx}::vector ASC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    const rows = await this.query<MemoryRow & { similarity: number }>(sql, params);
    return rows.map((row) => ({
      ...rowToMemory(row),
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Check if similar memory exists (deduplication).
   * Uses embedding similarity when an embedding is provided,
   * falls back to exact text match otherwise.
   */
  async findSimilar(
    content: string,
    type?: MemoryType,
    embedding?: number[],
    similarityThreshold = 0.95
  ): Promise<Memory | null> {
    // If embedding is provided, try vector similarity first
    if (embedding && embedding.length > 0) {
      const results = await this.searchByEmbedding(embedding, {
        type,
        limit: 1,
        threshold: similarityThreshold,
      });
      if (results.length > 0) {
        return results[0]!;
      }
    }

    // Fallback: exact text match
    let sql = `
      SELECT * FROM memories
      WHERE user_id = $1
        AND content = $2
    `;
    const params: unknown[] = [this.userId, content];

    if (type) {
      sql += ` AND type = $3`;
      params.push(type);
    }

    sql += ` LIMIT 1`;

    const row = await this.queryOne<MemoryRow>(sql, params);
    return row ? rowToMemory(row) : null;
  }

  /**
   * Update the embedding vector for an existing memory (backfill support)
   */
  async updateEmbedding(id: string, embedding: number[]): Promise<boolean> {
    const result = await this.execute(
      `UPDATE memories SET embedding = $1::vector, updated_at = $2
       WHERE id = $3 AND user_id = $4`,
      [JSON.stringify(embedding), new Date().toISOString(), id, this.userId]
    );
    return result.changes > 0;
  }

  /**
   * Boost memory importance (when accessed or reinforced)
   */
  async boost(id: string, amount = 0.1): Promise<Memory | null> {
    const existing = await this.get(id, false);
    if (!existing) return null;

    const newImportance = Math.min(1, existing.importance + amount);
    return this.update(id, { importance: newImportance });
  }

  // --------------------------------------------------------------------------
  // Hybrid Search (FTS + Vector + RRF)
  // --------------------------------------------------------------------------

  /**
   * Full-text search using PostgreSQL tsvector/tsquery.
   * Returns memories with FTS rank score.
   */
  async searchByFTS(
    query: string,
    options: {
      type?: MemoryType;
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<Array<Memory & { ftsRank: number }>> {
    const limit = options.limit ?? 20;
    const conditions: string[] = ['user_id = $1', 'search_vector IS NOT NULL'];
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    // Query parameter for tsquery
    const queryParamIdx = paramIndex++;
    params.push(query);

    if (options.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(options.type);
    }
    if (options.minImportance !== undefined) {
      conditions.push(`importance >= $${paramIndex++}`);
      params.push(options.minImportance);
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT *,
        ts_rank_cd(search_vector, websearch_to_tsquery('english', $${queryParamIdx})) AS fts_rank
      FROM memories
      WHERE ${whereClause}
        AND search_vector @@ websearch_to_tsquery('english', $${queryParamIdx})
      ORDER BY fts_rank DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    const rows = await this.query<MemoryRow & { fts_rank: number }>(sql, params);
    return rows.map((row) => ({
      ...rowToMemory(row),
      ftsRank: Number(row.fts_rank),
    }));
  }

  /**
   * Hybrid search combining vector similarity + full-text search
   * using Reciprocal Rank Fusion (RRF).
   *
   * Falls back gracefully:
   * - If embedding provided: vector + FTS, merged with RRF
   * - If no embedding: FTS only
   * - If no FTS results: ILIKE keyword fallback
   */
  async hybridSearch(
    query: string,
    options: {
      embedding?: number[];
      type?: MemoryType;
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<Array<Memory & { score: number; matchType: MatchType }>> {
    const limit = options.limit ?? 20;
    const k = RRF_K;
    const hasEmbedding = options.embedding && options.embedding.length > 0;

    if (hasEmbedding) {
      return this.hybridSearchRRF(query, options.embedding!, {
        type: options.type,
        limit,
        minImportance: options.minImportance,
        k,
      });
    }

    // No embedding available — try FTS, then ILIKE fallback
    const ftsResults = await this.searchByFTS(query, {
      type: options.type,
      limit,
      minImportance: options.minImportance,
    });

    if (ftsResults.length > 0) {
      return ftsResults.map((m) => ({
        ...m,
        score: m.ftsRank,
        matchType: 'fts' as const,
      }));
    }

    // ILIKE keyword fallback
    const keywordResults = await this.search(query, {
      type: options.type,
      limit,
    });

    return keywordResults.map((m, i) => ({
      ...m,
      score: 1 / (k + i + 1), // Synthetic score based on position
      matchType: 'keyword' as const,
    }));
  }

  /**
   * Internal: RRF query combining vector + FTS results.
   */
  private async hybridSearchRRF(
    query: string,
    embedding: number[],
    options: {
      type?: MemoryType;
      limit: number;
      minImportance?: number;
      k: number;
    }
  ): Promise<Array<Memory & { score: number; matchType: MatchType }>> {
    const { limit, k } = options;

    // Build shared filter conditions (applied in both CTEs)
    let typeFilter = '';
    let importanceFilter = '';
    const extraParams: unknown[] = [];
    let nextParam = 4; // $1=userId, $2=embedding, $3=query

    if (options.type) {
      typeFilter = `AND type = $${nextParam++}`;
      extraParams.push(options.type);
    }
    if (options.minImportance !== undefined) {
      importanceFilter = `AND importance >= $${nextParam++}`;
      extraParams.push(options.minImportance);
    }

    const candidateLimit = limit * 3; // Over-fetch candidates for better ranking
    const candidateLimitParam = nextParam++;
    extraParams.push(candidateLimit);

    const sql = `
      WITH vector_results AS (
        SELECT id, content, type, importance, tags, source, source_id,
               accessed_count, created_at, updated_at, accessed_at, metadata,
               user_id, embedding,
               ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector ASC) AS vrank
        FROM memories
        WHERE user_id = $1
          AND embedding IS NOT NULL
          ${typeFilter}
          ${importanceFilter}
        ORDER BY embedding <=> $2::vector ASC
        LIMIT $${candidateLimitParam}
      ),
      fts_results AS (
        SELECT id, content, type, importance, tags, source, source_id,
               accessed_count, created_at, updated_at, accessed_at, metadata,
               user_id, embedding,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', $3)) DESC
               ) AS frank
        FROM memories
        WHERE user_id = $1
          AND search_vector @@ websearch_to_tsquery('english', $3)
          ${typeFilter}
          ${importanceFilter}
        ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', $3)) DESC
        LIMIT $${candidateLimitParam}
      ),
      combined AS (
        SELECT
          COALESCE(v.id, f.id) AS id,
          COALESCE(v.content, f.content) AS content,
          COALESCE(v.type, f.type) AS type,
          COALESCE(v.importance, f.importance) AS importance,
          COALESCE(v.tags, f.tags) AS tags,
          COALESCE(v.source, f.source) AS source,
          COALESCE(v.source_id, f.source_id) AS source_id,
          COALESCE(v.accessed_count, f.accessed_count) AS accessed_count,
          COALESCE(v.created_at, f.created_at) AS created_at,
          COALESCE(v.updated_at, f.updated_at) AS updated_at,
          COALESCE(v.accessed_at, f.accessed_at) AS accessed_at,
          COALESCE(v.metadata, f.metadata) AS metadata,
          COALESCE(v.user_id, f.user_id) AS user_id,
          COALESCE(v.embedding, f.embedding) AS embedding,
          COALESCE(1.0 / (${k} + v.vrank), 0) +
          COALESCE(1.0 / (${k} + f.frank), 0) AS rrf_score,
          CASE
            WHEN v.id IS NOT NULL AND f.id IS NOT NULL THEN 'hybrid'
            WHEN v.id IS NOT NULL THEN 'vector'
            ELSE 'fts'
          END AS match_type
        FROM vector_results v
        FULL OUTER JOIN fts_results f ON v.id = f.id
      )
      SELECT * FROM combined
      ORDER BY rrf_score DESC
      LIMIT $${nextParam}
    `;

    const params = [this.userId, JSON.stringify(embedding), query, ...extraParams, limit];

    const rows = await this.query<
      MemoryRow & {
        rrf_score: number;
        match_type: string;
      }
    >(sql, params);

    return rows.map((row) => ({
      ...rowToMemory(row),
      score: Number(row.rrf_score),
      matchType: row.match_type as MatchType,
    }));
  }

  /**
   * Get memories that are missing embeddings (for backfill).
   */
  async getWithoutEmbeddings(limit = 100): Promise<Memory[]> {
    const rows = await this.query<MemoryRow>(
      `SELECT * FROM memories
       WHERE user_id = $1 AND embedding IS NULL
       ORDER BY importance DESC, created_at DESC
       LIMIT $2`,
      [this.userId, limit]
    );
    return rows.map(rowToMemory);
  }

  /**
   * Count memories
   */
  async count(type?: MemoryType): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM memories WHERE user_id = $1`;
    const params: unknown[] = [this.userId];

    if (type) {
      sql += ` AND type = $2`;
      params.push(type);
    }

    const result = await this.queryOne<{ count: number }>(sql, params);
    return Number(result?.count ?? 0);
  }
}

export const memoriesRepo = new MemoriesRepository();

// Factory function
export function createMemoriesRepository(userId = 'default'): MemoriesRepository {
  return new MemoriesRepository(userId);
}

/**
 * Memories Repository
 *
 * Persistent memory storage for the autonomous AI assistant.
 * Stores facts, preferences, conversation summaries, and events.
 */

import { BaseRepository } from './base.js';

export type MemoryType = 'fact' | 'preference' | 'conversation' | 'event' | 'skill';

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  embedding?: Buffer;
  source?: string;
  sourceId?: string;
  importance: number;
  tags: string[];
  accessedCount: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  embedding?: Buffer;
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

export interface MemoryQuery {
  type?: MemoryType;
  types?: MemoryType[];
  minImportance?: number;
  tags?: string[];
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'importance' | 'created' | 'accessed' | 'relevance';
}

interface MemoryRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  embedding: Buffer | null;
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

function parseJsonField<T>(value: unknown, defaultValue: T): T {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'object') return value as T; // Already parsed (PostgreSQL JSONB)
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as MemoryType,
    content: row.content,
    embedding: row.embedding ?? undefined,
    source: row.source ?? undefined,
    sourceId: row.source_id ?? undefined,
    importance: row.importance,
    tags: parseJsonField<string[]>(row.tags, []),
    accessedCount: row.accessed_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
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
        input.embedding ?? null,
        input.source ?? null,
        input.sourceId ?? null,
        input.importance ?? 0.5,
        JSON.stringify(input.tags ?? []),
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    return (await this.get(id))!;
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

    return this.get(id, false);
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM memories WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
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
        params.push(`%"${tag}"%`);
      }
    }

    if (query.search) {
      sql += ` AND content ILIKE $${paramIndex++}`;
      params.push(`%${query.search}%`);
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
   * Check if similar memory exists (deduplication)
   */
  async findSimilar(content: string, type?: MemoryType): Promise<Memory | null> {
    // Simple text-based similarity for now
    // In the future, this could use embedding similarity
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
   * Boost memory importance (when accessed or reinforced)
   */
  async boost(id: string, amount = 0.1): Promise<Memory | null> {
    const existing = await this.get(id, false);
    if (!existing) return null;

    const newImportance = Math.min(1, existing.importance + amount);
    return this.update(id, { importance: newImportance });
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

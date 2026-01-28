/**
 * Memories Repository
 *
 * Persistent memory storage for the autonomous AI assistant.
 * Stores facts, preferences, conversation summaries, and events.
 */

import { getDatabase } from '../connection.js';

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
    tags: JSON.parse(row.tags || '[]'),
    accessedCount: row.accessed_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

export class MemoriesRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  /**
   * Create a new memory
   */
  create(input: CreateMemoryInput): Memory {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, user_id, type, content, embedding, source, source_id, importance, tags, accessed_count, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

    stmt.run(
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
      JSON.stringify(input.metadata ?? {})
    );

    return this.get(id)!;
  }

  /**
   * Get a memory by ID (updates accessed timestamp)
   */
  get(id: string, trackAccess = true): Memory | null {
    const stmt = this.db.prepare<[string, string], MemoryRow>(`
      SELECT * FROM memories WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    if (!row) return null;

    if (trackAccess) {
      this.trackAccess(id);
    }

    return rowToMemory(row);
  }

  /**
   * Update a memory
   */
  update(id: string, input: UpdateMemoryInput): Memory | null {
    const existing = this.get(id, false);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE memories SET
        content = COALESCE(?, content),
        importance = COALESCE(?, importance),
        tags = COALESCE(?, tags),
        metadata = COALESCE(?, metadata),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.content ?? null,
      input.importance ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      id,
      this.userId
    );

    return this.get(id, false);
  }

  /**
   * Delete a memory
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  /**
   * Track memory access (updates accessed_at and accessed_count)
   */
  private trackAccess(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE memories SET
        accessed_at = ?,
        accessed_count = accessed_count + 1
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(now, id, this.userId);
  }

  /**
   * List memories with filters
   */
  list(query: MemoryQuery = {}): Memory[] {
    let sql = `SELECT * FROM memories WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.type) {
      sql += ` AND type = ?`;
      params.push(query.type);
    }

    if (query.types && query.types.length > 0) {
      sql += ` AND type IN (${query.types.map(() => '?').join(', ')})`;
      params.push(...query.types);
    }

    if (query.minImportance !== undefined) {
      sql += ` AND importance >= ?`;
      params.push(query.minImportance);
    }

    if (query.source) {
      sql += ` AND source = ?`;
      params.push(query.source);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    if (query.search) {
      sql += ` AND content LIKE ?`;
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
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], MemoryRow>(sql);
    return stmt.all(...params).map(rowToMemory);
  }

  /**
   * Search memories by content
   */
  search(query: string, options: { type?: MemoryType; limit?: number } = {}): Memory[] {
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
  getRecent(limit = 10, type?: MemoryType): Memory[] {
    return this.list({
      type,
      limit,
      orderBy: 'created',
    });
  }

  /**
   * Get important memories (above threshold)
   */
  getImportant(threshold = 0.7, limit = 20): Memory[] {
    return this.list({
      minImportance: threshold,
      limit,
      orderBy: 'importance',
    });
  }

  /**
   * Get frequently accessed memories
   */
  getFrequentlyAccessed(limit = 10): Memory[] {
    const stmt = this.db.prepare<[string, number], MemoryRow>(`
      SELECT * FROM memories
      WHERE user_id = ? AND accessed_count > 0
      ORDER BY accessed_count DESC, importance DESC
      LIMIT ?
    `);

    return stmt.all(this.userId, limit).map(rowToMemory);
  }

  /**
   * Get memories by source (e.g., conversation_id)
   */
  getBySource(source: string, sourceId?: string): Memory[] {
    let sql = `SELECT * FROM memories WHERE user_id = ? AND source = ?`;
    const params: unknown[] = [this.userId, source];

    if (sourceId) {
      sql += ` AND source_id = ?`;
      params.push(sourceId);
    }

    sql += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare<unknown[], MemoryRow>(sql);
    return stmt.all(...params).map(rowToMemory);
  }

  /**
   * Decay memory importance over time
   * Memories that haven't been accessed recently lose importance
   */
  decay(options: { daysThreshold?: number; decayFactor?: number } = {}): number {
    const daysThreshold = options.daysThreshold ?? 30;
    const decayFactor = options.decayFactor ?? 0.9;

    const stmt = this.db.prepare(`
      UPDATE memories SET
        importance = importance * ?,
        updated_at = datetime('now')
      WHERE user_id = ?
        AND importance > 0.1
        AND (accessed_at IS NULL OR accessed_at < datetime('now', '-' || ? || ' days'))
        AND created_at < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(decayFactor, this.userId, daysThreshold, daysThreshold);
    return result.changes;
  }

  /**
   * Clean up low-importance memories
   */
  cleanup(options: { maxAge?: number; minImportance?: number } = {}): number {
    const maxAge = options.maxAge ?? 90; // days
    const minImportance = options.minImportance ?? 0.1;

    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE user_id = ?
        AND importance < ?
        AND created_at < datetime('now', '-' || ? || ' days')
        AND (accessed_at IS NULL OR accessed_at < datetime('now', '-' || ? || ' days'))
    `);

    const result = stmt.run(this.userId, minImportance, maxAge, maxAge);
    return result.changes;
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    total: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
    recentCount: number;
  } {
    const countByType = this.db.prepare<string, { type: string; count: number }>(`
      SELECT type, COUNT(*) as count FROM memories
      WHERE user_id = ?
      GROUP BY type
    `);

    const stats = this.db.prepare<string, { total: number; avg_importance: number }>(`
      SELECT COUNT(*) as total, AVG(importance) as avg_importance
      FROM memories WHERE user_id = ?
    `);

    const recent = this.db.prepare<string, { count: number }>(`
      SELECT COUNT(*) as count FROM memories
      WHERE user_id = ? AND created_at > datetime('now', '-7 days')
    `);

    const typeRows = countByType.all(this.userId);
    const statsRow = stats.get(this.userId);
    const recentRow = recent.get(this.userId);

    const byType: Record<MemoryType, number> = {
      fact: 0,
      preference: 0,
      conversation: 0,
      event: 0,
      skill: 0,
    };

    for (const row of typeRows) {
      byType[row.type as MemoryType] = row.count;
    }

    return {
      total: statsRow?.total ?? 0,
      byType,
      avgImportance: statsRow?.avg_importance ?? 0,
      recentCount: recentRow?.count ?? 0,
    };
  }

  /**
   * Check if similar memory exists (deduplication)
   */
  findSimilar(content: string, type?: MemoryType): Memory | null {
    // Simple text-based similarity for now
    // In the future, this could use embedding similarity
    let sql = `
      SELECT * FROM memories
      WHERE user_id = ?
        AND content = ?
    `;
    const params: unknown[] = [this.userId, content];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` LIMIT 1`;

    const stmt = this.db.prepare<unknown[], MemoryRow>(sql);
    const row = stmt.get(...params);
    return row ? rowToMemory(row) : null;
  }

  /**
   * Boost memory importance (when accessed or reinforced)
   */
  boost(id: string, amount = 0.1): Memory | null {
    const existing = this.get(id, false);
    if (!existing) return null;

    const newImportance = Math.min(1, existing.importance + amount);
    return this.update(id, { importance: newImportance });
  }

  /**
   * Count memories
   */
  count(type?: MemoryType): number {
    let sql = `SELECT COUNT(*) as count FROM memories WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    const stmt = this.db.prepare<unknown[], { count: number }>(sql);
    return stmt.get(...params)?.count ?? 0;
  }
}

export const memoriesRepo = new MemoriesRepository();

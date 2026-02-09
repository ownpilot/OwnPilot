/**
 * Captures Repository (PostgreSQL)
 *
 * Quick capture inbox for ideas, thoughts, and snippets
 */

import { BaseRepository, parseJsonField } from './base.js';

// =============================================================================
// Types
// =============================================================================

export type CaptureType = 'idea' | 'thought' | 'todo' | 'link' | 'quote' | 'snippet' | 'question' | 'other';
export type ProcessedAsType = 'note' | 'task' | 'bookmark' | 'discarded';

export interface Capture {
  id: string;
  userId: string;
  content: string;
  type: CaptureType;
  tags: string[];
  source?: string;
  url?: string;
  processed: boolean;
  processedAsType?: ProcessedAsType;
  processedAsId?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface CreateCaptureInput {
  content: string;
  type?: CaptureType;
  tags?: string[];
  source?: string;
}

export interface ProcessCaptureInput {
  processedAsType: ProcessedAsType;
  processedAsId?: string;
}

export interface CaptureQuery {
  type?: CaptureType;
  tag?: string;
  processed?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Row Interface
// =============================================================================

interface CaptureRow {
  id: string;
  user_id: string;
  content: string;
  type: string;
  tags: string;
  source: string | null;
  url: string | null;
  processed: boolean;
  processed_as_type: string | null;
  processed_as_id: string | null;
  created_at: string;
  processed_at: string | null;
}

// =============================================================================
// Row Converter
// =============================================================================

function rowToCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    type: row.type as CaptureType,
    tags: parseJsonField(row.tags, []),
    source: row.source ?? undefined,
    url: row.url ?? undefined,
    processed: row.processed === true,
    processedAsType: row.processed_as_type as ProcessedAsType | undefined,
    processedAsId: row.processed_as_id ?? undefined,
    createdAt: new Date(row.created_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function detectType(content: string): CaptureType {
  const lower = content.toLowerCase();

  if (/https?:\/\/[^\s]+/.test(content)) return 'link';
  if (/^["'].*["']$/.test(content.trim()) || /^>/.test(content)) return 'quote';
  if (/\?$/.test(content.trim()) || /^(what|why|how|when|where|who|can|should|would)/i.test(content)) return 'question';
  if (/^(todo|task|remember to|don't forget|need to|must|should)/i.test(lower)) return 'todo';
  if (/```|function\s|const\s|let\s|var\s|import\s|class\s|def\s|public\s/.test(content)) return 'snippet';
  if (/^(idea|what if|maybe|could|might be|consider)/i.test(lower)) return 'idea';

  return 'thought';
}

function extractTags(content: string): string[] {
  const tags: string[] = [];

  const hashtagMatches = content.match(/#(\w+)/g);
  if (hashtagMatches) {
    tags.push(...hashtagMatches.map(t => t.slice(1).toLowerCase()));
  }

  const mentionMatches = content.match(/@(\w+)/g);
  if (mentionMatches) {
    tags.push(...mentionMatches.map(t => `person:${t.slice(1).toLowerCase()}`));
  }

  return [...new Set(tags)];
}

function extractUrl(content: string): string | undefined {
  const urlMatch = content.match(/https?:\/\/[^\s]+/);
  return urlMatch?.[0];
}

// =============================================================================
// Repository
// =============================================================================

export class CapturesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateCaptureInput): Promise<Capture> {
    const id = `cap_${Date.now()}`;

    const autoTags = extractTags(input.content);
    const manualTags = input.tags ?? [];
    const allTags = [...new Set([...autoTags, ...manualTags])];

    const type = input.type ?? detectType(input.content);
    const url = extractUrl(input.content);

    await this.execute(
      `INSERT INTO captures (id, user_id, content, type, tags, source, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, this.userId, input.content, type, JSON.stringify(allTags), input.source ?? null, url ?? null]
    );

    const result = await this.get(id);
    if (!result) throw new Error('Failed to create capture');
    return result;
  }

  async get(id: string): Promise<Capture | null> {
    const row = await this.queryOne<CaptureRow>(
      `SELECT * FROM captures WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToCapture(row) : null;
  }

  async process(id: string, input: ProcessCaptureInput): Promise<Capture | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    await this.execute(
      `UPDATE captures SET
        processed = TRUE,
        processed_as_type = $1,
        processed_as_id = $2,
        processed_at = NOW()
      WHERE id = $3 AND user_id = $4`,
      [input.processedAsType, input.processedAsId ?? null, id, this.userId]
    );

    return this.get(id);
  }

  async unprocess(id: string): Promise<Capture | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    await this.execute(
      `UPDATE captures SET
        processed = FALSE,
        processed_as_type = NULL,
        processed_as_id = NULL,
        processed_at = NULL
      WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM captures WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async list(query: CaptureQuery = {}): Promise<Capture[]> {
    let sql = `SELECT * FROM captures WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(query.type);
    }

    if (query.tag) {
      sql += ` AND tags::text LIKE $${paramIndex++}`;
      params.push(`%"${this.escapeLike(query.tag.toLowerCase())}"%`);
    }

    if (query.processed !== undefined) {
      sql += ` AND processed = $${paramIndex++}`;
      params.push(query.processed);
    }

    if (query.search) {
      sql += ` AND content ILIKE $${paramIndex++}`;
      params.push(`%${this.escapeLike(query.search)}%`);
    }

    sql += ` ORDER BY created_at DESC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<CaptureRow>(sql, params);
    return rows.map(rowToCapture);
  }

  async getInbox(limit = 10): Promise<Capture[]> {
    return this.list({ processed: false, limit });
  }

  async getInboxCount(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM captures WHERE user_id = $1 AND processed = FALSE`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getStats(): Promise<{
    total: number;
    processed: number;
    unprocessed: number;
    byType: Record<CaptureType, number>;
    topTags: Array<{ tag: string; count: number }>;
    processedAs: Record<ProcessedAsType, number>;
  }> {
    // Use SQL aggregation instead of loading all records into memory
    const [typeRows, processedAsRows, tagRows] = await Promise.all([
      // Counts by type and processed status
      this.query<{ type: string; processed: boolean; count: string }>(
        `SELECT type, processed, COUNT(*) as count FROM captures WHERE user_id = $1 GROUP BY type, processed`,
        [this.userId]
      ),
      // Counts by processed_as_type
      this.query<{ processed_as_type: string; count: string }>(
        `SELECT processed_as_type, COUNT(*) as count FROM captures WHERE user_id = $1 AND processed_as_type IS NOT NULL GROUP BY processed_as_type`,
        [this.userId]
      ),
      // Top tags via json_each
      this.query<{ tag: string; count: string }>(
        `SELECT value as tag, COUNT(*) as count FROM captures, json_each(captures.tags) WHERE captures.user_id = $1 GROUP BY value ORDER BY count DESC LIMIT 10`,
        [this.userId]
      ),
    ]);

    let total = 0;
    let processed = 0;
    const byType: Record<string, number> = {};

    for (const row of typeRows) {
      const count = parseInt(String(row.count), 10);
      total += count;
      if (row.processed) processed += count;
      byType[row.type] = (byType[row.type] || 0) + count;
    }

    const processedAs: Record<string, number> = {};
    for (const row of processedAsRows) {
      processedAs[row.processed_as_type] = parseInt(String(row.count), 10);
    }

    const topTags = tagRows.map(row => ({
      tag: row.tag,
      count: parseInt(String(row.count), 10),
    }));

    return {
      total,
      processed,
      unprocessed: total - processed,
      byType: byType as Record<CaptureType, number>,
      topTags,
      processedAs: processedAs as Record<ProcessedAsType, number>,
    };
  }

  async getRecentByType(): Promise<Record<CaptureType, Capture[]>> {
    const types: CaptureType[] = ['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other'];
    const result: Record<string, Capture[]> = {};

    for (const type of types) {
      result[type] = await this.list({ type, limit: 5 });
    }

    return result as Record<CaptureType, Capture[]>;
  }
}

export const capturesRepo = new CapturesRepository();

// Factory function
export function createCapturesRepository(userId = 'default'): CapturesRepository {
  return new CapturesRepository(userId);
}

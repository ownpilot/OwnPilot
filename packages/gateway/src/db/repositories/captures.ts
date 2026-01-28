/**
 * Captures Repository
 *
 * Quick capture inbox for ideas, thoughts, and snippets
 */

import { getDatabase } from '../connection.js';

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
  processed: number;
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
    tags: JSON.parse(row.tags || '[]'),
    source: row.source ?? undefined,
    url: row.url ?? undefined,
    processed: row.processed === 1,
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

  // URL detection
  if (/https?:\/\/[^\s]+/.test(content)) return 'link';

  // Quote detection
  if (/^["'].*["']$/.test(content.trim()) || /^>/.test(content)) return 'quote';

  // Question detection
  if (/\?$/.test(content.trim()) || /^(what|why|how|when|where|who|can|should|would)/i.test(content)) return 'question';

  // Todo detection
  if (/^(todo|task|remember to|don't forget|need to|must|should)/i.test(lower)) return 'todo';

  // Code snippet detection
  if (/```|function\s|const\s|let\s|var\s|import\s|class\s|def\s|public\s/.test(content)) return 'snippet';

  // Idea indicators
  if (/^(idea|what if|maybe|could|might be|consider)/i.test(lower)) return 'idea';

  return 'thought';
}

function extractTags(content: string): string[] {
  const tags: string[] = [];

  // Extract hashtags
  const hashtagMatches = content.match(/#(\w+)/g);
  if (hashtagMatches) {
    tags.push(...hashtagMatches.map(t => t.slice(1).toLowerCase()));
  }

  // Extract @mentions as context tags
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

export class CapturesRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateCaptureInput): Capture {
    const id = `cap_${Date.now()}`;
    const now = new Date().toISOString();

    const autoTags = extractTags(input.content);
    const manualTags = input.tags ?? [];
    const allTags = [...new Set([...autoTags, ...manualTags])];

    const type = input.type ?? detectType(input.content);
    const url = extractUrl(input.content);

    const stmt = this.db.prepare(`
      INSERT INTO captures (id, user_id, content, type, tags, source, url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, this.userId, input.content, type, JSON.stringify(allTags), input.source ?? null, url ?? null, now);

    return this.get(id)!;
  }

  get(id: string): Capture | null {
    const stmt = this.db.prepare<[string, string], CaptureRow>(`
      SELECT * FROM captures WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToCapture(row) : null;
  }

  process(id: string, input: ProcessCaptureInput): Capture | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE captures SET
        processed = 1,
        processed_as_type = ?,
        processed_as_id = ?,
        processed_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(input.processedAsType, input.processedAsId ?? null, now, id, this.userId);

    return this.get(id);
  }

  unprocess(id: string): Capture | null {
    const existing = this.get(id);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE captures SET
        processed = 0,
        processed_as_type = NULL,
        processed_as_id = NULL,
        processed_at = NULL
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(id, this.userId);

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM captures WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  list(query: CaptureQuery = {}): Capture[] {
    let sql = `SELECT * FROM captures WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.type) {
      sql += ` AND type = ?`;
      params.push(query.type);
    }

    if (query.tag) {
      sql += ` AND tags LIKE ?`;
      params.push(`%"${query.tag.toLowerCase()}"%`);
    }

    if (query.processed !== undefined) {
      sql += ` AND processed = ?`;
      params.push(query.processed ? 1 : 0);
    }

    if (query.search) {
      sql += ` AND content LIKE ?`;
      params.push(`%${query.search}%`);
    }

    sql += ` ORDER BY created_at DESC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], CaptureRow>(sql);
    return stmt.all(...params).map(rowToCapture);
  }

  getInbox(limit = 10): Capture[] {
    return this.list({ processed: false, limit });
  }

  getInboxCount(): number {
    const stmt = this.db.prepare<[string], { count: number }>(`
      SELECT COUNT(*) as count FROM captures WHERE user_id = ? AND processed = 0
    `);

    return stmt.get(this.userId)?.count ?? 0;
  }

  getStats(): {
    total: number;
    processed: number;
    unprocessed: number;
    byType: Record<CaptureType, number>;
    topTags: Array<{ tag: string; count: number }>;
    processedAs: Record<ProcessedAsType, number>;
  } {
    const allCaptures = this.list({ limit: 10000 });
    const processed = allCaptures.filter(c => c.processed);
    const unprocessed = allCaptures.filter(c => !c.processed);

    const byType: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const processedAs: Record<string, number> = {};

    for (const capture of allCaptures) {
      // By type
      byType[capture.type] = (byType[capture.type] || 0) + 1;

      // Tags
      for (const tag of capture.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }

      // Processed as
      if (capture.processedAsType) {
        processedAs[capture.processedAsType] = (processedAs[capture.processedAsType] || 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      total: allCaptures.length,
      processed: processed.length,
      unprocessed: unprocessed.length,
      byType: byType as Record<CaptureType, number>,
      topTags,
      processedAs: processedAs as Record<ProcessedAsType, number>,
    };
  }

  getRecentByType(): Record<CaptureType, Capture[]> {
    const types: CaptureType[] = ['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other'];
    const result: Record<string, Capture[]> = {};

    for (const type of types) {
      result[type] = this.list({ type, limit: 5 });
    }

    return result as Record<CaptureType, Capture[]>;
  }
}

export const capturesRepo = new CapturesRepository();

/**
 * Notes Repository
 *
 * CRUD operations for personal notes
 */

import { getDatabase } from '../connection.js';

export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  contentType: 'markdown' | 'text' | 'html';
  category?: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  contentType?: Note['contentType'];
  category?: string;
  tags?: string[];
  isPinned?: boolean;
  color?: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  contentType?: Note['contentType'];
  category?: string;
  tags?: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  color?: string;
}

export interface NoteQuery {
  category?: string;
  tags?: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  content_type: string;
  category: string | null;
  tags: string;
  is_pinned: number;
  is_archived: number;
  color: string | null;
  created_at: string;
  updated_at: string;
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    contentType: row.content_type as Note['contentType'],
    category: row.category ?? undefined,
    tags: JSON.parse(row.tags || '[]'),
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    color: row.color ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NotesRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateNoteInput): Note {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO notes (id, user_id, title, content, content_type, category, tags, is_pinned, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.title,
      input.content,
      input.contentType ?? 'markdown',
      input.category ?? null,
      JSON.stringify(input.tags ?? []),
      input.isPinned ? 1 : 0,
      input.color ?? null,
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): Note | null {
    const stmt = this.db.prepare<[string, string], NoteRow>(`
      SELECT * FROM notes WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToNote(row) : null;
  }

  update(id: string, input: UpdateNoteInput): Note | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE notes SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        content_type = COALESCE(?, content_type),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        is_pinned = COALESCE(?, is_pinned),
        is_archived = COALESCE(?, is_archived),
        color = COALESCE(?, color),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.title ?? null,
      input.content ?? null,
      input.contentType ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.isPinned !== undefined ? (input.isPinned ? 1 : 0) : null,
      input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : null,
      input.color ?? null,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  archive(id: string): Note | null {
    return this.update(id, { isArchived: true });
  }

  unarchive(id: string): Note | null {
    return this.update(id, { isArchived: false });
  }

  togglePin(id: string): Note | null {
    const existing = this.get(id);
    if (!existing) return null;

    return this.update(id, { isPinned: !existing.isPinned });
  }

  list(query: NoteQuery = {}): Note[] {
    let sql = `SELECT * FROM notes WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    // Default to non-archived unless explicitly requested
    if (query.isArchived === undefined) {
      sql += ` AND is_archived = 0`;
    } else {
      sql += ` AND is_archived = ?`;
      params.push(query.isArchived ? 1 : 0);
    }

    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }

    if (query.isPinned !== undefined) {
      sql += ` AND is_pinned = ?`;
      params.push(query.isPinned ? 1 : 0);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    if (query.search) {
      sql += ` AND (title LIKE ? OR content LIKE ?)`;
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ` ORDER BY is_pinned DESC, updated_at DESC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], NoteRow>(sql);
    return stmt.all(...params).map(rowToNote);
  }

  getPinned(): Note[] {
    return this.list({ isPinned: true });
  }

  getArchived(): Note[] {
    return this.list({ isArchived: true });
  }

  getRecent(limit = 10): Note[] {
    return this.list({ limit });
  }

  getCategories(): string[] {
    const stmt = this.db.prepare<string, { category: string }>(`
      SELECT DISTINCT category FROM notes
      WHERE user_id = ? AND category IS NOT NULL AND is_archived = 0
      ORDER BY category
    `);

    return stmt.all(this.userId).map(r => r.category);
  }

  getTags(): string[] {
    const stmt = this.db.prepare<string, { tags: string }>(`
      SELECT tags FROM notes WHERE user_id = ? AND is_archived = 0
    `);

    const allTags = new Set<string>();
    for (const row of stmt.all(this.userId)) {
      const tags = JSON.parse(row.tags || '[]') as string[];
      for (const tag of tags) {
        allTags.add(tag);
      }
    }

    return Array.from(allTags).sort();
  }

  count(includeArchived = false): number {
    const stmt = this.db.prepare<[string, number], { count: number }>(`
      SELECT COUNT(*) as count FROM notes
      WHERE user_id = ? AND (is_archived = 0 OR ? = 1)
    `);

    return stmt.get(this.userId, includeArchived ? 1 : 0)?.count ?? 0;
  }

  search(query: string, limit = 20): Note[] {
    return this.list({ search: query, limit });
  }
}

export const notesRepo = new NotesRepository();

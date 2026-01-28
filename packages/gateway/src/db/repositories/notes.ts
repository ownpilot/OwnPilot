/**
 * Notes Repository (PostgreSQL)
 *
 * CRUD operations for personal notes
 */

import { BaseRepository } from './base.js';

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
  is_pinned: boolean;
  is_archived: boolean;
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
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
    isPinned: row.is_pinned === true,
    isArchived: row.is_archived === true,
    color: row.color ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NotesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const id = crypto.randomUUID();

    await this.execute(
      `INSERT INTO notes (id, user_id, title, content, content_type, category, tags, is_pinned, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        this.userId,
        input.title,
        input.content,
        input.contentType ?? 'markdown',
        input.category ?? null,
        JSON.stringify(input.tags ?? []),
        input.isPinned ?? false,
        input.color ?? null,
      ]
    );

    const result = await this.get(id);
    if (!result) throw new Error('Failed to create note');
    return result;
  }

  async get(id: string): Promise<Note | null> {
    const row = await this.queryOne<NoteRow>(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToNote(row) : null;
  }

  async update(id: string, input: UpdateNoteInput): Promise<Note | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(input.title);
    }
    if (input.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(input.content);
    }
    if (input.contentType !== undefined) {
      updates.push(`content_type = $${paramIndex++}`);
      values.push(input.contentType);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.isPinned !== undefined) {
      updates.push(`is_pinned = $${paramIndex++}`);
      values.push(input.isPinned);
    }
    if (input.isArchived !== undefined) {
      updates.push(`is_archived = $${paramIndex++}`);
      values.push(input.isArchived);
    }
    if (input.color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(input.color);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = NOW()');
    values.push(id, this.userId);

    await this.execute(
      `UPDATE notes SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async archive(id: string): Promise<Note | null> {
    return this.update(id, { isArchived: true });
  }

  async unarchive(id: string): Promise<Note | null> {
    return this.update(id, { isArchived: false });
  }

  async togglePin(id: string): Promise<Note | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.update(id, { isPinned: !existing.isPinned });
  }

  async list(query: NoteQuery = {}): Promise<Note[]> {
    let sql = `SELECT * FROM notes WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    // Default to non-archived unless explicitly requested
    if (query.isArchived === undefined) {
      sql += ` AND is_archived = FALSE`;
    } else {
      sql += ` AND is_archived = $${paramIndex++}`;
      params.push(query.isArchived);
    }

    if (query.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(query.category);
    }

    if (query.isPinned !== undefined) {
      sql += ` AND is_pinned = $${paramIndex++}`;
      params.push(query.isPinned);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags::text LIKE $${paramIndex++}`;
        params.push(`%"${tag}"%`);
      }
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    sql += ` ORDER BY is_pinned DESC, updated_at DESC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<NoteRow>(sql, params);
    return rows.map(rowToNote);
  }

  async getPinned(): Promise<Note[]> {
    return this.list({ isPinned: true });
  }

  async getArchived(): Promise<Note[]> {
    return this.list({ isArchived: true });
  }

  async getRecent(limit = 10): Promise<Note[]> {
    return this.list({ limit });
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM notes WHERE user_id = $1 AND category IS NOT NULL AND is_archived = FALSE ORDER BY category`,
      [this.userId]
    );
    return rows.map(r => r.category);
  }

  async getTags(): Promise<string[]> {
    const rows = await this.query<{ tags: string }>(
      `SELECT tags FROM notes WHERE user_id = $1 AND is_archived = FALSE`,
      [this.userId]
    );

    const allTags = new Set<string>();
    for (const row of rows) {
      const tags = typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []);
      for (const tag of tags) {
        allTags.add(tag);
      }
    }

    return Array.from(allTags).sort();
  }

  async count(includeArchived = false): Promise<number> {
    const sql = includeArchived
      ? `SELECT COUNT(*) as count FROM notes WHERE user_id = $1`
      : `SELECT COUNT(*) as count FROM notes WHERE user_id = $1 AND is_archived = FALSE`;

    const row = await this.queryOne<{ count: string }>(sql, [this.userId]);
    return parseInt(row?.count ?? '0', 10);
  }

  async search(searchQuery: string, limit = 20): Promise<Note[]> {
    return this.list({ search: searchQuery, limit });
  }
}

export const notesRepo = new NotesRepository();

// Factory function
export function createNotesRepository(userId = 'default'): NotesRepository {
  return new NotesRepository(userId);
}

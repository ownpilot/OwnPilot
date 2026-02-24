/**
 * Notes Repository (PostgreSQL)
 *
 * CRUD operations for personal notes.
 * Extends CrudRepository for standard create/get/update/delete.
 */

import { parseJsonField } from './base.js';
import { CrudRepository, type CreateFields } from './crud-base.js';
import type { UpdateField } from './query-helpers.js';

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

interface NoteRow extends Record<string, unknown> {
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

export class NotesRepository extends CrudRepository<
  NoteRow,
  Note,
  CreateNoteInput,
  UpdateNoteInput
> {
  readonly tableName = 'notes';

  mapRow(row: NoteRow): Note {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      content: row.content,
      contentType: row.content_type as Note['contentType'],
      category: row.category ?? undefined,
      tags: parseJsonField(row.tags, []),
      isPinned: row.is_pinned === true,
      isArchived: row.is_archived === true,
      color: row.color ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  buildCreateFields(input: CreateNoteInput): CreateFields {
    return {
      title: input.title,
      content: input.content,
      content_type: input.contentType ?? 'markdown',
      category: input.category ?? null,
      tags: JSON.stringify(input.tags ?? []),
      is_pinned: input.isPinned ?? false,
      color: input.color ?? null,
    };
  }

  buildUpdateFields(input: UpdateNoteInput): UpdateField[] {
    return [
      { column: 'title', value: input.title },
      { column: 'content', value: input.content },
      { column: 'content_type', value: input.contentType },
      { column: 'category', value: input.category },
      { column: 'tags', value: input.tags !== undefined ? JSON.stringify(input.tags) : undefined },
      { column: 'is_pinned', value: input.isPinned },
      { column: 'is_archived', value: input.isArchived },
      { column: 'color', value: input.color },
    ];
  }

  // --- Alias: keep backward-compatible `get` method ---

  async get(id: string): Promise<Note | null> {
    return this.getById(id);
  }

  // --- Domain-specific methods ---

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
        params.push(`%"${this.escapeLike(tag)}"%`);
      }
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
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
    return rows.map((row) => this.mapRow(row));
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
    return rows.map((r) => r.category);
  }

  async getTags(): Promise<string[]> {
    const rows = await this.query<{ tags: string }>(
      `SELECT tags FROM notes WHERE user_id = $1 AND is_archived = FALSE`,
      [this.userId]
    );

    const allTags = new Set<string>();
    for (const row of rows) {
      const tags = parseJsonField(row.tags, []);
      for (const tag of tags) {
        allTags.add(tag);
      }
    }

    return Array.from(allTags).sort();
  }

  override async count(includeArchived = false): Promise<number> {
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

/**
 * Bookmarks Repository (PostgreSQL)
 *
 * CRUD operations for saved bookmarks/links.
 * Extends CrudRepository for standard create/get/update/delete/count.
 */

import { parseJsonField } from './base.js';
import { CrudRepository, type CreateFields } from './crud-base.js';
import type { UpdateField } from './query-helpers.js';

export interface Bookmark {
  id: string;
  userId: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  category?: string;
  tags: string[];
  isFavorite: boolean;
  visitCount: number;
  lastVisitedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookmarkInput {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  category?: string;
  tags?: string[];
  isFavorite?: boolean;
}

export interface UpdateBookmarkInput {
  url?: string;
  title?: string;
  description?: string;
  favicon?: string;
  category?: string;
  tags?: string[];
  isFavorite?: boolean;
}

export interface BookmarkQuery {
  category?: string;
  tags?: string[];
  isFavorite?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

interface BookmarkRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  url: string;
  title: string;
  description: string | null;
  favicon: string | null;
  category: string | null;
  tags: string;
  is_favorite: boolean;
  visit_count: number;
  last_visited_at: string | null;
  created_at: string;
  updated_at: string;
}

export class BookmarksRepository extends CrudRepository<
  BookmarkRow,
  Bookmark,
  CreateBookmarkInput,
  UpdateBookmarkInput
> {
  readonly tableName = 'bookmarks';

  mapRow(row: BookmarkRow): Bookmark {
    return {
      id: row.id,
      userId: row.user_id,
      url: row.url,
      title: row.title,
      description: row.description ?? undefined,
      favicon: row.favicon ?? undefined,
      category: row.category ?? undefined,
      tags: parseJsonField(row.tags, []),
      isFavorite: row.is_favorite === true,
      visitCount: Number(row.visit_count),
      lastVisitedAt: row.last_visited_at ? new Date(row.last_visited_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  buildCreateFields(input: CreateBookmarkInput): CreateFields {
    return {
      url: input.url,
      title: input.title,
      description: input.description ?? null,
      favicon: input.favicon ?? null,
      category: input.category ?? null,
      tags: JSON.stringify(input.tags ?? []),
      is_favorite: input.isFavorite ?? false,
    };
  }

  buildUpdateFields(input: UpdateBookmarkInput): UpdateField[] {
    return [
      { column: 'url', value: input.url },
      { column: 'title', value: input.title },
      { column: 'description', value: input.description },
      { column: 'favicon', value: input.favicon },
      { column: 'category', value: input.category },
      { column: 'tags', value: input.tags !== undefined ? JSON.stringify(input.tags) : undefined },
      { column: 'is_favorite', value: input.isFavorite },
    ];
  }

  // --- Alias: keep backward-compatible `get` method ---

  async get(id: string): Promise<Bookmark | null> {
    return this.getById(id);
  }

  // --- Domain-specific methods ---

  async getByUrl(url: string): Promise<Bookmark | null> {
    const row = await this.queryOne<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE url = $1 AND user_id = $2`,
      [url, this.userId]
    );
    return row ? this.mapRow(row) : null;
  }

  async recordVisit(id: string): Promise<Bookmark | null> {
    await this.execute(
      `UPDATE bookmarks SET
        visit_count = visit_count + 1,
        last_visited_at = NOW(),
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return this.get(id);
  }

  async toggleFavorite(id: string): Promise<Bookmark | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.update(id, { isFavorite: !existing.isFavorite });
  }

  async list(query: BookmarkQuery = {}): Promise<Bookmark[]> {
    let sql = `SELECT * FROM bookmarks WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(query.category);
    }

    if (query.isFavorite !== undefined) {
      sql += ` AND is_favorite = $${paramIndex++}`;
      params.push(query.isFavorite);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags::text LIKE $${paramIndex++}`;
        params.push(`%"${this.escapeLike(tag)}"%`);
      }
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR url ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    sql += ` ORDER BY is_favorite DESC, updated_at DESC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<BookmarkRow>(sql, params);
    return rows.map((row) => this.mapRow(row));
  }

  async getFavorites(): Promise<Bookmark[]> {
    return this.list({ isFavorite: true });
  }

  async getRecent(limit = 10): Promise<Bookmark[]> {
    return this.list({ limit });
  }

  async getMostVisited(limit = 10): Promise<Bookmark[]> {
    const rows = await this.query<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE user_id = $1 ORDER BY visit_count DESC LIMIT $2`,
      [this.userId, limit]
    );
    return rows.map((row) => this.mapRow(row));
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM bookmarks WHERE user_id = $1 AND category IS NOT NULL ORDER BY category`,
      [this.userId]
    );
    return rows.map((r) => r.category);
  }

  async getTags(): Promise<string[]> {
    const rows = await this.query<{ tags: string }>(
      `SELECT tags FROM bookmarks WHERE user_id = $1`,
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

  async search(searchQuery: string, limit = 20): Promise<Bookmark[]> {
    return this.list({ search: searchQuery, limit });
  }
}

export const bookmarksRepo = new BookmarksRepository();

// Factory function
export function createBookmarksRepository(userId = 'default'): BookmarksRepository {
  return new BookmarksRepository(userId);
}

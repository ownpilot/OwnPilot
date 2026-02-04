/**
 * Bookmarks Repository (PostgreSQL)
 *
 * CRUD operations for saved bookmarks/links
 */

import { BaseRepository } from './base.js';

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

interface BookmarkRow {
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

function rowToBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    title: row.title,
    description: row.description ?? undefined,
    favicon: row.favicon ?? undefined,
    category: row.category ?? undefined,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
    isFavorite: row.is_favorite === true,
    visitCount: Number(row.visit_count),
    lastVisitedAt: row.last_visited_at ? new Date(row.last_visited_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class BookmarksRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateBookmarkInput): Promise<Bookmark> {
    const id = crypto.randomUUID();

    await this.execute(
      `INSERT INTO bookmarks (id, user_id, url, title, description, favicon, category, tags, is_favorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        this.userId,
        input.url,
        input.title,
        input.description ?? null,
        input.favicon ?? null,
        input.category ?? null,
        JSON.stringify(input.tags ?? []),
        input.isFavorite ?? false,
      ]
    );

    const result = await this.get(id);
    if (!result) throw new Error('Failed to create bookmark');
    return result;
  }

  async get(id: string): Promise<Bookmark | null> {
    const row = await this.queryOne<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToBookmark(row) : null;
  }

  async getByUrl(url: string): Promise<Bookmark | null> {
    const row = await this.queryOne<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE url = $1 AND user_id = $2`,
      [url, this.userId]
    );
    return row ? rowToBookmark(row) : null;
  }

  async update(id: string, input: UpdateBookmarkInput): Promise<Bookmark | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.url !== undefined) {
      updates.push(`url = $${paramIndex++}`);
      values.push(input.url);
    }
    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.favicon !== undefined) {
      updates.push(`favicon = $${paramIndex++}`);
      values.push(input.favicon);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.isFavorite !== undefined) {
      updates.push(`is_favorite = $${paramIndex++}`);
      values.push(input.isFavorite);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = NOW()');
    values.push(id, this.userId);

    await this.execute(
      `UPDATE bookmarks SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
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
    return rows.map(rowToBookmark);
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
    return rows.map(rowToBookmark);
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM bookmarks WHERE user_id = $1 AND category IS NOT NULL ORDER BY category`,
      [this.userId]
    );
    return rows.map(r => r.category);
  }

  async getTags(): Promise<string[]> {
    const rows = await this.query<{ tags: string }>(
      `SELECT tags FROM bookmarks WHERE user_id = $1`,
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

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
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

/**
 * Bookmarks Repository
 *
 * CRUD operations for saved bookmarks/links
 */

import { getDatabase } from '../connection.js';

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
  is_favorite: number;
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
    tags: JSON.parse(row.tags || '[]'),
    isFavorite: row.is_favorite === 1,
    visitCount: row.visit_count,
    lastVisitedAt: row.last_visited_at ? new Date(row.last_visited_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class BookmarksRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateBookmarkInput): Bookmark {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO bookmarks (id, user_id, url, title, description, favicon, category, tags, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.url,
      input.title,
      input.description ?? null,
      input.favicon ?? null,
      input.category ?? null,
      JSON.stringify(input.tags ?? []),
      input.isFavorite ? 1 : 0,
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): Bookmark | null {
    const stmt = this.db.prepare<[string, string], BookmarkRow>(`
      SELECT * FROM bookmarks WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToBookmark(row) : null;
  }

  getByUrl(url: string): Bookmark | null {
    const stmt = this.db.prepare<[string, string], BookmarkRow>(`
      SELECT * FROM bookmarks WHERE url = ? AND user_id = ?
    `);

    const row = stmt.get(url, this.userId);
    return row ? rowToBookmark(row) : null;
  }

  update(id: string, input: UpdateBookmarkInput): Bookmark | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE bookmarks SET
        url = COALESCE(?, url),
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        favicon = COALESCE(?, favicon),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        is_favorite = COALESCE(?, is_favorite),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.url ?? null,
      input.title ?? null,
      input.description ?? null,
      input.favicon ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.isFavorite !== undefined ? (input.isFavorite ? 1 : 0) : null,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM bookmarks WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  recordVisit(id: string): Bookmark | null {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE bookmarks SET
        visit_count = visit_count + 1,
        last_visited_at = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(now, now, id, this.userId);
    return this.get(id);
  }

  toggleFavorite(id: string): Bookmark | null {
    const existing = this.get(id);
    if (!existing) return null;

    return this.update(id, { isFavorite: !existing.isFavorite });
  }

  list(query: BookmarkQuery = {}): Bookmark[] {
    let sql = `SELECT * FROM bookmarks WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }

    if (query.isFavorite !== undefined) {
      sql += ` AND is_favorite = ?`;
      params.push(query.isFavorite ? 1 : 0);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    if (query.search) {
      sql += ` AND (title LIKE ? OR description LIKE ? OR url LIKE ?)`;
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY is_favorite DESC, updated_at DESC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], BookmarkRow>(sql);
    return stmt.all(...params).map(rowToBookmark);
  }

  getFavorites(): Bookmark[] {
    return this.list({ isFavorite: true });
  }

  getRecent(limit = 10): Bookmark[] {
    return this.list({ limit });
  }

  getMostVisited(limit = 10): Bookmark[] {
    const stmt = this.db.prepare<[string, number], BookmarkRow>(`
      SELECT * FROM bookmarks
      WHERE user_id = ?
      ORDER BY visit_count DESC
      LIMIT ?
    `);

    return stmt.all(this.userId, limit).map(rowToBookmark);
  }

  getCategories(): string[] {
    const stmt = this.db.prepare<string, { category: string }>(`
      SELECT DISTINCT category FROM bookmarks
      WHERE user_id = ? AND category IS NOT NULL
      ORDER BY category
    `);

    return stmt.all(this.userId).map(r => r.category);
  }

  getTags(): string[] {
    const stmt = this.db.prepare<string, { tags: string }>(`
      SELECT tags FROM bookmarks WHERE user_id = ?
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

  count(): number {
    const stmt = this.db.prepare<string, { count: number }>(`
      SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?
    `);

    return stmt.get(this.userId)?.count ?? 0;
  }

  search(query: string, limit = 20): Bookmark[] {
    return this.list({ search: query, limit });
  }
}

export const bookmarksRepo = new BookmarksRepository();

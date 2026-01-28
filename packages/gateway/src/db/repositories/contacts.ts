/**
 * Contacts Repository
 *
 * CRUD operations for personal contacts
 */

import { getDatabase } from '../connection.js';

export interface Contact {
  id: string;
  userId: string;
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags: string[];
  isFavorite: boolean;
  externalId?: string;
  externalSource?: string;
  socialLinks: Record<string, string>;
  customFields: Record<string, string>;
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  name: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags?: string[];
  isFavorite?: boolean;
  externalId?: string;
  externalSource?: string;
  socialLinks?: Record<string, string>;
  customFields?: Record<string, string>;
}

export interface UpdateContactInput {
  name?: string;
  nickname?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  avatar?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  relationship?: string;
  tags?: string[];
  isFavorite?: boolean;
  socialLinks?: Record<string, string>;
  customFields?: Record<string, string>;
}

export interface ContactQuery {
  relationship?: string;
  company?: string;
  tags?: string[];
  isFavorite?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  avatar: string | null;
  birthday: string | null;
  address: string | null;
  notes: string | null;
  relationship: string | null;
  tags: string;
  is_favorite: number;
  external_id: string | null;
  external_source: string | null;
  social_links: string;
  custom_fields: string;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nickname: row.nickname ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    company: row.company ?? undefined,
    jobTitle: row.job_title ?? undefined,
    avatar: row.avatar ?? undefined,
    birthday: row.birthday ?? undefined,
    address: row.address ?? undefined,
    notes: row.notes ?? undefined,
    relationship: row.relationship ?? undefined,
    tags: JSON.parse(row.tags || '[]'),
    isFavorite: row.is_favorite === 1,
    externalId: row.external_id ?? undefined,
    externalSource: row.external_source ?? undefined,
    socialLinks: JSON.parse(row.social_links || '{}'),
    customFields: JSON.parse(row.custom_fields || '{}'),
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class ContactsRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateContactInput): Contact {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO contacts (id, user_id, name, nickname, email, phone, company, job_title,
        avatar, birthday, address, notes, relationship, tags, is_favorite,
        external_id, external_source, social_links, custom_fields, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.name,
      input.nickname ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.company ?? null,
      input.jobTitle ?? null,
      input.avatar ?? null,
      input.birthday ?? null,
      input.address ?? null,
      input.notes ?? null,
      input.relationship ?? null,
      JSON.stringify(input.tags ?? []),
      input.isFavorite ? 1 : 0,
      input.externalId ?? null,
      input.externalSource ?? null,
      JSON.stringify(input.socialLinks ?? {}),
      JSON.stringify(input.customFields ?? {}),
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): Contact | null {
    const stmt = this.db.prepare<[string, string], ContactRow>(`
      SELECT * FROM contacts WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToContact(row) : null;
  }

  getByEmail(email: string): Contact | null {
    const stmt = this.db.prepare<[string, string], ContactRow>(`
      SELECT * FROM contacts WHERE email = ? AND user_id = ?
    `);

    const row = stmt.get(email, this.userId);
    return row ? rowToContact(row) : null;
  }

  getByPhone(phone: string): Contact | null {
    const stmt = this.db.prepare<[string, string], ContactRow>(`
      SELECT * FROM contacts WHERE phone = ? AND user_id = ?
    `);

    const row = stmt.get(phone, this.userId);
    return row ? rowToContact(row) : null;
  }

  update(id: string, input: UpdateContactInput): Contact | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE contacts SET
        name = COALESCE(?, name),
        nickname = COALESCE(?, nickname),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        company = COALESCE(?, company),
        job_title = COALESCE(?, job_title),
        avatar = COALESCE(?, avatar),
        birthday = COALESCE(?, birthday),
        address = COALESCE(?, address),
        notes = COALESCE(?, notes),
        relationship = COALESCE(?, relationship),
        tags = COALESCE(?, tags),
        is_favorite = COALESCE(?, is_favorite),
        social_links = COALESCE(?, social_links),
        custom_fields = COALESCE(?, custom_fields),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.name ?? null,
      input.nickname ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.company ?? null,
      input.jobTitle ?? null,
      input.avatar ?? null,
      input.birthday ?? null,
      input.address ?? null,
      input.notes ?? null,
      input.relationship ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.isFavorite !== undefined ? (input.isFavorite ? 1 : 0) : null,
      input.socialLinks ? JSON.stringify(input.socialLinks) : null,
      input.customFields ? JSON.stringify(input.customFields) : null,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM contacts WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  recordContact(id: string): Contact | null {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE contacts SET
        last_contacted_at = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(now, now, id, this.userId);
    return this.get(id);
  }

  toggleFavorite(id: string): Contact | null {
    const existing = this.get(id);
    if (!existing) return null;

    return this.update(id, { isFavorite: !existing.isFavorite });
  }

  list(query: ContactQuery = {}): Contact[] {
    let sql = `SELECT * FROM contacts WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.relationship) {
      sql += ` AND relationship = ?`;
      params.push(query.relationship);
    }

    if (query.company) {
      sql += ` AND company = ?`;
      params.push(query.company);
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
      sql += ` AND (name LIKE ? OR nickname LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)`;
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY is_favorite DESC, name ASC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], ContactRow>(sql);
    return stmt.all(...params).map(rowToContact);
  }

  getFavorites(): Contact[] {
    return this.list({ isFavorite: true });
  }

  getByRelationship(relationship: string): Contact[] {
    return this.list({ relationship });
  }

  getByCompany(company: string): Contact[] {
    return this.list({ company });
  }

  getRecentlyContacted(limit = 10): Contact[] {
    const stmt = this.db.prepare<[string, number], ContactRow>(`
      SELECT * FROM contacts
      WHERE user_id = ? AND last_contacted_at IS NOT NULL
      ORDER BY last_contacted_at DESC
      LIMIT ?
    `);

    return stmt.all(this.userId, limit).map(rowToContact);
  }

  getUpcomingBirthdays(days = 30): Contact[] {
    const today = new Date();
    const results: Contact[] = [];

    // Get all contacts with birthdays
    const stmt = this.db.prepare<string, ContactRow>(`
      SELECT * FROM contacts
      WHERE user_id = ? AND birthday IS NOT NULL
    `);

    for (const row of stmt.all(this.userId)) {
      const contact = rowToContact(row);
      if (!contact.birthday) continue;

      // Parse birthday (format: MM-DD or YYYY-MM-DD)
      const parts = contact.birthday.split('-');
      if (parts.length < 2) continue;

      const month = parseInt(parts.length === 3 ? parts[1]! : parts[0]!, 10) - 1;
      const day = parseInt(parts.length === 3 ? parts[2]! : parts[1]!, 10);

      // Create date for this year's birthday
      const birthdayThisYear = new Date(today.getFullYear(), month, day);

      // If birthday has passed this year, check next year
      if (birthdayThisYear < today) {
        birthdayThisYear.setFullYear(today.getFullYear() + 1);
      }

      // Check if within range
      const daysUntil = Math.ceil((birthdayThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= days) {
        results.push(contact);
      }
    }

    return results.sort((a, b) => {
      // Sort by days until birthday
      const aDate = new Date(a.birthday!);
      const bDate = new Date(b.birthday!);
      return aDate.getTime() - bDate.getTime();
    });
  }

  getRelationships(): string[] {
    const stmt = this.db.prepare<string, { relationship: string }>(`
      SELECT DISTINCT relationship FROM contacts
      WHERE user_id = ? AND relationship IS NOT NULL
      ORDER BY relationship
    `);

    return stmt.all(this.userId).map(r => r.relationship);
  }

  getCompanies(): string[] {
    const stmt = this.db.prepare<string, { company: string }>(`
      SELECT DISTINCT company FROM contacts
      WHERE user_id = ? AND company IS NOT NULL
      ORDER BY company
    `);

    return stmt.all(this.userId).map(r => r.company);
  }

  getTags(): string[] {
    const stmt = this.db.prepare<string, { tags: string }>(`
      SELECT tags FROM contacts WHERE user_id = ?
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
      SELECT COUNT(*) as count FROM contacts WHERE user_id = ?
    `);

    return stmt.get(this.userId)?.count ?? 0;
  }

  search(query: string, limit = 20): Contact[] {
    return this.list({ search: query, limit });
  }
}

export const contactsRepo = new ContactsRepository();

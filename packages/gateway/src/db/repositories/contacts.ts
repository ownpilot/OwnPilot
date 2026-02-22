/**
 * Contacts Repository (PostgreSQL)
 *
 * CRUD operations for personal contacts
 */

import { BaseRepository, parseJsonField } from './base.js';
import { MS_PER_DAY } from '../../config/defaults.js';

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
  is_favorite: boolean;
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
    tags: parseJsonField(row.tags, []),
    isFavorite: row.is_favorite === true,
    externalId: row.external_id ?? undefined,
    externalSource: row.external_source ?? undefined,
    socialLinks: parseJsonField(row.social_links, {}),
    customFields: parseJsonField(row.custom_fields, {}),
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class ContactsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateContactInput): Promise<Contact> {
    const id = crypto.randomUUID();

    await this.execute(
      `INSERT INTO contacts (id, user_id, name, nickname, email, phone, company, job_title,
        avatar, birthday, address, notes, relationship, tags, is_favorite,
        external_id, external_source, social_links, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
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
        input.isFavorite ?? false,
        input.externalId ?? null,
        input.externalSource ?? null,
        JSON.stringify(input.socialLinks ?? {}),
        JSON.stringify(input.customFields ?? {}),
      ]
    );

    const result = await this.get(id);
    if (!result) throw new Error('Failed to create contact');
    return result;
  }

  async get(id: string): Promise<Contact | null> {
    const row = await this.queryOne<ContactRow>(
      `SELECT * FROM contacts WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToContact(row) : null;
  }

  async getByEmail(email: string): Promise<Contact | null> {
    const row = await this.queryOne<ContactRow>(
      `SELECT * FROM contacts WHERE email = $1 AND user_id = $2`,
      [email, this.userId]
    );
    return row ? rowToContact(row) : null;
  }

  async getByPhone(phone: string): Promise<Contact | null> {
    const row = await this.queryOne<ContactRow>(
      `SELECT * FROM contacts WHERE phone = $1 AND user_id = $2`,
      [phone, this.userId]
    );
    return row ? rowToContact(row) : null;
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.nickname !== undefined) {
      updates.push(`nickname = $${paramIndex++}`);
      values.push(input.nickname);
    }
    if (input.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(input.email);
    }
    if (input.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(input.phone);
    }
    if (input.company !== undefined) {
      updates.push(`company = $${paramIndex++}`);
      values.push(input.company);
    }
    if (input.jobTitle !== undefined) {
      updates.push(`job_title = $${paramIndex++}`);
      values.push(input.jobTitle);
    }
    if (input.avatar !== undefined) {
      updates.push(`avatar = $${paramIndex++}`);
      values.push(input.avatar);
    }
    if (input.birthday !== undefined) {
      updates.push(`birthday = $${paramIndex++}`);
      values.push(input.birthday);
    }
    if (input.address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(input.address);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(input.notes);
    }
    if (input.relationship !== undefined) {
      updates.push(`relationship = $${paramIndex++}`);
      values.push(input.relationship);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.isFavorite !== undefined) {
      updates.push(`is_favorite = $${paramIndex++}`);
      values.push(input.isFavorite);
    }
    if (input.socialLinks !== undefined) {
      updates.push(`social_links = $${paramIndex++}`);
      values.push(JSON.stringify(input.socialLinks));
    }
    if (input.customFields !== undefined) {
      updates.push(`custom_fields = $${paramIndex++}`);
      values.push(JSON.stringify(input.customFields));
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = NOW()');
    values.push(id, this.userId);

    await this.execute(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM contacts WHERE id = $1 AND user_id = $2`, [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  async recordContact(id: string): Promise<Contact | null> {
    await this.execute(
      `UPDATE contacts SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return this.get(id);
  }

  async toggleFavorite(id: string): Promise<Contact | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.update(id, { isFavorite: !existing.isFavorite });
  }

  async list(query: ContactQuery = {}): Promise<Contact[]> {
    let sql = `SELECT * FROM contacts WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.relationship) {
      sql += ` AND relationship = $${paramIndex++}`;
      params.push(query.relationship);
    }

    if (query.company) {
      sql += ` AND company = $${paramIndex++}`;
      params.push(query.company);
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
      sql += ` AND (name ILIKE $${paramIndex} OR nickname ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR company ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    sql += ` ORDER BY is_favorite DESC, name ASC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<ContactRow>(sql, params);
    return rows.map(rowToContact);
  }

  async getFavorites(): Promise<Contact[]> {
    return this.list({ isFavorite: true });
  }

  async getByRelationship(relationship: string): Promise<Contact[]> {
    return this.list({ relationship });
  }

  async getByCompany(company: string): Promise<Contact[]> {
    return this.list({ company });
  }

  async getRecentlyContacted(limit = 10): Promise<Contact[]> {
    const rows = await this.query<ContactRow>(
      `SELECT * FROM contacts WHERE user_id = $1 AND last_contacted_at IS NOT NULL ORDER BY last_contacted_at DESC LIMIT $2`,
      [this.userId, limit]
    );
    return rows.map(rowToContact);
  }

  async getUpcomingBirthdays(days = 30): Promise<Contact[]> {
    // Get all contacts with birthdays and filter in JS
    const rows = await this.query<ContactRow>(
      `SELECT * FROM contacts WHERE user_id = $1 AND birthday IS NOT NULL`,
      [this.userId]
    );

    const today = new Date();
    const results: Contact[] = [];

    for (const row of rows) {
      const contact = rowToContact(row);
      if (!contact.birthday) continue;

      const parts = contact.birthday.split('-');
      if (parts.length < 2) continue;

      const month = parseInt(parts.length === 3 ? parts[1]! : parts[0]!, 10) - 1;
      const day = parseInt(parts.length === 3 ? parts[2]! : parts[1]!, 10);

      const birthdayThisYear = new Date(today.getFullYear(), month, day);
      if (birthdayThisYear < today) {
        birthdayThisYear.setFullYear(today.getFullYear() + 1);
      }

      const daysUntil = Math.ceil((birthdayThisYear.getTime() - today.getTime()) / MS_PER_DAY);
      if (daysUntil <= days) {
        results.push(contact);
      }
    }

    return results;
  }

  async getRelationships(): Promise<string[]> {
    const rows = await this.query<{ relationship: string }>(
      `SELECT DISTINCT relationship FROM contacts WHERE user_id = $1 AND relationship IS NOT NULL ORDER BY relationship`,
      [this.userId]
    );
    return rows.map((r) => r.relationship);
  }

  async getCompanies(): Promise<string[]> {
    const rows = await this.query<{ company: string }>(
      `SELECT DISTINCT company FROM contacts WHERE user_id = $1 AND company IS NOT NULL ORDER BY company`,
      [this.userId]
    );
    return rows.map((r) => r.company);
  }

  async getTags(): Promise<string[]> {
    const rows = await this.query<{ tags: string }>(
      `SELECT tags FROM contacts WHERE user_id = $1`,
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

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM contacts WHERE user_id = $1`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async search(searchQuery: string, limit = 20): Promise<Contact[]> {
    return this.list({ search: searchQuery, limit });
  }
}

export const contactsRepo = new ContactsRepository();

// Factory function
export function createContactsRepository(userId = 'default'): ContactsRepository {
  return new ContactsRepository(userId);
}

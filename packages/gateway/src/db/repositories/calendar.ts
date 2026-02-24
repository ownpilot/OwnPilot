/**
 * Calendar Events Repository (PostgreSQL)
 *
 * CRUD operations for calendar events
 */

import { BaseRepository, parseJsonField } from './base.js';
import { buildUpdateStatement, type RawSetClause } from './query-helpers.js';
import { MS_PER_DAY } from '../../config/defaults.js';

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime?: Date;
  allDay: boolean;
  timezone: string;
  recurrence?: string;
  reminderMinutes?: number;
  category?: string;
  tags: string[];
  color?: string;
  externalId?: string;
  externalSource?: string;
  attendees: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  startTime: string | Date;
  endTime?: string | Date;
  allDay?: boolean;
  timezone?: string;
  recurrence?: string;
  reminderMinutes?: number;
  category?: string;
  tags?: string[];
  color?: string;
  externalId?: string;
  externalSource?: string;
  attendees?: string[];
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  allDay?: boolean;
  timezone?: string;
  recurrence?: string;
  reminderMinutes?: number;
  category?: string;
  tags?: string[];
  color?: string;
  attendees?: string[];
}

export interface EventQuery {
  startAfter?: string | Date;
  startBefore?: string | Date;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface EventRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  timezone: string;
  recurrence: string | null;
  reminder_minutes: number | null;
  category: string | null;
  tags: string;
  color: string | null;
  external_id: string | null;
  external_source: string | null;
  attendees: string;
  created_at: string;
  updated_at: string;
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    allDay: row.all_day === true,
    timezone: row.timezone,
    recurrence: row.recurrence ?? undefined,
    reminderMinutes: row.reminder_minutes ?? undefined,
    category: row.category ?? undefined,
    tags: parseJsonField(row.tags, []),
    color: row.color ?? undefined,
    externalId: row.external_id ?? undefined,
    externalSource: row.external_source ?? undefined,
    attendees: parseJsonField(row.attendees, []),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toISOString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class CalendarRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateEventInput): Promise<CalendarEvent> {
    const id = crypto.randomUUID();

    await this.execute(
      `INSERT INTO calendar_events (id, user_id, title, description, location, start_time, end_time,
        all_day, timezone, recurrence, reminder_minutes, category, tags, color,
        external_id, external_source, attendees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id,
        this.userId,
        input.title,
        input.description ?? null,
        input.location ?? null,
        toISOString(input.startTime),
        input.endTime ? toISOString(input.endTime) : null,
        input.allDay ?? false,
        input.timezone ?? 'UTC',
        input.recurrence ?? null,
        input.reminderMinutes ?? null,
        input.category ?? null,
        JSON.stringify(input.tags ?? []),
        input.color ?? null,
        input.externalId ?? null,
        input.externalSource ?? null,
        JSON.stringify(input.attendees ?? []),
      ]
    );

    const result = await this.get(id);
    if (!result) throw new Error('Failed to create calendar event');
    return result;
  }

  async get(id: string): Promise<CalendarEvent | null> {
    const row = await this.queryOne<EventRow>(
      `SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToEvent(row) : null;
  }

  async getByExternalId(externalId: string, source: string): Promise<CalendarEvent | null> {
    const row = await this.queryOne<EventRow>(
      `SELECT * FROM calendar_events WHERE external_id = $1 AND external_source = $2 AND user_id = $3`,
      [externalId, source, this.userId]
    );
    return row ? rowToEvent(row) : null;
  }

  async update(id: string, input: UpdateEventInput): Promise<CalendarEvent | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const fields = [
      { column: 'title', value: input.title },
      { column: 'description', value: input.description },
      { column: 'location', value: input.location },
      {
        column: 'start_time',
        value: input.startTime !== undefined ? toISOString(input.startTime) : undefined,
      },
      {
        column: 'end_time',
        value: input.endTime !== undefined ? toISOString(input.endTime) : undefined,
      },
      { column: 'all_day', value: input.allDay },
      { column: 'timezone', value: input.timezone },
      { column: 'recurrence', value: input.recurrence },
      { column: 'reminder_minutes', value: input.reminderMinutes },
      { column: 'category', value: input.category },
      { column: 'tags', value: input.tags !== undefined ? JSON.stringify(input.tags) : undefined },
      { column: 'color', value: input.color },
      {
        column: 'attendees',
        value: input.attendees !== undefined ? JSON.stringify(input.attendees) : undefined,
      },
    ];

    const hasChanges = fields.some((f) => f.value !== undefined);
    if (!hasChanges) return existing;

    const rawClauses: RawSetClause[] = [{ sql: 'updated_at = NOW()' }];

    const stmt = buildUpdateStatement(
      'calendar_events',
      fields,
      [
        { column: 'id', value: id },
        { column: 'user_id', value: this.userId },
      ],
      1,
      rawClauses
    );

    if (!stmt) return existing;

    await this.execute(stmt.sql, stmt.params);

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM calendar_events WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async list(query: EventQuery = {}): Promise<CalendarEvent[]> {
    let sql = `SELECT * FROM calendar_events WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.startAfter) {
      sql += ` AND start_time >= $${paramIndex++}`;
      params.push(toISOString(query.startAfter));
    }

    if (query.startBefore) {
      sql += ` AND start_time <= $${paramIndex++}`;
      params.push(toISOString(query.startBefore));
    }

    if (query.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(query.category);
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR location ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    sql += ` ORDER BY start_time ASC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(query.offset);
    }

    const rows = await this.query<EventRow>(sql, params);
    return rows.map(rowToEvent);
  }

  async getToday(): Promise<CalendarEvent[]> {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + MS_PER_DAY - 1);

    return this.list({
      startAfter: startOfDay,
      startBefore: endOfDay,
    });
  }

  async getUpcoming(days = 7): Promise<CalendarEvent[]> {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * MS_PER_DAY);

    return this.list({
      startAfter: now,
      startBefore: futureDate,
    });
  }

  async getByDateRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    return this.list({
      startAfter: start,
      startBefore: end,
    });
  }

  async getUpcomingReminders(minutes = 30): Promise<CalendarEvent[]> {
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + minutes * 60 * 1000);

    const rows = await this.query<EventRow>(
      `SELECT * FROM calendar_events
       WHERE user_id = $1
         AND reminder_minutes IS NOT NULL
         AND start_time > $2
         AND start_time - (reminder_minutes * INTERVAL '1 minute') <= $3
       ORDER BY start_time ASC`,
      [this.userId, now.toISOString(), reminderWindow.toISOString()]
    );

    return rows.map(rowToEvent);
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM calendar_events WHERE user_id = $1 AND category IS NOT NULL ORDER BY category`,
      [this.userId]
    );
    return rows.map((r) => r.category);
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM calendar_events WHERE user_id = $1`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async search(searchQuery: string, limit = 20): Promise<CalendarEvent[]> {
    return this.list({ search: searchQuery, limit });
  }
}

export const calendarRepo = new CalendarRepository();

// Factory function
export function createCalendarRepository(userId = 'default'): CalendarRepository {
  return new CalendarRepository(userId);
}

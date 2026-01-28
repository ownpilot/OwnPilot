/**
 * Calendar Events Repository
 *
 * CRUD operations for calendar events
 */

import { getDatabase } from '../connection.js';

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
  all_day: number;
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
    allDay: row.all_day === 1,
    timezone: row.timezone,
    recurrence: row.recurrence ?? undefined,
    reminderMinutes: row.reminder_minutes ?? undefined,
    category: row.category ?? undefined,
    tags: JSON.parse(row.tags || '[]'),
    color: row.color ?? undefined,
    externalId: row.external_id ?? undefined,
    externalSource: row.external_source ?? undefined,
    attendees: JSON.parse(row.attendees || '[]'),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toISOString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class CalendarRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  create(input: CreateEventInput): CalendarEvent {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO calendar_events (id, user_id, title, description, location, start_time, end_time,
        all_day, timezone, recurrence, reminder_minutes, category, tags, color,
        external_id, external_source, attendees, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.title,
      input.description ?? null,
      input.location ?? null,
      toISOString(input.startTime),
      input.endTime ? toISOString(input.endTime) : null,
      input.allDay ? 1 : 0,
      input.timezone ?? 'UTC',
      input.recurrence ?? null,
      input.reminderMinutes ?? null,
      input.category ?? null,
      JSON.stringify(input.tags ?? []),
      input.color ?? null,
      input.externalId ?? null,
      input.externalSource ?? null,
      JSON.stringify(input.attendees ?? []),
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): CalendarEvent | null {
    const stmt = this.db.prepare<[string, string], EventRow>(`
      SELECT * FROM calendar_events WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToEvent(row) : null;
  }

  getByExternalId(externalId: string, source: string): CalendarEvent | null {
    const stmt = this.db.prepare<[string, string, string], EventRow>(`
      SELECT * FROM calendar_events
      WHERE external_id = ? AND external_source = ? AND user_id = ?
    `);

    const row = stmt.get(externalId, source, this.userId);
    return row ? rowToEvent(row) : null;
  }

  update(id: string, input: UpdateEventInput): CalendarEvent | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE calendar_events SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        location = COALESCE(?, location),
        start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time),
        all_day = COALESCE(?, all_day),
        timezone = COALESCE(?, timezone),
        recurrence = COALESCE(?, recurrence),
        reminder_minutes = COALESCE(?, reminder_minutes),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        color = COALESCE(?, color),
        attendees = COALESCE(?, attendees),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.title ?? null,
      input.description ?? null,
      input.location ?? null,
      input.startTime ? toISOString(input.startTime) : null,
      input.endTime ? toISOString(input.endTime) : null,
      input.allDay !== undefined ? (input.allDay ? 1 : 0) : null,
      input.timezone ?? null,
      input.recurrence ?? null,
      input.reminderMinutes ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.color ?? null,
      input.attendees ? JSON.stringify(input.attendees) : null,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  list(query: EventQuery = {}): CalendarEvent[] {
    let sql = `SELECT * FROM calendar_events WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.startAfter) {
      sql += ` AND start_time >= ?`;
      params.push(toISOString(query.startAfter));
    }

    if (query.startBefore) {
      sql += ` AND start_time <= ?`;
      params.push(toISOString(query.startBefore));
    }

    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }

    if (query.search) {
      sql += ` AND (title LIKE ? OR description LIKE ? OR location LIKE ?)`;
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY start_time ASC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    const stmt = this.db.prepare<unknown[], EventRow>(sql);
    return stmt.all(...params).map(rowToEvent);
  }

  getToday(): CalendarEvent[] {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

    return this.list({
      startAfter: startOfDay,
      startBefore: endOfDay,
    });
  }

  getUpcoming(days = 7): CalendarEvent[] {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return this.list({
      startAfter: now,
      startBefore: futureDate,
    });
  }

  getByDateRange(start: Date, end: Date): CalendarEvent[] {
    return this.list({
      startAfter: start,
      startBefore: end,
    });
  }

  getUpcomingReminders(minutes = 30): CalendarEvent[] {
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + minutes * 60 * 1000);

    const stmt = this.db.prepare<[string, string, string], EventRow>(`
      SELECT * FROM calendar_events
      WHERE user_id = ?
        AND reminder_minutes IS NOT NULL
        AND start_time > ?
        AND datetime(start_time, '-' || reminder_minutes || ' minutes') <= ?
      ORDER BY start_time ASC
    `);

    return stmt.all(
      this.userId,
      now.toISOString(),
      reminderWindow.toISOString()
    ).map(rowToEvent);
  }

  getCategories(): string[] {
    const stmt = this.db.prepare<string, { category: string }>(`
      SELECT DISTINCT category FROM calendar_events
      WHERE user_id = ? AND category IS NOT NULL
      ORDER BY category
    `);

    return stmt.all(this.userId).map(r => r.category);
  }

  count(): number {
    const stmt = this.db.prepare<string, { count: number }>(`
      SELECT COUNT(*) as count FROM calendar_events WHERE user_id = ?
    `);

    return stmt.get(this.userId)?.count ?? 0;
  }

  search(query: string, limit = 20): CalendarEvent[] {
    return this.list({ search: query, limit });
  }
}

export const calendarRepo = new CalendarRepository();

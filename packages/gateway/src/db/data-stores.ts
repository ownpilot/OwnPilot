/**
 * SQLite-backed Data Stores
 *
 * Implements the DataStore interface from @ownpilot/core using SQLite repositories.
 * This allows the DataGateway to use persistent storage.
 */

import type {
  DataStore,
  Bookmark,
  Note,
  MemoryItem,
  Task,
  PersonalCalendarEvent,
  Contact,
} from '@ownpilot/core';

import {
  BookmarksRepository,
  NotesRepository,
  TasksRepository,
  CalendarRepository,
  ContactsRepository,
} from './repositories/index.js';

/**
 * SQLite-backed Bookmark Store
 */
export class SQLiteBookmarkStore implements DataStore<Bookmark> {
  private repo: BookmarksRepository;

  constructor(userId = 'default') {
    this.repo = new BookmarksRepository(userId);
  }

  async get(id: string): Promise<Bookmark | null> {
    const bookmark = this.repo.get(id);
    if (!bookmark) return null;
    return {
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      description: bookmark.description,
      tags: bookmark.tags,
      category: bookmark.category,
      favicon: bookmark.favicon,
      createdAt: bookmark.createdAt.toISOString(),
      updatedAt: bookmark.updatedAt.toISOString(),
    };
  }

  async list(filter?: Record<string, unknown>): Promise<Bookmark[]> {
    const bookmarks = this.repo.list({
      category: filter?.category as string | undefined,
      tags: filter?.tags as string[] | undefined,
      isFavorite: filter?.isFavorite as boolean | undefined,
    });
    return bookmarks.map((b) => ({
      id: b.id,
      url: b.url,
      title: b.title,
      description: b.description,
      tags: b.tags,
      category: b.category,
      favicon: b.favicon,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  async search(query: string): Promise<Bookmark[]> {
    const bookmarks = this.repo.search(query);
    return bookmarks.map((b) => ({
      id: b.id,
      url: b.url,
      title: b.title,
      description: b.description,
      tags: b.tags,
      category: b.category,
      favicon: b.favicon,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  async create(data: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark> {
    const bookmark = this.repo.create({
      url: data.url,
      title: data.title,
      description: data.description,
      tags: data.tags,
      category: data.category,
      favicon: data.favicon,
    });
    return {
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      description: bookmark.description,
      tags: bookmark.tags,
      category: bookmark.category,
      favicon: bookmark.favicon,
      createdAt: bookmark.createdAt.toISOString(),
      updatedAt: bookmark.updatedAt.toISOString(),
    };
  }

  async update(id: string, data: Partial<Bookmark>): Promise<Bookmark | null> {
    const bookmark = this.repo.update(id, {
      url: data.url,
      title: data.title,
      description: data.description,
      tags: data.tags,
      category: data.category,
      favicon: data.favicon,
    });
    if (!bookmark) return null;
    return {
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      description: bookmark.description,
      tags: bookmark.tags,
      category: bookmark.category,
      favicon: bookmark.favicon,
      createdAt: bookmark.createdAt.toISOString(),
      updatedAt: bookmark.updatedAt.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }
}

/**
 * SQLite-backed Note Store
 */
export class SQLiteNoteStore implements DataStore<Note> {
  private repo: NotesRepository;

  constructor(userId = 'default') {
    this.repo = new NotesRepository(userId);
  }

  async get(id: string): Promise<Note | null> {
    const note = this.repo.get(id);
    if (!note) return null;
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      category: note.category,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async list(filter?: Record<string, unknown>): Promise<Note[]> {
    const notes = this.repo.list({
      category: filter?.category as string | undefined,
      tags: filter?.tags as string[] | undefined,
      isPinned: filter?.isPinned as boolean | undefined,
      isArchived: filter?.isArchived as boolean | undefined,
    });
    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      tags: n.tags,
      category: n.category,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  async search(query: string): Promise<Note[]> {
    const notes = this.repo.search(query);
    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      tags: n.tags,
      category: n.category,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  async create(data: Omit<Note, 'id' | 'createdAt'>): Promise<Note> {
    const note = this.repo.create({
      title: data.title ?? '',
      content: data.content,
      tags: data.tags,
      category: data.category,
    });
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      category: note.category,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async update(id: string, data: Partial<Note>): Promise<Note | null> {
    const note = this.repo.update(id, {
      title: data.title,
      content: data.content,
      tags: data.tags,
      category: data.category,
    });
    if (!note) return null;
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      category: note.category,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }
}

/**
 * SQLite-backed Task Store
 */
export class SQLiteTaskStore implements DataStore<Task> {
  private repo: TasksRepository;

  constructor(userId = 'default') {
    this.repo = new TasksRepository(userId);
  }

  async get(id: string): Promise<Task | null> {
    const task = this.repo.get(id);
    if (!task) return null;
    return this.mapTask(task);
  }

  async list(filter?: Record<string, unknown>): Promise<Task[]> {
    const tasks = this.repo.list({
      status: filter?.status as 'pending' | 'in_progress' | 'completed' | 'cancelled' | undefined,
      priority: filter?.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined,
      projectId: filter?.projectId as string | undefined,
    });
    return tasks.map((t) => this.mapTask(t));
  }

  async search(query: string): Promise<Task[]> {
    const tasks = this.repo.search(query);
    return tasks.map((t) => this.mapTask(t));
  }

  async create(data: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const task = this.repo.create({
      title: data.title,
      description: data.description,
      priority: data.priority,
      dueDate: data.dueDate,
      dueTime: data.dueTime,
      reminderAt: data.reminderAt,
      category: data.category,
      tags: data.tags,
      parentId: data.parentId,
      projectId: data.projectId,
      recurrence: data.recurrence,
    });
    return this.mapTask(task);
  }

  async update(id: string, data: Partial<Task>): Promise<Task | null> {
    const task = this.repo.update(id, {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      dueDate: data.dueDate,
      dueTime: data.dueTime,
      reminderAt: data.reminderAt,
      category: data.category,
      tags: data.tags,
      recurrence: data.recurrence,
    });
    if (!task) return null;
    return this.mapTask(task);
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }

  private mapTask(task: ReturnType<TasksRepository['get']> & object): Task {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      reminderAt: task.reminderAt,
      category: task.category,
      tags: task.tags,
      parentId: task.parentId,
      projectId: task.projectId,
      recurrence: task.recurrence,
      completedAt: task.completedAt,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}

/**
 * SQLite-backed Calendar Store
 */
export class SQLiteCalendarStore implements DataStore<PersonalCalendarEvent> {
  private repo: CalendarRepository;

  constructor(userId = 'default') {
    this.repo = new CalendarRepository(userId);
  }

  async get(id: string): Promise<PersonalCalendarEvent | null> {
    const event = this.repo.get(id);
    if (!event) return null;
    return this.mapEvent(event);
  }

  async list(filter?: Record<string, unknown>): Promise<PersonalCalendarEvent[]> {
    const events = this.repo.list({
      category: filter?.category as string | undefined,
    });
    return events.map((e) => this.mapEvent(e));
  }

  async search(query: string): Promise<PersonalCalendarEvent[]> {
    const events = this.repo.search(query);
    return events.map((e) => this.mapEvent(e));
  }

  async create(data: Omit<PersonalCalendarEvent, 'id' | 'createdAt'>): Promise<PersonalCalendarEvent> {
    const event = this.repo.create({
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay,
      timezone: data.timezone,
      recurrence: data.recurrence,
      reminderMinutes: data.reminderMinutes,
      category: data.category,
      tags: data.tags,
      color: data.color,
      externalId: data.externalId,
      externalSource: data.externalSource,
      attendees: data.attendees,
    });
    return this.mapEvent(event);
  }

  async update(id: string, data: Partial<PersonalCalendarEvent>): Promise<PersonalCalendarEvent | null> {
    const event = this.repo.update(id, {
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay,
      timezone: data.timezone,
      recurrence: data.recurrence,
      reminderMinutes: data.reminderMinutes,
      category: data.category,
      tags: data.tags,
      color: data.color,
      attendees: data.attendees,
    });
    if (!event) return null;
    return this.mapEvent(event);
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }

  private mapEvent(event: ReturnType<CalendarRepository['get']> & object): PersonalCalendarEvent {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime?.toISOString(),
      allDay: event.allDay,
      timezone: event.timezone,
      recurrence: event.recurrence,
      reminderMinutes: event.reminderMinutes,
      category: event.category,
      tags: event.tags,
      color: event.color,
      externalId: event.externalId,
      externalSource: event.externalSource,
      attendees: event.attendees,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}

/**
 * SQLite-backed Contact Store
 */
export class SQLiteContactStore implements DataStore<Contact> {
  private repo: ContactsRepository;

  constructor(userId = 'default') {
    this.repo = new ContactsRepository(userId);
  }

  async get(id: string): Promise<Contact | null> {
    const contact = this.repo.get(id);
    if (!contact) return null;
    return this.mapContact(contact);
  }

  async list(filter?: Record<string, unknown>): Promise<Contact[]> {
    const contacts = this.repo.list({
      relationship: filter?.relationship as string | undefined,
      company: filter?.company as string | undefined,
      isFavorite: filter?.isFavorite as boolean | undefined,
    });
    return contacts.map((c) => this.mapContact(c));
  }

  async search(query: string): Promise<Contact[]> {
    const contacts = this.repo.search(query);
    return contacts.map((c) => this.mapContact(c));
  }

  async create(data: Omit<Contact, 'id' | 'createdAt'>): Promise<Contact> {
    const contact = this.repo.create({
      name: data.name,
      nickname: data.nickname,
      email: data.email,
      phone: data.phone,
      company: data.company,
      jobTitle: data.jobTitle,
      avatar: data.avatar,
      birthday: data.birthday,
      address: data.address,
      notes: data.notes,
      relationship: data.relationship,
      tags: data.tags,
      isFavorite: data.isFavorite,
      socialLinks: data.socialLinks,
      customFields: data.customFields,
    });
    return this.mapContact(contact);
  }

  async update(id: string, data: Partial<Contact>): Promise<Contact | null> {
    const contact = this.repo.update(id, {
      name: data.name,
      nickname: data.nickname,
      email: data.email,
      phone: data.phone,
      company: data.company,
      jobTitle: data.jobTitle,
      avatar: data.avatar,
      birthday: data.birthday,
      address: data.address,
      notes: data.notes,
      relationship: data.relationship,
      tags: data.tags,
      isFavorite: data.isFavorite,
      socialLinks: data.socialLinks,
      customFields: data.customFields,
    });
    if (!contact) return null;
    return this.mapContact(contact);
  }

  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }

  private mapContact(contact: ReturnType<ContactsRepository['get']> & object): Contact {
    return {
      id: contact.id,
      name: contact.name,
      nickname: contact.nickname,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      jobTitle: contact.jobTitle,
      avatar: contact.avatar,
      birthday: contact.birthday,
      address: contact.address,
      notes: contact.notes,
      relationship: contact.relationship,
      tags: contact.tags,
      isFavorite: contact.isFavorite,
      socialLinks: contact.socialLinks,
      customFields: contact.customFields,
      lastContactedAt: contact.lastContactedAt?.toISOString(),
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  }
}

/**
 * Create all SQLite-backed data stores
 */
export function createSQLiteDataStores(userId = 'default') {
  return {
    bookmarks: new SQLiteBookmarkStore(userId),
    notes: new SQLiteNoteStore(userId),
    tasks: new SQLiteTaskStore(userId),
    calendar: new SQLiteCalendarStore(userId),
    contacts: new SQLiteContactStore(userId),
  };
}

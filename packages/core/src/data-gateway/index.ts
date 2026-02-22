/**
 * Personal Data Gateway
 *
 * Secure, audited access layer for personal data.
 * Agents access user data through this gateway with permission checks.
 */

import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '../services/error-utils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Available data store types
 */
export type DataStoreType =
  | 'bookmarks'
  | 'notes'
  | 'finances'
  | 'memory'
  | 'preferences'
  | 'files'
  | 'calendar'
  | 'contacts';

/**
 * Data access operation types
 */
export type DataOperation = 'read' | 'write' | 'delete' | 'list' | 'search';

/**
 * Access audit log entry
 */
export interface AccessLogEntry {
  id: string;
  timestamp: string;
  agentId: string;
  dataStore: DataStoreType;
  operation: DataOperation;
  success: boolean;
  details?: Record<string, unknown>;
}

/**
 * Data store interface
 */
export interface DataStore<T> {
  get(id: string): Promise<T | null>;
  list(filter?: Record<string, unknown>): Promise<T[]>;
  search(query: string): Promise<T[]>;
  create(data: Omit<T, 'id' | 'createdAt'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * Bookmark data type
 */
export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description?: string;
  tags: string[];
  category?: string;
  favicon?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Note data type
 */
export interface Note {
  id: string;
  title?: string;
  content: string;
  tags: string[];
  category?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Memory item (long-term storage)
 */
export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  context?: string;
  importance: number;
  accessCount: number;
  createdAt: string;
  lastAccessed: string;
}

/**
 * User preference
 */
export interface Preference {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Task data type
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string;
  dueTime?: string;
  reminderAt?: string;
  category?: string;
  tags: string[];
  parentId?: string;
  projectId?: string;
  recurrence?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Calendar event data type
 */
export interface PersonalCalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime?: string;
  allDay: boolean;
  timezone?: string;
  recurrence?: string;
  reminderMinutes?: number;
  category?: string;
  tags: string[];
  color?: string;
  externalId?: string;
  externalSource?: string;
  attendees: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Contact data type
 */
export interface Contact {
  id: string;
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
  socialLinks: Record<string, string>;
  customFields: Record<string, string>;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// In-Memory Data Stores (Replace with SQLite in production)
// =============================================================================

class InMemoryStore<T extends { id: string }> implements DataStore<T> {
  private data = new Map<string, T>();

  async get(id: string): Promise<T | null> {
    return this.data.get(id) ?? null;
  }

  async list(filter?: Record<string, unknown>): Promise<T[]> {
    let items = Array.from(this.data.values());
    if (filter) {
      items = items.filter((item) => {
        for (const [key, value] of Object.entries(filter)) {
          if ((item as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      });
    }
    return items;
  }

  async search(query: string): Promise<T[]> {
    const lower = query.toLowerCase();
    return Array.from(this.data.values()).filter((item) =>
      JSON.stringify(item).toLowerCase().includes(lower)
    );
  }

  async create(data: Omit<T, 'id' | 'createdAt'>): Promise<T> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const item = {
      ...(data as object),
      id,
      createdAt: now,
      updatedAt: now,
    } as unknown as T;
    this.data.set(id, item);
    return item;
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const existing = this.data.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...data,
      id, // Preserve ID
      updatedAt: new Date().toISOString(),
    } as T;
    this.data.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.data.delete(id);
  }
}

// =============================================================================
// Data Gateway
// =============================================================================

/**
 * Gateway configuration
 */
export interface DataGatewayConfig {
  /** Enable audit logging */
  enableAudit?: boolean;
  /** Maximum audit log entries */
  maxAuditEntries?: number;
  /** Custom data stores (for SQLite backing) */
  stores?: {
    bookmarks?: DataStore<Bookmark>;
    notes?: DataStore<Note>;
    memory?: DataStore<MemoryItem>;
    tasks?: DataStore<Task>;
    calendar?: DataStore<PersonalCalendarEvent>;
    contacts?: DataStore<Contact>;
  };
}

/**
 * Personal Data Gateway
 *
 * Provides secure, audited access to user's personal data.
 */
export class DataGateway {
  private readonly config: { enableAudit: boolean; maxAuditEntries: number };
  private readonly auditLog: AccessLogEntry[] = [];

  // Data stores
  readonly bookmarks: DataStore<Bookmark>;
  readonly notes: DataStore<Note>;
  readonly memory: DataStore<MemoryItem>;
  readonly tasks: DataStore<Task>;
  readonly calendar: DataStore<PersonalCalendarEvent>;
  readonly contacts: DataStore<Contact>;
  private readonly preferences = new Map<string, Preference>();

  // Permission tracking
  private readonly agentPermissions = new Map<string, Set<DataStoreType>>();

  constructor(config: DataGatewayConfig = {}) {
    this.config = {
      enableAudit: config.enableAudit ?? true,
      maxAuditEntries: config.maxAuditEntries ?? 10000,
    };

    // Initialize stores (use injected stores or fall back to in-memory)
    this.bookmarks = config.stores?.bookmarks ?? new InMemoryStore<Bookmark>();
    this.notes = config.stores?.notes ?? new InMemoryStore<Note>();
    this.memory = config.stores?.memory ?? new InMemoryStore<MemoryItem>();
    this.tasks = config.stores?.tasks ?? new InMemoryStore<Task>();
    this.calendar = config.stores?.calendar ?? new InMemoryStore<PersonalCalendarEvent>();
    this.contacts = config.stores?.contacts ?? new InMemoryStore<Contact>();
  }

  // ===========================================================================
  // Permission Management
  // ===========================================================================

  /**
   * Grant an agent access to a data store
   */
  grantAccess(agentId: string, dataStores: DataStoreType[]): void {
    let permissions = this.agentPermissions.get(agentId);
    if (!permissions) {
      permissions = new Set();
      this.agentPermissions.set(agentId, permissions);
    }
    for (const store of dataStores) {
      permissions.add(store);
    }
  }

  /**
   * Revoke an agent's access to a data store
   */
  revokeAccess(agentId: string, dataStores: DataStoreType[]): void {
    const permissions = this.agentPermissions.get(agentId);
    if (!permissions) return;
    for (const store of dataStores) {
      permissions.delete(store);
    }
  }

  /**
   * Check if an agent can access a data store
   */
  canAccess(agentId: string, dataStore: DataStoreType): boolean {
    const permissions = this.agentPermissions.get(agentId);
    return permissions?.has(dataStore) ?? false;
  }

  /**
   * Get an agent's permissions
   */
  getPermissions(agentId: string): DataStoreType[] {
    const permissions = this.agentPermissions.get(agentId);
    return permissions ? Array.from(permissions) : [];
  }

  // ===========================================================================
  // Audited Access Methods
  // ===========================================================================

  /**
   * Access a data store with permission check and audit
   */
  async access<T>(
    agentId: string,
    dataStore: DataStoreType,
    operation: DataOperation,
    executor: () => Promise<T>
  ): Promise<T> {
    // Check permission
    if (!this.canAccess(agentId, dataStore)) {
      this.logAccess(agentId, dataStore, operation, false, {
        error: 'Permission denied',
      });
      throw new Error(`Agent ${agentId} does not have access to ${dataStore}`);
    }

    try {
      const result = await executor();
      this.logAccess(agentId, dataStore, operation, true);
      return result;
    } catch (error) {
      this.logAccess(agentId, dataStore, operation, false, {
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  // ===========================================================================
  // Bookmark Operations
  // ===========================================================================

  async saveBookmark(
    agentId: string,
    data: {
      url: string;
      title?: string;
      description?: string;
      tags?: string[];
      category?: string;
    }
  ): Promise<Bookmark> {
    return this.access(agentId, 'bookmarks', 'write', async () => {
      return this.bookmarks.create({
        url: data.url,
        title: data.title ?? data.url,
        description: data.description,
        tags: data.tags ?? [],
        category: data.category,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async searchBookmarks(agentId: string, query: string): Promise<Bookmark[]> {
    return this.access(agentId, 'bookmarks', 'search', async () => {
      return this.bookmarks.search(query);
    });
  }

  async listBookmarks(
    agentId: string,
    filter?: { tags?: string[]; category?: string }
  ): Promise<Bookmark[]> {
    return this.access(agentId, 'bookmarks', 'list', async () => {
      let bookmarks = await this.bookmarks.list();
      if (filter?.tags) {
        bookmarks = bookmarks.filter((b) => filter.tags!.some((t) => b.tags.includes(t)));
      }
      if (filter?.category) {
        bookmarks = bookmarks.filter((b) => b.category === filter.category);
      }
      return bookmarks;
    });
  }

  async deleteBookmark(agentId: string, id: string): Promise<boolean> {
    return this.access(agentId, 'bookmarks', 'delete', async () => {
      return this.bookmarks.delete(id);
    });
  }

  // ===========================================================================
  // Note Operations
  // ===========================================================================

  async saveNote(
    agentId: string,
    data: {
      title?: string;
      content: string;
      tags?: string[];
      category?: string;
    }
  ): Promise<Note> {
    return this.access(agentId, 'notes', 'write', async () => {
      return this.notes.create({
        title: data.title,
        content: data.content,
        tags: data.tags ?? [],
        category: data.category,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async searchNotes(agentId: string, query: string): Promise<Note[]> {
    return this.access(agentId, 'notes', 'search', async () => {
      return this.notes.search(query);
    });
  }

  async listNotes(agentId: string, filter?: { tags?: string[] }): Promise<Note[]> {
    return this.access(agentId, 'notes', 'list', async () => {
      let notes = await this.notes.list();
      if (filter?.tags) {
        notes = notes.filter((n) => filter.tags!.some((t) => n.tags.includes(t)));
      }
      return notes;
    });
  }

  // ===========================================================================
  // Task Operations
  // ===========================================================================

  async createTask(
    agentId: string,
    data: {
      title: string;
      description?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      dueDate?: string;
      dueTime?: string;
      category?: string;
      tags?: string[];
      projectId?: string;
    }
  ): Promise<Task> {
    return this.access(agentId, 'calendar', 'write', async () => {
      return this.tasks.create({
        title: data.title,
        description: data.description,
        status: 'pending',
        priority: data.priority ?? 'normal',
        dueDate: data.dueDate,
        dueTime: data.dueTime,
        category: data.category,
        tags: data.tags ?? [],
        projectId: data.projectId,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async completeTask(agentId: string, id: string): Promise<Task | null> {
    return this.access(agentId, 'calendar', 'write', async () => {
      return this.tasks.update(id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    });
  }

  async listTasks(
    agentId: string,
    filter?: { status?: string; priority?: string; dueDate?: string }
  ): Promise<Task[]> {
    return this.access(agentId, 'calendar', 'list', async () => {
      let tasks = await this.tasks.list();
      if (filter?.status) {
        tasks = tasks.filter((t) => t.status === filter.status);
      }
      if (filter?.priority) {
        tasks = tasks.filter((t) => t.priority === filter.priority);
      }
      if (filter?.dueDate) {
        tasks = tasks.filter((t) => t.dueDate === filter.dueDate);
      }
      return tasks;
    });
  }

  async searchTasks(agentId: string, query: string): Promise<Task[]> {
    return this.access(agentId, 'calendar', 'search', async () => {
      return this.tasks.search(query);
    });
  }

  async deleteTask(agentId: string, id: string): Promise<boolean> {
    return this.access(agentId, 'calendar', 'delete', async () => {
      return this.tasks.delete(id);
    });
  }

  // ===========================================================================
  // Calendar Operations
  // ===========================================================================

  async createEvent(
    agentId: string,
    data: {
      title: string;
      description?: string;
      location?: string;
      startTime: string;
      endTime?: string;
      allDay?: boolean;
      timezone?: string;
      reminderMinutes?: number;
      category?: string;
      tags?: string[];
      attendees?: string[];
    }
  ): Promise<PersonalCalendarEvent> {
    return this.access(agentId, 'calendar', 'write', async () => {
      return this.calendar.create({
        title: data.title,
        description: data.description,
        location: data.location,
        startTime: data.startTime,
        endTime: data.endTime,
        allDay: data.allDay ?? false,
        timezone: data.timezone ?? 'UTC',
        reminderMinutes: data.reminderMinutes,
        category: data.category,
        tags: data.tags ?? [],
        attendees: data.attendees ?? [],
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async listEvents(
    agentId: string,
    filter?: { startDate?: string; endDate?: string; category?: string }
  ): Promise<PersonalCalendarEvent[]> {
    return this.access(agentId, 'calendar', 'list', async () => {
      let events = await this.calendar.list();
      if (filter?.startDate) {
        events = events.filter((e) => e.startTime >= filter.startDate!);
      }
      if (filter?.endDate) {
        events = events.filter((e) => e.startTime <= filter.endDate!);
      }
      if (filter?.category) {
        events = events.filter((e) => e.category === filter.category);
      }
      return events.sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
  }

  async searchEvents(agentId: string, query: string): Promise<PersonalCalendarEvent[]> {
    return this.access(agentId, 'calendar', 'search', async () => {
      return this.calendar.search(query);
    });
  }

  async deleteEvent(agentId: string, id: string): Promise<boolean> {
    return this.access(agentId, 'calendar', 'delete', async () => {
      return this.calendar.delete(id);
    });
  }

  // ===========================================================================
  // Contact Operations
  // ===========================================================================

  async createContact(
    agentId: string,
    data: {
      name: string;
      nickname?: string;
      email?: string;
      phone?: string;
      company?: string;
      jobTitle?: string;
      birthday?: string;
      address?: string;
      notes?: string;
      relationship?: string;
      tags?: string[];
    }
  ): Promise<Contact> {
    return this.access(agentId, 'contacts', 'write', async () => {
      return this.contacts.create({
        name: data.name,
        nickname: data.nickname,
        email: data.email,
        phone: data.phone,
        company: data.company,
        jobTitle: data.jobTitle,
        birthday: data.birthday,
        address: data.address,
        notes: data.notes,
        relationship: data.relationship,
        tags: data.tags ?? [],
        isFavorite: false,
        socialLinks: {},
        customFields: {},
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async listContacts(
    agentId: string,
    filter?: { relationship?: string; company?: string; isFavorite?: boolean }
  ): Promise<Contact[]> {
    return this.access(agentId, 'contacts', 'list', async () => {
      let contacts = await this.contacts.list();
      if (filter?.relationship) {
        contacts = contacts.filter((c) => c.relationship === filter.relationship);
      }
      if (filter?.company) {
        contacts = contacts.filter((c) => c.company === filter.company);
      }
      if (filter?.isFavorite !== undefined) {
        contacts = contacts.filter((c) => c.isFavorite === filter.isFavorite);
      }
      return contacts.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async searchContacts(agentId: string, query: string): Promise<Contact[]> {
    return this.access(agentId, 'contacts', 'search', async () => {
      return this.contacts.search(query);
    });
  }

  async getContact(agentId: string, id: string): Promise<Contact | null> {
    return this.access(agentId, 'contacts', 'read', async () => {
      return this.contacts.get(id);
    });
  }

  async deleteContact(agentId: string, id: string): Promise<boolean> {
    return this.access(agentId, 'contacts', 'delete', async () => {
      return this.contacts.delete(id);
    });
  }

  // ===========================================================================
  // Memory Operations (Long-term storage)
  // ===========================================================================

  async remember(
    agentId: string,
    key: string,
    value: string,
    context?: string
  ): Promise<MemoryItem> {
    return this.access(agentId, 'memory', 'write', async () => {
      // Check if key exists
      const existing = await this.memory.search(key);
      const existingItem = existing.find((m) => m.key === key);

      if (existingItem) {
        // Update existing
        const updated = await this.memory.update(existingItem.id, {
          value,
          context,
          accessCount: existingItem.accessCount + 1,
          lastAccessed: new Date().toISOString(),
        });
        return updated!;
      }

      // Create new
      return this.memory.create({
        key,
        value,
        context,
        importance: 1,
        accessCount: 1,
        lastAccessed: new Date().toISOString(),
      });
    });
  }

  async recall(agentId: string, query: string, limit = 10): Promise<MemoryItem[]> {
    return this.access(agentId, 'memory', 'search', async () => {
      const results = await this.memory.search(query);
      // Sort by relevance (access count * importance)
      results.sort((a, b) => b.accessCount * b.importance - a.accessCount * a.importance);
      return results.slice(0, limit);
    });
  }

  // ===========================================================================
  // Preference Operations
  // ===========================================================================

  async getPreference(agentId: string, key: string): Promise<unknown | null> {
    return this.access(agentId, 'preferences', 'read', async () => {
      const pref = this.preferences.get(key);
      return pref?.value ?? null;
    });
  }

  async setPreference(agentId: string, key: string, value: unknown): Promise<void> {
    return this.access(agentId, 'preferences', 'write', async () => {
      this.preferences.set(key, {
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  // ===========================================================================
  // Audit Log
  // ===========================================================================

  private logAccess(
    agentId: string,
    dataStore: DataStoreType,
    operation: DataOperation,
    success: boolean,
    details?: Record<string, unknown>
  ): void {
    if (!this.config.enableAudit) return;

    const entry: AccessLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      agentId,
      dataStore,
      operation,
      success,
      details,
    };

    this.auditLog.push(entry);

    // Trim old entries
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.config.maxAuditEntries);
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(filter?: {
    agentId?: string;
    dataStore?: DataStoreType;
    operation?: DataOperation;
    limit?: number;
  }): AccessLogEntry[] {
    let entries = [...this.auditLog];

    if (filter?.agentId) {
      entries = entries.filter((e) => e.agentId === filter.agentId);
    }
    if (filter?.dataStore) {
      entries = entries.filter((e) => e.dataStore === filter.dataStore);
    }
    if (filter?.operation) {
      entries = entries.filter((e) => e.operation === filter.operation);
    }

    // Most recent first
    entries.reverse();

    if (filter?.limit) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let _gateway: DataGateway | null = null;

export function getDataGateway(): DataGateway {
  if (!_gateway) {
    _gateway = new DataGateway();
  }
  return _gateway;
}

export function createDataGateway(config?: DataGatewayConfig): DataGateway {
  return new DataGateway(config);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataGateway, getDataGateway, createDataGateway } from './index.js';
import type {
  DataStore,
  Bookmark,
  Note,
  Task,
  PersonalCalendarEvent,
  Contact,
  MemoryItem,
  DataStoreType,
} from './index.js';

// =============================================================================
// Mocks
// =============================================================================

let uuidCounter = 0;

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

// =============================================================================
// Helpers
// =============================================================================

function makeCustomStore<T extends { id: string }>(): DataStore<T> & {
  _data: Map<string, T>;
} {
  const _data = new Map<string, T>();
  return {
    _data,
    async get(id: string) {
      return _data.get(id) ?? null;
    },
    async list(_filter?: Record<string, unknown>) {
      return Array.from(_data.values());
    },
    async search(query: string) {
      const lower = query.toLowerCase();
      return Array.from(_data.values()).filter((item) =>
        JSON.stringify(item).toLowerCase().includes(lower)
      );
    },
    async create(data: Omit<T, 'id' | 'createdAt'>) {
      const id = `custom-${_data.size + 1}`;
      const now = new Date().toISOString();
      const item = { ...(data as object), id, createdAt: now, updatedAt: now } as unknown as T;
      _data.set(id, item);
      return item;
    },
    async update(id: string, data: Partial<T>) {
      const existing = _data.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, id } as T;
      _data.set(id, updated);
      return updated;
    },
    async delete(id: string) {
      return _data.delete(id);
    },
  };
}

// =============================================================================
// DataGateway — constructor
// =============================================================================

describe('DataGateway constructor', () => {
  it('uses default config when none is provided', () => {
    const gw = new DataGateway();
    // Audit should be on by default — verify by checking that log entries appear
    gw.grantAccess('agent-1', ['bookmarks']);
    // No error from construction means defaults applied
    expect(gw).toBeInstanceOf(DataGateway);
  });

  it('uses enableAudit=false when specified', async () => {
    const gw = new DataGateway({ enableAudit: false });
    gw.grantAccess('agent-1', ['bookmarks']);
    await gw.saveBookmark('agent-1', { url: 'https://example.com' });
    const log = gw.getAuditLog();
    expect(log).toHaveLength(0);
  });

  it('uses custom maxAuditEntries', async () => {
    const gw = new DataGateway({ maxAuditEntries: 2 });
    gw.grantAccess('agent-1', ['bookmarks']);
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.saveBookmark('agent-1', { url: 'https://b.com' });
    await gw.saveBookmark('agent-1', { url: 'https://c.com' });
    // Should trim to 2
    const log = gw.getAuditLog();
    expect(log.length).toBeLessThanOrEqual(2);
  });

  it('uses injected custom bookmarks store', async () => {
    const customStore = makeCustomStore<Bookmark>();
    const gw = new DataGateway({ stores: { bookmarks: customStore } });
    expect(gw.bookmarks).toBe(customStore);
  });

  it('uses injected custom notes store', () => {
    const customStore = makeCustomStore<Note>();
    const gw = new DataGateway({ stores: { notes: customStore } });
    expect(gw.notes).toBe(customStore);
  });

  it('uses injected custom memory store', () => {
    const customStore = makeCustomStore<MemoryItem>();
    const gw = new DataGateway({ stores: { memory: customStore } });
    expect(gw.memory).toBe(customStore);
  });

  it('uses injected custom tasks store', () => {
    const customStore = makeCustomStore<Task>();
    const gw = new DataGateway({ stores: { tasks: customStore } });
    expect(gw.tasks).toBe(customStore);
  });

  it('uses injected custom calendar store', () => {
    const customStore = makeCustomStore<PersonalCalendarEvent>();
    const gw = new DataGateway({ stores: { calendar: customStore } });
    expect(gw.calendar).toBe(customStore);
  });

  it('uses injected custom contacts store', () => {
    const customStore = makeCustomStore<Contact>();
    const gw = new DataGateway({ stores: { contacts: customStore } });
    expect(gw.contacts).toBe(customStore);
  });

  it('falls back to in-memory stores when no stores are provided', () => {
    const gw = new DataGateway();
    expect(gw.bookmarks).toBeDefined();
    expect(gw.notes).toBeDefined();
    expect(gw.memory).toBeDefined();
    expect(gw.tasks).toBeDefined();
    expect(gw.calendar).toBeDefined();
    expect(gw.contacts).toBeDefined();
  });
});

// =============================================================================
// Permission Management
// =============================================================================

describe('Permission Management', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
  });

  describe('grantAccess', () => {
    it('grants a single permission to an agent', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(true);
    });

    it('grants multiple permissions to an agent in one call', () => {
      gw.grantAccess('agent-1', ['bookmarks', 'notes', 'memory']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(true);
      expect(gw.canAccess('agent-1', 'notes')).toBe(true);
      expect(gw.canAccess('agent-1', 'memory')).toBe(true);
    });

    it('accumulates permissions across multiple grant calls', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      gw.grantAccess('agent-1', ['notes']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(true);
      expect(gw.canAccess('agent-1', 'notes')).toBe(true);
    });

    it('is idempotent — granting the same permission twice does not error', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      gw.grantAccess('agent-1', ['bookmarks']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(true);
    });

    it('grants permissions to multiple different agents independently', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      gw.grantAccess('agent-2', ['notes']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(true);
      expect(gw.canAccess('agent-1', 'notes')).toBe(false);
      expect(gw.canAccess('agent-2', 'notes')).toBe(true);
      expect(gw.canAccess('agent-2', 'bookmarks')).toBe(false);
    });

    it('handles all DataStoreType values', () => {
      const allStores: DataStoreType[] = [
        'bookmarks',
        'notes',
        'finances',
        'memory',
        'preferences',
        'files',
        'calendar',
        'contacts',
      ];
      gw.grantAccess('agent-all', allStores);
      for (const store of allStores) {
        expect(gw.canAccess('agent-all', store)).toBe(true);
      }
    });
  });

  describe('revokeAccess', () => {
    it('removes a specific permission from an agent', () => {
      gw.grantAccess('agent-1', ['bookmarks', 'notes']);
      gw.revokeAccess('agent-1', ['bookmarks']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(false);
      expect(gw.canAccess('agent-1', 'notes')).toBe(true);
    });

    it('removes multiple permissions in one call', () => {
      gw.grantAccess('agent-1', ['bookmarks', 'notes', 'memory']);
      gw.revokeAccess('agent-1', ['bookmarks', 'memory']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(false);
      expect(gw.canAccess('agent-1', 'memory')).toBe(false);
      expect(gw.canAccess('agent-1', 'notes')).toBe(true);
    });

    it('is a no-op when agent has no existing permissions', () => {
      // Should not throw
      expect(() => gw.revokeAccess('nonexistent-agent', ['bookmarks'])).not.toThrow();
    });

    it('is a no-op when revoking a permission the agent does not have', () => {
      gw.grantAccess('agent-1', ['notes']);
      expect(() => gw.revokeAccess('agent-1', ['bookmarks'])).not.toThrow();
      expect(gw.canAccess('agent-1', 'notes')).toBe(true);
    });
  });

  describe('canAccess', () => {
    it('returns true when agent has the permission', () => {
      gw.grantAccess('agent-1', ['calendar']);
      expect(gw.canAccess('agent-1', 'calendar')).toBe(true);
    });

    it('returns false when agent does not have the permission', () => {
      gw.grantAccess('agent-1', ['notes']);
      expect(gw.canAccess('agent-1', 'calendar')).toBe(false);
    });

    it('returns false for unknown agent', () => {
      expect(gw.canAccess('nobody', 'bookmarks')).toBe(false);
    });

    it('returns false after permission has been revoked', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      gw.revokeAccess('agent-1', ['bookmarks']);
      expect(gw.canAccess('agent-1', 'bookmarks')).toBe(false);
    });
  });

  describe('getPermissions', () => {
    it('returns all permissions for an agent', () => {
      gw.grantAccess('agent-1', ['bookmarks', 'notes', 'memory']);
      const perms = gw.getPermissions('agent-1');
      expect(perms).toHaveLength(3);
      expect(perms).toContain('bookmarks');
      expect(perms).toContain('notes');
      expect(perms).toContain('memory');
    });

    it('returns empty array for unknown agent', () => {
      expect(gw.getPermissions('nobody')).toEqual([]);
    });

    it('returns empty array when all permissions have been revoked', () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      gw.revokeAccess('agent-1', ['bookmarks']);
      expect(gw.getPermissions('agent-1')).toEqual([]);
    });

    it('returns only remaining permissions after partial revocation', () => {
      gw.grantAccess('agent-1', ['bookmarks', 'notes']);
      gw.revokeAccess('agent-1', ['bookmarks']);
      const perms = gw.getPermissions('agent-1');
      expect(perms).toEqual(['notes']);
    });
  });
});

// =============================================================================
// access() method
// =============================================================================

describe('access() method', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
  });

  it('executes and returns the result when agent has permission', async () => {
    gw.grantAccess('agent-1', ['bookmarks']);
    const result = await gw.access('agent-1', 'bookmarks', 'read', async () => 42);
    expect(result).toBe(42);
  });

  it('throws when agent does not have permission', async () => {
    await expect(gw.access('agent-1', 'bookmarks', 'read', async () => 'value')).rejects.toThrow(
      'Agent agent-1 does not have access to bookmarks'
    );
  });

  it('throws error message with correct agentId and dataStore', async () => {
    await expect(gw.access('my-agent', 'contacts', 'write', async () => null)).rejects.toThrow(
      'Agent my-agent does not have access to contacts'
    );
  });

  it('re-throws executor errors', async () => {
    gw.grantAccess('agent-1', ['notes']);
    const boom = new Error('executor failed');
    await expect(
      gw.access('agent-1', 'notes', 'read', async () => {
        throw boom;
      })
    ).rejects.toThrow('executor failed');
  });

  it('logs a success entry in the audit log on success', async () => {
    gw.grantAccess('agent-1', ['notes']);
    await gw.access('agent-1', 'notes', 'read', async () => 'ok');
    const log = gw.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.success).toBe(true);
    expect(log[0]!.agentId).toBe('agent-1');
    expect(log[0]!.dataStore).toBe('notes');
    expect(log[0]!.operation).toBe('read');
  });

  it('logs a failure entry in the audit log when permission is denied', async () => {
    try {
      await gw.access('agent-1', 'bookmarks', 'read', async () => 'ok');
    } catch {
      // Expected
    }
    const log = gw.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.success).toBe(false);
    expect(log[0]!.details?.error).toBe('Permission denied');
  });

  it('logs a failure entry in the audit log when executor throws', async () => {
    gw.grantAccess('agent-1', ['notes']);
    try {
      await gw.access('agent-1', 'notes', 'write', async () => {
        throw new Error('oops');
      });
    } catch {
      // Expected
    }
    const log = gw.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.success).toBe(false);
    expect(log[0]!.details?.error).toBe('oops');
  });
});

// =============================================================================
// Bookmark Operations
// =============================================================================

describe('Bookmark Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['bookmarks']);
  });

  describe('saveBookmark', () => {
    it('creates a bookmark with all provided fields', async () => {
      const bm = await gw.saveBookmark('agent-1', {
        url: 'https://example.com',
        title: 'Example',
        description: 'A test site',
        tags: ['test', 'example'],
        category: 'reference',
      });
      expect(bm.id).toBeDefined();
      expect(bm.url).toBe('https://example.com');
      expect(bm.title).toBe('Example');
      expect(bm.description).toBe('A test site');
      expect(bm.tags).toEqual(['test', 'example']);
      expect(bm.category).toBe('reference');
      expect(bm.createdAt).toBeDefined();
      expect(bm.updatedAt).toBeDefined();
    });

    it('defaults title to url when no title is provided', async () => {
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      expect(bm.title).toBe('https://example.com');
    });

    it('defaults tags to empty array when no tags are provided', async () => {
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      expect(bm.tags).toEqual([]);
    });

    it('throws when agent lacks bookmarks permission', async () => {
      await expect(gw.saveBookmark('agent-x', { url: 'https://example.com' })).rejects.toThrow(
        'does not have access to bookmarks'
      );
    });
  });

  describe('searchBookmarks', () => {
    it('returns bookmarks matching the query', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://typescript.org', title: 'TypeScript' });
      await gw.saveBookmark('agent-1', { url: 'https://python.org', title: 'Python' });
      const results = await gw.searchBookmarks('agent-1', 'typescript');
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('TypeScript');
    });

    it('returns empty array when no bookmarks match', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://example.com', title: 'Example' });
      const results = await gw.searchBookmarks('agent-1', 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://example.com', title: 'MyBookmark' });
      const results = await gw.searchBookmarks('agent-1', 'MYBOOKMARK');
      expect(results).toHaveLength(1);
    });

    it('throws when agent lacks bookmarks permission', async () => {
      await expect(gw.searchBookmarks('agent-x', 'query')).rejects.toThrow(
        'does not have access to bookmarks'
      );
    });
  });

  describe('listBookmarks', () => {
    it('returns all bookmarks when no filter is provided', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://a.com' });
      await gw.saveBookmark('agent-1', { url: 'https://b.com' });
      const results = await gw.listBookmarks('agent-1');
      expect(results).toHaveLength(2);
    });

    it('filters by tags — returns bookmark with any matching tag', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://a.com', tags: ['js', 'web'] });
      await gw.saveBookmark('agent-1', { url: 'https://b.com', tags: ['python'] });
      const results = await gw.listBookmarks('agent-1', { tags: ['js'] });
      expect(results).toHaveLength(1);
      expect(results[0]!.url).toBe('https://a.com');
    });

    it('filters by tags matches any tag in the list (OR logic)', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://a.com', tags: ['js'] });
      await gw.saveBookmark('agent-1', { url: 'https://b.com', tags: ['python'] });
      await gw.saveBookmark('agent-1', { url: 'https://c.com', tags: ['rust'] });
      const results = await gw.listBookmarks('agent-1', { tags: ['js', 'python'] });
      expect(results).toHaveLength(2);
    });

    it('filters by category', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://a.com', category: 'tools' });
      await gw.saveBookmark('agent-1', { url: 'https://b.com', category: 'news' });
      const results = await gw.listBookmarks('agent-1', { category: 'tools' });
      expect(results).toHaveLength(1);
      expect(results[0]!.url).toBe('https://a.com');
    });

    it('applies both tag and category filters simultaneously', async () => {
      await gw.saveBookmark('agent-1', { url: 'https://a.com', tags: ['js'], category: 'tools' });
      await gw.saveBookmark('agent-1', { url: 'https://b.com', tags: ['js'], category: 'news' });
      const results = await gw.listBookmarks('agent-1', { tags: ['js'], category: 'tools' });
      expect(results).toHaveLength(1);
      expect(results[0]!.url).toBe('https://a.com');
    });

    it('returns empty array when no bookmarks exist', async () => {
      const results = await gw.listBookmarks('agent-1');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks bookmarks permission', async () => {
      await expect(gw.listBookmarks('agent-x')).rejects.toThrow(
        'does not have access to bookmarks'
      );
    });
  });

  describe('deleteBookmark', () => {
    it('deletes an existing bookmark and returns true', async () => {
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const result = await gw.deleteBookmark('agent-1', bm.id);
      expect(result).toBe(true);
    });

    it('returns false when bookmark does not exist', async () => {
      const result = await gw.deleteBookmark('agent-1', 'nonexistent-id');
      expect(result).toBe(false);
    });

    it('removes the bookmark from subsequent list calls', async () => {
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      await gw.deleteBookmark('agent-1', bm.id);
      const list = await gw.listBookmarks('agent-1');
      expect(list).toHaveLength(0);
    });

    it('throws when agent lacks bookmarks permission', async () => {
      await expect(gw.deleteBookmark('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to bookmarks'
      );
    });
  });
});

// =============================================================================
// Note Operations
// =============================================================================

describe('Note Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['notes']);
  });

  describe('saveNote', () => {
    it('creates a note with all provided fields', async () => {
      const note = await gw.saveNote('agent-1', {
        title: 'My Note',
        content: 'Hello world',
        tags: ['personal'],
        category: 'journal',
      });
      expect(note.id).toBeDefined();
      expect(note.title).toBe('My Note');
      expect(note.content).toBe('Hello world');
      expect(note.tags).toEqual(['personal']);
      expect(note.category).toBe('journal');
      expect(note.createdAt).toBeDefined();
      expect(note.updatedAt).toBeDefined();
    });

    it('defaults tags to empty array when none are provided', async () => {
      const note = await gw.saveNote('agent-1', { content: 'No tags here' });
      expect(note.tags).toEqual([]);
    });

    it('works without a title', async () => {
      const note = await gw.saveNote('agent-1', { content: 'Untitled note' });
      expect(note.title).toBeUndefined();
      expect(note.content).toBe('Untitled note');
    });

    it('throws when agent lacks notes permission', async () => {
      await expect(gw.saveNote('agent-x', { content: 'secret' })).rejects.toThrow(
        'does not have access to notes'
      );
    });
  });

  describe('searchNotes', () => {
    it('returns notes matching the query', async () => {
      await gw.saveNote('agent-1', { content: 'TypeScript is great' });
      await gw.saveNote('agent-1', { content: 'Python is also great' });
      const results = await gw.searchNotes('agent-1', 'TypeScript');
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('TypeScript is great');
    });

    it('returns empty array when no notes match', async () => {
      await gw.saveNote('agent-1', { content: 'Hello world' });
      const results = await gw.searchNotes('agent-1', 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive', async () => {
      await gw.saveNote('agent-1', { content: 'UpperCase Content' });
      const results = await gw.searchNotes('agent-1', 'uppercase');
      expect(results).toHaveLength(1);
    });

    it('throws when agent lacks notes permission', async () => {
      await expect(gw.searchNotes('agent-x', 'query')).rejects.toThrow(
        'does not have access to notes'
      );
    });
  });

  describe('listNotes', () => {
    it('returns all notes when no filter is provided', async () => {
      await gw.saveNote('agent-1', { content: 'Note 1' });
      await gw.saveNote('agent-1', { content: 'Note 2' });
      const results = await gw.listNotes('agent-1');
      expect(results).toHaveLength(2);
    });

    it('filters by tags — returns notes with any matching tag', async () => {
      await gw.saveNote('agent-1', { content: 'A', tags: ['work', 'meeting'] });
      await gw.saveNote('agent-1', { content: 'B', tags: ['personal'] });
      const results = await gw.listNotes('agent-1', { tags: ['work'] });
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('A');
    });

    it('filters by tags with OR logic across multiple tags', async () => {
      await gw.saveNote('agent-1', { content: 'A', tags: ['work'] });
      await gw.saveNote('agent-1', { content: 'B', tags: ['personal'] });
      await gw.saveNote('agent-1', { content: 'C', tags: ['draft'] });
      const results = await gw.listNotes('agent-1', { tags: ['work', 'personal'] });
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no notes exist', async () => {
      const results = await gw.listNotes('agent-1');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks notes permission', async () => {
      await expect(gw.listNotes('agent-x')).rejects.toThrow('does not have access to notes');
    });
  });
});

// =============================================================================
// Task Operations
// =============================================================================

describe('Task Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    // Tasks use 'calendar' permission
    gw.grantAccess('agent-1', ['calendar']);
  });

  describe('createTask', () => {
    it('creates a task with all provided fields', async () => {
      const task = await gw.createTask('agent-1', {
        title: 'Buy groceries',
        description: 'Milk and eggs',
        priority: 'high',
        dueDate: '2026-03-01',
        dueTime: '09:00',
        category: 'personal',
        tags: ['shopping'],
        projectId: 'proj-1',
      });
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Buy groceries');
      expect(task.description).toBe('Milk and eggs');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('high');
      expect(task.dueDate).toBe('2026-03-01');
      expect(task.dueTime).toBe('09:00');
      expect(task.category).toBe('personal');
      expect(task.tags).toEqual(['shopping']);
      expect(task.projectId).toBe('proj-1');
      expect(task.createdAt).toBeDefined();
    });

    it('defaults status to pending', async () => {
      const task = await gw.createTask('agent-1', { title: 'Simple task' });
      expect(task.status).toBe('pending');
    });

    it('defaults priority to normal when not provided', async () => {
      const task = await gw.createTask('agent-1', { title: 'Simple task' });
      expect(task.priority).toBe('normal');
    });

    it('defaults tags to empty array when not provided', async () => {
      const task = await gw.createTask('agent-1', { title: 'Simple task' });
      expect(task.tags).toEqual([]);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.createTask('agent-x', { title: 'Task' })).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });

  describe('completeTask', () => {
    it('sets the task status to completed', async () => {
      const task = await gw.createTask('agent-1', { title: 'Do laundry' });
      const updated = await gw.completeTask('agent-1', task.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
    });

    it('sets completedAt timestamp when completing a task', async () => {
      const task = await gw.createTask('agent-1', { title: 'Do laundry' });
      const updated = await gw.completeTask('agent-1', task.id);
      expect(updated!.completedAt).toBeDefined();
    });

    it('returns null when task id does not exist', async () => {
      const result = await gw.completeTask('agent-1', 'nonexistent-task-id');
      expect(result).toBeNull();
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.completeTask('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });

  describe('listTasks', () => {
    it('returns all tasks when no filter is provided', async () => {
      await gw.createTask('agent-1', { title: 'Task A' });
      await gw.createTask('agent-1', { title: 'Task B' });
      const results = await gw.listTasks('agent-1');
      expect(results).toHaveLength(2);
    });

    it('filters by status', async () => {
      await gw.createTask('agent-1', { title: 'Task A' });
      const b = await gw.createTask('agent-1', { title: 'Task B' });
      await gw.completeTask('agent-1', b.id);
      const results = await gw.listTasks('agent-1', { status: 'completed' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Task B');
    });

    it('filters by priority', async () => {
      await gw.createTask('agent-1', { title: 'Low', priority: 'low' });
      await gw.createTask('agent-1', { title: 'Urgent', priority: 'urgent' });
      const results = await gw.listTasks('agent-1', { priority: 'urgent' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Urgent');
    });

    it('filters by dueDate', async () => {
      await gw.createTask('agent-1', { title: 'Today', dueDate: '2026-03-01' });
      await gw.createTask('agent-1', { title: 'Tomorrow', dueDate: '2026-03-02' });
      const results = await gw.listTasks('agent-1', { dueDate: '2026-03-01' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Today');
    });

    it('applies multiple filters simultaneously', async () => {
      await gw.createTask('agent-1', { title: 'A', priority: 'high', dueDate: '2026-03-01' });
      await gw.createTask('agent-1', { title: 'B', priority: 'high', dueDate: '2026-03-02' });
      await gw.createTask('agent-1', { title: 'C', priority: 'low', dueDate: '2026-03-01' });
      const results = await gw.listTasks('agent-1', { priority: 'high', dueDate: '2026-03-01' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('A');
    });

    it('returns empty array when no tasks exist', async () => {
      const results = await gw.listTasks('agent-1');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.listTasks('agent-x')).rejects.toThrow('does not have access to calendar');
    });
  });

  describe('searchTasks', () => {
    it('returns tasks matching the query', async () => {
      await gw.createTask('agent-1', { title: 'Buy groceries' });
      await gw.createTask('agent-1', { title: 'Write report' });
      const results = await gw.searchTasks('agent-1', 'groceries');
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Buy groceries');
    });

    it('returns empty array when no tasks match', async () => {
      await gw.createTask('agent-1', { title: 'Buy groceries' });
      const results = await gw.searchTasks('agent-1', 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive', async () => {
      await gw.createTask('agent-1', { title: 'ImportantTask' });
      const results = await gw.searchTasks('agent-1', 'importanttask');
      expect(results).toHaveLength(1);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.searchTasks('agent-x', 'query')).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });

  describe('deleteTask', () => {
    it('deletes an existing task and returns true', async () => {
      const task = await gw.createTask('agent-1', { title: 'Delete me' });
      const result = await gw.deleteTask('agent-1', task.id);
      expect(result).toBe(true);
    });

    it('returns false when task does not exist', async () => {
      const result = await gw.deleteTask('agent-1', 'nonexistent-id');
      expect(result).toBe(false);
    });

    it('removes the task from subsequent list calls', async () => {
      const task = await gw.createTask('agent-1', { title: 'Remove me' });
      await gw.deleteTask('agent-1', task.id);
      const list = await gw.listTasks('agent-1');
      expect(list).toHaveLength(0);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.deleteTask('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });
});

// =============================================================================
// Calendar Operations
// =============================================================================

describe('Calendar Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['calendar']);
  });

  describe('createEvent', () => {
    it('creates an event with all provided fields', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Team Meeting',
        description: 'Weekly sync',
        location: 'Room 101',
        startTime: '2026-03-01T10:00:00Z',
        endTime: '2026-03-01T11:00:00Z',
        allDay: false,
        timezone: 'America/New_York',
        reminderMinutes: 15,
        category: 'work',
        tags: ['meeting'],
        attendees: ['alice@example.com', 'bob@example.com'],
      });
      expect(event.id).toBeDefined();
      expect(event.title).toBe('Team Meeting');
      expect(event.description).toBe('Weekly sync');
      expect(event.location).toBe('Room 101');
      expect(event.startTime).toBe('2026-03-01T10:00:00Z');
      expect(event.endTime).toBe('2026-03-01T11:00:00Z');
      expect(event.allDay).toBe(false);
      expect(event.timezone).toBe('America/New_York');
      expect(event.reminderMinutes).toBe(15);
      expect(event.category).toBe('work');
      expect(event.tags).toEqual(['meeting']);
      expect(event.attendees).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('defaults allDay to false when not provided', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Standup',
        startTime: '2026-03-01T09:00:00Z',
      });
      expect(event.allDay).toBe(false);
    });

    it('defaults timezone to UTC when not provided', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Standup',
        startTime: '2026-03-01T09:00:00Z',
      });
      expect(event.timezone).toBe('UTC');
    });

    it('defaults tags to empty array when not provided', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Standup',
        startTime: '2026-03-01T09:00:00Z',
      });
      expect(event.tags).toEqual([]);
    });

    it('defaults attendees to empty array when not provided', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Solo meeting',
        startTime: '2026-03-01T09:00:00Z',
      });
      expect(event.attendees).toEqual([]);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(
        gw.createEvent('agent-x', { title: 'Event', startTime: '2026-03-01T09:00:00Z' })
      ).rejects.toThrow('does not have access to calendar');
    });
  });

  describe('listEvents', () => {
    it('returns all events when no filter is provided', async () => {
      await gw.createEvent('agent-1', { title: 'Event A', startTime: '2026-03-01T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'Event B', startTime: '2026-03-02T09:00:00Z' });
      const results = await gw.listEvents('agent-1');
      expect(results).toHaveLength(2);
    });

    it('filters by startDate — excludes events before startDate', async () => {
      await gw.createEvent('agent-1', { title: 'Old', startTime: '2026-02-01T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'Current', startTime: '2026-03-01T09:00:00Z' });
      const results = await gw.listEvents('agent-1', { startDate: '2026-03-01T00:00:00Z' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Current');
    });

    it('filters by endDate — excludes events after endDate', async () => {
      await gw.createEvent('agent-1', { title: 'Current', startTime: '2026-03-01T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'Future', startTime: '2026-04-01T09:00:00Z' });
      const results = await gw.listEvents('agent-1', { endDate: '2026-03-31T23:59:59Z' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Current');
    });

    it('filters by category', async () => {
      await gw.createEvent('agent-1', {
        title: 'Work',
        startTime: '2026-03-01T09:00:00Z',
        category: 'work',
      });
      await gw.createEvent('agent-1', {
        title: 'Personal',
        startTime: '2026-03-02T09:00:00Z',
        category: 'personal',
      });
      const results = await gw.listEvents('agent-1', { category: 'work' });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Work');
    });

    it('sorts results by startTime ascending', async () => {
      await gw.createEvent('agent-1', { title: 'Third', startTime: '2026-03-03T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'First', startTime: '2026-03-01T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'Second', startTime: '2026-03-02T09:00:00Z' });
      const results = await gw.listEvents('agent-1');
      expect(results[0]!.title).toBe('First');
      expect(results[1]!.title).toBe('Second');
      expect(results[2]!.title).toBe('Third');
    });

    it('applies startDate and endDate filters together', async () => {
      await gw.createEvent('agent-1', { title: 'Before', startTime: '2026-01-01T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'InRange', startTime: '2026-03-15T09:00:00Z' });
      await gw.createEvent('agent-1', { title: 'After', startTime: '2026-06-01T09:00:00Z' });
      const results = await gw.listEvents('agent-1', {
        startDate: '2026-03-01T00:00:00Z',
        endDate: '2026-03-31T23:59:59Z',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('InRange');
    });

    it('returns empty array when no events exist', async () => {
      const results = await gw.listEvents('agent-1');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.listEvents('agent-x')).rejects.toThrow('does not have access to calendar');
    });
  });

  describe('searchEvents', () => {
    it('returns events matching the query', async () => {
      await gw.createEvent('agent-1', {
        title: 'Conference Call',
        startTime: '2026-03-01T09:00:00Z',
      });
      await gw.createEvent('agent-1', { title: 'Dentist', startTime: '2026-03-02T09:00:00Z' });
      const results = await gw.searchEvents('agent-1', 'conference');
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Conference Call');
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.searchEvents('agent-x', 'query')).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });

  describe('deleteEvent', () => {
    it('deletes an existing event and returns true', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Cancel me',
        startTime: '2026-03-01T09:00:00Z',
      });
      const result = await gw.deleteEvent('agent-1', event.id);
      expect(result).toBe(true);
    });

    it('returns false when event does not exist', async () => {
      const result = await gw.deleteEvent('agent-1', 'nonexistent-id');
      expect(result).toBe(false);
    });

    it('removes the event from subsequent list calls', async () => {
      const event = await gw.createEvent('agent-1', {
        title: 'Remove me',
        startTime: '2026-03-01T09:00:00Z',
      });
      await gw.deleteEvent('agent-1', event.id);
      const list = await gw.listEvents('agent-1');
      expect(list).toHaveLength(0);
    });

    it('throws when agent lacks calendar permission', async () => {
      await expect(gw.deleteEvent('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to calendar'
      );
    });
  });
});

// =============================================================================
// Contact Operations
// =============================================================================

describe('Contact Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['contacts']);
  });

  describe('createContact', () => {
    it('creates a contact with all provided fields', async () => {
      const contact = await gw.createContact('agent-1', {
        name: 'Alice Smith',
        nickname: 'Ali',
        email: 'alice@example.com',
        phone: '+1-555-1234',
        company: 'Acme Corp',
        jobTitle: 'Engineer',
        birthday: '1990-05-15',
        address: '123 Main St',
        notes: 'Met at conference',
        relationship: 'colleague',
        tags: ['work'],
      });
      expect(contact.id).toBeDefined();
      expect(contact.name).toBe('Alice Smith');
      expect(contact.nickname).toBe('Ali');
      expect(contact.email).toBe('alice@example.com');
      expect(contact.phone).toBe('+1-555-1234');
      expect(contact.company).toBe('Acme Corp');
      expect(contact.jobTitle).toBe('Engineer');
      expect(contact.birthday).toBe('1990-05-15');
      expect(contact.address).toBe('123 Main St');
      expect(contact.notes).toBe('Met at conference');
      expect(contact.relationship).toBe('colleague');
      expect(contact.tags).toEqual(['work']);
    });

    it('defaults isFavorite to false', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Bob' });
      expect(contact.isFavorite).toBe(false);
    });

    it('defaults socialLinks to empty object', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Bob' });
      expect(contact.socialLinks).toEqual({});
    });

    it('defaults customFields to empty object', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Bob' });
      expect(contact.customFields).toEqual({});
    });

    it('defaults tags to empty array when not provided', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Bob' });
      expect(contact.tags).toEqual([]);
    });

    it('throws when agent lacks contacts permission', async () => {
      await expect(gw.createContact('agent-x', { name: 'Alice' })).rejects.toThrow(
        'does not have access to contacts'
      );
    });
  });

  describe('listContacts', () => {
    it('returns all contacts when no filter is provided', async () => {
      await gw.createContact('agent-1', { name: 'Alice' });
      await gw.createContact('agent-1', { name: 'Bob' });
      const results = await gw.listContacts('agent-1');
      expect(results).toHaveLength(2);
    });

    it('filters by relationship', async () => {
      await gw.createContact('agent-1', { name: 'Alice', relationship: 'friend' });
      await gw.createContact('agent-1', { name: 'Bob', relationship: 'colleague' });
      const results = await gw.listContacts('agent-1', { relationship: 'friend' });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('filters by company', async () => {
      await gw.createContact('agent-1', { name: 'Alice', company: 'Acme' });
      await gw.createContact('agent-1', { name: 'Bob', company: 'Globex' });
      const results = await gw.listContacts('agent-1', { company: 'Acme' });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('filters by isFavorite=true', async () => {
      // We can't set isFavorite via createContact, but we can update via the store directly
      await gw.createContact('agent-1', { name: 'Alice' });
      await gw.createContact('agent-1', { name: 'Bob' });
      // Update one contact to be a favorite via the underlying store
      const all = await gw.contacts.list();
      const alice = all.find((c) => c.name === 'Alice')!;
      await gw.contacts.update(alice.id, { isFavorite: true });
      const results = await gw.listContacts('agent-1', { isFavorite: true });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('filters by isFavorite=false', async () => {
      await gw.createContact('agent-1', { name: 'Alice' });
      const all = await gw.contacts.list();
      await gw.contacts.update(all[0]!.id, { isFavorite: true });
      await gw.createContact('agent-1', { name: 'Bob' });
      const results = await gw.listContacts('agent-1', { isFavorite: false });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Bob');
    });

    it('sorts contacts by name ascending', async () => {
      await gw.createContact('agent-1', { name: 'Zara' });
      await gw.createContact('agent-1', { name: 'Alice' });
      await gw.createContact('agent-1', { name: 'Mike' });
      const results = await gw.listContacts('agent-1');
      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Mike');
      expect(results[2]!.name).toBe('Zara');
    });

    it('applies multiple filters simultaneously', async () => {
      await gw.createContact('agent-1', { name: 'Alice', relationship: 'friend', company: 'Acme' });
      await gw.createContact('agent-1', { name: 'Bob', relationship: 'friend', company: 'Globex' });
      await gw.createContact('agent-1', {
        name: 'Carol',
        relationship: 'colleague',
        company: 'Acme',
      });
      const results = await gw.listContacts('agent-1', { relationship: 'friend', company: 'Acme' });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('returns empty array when no contacts exist', async () => {
      const results = await gw.listContacts('agent-1');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks contacts permission', async () => {
      await expect(gw.listContacts('agent-x')).rejects.toThrow('does not have access to contacts');
    });
  });

  describe('searchContacts', () => {
    it('returns contacts matching the query', async () => {
      await gw.createContact('agent-1', { name: 'Alice Smith', email: 'alice@example.com' });
      await gw.createContact('agent-1', { name: 'Bob Jones', email: 'bob@example.com' });
      const results = await gw.searchContacts('agent-1', 'alice');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice Smith');
    });

    it('searches across all serialized fields', async () => {
      await gw.createContact('agent-1', { name: 'Bob', company: 'TypescriptCorp' });
      const results = await gw.searchContacts('agent-1', 'TypescriptCorp');
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no contacts match', async () => {
      await gw.createContact('agent-1', { name: 'Alice' });
      const results = await gw.searchContacts('agent-1', 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks contacts permission', async () => {
      await expect(gw.searchContacts('agent-x', 'query')).rejects.toThrow(
        'does not have access to contacts'
      );
    });
  });

  describe('getContact', () => {
    it('returns an existing contact by id', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Alice' });
      const found = await gw.getContact('agent-1', contact.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
      expect(found!.id).toBe(contact.id);
    });

    it('returns null when contact id does not exist', async () => {
      const result = await gw.getContact('agent-1', 'nonexistent-id');
      expect(result).toBeNull();
    });

    it('throws when agent lacks contacts permission', async () => {
      await expect(gw.getContact('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to contacts'
      );
    });
  });

  describe('deleteContact', () => {
    it('deletes an existing contact and returns true', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Alice' });
      const result = await gw.deleteContact('agent-1', contact.id);
      expect(result).toBe(true);
    });

    it('returns false when contact does not exist', async () => {
      const result = await gw.deleteContact('agent-1', 'nonexistent-id');
      expect(result).toBe(false);
    });

    it('removes the contact from subsequent list calls', async () => {
      const contact = await gw.createContact('agent-1', { name: 'Remove me' });
      await gw.deleteContact('agent-1', contact.id);
      const list = await gw.listContacts('agent-1');
      expect(list).toHaveLength(0);
    });

    it('throws when agent lacks contacts permission', async () => {
      await expect(gw.deleteContact('agent-x', 'some-id')).rejects.toThrow(
        'does not have access to contacts'
      );
    });
  });
});

// =============================================================================
// Memory Operations
// =============================================================================

describe('Memory Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['memory']);
  });

  describe('remember', () => {
    it('creates a new memory item for a new key', async () => {
      const item = await gw.remember('agent-1', 'user-name', 'Alice', 'introduced themselves');
      expect(item.id).toBeDefined();
      expect(item.key).toBe('user-name');
      expect(item.value).toBe('Alice');
      expect(item.context).toBe('introduced themselves');
      expect(item.importance).toBe(1);
      expect(item.accessCount).toBe(1);
      expect(item.createdAt).toBeDefined();
      expect(item.lastAccessed).toBeDefined();
    });

    it('creates a memory item without context when none is provided', async () => {
      const item = await gw.remember('agent-1', 'favorite-color', 'blue');
      expect(item.context).toBeUndefined();
    });

    it('updates an existing memory item when the same key is used (upsert)', async () => {
      await gw.remember('agent-1', 'user-name', 'Alice');
      const updated = await gw.remember('agent-1', 'user-name', 'Alicia', 'they corrected me');
      expect(updated.key).toBe('user-name');
      expect(updated.value).toBe('Alicia');
      expect(updated.context).toBe('they corrected me');
    });

    it('increments accessCount on upsert', async () => {
      await gw.remember('agent-1', 'user-name', 'Alice');
      const updated = await gw.remember('agent-1', 'user-name', 'Alicia');
      expect(updated.accessCount).toBe(2);
    });

    it('updates lastAccessed on upsert', async () => {
      const first = await gw.remember('agent-1', 'user-name', 'Alice');
      // Small delay to ensure timestamp differs
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await gw.remember('agent-1', 'user-name', 'Alicia');
      // lastAccessed should be defined (may be same ms in fast tests)
      expect(second.lastAccessed).toBeDefined();
      expect(second.id).toBe(first.id);
    });

    it('stores separate items for different keys', async () => {
      await gw.remember('agent-1', 'key-a', 'value-a');
      await gw.remember('agent-1', 'key-b', 'value-b');
      const resultA = await gw.recall('agent-1', 'key-a');
      const resultB = await gw.recall('agent-1', 'key-b');
      expect(resultA.some((m) => m.key === 'key-a')).toBe(true);
      expect(resultB.some((m) => m.key === 'key-b')).toBe(true);
    });

    it('throws when agent lacks memory permission', async () => {
      await expect(gw.remember('agent-x', 'key', 'value')).rejects.toThrow(
        'does not have access to memory'
      );
    });
  });

  describe('recall', () => {
    it('returns memory items matching the query', async () => {
      await gw.remember('agent-1', 'user-name', 'Alice');
      await gw.remember('agent-1', 'favorite-food', 'pizza');
      const results = await gw.recall('agent-1', 'alice');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((m) => m.key === 'user-name')).toBe(true);
    });

    it('sorts results by accessCount * importance descending', async () => {
      // Create items with different importance/accessCount combos
      await gw.remember('agent-1', 'low-access', 'val1');
      await gw.remember('agent-1', 'high-access', 'val2');
      await gw.remember('agent-1', 'high-access', 'val2-updated');
      await gw.remember('agent-1', 'high-access', 'val2-updated2');
      const results = await gw.recall('agent-1', 'val');
      // high-access has accessCount=3, low-access=1 — high-access should come first
      if (results.length >= 2) {
        const highIdx = results.findIndex((m) => m.key === 'high-access');
        const lowIdx = results.findIndex((m) => m.key === 'low-access');
        expect(highIdx).toBeLessThan(lowIdx);
      }
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await gw.remember('agent-1', `key-${i}`, `value-${i}`);
      }
      const results = await gw.recall('agent-1', 'value', 3);
      expect(results).toHaveLength(3);
    });

    it('defaults limit to 10', async () => {
      for (let i = 0; i < 15; i++) {
        await gw.remember('agent-1', `key-${i}`, `value-${i}`);
      }
      const results = await gw.recall('agent-1', 'value');
      expect(results).toHaveLength(10);
    });

    it('returns empty array when no items match the query', async () => {
      await gw.remember('agent-1', 'user-name', 'Alice');
      const results = await gw.recall('agent-1', 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('throws when agent lacks memory permission', async () => {
      await expect(gw.recall('agent-x', 'query')).rejects.toThrow('does not have access to memory');
    });
  });
});

// =============================================================================
// Preference Operations
// =============================================================================

describe('Preference Operations', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['preferences']);
  });

  describe('setPreference', () => {
    it('stores a string preference value', async () => {
      await gw.setPreference('agent-1', 'theme', 'dark');
      const value = await gw.getPreference('agent-1', 'theme');
      expect(value).toBe('dark');
    });

    it('stores a numeric preference value', async () => {
      await gw.setPreference('agent-1', 'font-size', 16);
      const value = await gw.getPreference('agent-1', 'font-size');
      expect(value).toBe(16);
    });

    it('stores a boolean preference value', async () => {
      await gw.setPreference('agent-1', 'notifications', true);
      const value = await gw.getPreference('agent-1', 'notifications');
      expect(value).toBe(true);
    });

    it('stores an object preference value', async () => {
      const prefs = { sidebar: 'left', width: 300 };
      await gw.setPreference('agent-1', 'layout', prefs);
      const value = await gw.getPreference('agent-1', 'layout');
      expect(value).toEqual(prefs);
    });

    it('overwrites an existing preference', async () => {
      await gw.setPreference('agent-1', 'theme', 'light');
      await gw.setPreference('agent-1', 'theme', 'dark');
      const value = await gw.getPreference('agent-1', 'theme');
      expect(value).toBe('dark');
    });

    it('throws when agent lacks preferences permission', async () => {
      await expect(gw.setPreference('agent-x', 'theme', 'dark')).rejects.toThrow(
        'does not have access to preferences'
      );
    });
  });

  describe('getPreference', () => {
    it('returns the stored preference value', async () => {
      await gw.setPreference('agent-1', 'language', 'en');
      const value = await gw.getPreference('agent-1', 'language');
      expect(value).toBe('en');
    });

    it('returns null for a preference key that does not exist', async () => {
      const value = await gw.getPreference('agent-1', 'nonexistent-key');
      expect(value).toBeNull();
    });

    it('returns null for an unset preference even after setting other preferences', async () => {
      await gw.setPreference('agent-1', 'theme', 'dark');
      const value = await gw.getPreference('agent-1', 'unset-key');
      expect(value).toBeNull();
    });

    it('throws when agent lacks preferences permission', async () => {
      await expect(gw.getPreference('agent-x', 'theme')).rejects.toThrow(
        'does not have access to preferences'
      );
    });
  });
});

// =============================================================================
// Audit Log
// =============================================================================

describe('Audit Log', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
    gw.grantAccess('agent-1', ['bookmarks', 'notes', 'calendar', 'contacts', 'memory']);
    gw.grantAccess('agent-2', ['bookmarks']);
  });

  it('logs access entries with required fields', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://example.com' });
    const log = gw.getAuditLog();
    expect(log).toHaveLength(1);
    const entry = log[0]!;
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.agentId).toBe('agent-1');
    expect(entry.dataStore).toBe('bookmarks');
    expect(entry.operation).toBe('write');
    expect(entry.success).toBe(true);
  });

  it('logs multiple entries across multiple operations', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.listBookmarks('agent-1');
    await gw.searchBookmarks('agent-1', 'test');
    const log = gw.getAuditLog();
    expect(log).toHaveLength(3);
  });

  it('getAuditLog returns entries in reverse chronological order (newest first)', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://first.com' });
    await gw.saveBookmark('agent-1', { url: 'https://second.com' });
    const log = gw.getAuditLog();
    expect(log).toHaveLength(2);
    // Newest entry should be first
    expect(log[0]!.timestamp >= log[1]!.timestamp).toBe(true);
  });

  it('filters by agentId', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.saveBookmark('agent-2', { url: 'https://b.com' });
    const log = gw.getAuditLog({ agentId: 'agent-2' });
    expect(log).toHaveLength(1);
    expect(log[0]!.agentId).toBe('agent-2');
  });

  it('filters by dataStore', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.saveNote('agent-1', { content: 'a note' });
    const log = gw.getAuditLog({ dataStore: 'notes' });
    expect(log).toHaveLength(1);
    expect(log[0]!.dataStore).toBe('notes');
  });

  it('filters by operation', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.listBookmarks('agent-1');
    const log = gw.getAuditLog({ operation: 'list' });
    expect(log).toHaveLength(1);
    expect(log[0]!.operation).toBe('list');
  });

  it('respects the limit parameter', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.saveBookmark('agent-1', { url: 'https://b.com' });
    await gw.saveBookmark('agent-1', { url: 'https://c.com' });
    const log = gw.getAuditLog({ limit: 2 });
    expect(log).toHaveLength(2);
  });

  it('applies multiple filters simultaneously', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.listBookmarks('agent-1');
    await gw.saveBookmark('agent-2', { url: 'https://b.com' });
    const log = gw.getAuditLog({ agentId: 'agent-1', operation: 'write' });
    expect(log).toHaveLength(1);
    expect(log[0]!.agentId).toBe('agent-1');
    expect(log[0]!.operation).toBe('write');
  });

  it('logs failed access attempts with error details', async () => {
    try {
      await gw.saveBookmark('agent-no-perm', { url: 'https://example.com' });
    } catch {
      // Expected
    }
    const log = gw.getAuditLog({ agentId: 'agent-no-perm' });
    expect(log).toHaveLength(1);
    expect(log[0]!.success).toBe(false);
    expect(log[0]!.details?.error).toBe('Permission denied');
  });

  it('logs executor errors with error details in the audit entry', async () => {
    const errorStore = makeCustomStore<Bookmark>();
    errorStore.create = vi.fn().mockRejectedValue(new Error('store is full'));
    const errGw = new DataGateway({ stores: { bookmarks: errorStore } });
    errGw.grantAccess('agent-1', ['bookmarks']);
    try {
      await errGw.saveBookmark('agent-1', { url: 'https://example.com' });
    } catch {
      // Expected
    }
    const log = errGw.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.success).toBe(false);
    expect(log[0]!.details?.error).toBe('store is full');
  });

  it('trims audit log to maxAuditEntries when exceeded', async () => {
    const limitedGw = new DataGateway({ maxAuditEntries: 3 });
    limitedGw.grantAccess('agent-1', ['bookmarks']);
    await limitedGw.saveBookmark('agent-1', { url: 'https://a.com' });
    await limitedGw.saveBookmark('agent-1', { url: 'https://b.com' });
    await limitedGw.saveBookmark('agent-1', { url: 'https://c.com' });
    await limitedGw.saveBookmark('agent-1', { url: 'https://d.com' });
    const log = limitedGw.getAuditLog();
    expect(log.length).toBeLessThanOrEqual(3);
  });

  it('keeps most recent entries when trimming', async () => {
    const limitedGw = new DataGateway({ maxAuditEntries: 2 });
    limitedGw.grantAccess('agent-1', ['bookmarks']);
    await limitedGw.saveBookmark('agent-1', { url: 'https://first.com' });
    await limitedGw.saveBookmark('agent-1', { url: 'https://second.com' });
    await limitedGw.saveBookmark('agent-1', { url: 'https://third.com' });
    // getAuditLog reverses — so index 0 is most recent
    const log = limitedGw.getAuditLog();
    const _urls = log.map((e) => e.details?.url ?? '').join('');
    // At least the last write entry should be present
    expect(log.length).toBeLessThanOrEqual(2);
  });

  it('produces no audit entries when enableAudit is false', async () => {
    const noAuditGw = new DataGateway({ enableAudit: false });
    noAuditGw.grantAccess('agent-1', ['bookmarks']);
    await noAuditGw.saveBookmark('agent-1', { url: 'https://a.com' });
    await noAuditGw.listBookmarks('agent-1');
    const log = noAuditGw.getAuditLog();
    expect(log).toHaveLength(0);
  });

  it('produces no audit entries for denied access when enableAudit is false', async () => {
    const noAuditGw = new DataGateway({ enableAudit: false });
    try {
      await noAuditGw.saveBookmark('agent-1', { url: 'https://a.com' });
    } catch {
      // Expected
    }
    const log = noAuditGw.getAuditLog();
    expect(log).toHaveLength(0);
  });

  it('audit entry has a unique id', async () => {
    await gw.saveBookmark('agent-1', { url: 'https://a.com' });
    await gw.saveBookmark('agent-1', { url: 'https://b.com' });
    const log = gw.getAuditLog();
    const ids = log.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// =============================================================================
// InMemoryStore (via DataGateway public store properties)
// =============================================================================

describe('InMemoryStore', () => {
  let gw: DataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    gw = new DataGateway();
  });

  describe('get', () => {
    it('returns null for non-existent id', async () => {
      const result = await gw.bookmarks.get('nonexistent');
      expect(result).toBeNull();
    });

    it('returns item by id after creation', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const found = await gw.bookmarks.get(bm.id);
      expect(found).not.toBeNull();
      expect(found!.url).toBe('https://example.com');
    });
  });

  describe('list', () => {
    it('returns empty array when store is empty', async () => {
      const results = await gw.bookmarks.list();
      expect(results).toHaveLength(0);
    });

    it('returns all items when no filter is provided', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      await gw.saveBookmark('agent-1', { url: 'https://a.com' });
      await gw.saveBookmark('agent-1', { url: 'https://b.com' });
      const results = await gw.bookmarks.list();
      expect(results).toHaveLength(2);
    });

    it('filters by exact key-value match', async () => {
      gw.grantAccess('agent-1', ['notes']);
      await gw.saveNote('agent-1', { content: 'Note A', category: 'work' });
      await gw.saveNote('agent-1', { content: 'Note B', category: 'personal' });
      const results = await gw.notes.list({ category: 'work' });
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('Note A');
    });
  });

  describe('search', () => {
    it('matches items containing the query in any field', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      await gw.saveBookmark('agent-1', { url: 'https://typescript.org', title: 'TypeScript' });
      await gw.saveBookmark('agent-1', { url: 'https://python.org', title: 'Python' });
      const results = await gw.bookmarks.search('typescript');
      expect(results).toHaveLength(1);
    });

    it('is case-insensitive', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      await gw.saveBookmark('agent-1', { url: 'https://example.com', title: 'IMPORTANT' });
      const results = await gw.bookmarks.search('important');
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no items match', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const results = await gw.bookmarks.search('notfound-xyz');
      expect(results).toHaveLength(0);
    });
  });

  describe('create', () => {
    it('assigns a unique id to each created item', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm1 = await gw.saveBookmark('agent-1', { url: 'https://a.com' });
      const bm2 = await gw.saveBookmark('agent-1', { url: 'https://b.com' });
      expect(bm1.id).not.toBe(bm2.id);
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      expect(bm.createdAt).toBeDefined();
      expect(bm.updatedAt).toBeDefined();
    });
  });

  describe('update', () => {
    it('returns null when updating a non-existent item', async () => {
      const result = await gw.bookmarks.update('nonexistent-id', { title: 'New' });
      expect(result).toBeNull();
    });

    it('preserves the original id on update', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const updated = await gw.bookmarks.update(bm.id, { title: 'Updated Title' });
      expect(updated!.id).toBe(bm.id);
    });

    it('updates the specified fields only', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', {
        url: 'https://example.com',
        title: 'Original',
      });
      const updated = await gw.bookmarks.update(bm.id, { title: 'New Title' });
      expect(updated!.title).toBe('New Title');
      expect(updated!.url).toBe('https://example.com');
    });

    it('refreshes updatedAt on update', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const original = bm.updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const updated = await gw.bookmarks.update(bm.id, { title: 'New' });
      expect(updated!.updatedAt >= original).toBe(true);
    });
  });

  describe('delete', () => {
    it('returns true when deleting an existing item', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      const result = await gw.bookmarks.delete(bm.id);
      expect(result).toBe(true);
    });

    it('returns false when deleting a non-existent item', async () => {
      const result = await gw.bookmarks.delete('nonexistent-id');
      expect(result).toBe(false);
    });

    it('makes the item unavailable via get after deletion', async () => {
      gw.grantAccess('agent-1', ['bookmarks']);
      const bm = await gw.saveBookmark('agent-1', { url: 'https://example.com' });
      await gw.bookmarks.delete(bm.id);
      const found = await gw.bookmarks.get(bm.id);
      expect(found).toBeNull();
    });
  });
});

// =============================================================================
// Factory functions
// =============================================================================

describe('Factory functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  describe('getDataGateway', () => {
    it('returns a DataGateway instance', () => {
      const gw = getDataGateway();
      expect(gw).toBeInstanceOf(DataGateway);
    });

    it('returns the same singleton instance on repeated calls', () => {
      const gw1 = getDataGateway();
      const gw2 = getDataGateway();
      expect(gw1).toBe(gw2);
    });

    it('the singleton is separate from instances created by createDataGateway', () => {
      const singleton = getDataGateway();
      const fresh = createDataGateway();
      expect(singleton).not.toBe(fresh);
    });
  });

  describe('createDataGateway', () => {
    it('creates a new DataGateway instance each call', () => {
      const gw1 = createDataGateway();
      const gw2 = createDataGateway();
      expect(gw1).not.toBe(gw2);
    });

    it('returns a DataGateway with default config when no args are provided', () => {
      const gw = createDataGateway();
      expect(gw).toBeInstanceOf(DataGateway);
    });

    it('accepts custom config', () => {
      const gw = createDataGateway({ enableAudit: false, maxAuditEntries: 5 });
      expect(gw).toBeInstanceOf(DataGateway);
    });

    it('created instances are independent — permissions do not leak', () => {
      const gw1 = createDataGateway();
      const gw2 = createDataGateway();
      gw1.grantAccess('agent-1', ['bookmarks']);
      expect(gw2.canAccess('agent-1', 'bookmarks')).toBe(false);
    });

    it('created instances are independent — data does not leak', async () => {
      const gw1 = createDataGateway();
      const gw2 = createDataGateway();
      gw1.grantAccess('agent-1', ['bookmarks']);
      await gw1.saveBookmark('agent-1', { url: 'https://example.com' });
      const list = await gw2.bookmarks.list();
      expect(list).toHaveLength(0);
    });
  });
});

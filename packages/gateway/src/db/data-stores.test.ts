/**
 * Data Stores Tests
 *
 * Unit tests for BookmarkStore, NoteStore, TaskStore, CalendarStore,
 * ContactStore, and createDataStores factory.
 *
 * Each store wraps a repository and maps DB row types (Date objects) to
 * domain types (ISO strings). Tests verify:
 *   - Constructor delegates correct userId to repository
 *   - get: found → mapped correctly, not found → null
 *   - list: filter fields passed, mapping, empty results
 *   - search: query forwarded, results mapped
 *   - create: correct input fields forwarded, mapping
 *   - update: found → mapped, not found → null
 *   - delete: boolean forwarded from repository
 *   - createDataStores: returns all 5 stores with correct types and userId
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock factories — separate mock instances per repo class
// ---------------------------------------------------------------------------

const {
  mockBookmarksRepo,
  mockNotesRepo,
  mockTasksRepo,
  mockCalendarRepo,
  mockContactsRepo,
  MockBookmarksRepository,
  MockNotesRepository,
  MockTasksRepository,
  MockCalendarRepository,
  MockContactsRepository,
} = vi.hoisted(() => {
  function makeMockRepo() {
    return {
      get: vi.fn(),
      list: vi.fn(),
      search: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  const mockBookmarksRepo = makeMockRepo();
  const mockNotesRepo = makeMockRepo();
  const mockTasksRepo = makeMockRepo();
  const mockCalendarRepo = makeMockRepo();
  const mockContactsRepo = makeMockRepo();

  // Must use regular functions (not arrows) so vi.fn() works with `new`
  const MockBookmarksRepository = vi.fn(function () {
    return mockBookmarksRepo;
  });
  const MockNotesRepository = vi.fn(function () {
    return mockNotesRepo;
  });
  const MockTasksRepository = vi.fn(function () {
    return mockTasksRepo;
  });
  const MockCalendarRepository = vi.fn(function () {
    return mockCalendarRepo;
  });
  const MockContactsRepository = vi.fn(function () {
    return mockContactsRepo;
  });

  return {
    mockBookmarksRepo,
    mockNotesRepo,
    mockTasksRepo,
    mockCalendarRepo,
    mockContactsRepo,
    MockBookmarksRepository,
    MockNotesRepository,
    MockTasksRepository,
    MockCalendarRepository,
    MockContactsRepository,
  };
});

vi.mock('./repositories/index.js', () => ({
  BookmarksRepository: MockBookmarksRepository,
  NotesRepository: MockNotesRepository,
  TasksRepository: MockTasksRepository,
  CalendarRepository: MockCalendarRepository,
  ContactsRepository: MockContactsRepository,
}));

import {
  BookmarkStore,
  NoteStore,
  TaskStore,
  CalendarStore,
  ContactStore,
  createDataStores,
} from './data-stores.js';

// ---------------------------------------------------------------------------
// Shared timestamp fixture
// ---------------------------------------------------------------------------

const now = new Date('2025-01-15T12:00:00.000Z');
const ISO_NOW = now.toISOString(); // '2025-01-15T12:00:00.000Z'

// ---------------------------------------------------------------------------
// Row fixtures — each with Date objects as returned by the repositories
// ---------------------------------------------------------------------------

function makeBookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    url: 'https://example.com',
    title: 'Example Site',
    description: undefined as string | undefined,
    tags: [] as string[],
    category: undefined as string | undefined,
    favicon: undefined as string | undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeNoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    title: 'My Note',
    content: 'Note content',
    tags: [] as string[],
    category: undefined as string | undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Do something',
    description: undefined as string | undefined,
    status: 'pending' as 'pending' | 'in_progress' | 'completed' | 'cancelled',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    dueDate: undefined as string | undefined,
    dueTime: undefined as string | undefined,
    reminderAt: undefined as string | undefined,
    category: undefined as string | undefined,
    tags: [] as string[],
    parentId: undefined as string | undefined,
    projectId: undefined as string | undefined,
    recurrence: undefined as string | undefined,
    completedAt: undefined as string | undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    title: 'Team Meeting',
    description: undefined as string | undefined,
    location: undefined as string | undefined,
    startTime: now,
    endTime: undefined as Date | undefined,
    allDay: false,
    timezone: 'UTC',
    recurrence: undefined as string | undefined,
    reminderMinutes: undefined as number | undefined,
    category: undefined as string | undefined,
    tags: [] as string[],
    color: undefined as string | undefined,
    externalId: undefined as string | undefined,
    externalSource: undefined as string | undefined,
    attendees: [] as string[],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeContactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    name: 'Alice Smith',
    nickname: undefined as string | undefined,
    email: undefined as string | undefined,
    phone: undefined as string | undefined,
    company: undefined as string | undefined,
    jobTitle: undefined as string | undefined,
    avatar: undefined as string | undefined,
    birthday: undefined as string | undefined,
    address: undefined as string | undefined,
    notes: undefined as string | undefined,
    relationship: undefined as string | undefined,
    tags: [] as string[],
    isFavorite: false,
    socialLinks: {} as Record<string, string>,
    customFields: {} as Record<string, string>,
    lastContactedAt: undefined as Date | undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ===========================================================================
// BookmarkStore
// ===========================================================================

describe('BookmarkStore', () => {
  let store: BookmarkStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new BookmarkStore('user-1');
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a BookmarksRepository with the provided userId', () => {
      expect(MockBookmarksRepository).toHaveBeenCalledWith('user-1');
    });

    it('should default userId to "default" when not provided', () => {
      vi.clearAllMocks();
      new BookmarkStore();
      expect(MockBookmarksRepository).toHaveBeenCalledWith('default');
    });

    it('should accept a custom userId', () => {
      vi.clearAllMocks();
      new BookmarkStore('custom-user');
      expect(MockBookmarksRepository).toHaveBeenCalledWith('custom-user');
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when repo returns null', async () => {
      mockBookmarksRepo.get.mockResolvedValueOnce(null);

      const result = await store.get('bk-1');

      expect(result).toBeNull();
      expect(mockBookmarksRepo.get).toHaveBeenCalledWith('bk-1');
    });

    it('should map Date fields to ISO strings when found', async () => {
      mockBookmarksRepo.get.mockResolvedValueOnce(makeBookmarkRow());

      const result = await store.get('bk-1');

      expect(result).not.toBeNull();
      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should map all scalar fields correctly', async () => {
      mockBookmarksRepo.get.mockResolvedValueOnce(
        makeBookmarkRow({
          id: 'bk-99',
          url: 'https://test.dev',
          title: 'Test',
          description: 'Desc',
          tags: ['a', 'b'],
          category: 'tech',
          favicon: 'https://test.dev/fav.ico',
        })
      );

      const result = await store.get('bk-99');

      expect(result!.id).toBe('bk-99');
      expect(result!.url).toBe('https://test.dev');
      expect(result!.title).toBe('Test');
      expect(result!.description).toBe('Desc');
      expect(result!.tags).toEqual(['a', 'b']);
      expect(result!.category).toBe('tech');
      expect(result!.favicon).toBe('https://test.dev/fav.ico');
    });

    it('should forward the id argument to the repo', async () => {
      mockBookmarksRepo.get.mockResolvedValueOnce(null);

      await store.get('specific-id');

      expect(mockBookmarksRepo.get).toHaveBeenCalledWith('specific-id');
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return an empty array when repo returns empty array', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([]);

      const result = await store.list();

      expect(result).toEqual([]);
    });

    it('should map Date fields in each item', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([makeBookmarkRow()]);

      const result = await store.list();

      expect(result[0]!.createdAt).toBe(ISO_NOW);
      expect(result[0]!.updatedAt).toBe(ISO_NOW);
    });

    it('should pass category filter to repo', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([]);

      await store.list({ category: 'tech' });

      expect(mockBookmarksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'tech' })
      );
    });

    it('should pass tags filter to repo', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([]);

      await store.list({ tags: ['ts', 'react'] });

      expect(mockBookmarksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['ts', 'react'] })
      );
    });

    it('should pass isFavorite filter to repo', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([]);

      await store.list({ isFavorite: true });

      expect(mockBookmarksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ isFavorite: true })
      );
    });

    it('should pass undefined filter fields when filter is absent', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([]);

      await store.list();

      expect(mockBookmarksRepo.list).toHaveBeenCalledWith({
        category: undefined,
        tags: undefined,
        isFavorite: undefined,
      });
    });

    it('should map multiple results', async () => {
      mockBookmarksRepo.list.mockResolvedValueOnce([
        makeBookmarkRow({ id: 'bk-1', title: 'First' }),
        makeBookmarkRow({ id: 'bk-2', title: 'Second' }),
      ]);

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('bk-1');
      expect(result[1]!.id).toBe('bk-2');
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should forward the query string to repo.search', async () => {
      mockBookmarksRepo.search.mockResolvedValueOnce([]);

      await store.search('vitest');

      expect(mockBookmarksRepo.search).toHaveBeenCalledWith('vitest');
    });

    it('should map results from repo', async () => {
      mockBookmarksRepo.search.mockResolvedValueOnce([makeBookmarkRow()]);

      const result = await store.search('example');

      expect(result).toHaveLength(1);
      expect(result[0]!.createdAt).toBe(ISO_NOW);
    });

    it('should return empty array when repo returns empty', async () => {
      mockBookmarksRepo.search.mockResolvedValueOnce([]);

      const result = await store.search('nomatch');

      expect(result).toEqual([]);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should pass all fields to repo.create', async () => {
      mockBookmarksRepo.create.mockResolvedValueOnce(makeBookmarkRow());

      await store.create({
        url: 'https://example.com',
        title: 'Example',
        description: 'Desc',
        tags: ['a'],
        category: 'work',
        favicon: 'https://example.com/fav.ico',
        updatedAt: ISO_NOW,
      });

      expect(mockBookmarksRepo.create).toHaveBeenCalledWith({
        url: 'https://example.com',
        title: 'Example',
        description: 'Desc',
        tags: ['a'],
        category: 'work',
        favicon: 'https://example.com/fav.ico',
      });
    });

    it('should return mapped result with ISO date strings', async () => {
      mockBookmarksRepo.create.mockResolvedValueOnce(makeBookmarkRow());

      const result = await store.create({
        url: 'https://example.com',
        title: 'Example',
        updatedAt: ISO_NOW,
      });

      expect(result.createdAt).toBe(ISO_NOW);
      expect(result.updatedAt).toBe(ISO_NOW);
    });

    it('should map all returned fields', async () => {
      mockBookmarksRepo.create.mockResolvedValueOnce(
        makeBookmarkRow({ id: 'bk-new', url: 'https://new.com', title: 'New' })
      );

      const result = await store.create({
        url: 'https://new.com',
        title: 'New',
        updatedAt: ISO_NOW,
      });

      expect(result.id).toBe('bk-new');
      expect(result.url).toBe('https://new.com');
      expect(result.title).toBe('New');
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should return null when repo returns null', async () => {
      mockBookmarksRepo.update.mockResolvedValueOnce(null);

      const result = await store.update('bk-99', { title: 'X' });

      expect(result).toBeNull();
    });

    it('should return mapped result when repo returns a row', async () => {
      mockBookmarksRepo.update.mockResolvedValueOnce(makeBookmarkRow({ title: 'Updated' }));

      const result = await store.update('bk-1', { title: 'Updated' });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Updated');
      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should pass id and update fields to repo.update', async () => {
      mockBookmarksRepo.update.mockResolvedValueOnce(makeBookmarkRow());

      await store.update('bk-1', { url: 'https://new.com', category: 'dev' });

      expect(mockBookmarksRepo.update).toHaveBeenCalledWith(
        'bk-1',
        expect.objectContaining({ url: 'https://new.com', category: 'dev' })
      );
    });

    it('should only pass bookmark-relevant fields to repo', async () => {
      mockBookmarksRepo.update.mockResolvedValueOnce(makeBookmarkRow());

      await store.update('bk-1', {
        url: 'https://x.com',
        title: 'X',
        description: 'D',
        tags: ['t'],
        category: 'c',
        favicon: 'f',
      });

      expect(mockBookmarksRepo.update).toHaveBeenCalledWith('bk-1', {
        url: 'https://x.com',
        title: 'X',
        description: 'D',
        tags: ['t'],
        category: 'c',
        favicon: 'f',
      });
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should return true when repo.delete returns true', async () => {
      mockBookmarksRepo.delete.mockResolvedValueOnce(true);

      const result = await store.delete('bk-1');

      expect(result).toBe(true);
    });

    it('should return false when repo.delete returns false', async () => {
      mockBookmarksRepo.delete.mockResolvedValueOnce(false);

      const result = await store.delete('bk-missing');

      expect(result).toBe(false);
    });

    it('should forward the id to repo.delete', async () => {
      mockBookmarksRepo.delete.mockResolvedValueOnce(true);

      await store.delete('bk-99');

      expect(mockBookmarksRepo.delete).toHaveBeenCalledWith('bk-99');
    });
  });
});

// ===========================================================================
// NoteStore
// ===========================================================================

describe('NoteStore', () => {
  let store: NoteStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new NoteStore('user-2');
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a NotesRepository with the provided userId', () => {
      expect(MockNotesRepository).toHaveBeenCalledWith('user-2');
    });

    it('should default userId to "default" when not provided', () => {
      vi.clearAllMocks();
      new NoteStore();
      expect(MockNotesRepository).toHaveBeenCalledWith('default');
    });

    it('should accept a custom userId', () => {
      vi.clearAllMocks();
      new NoteStore('my-user');
      expect(MockNotesRepository).toHaveBeenCalledWith('my-user');
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when repo returns null', async () => {
      mockNotesRepo.get.mockResolvedValueOnce(null);

      const result = await store.get('note-1');

      expect(result).toBeNull();
    });

    it('should map Date fields to ISO strings', async () => {
      mockNotesRepo.get.mockResolvedValueOnce(makeNoteRow());

      const result = await store.get('note-1');

      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should map all scalar fields correctly', async () => {
      mockNotesRepo.get.mockResolvedValueOnce(
        makeNoteRow({
          id: 'note-42',
          title: 'My Title',
          content: 'Some content',
          tags: ['note', 'test'],
          category: 'personal',
        })
      );

      const result = await store.get('note-42');

      expect(result!.id).toBe('note-42');
      expect(result!.title).toBe('My Title');
      expect(result!.content).toBe('Some content');
      expect(result!.tags).toEqual(['note', 'test']);
      expect(result!.category).toBe('personal');
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return empty array when no notes found', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      const result = await store.list();

      expect(result).toEqual([]);
    });

    it('should pass category filter to repo', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      await store.list({ category: 'work' });

      expect(mockNotesRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'work' })
      );
    });

    it('should pass tags filter to repo', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      await store.list({ tags: ['important'] });

      expect(mockNotesRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['important'] })
      );
    });

    it('should pass isPinned filter to repo', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      await store.list({ isPinned: true });

      expect(mockNotesRepo.list).toHaveBeenCalledWith(expect.objectContaining({ isPinned: true }));
    });

    it('should pass isArchived filter to repo', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      await store.list({ isArchived: false });

      expect(mockNotesRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ isArchived: false })
      );
    });

    it('should pass all four filter fields when none supplied', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([]);

      await store.list();

      expect(mockNotesRepo.list).toHaveBeenCalledWith({
        category: undefined,
        tags: undefined,
        isPinned: undefined,
        isArchived: undefined,
      });
    });

    it('should map multiple results with correct Date→ISO conversion', async () => {
      mockNotesRepo.list.mockResolvedValueOnce([
        makeNoteRow({ id: 'n1' }),
        makeNoteRow({ id: 'n2' }),
      ]);

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.createdAt).toBe(ISO_NOW);
      expect(result[1]!.createdAt).toBe(ISO_NOW);
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should forward query to repo.search', async () => {
      mockNotesRepo.search.mockResolvedValueOnce([]);

      await store.search('typescript');

      expect(mockNotesRepo.search).toHaveBeenCalledWith('typescript');
    });

    it('should map returned notes', async () => {
      mockNotesRepo.search.mockResolvedValueOnce([makeNoteRow()]);

      const result = await store.search('q');

      expect(result).toHaveLength(1);
      expect(result[0]!.updatedAt).toBe(ISO_NOW);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should default title to empty string when title is null/undefined', async () => {
      mockNotesRepo.create.mockResolvedValueOnce(makeNoteRow());

      // Pass data without title (simulate undefined)
      await store.create({ content: 'hello', updatedAt: ISO_NOW } as Parameters<
        NoteStore['create']
      >[0]);

      expect(mockNotesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ title: '' }));
    });

    it('should use provided title when present', async () => {
      mockNotesRepo.create.mockResolvedValueOnce(makeNoteRow({ title: 'My Title' }));

      await store.create({ title: 'My Title', content: 'Content', updatedAt: ISO_NOW });

      expect(mockNotesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Title' })
      );
    });

    it('should pass content, tags, and category to repo', async () => {
      mockNotesRepo.create.mockResolvedValueOnce(makeNoteRow());

      await store.create({
        title: 'T',
        content: 'C',
        tags: ['x'],
        category: 'ideas',
        updatedAt: ISO_NOW,
      });

      expect(mockNotesRepo.create).toHaveBeenCalledWith({
        title: 'T',
        content: 'C',
        tags: ['x'],
        category: 'ideas',
      });
    });

    it('should return mapped result with ISO date strings', async () => {
      mockNotesRepo.create.mockResolvedValueOnce(makeNoteRow());

      const result = await store.create({ title: 'T', content: 'C', updatedAt: ISO_NOW });

      expect(result.createdAt).toBe(ISO_NOW);
      expect(result.updatedAt).toBe(ISO_NOW);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should return null when repo returns null', async () => {
      mockNotesRepo.update.mockResolvedValueOnce(null);

      const result = await store.update('note-99', { title: 'X' });

      expect(result).toBeNull();
    });

    it('should return mapped result when repo returns a note', async () => {
      mockNotesRepo.update.mockResolvedValueOnce(makeNoteRow({ title: 'Updated' }));

      const result = await store.update('note-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(result!.createdAt).toBe(ISO_NOW);
    });

    it('should pass update fields to repo', async () => {
      mockNotesRepo.update.mockResolvedValueOnce(makeNoteRow());

      await store.update('note-1', { title: 'T', content: 'C', tags: ['a'], category: 'b' });

      expect(mockNotesRepo.update).toHaveBeenCalledWith('note-1', {
        title: 'T',
        content: 'C',
        tags: ['a'],
        category: 'b',
      });
    });

    it('should handle partial updates (only title)', async () => {
      mockNotesRepo.update.mockResolvedValueOnce(makeNoteRow({ title: 'New' }));

      const result = await store.update('note-1', { title: 'New' });

      expect(result!.title).toBe('New');
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should return true on successful delete', async () => {
      mockNotesRepo.delete.mockResolvedValueOnce(true);

      expect(await store.delete('note-1')).toBe(true);
    });

    it('should return false when note not found', async () => {
      mockNotesRepo.delete.mockResolvedValueOnce(false);

      expect(await store.delete('note-missing')).toBe(false);
    });

    it('should forward the id to repo', async () => {
      mockNotesRepo.delete.mockResolvedValueOnce(true);

      await store.delete('note-xyz');

      expect(mockNotesRepo.delete).toHaveBeenCalledWith('note-xyz');
    });
  });
});

// ===========================================================================
// TaskStore
// ===========================================================================

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new TaskStore('user-3');
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a TasksRepository with the provided userId', () => {
      expect(MockTasksRepository).toHaveBeenCalledWith('user-3');
    });

    it('should default userId to "default"', () => {
      vi.clearAllMocks();
      new TaskStore();
      expect(MockTasksRepository).toHaveBeenCalledWith('default');
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when repo returns null', async () => {
      mockTasksRepo.get.mockResolvedValueOnce(null);

      const result = await store.get('task-1');

      expect(result).toBeNull();
    });

    it('should map Date fields to ISO strings', async () => {
      mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow());

      const result = await store.get('task-1');

      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should map all task-specific fields via mapTask', async () => {
      mockTasksRepo.get.mockResolvedValueOnce(
        makeTaskRow({
          id: 'task-99',
          title: 'Build feature',
          description: 'Description here',
          status: 'in_progress',
          priority: 'high',
          dueDate: '2025-02-01',
          dueTime: '09:00',
          reminderAt: '2025-01-31T08:00:00Z',
          category: 'dev',
          tags: ['backend'],
          parentId: 'parent-1',
          projectId: 'proj-1',
          recurrence: 'RRULE:FREQ=WEEKLY',
          completedAt: undefined,
        })
      );

      const result = await store.get('task-99');

      expect(result!.id).toBe('task-99');
      expect(result!.title).toBe('Build feature');
      expect(result!.description).toBe('Description here');
      expect(result!.status).toBe('in_progress');
      expect(result!.priority).toBe('high');
      expect(result!.dueDate).toBe('2025-02-01');
      expect(result!.dueTime).toBe('09:00');
      expect(result!.reminderAt).toBe('2025-01-31T08:00:00Z');
      expect(result!.category).toBe('dev');
      expect(result!.tags).toEqual(['backend']);
      expect(result!.parentId).toBe('parent-1');
      expect(result!.projectId).toBe('proj-1');
      expect(result!.recurrence).toBe('RRULE:FREQ=WEEKLY');
      expect(result!.completedAt).toBeUndefined();
    });

    it('should include completedAt when set', async () => {
      mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow({ completedAt: '2025-01-15T10:00:00Z' }));

      const result = await store.get('task-1');

      expect(result!.completedAt).toBe('2025-01-15T10:00:00Z');
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return empty array when repo returns none', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([]);

      expect(await store.list()).toEqual([]);
    });

    it('should pass status filter to repo', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([]);

      await store.list({ status: 'completed' });

      expect(mockTasksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('should pass priority filter to repo', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([]);

      await store.list({ priority: 'urgent' });

      expect(mockTasksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'urgent' })
      );
    });

    it('should pass projectId filter to repo', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([]);

      await store.list({ projectId: 'proj-42' });

      expect(mockTasksRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-42' })
      );
    });

    it('should pass all three filter fields when no filter supplied', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([]);

      await store.list();

      expect(mockTasksRepo.list).toHaveBeenCalledWith({
        status: undefined,
        priority: undefined,
        projectId: undefined,
      });
    });

    it('should map multiple tasks using mapTask', async () => {
      mockTasksRepo.list.mockResolvedValueOnce([
        makeTaskRow({ id: 't1', status: 'pending' }),
        makeTaskRow({ id: 't2', status: 'completed' }),
      ]);

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('t1');
      expect(result[0]!.status).toBe('pending');
      expect(result[1]!.id).toBe('t2');
      expect(result[1]!.status).toBe('completed');
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should forward query to repo.search', async () => {
      mockTasksRepo.search.mockResolvedValueOnce([]);

      await store.search('meeting');

      expect(mockTasksRepo.search).toHaveBeenCalledWith('meeting');
    });

    it('should map results via mapTask', async () => {
      mockTasksRepo.search.mockResolvedValueOnce([makeTaskRow({ priority: 'high' })]);

      const result = await store.search('q');

      expect(result[0]!.priority).toBe('high');
      expect(result[0]!.createdAt).toBe(ISO_NOW);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should pass all task creation fields to repo.create', async () => {
      mockTasksRepo.create.mockResolvedValueOnce(makeTaskRow());

      await store.create({
        title: 'New Task',
        description: 'Do stuff',
        priority: 'high',
        dueDate: '2025-03-01',
        dueTime: '10:00',
        reminderAt: '2025-02-28T09:00:00Z',
        category: 'work',
        tags: ['urgent'],
        parentId: 'p-1',
        projectId: 'proj-1',
        recurrence: 'RRULE:FREQ=DAILY',
        updatedAt: ISO_NOW,
        status: 'pending',
      });

      expect(mockTasksRepo.create).toHaveBeenCalledWith({
        title: 'New Task',
        description: 'Do stuff',
        priority: 'high',
        dueDate: '2025-03-01',
        dueTime: '10:00',
        reminderAt: '2025-02-28T09:00:00Z',
        category: 'work',
        tags: ['urgent'],
        parentId: 'p-1',
        projectId: 'proj-1',
        recurrence: 'RRULE:FREQ=DAILY',
      });
    });

    it('should return mapped task with ISO date strings', async () => {
      mockTasksRepo.create.mockResolvedValueOnce(makeTaskRow());

      const result = await store.create({
        title: 'T',
        updatedAt: ISO_NOW,
        status: 'pending',
        priority: 'normal',
        tags: [],
      });

      expect(result.createdAt).toBe(ISO_NOW);
      expect(result.updatedAt).toBe(ISO_NOW);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should return null when repo returns null', async () => {
      mockTasksRepo.update.mockResolvedValueOnce(null);

      const result = await store.update('task-99', { title: 'X' });

      expect(result).toBeNull();
    });

    it('should return mapped task when repo returns a row', async () => {
      mockTasksRepo.update.mockResolvedValueOnce(makeTaskRow({ status: 'completed' }));

      const result = await store.update('task-1', { status: 'completed' });

      expect(result!.status).toBe('completed');
      expect(result!.createdAt).toBe(ISO_NOW);
    });

    it('should pass update fields to repo', async () => {
      mockTasksRepo.update.mockResolvedValueOnce(makeTaskRow());

      await store.update('task-1', {
        title: 'Updated',
        description: 'New desc',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2025-04-01',
        dueTime: '14:00',
        reminderAt: '2025-03-31T09:00:00Z',
        category: 'personal',
        tags: ['b'],
        recurrence: 'RRULE:FREQ=MONTHLY',
      });

      expect(mockTasksRepo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          title: 'Updated',
          status: 'in_progress',
          priority: 'high',
        })
      );
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should return true when repo.delete succeeds', async () => {
      mockTasksRepo.delete.mockResolvedValueOnce(true);

      expect(await store.delete('task-1')).toBe(true);
    });

    it('should return false when task not found', async () => {
      mockTasksRepo.delete.mockResolvedValueOnce(false);

      expect(await store.delete('task-nope')).toBe(false);
    });

    it('should forward id to repo.delete', async () => {
      mockTasksRepo.delete.mockResolvedValueOnce(true);

      await store.delete('task-abc');

      expect(mockTasksRepo.delete).toHaveBeenCalledWith('task-abc');
    });
  });
});

// ===========================================================================
// CalendarStore
// ===========================================================================

describe('CalendarStore', () => {
  let store: CalendarStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new CalendarStore('user-4');
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a CalendarRepository with the provided userId', () => {
      expect(MockCalendarRepository).toHaveBeenCalledWith('user-4');
    });

    it('should default userId to "default"', () => {
      vi.clearAllMocks();
      new CalendarStore();
      expect(MockCalendarRepository).toHaveBeenCalledWith('default');
    });

    it('should accept a custom userId', () => {
      vi.clearAllMocks();
      new CalendarStore('cal-user');
      expect(MockCalendarRepository).toHaveBeenCalledWith('cal-user');
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when repo returns null', async () => {
      mockCalendarRepo.get.mockResolvedValueOnce(null);

      const result = await store.get('evt-1');

      expect(result).toBeNull();
    });

    it('should map startTime and createdAt/updatedAt to ISO strings', async () => {
      mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow());

      const result = await store.get('evt-1');

      expect(result!.startTime).toBe(ISO_NOW);
      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should map endTime to ISO string when present', async () => {
      const endTime = new Date('2025-01-15T14:00:00.000Z');
      mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ endTime }));

      const result = await store.get('evt-1');

      expect(result!.endTime).toBe(endTime.toISOString());
    });

    it('should leave endTime undefined when not present', async () => {
      mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ endTime: undefined }));

      const result = await store.get('evt-1');

      expect(result!.endTime).toBeUndefined();
    });

    it('should map all event scalar fields', async () => {
      mockCalendarRepo.get.mockResolvedValueOnce(
        makeEventRow({
          id: 'evt-99',
          title: 'Sprint Review',
          description: 'Biweekly review',
          location: 'Room A',
          allDay: true,
          timezone: 'Europe/Berlin',
          recurrence: 'RRULE:FREQ=WEEKLY',
          reminderMinutes: 15,
          category: 'work',
          tags: ['sprint'],
          color: '#ff0000',
          externalId: 'gcal-abc',
          externalSource: 'google',
          attendees: ['alice@example.com'],
        })
      );

      const result = await store.get('evt-99');

      expect(result!.id).toBe('evt-99');
      expect(result!.title).toBe('Sprint Review');
      expect(result!.description).toBe('Biweekly review');
      expect(result!.location).toBe('Room A');
      expect(result!.allDay).toBe(true);
      expect(result!.timezone).toBe('Europe/Berlin');
      expect(result!.recurrence).toBe('RRULE:FREQ=WEEKLY');
      expect(result!.reminderMinutes).toBe(15);
      expect(result!.category).toBe('work');
      expect(result!.tags).toEqual(['sprint']);
      expect(result!.color).toBe('#ff0000');
      expect(result!.externalId).toBe('gcal-abc');
      expect(result!.externalSource).toBe('google');
      expect(result!.attendees).toEqual(['alice@example.com']);
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return empty array when no events', async () => {
      mockCalendarRepo.list.mockResolvedValueOnce([]);

      expect(await store.list()).toEqual([]);
    });

    it('should pass category filter to repo', async () => {
      mockCalendarRepo.list.mockResolvedValueOnce([]);

      await store.list({ category: 'work' });

      expect(mockCalendarRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'work' })
      );
    });

    it('should pass undefined category when filter absent', async () => {
      mockCalendarRepo.list.mockResolvedValueOnce([]);

      await store.list();

      expect(mockCalendarRepo.list).toHaveBeenCalledWith({ category: undefined });
    });

    it('should map multiple events with Date→ISO conversion', async () => {
      mockCalendarRepo.list.mockResolvedValueOnce([
        makeEventRow({ id: 'e1' }),
        makeEventRow({ id: 'e2' }),
      ]);

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.startTime).toBe(ISO_NOW);
      expect(result[1]!.startTime).toBe(ISO_NOW);
    });

    it('should handle endTime mapping for each item', async () => {
      const end = new Date('2025-01-15T15:00:00.000Z');
      mockCalendarRepo.list.mockResolvedValueOnce([makeEventRow({ endTime: end })]);

      const result = await store.list();

      expect(result[0]!.endTime).toBe(end.toISOString());
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should forward query to repo.search', async () => {
      mockCalendarRepo.search.mockResolvedValueOnce([]);

      await store.search('standup');

      expect(mockCalendarRepo.search).toHaveBeenCalledWith('standup');
    });

    it('should map results', async () => {
      mockCalendarRepo.search.mockResolvedValueOnce([makeEventRow()]);

      const result = await store.search('q');

      expect(result[0]!.createdAt).toBe(ISO_NOW);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should pass all event fields to repo.create', async () => {
      mockCalendarRepo.create.mockResolvedValueOnce(makeEventRow());

      await store.create({
        title: 'Standup',
        description: 'Daily',
        location: 'Zoom',
        startTime: ISO_NOW,
        endTime: ISO_NOW,
        allDay: false,
        timezone: 'UTC',
        recurrence: 'RRULE:FREQ=DAILY',
        reminderMinutes: 5,
        category: 'work',
        tags: ['daily'],
        color: '#0000ff',
        externalId: 'ext-1',
        externalSource: 'outlook',
        attendees: ['bob@example.com'],
        updatedAt: ISO_NOW,
      });

      expect(mockCalendarRepo.create).toHaveBeenCalledWith({
        title: 'Standup',
        description: 'Daily',
        location: 'Zoom',
        startTime: ISO_NOW,
        endTime: ISO_NOW,
        allDay: false,
        timezone: 'UTC',
        recurrence: 'RRULE:FREQ=DAILY',
        reminderMinutes: 5,
        category: 'work',
        tags: ['daily'],
        color: '#0000ff',
        externalId: 'ext-1',
        externalSource: 'outlook',
        attendees: ['bob@example.com'],
      });
    });

    it('should return mapped event with ISO date strings', async () => {
      mockCalendarRepo.create.mockResolvedValueOnce(makeEventRow());

      const result = await store.create({
        title: 'Event',
        startTime: ISO_NOW,
        timezone: 'UTC',
        allDay: false,
        attendees: [],
        tags: [],
        updatedAt: ISO_NOW,
      });

      expect(result.startTime).toBe(ISO_NOW);
      expect(result.createdAt).toBe(ISO_NOW);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should return null when repo returns null', async () => {
      mockCalendarRepo.update.mockResolvedValueOnce(null);

      const result = await store.update('evt-99', { title: 'X' });

      expect(result).toBeNull();
    });

    it('should return mapped event when repo returns a row', async () => {
      mockCalendarRepo.update.mockResolvedValueOnce(makeEventRow({ title: 'Updated' }));

      const result = await store.update('evt-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(result!.startTime).toBe(ISO_NOW);
    });

    it('should pass update fields to repo', async () => {
      mockCalendarRepo.update.mockResolvedValueOnce(makeEventRow());

      await store.update('evt-1', {
        title: 'New Title',
        location: 'Office',
        allDay: true,
        attendees: ['c@d.com'],
      });

      expect(mockCalendarRepo.update).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          title: 'New Title',
          location: 'Office',
          allDay: true,
          attendees: ['c@d.com'],
        })
      );
    });

    it('should handle optional endTime in update', async () => {
      mockCalendarRepo.update.mockResolvedValueOnce(
        makeEventRow({ endTime: new Date('2025-01-15T16:00:00.000Z') })
      );

      const result = await store.update('evt-1', { endTime: '2025-01-15T16:00:00.000Z' });

      expect(result!.endTime).toBe('2025-01-15T16:00:00.000Z');
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should return true on successful delete', async () => {
      mockCalendarRepo.delete.mockResolvedValueOnce(true);

      expect(await store.delete('evt-1')).toBe(true);
    });

    it('should return false when event not found', async () => {
      mockCalendarRepo.delete.mockResolvedValueOnce(false);

      expect(await store.delete('evt-missing')).toBe(false);
    });

    it('should forward id to repo.delete', async () => {
      mockCalendarRepo.delete.mockResolvedValueOnce(true);

      await store.delete('evt-abc');

      expect(mockCalendarRepo.delete).toHaveBeenCalledWith('evt-abc');
    });
  });
});

// ===========================================================================
// ContactStore
// ===========================================================================

describe('ContactStore', () => {
  let store: ContactStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ContactStore('user-5');
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a ContactsRepository with the provided userId', () => {
      expect(MockContactsRepository).toHaveBeenCalledWith('user-5');
    });

    it('should default userId to "default"', () => {
      vi.clearAllMocks();
      new ContactStore();
      expect(MockContactsRepository).toHaveBeenCalledWith('default');
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when repo returns null', async () => {
      mockContactsRepo.get.mockResolvedValueOnce(null);

      const result = await store.get('ct-1');

      expect(result).toBeNull();
    });

    it('should map createdAt and updatedAt to ISO strings', async () => {
      mockContactsRepo.get.mockResolvedValueOnce(makeContactRow());

      const result = await store.get('ct-1');

      expect(result!.createdAt).toBe(ISO_NOW);
      expect(result!.updatedAt).toBe(ISO_NOW);
    });

    it('should map lastContactedAt to ISO string when present', async () => {
      const lastContacted = new Date('2025-01-10T08:00:00.000Z');
      mockContactsRepo.get.mockResolvedValueOnce(
        makeContactRow({ lastContactedAt: lastContacted })
      );

      const result = await store.get('ct-1');

      expect(result!.lastContactedAt).toBe(lastContacted.toISOString());
    });

    it('should leave lastContactedAt undefined when absent', async () => {
      mockContactsRepo.get.mockResolvedValueOnce(makeContactRow({ lastContactedAt: undefined }));

      const result = await store.get('ct-1');

      expect(result!.lastContactedAt).toBeUndefined();
    });

    it('should map all contact scalar fields', async () => {
      mockContactsRepo.get.mockResolvedValueOnce(
        makeContactRow({
          id: 'ct-99',
          name: 'Bob Jones',
          nickname: 'BJ',
          email: 'bob@example.com',
          phone: '+1234567890',
          company: 'Acme',
          jobTitle: 'Engineer',
          avatar: 'https://avatar.url',
          birthday: '1990-05-15',
          address: '123 Main St',
          notes: 'Great contact',
          relationship: 'colleague',
          tags: ['tech', 'friend'],
          isFavorite: true,
          socialLinks: { twitter: '@bob' },
          customFields: { dept: 'eng' },
        })
      );

      const result = await store.get('ct-99');

      expect(result!.id).toBe('ct-99');
      expect(result!.name).toBe('Bob Jones');
      expect(result!.nickname).toBe('BJ');
      expect(result!.email).toBe('bob@example.com');
      expect(result!.phone).toBe('+1234567890');
      expect(result!.company).toBe('Acme');
      expect(result!.jobTitle).toBe('Engineer');
      expect(result!.avatar).toBe('https://avatar.url');
      expect(result!.birthday).toBe('1990-05-15');
      expect(result!.address).toBe('123 Main St');
      expect(result!.notes).toBe('Great contact');
      expect(result!.relationship).toBe('colleague');
      expect(result!.tags).toEqual(['tech', 'friend']);
      expect(result!.isFavorite).toBe(true);
      expect(result!.socialLinks).toEqual({ twitter: '@bob' });
      expect(result!.customFields).toEqual({ dept: 'eng' });
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return empty array when no contacts', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([]);

      expect(await store.list()).toEqual([]);
    });

    it('should pass relationship filter to repo', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([]);

      await store.list({ relationship: 'friend' });

      expect(mockContactsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ relationship: 'friend' })
      );
    });

    it('should pass company filter to repo', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([]);

      await store.list({ company: 'Acme Corp' });

      expect(mockContactsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Acme Corp' })
      );
    });

    it('should pass isFavorite filter to repo', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([]);

      await store.list({ isFavorite: true });

      expect(mockContactsRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ isFavorite: true })
      );
    });

    it('should pass all three filter fields when absent', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([]);

      await store.list();

      expect(mockContactsRepo.list).toHaveBeenCalledWith({
        relationship: undefined,
        company: undefined,
        isFavorite: undefined,
      });
    });

    it('should map multiple contacts with Date→ISO conversion', async () => {
      mockContactsRepo.list.mockResolvedValueOnce([
        makeContactRow({ id: 'ct-1', name: 'Alice' }),
        makeContactRow({ id: 'ct-2', name: 'Bob' }),
      ]);

      const result = await store.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('Alice');
      expect(result[0]!.createdAt).toBe(ISO_NOW);
      expect(result[1]!.name).toBe('Bob');
    });

    it('should map lastContactedAt in list results', async () => {
      const lastContacted = new Date('2025-01-05T10:00:00.000Z');
      mockContactsRepo.list.mockResolvedValueOnce([
        makeContactRow({ lastContactedAt: lastContacted }),
      ]);

      const result = await store.list();

      expect(result[0]!.lastContactedAt).toBe(lastContacted.toISOString());
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should forward query to repo.search', async () => {
      mockContactsRepo.search.mockResolvedValueOnce([]);

      await store.search('Alice');

      expect(mockContactsRepo.search).toHaveBeenCalledWith('Alice');
    });

    it('should map results from repo', async () => {
      mockContactsRepo.search.mockResolvedValueOnce([makeContactRow()]);

      const result = await store.search('q');

      expect(result[0]!.createdAt).toBe(ISO_NOW);
    });

    it('should return empty array when no matches', async () => {
      mockContactsRepo.search.mockResolvedValueOnce([]);

      expect(await store.search('zzz')).toEqual([]);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should pass all contact fields to repo.create', async () => {
      mockContactsRepo.create.mockResolvedValueOnce(makeContactRow());

      await store.create({
        name: 'Carol White',
        nickname: 'CW',
        email: 'carol@example.com',
        phone: '+9876543210',
        company: 'StartupCo',
        jobTitle: 'CEO',
        avatar: 'https://img.url',
        birthday: '1985-03-20',
        address: '456 Oak Ave',
        notes: 'VIP client',
        relationship: 'client',
        tags: ['vip'],
        isFavorite: true,
        socialLinks: { linkedin: 'carol' },
        customFields: { tier: 'gold' },
        updatedAt: ISO_NOW,
      });

      expect(mockContactsRepo.create).toHaveBeenCalledWith({
        name: 'Carol White',
        nickname: 'CW',
        email: 'carol@example.com',
        phone: '+9876543210',
        company: 'StartupCo',
        jobTitle: 'CEO',
        avatar: 'https://img.url',
        birthday: '1985-03-20',
        address: '456 Oak Ave',
        notes: 'VIP client',
        relationship: 'client',
        tags: ['vip'],
        isFavorite: true,
        socialLinks: { linkedin: 'carol' },
        customFields: { tier: 'gold' },
      });
    });

    it('should return mapped contact with ISO date strings', async () => {
      mockContactsRepo.create.mockResolvedValueOnce(makeContactRow());

      const result = await store.create({
        name: 'X',
        updatedAt: ISO_NOW,
        tags: [],
        isFavorite: false,
        socialLinks: {},
        customFields: {},
      });

      expect(result.createdAt).toBe(ISO_NOW);
      expect(result.updatedAt).toBe(ISO_NOW);
    });

    it('should handle lastContactedAt being absent after create', async () => {
      mockContactsRepo.create.mockResolvedValueOnce(makeContactRow({ lastContactedAt: undefined }));

      const result = await store.create({
        name: 'X',
        updatedAt: ISO_NOW,
        tags: [],
        isFavorite: false,
        socialLinks: {},
        customFields: {},
      });

      expect(result.lastContactedAt).toBeUndefined();
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should return null when repo returns null', async () => {
      mockContactsRepo.update.mockResolvedValueOnce(null);

      const result = await store.update('ct-99', { name: 'X' });

      expect(result).toBeNull();
    });

    it('should return mapped contact when repo returns a row', async () => {
      mockContactsRepo.update.mockResolvedValueOnce(makeContactRow({ name: 'Updated Name' }));

      const result = await store.update('ct-1', { name: 'Updated Name' });

      expect(result!.name).toBe('Updated Name');
      expect(result!.createdAt).toBe(ISO_NOW);
    });

    it('should pass update fields to repo', async () => {
      mockContactsRepo.update.mockResolvedValueOnce(makeContactRow());

      await store.update('ct-1', {
        name: 'Dave',
        email: 'dave@example.com',
        isFavorite: false,
        socialLinks: { github: 'dave' },
        customFields: { score: '5' },
      });

      expect(mockContactsRepo.update).toHaveBeenCalledWith(
        'ct-1',
        expect.objectContaining({
          name: 'Dave',
          email: 'dave@example.com',
          isFavorite: false,
          socialLinks: { github: 'dave' },
          customFields: { score: '5' },
        })
      );
    });

    it('should map lastContactedAt in updated result', async () => {
      const lca = new Date('2025-01-12T09:00:00.000Z');
      mockContactsRepo.update.mockResolvedValueOnce(makeContactRow({ lastContactedAt: lca }));

      const result = await store.update('ct-1', {});

      expect(result!.lastContactedAt).toBe(lca.toISOString());
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should return true on successful delete', async () => {
      mockContactsRepo.delete.mockResolvedValueOnce(true);

      expect(await store.delete('ct-1')).toBe(true);
    });

    it('should return false when contact not found', async () => {
      mockContactsRepo.delete.mockResolvedValueOnce(false);

      expect(await store.delete('ct-missing')).toBe(false);
    });

    it('should forward id to repo.delete', async () => {
      mockContactsRepo.delete.mockResolvedValueOnce(true);

      await store.delete('ct-xyz');

      expect(mockContactsRepo.delete).toHaveBeenCalledWith('ct-xyz');
    });
  });
});

// ===========================================================================
// createDataStores factory
// ===========================================================================

describe('createDataStores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an object with all 5 store keys', () => {
    const stores = createDataStores('factory-user');

    expect(stores).toHaveProperty('bookmarks');
    expect(stores).toHaveProperty('notes');
    expect(stores).toHaveProperty('tasks');
    expect(stores).toHaveProperty('calendar');
    expect(stores).toHaveProperty('contacts');
  });

  it('should return a BookmarkStore instance', () => {
    const stores = createDataStores('u');

    expect(stores.bookmarks).toBeInstanceOf(BookmarkStore);
  });

  it('should return a NoteStore instance', () => {
    const stores = createDataStores('u');

    expect(stores.notes).toBeInstanceOf(NoteStore);
  });

  it('should return a TaskStore instance', () => {
    const stores = createDataStores('u');

    expect(stores.tasks).toBeInstanceOf(TaskStore);
  });

  it('should return a CalendarStore instance', () => {
    const stores = createDataStores('u');

    expect(stores.calendar).toBeInstanceOf(CalendarStore);
  });

  it('should return a ContactStore instance', () => {
    const stores = createDataStores('u');

    expect(stores.contacts).toBeInstanceOf(ContactStore);
  });

  it('should pass the userId to each repository constructor', () => {
    createDataStores('specific-user');

    expect(MockBookmarksRepository).toHaveBeenCalledWith('specific-user');
    expect(MockNotesRepository).toHaveBeenCalledWith('specific-user');
    expect(MockTasksRepository).toHaveBeenCalledWith('specific-user');
    expect(MockCalendarRepository).toHaveBeenCalledWith('specific-user');
    expect(MockContactsRepository).toHaveBeenCalledWith('specific-user');
  });

  it('should default userId to "default" when not provided', () => {
    createDataStores();

    expect(MockBookmarksRepository).toHaveBeenCalledWith('default');
    expect(MockNotesRepository).toHaveBeenCalledWith('default');
    expect(MockTasksRepository).toHaveBeenCalledWith('default');
    expect(MockCalendarRepository).toHaveBeenCalledWith('default');
    expect(MockContactsRepository).toHaveBeenCalledWith('default');
  });

  it('should create exactly 5 stores — one of each type', () => {
    const stores = createDataStores('u');
    const keys = Object.keys(stores);

    expect(keys).toHaveLength(5);
  });

  it('should return distinct store instances for different userIds', () => {
    vi.clearAllMocks();

    MockBookmarksRepository.mockImplementationOnce(function (this: BookmarkStore) {
      return mockBookmarksRepo;
    });

    const stores1 = createDataStores('user-a');
    const stores2 = createDataStores('user-b');

    expect(stores1.bookmarks).not.toBe(stores2.bookmarks);
  });
});

// ===========================================================================
// Additional edge-case tests — mapping correctness and boundary behaviour
// ===========================================================================

describe('BookmarkStore — additional edge cases', () => {
  let store: BookmarkStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new BookmarkStore('edge-user');
  });

  it('get: undefined optional fields remain undefined in mapped result', async () => {
    mockBookmarksRepo.get.mockResolvedValueOnce(
      makeBookmarkRow({ description: undefined, favicon: undefined, category: undefined })
    );

    const result = await store.get('bk-1');

    expect(result!.description).toBeUndefined();
    expect(result!.favicon).toBeUndefined();
    expect(result!.category).toBeUndefined();
  });

  it('list: empty tags array is preserved in mapping', async () => {
    mockBookmarksRepo.list.mockResolvedValueOnce([makeBookmarkRow({ tags: [] })]);

    const result = await store.list();

    expect(result[0]!.tags).toEqual([]);
  });

  it('list: non-empty tags array is preserved in mapping', async () => {
    mockBookmarksRepo.list.mockResolvedValueOnce([
      makeBookmarkRow({ tags: ['read-later', 'reference'] }),
    ]);

    const result = await store.list();

    expect(result[0]!.tags).toEqual(['read-later', 'reference']);
  });

  it('search: multiple results all have ISO date strings', async () => {
    const now2 = new Date('2025-06-01T00:00:00.000Z');
    mockBookmarksRepo.search.mockResolvedValueOnce([
      makeBookmarkRow({ id: 'bk-a', createdAt: now, updatedAt: now }),
      makeBookmarkRow({ id: 'bk-b', createdAt: now2, updatedAt: now2 }),
    ]);

    const result = await store.search('q');

    expect(result[0]!.createdAt).toBe(now.toISOString());
    expect(result[1]!.createdAt).toBe(now2.toISOString());
  });

  it('create: favicon field is passed through correctly', async () => {
    mockBookmarksRepo.create.mockResolvedValueOnce(
      makeBookmarkRow({ favicon: 'https://site.com/icon.png' })
    );

    const result = await store.create({
      url: 'https://site.com',
      title: 'Site',
      favicon: 'https://site.com/icon.png',
      updatedAt: ISO_NOW,
    });

    expect(result.favicon).toBe('https://site.com/icon.png');
  });

  it('update: returns null and does not rethrow when repo returns null', async () => {
    mockBookmarksRepo.update.mockResolvedValueOnce(null);

    await expect(store.update('bk-gone', {})).resolves.toBeNull();
  });
});

describe('NoteStore — additional edge cases', () => {
  let store: NoteStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new NoteStore('edge-user');
  });

  it('create: title defaults to empty string (null coalescing) when title is null', async () => {
    mockNotesRepo.create.mockResolvedValueOnce(makeNoteRow({ title: '' }));

    // Explicit null triggers the ?? '' path
    await store.create({ title: null as unknown as string, content: 'c', updatedAt: ISO_NOW });

    expect(mockNotesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ title: '' }));
  });

  it('get: category undefined is preserved', async () => {
    mockNotesRepo.get.mockResolvedValueOnce(makeNoteRow({ category: undefined }));

    const result = await store.get('n-1');

    expect(result!.category).toBeUndefined();
  });

  it('list: multiple results preserve individual content fields', async () => {
    mockNotesRepo.list.mockResolvedValueOnce([
      makeNoteRow({ id: 'n1', content: 'Content A' }),
      makeNoteRow({ id: 'n2', content: 'Content B' }),
    ]);

    const result = await store.list();

    expect(result[0]!.content).toBe('Content A');
    expect(result[1]!.content).toBe('Content B');
  });

  it('update: passing null id to repo is forwarded correctly', async () => {
    mockNotesRepo.update.mockResolvedValueOnce(null);

    const result = await store.update('nonexistent', { content: 'x' });

    expect(result).toBeNull();
    expect(mockNotesRepo.update).toHaveBeenCalledWith('nonexistent', expect.any(Object));
  });
});

describe('TaskStore — additional edge cases', () => {
  let store: TaskStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new TaskStore('edge-user');
  });

  it('mapTask: all status values are preserved', async () => {
    const statuses = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

    for (const status of statuses) {
      mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow({ status }));
      const result = await store.get('t-1');
      expect(result!.status).toBe(status);
    }
  });

  it('mapTask: all priority values are preserved', async () => {
    const priorities = ['low', 'normal', 'high', 'urgent'] as const;

    for (const priority of priorities) {
      mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow({ priority }));
      const result = await store.get('t-1');
      expect(result!.priority).toBe(priority);
    }
  });

  it('get: parentId undefined when not set', async () => {
    mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow({ parentId: undefined }));

    const result = await store.get('t-1');

    expect(result!.parentId).toBeUndefined();
  });

  it('get: projectId undefined when not set', async () => {
    mockTasksRepo.get.mockResolvedValueOnce(makeTaskRow({ projectId: undefined }));

    const result = await store.get('t-1');

    expect(result!.projectId).toBeUndefined();
  });

  it('get: recurrence preserved when set', async () => {
    mockTasksRepo.get.mockResolvedValueOnce(
      makeTaskRow({ recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' })
    );

    const result = await store.get('t-1');

    expect(result!.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('create: does not forward status field to repo', async () => {
    mockTasksRepo.create.mockResolvedValueOnce(makeTaskRow());

    await store.create({
      title: 'T',
      status: 'in_progress',
      priority: 'normal',
      tags: [],
      updatedAt: ISO_NOW,
    });

    const callArg = mockTasksRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('status');
  });

  it('list: all three filter fields are cast and forwarded', async () => {
    mockTasksRepo.list.mockResolvedValueOnce([]);

    await store.list({ status: 'in_progress', priority: 'high', projectId: 'proj-x' });

    expect(mockTasksRepo.list).toHaveBeenCalledWith({
      status: 'in_progress',
      priority: 'high',
      projectId: 'proj-x',
    });
  });
});

describe('CalendarStore — additional edge cases', () => {
  let store: CalendarStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new CalendarStore('edge-user');
  });

  it('get: allDay false is preserved', async () => {
    mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ allDay: false }));

    const result = await store.get('e-1');

    expect(result!.allDay).toBe(false);
  });

  it('get: allDay true is preserved', async () => {
    mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ allDay: true }));

    const result = await store.get('e-1');

    expect(result!.allDay).toBe(true);
  });

  it('get: attendees array is preserved', async () => {
    mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ attendees: ['a@b.com', 'c@d.com'] }));

    const result = await store.get('e-1');

    expect(result!.attendees).toEqual(['a@b.com', 'c@d.com']);
  });

  it('get: reminderMinutes undefined when not set', async () => {
    mockCalendarRepo.get.mockResolvedValueOnce(makeEventRow({ reminderMinutes: undefined }));

    const result = await store.get('e-1');

    expect(result!.reminderMinutes).toBeUndefined();
  });

  it('search: empty result returns empty array', async () => {
    mockCalendarRepo.search.mockResolvedValueOnce([]);

    expect(await store.search('nothing')).toEqual([]);
  });

  it('update: passes all supported update fields', async () => {
    mockCalendarRepo.update.mockResolvedValueOnce(makeEventRow());

    await store.update('e-1', {
      title: 'New',
      description: 'Desc',
      location: 'Loc',
      startTime: ISO_NOW,
      endTime: ISO_NOW,
      allDay: false,
      timezone: 'Asia/Tokyo',
      recurrence: 'RRULE:FREQ=MONTHLY',
      reminderMinutes: 30,
      category: 'personal',
      tags: ['holiday'],
      color: '#00ff00',
      attendees: ['x@y.com'],
    });

    expect(mockCalendarRepo.update).toHaveBeenCalledWith(
      'e-1',
      expect.objectContaining({
        title: 'New',
        timezone: 'Asia/Tokyo',
        reminderMinutes: 30,
        color: '#00ff00',
      })
    );
  });
});

describe('ContactStore — additional edge cases', () => {
  let store: ContactStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ContactStore('edge-user');
  });

  it('get: isFavorite false is preserved', async () => {
    mockContactsRepo.get.mockResolvedValueOnce(makeContactRow({ isFavorite: false }));

    const result = await store.get('ct-1');

    expect(result!.isFavorite).toBe(false);
  });

  it('get: isFavorite true is preserved', async () => {
    mockContactsRepo.get.mockResolvedValueOnce(makeContactRow({ isFavorite: true }));

    const result = await store.get('ct-1');

    expect(result!.isFavorite).toBe(true);
  });

  it('get: socialLinks object is preserved', async () => {
    mockContactsRepo.get.mockResolvedValueOnce(
      makeContactRow({ socialLinks: { twitter: '@alice', github: 'alice' } })
    );

    const result = await store.get('ct-1');

    expect(result!.socialLinks).toEqual({ twitter: '@alice', github: 'alice' });
  });

  it('get: customFields object is preserved', async () => {
    mockContactsRepo.get.mockResolvedValueOnce(
      makeContactRow({ customFields: { department: 'eng', level: 'senior' } })
    );

    const result = await store.get('ct-1');

    expect(result!.customFields).toEqual({ department: 'eng', level: 'senior' });
  });

  it('list: isFavorite false filter is forwarded', async () => {
    mockContactsRepo.list.mockResolvedValueOnce([]);

    await store.list({ isFavorite: false });

    expect(mockContactsRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ isFavorite: false })
    );
  });

  it('update: passes all contact update fields to repo', async () => {
    mockContactsRepo.update.mockResolvedValueOnce(makeContactRow());

    await store.update('ct-1', {
      name: 'N',
      nickname: 'Nk',
      email: 'n@n.com',
      phone: '+1',
      company: 'Co',
      jobTitle: 'JT',
      avatar: 'av',
      birthday: '2000-01-01',
      address: 'Addr',
      notes: 'Notes',
      relationship: 'rel',
      tags: ['t'],
      isFavorite: true,
      socialLinks: { x: 'y' },
      customFields: { a: 'b' },
    });

    expect(mockContactsRepo.update).toHaveBeenCalledWith(
      'ct-1',
      expect.objectContaining({
        name: 'N',
        nickname: 'Nk',
        jobTitle: 'JT',
        birthday: '2000-01-01',
        address: 'Addr',
        notes: 'Notes',
        relationship: 'rel',
      })
    );
  });

  it('search: multiple results are all mapped with ISO dates', async () => {
    mockContactsRepo.search.mockResolvedValueOnce([
      makeContactRow({ id: 'ct-a' }),
      makeContactRow({ id: 'ct-b' }),
    ]);

    const result = await store.search('smith');

    expect(result).toHaveLength(2);
    expect(result[0]!.createdAt).toBe(ISO_NOW);
    expect(result[1]!.createdAt).toBe(ISO_NOW);
  });

  it('create: name-only contact is valid (all other fields undefined)', async () => {
    mockContactsRepo.create.mockResolvedValueOnce(makeContactRow({ name: 'Minimal' }));

    const result = await store.create({
      name: 'Minimal',
      updatedAt: ISO_NOW,
      tags: [],
      isFavorite: false,
      socialLinks: {},
      customFields: {},
    });

    expect(result.name).toBe('Minimal');
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
  });
});

/**
 * Personal Data Routes Tests
 *
 * Integration tests for the personal data API endpoints.
 * Mocks repository classes to test Tasks, Bookmarks, Notes, Calendar, and Contacts routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTasksRepo = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  complete: vi.fn(),
  getDueToday: vi.fn(async () => []),
  getOverdue: vi.fn(async () => []),
  getUpcoming: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  count: vi.fn(async () => 0),
};

const mockBookmarksRepo = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getFavorites: vi.fn(async () => []),
  getRecent: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  toggleFavorite: vi.fn(),
  count: vi.fn(async () => 0),
};

const mockNotesRepo = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getPinned: vi.fn(async () => []),
  getRecent: vi.fn(async () => []),
  getArchived: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  togglePin: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  count: vi.fn(async () => 0),
};

const mockCalendarRepo = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getToday: vi.fn(async () => []),
  getUpcoming: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  count: vi.fn(async () => 0),
};

const mockContactsRepo = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getFavorites: vi.fn(async () => []),
  getRecentlyContacted: vi.fn(async () => []),
  getUpcomingBirthdays: vi.fn(async () => []),
  getRelationships: vi.fn(async () => []),
  getCompanies: vi.fn(async () => []),
  toggleFavorite: vi.fn(),
  count: vi.fn(async () => 0),
};

vi.mock('../db/repositories/index.js', () => ({
  TasksRepository: vi.fn(function () {
    return mockTasksRepo;
  }),
  BookmarksRepository: vi.fn(function () {
    return mockBookmarksRepo;
  }),
  NotesRepository: vi.fn(function () {
    return mockNotesRepo;
  }),
  CalendarRepository: vi.fn(function () {
    return mockCalendarRepo;
  }),
  ContactsRepository: vi.fn(function () {
    return mockContactsRepo;
  }),
}));

// Import after mocks
const { personalDataRoutes } = await import('./personal-data.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/pd', personalDataRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Personal Data Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // TASKS
  // ========================================================================

  describe('Tasks', () => {
    it('GET /tasks - returns task list', async () => {
      mockTasksRepo.list.mockResolvedValue([{ id: 't1', title: 'Buy milk' }]);

      const res = await app.request('/pd/tasks');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
    });

    it('GET /tasks/today - returns due today', async () => {
      mockTasksRepo.getDueToday.mockResolvedValue([{ id: 't1', title: 'Urgent' }]);

      const res = await app.request('/pd/tasks/today');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /tasks/overdue - returns overdue tasks', async () => {
      mockTasksRepo.getOverdue.mockResolvedValue([{ id: 't1', title: 'Late' }]);

      const res = await app.request('/pd/tasks/overdue');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /tasks/upcoming - returns upcoming tasks', async () => {
      mockTasksRepo.getUpcoming.mockResolvedValue([{ id: 't1' }]);

      const res = await app.request('/pd/tasks/upcoming?days=14');

      expect(res.status).toBe(200);
      expect(mockTasksRepo.getUpcoming).toHaveBeenCalledWith(14);
    });

    it('GET /tasks/categories - returns categories', async () => {
      mockTasksRepo.getCategories.mockResolvedValue(['work', 'personal']);

      const res = await app.request('/pd/tasks/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(['work', 'personal']);
    });

    it('GET /tasks/:id - returns task by id', async () => {
      mockTasksRepo.get.mockResolvedValue({ id: 't1', title: 'Task' });

      const res = await app.request('/pd/tasks/t1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('t1');
    });

    it('GET /tasks/:id - returns 404 when not found', async () => {
      mockTasksRepo.get.mockResolvedValue(null);

      const res = await app.request('/pd/tasks/nonexistent');

      expect(res.status).toBe(404);
    });

    it('POST /tasks - creates a task', async () => {
      mockTasksRepo.create.mockResolvedValue({ id: 't1', title: 'New task' });

      const res = await app.request('/pd/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New task' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.title).toBe('New task');
    });

    it('PATCH /tasks/:id - updates a task', async () => {
      mockTasksRepo.update.mockResolvedValue({ id: 't1', title: 'Updated' });

      const res = await app.request('/pd/tasks/t1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.title).toBe('Updated');
    });

    it('PATCH /tasks/:id - returns 404 when not found', async () => {
      mockTasksRepo.update.mockResolvedValue(null);

      const res = await app.request('/pd/tasks/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('POST /tasks/:id/complete - completes a task', async () => {
      mockTasksRepo.complete.mockResolvedValue({ id: 't1', status: 'completed' });

      const res = await app.request('/pd/tasks/t1/complete', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('completed');
    });

    it('POST /tasks/:id/complete - returns 404 when not found', async () => {
      mockTasksRepo.complete.mockResolvedValue(null);

      const res = await app.request('/pd/tasks/nonexistent/complete', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('DELETE /tasks/:id - deletes a task', async () => {
      mockTasksRepo.delete.mockResolvedValue(true);

      const res = await app.request('/pd/tasks/t1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('DELETE /tasks/:id - returns 404 when not found', async () => {
      mockTasksRepo.delete.mockResolvedValue(false);

      const res = await app.request('/pd/tasks/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // BOOKMARKS
  // ========================================================================

  describe('Bookmarks', () => {
    it('GET /bookmarks - returns bookmark list', async () => {
      mockBookmarksRepo.list.mockResolvedValue([{ id: 'b1', url: 'https://example.com' }]);

      const res = await app.request('/pd/bookmarks');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /bookmarks/favorites - returns favorites', async () => {
      mockBookmarksRepo.getFavorites.mockResolvedValue([{ id: 'b1' }]);

      const res = await app.request('/pd/bookmarks/favorites');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /bookmarks/recent - returns recent bookmarks', async () => {
      mockBookmarksRepo.getRecent.mockResolvedValue([{ id: 'b1' }]);

      const res = await app.request('/pd/bookmarks/recent?limit=5');

      expect(res.status).toBe(200);
      expect(mockBookmarksRepo.getRecent).toHaveBeenCalledWith(5);
    });

    it('GET /bookmarks/categories - returns categories', async () => {
      mockBookmarksRepo.getCategories.mockResolvedValue(['dev', 'news']);

      const res = await app.request('/pd/bookmarks/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(['dev', 'news']);
    });

    it('GET /bookmarks/:id - returns 404 when not found', async () => {
      mockBookmarksRepo.get.mockResolvedValue(null);

      const res = await app.request('/pd/bookmarks/nonexistent');

      expect(res.status).toBe(404);
    });

    it('POST /bookmarks - creates a bookmark', async () => {
      mockBookmarksRepo.create.mockResolvedValue({ id: 'b1', url: 'https://example.com' });

      const res = await app.request('/pd/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', title: 'Example' }),
      });

      expect(res.status).toBe(201);
    });

    it('POST /bookmarks/:id/favorite - toggles favorite', async () => {
      mockBookmarksRepo.toggleFavorite.mockResolvedValue({ id: 'b1', isFavorite: true });

      const res = await app.request('/pd/bookmarks/b1/favorite', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isFavorite).toBe(true);
    });

    it('DELETE /bookmarks/:id - deletes a bookmark', async () => {
      mockBookmarksRepo.delete.mockResolvedValue(true);

      const res = await app.request('/pd/bookmarks/b1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('DELETE /bookmarks/:id - returns 404 when not found', async () => {
      mockBookmarksRepo.delete.mockResolvedValue(false);

      const res = await app.request('/pd/bookmarks/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // NOTES
  // ========================================================================

  describe('Notes', () => {
    it('GET /notes - returns note list', async () => {
      mockNotesRepo.list.mockResolvedValue([{ id: 'n1', title: 'My Note' }]);

      const res = await app.request('/pd/notes');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /notes/pinned - returns pinned notes', async () => {
      mockNotesRepo.getPinned.mockResolvedValue([{ id: 'n1', isPinned: true }]);

      const res = await app.request('/pd/notes/pinned');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /notes/archived - returns archived notes', async () => {
      mockNotesRepo.getArchived.mockResolvedValue([{ id: 'n1' }]);

      const res = await app.request('/pd/notes/archived');

      expect(res.status).toBe(200);
    });

    it('GET /notes/categories - returns categories', async () => {
      mockNotesRepo.getCategories.mockResolvedValue(['ideas', 'meetings']);

      const res = await app.request('/pd/notes/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(['ideas', 'meetings']);
    });

    it('GET /notes/:id - returns 404 when not found', async () => {
      mockNotesRepo.get.mockResolvedValue(null);

      const res = await app.request('/pd/notes/nonexistent');

      expect(res.status).toBe(404);
    });

    it('POST /notes - creates a note', async () => {
      mockNotesRepo.create.mockResolvedValue({ id: 'n1', title: 'New Note' });

      const res = await app.request('/pd/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Note', content: 'Content' }),
      });

      expect(res.status).toBe(201);
    });

    it('POST /notes/:id/pin - toggles pin', async () => {
      mockNotesRepo.togglePin.mockResolvedValue({ id: 'n1', isPinned: true });

      const res = await app.request('/pd/notes/n1/pin', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('POST /notes/:id/archive - archives a note', async () => {
      mockNotesRepo.archive.mockResolvedValue({ id: 'n1', isArchived: true });

      const res = await app.request('/pd/notes/n1/archive', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('POST /notes/:id/unarchive - unarchives a note', async () => {
      mockNotesRepo.unarchive.mockResolvedValue({ id: 'n1', isArchived: false });

      const res = await app.request('/pd/notes/n1/unarchive', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('POST /notes/:id/archive - returns 404 when not found', async () => {
      mockNotesRepo.archive.mockResolvedValue(null);

      const res = await app.request('/pd/notes/nonexistent/archive', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('DELETE /notes/:id - deletes a note', async () => {
      mockNotesRepo.delete.mockResolvedValue(true);

      const res = await app.request('/pd/notes/n1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });
  });

  // ========================================================================
  // CALENDAR
  // ========================================================================

  describe('Calendar', () => {
    it('GET /calendar - returns event list', async () => {
      mockCalendarRepo.list.mockResolvedValue([{ id: 'e1', title: 'Meeting' }]);

      const res = await app.request('/pd/calendar');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /calendar/today - returns today events', async () => {
      mockCalendarRepo.getToday.mockResolvedValue([{ id: 'e1' }]);

      const res = await app.request('/pd/calendar/today');

      expect(res.status).toBe(200);
    });

    it('GET /calendar/upcoming - returns upcoming events', async () => {
      mockCalendarRepo.getUpcoming.mockResolvedValue([{ id: 'e1' }]);

      const res = await app.request('/pd/calendar/upcoming?days=14');

      expect(res.status).toBe(200);
      expect(mockCalendarRepo.getUpcoming).toHaveBeenCalledWith(14);
    });

    it('GET /calendar/categories - returns categories', async () => {
      mockCalendarRepo.getCategories.mockResolvedValue(['work', 'personal']);

      const res = await app.request('/pd/calendar/categories');

      expect(res.status).toBe(200);
    });

    it('GET /calendar/:id - returns 404 when not found', async () => {
      mockCalendarRepo.get.mockResolvedValue(null);

      const res = await app.request('/pd/calendar/nonexistent');

      expect(res.status).toBe(404);
    });

    it('POST /calendar - creates an event', async () => {
      mockCalendarRepo.create.mockResolvedValue({ id: 'e1', title: 'New Event' });

      const res = await app.request('/pd/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Event', startTime: '2026-02-01T10:00:00Z' }),
      });

      expect(res.status).toBe(201);
    });

    it('PATCH /calendar/:id - updates an event', async () => {
      mockCalendarRepo.update.mockResolvedValue({ id: 'e1', title: 'Updated' });

      const res = await app.request('/pd/calendar/e1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('DELETE /calendar/:id - deletes an event', async () => {
      mockCalendarRepo.delete.mockResolvedValue(true);

      const res = await app.request('/pd/calendar/e1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('DELETE /calendar/:id - returns 404 when not found', async () => {
      mockCalendarRepo.delete.mockResolvedValue(false);

      const res = await app.request('/pd/calendar/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // CONTACTS
  // ========================================================================

  describe('Contacts', () => {
    it('GET /contacts - returns contact list', async () => {
      mockContactsRepo.list.mockResolvedValue([{ id: 'c1', name: 'Alice' }]);

      const res = await app.request('/pd/contacts');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('GET /contacts/favorites - returns favorites', async () => {
      mockContactsRepo.getFavorites.mockResolvedValue([{ id: 'c1' }]);

      const res = await app.request('/pd/contacts/favorites');

      expect(res.status).toBe(200);
    });

    it('GET /contacts/recent - returns recently contacted', async () => {
      mockContactsRepo.getRecentlyContacted.mockResolvedValue([{ id: 'c1' }]);

      const res = await app.request('/pd/contacts/recent?limit=5');

      expect(res.status).toBe(200);
      expect(mockContactsRepo.getRecentlyContacted).toHaveBeenCalledWith(5);
    });

    it('GET /contacts/birthdays - returns upcoming birthdays', async () => {
      mockContactsRepo.getUpcomingBirthdays.mockResolvedValue([{ id: 'c1' }]);

      const res = await app.request('/pd/contacts/birthdays?days=60');

      expect(res.status).toBe(200);
      expect(mockContactsRepo.getUpcomingBirthdays).toHaveBeenCalledWith(60);
    });

    it('GET /contacts/relationships - returns relationships', async () => {
      mockContactsRepo.getRelationships.mockResolvedValue(['friend', 'colleague']);

      const res = await app.request('/pd/contacts/relationships');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(['friend', 'colleague']);
    });

    it('GET /contacts/companies - returns companies', async () => {
      mockContactsRepo.getCompanies.mockResolvedValue(['Acme Corp']);

      const res = await app.request('/pd/contacts/companies');

      expect(res.status).toBe(200);
    });

    it('GET /contacts/:id - returns 404 when not found', async () => {
      mockContactsRepo.get.mockResolvedValue(null);

      const res = await app.request('/pd/contacts/nonexistent');

      expect(res.status).toBe(404);
    });

    it('POST /contacts - creates a contact', async () => {
      mockContactsRepo.create.mockResolvedValue({ id: 'c1', name: 'Bob' });

      const res = await app.request('/pd/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
      });

      expect(res.status).toBe(201);
    });

    it('POST /contacts/:id/favorite - toggles favorite', async () => {
      mockContactsRepo.toggleFavorite.mockResolvedValue({ id: 'c1', isFavorite: true });

      const res = await app.request('/pd/contacts/c1/favorite', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('POST /contacts/:id/favorite - returns 404 when not found', async () => {
      mockContactsRepo.toggleFavorite.mockResolvedValue(null);

      const res = await app.request('/pd/contacts/nonexistent/favorite', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('DELETE /contacts/:id - deletes a contact', async () => {
      mockContactsRepo.delete.mockResolvedValue(true);

      const res = await app.request('/pd/contacts/c1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });
  });

  // ========================================================================
  // SUMMARY
  // ========================================================================

  describe('GET /summary', () => {
    it('returns aggregated summary across all data types', async () => {
      mockTasksRepo.count
        .mockResolvedValueOnce(15) // total
        .mockResolvedValueOnce(8) // pending
        .mockResolvedValueOnce(5); // completed
      mockTasksRepo.getOverdue.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      mockTasksRepo.getDueToday.mockResolvedValue([{ id: 't3' }]);
      mockBookmarksRepo.count.mockResolvedValue(20);
      mockBookmarksRepo.getFavorites.mockResolvedValue([{ id: 'b1' }]);
      mockNotesRepo.count.mockResolvedValue(12);
      mockNotesRepo.getPinned.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
      mockNotesRepo.getRecent.mockResolvedValue([{ id: 'n3' }, { id: 'n4' }, { id: 'n5' }]);
      mockCalendarRepo.count.mockResolvedValue(30);
      mockCalendarRepo.getToday.mockResolvedValue([{ id: 'e1' }]);
      mockCalendarRepo.getUpcoming.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
      mockContactsRepo.count.mockResolvedValue(50);
      mockContactsRepo.getFavorites.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      mockContactsRepo.getUpcomingBirthdays.mockResolvedValue([{ id: 'c3' }]);

      const res = await app.request('/pd/summary');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tasks.total).toBe(15);
      expect(json.data.tasks.pending).toBe(8);
      expect(json.data.tasks.completed).toBe(5);
      expect(json.data.tasks.overdue).toBe(2);
      expect(json.data.tasks.dueToday).toBe(1);
      expect(json.data.bookmarks.total).toBe(20);
      expect(json.data.bookmarks.favorites).toBe(1);
      expect(json.data.notes.total).toBe(12);
      expect(json.data.notes.pinned).toBe(2);
      expect(json.data.notes.recent).toBe(3);
      expect(json.data.calendar.total).toBe(30);
      expect(json.data.calendar.today).toBe(1);
      expect(json.data.calendar.upcoming).toBe(3);
      expect(json.data.contacts.total).toBe(50);
      expect(json.data.contacts.favorites).toBe(2);
      expect(json.data.contacts.upcomingBirthdays).toBe(1);
    });
  });
});

/**
 * Personal Data Routes
 *
 * API endpoints for managing personal data:
 * - Tasks
 * - Bookmarks
 * - Notes
 * - Calendar Events
 * - Contacts
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiResponse } from '../types/index.js';
import {
  TasksRepository,
  BookmarksRepository,
  NotesRepository,
  CalendarRepository,
  ContactsRepository,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskQuery,
  type CreateBookmarkInput,
  type UpdateBookmarkInput,
  type BookmarkQuery,
  type CreateNoteInput,
  type UpdateNoteInput,
  type NoteQuery,
  type CreateEventInput,
  type UpdateEventInput,
  type EventQuery,
  type CreateContactInput,
  type UpdateContactInput,
  type ContactQuery,
} from '../db/repositories/index.js';

export const personalDataRoutes = new Hono();

// Default user ID (TODO: get from auth)
const getUserId = () => 'default';

// =====================================================
// TASKS
// =====================================================

const tasksRoutes = new Hono();

tasksRoutes.get('/', (c) => {
  const repo = new TasksRepository(getUserId());
  const query: TaskQuery = {
    status: c.req.query('status') as TaskQuery['status'],
    priority: c.req.query('priority') as TaskQuery['priority'],
    category: c.req.query('category'),
    projectId: c.req.query('projectId'),
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const tasks = repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/today', (c) => {
  const repo = new TasksRepository(getUserId());
  const tasks = repo.getDueToday();
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/overdue', (c) => {
  const repo = new TasksRepository(getUserId());
  const tasks = repo.getOverdue();
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/upcoming', (c) => {
  const repo = new TasksRepository(getUserId());
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 7;
  const tasks = repo.getUpcoming(days);
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/categories', (c) => {
  const repo = new TasksRepository(getUserId());
  const categories = repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/:id', (c) => {
  const repo = new TasksRepository(getUserId());
  const task = repo.get(c.req.param('id'));
  if (!task) {
    throw new HTTPException(404, { message: 'Task not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: task,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.post('/', async (c) => {
  const repo = new TasksRepository(getUserId());
  const body = await c.req.json<CreateTaskInput>();
  const task = repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: task,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

tasksRoutes.patch('/:id', async (c) => {
  const repo = new TasksRepository(getUserId());
  const body = await c.req.json<UpdateTaskInput>();
  const task = repo.update(c.req.param('id'), body);
  if (!task) {
    throw new HTTPException(404, { message: 'Task not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: task,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.post('/:id/complete', (c) => {
  const repo = new TasksRepository(getUserId());
  const task = repo.complete(c.req.param('id'));
  if (!task) {
    throw new HTTPException(404, { message: 'Task not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: task,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.delete('/:id', (c) => {
  const repo = new TasksRepository(getUserId());
  const deleted = repo.delete(c.req.param('id'));
  if (!deleted) {
    throw new HTTPException(404, { message: 'Task not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

// =====================================================
// BOOKMARKS
// =====================================================

const bookmarksRoutes = new Hono();

bookmarksRoutes.get('/', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const query: BookmarkQuery = {
    category: c.req.query('category'),
    isFavorite: c.req.query('favorite') === 'true' ? true : undefined,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const bookmarks = repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/favorites', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const bookmarks = repo.getFavorites();
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/recent', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
  const bookmarks = repo.getRecent(limit);
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/categories', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const categories = repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/:id', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const bookmark = repo.get(c.req.param('id'));
  if (!bookmark) {
    throw new HTTPException(404, { message: 'Bookmark not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: bookmark,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.post('/', async (c) => {
  const repo = new BookmarksRepository(getUserId());
  const body = await c.req.json<CreateBookmarkInput>();
  const bookmark = repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: bookmark,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

bookmarksRoutes.patch('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId());
  const body = await c.req.json<UpdateBookmarkInput>();
  const bookmark = repo.update(c.req.param('id'), body);
  if (!bookmark) {
    throw new HTTPException(404, { message: 'Bookmark not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: bookmark,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.post('/:id/favorite', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const bookmark = repo.toggleFavorite(c.req.param('id'));
  if (!bookmark) {
    throw new HTTPException(404, { message: 'Bookmark not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: bookmark,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.delete('/:id', (c) => {
  const repo = new BookmarksRepository(getUserId());
  const deleted = repo.delete(c.req.param('id'));
  if (!deleted) {
    throw new HTTPException(404, { message: 'Bookmark not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

// =====================================================
// NOTES
// =====================================================

const notesRoutes = new Hono();

notesRoutes.get('/', (c) => {
  const repo = new NotesRepository(getUserId());
  const query: NoteQuery = {
    category: c.req.query('category'),
    isPinned: c.req.query('pinned') === 'true' ? true : undefined,
    isArchived: c.req.query('archived') === 'true' ? true : false,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const notes = repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/pinned', (c) => {
  const repo = new NotesRepository(getUserId());
  const notes = repo.getPinned();
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/archived', (c) => {
  const repo = new NotesRepository(getUserId());
  const notes = repo.getArchived();
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/categories', (c) => {
  const repo = new NotesRepository(getUserId());
  const categories = repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/:id', (c) => {
  const repo = new NotesRepository(getUserId());
  const note = repo.get(c.req.param('id'));
  if (!note) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.post('/', async (c) => {
  const repo = new NotesRepository(getUserId());
  const body = await c.req.json<CreateNoteInput>();
  const note = repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

notesRoutes.patch('/:id', async (c) => {
  const repo = new NotesRepository(getUserId());
  const body = await c.req.json<UpdateNoteInput>();
  const note = repo.update(c.req.param('id'), body);
  if (!note) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.post('/:id/pin', (c) => {
  const repo = new NotesRepository(getUserId());
  const note = repo.togglePin(c.req.param('id'));
  if (!note) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.post('/:id/archive', (c) => {
  const repo = new NotesRepository(getUserId());
  const note = repo.archive(c.req.param('id'));
  if (!note) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.post('/:id/unarchive', (c) => {
  const repo = new NotesRepository(getUserId());
  const note = repo.unarchive(c.req.param('id'));
  if (!note) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.delete('/:id', (c) => {
  const repo = new NotesRepository(getUserId());
  const deleted = repo.delete(c.req.param('id'));
  if (!deleted) {
    throw new HTTPException(404, { message: 'Note not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

// =====================================================
// CALENDAR
// =====================================================

const calendarRoutes = new Hono();

calendarRoutes.get('/', (c) => {
  const repo = new CalendarRepository(getUserId());
  const query: EventQuery = {
    startAfter: c.req.query('startAfter'),
    startBefore: c.req.query('startBefore'),
    category: c.req.query('category'),
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const events = repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/today', (c) => {
  const repo = new CalendarRepository(getUserId());
  const events = repo.getToday();
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/upcoming', (c) => {
  const repo = new CalendarRepository(getUserId());
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 7;
  const events = repo.getUpcoming(days);
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/categories', (c) => {
  const repo = new CalendarRepository(getUserId());
  const categories = repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/:id', (c) => {
  const repo = new CalendarRepository(getUserId());
  const event = repo.get(c.req.param('id'));
  if (!event) {
    throw new HTTPException(404, { message: 'Event not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: event,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.post('/', async (c) => {
  const repo = new CalendarRepository(getUserId());
  const body = await c.req.json<CreateEventInput>();
  const event = repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: event,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

calendarRoutes.patch('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId());
  const body = await c.req.json<UpdateEventInput>();
  const event = repo.update(c.req.param('id'), body);
  if (!event) {
    throw new HTTPException(404, { message: 'Event not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: event,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.delete('/:id', (c) => {
  const repo = new CalendarRepository(getUserId());
  const deleted = repo.delete(c.req.param('id'));
  if (!deleted) {
    throw new HTTPException(404, { message: 'Event not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

// =====================================================
// CONTACTS
// =====================================================

const contactsRoutes = new Hono();

contactsRoutes.get('/', (c) => {
  const repo = new ContactsRepository(getUserId());
  const query: ContactQuery = {
    relationship: c.req.query('relationship'),
    company: c.req.query('company'),
    isFavorite: c.req.query('favorite') === 'true' ? true : undefined,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const contacts = repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/favorites', (c) => {
  const repo = new ContactsRepository(getUserId());
  const contacts = repo.getFavorites();
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/recent', (c) => {
  const repo = new ContactsRepository(getUserId());
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
  const contacts = repo.getRecentlyContacted(limit);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/birthdays', (c) => {
  const repo = new ContactsRepository(getUserId());
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30;
  const contacts = repo.getUpcomingBirthdays(days);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/relationships', (c) => {
  const repo = new ContactsRepository(getUserId());
  const relationships = repo.getRelationships();
  const response: ApiResponse = {
    success: true,
    data: relationships,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/companies', (c) => {
  const repo = new ContactsRepository(getUserId());
  const companies = repo.getCompanies();
  const response: ApiResponse = {
    success: true,
    data: companies,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/:id', (c) => {
  const repo = new ContactsRepository(getUserId());
  const contact = repo.get(c.req.param('id'));
  if (!contact) {
    throw new HTTPException(404, { message: 'Contact not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: contact,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.post('/', async (c) => {
  const repo = new ContactsRepository(getUserId());
  const body = await c.req.json<CreateContactInput>();
  const contact = repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: contact,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

contactsRoutes.patch('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId());
  const body = await c.req.json<UpdateContactInput>();
  const contact = repo.update(c.req.param('id'), body);
  if (!contact) {
    throw new HTTPException(404, { message: 'Contact not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: contact,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.post('/:id/favorite', (c) => {
  const repo = new ContactsRepository(getUserId());
  const contact = repo.toggleFavorite(c.req.param('id'));
  if (!contact) {
    throw new HTTPException(404, { message: 'Contact not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: contact,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.delete('/:id', (c) => {
  const repo = new ContactsRepository(getUserId());
  const deleted = repo.delete(c.req.param('id'));
  if (!deleted) {
    throw new HTTPException(404, { message: 'Contact not found' });
  }
  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

// =====================================================
// MOUNT ALL SUB-ROUTES
// =====================================================

personalDataRoutes.route('/tasks', tasksRoutes);
personalDataRoutes.route('/bookmarks', bookmarksRoutes);
personalDataRoutes.route('/notes', notesRoutes);
personalDataRoutes.route('/calendar', calendarRoutes);
personalDataRoutes.route('/contacts', contactsRoutes);

// Summary endpoint - get overview of all personal data
personalDataRoutes.get('/summary', (c) => {
  const userId = getUserId();

  const tasksRepo = new TasksRepository(userId);
  const bookmarksRepo = new BookmarksRepository(userId);
  const notesRepo = new NotesRepository(userId);
  const calendarRepo = new CalendarRepository(userId);
  const contactsRepo = new ContactsRepository(userId);

  const summary = {
    tasks: {
      total: tasksRepo.count(),
      pending: tasksRepo.count({ status: 'pending' }),
      overdue: tasksRepo.getOverdue().length,
      dueToday: tasksRepo.getDueToday().length,
    },
    bookmarks: {
      total: bookmarksRepo.count(),
      favorites: bookmarksRepo.getFavorites().length,
    },
    notes: {
      total: notesRepo.count(),
      pinned: notesRepo.getPinned().length,
    },
    calendar: {
      total: calendarRepo.count(),
      today: calendarRepo.getToday().length,
      upcoming: calendarRepo.getUpcoming(7).length,
    },
    contacts: {
      total: contactsRepo.count(),
      favorites: contactsRepo.getFavorites().length,
      upcomingBirthdays: contactsRepo.getUpcomingBirthdays(30).length,
    },
  };

  const response: ApiResponse = {
    success: true,
    data: summary,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

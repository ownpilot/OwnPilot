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
import { getUserId } from './helpers.js';

export const personalDataRoutes = new Hono();

// =====================================================
// TASKS
// =====================================================

const tasksRoutes = new Hono();

tasksRoutes.get('/', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const query: TaskQuery = {
    status: c.req.query('status') as TaskQuery['status'],
    priority: c.req.query('priority') as TaskQuery['priority'],
    category: c.req.query('category'),
    projectId: c.req.query('projectId'),
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const tasks = await repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/today', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const tasks = await repo.getDueToday();
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/overdue', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const tasks = await repo.getOverdue();
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/upcoming', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 7;
  const tasks = await repo.getUpcoming(days);
  const response: ApiResponse = {
    success: true,
    data: tasks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/categories', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const categories = await repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

tasksRoutes.get('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const task = await repo.get(c.req.param('id'));
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
  const repo = new TasksRepository(getUserId(c));
  const body = await c.req.json<CreateTaskInput>();
  const task = await repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: task,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

tasksRoutes.patch('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const body = await c.req.json<UpdateTaskInput>();
  const task = await repo.update(c.req.param('id'), body);
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

tasksRoutes.post('/:id/complete', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const task = await repo.complete(c.req.param('id'));
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

tasksRoutes.delete('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
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

bookmarksRoutes.get('/', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const query: BookmarkQuery = {
    category: c.req.query('category'),
    isFavorite: c.req.query('favorite') === 'true' ? true : undefined,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const bookmarks = await repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/favorites', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmarks = await repo.getFavorites();
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/recent', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
  const bookmarks = await repo.getRecent(limit);
  const response: ApiResponse = {
    success: true,
    data: bookmarks,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/categories', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const categories = await repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

bookmarksRoutes.get('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmark = await repo.get(c.req.param('id'));
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
  const repo = new BookmarksRepository(getUserId(c));
  const body = await c.req.json<CreateBookmarkInput>();
  const bookmark = await repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: bookmark,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

bookmarksRoutes.patch('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const body = await c.req.json<UpdateBookmarkInput>();
  const bookmark = await repo.update(c.req.param('id'), body);
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

bookmarksRoutes.post('/:id/favorite', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmark = await repo.toggleFavorite(c.req.param('id'));
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

bookmarksRoutes.delete('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
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

notesRoutes.get('/', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const query: NoteQuery = {
    category: c.req.query('category'),
    isPinned: c.req.query('pinned') === 'true' ? true : undefined,
    isArchived: c.req.query('archived') === 'true' ? true : false,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const notes = await repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/pinned', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const notes = await repo.getPinned();
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/archived', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const notes = await repo.getArchived();
  const response: ApiResponse = {
    success: true,
    data: notes,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/categories', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const categories = await repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

notesRoutes.get('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.get(c.req.param('id'));
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
  const repo = new NotesRepository(getUserId(c));
  const body = await c.req.json<CreateNoteInput>();
  const note = await repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: note,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

notesRoutes.patch('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const body = await c.req.json<UpdateNoteInput>();
  const note = await repo.update(c.req.param('id'), body);
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

notesRoutes.post('/:id/pin', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.togglePin(c.req.param('id'));
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

notesRoutes.post('/:id/archive', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.archive(c.req.param('id'));
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

notesRoutes.post('/:id/unarchive', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.unarchive(c.req.param('id'));
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

notesRoutes.delete('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
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

calendarRoutes.get('/', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const query: EventQuery = {
    startAfter: c.req.query('startAfter'),
    startBefore: c.req.query('startBefore'),
    category: c.req.query('category'),
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const events = await repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/today', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const events = await repo.getToday();
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/upcoming', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 7;
  const events = await repo.getUpcoming(days);
  const response: ApiResponse = {
    success: true,
    data: events,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/categories', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const categories = await repo.getCategories();
  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

calendarRoutes.get('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const event = await repo.get(c.req.param('id'));
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
  const repo = new CalendarRepository(getUserId(c));
  const body = await c.req.json<CreateEventInput>();
  const event = await repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: event,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

calendarRoutes.patch('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const body = await c.req.json<UpdateEventInput>();
  const event = await repo.update(c.req.param('id'), body);
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

calendarRoutes.delete('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
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

contactsRoutes.get('/', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const query: ContactQuery = {
    relationship: c.req.query('relationship'),
    company: c.req.query('company'),
    isFavorite: c.req.query('favorite') === 'true' ? true : undefined,
    search: c.req.query('search'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  };

  const contacts = await repo.list(query);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/favorites', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contacts = await repo.getFavorites();
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/recent', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 10;
  const contacts = await repo.getRecentlyContacted(limit);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/birthdays', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30;
  const contacts = await repo.getUpcomingBirthdays(days);
  const response: ApiResponse = {
    success: true,
    data: contacts,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/relationships', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const relationships = await repo.getRelationships();
  const response: ApiResponse = {
    success: true,
    data: relationships,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/companies', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const companies = await repo.getCompanies();
  const response: ApiResponse = {
    success: true,
    data: companies,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

contactsRoutes.get('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contact = await repo.get(c.req.param('id'));
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
  const repo = new ContactsRepository(getUserId(c));
  const body = await c.req.json<CreateContactInput>();
  const contact = await repo.create(body);
  const response: ApiResponse = {
    success: true,
    data: contact,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response, 201);
});

contactsRoutes.patch('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const body = await c.req.json<UpdateContactInput>();
  const contact = await repo.update(c.req.param('id'), body);
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

contactsRoutes.post('/:id/favorite', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contact = await repo.toggleFavorite(c.req.param('id'));
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

contactsRoutes.delete('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
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
personalDataRoutes.get('/summary', async (c) => {
  const userId = getUserId(c);

  const tasksRepo = new TasksRepository(userId);
  const bookmarksRepo = new BookmarksRepository(userId);
  const notesRepo = new NotesRepository(userId);
  const calendarRepo = new CalendarRepository(userId);
  const contactsRepo = new ContactsRepository(userId);

  const [
    tasksTotal,
    tasksPending,
    tasksOverdue,
    tasksDueToday,
    bookmarksTotal,
    bookmarksFavorites,
    notesTotal,
    notesPinned,
    calendarTotal,
    calendarToday,
    calendarUpcoming,
    contactsTotal,
    contactsFavorites,
    contactsUpcomingBirthdays,
  ] = await Promise.all([
    tasksRepo.count(),
    tasksRepo.count({ status: 'pending' }),
    tasksRepo.getOverdue(),
    tasksRepo.getDueToday(),
    bookmarksRepo.count(),
    bookmarksRepo.getFavorites(),
    notesRepo.count(),
    notesRepo.getPinned(),
    calendarRepo.count(),
    calendarRepo.getToday(),
    calendarRepo.getUpcoming(7),
    contactsRepo.count(),
    contactsRepo.getFavorites(),
    contactsRepo.getUpcomingBirthdays(30),
  ]);

  const summary = {
    tasks: {
      total: tasksTotal,
      pending: tasksPending,
      overdue: tasksOverdue.length,
      dueToday: tasksDueToday.length,
    },
    bookmarks: {
      total: bookmarksTotal,
      favorites: bookmarksFavorites.length,
    },
    notes: {
      total: notesTotal,
      pinned: notesPinned.length,
    },
    calendar: {
      total: calendarTotal,
      today: calendarToday.length,
      upcoming: calendarUpcoming.length,
    },
    contacts: {
      total: contactsTotal,
      favorites: contactsFavorites.length,
      upcomingBirthdays: contactsUpcomingBirthdays.length,
    },
  };

  const response: ApiResponse = {
    success: true,
    data: summary,
    meta: { requestId: c.get('requestId') ?? 'unknown', timestamp: new Date().toISOString() },
  };
  return c.json(response);
});

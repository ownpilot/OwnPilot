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
import { apiResponse, apiError, ERROR_CODES, getUserId, getIntParam, getOptionalIntParam, validateQueryEnum } from './helpers.js';
import { MAX_DAYS_LOOKBACK, MAX_PAGINATION_OFFSET } from '../config/defaults.js';

export const personalDataRoutes = new Hono();

// =====================================================
// TASKS
// =====================================================

const tasksRoutes = new Hono();

tasksRoutes.get('/', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const query: TaskQuery = {
    status: validateQueryEnum(c.req.query('status'), ['pending', 'in_progress', 'completed', 'cancelled'] as const),
    priority: validateQueryEnum(c.req.query('priority'), ['low', 'normal', 'high', 'urgent'] as const),
    category: c.req.query('category'),
    projectId: c.req.query('projectId'),
    search: c.req.query('search'),
    limit: getOptionalIntParam(c, 'limit', 1, 100),
    offset: getOptionalIntParam(c, 'offset', 0, MAX_PAGINATION_OFFSET),
  };

  const tasks = await repo.list(query);
  return apiResponse(c, tasks);
});

tasksRoutes.get('/today', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const tasks = await repo.getDueToday();
  return apiResponse(c, tasks);
});

tasksRoutes.get('/overdue', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const tasks = await repo.getOverdue();
  return apiResponse(c, tasks);
});

tasksRoutes.get('/upcoming', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const days = getIntParam(c, 'days', 7, 1, MAX_DAYS_LOOKBACK);
  const tasks = await repo.getUpcoming(days);
  return apiResponse(c, tasks);
});

tasksRoutes.get('/categories', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const categories = await repo.getCategories();
  return apiResponse(c, categories);
});

tasksRoutes.get('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const task = await repo.get(c.req.param('id'));
  if (!task) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' }, 404);
  }
  return apiResponse(c, task);
});

tasksRoutes.post('/', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  let body: CreateTaskInput;
  try {
    body = await c.req.json<CreateTaskInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const task = await repo.create(body);
  return apiResponse(c, task, 201);
});

tasksRoutes.patch('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  let body: UpdateTaskInput;
  try {
    body = await c.req.json<UpdateTaskInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const task = await repo.update(c.req.param('id'), body);
  if (!task) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' }, 404);
  }
  return apiResponse(c, task);
});

tasksRoutes.post('/:id/complete', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const task = await repo.complete(c.req.param('id'));
  if (!task) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' }, 404);
  }
  return apiResponse(c, task);
});

tasksRoutes.delete('/:id', async (c) => {
  const repo = new TasksRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
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
    limit: getOptionalIntParam(c, 'limit', 1, 100),
    offset: getOptionalIntParam(c, 'offset', 0, MAX_PAGINATION_OFFSET),
  };

  const bookmarks = await repo.list(query);
  return apiResponse(c, bookmarks);
});

bookmarksRoutes.get('/favorites', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmarks = await repo.getFavorites();
  return apiResponse(c, bookmarks);
});

bookmarksRoutes.get('/recent', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const limit = getIntParam(c, 'limit', 10, 1, 50);
  const bookmarks = await repo.getRecent(limit);
  return apiResponse(c, bookmarks);
});

bookmarksRoutes.get('/categories', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const categories = await repo.getCategories();
  return apiResponse(c, categories);
});

bookmarksRoutes.get('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmark = await repo.get(c.req.param('id'));
  if (!bookmark) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bookmark not found' }, 404);
  }
  return apiResponse(c, bookmark);
});

bookmarksRoutes.post('/', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  let body: CreateBookmarkInput;
  try {
    body = await c.req.json<CreateBookmarkInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const bookmark = await repo.create(body);
  return apiResponse(c, bookmark, 201);
});

bookmarksRoutes.patch('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  let body: UpdateBookmarkInput;
  try {
    body = await c.req.json<UpdateBookmarkInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const bookmark = await repo.update(c.req.param('id'), body);
  if (!bookmark) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bookmark not found' }, 404);
  }
  return apiResponse(c, bookmark);
});

bookmarksRoutes.post('/:id/favorite', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const bookmark = await repo.toggleFavorite(c.req.param('id'));
  if (!bookmark) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bookmark not found' }, 404);
  }
  return apiResponse(c, bookmark);
});

bookmarksRoutes.delete('/:id', async (c) => {
  const repo = new BookmarksRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Bookmark not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
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
    limit: getOptionalIntParam(c, 'limit', 1, 100),
    offset: getOptionalIntParam(c, 'offset', 0, MAX_PAGINATION_OFFSET),
  };

  const notes = await repo.list(query);
  return apiResponse(c, notes);
});

notesRoutes.get('/pinned', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const notes = await repo.getPinned();
  return apiResponse(c, notes);
});

notesRoutes.get('/archived', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const notes = await repo.getArchived();
  return apiResponse(c, notes);
});

notesRoutes.get('/categories', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const categories = await repo.getCategories();
  return apiResponse(c, categories);
});

notesRoutes.get('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.get(c.req.param('id'));
  if (!note) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, note);
});

notesRoutes.post('/', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  let body: CreateNoteInput;
  try {
    body = await c.req.json<CreateNoteInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const note = await repo.create(body);
  return apiResponse(c, note, 201);
});

notesRoutes.patch('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  let body: UpdateNoteInput;
  try {
    body = await c.req.json<UpdateNoteInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const note = await repo.update(c.req.param('id'), body);
  if (!note) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, note);
});

notesRoutes.post('/:id/pin', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.togglePin(c.req.param('id'));
  if (!note) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, note);
});

notesRoutes.post('/:id/archive', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.archive(c.req.param('id'));
  if (!note) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, note);
});

notesRoutes.post('/:id/unarchive', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const note = await repo.unarchive(c.req.param('id'));
  if (!note) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, note);
});

notesRoutes.delete('/:id', async (c) => {
  const repo = new NotesRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Note not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
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
    limit: getOptionalIntParam(c, 'limit', 1, 100),
    offset: getOptionalIntParam(c, 'offset', 0, MAX_PAGINATION_OFFSET),
  };

  const events = await repo.list(query);
  return apiResponse(c, events);
});

calendarRoutes.get('/today', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const events = await repo.getToday();
  return apiResponse(c, events);
});

calendarRoutes.get('/upcoming', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const days = getIntParam(c, 'days', 7, 1, MAX_DAYS_LOOKBACK);
  const events = await repo.getUpcoming(days);
  return apiResponse(c, events);
});

calendarRoutes.get('/categories', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const categories = await repo.getCategories();
  return apiResponse(c, categories);
});

calendarRoutes.get('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const event = await repo.get(c.req.param('id'));
  if (!event) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Event not found' }, 404);
  }
  return apiResponse(c, event);
});

calendarRoutes.post('/', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  let body: CreateEventInput;
  try {
    body = await c.req.json<CreateEventInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const event = await repo.create(body);
  return apiResponse(c, event, 201);
});

calendarRoutes.patch('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  let body: UpdateEventInput;
  try {
    body = await c.req.json<UpdateEventInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const event = await repo.update(c.req.param('id'), body);
  if (!event) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Event not found' }, 404);
  }
  return apiResponse(c, event);
});

calendarRoutes.delete('/:id', async (c) => {
  const repo = new CalendarRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Event not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
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
    limit: getOptionalIntParam(c, 'limit', 1, 100),
    offset: getOptionalIntParam(c, 'offset', 0, MAX_PAGINATION_OFFSET),
  };

  const contacts = await repo.list(query);
  return apiResponse(c, contacts);
});

contactsRoutes.get('/favorites', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contacts = await repo.getFavorites();
  return apiResponse(c, contacts);
});

contactsRoutes.get('/recent', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const limit = getIntParam(c, 'limit', 10, 1, 100);
  const contacts = await repo.getRecentlyContacted(limit);
  return apiResponse(c, contacts);
});

contactsRoutes.get('/birthdays', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const days = getIntParam(c, 'days', 30, 1, MAX_DAYS_LOOKBACK);
  const contacts = await repo.getUpcomingBirthdays(days);
  return apiResponse(c, contacts);
});

contactsRoutes.get('/relationships', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const relationships = await repo.getRelationships();
  return apiResponse(c, relationships);
});

contactsRoutes.get('/companies', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const companies = await repo.getCompanies();
  return apiResponse(c, companies);
});

contactsRoutes.get('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contact = await repo.get(c.req.param('id'));
  if (!contact) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' }, 404);
  }
  return apiResponse(c, contact);
});

contactsRoutes.post('/', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  let body: CreateContactInput;
  try {
    body = await c.req.json<CreateContactInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const contact = await repo.create(body);
  return apiResponse(c, contact, 201);
});

contactsRoutes.patch('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  let body: UpdateContactInput;
  try {
    body = await c.req.json<UpdateContactInput>();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }
  const contact = await repo.update(c.req.param('id'), body);
  if (!contact) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' }, 404);
  }
  return apiResponse(c, contact);
});

contactsRoutes.post('/:id/favorite', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const contact = await repo.toggleFavorite(c.req.param('id'));
  if (!contact) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' }, 404);
  }
  return apiResponse(c, contact);
});

contactsRoutes.delete('/:id', async (c) => {
  const repo = new ContactsRepository(getUserId(c));
  const deleted = await repo.delete(c.req.param('id'));
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
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

  return apiResponse(c, summary);
});

/**
 * Productivity Routes
 *
 * API for Pomodoro, Habits, and Captures functionality
 */

import { Hono } from 'hono';
import {
  PomodoroRepository,
  type CreateSessionInput,
  type UpdateSettingsInput,
  type SessionType,
} from '../db/repositories/pomodoro.js';
import {
  HabitsRepository,
  type CreateHabitInput,
  type UpdateHabitInput,
} from '../db/repositories/habits.js';
import {
  CapturesRepository,
  type CreateCaptureInput,
  type ProcessCaptureInput,
  type CaptureType,
} from '../db/repositories/captures.js';
import { apiResponse, getUserId } from './helpers.js'
import { ERROR_CODES } from './helpers.js';

export const productivityRoutes = new Hono();

// =============================================================================
// POMODORO ROUTES
// =============================================================================

const pomodoroRoutes = new Hono();

// Get repository instance
function getPomodoroRepo(userId = 'default'): PomodoroRepository {
  return new PomodoroRepository(userId);
}

/**
 * GET /pomodoro/session - Get active session
 */
pomodoroRoutes.get('/session', async (c) => {
  const userId = getUserId(c);
  const repo = getPomodoroRepo(userId);
  const session = await repo.getActiveSession();

  return apiResponse(c, { session });
});

/**
 * POST /pomodoro/session/start - Start a new session
 */
pomodoroRoutes.post('/session/start', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<CreateSessionInput>();

  if (!body.type || !body.durationMinutes) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'type and durationMinutes are required' },
    }, 400);
  }

  const repo = getPomodoroRepo(userId);

  // Check for active session
  const active = await repo.getActiveSession();
  if (active) {
    return c.json({
      success: false,
      error: { code: 'SESSION_ACTIVE', message: 'A session is already running' },
    }, 400);
  }

  const session = await repo.startSession(body);

  return apiResponse(c, { session, message: `${body.type} session started!` }, 201);
});

/**
 * POST /pomodoro/session/:id/complete - Complete a session
 */
pomodoroRoutes.post('/session/:id/complete', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getPomodoroRepo(userId);
  const session = await repo.completeSession(id);

  if (!session) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' },
    }, 404);
  }

  return apiResponse(c, { session, message: 'Session completed!' });
});

/**
 * POST /pomodoro/session/:id/interrupt - Interrupt a session
 */
pomodoroRoutes.post('/session/:id/interrupt', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>().catch((): { reason?: string } => ({}));

  const repo = getPomodoroRepo(userId);
  const session = await repo.interruptSession(id, body.reason);

  if (!session) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' },
    }, 404);
  }

  return apiResponse(c, { session, message: 'Session interrupted.' });
});

/**
 * GET /pomodoro/sessions - List sessions
 */
pomodoroRoutes.get('/sessions', async (c) => {
  const userId = getUserId(c);
  const type = c.req.query('type') as SessionType | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const repo = getPomodoroRepo(userId);
  const sessions = await repo.listSessions({ type, limit });

  return apiResponse(c, { sessions, count: sessions.length });
});

/**
 * GET /pomodoro/settings - Get settings
 */
pomodoroRoutes.get('/settings', async (c) => {
  const userId = getUserId(c);
  const repo = getPomodoroRepo(userId);
  const settings = await repo.getSettings();

  return apiResponse(c, settings);
});

/**
 * PATCH /pomodoro/settings - Update settings
 */
pomodoroRoutes.patch('/settings', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<UpdateSettingsInput>();

  const repo = getPomodoroRepo(userId);
  const settings = await repo.updateSettings(body);

  return apiResponse(c, settings);
});

/**
 * GET /pomodoro/stats - Get statistics
 */
pomodoroRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const repo = getPomodoroRepo(userId);
  const stats = await repo.getTotalStats();
  const today = await repo.getDailyStats();

  return apiResponse(c, { ...stats, today });
});

/**
 * GET /pomodoro/stats/daily/:date - Get daily stats
 */
pomodoroRoutes.get('/stats/daily/:date', async (c) => {
  const userId = getUserId(c);
  const date = c.req.param('date');

  const repo = getPomodoroRepo(userId);
  const stats = await repo.getDailyStats(date);

  return apiResponse(c, stats ?? { date, completedSessions: 0, totalWorkMinutes: 0, totalBreakMinutes: 0, interruptions: 0 });
});

// =============================================================================
// HABITS ROUTES
// =============================================================================

const habitsRoutes = new Hono();

function getHabitsRepo(userId = 'default'): HabitsRepository {
  return new HabitsRepository(userId);
}

/**
 * GET /habits - List habits
 */
habitsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const category = c.req.query('category');
  const isArchived = c.req.query('archived') === 'true';

  const repo = getHabitsRepo(userId);
  const habits = await repo.list({ category: category ?? undefined, isArchived });

  return apiResponse(c, { habits, count: habits.length });
});

/**
 * POST /habits - Create a habit
 */
habitsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<CreateHabitInput>();

  if (!body.name) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'name is required' },
    }, 400);
  }

  const repo = getHabitsRepo(userId);
  const habit = await repo.create(body);

  return apiResponse(c, { habit, message: 'Habit created!' }, 201);
});

/**
 * GET /habits/today - Get today's habits with status
 */
habitsRoutes.get('/today', async (c) => {
  const userId = getUserId(c);
  const repo = getHabitsRepo(userId);
  const progress = await repo.getTodayProgress();

  return apiResponse(c, progress);
});

/**
 * GET /habits/categories - Get all categories
 */
habitsRoutes.get('/categories', async (c) => {
  const userId = getUserId(c);
  const repo = getHabitsRepo(userId);
  const categories = await repo.getCategories();

  return apiResponse(c, { categories });
});

/**
 * GET /habits/:id - Get a habit
 */
habitsRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const stats = await repo.getHabitStats(id);

  if (!stats) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Habit not found' },
    }, 404);
  }

  return apiResponse(c, stats);
});

/**
 * PATCH /habits/:id - Update a habit
 */
habitsRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<UpdateHabitInput>();

  const repo = getHabitsRepo(userId);
  const habit = await repo.update(id, body);

  if (!habit) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Habit not found' },
    }, 404);
  }

  return apiResponse(c, habit);
});

/**
 * DELETE /habits/:id - Delete a habit
 */
habitsRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const deleted = await repo.delete(id);

  if (!deleted) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Habit not found' },
    }, 404);
  }

  return apiResponse(c, { message: 'Habit deleted.' });
});

/**
 * POST /habits/:id/archive - Archive a habit
 */
habitsRoutes.post('/:id/archive', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const habit = await repo.archive(id);

  if (!habit) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Habit not found' },
    }, 404);
  }

  return apiResponse(c, { habit, message: 'Habit archived.' });
});

/**
 * POST /habits/:id/log - Log habit completion
 */
habitsRoutes.post('/:id/log', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ date?: string; count?: number; notes?: string }>().catch(() => ({}));

  const repo = getHabitsRepo(userId);
  const log = await repo.logHabit(id, body);

  if (!log) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Habit not found' },
    }, 404);
  }

  // Get updated habit stats
  const habit = await repo.get(id);

  return apiResponse(c, { log, habit, message: 'Habit logged!' });
});

/**
 * GET /habits/:id/logs - Get habit logs
 */
habitsRoutes.get('/:id/logs', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const limit = parseInt(c.req.query('limit') ?? '30', 10);

  const repo = getHabitsRepo(userId);
  const logs = await repo.getLogs(id, { startDate: startDate ?? undefined, endDate: endDate ?? undefined, limit });

  return apiResponse(c, { logs, count: logs.length });
});

// =============================================================================
// CAPTURES ROUTES
// =============================================================================

const capturesRoutes = new Hono();

function getCapturesRepo(userId = 'default'): CapturesRepository {
  return new CapturesRepository(userId);
}

/**
 * GET /captures - List captures
 */
capturesRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const type = c.req.query('type') as CaptureType | undefined;
  const tag = c.req.query('tag');
  const processed = c.req.query('processed');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const repo = getCapturesRepo(userId);
  const captures = await repo.list({
    type,
    tag: tag ?? undefined,
    processed: processed === 'true' ? true : processed === 'false' ? false : undefined,
    limit,
    offset,
  });

  return apiResponse(c, { captures, count: captures.length, limit, offset });
});

/**
 * POST /captures - Create a capture
 */
capturesRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<CreateCaptureInput>();

  if (!body.content) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'content is required' },
    }, 400);
  }

  const repo = getCapturesRepo(userId);
  const capture = await repo.create(body);
  const inboxCount = await repo.getInboxCount();

  return apiResponse(c, {
      capture,
      inboxCount,
      message: 'Captured!',
    }, 201);
});

/**
 * GET /captures/inbox - Get unprocessed captures
 */
capturesRoutes.get('/inbox', async (c) => {
  const userId = getUserId(c);
  const limit = parseInt(c.req.query('limit') ?? '10', 10);

  const repo = getCapturesRepo(userId);
  const captures = await repo.getInbox(limit);
  const totalUnprocessed = await repo.getInboxCount();

  // Group by type
  const byType: Record<string, number> = {};
  captures.forEach(cap => {
    byType[cap.type] = (byType[cap.type] || 0) + 1;
  });

  return apiResponse(c, {
      inbox: captures,
      count: captures.length,
      totalUnprocessed,
      byType,
      message: captures.length === 0
        ? 'Inbox is empty! Great job processing your captures.'
        : `${totalUnprocessed} items need processing`,
    });
});

/**
 * GET /captures/stats - Get capture statistics
 */
capturesRoutes.get('/stats', async (c) => {
  const userId = getUserId(c);
  const repo = getCapturesRepo(userId);
  const stats = await repo.getStats();

  return apiResponse(c, stats);
});

/**
 * GET /captures/:id - Get a capture
 */
capturesRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getCapturesRepo(userId);
  const capture = await repo.get(id);

  if (!capture) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture not found' },
    }, 404);
  }

  return apiResponse(c, capture);
});

/**
 * POST /captures/:id/process - Process a capture
 */
capturesRoutes.post('/:id/process', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<ProcessCaptureInput>();

  if (!body.processedAsType) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'processedAsType is required' },
    }, 400);
  }

  const repo = getCapturesRepo(userId);
  const capture = await repo.process(id, body);

  if (!capture) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture not found' },
    }, 404);
  }

  return apiResponse(c, {
      capture,
      message: body.processedAsType === 'discarded'
        ? 'Capture discarded.'
        : `Capture marked as ${body.processedAsType}.`,
    });
});

/**
 * DELETE /captures/:id - Delete a capture
 */
capturesRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const repo = getCapturesRepo(userId);
  const deleted = await repo.delete(id);

  if (!deleted) {
    return c.json({
      success: false,
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Capture not found' },
    }, 404);
  }

  return apiResponse(c, { message: 'Capture deleted.' });
});

// =============================================================================
// Mount sub-routes
// =============================================================================

productivityRoutes.route('/pomodoro', pomodoroRoutes);
productivityRoutes.route('/habits', habitsRoutes);
productivityRoutes.route('/captures', capturesRoutes);

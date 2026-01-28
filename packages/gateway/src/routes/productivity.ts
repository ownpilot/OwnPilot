/**
 * Productivity Routes
 *
 * API for Pomodoro, Habits, and Captures functionality
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
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
pomodoroRoutes.get('/session', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getPomodoroRepo(userId);
  const session = repo.getActiveSession();

  const response: ApiResponse = {
    success: true,
    data: { session },
  };

  return c.json(response);
});

/**
 * POST /pomodoro/session/start - Start a new session
 */
pomodoroRoutes.post('/session/start', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateSessionInput>();

  if (!body.type || !body.durationMinutes) {
    return c.json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'type and durationMinutes are required' },
    }, 400);
  }

  const repo = getPomodoroRepo(userId);

  // Check for active session
  const active = repo.getActiveSession();
  if (active) {
    return c.json({
      success: false,
      error: { code: 'SESSION_ACTIVE', message: 'A session is already running' },
    }, 400);
  }

  const session = repo.startSession(body);

  const response: ApiResponse = {
    success: true,
    data: { session, message: `${body.type} session started!` },
  };

  return c.json(response, 201);
});

/**
 * POST /pomodoro/session/:id/complete - Complete a session
 */
pomodoroRoutes.post('/session/:id/complete', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getPomodoroRepo(userId);
  const session = repo.completeSession(id);

  if (!session) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Session not found or not running' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: { session, message: 'Session completed!' },
  };

  return c.json(response);
});

/**
 * POST /pomodoro/session/:id/interrupt - Interrupt a session
 */
pomodoroRoutes.post('/session/:id/interrupt', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>().catch((): { reason?: string } => ({}));

  const repo = getPomodoroRepo(userId);
  const session = repo.interruptSession(id, body.reason);

  if (!session) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Session not found or not running' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: { session, message: 'Session interrupted.' },
  };

  return c.json(response);
});

/**
 * GET /pomodoro/sessions - List sessions
 */
pomodoroRoutes.get('/sessions', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const type = c.req.query('type') as SessionType | undefined;
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const repo = getPomodoroRepo(userId);
  const sessions = repo.listSessions({ type, limit });

  const response: ApiResponse = {
    success: true,
    data: { sessions, count: sessions.length },
  };

  return c.json(response);
});

/**
 * GET /pomodoro/settings - Get settings
 */
pomodoroRoutes.get('/settings', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getPomodoroRepo(userId);
  const settings = repo.getSettings();

  const response: ApiResponse = {
    success: true,
    data: settings,
  };

  return c.json(response);
});

/**
 * PATCH /pomodoro/settings - Update settings
 */
pomodoroRoutes.patch('/settings', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<UpdateSettingsInput>();

  const repo = getPomodoroRepo(userId);
  const settings = repo.updateSettings(body);

  const response: ApiResponse = {
    success: true,
    data: settings,
  };

  return c.json(response);
});

/**
 * GET /pomodoro/stats - Get statistics
 */
pomodoroRoutes.get('/stats', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getPomodoroRepo(userId);
  const stats = repo.getTotalStats();
  const today = repo.getDailyStats();

  const response: ApiResponse = {
    success: true,
    data: { ...stats, today },
  };

  return c.json(response);
});

/**
 * GET /pomodoro/stats/daily/:date - Get daily stats
 */
pomodoroRoutes.get('/stats/daily/:date', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const date = c.req.param('date');

  const repo = getPomodoroRepo(userId);
  const stats = repo.getDailyStats(date);

  const response: ApiResponse = {
    success: true,
    data: stats ?? { date, completedSessions: 0, totalWorkMinutes: 0, totalBreakMinutes: 0, interruptions: 0 },
  };

  return c.json(response);
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
habitsRoutes.get('/', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const category = c.req.query('category');
  const isArchived = c.req.query('archived') === 'true';

  const repo = getHabitsRepo(userId);
  const habits = repo.list({ category: category ?? undefined, isArchived });

  const response: ApiResponse = {
    success: true,
    data: { habits, count: habits.length },
  };

  return c.json(response);
});

/**
 * POST /habits - Create a habit
 */
habitsRoutes.post('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateHabitInput>();

  if (!body.name) {
    return c.json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'name is required' },
    }, 400);
  }

  const repo = getHabitsRepo(userId);
  const habit = repo.create(body);

  const response: ApiResponse = {
    success: true,
    data: { habit, message: 'Habit created!' },
  };

  return c.json(response, 201);
});

/**
 * GET /habits/today - Get today's habits with status
 */
habitsRoutes.get('/today', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getHabitsRepo(userId);
  const progress = repo.getTodayProgress();

  const response: ApiResponse = {
    success: true,
    data: progress,
  };

  return c.json(response);
});

/**
 * GET /habits/categories - Get all categories
 */
habitsRoutes.get('/categories', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getHabitsRepo(userId);
  const categories = repo.getCategories();

  const response: ApiResponse = {
    success: true,
    data: { categories },
  };

  return c.json(response);
});

/**
 * GET /habits/:id - Get a habit
 */
habitsRoutes.get('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const stats = repo.getHabitStats(id);

  if (!stats) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Habit not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * PATCH /habits/:id - Update a habit
 */
habitsRoutes.patch('/:id', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<UpdateHabitInput>();

  const repo = getHabitsRepo(userId);
  const habit = repo.update(id, body);

  if (!habit) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Habit not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: habit,
  };

  return c.json(response);
});

/**
 * DELETE /habits/:id - Delete a habit
 */
habitsRoutes.delete('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const deleted = repo.delete(id);

  if (!deleted) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Habit not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: { message: 'Habit deleted.' },
  };

  return c.json(response);
});

/**
 * POST /habits/:id/archive - Archive a habit
 */
habitsRoutes.post('/:id/archive', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getHabitsRepo(userId);
  const habit = repo.archive(id);

  if (!habit) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Habit not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: { habit, message: 'Habit archived.' },
  };

  return c.json(response);
});

/**
 * POST /habits/:id/log - Log habit completion
 */
habitsRoutes.post('/:id/log', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<{ date?: string; count?: number; notes?: string }>().catch(() => ({}));

  const repo = getHabitsRepo(userId);
  const log = repo.logHabit(id, body);

  if (!log) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Habit not found' },
    }, 404);
  }

  // Get updated habit stats
  const habit = repo.get(id);

  const response: ApiResponse = {
    success: true,
    data: { log, habit, message: 'Habit logged!' },
  };

  return c.json(response);
});

/**
 * GET /habits/:id/logs - Get habit logs
 */
habitsRoutes.get('/:id/logs', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const limit = parseInt(c.req.query('limit') ?? '30', 10);

  const repo = getHabitsRepo(userId);
  const logs = repo.getLogs(id, { startDate: startDate ?? undefined, endDate: endDate ?? undefined, limit });

  const response: ApiResponse = {
    success: true,
    data: { logs, count: logs.length },
  };

  return c.json(response);
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
capturesRoutes.get('/', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const type = c.req.query('type') as CaptureType | undefined;
  const tag = c.req.query('tag');
  const processed = c.req.query('processed');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const repo = getCapturesRepo(userId);
  const captures = repo.list({
    type,
    tag: tag ?? undefined,
    processed: processed === 'true' ? true : processed === 'false' ? false : undefined,
    limit,
    offset,
  });

  const response: ApiResponse = {
    success: true,
    data: { captures, count: captures.length, limit, offset },
  };

  return c.json(response);
});

/**
 * POST /captures - Create a capture
 */
capturesRoutes.post('/', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const body = await c.req.json<CreateCaptureInput>();

  if (!body.content) {
    return c.json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'content is required' },
    }, 400);
  }

  const repo = getCapturesRepo(userId);
  const capture = repo.create(body);
  const inboxCount = repo.getInboxCount();

  const response: ApiResponse = {
    success: true,
    data: {
      capture,
      inboxCount,
      message: 'Captured!',
    },
  };

  return c.json(response, 201);
});

/**
 * GET /captures/inbox - Get unprocessed captures
 */
capturesRoutes.get('/inbox', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const limit = parseInt(c.req.query('limit') ?? '10', 10);

  const repo = getCapturesRepo(userId);
  const captures = repo.getInbox(limit);
  const totalUnprocessed = repo.getInboxCount();

  // Group by type
  const byType: Record<string, number> = {};
  captures.forEach(cap => {
    byType[cap.type] = (byType[cap.type] || 0) + 1;
  });

  const response: ApiResponse = {
    success: true,
    data: {
      inbox: captures,
      count: captures.length,
      totalUnprocessed,
      byType,
      message: captures.length === 0
        ? 'Inbox is empty! Great job processing your captures.'
        : `${totalUnprocessed} items need processing`,
    },
  };

  return c.json(response);
});

/**
 * GET /captures/stats - Get capture statistics
 */
capturesRoutes.get('/stats', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const repo = getCapturesRepo(userId);
  const stats = repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
  };

  return c.json(response);
});

/**
 * GET /captures/:id - Get a capture
 */
capturesRoutes.get('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getCapturesRepo(userId);
  const capture = repo.get(id);

  if (!capture) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Capture not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: capture,
  };

  return c.json(response);
});

/**
 * POST /captures/:id/process - Process a capture
 */
capturesRoutes.post('/:id/process', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');
  const body = await c.req.json<ProcessCaptureInput>();

  if (!body.processedAsType) {
    return c.json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'processedAsType is required' },
    }, 400);
  }

  const repo = getCapturesRepo(userId);
  const capture = repo.process(id, body);

  if (!capture) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Capture not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: {
      capture,
      message: body.processedAsType === 'discarded'
        ? 'Capture discarded.'
        : `Capture marked as ${body.processedAsType}.`,
    },
  };

  return c.json(response);
});

/**
 * DELETE /captures/:id - Delete a capture
 */
capturesRoutes.delete('/:id', (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const id = c.req.param('id');

  const repo = getCapturesRepo(userId);
  const deleted = repo.delete(id);

  if (!deleted) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Capture not found' },
    }, 404);
  }

  const response: ApiResponse = {
    success: true,
    data: { message: 'Capture deleted.' },
  };

  return c.json(response);
});

// =============================================================================
// Mount sub-routes
// =============================================================================

productivityRoutes.route('/pomodoro', pomodoroRoutes);
productivityRoutes.route('/habits', habitsRoutes);
productivityRoutes.route('/captures', capturesRoutes);

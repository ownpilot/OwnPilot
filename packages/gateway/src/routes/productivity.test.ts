/**
 * Productivity Routes Tests
 *
 * Integration tests for Pomodoro, Habits, and Captures API endpoints.
 * Mocks PomodoroRepository, HabitsRepository, CapturesRepository classes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock instances
// ---------------------------------------------------------------------------

const sampleSession = {
  id: 'ses_001',
  userId: 'default',
  type: 'work',
  status: 'running',
  durationMinutes: 25,
  startedAt: '2026-01-31T10:00:00Z',
  completedAt: null,
  label: 'Deep work',
};

const mockPomodoroMethods = {
  getActiveSession: vi.fn(async () => null),
  startSession: vi.fn(async (input: Record<string, unknown>) => ({ ...sampleSession, ...input })),
  completeSession: vi.fn(async (id: string) =>
    id === 'ses_001'
      ? { ...sampleSession, status: 'completed', completedAt: '2026-01-31T10:25:00Z' }
      : null
  ),
  interruptSession: vi.fn(async (id: string) =>
    id === 'ses_001' ? { ...sampleSession, status: 'interrupted' } : null
  ),
  listSessions: vi.fn(async () => [sampleSession]),
  getSettings: vi.fn(async () => ({
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 4,
  })),
  updateSettings: vi.fn(async (input: Record<string, unknown>) => ({
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 4,
    ...input,
  })),
  getTotalStats: vi.fn(async () => ({
    totalSessions: 100,
    totalWorkMinutes: 2500,
    totalBreakMinutes: 500,
  })),
  getDailyStats: vi.fn(async () => ({
    date: '2026-01-31',
    completedSessions: 4,
    totalWorkMinutes: 100,
    totalBreakMinutes: 20,
    interruptions: 1,
  })),
};

const sampleHabit = {
  id: 'hab_001',
  userId: 'default',
  name: 'Exercise',
  category: 'health',
  frequency: 'daily',
  isArchived: false,
  currentStreak: 5,
  longestStreak: 10,
  createdAt: '2026-01-01T00:00:00Z',
};

const mockHabitsMethods = {
  list: vi.fn(async () => [sampleHabit]),
  create: vi.fn(async (input: Record<string, unknown>) => ({
    ...sampleHabit,
    ...input,
    id: 'hab_new',
  })),
  getTodayProgress: vi.fn(async () => ({
    habits: [{ ...sampleHabit, completedToday: true }],
    completedCount: 1,
    totalCount: 1,
  })),
  getCategories: vi.fn(async () => ['health', 'productivity', 'learning']),
  getHabitStats: vi.fn(async (id: string) =>
    id === 'hab_001' ? { ...sampleHabit, totalCompletions: 50 } : null
  ),
  get: vi.fn(async (id: string) => (id === 'hab_001' ? sampleHabit : null)),
  update: vi.fn(async (id: string, input: Record<string, unknown>) =>
    id === 'hab_001' ? { ...sampleHabit, ...input } : null
  ),
  delete: vi.fn(async (id: string) => id === 'hab_001'),
  archive: vi.fn(async (id: string) =>
    id === 'hab_001' ? { ...sampleHabit, isArchived: true } : null
  ),
  logHabit: vi.fn(async (id: string) =>
    id === 'hab_001' ? { id: 'log_001', habitId: id, date: '2026-01-31', count: 1 } : null
  ),
  getLogs: vi.fn(async () => [{ id: 'log_001', habitId: 'hab_001', date: '2026-01-31', count: 1 }]),
};

const sampleCapture = {
  id: 'cap_001',
  userId: 'default',
  content: 'Remember to buy groceries',
  type: 'thought' as const,
  tags: ['shopping'],
  processed: false,
  createdAt: '2026-01-31T10:00:00Z',
};

const mockCapturesMethods = {
  list: vi.fn(async () => [sampleCapture]),
  create: vi.fn(async (input: Record<string, unknown>) => ({
    ...sampleCapture,
    ...input,
    id: 'cap_new',
  })),
  getInbox: vi.fn(async () => [sampleCapture]),
  getInboxCount: vi.fn(async () => 3),
  getStats: vi.fn(async () => ({ total: 10, processed: 7, unprocessed: 3 })),
  get: vi.fn(async (id: string) => (id === 'cap_001' ? sampleCapture : null)),
  process: vi.fn(async (id: string) =>
    id === 'cap_001' ? { ...sampleCapture, processed: true } : null
  ),
  delete: vi.fn(async (id: string) => id === 'cap_001'),
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/pomodoro.js', () => ({
  PomodoroRepository: vi.fn().mockImplementation(function () {
    return mockPomodoroMethods;
  }),
}));

vi.mock('../db/repositories/habits.js', () => ({
  HabitsRepository: vi.fn().mockImplementation(function () {
    return mockHabitsMethods;
  }),
}));

vi.mock('../db/repositories/captures.js', () => ({
  CapturesRepository: vi.fn().mockImplementation(function () {
    return mockCapturesMethods;
  }),
}));

// Import after mocks
const { productivityRoutes } = await import('./productivity.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/productivity', productivityRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Productivity Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations
    mockPomodoroMethods.getActiveSession.mockResolvedValue(null);
    mockPomodoroMethods.completeSession.mockImplementation(async (id: string) =>
      id === 'ses_001' ? { ...sampleSession, status: 'completed' } : null
    );
    mockPomodoroMethods.interruptSession.mockImplementation(async (id: string) =>
      id === 'ses_001' ? { ...sampleSession, status: 'interrupted' } : null
    );
    mockHabitsMethods.getHabitStats.mockImplementation(async (id: string) =>
      id === 'hab_001' ? { ...sampleHabit, totalCompletions: 50 } : null
    );
    mockHabitsMethods.update.mockImplementation(
      async (id: string, input: Record<string, unknown>) =>
        id === 'hab_001' ? { ...sampleHabit, ...input } : null
    );
    mockHabitsMethods.delete.mockImplementation(async (id: string) => id === 'hab_001');
    mockHabitsMethods.archive.mockImplementation(async (id: string) =>
      id === 'hab_001' ? { ...sampleHabit, isArchived: true } : null
    );
    mockHabitsMethods.logHabit.mockImplementation(async (id: string) =>
      id === 'hab_001' ? { id: 'log_001', habitId: id, date: '2026-01-31', count: 1 } : null
    );
    mockHabitsMethods.get.mockImplementation(async (id: string) =>
      id === 'hab_001' ? sampleHabit : null
    );
    mockCapturesMethods.get.mockImplementation(async (id: string) =>
      id === 'cap_001' ? sampleCapture : null
    );
    mockCapturesMethods.process.mockImplementation(async (id: string) =>
      id === 'cap_001' ? { ...sampleCapture, processed: true } : null
    );
    mockCapturesMethods.delete.mockImplementation(async (id: string) => id === 'cap_001');
    mockCapturesMethods.getInboxCount.mockResolvedValue(3);
    app = createApp();
  });

  // ========================================================================
  // POMODORO
  // ========================================================================

  describe('Pomodoro', () => {
    describe('GET /productivity/pomodoro/session', () => {
      it('returns null when no active session', async () => {
        const res = await app.request('/productivity/pomodoro/session');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.session).toBeNull();
      });

      it('returns active session when one exists', async () => {
        mockPomodoroMethods.getActiveSession.mockResolvedValueOnce(sampleSession);

        const res = await app.request('/productivity/pomodoro/session');
        const json = await res.json();

        expect(json.data.session.id).toBe('ses_001');
        expect(json.data.session.status).toBe('running');
      });
    });

    describe('POST /productivity/pomodoro/session/start', () => {
      it('starts a new session', async () => {
        const res = await app.request('/productivity/pomodoro/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'work', durationMinutes: 25 }),
        });

        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.data.session).toBeDefined();
        expect(json.data.message).toContain('started');
      });

      it('returns 400 when fields missing', async () => {
        const res = await app.request('/productivity/pomodoro/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
      });

      it('returns 400 when session already active', async () => {
        mockPomodoroMethods.getActiveSession.mockResolvedValueOnce(sampleSession);

        const res = await app.request('/productivity/pomodoro/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'work', durationMinutes: 25 }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('SESSION_ACTIVE');
      });
    });

    describe('POST /productivity/pomodoro/session/:id/complete', () => {
      it('completes a session', async () => {
        const res = await app.request('/productivity/pomodoro/session/ses_001/complete', {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.session.status).toBe('completed');
      });

      it('returns 404 when session not found', async () => {
        const res = await app.request('/productivity/pomodoro/session/ses_nonexistent/complete', {
          method: 'POST',
        });

        expect(res.status).toBe(404);
      });
    });

    describe('POST /productivity/pomodoro/session/:id/interrupt', () => {
      it('interrupts a session', async () => {
        const res = await app.request('/productivity/pomodoro/session/ses_001/interrupt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'urgent meeting' }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.session.status).toBe('interrupted');
      });

      it('returns 404 when session not found', async () => {
        const res = await app.request('/productivity/pomodoro/session/ses_nonexistent/interrupt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(404);
      });
    });

    describe('GET /productivity/pomodoro/sessions', () => {
      it('returns session list', async () => {
        const res = await app.request('/productivity/pomodoro/sessions');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.sessions).toHaveLength(1);
        expect(json.data.count).toBe(1);
      });
    });

    describe('GET /productivity/pomodoro/settings', () => {
      it('returns pomodoro settings', async () => {
        const res = await app.request('/productivity/pomodoro/settings');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.workDuration).toBe(25);
        expect(json.data.shortBreakDuration).toBe(5);
      });
    });

    describe('PATCH /productivity/pomodoro/settings', () => {
      it('updates pomodoro settings', async () => {
        const res = await app.request('/productivity/pomodoro/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDuration: 30 }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.workDuration).toBe(30);
      });
    });

    describe('GET /productivity/pomodoro/stats', () => {
      it('returns total and daily stats', async () => {
        const res = await app.request('/productivity/pomodoro/stats');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.totalSessions).toBe(100);
        expect(json.data.today).toBeDefined();
        expect(json.data.today.completedSessions).toBe(4);
      });
    });

    describe('GET /productivity/pomodoro/stats/daily/:date', () => {
      it('returns daily stats for a specific date', async () => {
        const res = await app.request('/productivity/pomodoro/stats/daily/2026-01-31');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.date).toBe('2026-01-31');
      });
    });
  });

  // ========================================================================
  // HABITS
  // ========================================================================

  describe('Habits', () => {
    describe('GET /productivity/habits', () => {
      it('returns list of habits', async () => {
        const res = await app.request('/productivity/habits');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.habits).toHaveLength(1);
        expect(json.data.count).toBe(1);
      });
    });

    describe('POST /productivity/habits', () => {
      it('creates a habit', async () => {
        const res = await app.request('/productivity/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Read', category: 'learning', frequency: 'daily' }),
        });

        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.data.habit.id).toBe('hab_new');
      });

      it('returns 400 when name missing', async () => {
        const res = await app.request('/productivity/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'learning' }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe('GET /productivity/habits/today', () => {
      it('returns today progress', async () => {
        const res = await app.request('/productivity/habits/today');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.completedCount).toBe(1);
      });
    });

    describe('GET /productivity/habits/categories', () => {
      it('returns habit categories', async () => {
        const res = await app.request('/productivity/habits/categories');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.categories).toContain('health');
      });
    });

    describe('GET /productivity/habits/:id', () => {
      it('returns habit stats', async () => {
        const res = await app.request('/productivity/habits/hab_001');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.name).toBe('Exercise');
        expect(json.data.totalCompletions).toBe(50);
      });

      it('returns 404 for unknown habit', async () => {
        const res = await app.request('/productivity/habits/hab_nonexistent');

        expect(res.status).toBe(404);
      });
    });

    describe('PATCH /productivity/habits/:id', () => {
      it('updates a habit', async () => {
        const res = await app.request('/productivity/habits/hab_001', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Morning Exercise' }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.name).toBe('Morning Exercise');
      });

      it('returns 404 for unknown habit', async () => {
        const res = await app.request('/productivity/habits/hab_nonexistent', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        });

        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /productivity/habits/:id', () => {
      it('deletes a habit', async () => {
        const res = await app.request('/productivity/habits/hab_001', { method: 'DELETE' });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.message).toContain('deleted');
      });

      it('returns 404 for unknown habit', async () => {
        const res = await app.request('/productivity/habits/hab_nonexistent', { method: 'DELETE' });

        expect(res.status).toBe(404);
      });
    });

    describe('POST /productivity/habits/:id/archive', () => {
      it('archives a habit', async () => {
        const res = await app.request('/productivity/habits/hab_001/archive', { method: 'POST' });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.habit.isArchived).toBe(true);
      });

      it('returns 404 for unknown habit', async () => {
        const res = await app.request('/productivity/habits/hab_nonexistent/archive', {
          method: 'POST',
        });

        expect(res.status).toBe(404);
      });
    });

    describe('POST /productivity/habits/:id/log', () => {
      it('logs habit completion', async () => {
        const res = await app.request('/productivity/habits/hab_001/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 1 }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.log.habitId).toBe('hab_001');
        expect(json.data.habit).toBeDefined();
      });

      it('returns 404 for unknown habit', async () => {
        const res = await app.request('/productivity/habits/hab_nonexistent/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(404);
      });
    });

    describe('GET /productivity/habits/:id/logs', () => {
      it('returns habit logs', async () => {
        const res = await app.request('/productivity/habits/hab_001/logs');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.logs).toHaveLength(1);
        expect(json.data.count).toBe(1);
      });
    });
  });

  // ========================================================================
  // CAPTURES
  // ========================================================================

  describe('Captures', () => {
    describe('GET /productivity/captures', () => {
      it('returns list of captures', async () => {
        const res = await app.request('/productivity/captures');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.captures).toHaveLength(1);
        expect(json.data.count).toBe(1);
      });
    });

    describe('POST /productivity/captures', () => {
      it('creates a capture', async () => {
        const res = await app.request('/productivity/captures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'New idea', type: 'thought' }),
        });

        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.data.capture.id).toBe('cap_new');
        expect(json.data.inboxCount).toBe(3);
      });

      it('returns 400 when content missing', async () => {
        const res = await app.request('/productivity/captures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'thought' }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe('GET /productivity/captures/inbox', () => {
      it('returns unprocessed captures', async () => {
        const res = await app.request('/productivity/captures/inbox');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.inbox).toHaveLength(1);
        expect(json.data.totalUnprocessed).toBe(3);
        expect(json.data.byType).toBeDefined();
      });
    });

    describe('GET /productivity/captures/stats', () => {
      it('returns capture statistics', async () => {
        const res = await app.request('/productivity/captures/stats');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.total).toBe(10);
        expect(json.data.processed).toBe(7);
        expect(json.data.unprocessed).toBe(3);
      });
    });

    describe('GET /productivity/captures/:id', () => {
      it('returns a capture', async () => {
        const res = await app.request('/productivity/captures/cap_001');

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.id).toBe('cap_001');
        expect(json.data.content).toBe('Remember to buy groceries');
      });

      it('returns 404 for unknown capture', async () => {
        const res = await app.request('/productivity/captures/cap_nonexistent');

        expect(res.status).toBe(404);
      });
    });

    describe('POST /productivity/captures/:id/process', () => {
      it('processes a capture', async () => {
        const res = await app.request('/productivity/captures/cap_001/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processedAsType: 'task' }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.capture.processed).toBe(true);
      });

      it('returns 400 when processedAsType missing', async () => {
        const res = await app.request('/productivity/captures/cap_001/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
      });

      it('returns 404 for unknown capture', async () => {
        const res = await app.request('/productivity/captures/cap_nonexistent/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processedAsType: 'task' }),
        });

        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /productivity/captures/:id', () => {
      it('deletes a capture', async () => {
        const res = await app.request('/productivity/captures/cap_001', { method: 'DELETE' });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.message).toContain('deleted');
      });

      it('returns 404 for unknown capture', async () => {
        const res = await app.request('/productivity/captures/cap_nonexistent', {
          method: 'DELETE',
        });

        expect(res.status).toBe(404);
      });
    });
  });
});

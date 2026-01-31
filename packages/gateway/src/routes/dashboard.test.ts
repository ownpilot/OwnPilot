/**
 * Dashboard Routes Tests
 *
 * Integration tests for the dashboard briefing API endpoints.
 * Mocks DashboardService and briefingCache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleDailyData = {
  calendar: {
    todayEvents: [
      { id: 'evt-1', title: 'Team standup', startTime: '2026-01-31T09:00:00Z', location: 'Zoom' },
    ],
    upcomingEvents: [],
    totalEvents: 1,
  },
  tasks: {
    dueToday: [
      { id: 'task-1', title: 'Review PR', dueDate: '2026-01-31', dueTime: '17:00', status: 'pending', priority: 'high' },
    ],
    overdue: [],
    totalTasks: 1,
  },
  triggers: {
    scheduledToday: [
      { id: 'trigger-1', name: 'Daily report', description: 'Generate report', nextFire: '2026-01-31T18:00:00Z' },
    ],
  },
  memories: { recent: [], total: 0 },
  goals: { active: [], total: 0 },
};

const sampleAIBriefing = {
  summary: 'You have 1 meeting and 1 task today.',
  sections: [],
  cached: false,
  generatedAt: '2026-01-31T08:00:00Z',
};

const mockDashboardService = {
  aggregateDailyData: vi.fn(async () => sampleDailyData),
  generateAIBriefing: vi.fn(async () => sampleAIBriefing),
  generateAIBriefingStreaming: vi.fn(),
  invalidateCache: vi.fn(),
};

const mockBriefingCache = {
  invalidate: vi.fn(),
};

vi.mock('../services/dashboard.js', () => ({
  DashboardService: vi.fn(() => mockDashboardService),
  briefingCache: mockBriefingCache,
}));

// Import after mocks
const { dashboardRoutes } = await import('./dashboard.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/dashboard', dashboardRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardService.aggregateDailyData.mockResolvedValue(sampleDailyData);
    mockDashboardService.generateAIBriefing.mockResolvedValue(sampleAIBriefing);
    app = createApp();
  });

  // ========================================================================
  // GET /dashboard/briefing
  // ========================================================================

  describe('GET /dashboard/briefing', () => {
    it('returns briefing with data and AI summary', async () => {
      const res = await app.request('/dashboard/briefing');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.data).toBeDefined();
      expect(json.data.aiBriefing).toBeDefined();
      expect(json.data.aiBriefing.summary).toContain('1 meeting');
    });

    it('returns only AI briefing when aiOnly=true', async () => {
      const res = await app.request('/dashboard/briefing?aiOnly=true');

      const json = await res.json();
      expect(json.data.data).toBeUndefined();
      expect(json.data.aiBriefing).toBeDefined();
    });

    it('handles AI generation failure gracefully', async () => {
      mockDashboardService.generateAIBriefing.mockRejectedValue(new Error('API rate limit'));

      const res = await app.request('/dashboard/briefing');

      expect(res.status).toBe(200); // Still 200, data available
      const json = await res.json();
      expect(json.data.aiError).toBe('API rate limit');
      expect(json.data.aiBriefing).toBeNull();
    });

    it('returns 500 when data aggregation fails', async () => {
      mockDashboardService.aggregateDailyData.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/dashboard/briefing');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('BRIEFING_FAILED');
    });
  });

  // ========================================================================
  // GET /dashboard/data
  // ========================================================================

  describe('GET /dashboard/data', () => {
    it('returns raw briefing data without AI summary', async () => {
      const res = await app.request('/dashboard/data');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.calendar).toBeDefined();
      expect(json.data.tasks).toBeDefined();
    });

    it('returns 500 on aggregation failure', async () => {
      mockDashboardService.aggregateDailyData.mockRejectedValue(new Error('fail'));

      const res = await app.request('/dashboard/data');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DATA_AGGREGATION_FAILED');
    });
  });

  // ========================================================================
  // POST /dashboard/briefing/refresh
  // ========================================================================

  describe('POST /dashboard/briefing/refresh', () => {
    it('refreshes AI briefing and returns new result', async () => {
      const res = await app.request('/dashboard/briefing/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.refreshed).toBe(true);
      expect(json.data.aiBriefing).toBeDefined();
      expect(mockDashboardService.invalidateCache).toHaveBeenCalled();
    });

    it('returns 500 on refresh failure', async () => {
      mockDashboardService.generateAIBriefing.mockRejectedValue(new Error('fail'));

      const res = await app.request('/dashboard/briefing/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('REFRESH_FAILED');
    });
  });

  // ========================================================================
  // GET /dashboard/timeline
  // ========================================================================

  describe('GET /dashboard/timeline', () => {
    it('returns timeline combining events, tasks, and triggers', async () => {
      const res = await app.request('/dashboard/timeline');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.timeline).toBeDefined();
      expect(json.data.timeline.length).toBe(3); // 1 event + 1 task + 1 trigger
      expect(json.data.date).toBeDefined();
    });

    it('returns 500 on failure', async () => {
      mockDashboardService.aggregateDailyData.mockRejectedValue(new Error('fail'));

      const res = await app.request('/dashboard/timeline');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('TIMELINE_FAILED');
    });
  });

  // ========================================================================
  // DELETE /dashboard/briefing/cache
  // ========================================================================

  describe('DELETE /dashboard/briefing/cache', () => {
    it('clears briefing cache', async () => {
      const res = await app.request('/dashboard/briefing/cache', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.cleared).toBe(true);
      expect(mockBriefingCache.invalidate).toHaveBeenCalledWith('default');
    });
  });
});

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
      {
        id: 'task-1',
        title: 'Review PR',
        dueDate: '2026-01-31',
        dueTime: '17:00',
        status: 'pending',
        priority: 'high',
      },
    ],
    overdue: [],
    totalTasks: 1,
  },
  triggers: {
    scheduledToday: [
      {
        id: 'trigger-1',
        name: 'Daily report',
        description: 'Generate report',
        nextFire: '2026-01-31T18:00:00Z',
      },
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
  DashboardService: vi.fn(function () {
    return mockDashboardService;
  }),
  briefingCache: mockBriefingCache,
}));

vi.mock('./settings.js', () => ({
  getDefaultProvider: vi.fn(async () => null),
  getDefaultModel: vi.fn(async () => null),
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

    it('handles non-JSON body gracefully (catch fallback on line 116)', async () => {
      // Sending no body / wrong content-type triggers the .catch() fallback
      const res = await app.request('/dashboard/briefing/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      });

      // Route still succeeds because body falls back to { provider: undefined, model: undefined }
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.refreshed).toBe(true);
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
  // POST /dashboard/briefing/stream
  // ========================================================================

  describe('POST /dashboard/briefing/stream', () => {
    it('returns 400 when no provider is configured', async () => {
      // Default mock for getDefaultProvider returns null
      const res = await app.request('/dashboard/briefing/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('BRIEFING_FAILED');
    });

    it('starts SSE stream when provider is specified in body', async () => {
      mockDashboardService.generateAIBriefingStreaming.mockImplementation(
        async (_data: unknown, _opts: unknown, onChunk: (chunk: string) => Promise<void>) => {
          await onChunk('Hello ');
          await onChunk('World');
          return { summary: 'Streamed briefing', sections: [], cached: false, generatedAt: '' };
        }
      );

      const res = await app.request('/dashboard/briefing/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' }),
      });

      // SSE response returns 200 with streaming body
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('emits complete and DONE events after successful streaming', async () => {
      mockDashboardService.generateAIBriefingStreaming.mockImplementation(
        async (_data: unknown, _opts: unknown, onChunk: (chunk: string) => Promise<void>) => {
          await onChunk('chunk1');
          return { summary: 'Done summary', sections: [], cached: false, generatedAt: '' };
        }
      );

      const res = await app.request('/dashboard/briefing/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      // Consume the body so lines 287-288 (sendEvent complete + [DONE]) execute
      const body = await res.text();
      expect(body).toContain('complete');
      expect(body).toContain('[DONE]');
    });

    it('handles streaming error gracefully', async () => {
      mockDashboardService.generateAIBriefingStreaming.mockRejectedValue(
        new Error('Stream failed')
      );

      const res = await app.request('/dashboard/briefing/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      // Still returns 200 (SSE; error is sent as an event in the stream)
      expect(res.status).toBe(200);

      // Consume body so the async IIFE (catch/finally blocks) actually executes
      const body = await res.text();
      expect(body).toContain('error');
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

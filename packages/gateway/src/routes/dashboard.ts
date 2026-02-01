/**
 * Dashboard Routes
 *
 * API endpoints for the AI-powered daily briefing dashboard
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import { DashboardService, briefingCache, type DailyBriefingData, type AIBriefing } from '../services/dashboard.js';
import { getLog } from '../services/log.js';

const log = getLog('Dashboard');

export const dashboardRoutes = new Hono();

// Default user ID (TODO: get from auth)
const getUserId = () => 'default';

/**
 * GET /briefing - Get the daily briefing with AI summary
 *
 * Query params:
 * - refresh: boolean - Force refresh the AI briefing (default: false)
 * - aiOnly: boolean - Only return AI briefing, not raw data (default: false)
 * - provider: string - Override AI provider (default: openai)
 * - model: string - Override AI model (default: gpt-4o-mini)
 */
dashboardRoutes.get('/briefing', async (c) => {
  const userId = getUserId();
  const forceRefresh = c.req.query('refresh') === 'true';
  const aiOnly = c.req.query('aiOnly') === 'true';
  const provider = c.req.query('provider');
  const model = c.req.query('model');

  const service = new DashboardService(userId);

  try {
    // Always aggregate data first
    const data = await service.aggregateDailyData();

    // Generate or retrieve cached AI briefing
    let aiBriefing: AIBriefing | null = null;
    let aiError: string | undefined;

    try {
      aiBriefing = await service.generateAIBriefing(data, {
        forceRefresh,
        provider: provider ?? undefined,
        model: model ?? undefined,
      });
    } catch (error) {
      log.error('AI briefing generation failed:', error);
      aiError = error instanceof Error ? error.message : 'AI briefing generation failed';
    }

    const response: ApiResponse<{ data?: DailyBriefingData; aiBriefing: AIBriefing | null; cached?: boolean; aiError?: string }> = {
      success: true,
      data: aiOnly
        ? { aiBriefing, cached: aiBriefing?.cached ?? false, aiError }
        : { data, aiBriefing, cached: aiBriefing?.cached ?? false, aiError },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    log.error('Failed to generate briefing:', error);

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'BRIEFING_FAILED',
        message: error instanceof Error ? error.message : 'Failed to generate briefing',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 500);
  }
});

/**
 * GET /data - Get raw briefing data without AI summary
 */
dashboardRoutes.get('/data', async (c) => {
  const userId = getUserId();
  const service = new DashboardService(userId);

  try {
    const data = await service.aggregateDailyData();

    const response: ApiResponse<DailyBriefingData> = {
      success: true,
      data,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    log.error('Failed to aggregate data:', error);

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'DATA_AGGREGATION_FAILED',
        message: error instanceof Error ? error.message : 'Failed to aggregate data',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 500);
  }
});

/**
 * POST /briefing/refresh - Force refresh the AI briefing
 */
dashboardRoutes.post('/briefing/refresh', async (c) => {
  const userId = getUserId();
  const body = await c.req.json<{ provider?: string; model?: string }>().catch(() => ({ provider: undefined, model: undefined }));

  const service = new DashboardService(userId);

  try {
    // Invalidate cache first
    service.invalidateCache();

    // Aggregate fresh data
    const data = await service.aggregateDailyData();

    // Generate new AI briefing
    const aiBriefing = await service.generateAIBriefing(data, {
      forceRefresh: true,
      provider: body.provider,
      model: body.model,
    });

    const response: ApiResponse<{ aiBriefing: AIBriefing; refreshed: boolean }> = {
      success: true,
      data: { aiBriefing, refreshed: true },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    log.error('Failed to refresh briefing:', error);

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'REFRESH_FAILED',
        message: error instanceof Error ? error.message : 'Failed to refresh briefing',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 500);
  }
});

/**
 * GET /timeline - Get today's timeline view
 */
dashboardRoutes.get('/timeline', async (c) => {
  const userId = getUserId();
  const service = new DashboardService(userId);

  try {
    const data = await service.aggregateDailyData();
    const today = new Date().toISOString().split('T')[0] ?? '';

    // Build timeline from events, tasks, and triggers
    interface TimelineItem {
      id: string;
      time: string;
      type: 'event' | 'task' | 'trigger';
      title: string;
      description?: string;
      status: string;
      priority?: string;
    }

    const timeline: TimelineItem[] = [];

    // Add today's events
    data.calendar.todayEvents.forEach((event) => {
      timeline.push({
        id: event.id,
        time: event.startTime.toString(),
        type: 'event',
        title: event.title,
        description: event.location ?? undefined,
        status: 'scheduled',
      });
    });

    // Add tasks due today
    data.tasks.dueToday.forEach((task) => {
      timeline.push({
        id: task.id,
        time: task.dueTime ? `${task.dueDate}T${task.dueTime}` : `${task.dueDate}T23:59:59`,
        type: 'task',
        title: task.title,
        status: task.status,
        priority: task.priority,
      });
    });

    // Add scheduled triggers
    data.triggers.scheduledToday.forEach((trigger) => {
      if (trigger.nextFire) {
        timeline.push({
          id: trigger.id,
          time: trigger.nextFire.toString(),
          type: 'trigger',
          title: trigger.name,
          description: trigger.description ?? undefined,
          status: 'scheduled',
        });
      }
    });

    // Sort by time
    timeline.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const response: ApiResponse<{ timeline: TimelineItem[]; date: string }> = {
      success: true,
      data: { timeline, date: today },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    log.error('Failed to generate timeline:', error);

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'TIMELINE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to generate timeline',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 500);
  }
});

/**
 * GET /briefing/stream - Stream AI briefing generation (SSE)
 *
 * Query params:
 * - provider: string - AI provider (default: openai)
 * - model: string - AI model (default: gpt-4o-mini)
 */
dashboardRoutes.get('/briefing/stream', async (c) => {
  const userId = getUserId();
  const provider = c.req.query('provider') ?? 'openai';
  const model = c.req.query('model') ?? 'gpt-4o-mini';

  const service = new DashboardService(userId);

  // Set up SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  // Create a TransformStream for SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (data: unknown) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // Start the async generation process
  (async () => {
    try {
      // Invalidate cache for fresh generation
      service.invalidateCache();

      // Aggregate data
      const data = await service.aggregateDailyData();

      // Generate streaming briefing
      const briefing = await service.generateAIBriefingStreaming(
        data,
        { provider, model },
        async (chunk: string) => {
          await sendEvent({ type: 'chunk', content: chunk });
        }
      );

      // Send complete briefing
      await sendEvent({ type: 'complete', briefing });
      await sendEvent('[DONE]');
    } catch (error) {
      log.error('Streaming briefing failed:', error);
      await sendEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Streaming failed',
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * DELETE /briefing/cache - Clear the briefing cache
 */
dashboardRoutes.delete('/briefing/cache', async (c) => {
  const userId = getUserId();
  briefingCache.invalidate(userId);

  const response: ApiResponse<{ cleared: boolean }> = {
    success: true,
    data: { cleared: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

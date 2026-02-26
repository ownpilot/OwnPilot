/**
 * Dashboard Routes
 *
 * API endpoints for the AI-powered daily briefing dashboard
 */

import { Hono } from 'hono';
import { DashboardService, briefingCache, type AIBriefing } from '../services/dashboard.js';
import { getLog } from '../services/log.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import { getDefaultProvider, getDefaultModel } from './settings.js';

const log = getLog('Dashboard');

export const dashboardRoutes = new Hono();

/**
 * GET /briefing - Get the daily briefing with AI summary
 *
 * Query params:
 * - refresh: boolean - Force refresh the AI briefing (default: false)
 * - aiOnly: boolean - Only return AI briefing, not raw data (default: false)
 * - provider: string - Override AI provider (uses configured default)
 * - model: string - Override AI model (uses configured default)
 */
dashboardRoutes.get('/briefing', async (c) => {
  const userId = getUserId(c);
  const forceRefresh = c.req.query('refresh') === 'true';
  const aiOnly = c.req.query('aiOnly') === 'true';
  const queryProvider = c.req.query('provider');
  const queryModel = c.req.query('model');
  const provider = queryProvider ?? (await getDefaultProvider()) ?? undefined;
  const model =
    queryModel ?? (provider ? ((await getDefaultModel(provider)) ?? undefined) : undefined);

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
      aiError = getErrorMessage(error, 'AI briefing generation failed');
    }

    return apiResponse(
      c,
      aiOnly
        ? { aiBriefing, cached: aiBriefing?.cached ?? false, aiError }
        : { data, aiBriefing, cached: aiBriefing?.cached ?? false, aiError }
    );
  } catch (error) {
    log.error('Failed to generate briefing:', error);

    return apiError(
      c,
      {
        code: ERROR_CODES.BRIEFING_FAILED,
        message: getErrorMessage(error, 'Failed to generate briefing'),
      },
      500
    );
  }
});

/**
 * GET /data - Get raw briefing data without AI summary
 */
dashboardRoutes.get('/data', async (c) => {
  const userId = getUserId(c);
  const service = new DashboardService(userId);

  try {
    const data = await service.aggregateDailyData();

    return apiResponse(c, data);
  } catch (error) {
    log.error('Failed to aggregate data:', error);

    return apiError(
      c,
      {
        code: ERROR_CODES.DATA_AGGREGATION_FAILED,
        message: getErrorMessage(error, 'Failed to aggregate data'),
      },
      500
    );
  }
});

/**
 * POST /briefing/refresh - Force refresh the AI briefing
 */
dashboardRoutes.post('/briefing/refresh', async (c) => {
  const userId = getUserId(c);
  const body = await c.req
    .json<{ provider?: string; model?: string }>()
    .catch(() => ({ provider: undefined, model: undefined }));

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

    return apiResponse(c, { aiBriefing, refreshed: true });
  } catch (error) {
    log.error('Failed to refresh briefing:', error);

    return apiError(
      c,
      {
        code: ERROR_CODES.REFRESH_FAILED,
        message: getErrorMessage(error, 'Failed to refresh briefing'),
      },
      500
    );
  }
});

/**
 * GET /timeline - Get today's timeline view
 */
dashboardRoutes.get('/timeline', async (c) => {
  const userId = getUserId(c);
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

    return apiResponse(c, { timeline, date: today });
  } catch (error) {
    log.error('Failed to generate timeline:', error);

    return apiError(
      c,
      {
        code: ERROR_CODES.TIMELINE_FAILED,
        message: getErrorMessage(error, 'Failed to generate timeline'),
      },
      500
    );
  }
});

/**
 * POST /briefing/stream - Stream AI briefing generation (SSE)
 *
 * Body (optional):
 * - provider: string - AI provider (uses configured default)
 * - model: string - AI model (uses configured default)
 */
dashboardRoutes.post('/briefing/stream', async (c) => {
  const userId = getUserId(c);
  const body = (await parseJsonBody<{ provider?: string; model?: string }>(c)) ?? {};
  const provider = body.provider ?? (await getDefaultProvider());
  if (!provider) {
    return apiError(
      c,
      {
        code: ERROR_CODES.BRIEFING_FAILED,
        message: 'No AI provider configured. Add an API key in Settings.',
      },
      400
    );
  }
  const model = body.model ?? (await getDefaultModel(provider));

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
        { provider, model: model ?? undefined },
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
        message: getErrorMessage(error, 'Streaming failed'),
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

/**
 * DELETE /briefing/cache - Clear the briefing cache
 */
dashboardRoutes.delete('/briefing/cache', async (c) => {
  const userId = getUserId(c);
  briefingCache.invalidate(userId);

  return apiResponse(c, { cleared: true });
});

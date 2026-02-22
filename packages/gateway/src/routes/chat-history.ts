/**
 * Chat History & Logs Routes
 *
 * Database-backed CRUD for conversation history, request logs, and context reset.
 * Separated from chat.ts (AI streaming logic) for maintainability.
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getUserId,
  getIntParam,
  getPaginationParams,
  notFoundError,
  getErrorMessage,
  validateQueryEnum,
} from './helpers.js';
import { MAX_DAYS_LOOKBACK } from '../config/defaults.js';
import {
  resetChatAgentContext,
  clearAllChatAgentCaches,
  getDefaultModel,
  getContextBreakdown,
  compactContext,
} from './agents.js';
import { promptInitializedConversations } from './chat-state.js';
import { clearInjectionCache } from '../services/middleware/context-injection.js';
import { getDefaultProvider } from './settings.js';
import { ChatRepository, LogsRepository } from '../db/repositories/index.js';
import { modelConfigsRepo } from '../db/repositories/model-configs.js';

export const chatHistoryRoutes = new Hono();

// =====================================================
// CHAT HISTORY API (Database-backed)
// =====================================================

/**
 * List all conversations (with pagination)
 */
chatHistoryRoutes.get('/history', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c, 50);
  const search = c.req.query('search');
  const agentId = c.req.query('agentId');
  const archived = c.req.query('archived') === 'true';

  const chatRepo = new ChatRepository(userId);
  const conversations = await chatRepo.listConversations({
    limit,
    offset,
    search,
    agentId,
    isArchived: archived,
  });

  return apiResponse(c, {
    conversations: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      agentId: conv.agentId,
      agentName: conv.agentName,
      provider: conv.provider,
      model: conv.model,
      messageCount: conv.messageCount,
      isArchived: conv.isArchived,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    })),
    total: conversations.length,
    limit,
    offset,
  });
});

/**
 * Bulk delete conversations
 * Body: { ids: string[] } | { all: true } | { olderThanDays: number }
 */
chatHistoryRoutes.post('/history/bulk-delete', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Request body is required' },
      400
    );
  }

  try {
    const chatRepo = new ChatRepository(userId);
    let deleted = 0;

    if (body.all === true) {
      // Delete all conversations for this user
      const conversations = await chatRepo.listConversations({ limit: 10000 });
      const ids = conversations.map((c) => c.id);
      deleted = await chatRepo.deleteConversations(ids);
    } else if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
      deleted = await chatRepo.deleteOldConversations(body.olderThanDays);
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      if (body.ids.length > 500) {
        return apiError(
          c,
          { code: ERROR_CODES.INVALID_REQUEST, message: 'Maximum 500 IDs per request' },
          400
        );
      }
      deleted = await chatRepo.deleteConversations(body.ids);
    } else {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'Provide ids array, all: true, or olderThanDays',
        },
        400
      );
    }

    return apiResponse(c, { deleted });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(error, 'Bulk delete failed') },
      500
    );
  }
});

/**
 * Bulk archive/unarchive conversations
 * Body: { ids: string[], archived: boolean }
 */
chatHistoryRoutes.post('/history/bulk-archive', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || !Array.isArray(body.ids) || typeof body.archived !== 'boolean') {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Provide ids array and archived boolean' },
      400
    );
  }

  if (body.ids.length > 500) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Maximum 500 IDs per request' },
      400
    );
  }

  try {
    const chatRepo = new ChatRepository(userId);
    const updated = await chatRepo.archiveConversations(body.ids, body.archived);

    return apiResponse(c, { updated, archived: body.archived });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(error, 'Bulk archive failed') },
      500
    );
  }
});

/**
 * Get conversation with all messages
 */
chatHistoryRoutes.get('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const chatRepo = new ChatRepository(userId);
    const data = await chatRepo.getConversationWithMessages(id);

    if (!data) {
      return notFoundError(c, 'Conversation', id);
    }

    return apiResponse(c, {
      conversation: {
        id: data.conversation.id,
        title: data.conversation.title,
        agentId: data.conversation.agentId,
        agentName: data.conversation.agentName,
        provider: data.conversation.provider,
        model: data.conversation.model,
        messageCount: data.conversation.messageCount,
        isArchived: data.conversation.isArchived,
        createdAt: data.conversation.createdAt.toISOString(),
        updatedAt: data.conversation.updatedAt.toISOString(),
      },
      messages: data.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        provider: msg.provider,
        model: msg.model,
        toolCalls: msg.toolCalls,
        trace: msg.trace,
        isError: msg.isError,
        createdAt: msg.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to fetch conversation'),
      },
      500
    );
  }
});

/**
 * Delete conversation from history
 */
chatHistoryRoutes.delete('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const chatRepo = new ChatRepository(userId);
    const deleted = await chatRepo.deleteConversation(id);

    if (!deleted) {
      return notFoundError(c, 'Conversation', id);
    }

    return apiResponse(c, { deleted: true });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to delete conversation'),
      },
      500
    );
  }
});

/**
 * Archive/unarchive conversation
 */
chatHistoryRoutes.patch('/history/:id/archive', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const body = (await c.req.json().catch(() => null)) as { archived: boolean } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  try {
    const chatRepo = new ChatRepository(userId);
    const updated = await chatRepo.updateConversation(id, { isArchived: body.archived });

    if (!updated) {
      return notFoundError(c, 'Conversation', id);
    }

    return apiResponse(c, { archived: updated.isArchived });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to update conversation'),
      },
      500
    );
  }
});

// =====================================================
// LOGS API (Debug/Analytics)
// =====================================================

/**
 * Get request logs
 */
chatHistoryRoutes.get('/logs', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c, 100);
  const type = validateQueryEnum(c.req.query('type'), [
    'chat',
    'completion',
    'embedding',
    'tool',
    'agent',
    'other',
  ] as const);
  const hasError =
    c.req.query('errors') === 'true' ? true : c.req.query('errors') === 'false' ? false : undefined;
  const conversationId = c.req.query('conversationId');

  const logsRepo = new LogsRepository(userId);
  const logs = await logsRepo.list({
    limit,
    offset,
    type,
    hasError,
    conversationId,
  });

  return apiResponse(c, {
    logs: logs.map((log) => ({
      id: log.id,
      type: log.type,
      conversationId: log.conversationId,
      provider: log.provider,
      model: log.model,
      statusCode: log.statusCode,
      durationMs: log.durationMs,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      error: log.error,
      createdAt: log.createdAt.toISOString(),
    })),
    total: logs.length,
    limit,
    offset,
  });
});

/**
 * Get log statistics
 */
chatHistoryRoutes.get('/logs/stats', async (c) => {
  const userId = getUserId(c);
  const days = getIntParam(c, 'days', 7, 1, MAX_DAYS_LOOKBACK);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logsRepo = new LogsRepository(userId);
  const stats = await logsRepo.getStats(startDate);

  return apiResponse(c, stats);
});

/**
 * Get single log detail
 */
chatHistoryRoutes.get('/logs/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const logsRepo = new LogsRepository(userId);
    const log = await logsRepo.getLog(id);

    if (!log) {
      return notFoundError(c, 'Log', id);
    }

    return apiResponse(c, log);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(error, 'Failed to fetch log') },
      500
    );
  }
});

/**
 * Clear logs
 * Query params:
 * - all=true: Clear ALL logs
 * - olderThanDays=N: Clear logs older than N days (default: 30)
 */
chatHistoryRoutes.delete('/logs', async (c) => {
  const userId = getUserId(c);
  const clearAll = c.req.query('all') === 'true';
  const days = getIntParam(c, 'olderThanDays', 30, 1);

  const logsRepo = new LogsRepository(userId);
  const deleted = clearAll ? await logsRepo.clearAll() : await logsRepo.deleteOldLogs(days);

  return apiResponse(c, {
    deleted,
    mode: clearAll ? 'all' : `older than ${days} days`,
  });
});

// =====================================================
// CONTEXT RESET API
// =====================================================

/**
 * Reset chat context for a provider/model
 * Call this when starting a "New Chat" to clear conversation memory
 */
chatHistoryRoutes.post('/reset-context', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    provider?: string;
    model?: string;
    clearAll?: boolean;
  } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  if (body.clearAll) {
    // Clear all cached chat agents + prompt initialization tracking
    const count = clearAllChatAgentCaches();
    promptInitializedConversations.clear();
    clearInjectionCache();

    return apiResponse(c, {
      cleared: count,
      message: `Cleared ${count} chat agent caches`,
    });
  }

  // Reset specific provider/model context
  const provider = body.provider ?? 'openai';
  const model = body.model ?? (await getDefaultModel(provider)) ?? 'gpt-4o';

  const result = resetChatAgentContext(provider, model);
  // Clear prompt tracking for the old conversation (new one will re-initialize)
  promptInitializedConversations.clear();
  clearInjectionCache();

  return apiResponse(c, {
    reset: result.reset,
    newSessionId: result.newSessionId,
    provider,
    model,
    message: result.reset
      ? `Context reset for ${provider}/${model}`
      : `No cached agent found for ${provider}/${model}`,
  });
});

// =====================================================
// CONTEXT MANAGEMENT
// =====================================================

/**
 * Get detailed context breakdown for the current chat session.
 * Shows system prompt sections, message history tokens, and model limits.
 */
chatHistoryRoutes.get('/context-detail', async (c) => {
  const provider = c.req.query('provider') ?? (await getDefaultProvider()) ?? 'openai';
  const model = c.req.query('model') ?? (await getDefaultModel(provider)) ?? 'gpt-4o';

  // Use user-configured context window from AI Models settings if available
  let userContextWindow: number | undefined;
  try {
    const userConfig = await modelConfigsRepo.getModel(getUserId(c), provider, model);
    userContextWindow = userConfig?.contextWindow ?? undefined;
  } catch {
    // Fall back to pricing defaults
  }

  const breakdown = getContextBreakdown(provider, model, userContextWindow);
  return apiResponse(c, { breakdown });
});

/**
 * Compact conversation context by summarizing old messages.
 * Keeps recent messages and replaces older ones with a concise AI-generated summary.
 */
chatHistoryRoutes.post('/compact', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    provider?: string;
    model?: string;
    keepRecentMessages?: number;
  } | null;

  const provider = body?.provider ?? (await getDefaultProvider()) ?? 'openai';
  const model = body?.model ?? (await getDefaultModel(provider)) ?? 'gpt-4o';
  const keepRecent = body?.keepRecentMessages ?? 6;

  try {
    const result = await compactContext(provider, model, keepRecent);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * Audit Middleware
 *
 * Records usage tracking and request logging after message processing.
 */

import type { MessageMiddleware } from '@ownpilot/core';
import type { AIProvider } from '@ownpilot/core';
import { usageTracker } from '../../routes/costs.js';
import { LogsRepository } from '../../db/repositories/index.js';
import { logChatEvent } from '../../audit/index.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:Audit');

/**
 * Create middleware that records usage and logs requests.
 *
 * Reads from context:
 *   ctx.get('userId'), ctx.get('provider'), ctx.get('model')
 *   ctx.get('agentResult'), ctx.get('durationMs')
 *   ctx.get('conversationId'), ctx.get('agentId')
 *   ctx.get('requestId'), ctx.get('usage')
 */
export function createAuditMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const result = await next();

    const userId = ctx.get<string>('userId') ?? 'default';
    const provider = ctx.get<string>('provider') ?? 'unknown';
    const model = ctx.get<string>('model') ?? 'unknown';
    const durationMs = ctx.get<number>('durationMs') ?? result.durationMs;
    const conversationId = ctx.get<string>('conversationId');
    const agentId = ctx.get<string>('agentId') ?? 'chat';
    const requestId = ctx.get<string>('requestId');
    const usage = ctx.get<{ promptTokens: number; completionTokens: number; totalTokens: number }>('usage');
    const agentResult = ctx.get<{ ok: boolean; error?: { message: string } }>('agentResult');

    // Usage tracking
    try {
      if (agentResult?.ok && usage) {
        await usageTracker.record({
          userId,
          sessionId: conversationId,
          provider: provider as AIProvider,
          model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          latencyMs: Math.round(durationMs),
          requestType: 'chat',
        });
      } else if (!agentResult?.ok) {
        await usageTracker.record({
          userId,
          provider: provider as AIProvider,
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: Math.round(durationMs),
          requestType: 'chat',
          error: agentResult?.error?.message,
        });
      }
    } catch {
      // Ignore tracking errors
    }

    // Audit event logging
    try {
      await logChatEvent({
        type: agentResult?.ok ? 'complete' : 'error',
        agentId,
        sessionId: conversationId ?? 'unknown',
        provider,
        model,
        inputTokens: usage?.promptTokens,
        outputTokens: usage?.completionTokens,
        durationMs: Math.round(durationMs),
        toolCallCount: (result.response.metadata.toolCalls as unknown[])?.length ?? 0,
        error: agentResult?.ok ? undefined : agentResult?.error?.message,
        requestId,
      });
    } catch (e) {
      log.warn('Event logging failed', { error: e });
    }

    // Request log to DB
    try {
      const logsRepo = new LogsRepository(userId);
      await logsRepo.log({
        conversationId,
        type: 'chat',
        provider,
        model,
        endpoint: 'chat/completions',
        method: 'POST',
        requestBody: { message: message.content, source: message.metadata.source },
        responseBody: { contentLength: result.response.content.length },
        statusCode: agentResult?.ok ? 200 : 500,
        inputTokens: usage?.promptTokens,
        outputTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        durationMs: Math.round(durationMs),
        error: agentResult?.ok ? undefined : agentResult?.error?.message,
      });
    } catch {
      // Ignore
    }

    return result;
  };
}

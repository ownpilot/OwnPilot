/**
 * Persistence Middleware
 *
 * Saves user + assistant messages to the chat database after
 * agent execution completes successfully.
 */

import type { MessageMiddleware } from '@ownpilot/core';
import { ChatRepository } from '../../db/repositories/index.js';
import { truncate } from '../../routes/helpers.js';
import { wsGateway } from '../../ws/server.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:Persistence');

/**
 * Create middleware that persists chat messages to the database.
 *
 * Reads from context:
 *   ctx.get('userId')
 *   ctx.get('provider'), ctx.get('model')
 *   ctx.get('conversationId')
 *   ctx.get('agentId')
 *   ctx.get('agentResult')
 *   ctx.get('traceInfo') — optional trace data to attach
 */
export function createPersistenceMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    // Let the pipeline run first
    const result = await next();

    const agentResult = ctx.get<{
      ok: boolean;
      value?: {
        content: string;
        toolCalls?: unknown[];
        usage?: { promptTokens: number; completionTokens: number };
      };
    }>('agentResult');
    if (!agentResult?.ok) return result;

    const userId = ctx.get<string>('userId') ?? 'default';
    const provider = ctx.get<string>('provider');
    const model = ctx.get<string>('model');
    const conversationId =
      ctx.get<string>('conversationId') ?? (result.response.metadata.conversationId as string);
    const agentId = ctx.get<string>('agentId');
    const traceInfo = ctx.get<Record<string, unknown>>('traceInfo');

    if (!conversationId) {
      ctx.addWarning('No conversationId — skipping persistence');
      return result;
    }

    try {
      const chatRepo = new ChatRepository(userId);

      const dbConversation = await chatRepo.getOrCreateConversation(conversationId, {
        title: truncate(message.content),
        agentId,
        agentName: agentId ? undefined : 'Chat',
        provider,
        model,
      });

      // Save user message (store attachment metadata, not base64 blobs)
      await chatRepo.addMessage({
        conversationId: dbConversation.id,
        role: 'user',
        content: message.content,
        provider,
        model,
        ...(message.attachments?.length && {
          attachments: message.attachments
            .filter(
              (a): a is typeof a & { type: 'image' | 'file' } =>
                a.type === 'image' || a.type === 'file'
            )
            .map((a) => ({
              type: a.type,
              mimeType: a.mimeType,
              filename: a.filename,
              size: a.size,
            })),
        }),
      });

      // Save assistant message
      await chatRepo.addMessage({
        conversationId: dbConversation.id,
        role: 'assistant',
        content: result.response.content,
        provider,
        model,
        toolCalls: agentResult.value?.toolCalls
          ? ([...agentResult.value.toolCalls] as unknown[])
          : undefined,
        trace: traceInfo,
        inputTokens: agentResult.value?.usage?.promptTokens,
        outputTokens: agentResult.value?.usage?.completionTokens,
      });

      log.info(`Saved to history: conversation=${dbConversation.id}`);

      // Broadcast to WS clients so history views update in real-time
      wsGateway.broadcast('chat:history:updated', {
        conversationId: dbConversation.id,
        title: dbConversation.title,
        source: message.metadata.source ?? 'web',
        messageCount: dbConversation.messageCount + 2,
      });
    } catch (err) {
      log.warn('Failed to save chat history', { error: err });
      ctx.addWarning('Persistence failed');
    }

    return result;
  };
}

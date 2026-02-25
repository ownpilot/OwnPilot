/**
 * Chat persistence — DB save, logging, and post-chat processing.
 *
 * Extracted from chat.ts — deduplicates the two copy-pasted persistence blocks
 * (streaming and non-streaming) into shared helpers.
 */

import { debugLog, type ToolCall } from '@ownpilot/core';
import { ChatRepository, LogsRepository } from '../db/repositories/index.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import { truncate, getErrorMessage } from './helpers.js';
import { extractMemories, updateGoalProgress, evaluateTriggers } from '../assistant/index.js';
import type { StreamState } from './chat-streaming.js';

const log = getLog('ChatPersistence');

/** Broadcast chat history update to WebSocket clients */
export function broadcastChatUpdate(conversation: {
  id: string;
  title: string | null;
  messageCount: number;
}) {
  wsGateway.broadcast('chat:history:updated', {
    conversationId: conversation.id,
    title: conversation.title ?? '',
    source: 'web',
    messageCount: conversation.messageCount + 2,
  });
}

/** Attachment metadata for persistence (base64 NOT stored in DB) */
export interface AttachmentMeta {
  type: 'image' | 'file';
  mimeType?: string;
  filename?: string;
  size?: number;
  path?: string;
}

/** Parameters for saving chat to database */
export interface SaveChatParams {
  userId: string;
  conversationId: string;
  agentId?: string;
  provider: string;
  model: string;
  userMessage: string;
  assistantContent: string;
  toolCalls?: unknown[];
  trace?: Record<string, unknown>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  historyLength?: number;
  streaming?: boolean;
  ipAddress?: string;
  userAgent?: string;
  attachments?: AttachmentMeta[];
}

/**
 * Save chat to database — shared by both streaming and non-streaming paths.
 * Deduplicates the two ~50-line persistence blocks that were previously copy-pasted.
 */
export async function saveChatToDatabase(params: SaveChatParams): Promise<void> {
  const {
    userId,
    conversationId,
    agentId,
    provider,
    model,
    userMessage,
    assistantContent,
    toolCalls,
    trace,
    usage,
    historyLength,
    streaming,
    ipAddress,
    userAgent,
  } = params;

  try {
    const chatRepo = new ChatRepository(userId);
    const logsRepo = new LogsRepository(userId);

    // Get or create conversation
    const dbConversation = await chatRepo.getOrCreateConversation(conversationId, {
      title: truncate(userMessage),
      agentId,
      agentName: agentId ? undefined : 'Chat',
      provider,
      model,
    });

    // Save user message
    await chatRepo.addMessage({
      conversationId: dbConversation.id,
      role: 'user',
      content: userMessage,
      provider,
      model,
      ...(params.attachments?.length && { attachments: params.attachments }),
    });

    // Save assistant message with trace
    await chatRepo.addMessage({
      conversationId: dbConversation.id,
      role: 'assistant',
      content: assistantContent,
      provider,
      model,
      toolCalls: toolCalls ? [...toolCalls] : undefined,
      trace,
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
    });

    // Extract payload breakdown from debug log
    const recentEntries = debugLog.getRecent(5);
    const payloadEntry = recentEntries.find((e) => e.type === 'request');
    const payloadInfo = payloadEntry?.data as { payload?: Record<string, unknown> } | undefined;

    // Log the request
    logsRepo.log({
      conversationId: dbConversation.id,
      type: 'chat',
      provider,
      model,
      endpoint: 'chat/completions',
      method: 'POST',
      requestBody: {
        message: userMessage,
        history: historyLength ?? 0,
        ...(streaming && { streaming: true }),
        payload: payloadInfo?.payload ?? null,
      },
      responseBody: { contentLength: assistantContent.length, toolCalls: toolCalls?.length ?? 0 },
      statusCode: 200,
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      durationMs: trace?.duration as number | undefined,
      ipAddress,
      userAgent,
    });

    log.info(
      `Saved${streaming ? ' streaming' : ''} to history: conversation=${dbConversation.id}, messages=+2`
    );

    broadcastChatUpdate(dbConversation);
  } catch (err) {
    log.warn(`Failed to save${streaming ? ' streaming' : ''} chat history:`, err);
  }
}

/**
 * Save streaming chat result to database.
 * Convenience wrapper that builds trace info from StreamState.
 */
export async function saveStreamingChat(
  state: StreamState,
  params: {
    userId: string;
    conversationId: string;
    agentId?: string;
    provider: string;
    model: string;
    userMessage: string;
    assistantContent: string;
    toolCalls?: unknown[];
    finishReason?: string;
    historyLength?: number;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  const streamLatency = Math.round(performance.now() - state.startTime);

  const streamTraceInfo = {
    duration: streamLatency,
    toolCalls: state.traceToolCalls.map((tc) => ({
      name: tc.name,
      arguments: tc.arguments,
      result: tc.result,
      success: tc.success,
      duration: tc.duration,
    })),
    modelCalls: state.lastUsage
      ? [
          {
            provider: params.provider,
            model: params.model,
            inputTokens: state.lastUsage.promptTokens,
            outputTokens: state.lastUsage.completionTokens,
            tokens: state.lastUsage.totalTokens,
            duration: streamLatency,
          },
        ]
      : [],
    request: {
      provider: params.provider,
      model: params.model,
      endpoint: '/api/v1/chat',
      messageCount: (params.historyLength ?? 0) + 1,
      streaming: true,
    },
    response: {
      status: 'success' as const,
      finishReason: params.finishReason,
    },
  };

  await saveChatToDatabase({
    ...params,
    trace: streamTraceInfo as Record<string, unknown>,
    usage: state.lastUsage
      ? {
          promptTokens: state.lastUsage.promptTokens,
          completionTokens: state.lastUsage.completionTokens,
          totalTokens: state.lastUsage.totalTokens,
        }
      : undefined,
    streaming: true,
  });
}

/** Track in-flight post-processing for graceful shutdown. */
const pendingTasks = new Set<Promise<unknown>>();

/** Wait for all in-flight post-processing tasks to complete. */
export function waitForPendingProcessing(): Promise<void> {
  return Promise.allSettled([...pendingTasks]).then(() => {});
}

/**
 * Run post-chat processing: extract memories, update goals, evaluate triggers.
 * Runs asynchronously to not block the response.
 */
export function runPostChatProcessing(
  userId: string,
  userMessage: string,
  assistantContent: string,
  toolCalls?: readonly ToolCall[]
): void {
  const task = Promise.all([
    extractMemories(userId, userMessage, assistantContent).catch((e) =>
      log.warn('Memory extraction failed:', e)
    ),
    updateGoalProgress(userId, userMessage, assistantContent, toolCalls).catch((e) =>
      log.warn('Goal progress update failed:', e)
    ),
    evaluateTriggers(userId, userMessage, assistantContent).catch((e) =>
      log.warn('Trigger evaluation failed:', e)
    ),
  ])
    .then(([memoriesExtracted, _, triggerResult]) => {
      if (memoriesExtracted && (memoriesExtracted as number) > 0) {
        log.info(`Extracted ${memoriesExtracted} new memories from conversation`);
      }
      if (triggerResult && typeof triggerResult === 'object') {
        const { triggered, pending, executed } = triggerResult as {
          triggered: string[];
          pending: string[];
          executed: string[];
        };
        if (triggered.length > 0) {
          log.info(`${triggered.length} triggers evaluated`);
        }
        if (executed.length > 0) {
          log.info(`${executed.length} triggers executed successfully`);
        }
        if (pending.length > 0) {
          log.info(`${pending.length} triggers pending/failed`);
        }
      }
    })
    .catch((error) => {
      log.error('Post-chat processing failed', { error: getErrorMessage(error) });
    });

  pendingTasks.add(task);
  task.finally(() => pendingTasks.delete(task));
}

/**
 * ConversationService — single authority for conversation lifecycle and persistence.
 *
 * Owns: resolve/create conversation, save messages, save request logs,
 * broadcast WS updates, and clear channel sessions.
 *
 * Replaces the scattered logic that was spread across chat-persistence.ts,
 * chat.ts, chat-streaming.ts, and service-impl.ts.
 */

import { debugLog, type ToolCall } from '@ownpilot/core';
import { ChatRepository, LogsRepository } from '../db/repositories/index.js';
import { channelSessionsRepo } from '../db/repositories/channel-sessions.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from './log.js';
import { truncate } from '../routes/helpers.js';
import type { StreamState } from '../routes/chat-streaming.js';
import type { CreateConversationInput, Conversation } from '../db/repositories/chat.js';

const log = getLog('ConversationService');

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Attachment metadata stored in DB (base64 NOT stored) */
export interface AttachmentMeta {
  type: 'image' | 'file';
  mimeType?: string;
  filename?: string;
  size?: number;
  path?: string;
}

export interface SaveChatParams {
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

export interface SaveStreamingParams extends Omit<SaveChatParams, 'streaming' | 'trace' | 'usage'> {
  finishReason?: string;
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ConversationService {
  private chatRepo: ChatRepository;
  private logsRepo: LogsRepository;

  constructor(userId: string) {
    this.chatRepo = new ChatRepository(userId);
    this.logsRepo = new LogsRepository(userId);
  }

  // ── Conversation resolution ────────────────

  /** Get existing conversation or create a new one. */
  async getOrCreate(
    conversationId: string | undefined,
    options: CreateConversationInput
  ): Promise<Conversation> {
    return this.chatRepo.getOrCreateConversation(conversationId ?? null, options);
  }

  // ── WebSocket broadcast ────────────────────

  broadcastUpdate(conversation: { id: string; title: string | null; messageCount: number }): void {
    wsGateway.broadcast('chat:history:updated', {
      conversationId: conversation.id,
      title: conversation.title ?? '',
      source: 'web',
      messageCount: conversation.messageCount + 2,
    });
  }

  // ── Persistence: full save (legacy non-bus paths) ─────

  /**
   * Save user + assistant messages AND a request log entry.
   * Use for legacy paths where no persistence middleware is running.
   */
  async saveChat(params: SaveChatParams): Promise<void> {
    await this._persist(params, false);
  }

  /**
   * Save request log ONLY — no message saving.
   * Use for bus paths where the persistence middleware already saved messages.
   */
  async saveLog(params: SaveChatParams): Promise<void> {
    await this._persist(params, true);
  }

  // ── Persistence: streaming convenience wrappers ────────

  /**
   * Save streaming chat — messages + log (legacy streaming path).
   * Builds trace/usage from StreamState automatically.
   */
  async saveStreamingChat(state: StreamState, params: SaveStreamingParams): Promise<void> {
    await this.saveChat({ ...params, ...this._streamExtras(state, params), streaming: true });
  }

  /**
   * Save streaming log only — no messages (bus streaming path).
   * Builds trace/usage from StreamState automatically.
   */
  async saveStreamingLog(state: StreamState, params: SaveStreamingParams): Promise<void> {
    await this.saveLog({ ...params, ...this._streamExtras(state, params), streaming: true });
  }

  // ── Private helpers ────────────────────────

  private async _persist(params: SaveChatParams, logOnly: boolean): Promise<void> {
    try {
      const conv = await this.getOrCreate(params.conversationId, {
        title: truncate(params.userMessage),
        agentId: params.agentId,
        agentName: params.agentId ? undefined : 'Chat',
        provider: params.provider,
        model: params.model,
      });

      if (!logOnly) {
        await this.chatRepo.addMessage({
          conversationId: conv.id,
          role: 'user',
          content: params.userMessage,
          provider: params.provider,
          model: params.model,
          ...(params.attachments?.length && { attachments: params.attachments }),
        });

        await this.chatRepo.addMessage({
          conversationId: conv.id,
          role: 'assistant',
          content: params.assistantContent,
          provider: params.provider,
          model: params.model,
          toolCalls: params.toolCalls ? [...params.toolCalls] : undefined,
          trace: params.trace,
          inputTokens: params.usage?.promptTokens,
          outputTokens: params.usage?.completionTokens,
        });
      }

      // Extract payload breakdown from debug log
      const recentEntries = debugLog.getRecent(5);
      const payloadEntry = recentEntries.find((e) => e.type === 'request');
      const payloadInfo = payloadEntry?.data as { payload?: Record<string, unknown> } | undefined;

      this.logsRepo.log({
        conversationId: conv.id,
        type: 'chat',
        provider: params.provider,
        model: params.model,
        endpoint: 'chat/completions',
        method: 'POST',
        requestBody: {
          message: params.userMessage,
          history: params.historyLength ?? 0,
          ...(params.streaming && { streaming: true }),
          payload: payloadInfo?.payload ?? null,
        },
        responseBody: {
          contentLength: params.assistantContent.length,
          toolCalls: params.toolCalls?.length ?? 0,
        },
        statusCode: 200,
        inputTokens: params.usage?.promptTokens,
        outputTokens: params.usage?.completionTokens,
        totalTokens: params.usage?.totalTokens,
        durationMs: params.trace?.duration as number | undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });

      log.info(
        `Saved${params.streaming ? ' streaming' : ''} to history: conversation=${conv.id}${logOnly ? ' (log only)' : ', messages=+2'}`
      );

      this.broadcastUpdate(conv);
    } catch (err) {
      log.warn(`Failed to save${params.streaming ? ' streaming' : ''} chat history:`, err);
    }
  }

  private _streamExtras(
    state: StreamState,
    params: { provider: string; model: string; historyLength?: number; finishReason?: string }
  ): { trace: Record<string, unknown>; usage?: SaveChatParams['usage'] } {
    const streamLatency = Math.round(performance.now() - state.startTime);
    return {
      trace: {
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
      },
      usage: state.lastUsage
        ? {
            promptTokens: state.lastUsage.promptTokens,
            completionTokens: state.lastUsage.completionTokens,
            totalTokens: state.lastUsage.totalTokens,
          }
        : undefined,
    };
  }
}

// ─────────────────────────────────────────────
// Standalone helpers (backwards compat for callers that don't
// want to instantiate ConversationService directly)
// ─────────────────────────────────────────────

/** Broadcast chat history update to WebSocket clients. */
export function broadcastChatUpdate(conversation: {
  id: string;
  title: string | null;
  messageCount: number;
}): void {
  wsGateway.broadcast('chat:history:updated', {
    conversationId: conversation.id,
    title: conversation.title ?? '',
    source: 'web',
    messageCount: conversation.messageCount + 2,
  });
}

/**
 * Save messages + log to DB.
 * Convenience wrapper for legacy call sites — userId is in params, not constructor.
 */
export async function saveChatToDatabase(
  params: SaveChatParams & { userId: string }
): Promise<void> {
  const { userId, ...rest } = params;
  await new ConversationService(userId).saveChat(rest);
}

/**
 * Save streaming chat (messages + log) to DB.
 * Convenience wrapper for legacy call sites — userId is in params, not constructor.
 */
export async function saveStreamingChat(
  state: StreamState,
  params: SaveStreamingParams & { userId: string }
): Promise<void> {
  const { userId, ...rest } = params;
  await new ConversationService(userId).saveStreamingChat(state, rest);
}

// ─────────────────────────────────────────────
// Channel session clear (not user-scoped)
// ─────────────────────────────────────────────

/**
 * Deactivate the active channel session so the next message starts a new conversation.
 * Returns true if a session was found and deactivated.
 */
export async function clearChannelSession(
  channelUserId: string,
  channelPluginId: string,
  platformChatId: string
): Promise<boolean> {
  const session = await channelSessionsRepo.findActive(
    channelUserId,
    channelPluginId,
    platformChatId
  );
  if (!session) return false;
  await channelSessionsRepo.deactivate(session.id);
  return true;
}

// ─────────────────────────────────────────────
// Post-chat processing (kept here as companion to saveChat)
// ─────────────────────────────────────────────

import { extractMemories, updateGoalProgress, evaluateTriggers } from '../assistant/index.js';
import { getErrorMessage } from '../routes/helpers.js';

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
        if (triggered.length > 0) log.info(`${triggered.length} triggers evaluated`);
        if (executed.length > 0) log.info(`${executed.length} triggers executed successfully`);
        if (pending.length > 0) log.info(`${pending.length} triggers pending/failed`);
      }
    })
    .catch((error) => {
      log.error('Post-chat processing failed', { error: getErrorMessage(error) });
    });

  pendingTasks.add(task);
  task.finally(() => pendingTasks.delete(task));
}

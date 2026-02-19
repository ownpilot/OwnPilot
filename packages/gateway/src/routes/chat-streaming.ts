/**
 * Chat streaming — SSE streaming types, callbacks, and processing.
 *
 * Extracted from chat.ts — contains StreamingConfig, StreamState,
 * createStreamCallbacks, recordStreamUsage, processStreamingViaBus,
 * wireStreamApproval, and extractToolDisplay.
 */

import { streamSSE } from 'hono/streaming';
import type {
  StreamChunkResponse,
  SessionInfo,
} from '../types/index.js';
import type { AIProvider, StreamCallbacks, StreamChunk, ToolCall, ToolEndResult, NormalizedMessage, IMessageBus } from '@ownpilot/core';
import { checkToolCallApproval } from '../assistant/index.js';
import { getSessionInfo } from './agent-service.js';
import { usageTracker } from './costs.js';
import { extractSuggestions, extractMemoriesFromResponse } from '../utils/index.js';
import { generateApprovalId, createApprovalRequest } from '../services/execution-approval.js';
import type { getAgent } from './agent-service.js';
import { saveStreamingChat, runPostChatProcessing } from './chat-persistence.js';

/**
 * Extract display-friendly tool name and args from a ToolCall.
 * For use_tool calls, unwraps the inner tool_name and arguments.
 */
export function extractToolDisplay(toolCall: ToolCall): { displayName: string; displayArgs?: Record<string, unknown> } {
  let parsedArgs: Record<string, unknown> | undefined;
  try { parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : undefined; } catch { /* malformed */ }
  const displayName = toolCall.name === 'use_tool' && parsedArgs?.tool_name
    ? String(parsedArgs.tool_name)
    : toolCall.name;
  const displayArgs = toolCall.name === 'use_tool' && parsedArgs?.arguments
    ? parsedArgs.arguments as Record<string, unknown>
    : parsedArgs;
  return { displayName, displayArgs };
}

/**
 * Wire real-time execution approval via SSE stream.
 * Sends approval_required event and returns a pending ApprovalRequest.
 */
type ApprovalFn = ((category: string, actionType: string, description: string, params: Record<string, unknown>) => Promise<boolean>) | undefined;
export function wireStreamApproval(
  agent: { setRequestApproval: (fn: ApprovalFn) => void },
  stream: { writeSSE: (data: { data: string; event: string }) => Promise<void> },
) {
  agent.setRequestApproval(async (_category: string, actionType: string, description: string, params: Record<string, unknown>) => {
    const approvalId = generateApprovalId();
    await stream.writeSSE({
      data: JSON.stringify({
        type: 'approval_required',
        approvalId,
        category: actionType,
        description,
        code: params.code,
        riskAnalysis: params.riskAnalysis,
      }),
      event: 'approval',
    });
    return createApprovalRequest(approvalId);
  });
}

/** Shared configuration for creating stream callbacks. */
export interface StreamingConfig {
  sseStream: Parameters<Parameters<typeof streamSSE>[1]>[0];
  agent: NonNullable<Awaited<ReturnType<typeof getAgent>>>;
  conversationId: string;
  userId: string;
  agentId: string;
  provider: string;
  model: string;
  historyLength: number;
  contextWindowOverride?: number;
}

/** Accumulated state from streaming, available after stream completes. */
export interface StreamState {
  streamedContent: string;
  lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } | undefined;
  traceToolCalls: Array<{
    name: string;
    arguments?: Record<string, unknown>;
    result?: string;
    success: boolean;
    duration?: number;
    startTime?: number;
  }>;
  startTime: number;
}

/**
 * Create shared StreamCallbacks for SSE streaming.
 * Used by both the MessageBus and Legacy streaming paths to eliminate duplication.
 */
export function createStreamCallbacks(config: StreamingConfig): { callbacks: StreamCallbacks; state: StreamState } {
  const { sseStream, conversationId, userId, agentId, provider, model, historyLength } = config;

  const state: StreamState = {
    streamedContent: '',
    lastUsage: undefined,
    traceToolCalls: [],
    startTime: performance.now(),
  };

  const callbacks: StreamCallbacks = {
    onChunk(chunk: StreamChunk) {
      if (chunk.content) state.streamedContent += chunk.content;

      const data: StreamChunkResponse & { trace?: Record<string, unknown>; session?: SessionInfo } = {
        id: chunk.id,
        conversationId,
        delta: chunk.content,
        toolCalls: chunk.toolCalls?.map((tc) => {
          let args: Record<string, unknown> | undefined;
          try { args = tc.arguments ? JSON.parse(tc.arguments) : undefined; } catch { args = undefined; }
          return { id: tc.id!, name: tc.name!, arguments: args };
        }),
        done: chunk.done,
        finishReason: chunk.finishReason,
        usage: chunk.usage
          ? {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
              ...(chunk.usage.cachedTokens != null && { cachedTokens: chunk.usage.cachedTokens }),
            }
          : undefined,
      };

      if (chunk.done) {
        const { content: memStripped, memories } = extractMemoriesFromResponse(state.streamedContent);
        const { suggestions } = extractSuggestions(memStripped);
        if (suggestions.length > 0) data.suggestions = suggestions;
        if (memories.length > 0) data.memories = memories;
        const streamDuration = Math.round(performance.now() - state.startTime);
        data.trace = {
          duration: streamDuration,
          toolCalls: state.traceToolCalls.map(tc => ({
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            success: tc.success,
            duration: tc.duration,
          })),
          modelCalls: state.lastUsage ? [{
            provider,
            model,
            inputTokens: state.lastUsage.promptTokens,
            outputTokens: state.lastUsage.completionTokens,
            tokens: state.lastUsage.totalTokens,
            duration: streamDuration,
          }] : [],
          autonomyChecks: [],
          dbOperations: { reads: 0, writes: 0 },
          memoryOps: { adds: 0, recalls: 0 },
          triggersFired: [],
          errors: [],
          events: state.traceToolCalls.map(tc => ({
            type: 'tool_call',
            name: tc.name,
            duration: tc.duration,
            success: tc.success,
          })),
          request: {
            provider,
            model,
            endpoint: `/api/v1/chat`,
            messageCount: historyLength + 1,
          },
          response: {
            status: 'success' as const,
            finishReason: chunk.finishReason,
          },
        };
        data.session = {
          ...getSessionInfo(config.agent, config.provider, config.model, config.contextWindowOverride),
          ...(chunk.usage?.cachedTokens != null && { cachedTokens: chunk.usage.cachedTokens }),
        };
      }

      if (chunk.usage) {
        state.lastUsage = {
          promptTokens: chunk.usage.promptTokens,
          completionTokens: chunk.usage.completionTokens,
          totalTokens: chunk.usage.totalTokens,
          cachedTokens: chunk.usage.cachedTokens,
        };
      }

      try {
        sseStream.writeSSE({
          data: JSON.stringify(data),
          event: chunk.done ? 'done' : 'chunk',
        });
      } catch {
        // Client disconnected — stream closed
      }
    },

    async onBeforeToolCall(toolCall: ToolCall) {
      const approval = await checkToolCallApproval(userId, toolCall, {
        agentId,
        conversationId,
        provider,
        model,
      });

      if (!approval.approved) {
        await sseStream.writeSSE({
          data: JSON.stringify({
            type: 'tool_blocked',
            toolCall: { id: toolCall.id, name: toolCall.name },
            reason: approval.reason,
          }),
          event: 'autonomy',
        });
      }

      return { approved: approval.approved, reason: approval.reason };
    },

    onToolStart(toolCall: ToolCall) {
      const { displayName, displayArgs } = extractToolDisplay(toolCall);

      state.traceToolCalls.push({
        name: displayName,
        arguments: displayArgs,
        success: true,
        startTime: performance.now(),
      });

      sseStream.writeSSE({
        data: JSON.stringify({
          type: 'tool_start',
          tool: {
            id: toolCall.id,
            name: displayName,
            arguments: displayArgs,
          },
          timestamp: new Date().toISOString(),
        }),
        event: 'progress',
      });
    },

    onToolEnd(toolCall: ToolCall, result: ToolEndResult) {
      const { displayName } = extractToolDisplay(toolCall);

      const traceEntry = state.traceToolCalls.find(tc => tc.name === displayName && tc.result === undefined);
      if (traceEntry) {
        traceEntry.result = result.content;
        traceEntry.success = !(result.isError ?? false);
        traceEntry.duration = result.durationMs ?? (traceEntry.startTime ? Math.round(performance.now() - traceEntry.startTime) : undefined);
        delete traceEntry.startTime;
      }

      let sandboxed: boolean | undefined;
      let executionMode: string | undefined;
      try {
        const parsed = JSON.parse(result.content);
        if (typeof parsed === 'object' && parsed !== null && 'sandboxed' in parsed) {
          sandboxed = parsed.sandboxed;
          executionMode = parsed.executionMode;
        }
      } catch { /* not JSON or no sandbox info */ }

      sseStream.writeSSE({
        data: JSON.stringify({
          type: 'tool_end',
          tool: {
            id: toolCall.id,
            name: displayName,
          },
          result: {
            success: !(result.isError ?? false),
            preview: result.content.substring(0, 500),
            durationMs: result.durationMs,
            ...(sandboxed !== undefined && { sandboxed }),
            ...(executionMode && { executionMode }),
          },
          timestamp: new Date().toISOString(),
        }),
        event: 'progress',
      });
    },

    onProgress(message: string, data?: Record<string, unknown>) {
      sseStream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message,
          data,
          timestamp: new Date().toISOString(),
        }),
        event: 'progress',
      });
    },

    onError(error: Error) {
      sseStream.writeSSE({
        data: JSON.stringify({ error: error.message }),
        event: 'error',
      });
    },
  };

  return { callbacks, state };
}

/**
 * Record streaming usage/cost metrics.
 */
export async function recordStreamUsage(
  state: StreamState,
  params: { userId: string; conversationId: string; provider: string; model: string; error?: string },
): Promise<void> {
  const latencyMs = Math.round(performance.now() - state.startTime);
  if (state.lastUsage) {
    try {
      await usageTracker.record({
        userId: params.userId,
        sessionId: params.conversationId,
        provider: params.provider as AIProvider,
        model: params.model,
        inputTokens: state.lastUsage.promptTokens,
        outputTokens: state.lastUsage.completionTokens,
        totalTokens: state.lastUsage.totalTokens,
        latencyMs,
        requestType: 'chat',
      });
    } catch { /* Ignore tracking errors */ }
  } else if (params.error) {
    try {
      await usageTracker.record({
        userId: params.userId,
        provider: params.provider as AIProvider,
        model: params.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs,
        requestType: 'chat',
        error: params.error,
      });
    } catch { /* Ignore */ }
  }
}

/**
 * Process a streaming request through the MessageBus pipeline.
 */
export async function processStreamingViaBus(
  bus: IMessageBus,
  sseStream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: {
    agent: NonNullable<Awaited<ReturnType<typeof getAgent>>>;
    chatMessage: string;
    body: { historyLength?: number; directTools?: string[]; provider?: string; model?: string; workspaceId?: string; attachments?: Array<{ type: string; data: string; mimeType: string; filename?: string }> };
    provider: string;
    model: string;
    userId: string;
    agentId: string;
    conversationId: string;
    contextWindowOverride?: number;
  },
): Promise<void> {
  const { agent, chatMessage, body, provider, model, userId, agentId, conversationId, contextWindowOverride } = params;

  const { callbacks, state } = createStreamCallbacks({
    sseStream,
    agent,
    conversationId,
    userId,
    agentId,
    provider,
    model,
    historyLength: body.historyLength ?? 0,
    contextWindowOverride,
  });

  // Normalize into NormalizedMessage
  const normalized: NormalizedMessage = {
    id: crypto.randomUUID(),
    sessionId: conversationId,
    role: 'user',
    content: chatMessage,
    ...(body.attachments?.length && {
      attachments: body.attachments.map((a) => ({
        type: a.type as 'image' | 'file',
        data: a.data,
        mimeType: a.mimeType,
        filename: a.filename,
      })),
    }),
    metadata: {
      source: 'web',
      provider,
      model,
      conversationId,
      agentId,
      stream: true,
    },
    timestamp: new Date(),
  };

  // Process through the pipeline
  const result = await bus.process(normalized, {
    stream: callbacks,
    context: {
      agent,
      userId,
      agentId,
      provider,
      model,
      conversationId,
      directTools: body.directTools,
    },
  });

  await recordStreamUsage(state, {
    userId,
    conversationId,
    provider,
    model,
    error: result.response.metadata.error as string | undefined,
  });

  // Persistence middleware saves to ChatRepository but NOT LogsRepository.
  // Save streaming trace/logs here to match what the legacy path does.
  const assistantContent = result.response.content || state.streamedContent;
  if (assistantContent) {
    const toolCalls = result.response.metadata.toolCalls as unknown[] | undefined;
    await saveStreamingChat(state, {
      userId,
      conversationId,
      agentId,
      provider,
      model,
      userMessage: chatMessage,
      assistantContent,
      toolCalls,
      finishReason: result.response.metadata.finishReason as string | undefined,
      historyLength: body.historyLength,
    });

    // Post-processing middleware skips web UI memory extraction.
    // Run it here so web chat messages also generate memories.
    runPostChatProcessing(userId, chatMessage, assistantContent, toolCalls as never);
  }
}

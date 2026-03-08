/**
 * Chat — Legacy Direct Send Path
 *
 * Non-streaming, non-MessageBus chat execution.
 * Used as a fallback when MessageBus is not available.
 */

import type { Context } from 'hono';
import type { ChatRequest } from '../types/index.js';
import type { AIProvider } from '@ownpilot/core';
import { apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { getSessionInfo } from './agents.js';
import { usageTracker } from './costs.js';
import { logChatEvent } from '../audit/index.js';
import { LogsRepository } from '../db/repositories/index.js';
import { buildEnhancedSystemPrompt, checkToolCallApproval } from '../assistant/index.js';
import {
  createTraceContext,
  withTraceContextAsync,
  traceToolCallStart,
  traceToolCallEnd,
  traceModelCall,
  traceAutonomyCheck,
  traceInfo as recordTraceInfo,
  traceError as recordTraceError,
  getTraceSummary,
} from '../tracing/index.js';
import { debugLog } from '@ownpilot/core';
import { extractSuggestions, extractMemoriesFromResponse } from '../utils/index.js';
import { ConversationService, runPostChatProcessing } from '../services/conversation-service.js';
import { getLog } from '../services/log.js';

const log = getLog('ChatLegacySend');

export interface LegacySendParams {
  c: Context;
  agent: NonNullable<Awaited<ReturnType<typeof import('./agents.js').getAgent>>>;
  body: ChatRequest & { provider?: string; model?: string; workspaceId?: string };
  chatMessage: string;
  provider: string;
  model: string;
  userId: string;
  agentId: string;
  startTime: number;
  userContextWindow?: number;
}

/**
 * Execute a chat request using the legacy direct path (no MessageBus).
 */
export async function handleLegacySend(params: LegacySendParams) {
  const {
    c,
    agent,
    body,
    chatMessage,
    provider,
    model,
    userId,
    agentId,
    startTime,
    userContextWindow,
  } = params;
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const workspaceId = body.workspaceId ?? null;

  const traceCtx = createTraceContext(requestId, userId);

  const { result, traceSummary } = await withTraceContextAsync(traceCtx, async () => {
    recordTraceInfo('Chat request started', { provider, model, agentId, workspaceId });

    try {
      const { prompt: enhancedPrompt, stats } = await buildEnhancedSystemPrompt(
        agent.getConversation().systemPrompt || 'You are a helpful AI assistant.',
        {
          userId,
          agentId,
          maxMemories: 10,
          maxGoals: 5,
          enableTriggers: true,
          enableAutonomy: true,
        }
      );
      agent.updateSystemPrompt(enhancedPrompt);

      if (stats.memoriesUsed > 0 || stats.goalsUsed > 0) {
        recordTraceInfo('Context injected', {
          memoriesUsed: stats.memoriesUsed,
          goalsUsed: stats.goalsUsed,
        });
        log.info(`Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
      }
    } catch (error) {
      recordTraceError('Orchestrator failed', { error: getErrorMessage(error) });
      log.warn('Failed to build enhanced prompt:', error);
    }

    logChatEvent({
      type: 'start',
      agentId,
      sessionId: body.conversationId ?? 'new',
      provider,
      model,
      requestId,
    }).catch((e) => log.warn('Event logging failed:', e));

    if (body.directTools?.length) {
      agent.setAdditionalTools(body.directTools);
    }

    const modelCallStart = Date.now();

    const result = await agent.chat(chatMessage, {
      thinking: body.thinking,
      onBeforeToolCall: async (toolCall) => {
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs =
            typeof toolCall.arguments === 'string'
              ? (JSON.parse(toolCall.arguments) as Record<string, unknown>)
              : (toolCall.arguments as Record<string, unknown>);
        } catch {
          toolArgs = {};
        }
        const toolStart = traceToolCallStart(toolCall.name, toolArgs);

        const approval = await checkToolCallApproval(userId, toolCall, {
          agentId,
          conversationId: body.conversationId,
          provider,
          model,
        });

        traceAutonomyCheck(toolCall.name, approval.approved, approval.reason);

        if (!approval.approved) {
          traceToolCallEnd(toolCall.name, toolStart, false, undefined, approval.reason);
          log.info(
            `Tool call blocked: ${toolCall.name} - ${approval.reason ?? 'Requires approval'}`
          );
        }

        return {
          approved: approval.approved,
          reason: approval.reason,
        };
      },
    });

    if (body.directTools?.length) {
      agent.clearAdditionalTools();
    }

    agent.setExecutionPermissions(undefined);
    agent.setMaxToolCalls(undefined);

    if (result.ok) {
      traceModelCall(
        provider,
        model,
        modelCallStart,
        result.value.usage
          ? { input: result.value.usage.promptTokens, output: result.value.usage.completionTokens }
          : undefined
      );
    } else {
      traceModelCall(provider, model, modelCallStart, undefined, result.error.message);
    }

    const summary = getTraceSummary();
    return { result, traceSummary: summary };
  });

  const processingTime = performance.now() - startTime;

  if (!result.ok) {
    try {
      await usageTracker.record({
        userId,
        provider: provider as AIProvider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: Math.round(processingTime),
        requestType: 'chat',
        error: result.error.message,
      });
    } catch {
      /* Ignore tracking errors */
    }

    logChatEvent({
      type: 'error',
      agentId,
      sessionId: body.conversationId ?? 'new',
      provider,
      model,
      durationMs: Math.round(processingTime),
      error: result.error.message,
      requestId,
    }).catch((e) => log.warn('Event logging failed:', e));

    try {
      const logsRepo = new LogsRepository(userId);
      logsRepo.log({
        conversationId: body.conversationId,
        type: 'chat',
        provider,
        model,
        endpoint: 'chat/completions',
        method: 'POST',
        requestBody: { message: body.message },
        statusCode: 500,
        durationMs: Math.round(processingTime),
        error: result.error.message,
        errorStack: result.error.stack,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      });
    } catch {
      /* Ignore logging errors */
    }

    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: result.error.message }, 500);
  }

  const conversation = agent.getConversation();

  // Record successful usage
  if (result.value.usage) {
    try {
      await usageTracker.record({
        userId,
        sessionId: conversation.id,
        provider: provider as AIProvider,
        model,
        inputTokens: result.value.usage.promptTokens,
        outputTokens: result.value.usage.completionTokens,
        totalTokens: result.value.usage.totalTokens,
        latencyMs: Math.round(processingTime),
        requestType: 'chat',
      });
    } catch {
      /* Ignore tracking errors */
    }
  }

  logChatEvent({
    type: 'complete',
    agentId,
    sessionId: conversation.id,
    provider,
    model,
    inputTokens: result.value.usage?.promptTokens,
    outputTokens: result.value.usage?.completionTokens,
    durationMs: Math.round(processingTime),
    toolCallCount: result.value.toolCalls?.length ?? 0,
    requestId,
  }).catch((e) => log.warn('Event logging failed:', e));

  // Post-chat processing (async, non-blocking)
  runPostChatProcessing(userId, body.message, result.value.content, result.value.toolCalls);

  // Build trace info
  const recentDebugEntries = debugLog.getRecent(20);
  const requestEntry = recentDebugEntries.find((e) => e.type === 'request');
  const responseEntry = recentDebugEntries.find((e) => e.type === 'response');
  const retryEntries = recentDebugEntries.filter((e) => e.type === 'retry');
  const toolCallEntries = recentDebugEntries.filter(
    (e) => e.type === 'tool_call' || e.type === 'tool_result'
  );

  const enhancedToolCalls =
    traceSummary?.toolCalls.map((tc) => {
      const callEntry = toolCallEntries.find(
        (e) => e.type === 'tool_call' && (e.data as { name?: string })?.name === tc.name
      );
      const resultEntry = toolCallEntries.find(
        (e) => e.type === 'tool_result' && (e.data as { name?: string })?.name === tc.name
      );

      return {
        name: tc.name,
        success: tc.success,
        duration: tc.duration,
        error: tc.error,
        arguments: (callEntry?.data as { arguments?: Record<string, unknown> })?.arguments,
        result: (resultEntry?.data as { result?: string })?.result,
      };
    }) ?? [];

  const traceInfo = traceSummary
    ? {
        duration: traceSummary.totalDuration,
        toolCalls: enhancedToolCalls,
        modelCalls: traceSummary.modelCalls.map((mc) => {
          const respData = responseEntry?.data as
            | { usage?: { promptTokens?: number; completionTokens?: number } }
            | undefined;
          return {
            provider: mc.provider,
            model: mc.model,
            tokens: mc.tokens,
            inputTokens: respData?.usage?.promptTokens,
            outputTokens: respData?.usage?.completionTokens,
            duration: mc.duration,
          };
        }),
        autonomyChecks: traceSummary.autonomyChecks,
        dbOperations: {
          reads: traceSummary.dbOperations.filter((o) => o.type === 'read').length,
          writes: traceSummary.dbOperations.filter((o) => o.type === 'write').length,
        },
        memoryOps: {
          adds: traceSummary.memoryOps.filter((o) => o.type === 'add').length,
          recalls: traceSummary.memoryOps.filter((o) => o.type === 'recall').length,
        },
        triggersFired: traceSummary.triggersFired,
        errors: traceSummary.errors,
        events: traceSummary.events.map((e) => ({
          type: e.type,
          name: e.name,
          duration: e.duration,
          success: e.success,
        })),
        request: requestEntry
          ? {
              provider: (requestEntry.data as { provider?: string })?.provider ?? provider,
              model: (requestEntry.data as { model?: string })?.model ?? model,
              endpoint: (requestEntry.data as { endpoint?: string })?.endpoint ?? 'unknown',
              messageCount:
                (requestEntry.data as { messages?: unknown[] })?.messages?.length ?? 1,
              tools: (requestEntry.data as { tools?: string[] })?.tools,
            }
          : {
              provider,
              model,
              endpoint: 'chat/completions',
              messageCount: 1,
            },
        response: responseEntry
          ? {
              status:
                (responseEntry.data as { status?: 'success' | 'error' })?.status ?? 'success',
              contentLength: (responseEntry.data as { contentLength?: number })?.contentLength,
              finishReason: (responseEntry.data as { finishReason?: string })?.finishReason,
            }
          : {
              status: 'success' as const,
              finishReason: result.value.finishReason,
            },
        retries: retryEntries.map((e) => ({
          attempt: (e.data as { attempt?: number })?.attempt ?? 0,
          error: (e.data as { error?: string })?.error ?? 'unknown',
          delayMs: (e.data as { delayMs?: number })?.delayMs ?? 0,
        })),
      }
    : undefined;

  const { content: legacyMemStripped, memories: legacyMemories } = extractMemoriesFromResponse(
    result.value.content
  );
  const { content: legacyCleanContent, suggestions: legacySuggestions } =
    extractSuggestions(legacyMemStripped);

  const response = {
    success: true,
    data: {
      id: result.value.id,
      conversationId: conversation.id,
      message: legacyCleanContent,
      response: legacyCleanContent,
      model,
      toolCalls: result.value.toolCalls?.map((tc) => {
        let args: unknown;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }
        return { id: tc.id, name: tc.name, arguments: args };
      }),
      usage: result.value.usage
        ? {
            promptTokens: result.value.usage.promptTokens,
            completionTokens: result.value.usage.completionTokens,
            totalTokens: result.value.usage.totalTokens,
          }
        : undefined,
      finishReason: result.value.finishReason,
      session: getSessionInfo(agent, provider, model, userContextWindow),
      suggestions: legacySuggestions.length > 0 ? legacySuggestions : undefined,
      memories: legacyMemories.length > 0 ? legacyMemories : undefined,
      trace: traceInfo,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
      processingTime: Math.round(processingTime),
    },
  };

  // Save chat history to database
  await new ConversationService(userId).saveChat({
    conversationId: body.conversationId || conversation.id,
    agentId: body.agentId,
    provider,
    model,
    userMessage: body.message,
    assistantContent: legacyCleanContent,
    toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
    trace: traceInfo as Record<string, unknown>,
    usage: result.value.usage
      ? {
          promptTokens: result.value.usage.promptTokens,
          completionTokens: result.value.usage.completionTokens,
          totalTokens: result.value.usage.totalTokens,
        }
      : undefined,
    historyLength: body.historyLength,
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(response);
}

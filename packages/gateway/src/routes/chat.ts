/**
 * Chat routes
 *
 * Implementation split:
 * - chat-state.ts:       Shared module-level state (breaks circular dep)
 * - chat-streaming.ts:   SSE streaming types, callbacks, processing
 * - chat-prompt.ts:      System prompt init, execution context, demo mode
 * - chat-persistence.ts: DB save, logging, post-chat processing
 * - chat.ts:             Route handlers (this file) + backward compat re-exports
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatRequest } from '../types/index.js';
import { apiResponse, apiError, ERROR_CODES, getUserId, notFoundError, getErrorMessage } from './helpers.js';
import { getAgent, getOrCreateDefaultAgent, getOrCreateChatAgent, isDemoMode, getDefaultModel, getWorkspaceContext, getSessionInfo } from './agents.js';
import { usageTracker } from './costs.js';
import { logChatEvent } from '../audit/index.js';
import { ChatRepository, LogsRepository } from '../db/repositories/index.js';
import { modelConfigsRepo } from '../db/repositories/model-configs.js';
import type { AIProvider } from '@ownpilot/core';
import {
  buildEnhancedSystemPrompt,
  checkToolCallApproval,
} from '../assistant/index.js';
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
import { debugLog, DEFAULT_EXECUTION_PERMISSIONS, type ExecutionPermissions } from '@ownpilot/core';
import type { NormalizedMessage, MessageProcessingResult } from '@ownpilot/core';
import { getOrCreateSessionWorkspace } from '../workspace/file-workspace.js';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { extractSuggestions, extractMemoriesFromResponse } from '../utils/index.js';
import { getLog } from '../services/log.js';

// Import from split modules
import {
  promptInitializedConversations,
  lastExecPermHash,
  execPermHash,
  boundedSetAdd,
  boundedMapSet,
} from './chat-state.js';
import {
  createStreamCallbacks,
  recordStreamUsage,
  processStreamingViaBus,
  wireStreamApproval,
} from './chat-streaming.js';
import {
  buildExecutionSystemPrompt,
  buildToolCatalog,
  generateDemoResponse,
  tryGetMessageBus,
} from './chat-prompt.js';
import {
  saveChatToDatabase,
  saveStreamingChat,
  runPostChatProcessing,
} from './chat-persistence.js';

const log = getLog('Chat');

// =============================================================================
// Backward compatibility re-export
// =============================================================================
// chat-history.ts imports promptInitializedConversations from './chat.js'
export { promptInitializedConversations } from './chat-state.js';

// =============================================================================
// Routes
// =============================================================================

export const chatRoutes = new Hono();

// Mount history, logs, and context reset sub-routes (extracted for maintainability)
import { chatHistoryRoutes } from './chat-history.js';
chatRoutes.route('/', chatHistoryRoutes);

/**
 * Process a non-streaming chat message through the MessageBus pipeline.
 */
async function processNonStreamingViaBus(
  bus: NonNullable<ReturnType<typeof tryGetMessageBus>>,
  params: {
    agent: NonNullable<Awaited<ReturnType<typeof getAgent>>>;
    chatMessage: string;
    body: ChatRequest & { provider?: string; model?: string; workspaceId?: string };
    provider: string;
    model: string;
    userId: string;
    agentId: string;
    requestId: string;
    conversationId?: string;
  },
): Promise<MessageProcessingResult> {
  const { agent, chatMessage, body, provider, model, userId, agentId, requestId, conversationId } = params;

  const message: NormalizedMessage = {
    id: crypto.randomUUID(),
    sessionId: conversationId ?? agent.getConversation().id,
    role: 'user',
    content: chatMessage,
    ...(body.attachments?.length && {
      attachments: body.attachments.map((a: { type: string; data: string; mimeType: string; filename?: string }) => ({
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
      conversationId: conversationId ?? agent.getConversation().id,
      agentId,
    },
    timestamp: new Date(),
  };

  return bus.process(message, {
    context: {
      agent,
      userId,
      agentId,
      provider,
      model,
      conversationId: conversationId ?? agent.getConversation().id,
      requestId,
      directTools: body.directTools,
    },
  });
}

/**
 * Send a chat message
 */
chatRoutes.post('/', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, chatMessageSchema } = await import('../middleware/validation.js');
  const body = validateBody(chatMessageSchema, rawBody) as ChatRequest & { provider?: string; model?: string; workspaceId?: string };

  // Get provider and model from request
  const provider = body.provider ?? 'openai';
  const requestedModel = body.model ?? await getDefaultModel(provider);
  const model = requestedModel ?? 'gpt-4o';

  // Check for demo mode
  if (await isDemoMode()) {
    const demoResponse = generateDemoResponse(body.message, provider, model);

    return apiResponse(c, {
      id: crypto.randomUUID(),
      conversationId: 'demo',
      message: demoResponse,
      response: demoResponse,
      model,
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      processingTime: 0,
    });
  }

  // Validate model is available for non-demo mode
  if (!requestedModel) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `No model available for provider: ${provider}. Configure a default model in Settings.` }, 400);
  }

  // Look up user-configured context window from AI Models settings
  let userContextWindow: number | undefined;
  try {
    const userConfig = await modelConfigsRepo.getModel(getUserId(c), provider, model);
    userContextWindow = userConfig?.contextWindow ?? undefined;
  } catch {
    // Fall back to pricing defaults if DB lookup fails
  }

  // Get agent based on agentId or provider/model from request
  let agent: Awaited<ReturnType<typeof getAgent>>;

  if (body.agentId) {
    agent = await getAgent(body.agentId);
    if (!agent) {
      return notFoundError(c, 'Agent', body.agentId);
    }
  } else {
    try {
      agent = await getOrCreateChatAgent(provider, model);
    } catch (error) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: getErrorMessage(error, 'Failed to create agent') }, 400);
    }
  }

  // Load conversation if specified
  if (body.conversationId) {
    const loaded = agent.loadConversation(body.conversationId);
    if (!loaded) {
      return notFoundError(c, 'Conversation', body.conversationId);
    }
  }

  // ── System prompt initialization ──────────────────────────────────────────
  const conversationId = agent.getConversation().id;
  const isPromptInitialized = promptInitializedConversations.has(conversationId);
  const chatUserId = getUserId(c);

  // Workspace — set on every request (cheap), but prompt section only on first
  const sessionId = body.workspaceId || body.conversationId || conversationId;
  let _sessionWorkspacePath: string | undefined;
  try {
    const sessionWorkspace = getOrCreateSessionWorkspace(sessionId, body.agentId);
    _sessionWorkspacePath = sessionWorkspace.path;
    agent.setWorkspaceDir(sessionWorkspace.path);

    if (!isPromptInitialized) {
      const currentPrompt = agent.getConversation().systemPrompt || '';
      const wsContext = getWorkspaceContext(sessionWorkspace.path);
      const workspaceInfo = `\n\n## File Operations\nWorkspace: \`${wsContext.workspaceDir}\`. Use relative paths for new files.`;
      if (!currentPrompt.includes(workspaceInfo)) {
        const promptWithoutOldWs = currentPrompt.replace(/\n\n## File Operations[\s\S]*?(?=\n\n## [^#]|$)/g, '');
        agent.updateSystemPrompt(promptWithoutOldWs + workspaceInfo);
      }
    }
  } catch (err) {
    log.warn(`Failed to create session workspace:`, err);
  }

  // Execution permissions — DB query only on first message or when hash differs
  let execPermissions: ExecutionPermissions;
  try {
    execPermissions = await executionPermissionsRepo.get(chatUserId);
  } catch (err) {
    log.warn('[ExecSecurity] Failed to load permissions, using all-blocked defaults:', err);
    execPermissions = { ...DEFAULT_EXECUTION_PERMISSIONS };
  }
  agent.setExecutionPermissions(execPermissions);

  // Apply per-request tool call limit (0 = unlimited)
  if (body.maxToolCalls !== undefined) {
    agent.setMaxToolCalls(body.maxToolCalls);
  }

  const currentHash = execPermHash(execPermissions);
  const previousHash = lastExecPermHash.get(chatUserId);
  if (!isPromptInitialized || currentHash !== previousHash) {
    boundedMapSet(lastExecPermHash, chatUserId, currentHash, 200);
    const execSection = buildExecutionSystemPrompt(execPermissions);
    const currentPrompt = agent.getConversation().systemPrompt || '';
    if (!currentPrompt.includes(execSection)) {
      const promptWithoutExec = currentPrompt.replace(/\n\n## Code Execution[\s\S]*?(?=\n\n## [^#]|$)/g, '');
      agent.updateSystemPrompt(promptWithoutExec + execSection);
      log.info(`[ExecSecurity] Updated execution context (enabled=${execPermissions.enabled})`);
    }
  }

  // Tool catalog — system prompt, first message only
  const chatMessage = body.message;
  if (body.includeToolList && !isPromptInitialized) {
    try {
      const allToolDefs = agent.getAllToolDefinitions();
      const catalog = await buildToolCatalog(allToolDefs);
      if (catalog) {
        const currentPrompt = agent.getConversation().systemPrompt || '';
        if (!currentPrompt.includes('## Active Custom Tools') && !currentPrompt.includes('## Custom Data Tables')) {
          agent.updateSystemPrompt(currentPrompt + catalog);
          log.info('Tool catalog injected into system prompt');
        }
      }
    } catch (err) {
      log.warn('Failed to build tool catalog:', err);
    }
  }

  // Mark prompt as initialized for this conversation
  if (!isPromptInitialized) {
    boundedSetAdd(promptInitializedConversations, conversationId, 1000);
  }

  // Handle streaming
  if (body.stream) {
    // ── MessageBus Streaming Path ──────────────────────────────────────────
    const streamBus = tryGetMessageBus();
    if (streamBus) {
      return streamSSE(c, async (stream) => {
        const conversationId = agent.getConversation().id;
        const streamAgentId = body.agentId ?? `chat-${provider}`;
        const streamUserId = getUserId(c);

        wireStreamApproval(agent, stream);
        log.info(`[ExecSecurity] SSE requestApproval callback wired on agent (MessageBus path)`);

        try {
          await processStreamingViaBus(streamBus, stream, {
            agent: agent!,
            chatMessage,
            body,
            provider,
            model,
            userId: streamUserId,
            agentId: streamAgentId,
            conversationId,
            contextWindowOverride: userContextWindow,
          });
        } finally {
          agent.setRequestApproval(undefined);
          agent.setExecutionPermissions(undefined);
          agent.setMaxToolCalls(undefined);
        }
      });
    }

    // ── Legacy Streaming Path (fallback) ──────────────────────────────────
    return streamSSE(c, async (stream) => {
      const conversationId = agent.getConversation().id;
      const streamAgentId = body.agentId ?? `chat-${provider}`;
      const streamUserId = getUserId(c);

      const { callbacks, state } = createStreamCallbacks({
        sseStream: stream,
        agent,
        conversationId,
        userId: streamUserId,
        agentId: streamAgentId,
        provider,
        model,
        historyLength: body.historyLength ?? 0,
        contextWindowOverride: userContextWindow,
      });

      wireStreamApproval(agent, stream);

      // Expose direct tools to LLM if requested (from picker selection)
      if (body.directTools?.length) {
        agent.setAdditionalTools(body.directTools);
      }

      try {
        const result = await agent.chat(chatMessage, {
          stream: true,
          onBeforeToolCall: callbacks.onBeforeToolCall,
          onChunk: callbacks.onChunk,
          onToolStart: callbacks.onToolStart,
          onToolEnd: callbacks.onToolEnd,
          onProgress: callbacks.onProgress,
        });

        if (!result.ok) {
          await stream.writeSSE({
            data: JSON.stringify({ error: result.error.message }),
            event: 'error',
          });
          await recordStreamUsage(state, {
            userId: streamUserId,
            conversationId,
            provider,
            model,
            error: result.error.message,
          });
        } else {
          await recordStreamUsage(state, {
            userId: streamUserId,
            conversationId,
            provider,
            model,
          });

          // Save streaming chat to database
          await saveStreamingChat(state, {
            userId: streamUserId,
            conversationId: body.conversationId || conversationId,
            agentId: body.agentId,
            provider,
            model,
            userMessage: body.message,
            assistantContent: result.value.content,
            toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
            finishReason: result.value.finishReason,
            historyLength: body.historyLength,
            ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
            userAgent: c.req.header('user-agent'),
          });
        }
      } finally {
        // Always clean up per-request overrides, even on error
        if (body.directTools?.length) {
          agent.clearAdditionalTools();
        }
        agent.setRequestApproval(undefined);
        agent.setExecutionPermissions(undefined);
        agent.setMaxToolCalls(undefined);
      }
    });
  }

  // Non-streaming response
  const startTime = performance.now();
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const agentId = body.agentId ?? `chat-${provider}`;
  const userId = getUserId(c);
  const workspaceId = body.workspaceId ?? null;

  // ── MessageBus Pipeline Path ──────────────────────────────────────────────
  const bus = tryGetMessageBus();
  if (bus) {
    let busResult;
    try {
      busResult = await processNonStreamingViaBus(bus, {
        agent,
        chatMessage,
        body,
        provider,
        model,
        userId,
        agentId,
        requestId,
        conversationId: body.conversationId ?? agent.getConversation().id,
      });
    } catch (busError) {
      agent.setExecutionPermissions(undefined);
      agent.setRequestApproval(undefined);
      agent.setMaxToolCalls(undefined);
      return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(busError, 'MessageBus processing failed') }, 500);
    }

    // Reset per-request overrides
    agent.setExecutionPermissions(undefined);
    agent.setRequestApproval(undefined);
    agent.setMaxToolCalls(undefined);

    const processingTime = Math.round(performance.now() - startTime);

    if (busResult.response.metadata.error) {
      return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: busResult.response.metadata.error as string }, 500);
    }

    const conversation = agent.getConversation();
    const busUsage = busResult.response.metadata.tokens as { input: number; output: number } | undefined;
    const { content: busMemStripped, memories: busMemories } = extractMemoriesFromResponse(busResult.response.content);
    const { content: busCleanContent, suggestions: busSuggestions } = extractSuggestions(busMemStripped);

    const busToolCalls = busResult.response.metadata.toolCalls as unknown[] | undefined;
    const busTrace = {
      duration: processingTime,
      toolCalls: [],
      modelCalls: [{ provider, model, duration: processingTime }],
      autonomyChecks: [],
      dbOperations: { reads: 0, writes: 0 },
      memoryOps: { adds: 0, recalls: 0 },
      triggersFired: [],
      errors: busResult.warnings ?? [],
      events: busResult.stages.map(s => ({ type: 'stage', name: s })),
    };

    // Persistence middleware saves to ChatRepository but NOT LogsRepository.
    // Save logs here to match what the legacy path does.
    saveChatToDatabase({
      userId,
      conversationId: body.conversationId || conversation.id,
      agentId: body.agentId,
      provider,
      model,
      userMessage: body.message,
      assistantContent: busCleanContent,
      toolCalls: busToolCalls,
      trace: busTrace as Record<string, unknown>,
      usage: busUsage ? {
        promptTokens: busUsage.input,
        completionTokens: busUsage.output,
        totalTokens: busUsage.input + busUsage.output,
      } : undefined,
      historyLength: body.historyLength,
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    }).catch((err) => { log.warn('Failed to save chat history (MessageBus path):', err); });

    // Post-processing middleware skips web UI memory extraction — run it here.
    runPostChatProcessing(userId, body.message, busCleanContent, busToolCalls as never);

    return c.json({
      success: true,
      data: {
        id: busResult.response.id,
        conversationId: conversation.id,
        message: busCleanContent,
        response: busCleanContent,
        model,
        toolCalls: (busToolCalls as Array<{ id: string; name: string; arguments: Record<string, unknown> }>) ?? undefined,
        usage: busUsage
          ? {
              promptTokens: busUsage.input,
              completionTokens: busUsage.output,
              totalTokens: busUsage.input + busUsage.output,
            }
          : undefined,
        finishReason: 'stop',
        session: getSessionInfo(agent, provider, model, userContextWindow),
        suggestions: busSuggestions.length > 0 ? busSuggestions : undefined,
        memories: busMemories.length > 0 ? busMemories : undefined,
        trace: busTrace,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTime,
      },
    });
  }

  // ── Legacy Direct Path (fallback) ─────────────────────────────────────────
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
      onBeforeToolCall: async (toolCall) => {
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = typeof toolCall.arguments === 'string'
            ? JSON.parse(toolCall.arguments) as Record<string, unknown>
            : toolCall.arguments as Record<string, unknown>;
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
    } catch { /* Ignore tracking errors */ }

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
    } catch { /* Ignore logging errors */ }

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
    } catch { /* Ignore tracking errors */ }
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
  const requestEntry = recentDebugEntries.find(e => e.type === 'request');
  const responseEntry = recentDebugEntries.find(e => e.type === 'response');
  const retryEntries = recentDebugEntries.filter(e => e.type === 'retry');
  const toolCallEntries = recentDebugEntries.filter(e => e.type === 'tool_call' || e.type === 'tool_result');

  const enhancedToolCalls = traceSummary?.toolCalls.map((tc) => {
    const callEntry = toolCallEntries.find(
      e => e.type === 'tool_call' && (e.data as { name?: string })?.name === tc.name
    );
    const resultEntry = toolCallEntries.find(
      e => e.type === 'tool_result' && (e.data as { name?: string })?.name === tc.name
    );

    return {
      name: tc.name,
      success: tc.success,
      duration: tc.duration,
      error: tc.error,
      arguments: (callEntry?.data as { arguments?: Record<string, unknown> })?.arguments,
      result: (resultEntry?.data as { resultPreview?: string })?.resultPreview,
    };
  }) ?? [];

  const traceInfo = traceSummary
    ? {
        duration: traceSummary.totalDuration,
        toolCalls: enhancedToolCalls,
        modelCalls: traceSummary.modelCalls.map((mc) => {
          const respData = responseEntry?.data as { usage?: { promptTokens?: number; completionTokens?: number } } | undefined;
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
        request: requestEntry ? {
          provider: (requestEntry.data as { provider?: string })?.provider ?? provider,
          model: (requestEntry.data as { model?: string })?.model ?? model,
          endpoint: (requestEntry.data as { endpoint?: string })?.endpoint ?? 'unknown',
          messageCount: (requestEntry.data as { messages?: unknown[] })?.messages?.length ?? 1,
          tools: (requestEntry.data as { tools?: string[] })?.tools,
        } : {
          provider,
          model,
          endpoint: 'chat/completions',
          messageCount: 1,
        },
        response: responseEntry ? {
          status: (responseEntry.data as { status?: 'success' | 'error' })?.status ?? 'success',
          contentLength: (responseEntry.data as { contentLength?: number })?.contentLength,
          finishReason: (responseEntry.data as { finishReason?: string })?.finishReason,
        } : {
          status: 'success' as const,
          finishReason: result.value.finishReason,
        },
        retries: retryEntries.map(e => ({
          attempt: (e.data as { attempt?: number })?.attempt ?? 0,
          error: (e.data as { error?: string })?.error ?? 'unknown',
          delayMs: (e.data as { delayMs?: number })?.delayMs ?? 0,
        })),
      }
    : undefined;

  const { content: legacyMemStripped, memories: legacyMemories } = extractMemoriesFromResponse(result.value.content);
  const { content: legacyCleanContent, suggestions: legacySuggestions } = extractSuggestions(legacyMemStripped);

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
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }
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
  await saveChatToDatabase({
    userId,
    conversationId: body.conversationId || conversation.id,
    agentId: body.agentId,
    provider,
    model,
    userMessage: body.message,
    assistantContent: legacyCleanContent,
    toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
    trace: traceInfo as Record<string, unknown>,
    usage: result.value.usage ? {
      promptTokens: result.value.usage.promptTokens,
      completionTokens: result.value.usage.completionTokens,
      totalTokens: result.value.usage.totalTokens,
    } : undefined,
    historyLength: body.historyLength,
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(response);
});

/**
 * Get conversation history
 */
chatRoutes.get('/conversations/:id', async (c) => {
  const id = c.req.param('id');
  const agentId = c.req.query('agentId');

  if (await isDemoMode()) {
    return apiResponse(c, {
      id,
      systemPrompt: 'You are a helpful AI assistant.',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const agent = agentId ? await getAgent(agentId) : await getOrCreateDefaultAgent();

  if (!agent) {
    return notFoundError(c, 'Agent', agentId!);
  }

  const memory = agent.getMemory();
  const conversation = memory.get(id);

  if (!conversation) {
    return notFoundError(c, 'Conversation', id);
  }

  return apiResponse(c, {
    id: conversation.id,
    systemPrompt: conversation.systemPrompt,
    messages: conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults,
    })),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  });
});

/**
 * Delete conversation
 */
chatRoutes.delete('/conversations/:id', async (c) => {
  const id = c.req.param('id');
  const agentId = c.req.query('agentId');

  if (await isDemoMode()) {
    return apiResponse(c, {});
  }

  const agent = agentId ? await getAgent(agentId) : await getOrCreateDefaultAgent();

  if (!agent) {
    return notFoundError(c, 'Agent', agentId!);
  }

  const memory = agent.getMemory();
  const deleted = memory.delete(id);

  if (!deleted) {
    return notFoundError(c, 'Conversation', id);
  }

  // Delete from database only after confirming it exists in memory
  const chatRepo = new ChatRepository(getUserId(c));
  await chatRepo.deleteConversation(id);

  return apiResponse(c, {});
});

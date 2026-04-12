/**
 * Chat routes
 *
 * Implementation split:
 * - chat-state.ts:       Shared module-level state (breaks circular dep)
 * - chat-streaming.ts:   SSE streaming types, callbacks, processing
 * - chat-prompt.ts:      System prompt init, execution context, demo mode
 * - chat-persistence.ts: DB save, logging, post-chat processing
 * - chat-fetch-url.ts:   URL content extraction endpoint
 * - chat-legacy-send.ts: Legacy direct path (non-MessageBus fallback)
 * - chat.ts:             Route handlers (this file) + backward compat re-exports
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatRequest } from '../types/index.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getUserId,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
  truncate,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import {
  getAgent,
  getOrCreateDefaultAgent,
  getOrCreateChatAgent,
  isDemoMode,
  getDefaultModel,
  getWorkspaceContext,
  getSessionInfo,
  getCliCorrelationId,
} from './agents.js';
import { onMcpToolEvents } from '../mcp/mcp-events.js';
import { resolveForProcess } from '../services/model-routing.js';
import { ChatRepository } from '../db/repositories/index.js';
import { modelConfigsRepo } from '../db/repositories/model-configs.js';
import type { NormalizedMessage, MessageProcessingResult } from '@ownpilot/core';
import { DEFAULT_EXECUTION_PERMISSIONS, type ExecutionPermissions } from '@ownpilot/core';
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
import { ConversationService, runPostChatProcessing } from '../services/conversation-service.js';
import { handleLegacySend } from './chat-legacy-send.js';
import type { McpToolEvent } from '../mcp/mcp-events.js';

const log = getLog('Chat');

function toMcpTraceEvent(event: McpToolEvent): {
  type: McpToolEvent['type'];
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: McpToolEvent['result'];
  timestamp: string;
} {
  return {
    type: event.type,
    toolName: event.toolName,
    arguments: event.arguments,
    result: event.result,
    timestamp: event.timestamp,
  };
}

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

// Mount fetch-url sub-route
import { chatFetchUrlRoutes } from './chat-fetch-url.js';
chatRoutes.route('/', chatFetchUrlRoutes);

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
  }
): Promise<MessageProcessingResult> {
  const { agent, chatMessage, body, provider, model, userId, agentId, requestId, conversationId } =
    params;

  const message: NormalizedMessage = {
    id: crypto.randomUUID(),
    sessionId: conversationId ?? agent.getConversation().id,
    role: 'user',
    content: chatMessage,
    ...(body.attachments?.length && {
      attachments: body.attachments.map(
        (a: { type: string; data: string; mimeType: string; filename?: string }) => ({
          type: a.type as 'image' | 'file',
          data: a.data,
          mimeType: a.mimeType,
          filename: a.filename,
        })
      ),
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
      thinking: body.thinking,
      pageContext: body.pageContext,
    },
  });
}

/**
 * Send a chat message
 */
chatRoutes.post('/', async (c) => {
  const rawBody = await parseJsonBody(c);
  const { validateBody, chatMessageSchema } = await import('../middleware/validation.js');
  const body = validateBody(chatMessageSchema, rawBody) as ChatRequest & {
    provider?: string;
    model?: string;
    workspaceId?: string;
  };

  // Resolve provider and model: explicit request body > per-process routing > global default
  let provider: string;
  let model: string;
  let requestedModel: string | null;
  let routingFallback: { provider: string; model: string } | undefined;

  if (body.provider || body.model) {
    // User explicitly selected provider/model — honor it directly
    provider = body.provider ?? 'openai';
    requestedModel = body.model ?? (await getDefaultModel(provider));
    model = requestedModel ?? 'gpt-4o';
  } else {
    // Use per-process model routing with waterfall to global default
    const resolved = await resolveForProcess('chat');
    provider = resolved.provider ?? 'openai';
    requestedModel = resolved.model;
    model = requestedModel ?? 'gpt-4o';
    if (resolved.fallbackProvider && resolved.fallbackModel) {
      routingFallback = { provider: resolved.fallbackProvider, model: resolved.fallbackModel };
    }
  }

  // CLI providers always use their own default model — ignore any model from the UI.
  // Set requestedModel to a sentinel so validation passes, but leave model empty
  // so the CliChatProvider falls through to its own default (from config.toml / login).
  if (provider.startsWith('cli-')) {
    model = '';
    requestedModel = 'cli-default';
  }

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
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `No model available for provider: ${provider}. Configure a default model in Settings.`,
      },
      400
    );
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
      agent = await getOrCreateChatAgent(provider, model, routingFallback, undefined, body.conversationId);
    } catch (error) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_REQUEST,
          message: getErrorMessage(error, 'Failed to create agent'),
        },
        400
      );
    }
  }

  // Load conversation if specified
  console.log(`[SESSION-FIX] body.conversationId=${body.conversationId ?? 'NONE'}, agent.conv=${agent.getConversation().id.slice(0,8)}`);
  if (body.conversationId) {
    let loaded = agent.loadConversation(body.conversationId);
    console.log(`[SESSION-FIX] loadConversation(${body.conversationId.slice(0,8)}) = ${loaded}`);

    // DB fallback: if conversation exists in DB but not in agent memory
    // (agent was reset/evicted), reconstruct it from database messages.
    // Pattern reference: LibreChat BaseClient.loadHistory() + Chatwoot session_registry
    if (!loaded) {
      const chatRepo = new ChatRepository(getUserId(c));
      const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
      if (dbData) {
        // Create conversation in agent memory with the ORIGINAL DB ID
        agent.getMemory().createWithId(
          dbData.conversation.id,
          dbData.conversation.systemPrompt ?? undefined,
          { restoredFromDb: true, restoredAt: new Date().toISOString() }
        );
        // Replay messages from DB into agent memory
        for (const msg of dbData.messages) {
          if (msg.role === 'user') {
            agent.getMemory().addUserMessage(dbData.conversation.id, msg.content);
          } else if (msg.role === 'assistant') {
            agent.getMemory().addAssistantMessage(dbData.conversation.id, msg.content);
          }
        }
        // Now loadConversation should find it in memory
        loaded = agent.loadConversation(body.conversationId);
      }
      if (!loaded) {
        // Accept client-generated conversation IDs (multi-session pattern).
        // The client pre-generates a UUID at createSession() time and sends it
        // with the first message. This follows the industry-standard pattern
        // used by NextChat, LobeChat, big-AGI, and Vercel AI SDK.
        const source = body.conversationId.startsWith('sidebar-')
          ? 'sidebar-chat'
          : 'client-generated';
        agent.getMemory().createWithId(
          body.conversationId,
          undefined,
          { source, createdAt: new Date().toISOString() }
        );
        loaded = agent.loadConversation(body.conversationId);
        if (!loaded) {
          return notFoundError(c, 'Conversation', body.conversationId);
        }
      }
    }
  }

  // ── System prompt initialization ──────────────────────────────────────────
  const conversationId = agent.getConversation().id;
  const isPromptInitialized = promptInitializedConversations.has(conversationId);
  const chatUserId = getUserId(c);

  // Workspace — set on every request (cheap), but prompt section only on first
  const sessionId = body.workspaceId || body.conversationId || conversationId;
  try {
    const sessionWorkspace = getOrCreateSessionWorkspace(sessionId, body.agentId);
    agent.setWorkspaceDir(sessionWorkspace.path);

    if (!isPromptInitialized) {
      const currentPrompt = agent.getConversation().systemPrompt || '';
      const wsContext = getWorkspaceContext(sessionWorkspace.path);
      const workspaceInfo = `\n\n## File Operations\nWorkspace: \`${wsContext.workspaceDir}\`. Use relative paths for new files.`;
      if (!currentPrompt.includes(workspaceInfo)) {
        const promptWithoutOldWs = currentPrompt.replace(
          /\n\n## File Operations[\s\S]*?(?=\n\n## [^#]|$)/g,
          ''
        );
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
      const promptWithoutExec = currentPrompt.replace(
        /\n\n## Code Execution[\s\S]*?(?=\n\n## [^#]|$)/g,
        ''
      );
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
        if (
          !currentPrompt.includes('## Active Custom Tools') &&
          !currentPrompt.includes('## Custom Data Tables')
        ) {
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

  // ── Early persistence: create conversation in DB NOW so it appears in sidebar
  // recents IMMEDIATELY (before AI responds). Without this, users who click
  // "New Chat" before the response arrives lose the conversation from recents
  // because the optimistic React entry is cleared and DB save hasn't happened.
  // The later full save (saveStreamingChat/persistence middleware) is idempotent
  // via getOrCreateConversation — it will find this row and add messages to it.
  try {
    const chatRepo = new ChatRepository(chatUserId);
    const earlyConvId = body.conversationId || conversationId;
    const earlyConv = await chatRepo.getOrCreateConversation(
      earlyConvId,
      {
        title: truncate(chatMessage),
        agentId: body.agentId,
        agentName: body.agentId ? undefined : 'Chat',
        provider,
        model,
      }
    );
    // Persist user message NOW so it survives even if AI stream fails/aborts.
    // The later saveStreamingChat is idempotent — it won't duplicate this message.
    await chatRepo.addMessage({
      conversationId: earlyConv.id,
      role: 'user',
      content: chatMessage,
    });
    wsGateway.broadcast('chat:history:updated', {
      conversationId: earlyConv.id,
      title: earlyConv.title,
      source: 'web',
      messageCount: 1,
    });
  } catch (err) {
    log.warn('Early conversation persist failed (non-fatal):', err);
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

        // ── MCP tool event forwarding for CLI providers ──
        let unsubMcp: (() => void) | undefined;
        const cliCorrelationId = getCliCorrelationId(agent);
        if (cliCorrelationId) {
          unsubMcp = onMcpToolEvents(cliCorrelationId, (event) => {
            stream.writeSSE({
              data: JSON.stringify({
                type: event.type,
                tool: {
                  id: `mcp-${event.toolName}-${Date.now()}`,
                  name: event.toolName,
                  ...(event.arguments && { arguments: event.arguments }),
                },
                ...(event.result && { result: event.result }),
                timestamp: event.timestamp,
              }),
              event: 'progress',
            });
          });
        }

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
          unsubMcp?.();
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

      // ── MCP tool event forwarding for CLI providers ──
      // Subscribe to real-time tool call events from MCP server and forward as SSE progress events.
      let unsubMcp: (() => void) | undefined;
      const cliCorrelationId = getCliCorrelationId(agent);
      if (cliCorrelationId) {
        unsubMcp = onMcpToolEvents(cliCorrelationId, (event) => {
          state.mcpToolEvents.push(toMcpTraceEvent(event));
          stream.writeSSE({
            data: JSON.stringify({
              type: event.type,
              tool: {
                id: `mcp-${event.toolName}-${Date.now()}`,
                name: event.toolName,
                ...(event.arguments && { arguments: event.arguments }),
              },
              ...(event.result && { result: event.result }),
              timestamp: event.timestamp,
            }),
            event: 'progress',
          });
        });
      }

      // Expose direct tools to LLM if requested (from picker selection)
      if (body.directTools?.length) {
        agent.setAdditionalTools(body.directTools);
      }

      try {
        const result = await agent.chat(chatMessage, {
          stream: true,
          thinking: body.thinking,
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
          await new ConversationService(streamUserId).saveStreamingChat(state, {
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
        // Clean up MCP event subscription
        unsubMcp?.();
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

  // ── MessageBus Pipeline Path ──────────────────────────────────────────────
  const bus = tryGetMessageBus();
  if (bus) {
    let busResult;
    const mcpToolEvents: Array<ReturnType<typeof toMcpTraceEvent>> = [];
    let unsubMcp: (() => void) | undefined;
    try {
      const cliCorrelationId = getCliCorrelationId(agent);
      if (cliCorrelationId) {
        unsubMcp = onMcpToolEvents(cliCorrelationId, (event) => {
          mcpToolEvents.push(toMcpTraceEvent(event));
        });
      }
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
      unsubMcp?.();
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: getErrorMessage(busError, 'MessageBus processing failed'),
        },
        500
      );
    }

    // Reset per-request overrides
    agent.setExecutionPermissions(undefined);
    agent.setRequestApproval(undefined);
    agent.setMaxToolCalls(undefined);
    unsubMcp?.();

    const processingTime = Math.round(performance.now() - startTime);

    if (busResult.response.metadata.error) {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: busResult.response.metadata.error as string },
        500
      );
    }

    const conversation = agent.getConversation();
    const busUsage = busResult.response.metadata.tokens as
      | { input: number; output: number }
      | undefined;
    const { content: busMemStripped, memories: busMemories } = extractMemoriesFromResponse(
      busResult.response.content
    );
    const { content: busCleanContent, suggestions: busSuggestions } =
      extractSuggestions(busMemStripped);

    const busToolCalls = busResult.response.metadata.toolCalls as unknown[] | undefined;
    const busTrace = {
      duration: processingTime,
      toolCalls: [],
      mcpToolEvents,
      modelCalls: [{ provider, model, duration: processingTime }],
      autonomyChecks: [],
      dbOperations: { reads: 0, writes: 0 },
      memoryOps: { adds: 0, recalls: 0 },
      triggersFired: [],
      errors: busResult.warnings ?? [],
      events: [
        ...busResult.stages.map((s) => ({ type: 'stage', name: s })),
        ...mcpToolEvents.map((event) => ({
          type: event.type,
          name: event.toolName,
          arguments: event.arguments,
          result: event.result,
          timestamp: event.timestamp,
        })),
      ],
      routing: busResult.response.metadata.routing ?? undefined,
    };

    // Persistence middleware saves to ChatRepository but NOT LogsRepository.
    // Save logs here to match what the legacy path does.
    new ConversationService(userId)
      .saveLog({
        conversationId: body.conversationId || conversation.id,
        agentId: body.agentId,
        provider,
        model,
        userMessage: body.message,
        assistantContent: busCleanContent,
        toolCalls: busToolCalls,
        trace: busTrace as Record<string, unknown>,
        usage: busUsage
          ? {
              promptTokens: busUsage.input,
              completionTokens: busUsage.output,
              totalTokens: busUsage.input + busUsage.output,
            }
          : undefined,
        historyLength: body.historyLength,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      })
      .catch((err) => {
        log.warn('Failed to save chat history (MessageBus path):', err);
      });

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
        toolCalls:
          (busToolCalls as Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>) ?? undefined,
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
  return handleLegacySend({
    c,
    agent: agent!,
    body,
    chatMessage,
    provider,
    model,
    userId,
    agentId,
    startTime,
    userContextWindow,
  });
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

  // Clean up conversation state caches (BUG-11 fix)
  promptInitializedConversations.delete(id);
  lastExecPermHash.delete(id);

  return apiResponse(c, {});
});

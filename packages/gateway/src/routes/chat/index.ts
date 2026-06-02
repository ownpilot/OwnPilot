/**
 * Chat routes
 *
 * Implementation split (Hono handlers live in routes/, pure logic in services/):
 * - services/chat/state.ts:     Shared module-level state (breaks circular dep)
 * - services/chat/streaming.ts: SSE streaming types, callbacks, processing
 * - services/chat/prompt.ts:    System prompt init, execution context, demo mode
 * - services/conversation-service.ts: DB save, logging, post-chat processing
 * - routes/chat-fetch-url.ts:   URL content extraction endpoint
 * - routes/chat-legacy-send.ts: Legacy direct path (non-MessageBus fallback)
 * - routes/chat.ts:             Route handlers (this file) + backward compat re-exports
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatRequest } from '../../types/index.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getUserId,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
  truncate,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import {
  getAgent,
  getOrCreateDefaultAgent,
  getOrCreateChatAgent,
  isDemoMode,
  getDefaultModel,
  getWorkspaceContext,
  getSessionInfo,
  getCliCorrelationId,
} from '../agents/index.js';
import { runInSessionLane } from '../../services/agent/session-lane.js';
import { onMcpToolEvents } from '../../mcp/mcp-events.js';
import { getLLMRouter } from '@ownpilot/core';
import { ChatRepository } from '../../db/repositories/index.js';
import { modelConfigsRepo } from '../../db/repositories/model-configs.js';
import type { NormalizedMessage, MessageProcessingResult } from '@ownpilot/core';
import { DEFAULT_EXECUTION_PERMISSIONS, type ExecutionPermissions } from '@ownpilot/core';
import { getOrCreateSessionWorkspace } from '../../workspace/file-workspace.js';
import { executionPermissionsRepo } from '../../db/repositories/execution-permissions.js';
import {
  extractSuggestions,
  extractMemoriesFromResponse,
  normalizeChatWidgets,
} from '../../utils/index.js';
import { getLog } from '../../services/log.js';
import { PUBLIC_BASE_URL, MS_PER_MINUTE } from '../../config/defaults.js';
import { createLoginThrottle } from '../../utils/login-throttle.js';
import { getClientIp } from '../../utils/client-ip.js';
import { budgetManager } from '../../services/usage-tracking.js';
import { estimateCost, formatCost, type AIProvider } from '@ownpilot/core';

// RATE-003: per-IP throttle for the chat endpoint. /chat is the single
// most expensive endpoint — every request hits a paid LLM provider
// (OpenAI, Anthropic, Groq, etc.) and many requests run multi-turn
// tool loops that fan out to additional provider calls. A retry-storm
// from a buggy client or a runaway agent loop could burn the operator's
// monthly LLM budget in minutes. 60/min per IP allows interactive use
// (a fast typist sends ~10/min sustained, automation can burst higher)
// while capping the worst case at roughly $1-2/min cost on commercial
// frontier models.
const chatThrottle = createLoginThrottle({
  maxAttempts: 60,
  windowMs: MS_PER_MINUTE,
  lockoutMs: 5 * MS_PER_MINUTE,
});

const chatThrottleCleanup = setInterval(() => chatThrottle.cleanup(), 2 * MS_PER_MINUTE);
if (typeof chatThrottleCleanup === 'object' && 'unref' in chatThrottleCleanup) {
  chatThrottleCleanup.unref();
}

// Import from split modules
import {
  promptInitializedConversations,
  lastExecPermHash,
  execPermHash,
  boundedSetAdd,
  boundedMapSet,
} from '../../services/chat/state.js';
import {
  createStreamCallbacks,
  recordStreamUsage,
  processStreamingViaBus,
  wireStreamApproval,
} from '../../services/chat/streaming.js';
import {
  buildExecutionSystemPrompt,
  buildToolCatalog,
  generateDemoResponse,
  tryGetMessageBus,
} from '../../services/chat/prompt.js';
import {
  ConversationService,
  runPostChatProcessing,
  toAttachmentMeta,
} from '../../services/conversation-service.js';
import { handleLegacySend } from './legacy-send.js';
import type { McpToolEvent } from '../../mcp/mcp-events.js';

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
// Routes
// =============================================================================

export const chatRoutes = new Hono();

// Mount history, logs, and context reset sub-routes (extracted for maintainability)
import { chatHistoryRoutes } from './history.js';
chatRoutes.route('/', chatHistoryRoutes);

// Mount fetch-url sub-route
import { chatFetchUrlRoutes } from './fetch-url.js';
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
  // Per-IP throttle — see chatThrottle declaration. Skip in test env so
  // sequential test runs don't collide on the shared in-memory bucket.
  if (process.env.NODE_ENV !== 'test') {
    const ip = getClientIp(c.req);
    const throttleResult = chatThrottle.check(ip);
    if (!throttleResult.allowed) {
      c.header('Retry-After', String(Math.ceil(throttleResult.retryAfterMs / 1000)));
      return apiError(
        c,
        {
          code: ERROR_CODES.ACCESS_DENIED,
          message: 'Chat rate limit exceeded. Please retry later.',
        },
        429
      );
    }
  }

  const rawBody = await parseJsonBody(c);
  const { validateBody, chatMessageSchema } = await import('../../middleware/validation.js');
  const body = validateBody(chatMessageSchema, rawBody) as ChatRequest & {
    provider?: string;
    model?: string;
    workspaceId?: string;
  };

  // Idempotency: deduplicate retried requests via Idempotency-Key header.
  // Namespaced by userId in the repo so two users sending the same key value
  // cannot read each other's cached response.
  const idempotencyUserId = getUserId(c);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (idempotencyKey) {
    try {
      const idempotencyRepo = (
        await import('../../db/repositories/idempotency-keys.js')
      ).getIdempotencyKeysRepository();
      const cached = await idempotencyRepo.getRecord(idempotencyUserId, idempotencyKey);
      if (cached) {
        const result = cached.result as {
          id: string;
          conversationId: string;
          message: string;
          response: string;
          model: string;
          toolCalls: unknown[];
          usage: unknown;
          processingTime: number;
        };
        return apiResponse(c, {
          id: result.id,
          conversationId: result.conversationId,
          message: result.message,
          response: result.response,
          model: result.model,
          toolCalls: result.toolCalls,
          usage: result.usage,
          processingTime: result.processingTime,
          cached: true,
        });
      }
    } catch {
      // Idempotency failures should not block the request
    }
  }

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
    const resolved = await getLLMRouter().pick({ process: 'chat' });
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

  // Pre-spend budget check (BUDGET-001): a configured daily/weekly/monthly or
  // per-request budget MUST be enforced before any LLM call is dispatched, or
  // a buggy agent loop / runaway client can burn through the operator's
  // monthly LLM budget in minutes. We estimate cost from the user message
  // text + a conservative output budget; `budgetManager.canSpend()` already
  // consults perRequestLimit, dailyLimit, weeklyLimit, monthlyLimit and
  // respects `limitAction` (warn vs block). We only block when allowed=false
  // AND limitAction=block. With limitAction=warn we surface a header so the
  // client can show a soft warning but the request still goes through.
  // Skip in demo mode (no real spend) and on errors from the budget manager
  // (fail-open: a misconfigured budget should not break the API).
  if (provider && model && !provider.startsWith('cli-')) {
    try {
      const estimate = estimateCost(provider as AIProvider, model, body.message ?? '', 1000);
      const decision = await budgetManager.canSpend(estimate.estimatedCost);
      if (!decision.allowed) {
        log.warn(
          `[Chat] Blocked by budget: ${decision.reason} (est. ${formatCost(estimate.estimatedCost)})`
        );
        c.header('X-Budget-Blocked', 'true');
        c.header('X-Budget-Reason', decision.reason ?? 'budget_exceeded');
        return apiError(
          c,
          {
            code: ERROR_CODES.RATE_LIMITED,
            message: decision.reason ?? 'Request blocked by budget policy.',
            ...(decision.recommendation && { recommendation: decision.recommendation }),
          },
          429
        );
      }
      if (decision.reason) {
        // warn-mode overage — proceed but signal it to the client
        c.header('X-Budget-Warning', decision.reason);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[Chat] Budget check failed (allowing request): ${msg}`);
    }
  }

  // Get agent based on agentId or provider/model from request
  let agent: Awaited<ReturnType<typeof getAgent>>;
  // HDR-001: prefer configured PUBLIC_BASE_URL over request headers
  const gatewayUrl =
    PUBLIC_BASE_URL ||
    `${c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')}://${c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host}`;

  if (body.agentId) {
    agent = await getAgent(body.agentId);
    if (!agent) {
      return notFoundError(c, 'Agent', body.agentId);
    }
  } else {
    try {
      agent = await getOrCreateChatAgent(
        provider,
        model,
        routingFallback,
        undefined,
        body.conversationId,
        gatewayUrl
      );
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
  if (body.conversationId) {
    // Capture agent's initial systemPrompt BEFORE any loadConversation switching.
    // Without this, switching to a conversation without a stored systemPrompt causes
    // identity drift — the rich OwnPilot prompt is replaced by a generic fallback.
    const agentInitialPrompt = agent.getConversation().systemPrompt;

    let loaded = agent.loadConversation(body.conversationId);

    // DB fallback: if conversation exists in DB but not in agent memory
    // (agent was reset/evicted), reconstruct it from database messages.
    // Pattern reference: LibreChat BaseClient.loadHistory() + Chatwoot session_registry
    if (!loaded) {
      const chatRepo = new ChatRepository(getUserId(c));
      const dbData = await chatRepo.getConversationWithMessages(body.conversationId);
      if (dbData) {
        // Create conversation in agent memory with the ORIGINAL DB ID.
        // FIX: fall back to agent's rich init prompt if DB stored NULL — otherwise
        // ContextInjection middleware hits its generic "helpful AI assistant" fallback.
        agent
          .getMemory()
          .createWithId(
            dbData.conversation.id,
            dbData.conversation.systemPrompt || agentInitialPrompt,
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
        // FIX: use agent's rich init prompt instead of undefined so the new
        // conversation inherits the configured OwnPilot identity + tool docs.
        agent.getMemory().createWithId(body.conversationId, agentInitialPrompt, {
          source,
          createdAt: new Date().toISOString(),
        });
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
    const attachmentMeta = toAttachmentMeta(body.attachments);
    const earlyConv = await chatRepo.getOrCreateConversation(earlyConvId, {
      title: truncate(chatMessage),
      agentId: body.agentId,
      agentName: body.agentId ? undefined : 'Chat',
      provider,
      model,
    });
    // Persist user message NOW so it survives even if AI stream fails/aborts.
    // The later saveStreamingChat is idempotent — it won't duplicate this message.
    await chatRepo.addMessage({
      conversationId: earlyConv.id,
      role: 'user',
      content: chatMessage,
      provider,
      model,
      ...(attachmentMeta?.length && { attachments: attachmentMeta }),
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

        // Propagate client disconnect to the provider so a closed browser tab
        // stops the LLM stream instead of letting it run to natural completion
        // and burn tokens. Mirrors the legacy path below.
        const reqSignal = c.req.raw.signal;
        const onAbort = () => {
          agent.cancel();
        };
        reqSignal.addEventListener('abort', onAbort);

        wireStreamApproval(agent, stream, streamUserId);
        log.info(`[ExecSecurity] SSE requestApproval callback wired on agent (MessageBus path)`);

        // ── MCP tool event forwarding for CLI providers ──
        let unsubMcp: (() => void) | undefined;
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
            onStateReady: (state) => {
              const cliCorrelationId = getCliCorrelationId(agent);
              if (!cliCorrelationId) return;
              unsubMcp = onMcpToolEvents(cliCorrelationId, (event) => {
                state.mcpToolEvents.push(toMcpTraceEvent(event));
                void stream
                  .writeSSE({
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
                  })
                  .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    log.warn(`[chat] MCP tool event SSE write failed: ${msg}`);
                  });
              });
            },
          });
        } finally {
          reqSignal.removeEventListener('abort', onAbort);
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

      // Propagate client disconnect (AbortController) to provider to stop streaming.
      // agent.cancel() calls provider.cancel() which calls abortController.abort() —
      // this aborts the in-flight fetch and stops the SSE stream from continuing.
      const reqSignal = c.req.raw.signal;
      const onAbort = () => {
        agent.cancel();
      };
      reqSignal.addEventListener('abort', onAbort);

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

      wireStreamApproval(agent, stream, streamUserId);

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
        // Serialize per conversation: if another message for this conversation
        // is still streaming, wait for it instead of racing the shared agent's
        // memory (or hitting its "already processing" guard).
        const result = await runInSessionLane(conversationId, () =>
          agent.chat(chatMessage, {
            stream: true,
            thinking: body.thinking,
            onBeforeToolCall: callbacks.onBeforeToolCall,
            onChunk: callbacks.onChunk,
            onToolStart: callbacks.onToolStart,
            onToolEnd: callbacks.onToolEnd,
            onProgress: callbacks.onProgress,
          })
        );

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
          const { content: legacyMemStripped } = extractMemoriesFromResponse(result.value.content);
          const { content: legacySuggestionsStripped } = extractSuggestions(legacyMemStripped);
          const legacyCleanContent = normalizeChatWidgets(legacySuggestionsStripped);
          await new ConversationService(streamUserId).saveStreamingChat(state, {
            conversationId: body.conversationId || conversationId,
            agentId: body.agentId,
            provider,
            model,
            userMessage: body.message,
            assistantContent: legacyCleanContent,
            toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
            finishReason: result.value.finishReason,
            historyLength: body.historyLength,
            attachments: toAttachmentMeta(body.attachments),
            ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
            userAgent: c.req.header('user-agent'),
          });
        }
      } finally {
        reqSignal.removeEventListener('abort', onAbort);
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
    const { content: busSuggestionsStripped, suggestions: busSuggestions } =
      extractSuggestions(busMemStripped);
    const busCleanContent = normalizeChatWidgets(busSuggestionsStripped);

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

    // Build response object (used for both JSON return and idempotency cache)
    const responseObj = {
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
      // Use real prompt token count from the provider when available so the
      // UI context bar shows ground truth, not a char/4 estimate.
      session: getSessionInfo(agent, provider, model, userContextWindow, busUsage?.input),
      suggestions: busSuggestions.length > 0 ? busSuggestions : undefined,
      memories: busMemories.length > 0 ? busMemories : undefined,
      trace: busTrace,
    };

    // Store idempotency result before returning (fire-and-forget)
    if (idempotencyKey) {
      const idempotencyRepo = (
        await import('../../db/repositories/idempotency-keys.js')
      ).getIdempotencyKeysRepository();
      idempotencyRepo
        .setRecord(idempotencyUserId, idempotencyKey, responseObj)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[chat] idempotency record failed: ${msg}`);
        });
    }

    return c.json({
      success: true,
      data: responseObj,
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
  const userId = getUserId(c);

  if (await isDemoMode()) {
    return apiResponse(c, {
      id,
      systemPrompt: 'You are a helpful AI assistant.',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // IDOR guard: verify conversation belongs to this user before returning any data
  const chatRepo = new ChatRepository(userId);
  const dbConversation = await chatRepo.getConversation(id);
  if (!dbConversation) {
    return notFoundError(c, 'Conversation', id);
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
  const userId = getUserId(c);

  if (await isDemoMode()) {
    return apiResponse(c, {});
  }

  // IDOR guard: verify conversation belongs to this user before deleting
  const chatRepo = new ChatRepository(userId);
  const dbConversation = await chatRepo.getConversation(id);
  if (!dbConversation) {
    return notFoundError(c, 'Conversation', id);
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

  // Delete from database — conversation ownership already verified above
  await chatRepo.deleteConversation(id);

  // Clean up the per-conversation prompt-init cache. `lastExecPermHash` is
  // keyed by userId, not conversationId, so deleting it here was a no-op that
  // also masked the keying mismatch — left out intentionally.
  promptInitializedConversations.delete(id);

  return apiResponse(c, {});
});

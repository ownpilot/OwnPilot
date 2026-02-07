/**
 * Chat routes
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type {
  ChatRequest,
  StreamChunkResponse,
} from '../types/index.js';
import { apiResponse, apiError, ERROR_CODES, getUserId, getIntParam } from './helpers.js';
import { getAgent, getOrCreateDefaultAgent, getOrCreateChatAgent, isDemoMode, getDefaultModel, getWorkspaceContext, resetChatAgentContext, clearAllChatAgentCaches } from './agents.js';
import { usageTracker } from './costs.js';
import { logChatEvent } from '../audit/index.js';
import { ChatRepository, LogsRepository } from '../db/repositories/index.js';
import type { AIProvider } from '@ownpilot/core';
import {
  buildEnhancedSystemPrompt,
  checkToolCallApproval,
  extractMemories,
  updateGoalProgress,
  evaluateTriggers,
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
import { debugLog, type ToolDefinition, hasServiceRegistry, getServiceRegistry, Services } from '@ownpilot/core';
import type { IMessageBus, NormalizedMessage, MessageProcessingResult, StreamCallbacks, ToolEndResult } from '@ownpilot/core';
import type { StreamChunk, ToolCall } from '@ownpilot/core';
import { getOrCreateSessionWorkspace } from '../workspace/file-workspace.js';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { createApprovalRequest, generateApprovalId } from '../services/execution-approval.js';
import { wsGateway } from '../ws/server.js';
import { parseLimit, parseOffset, extractSuggestions } from '../utils/index.js';
import { getLog } from '../services/log.js';

const log = getLog('Chat');

/** Sanitize user-supplied IDs for safe interpolation in error messages */
const sanitizeId = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 100);

export const chatRoutes = new Hono();

/**
 * Build a minimal first-message context addendum.
 *
 * The system prompt already contains categorical capabilities and familiar
 * tool quick-references. This function only appends dynamic context that
 * cannot be known at system-prompt composition time:
 * - Custom data tables (user-created dynamic tables)
 * - Active custom/user-created tools
 */
async function buildToolCatalog(allTools: readonly ToolDefinition[]): Promise<string> {
  const lines: string[] = [];

  // 1. List active custom/user-created tools (if any)
  const skipTools = new Set(['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool']);
  const customTools = allTools.filter(
    t => !skipTools.has(t.name) && (t.category === 'Custom' || t.category === 'User' || t.category === 'Dynamic Tools')
  );
  if (customTools.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('## Active Custom Tools');
    for (const t of customTools) {
      const brief = t.brief ?? t.description.slice(0, 80);
      lines.push(`  ${t.name} — ${brief}`);
    }
  }

  // 2. Fetch custom data tables
  try {
    const service = getServiceRegistry().get(Services.Database);
    const tables = await service.listTables();
    if (tables.length > 0) {
      if (lines.length === 0) {
        lines.push('');
        lines.push('---');
      }
      lines.push('');
      lines.push('## Custom Data Tables');
      for (const t of tables) {
        const display = t.displayName && t.displayName !== t.name ? `${t.displayName} (${t.name})` : t.name;
        lines.push(`  ${display}`);
      }
    }
  } catch {
    // Custom data not available — skip
  }

  return lines.join('\n');
}

/**
 * Generate demo response based on user message
 */
function generateDemoResponse(message: string, provider: string, model: string): string {
  const providerName: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    zhipu: 'Zhipu AI (GLM)',
    deepseek: 'DeepSeek',
    groq: 'Groq',
    google: 'Google AI',
    xai: 'xAI',
    mistral: 'Mistral AI',
    together: 'Together AI',
    perplexity: 'Perplexity',
  };

  const name = providerName[provider] ?? provider;

  // Simple demo responses
  if (message.toLowerCase().includes('help') || message.toLowerCase().includes('what can you')) {
    return `Hello! I'm running in **demo mode** using ${name} (${model}).\n\nTo enable full functionality, please configure your API key in Settings.\n\nIn demo mode, I can:\n- Show you the UI capabilities\n- Demonstrate the chat interface\n- Help you configure your API keys\n\nOnce configured, I'll be able to:\n- Answer questions with AI\n- Execute tools\n- Remember conversation context`;
  }

  if (message.toLowerCase().includes('capabilities') || message.toLowerCase().includes('yetenekler')) {
    return `**OwnPilot Capabilities**\n\nThis is a privacy-first AI assistant platform. Currently in demo mode with ${name}.\n\n**Supported Providers:**\n- OpenAI (GPT-4o, o1, o1-mini)\n- Anthropic (Claude Sonnet 4, Opus 4)\n- Zhipu AI (GLM-4)\n- DeepSeek (DeepSeek-V3)\n- Groq (Llama 3.3)\n- Google AI (Gemini 1.5)\n- xAI (Grok 2)\n- And more!\n\n**Features:**\n- Multi-provider support\n- Tool/function calling\n- Conversation memory\n- Encrypted credential storage\n- Privacy-first design`;
  }

  if (message.toLowerCase().includes('tool')) {
    return `**Tools in OwnPilot**\n\nTools allow the AI to perform actions:\n\n- **get_current_time**: Get current date/time\n- **calculate**: Perform calculations\n- **search_web**: Search the internet\n- **read_file**: Read local files\n\nTo use tools, configure your API key and the AI will automatically use them when needed.`;
  }

  return `*Demo Mode Response*\n\nI received your message: "${message}"\n\nI'm currently running in demo mode with **${name}** (${model}). To get real AI responses, please configure your API key in the Settings page.\n\n---\n_This is a simulated response. Configure your API key for actual AI capabilities._`;
}

/**
 * Try to get the MessageBus from the ServiceRegistry.
 * Returns null if not available (graceful fallback to direct path).
 */
function tryGetMessageBus(): IMessageBus | null {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Message);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Process a non-streaming chat message through the MessageBus pipeline.
 *
 * This replaces the inline agent.chat() + post-processing + persistence + audit
 * logic with a clean pipeline call.
 */
async function processNonStreamingViaBus(
  bus: IMessageBus,
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
 * Process a streaming request through the MessageBus pipeline.
 * Creates StreamCallbacks that write SSE events.
 */
async function processStreamingViaBus(
  bus: IMessageBus,
  sseStream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: {
    agent: NonNullable<Awaited<ReturnType<typeof getAgent>>>;
    chatMessage: string;
    body: ChatRequest & { provider?: string; model?: string; workspaceId?: string };
    provider: string;
    model: string;
    userId: string;
    agentId: string;
    conversationId: string;
  },
): Promise<void> {
  const { agent, chatMessage, body, provider, model, userId, agentId, conversationId } = params;
  const streamStartTime = performance.now();

  // Content accumulated for suggestion extraction on stream completion
  let streamedContent = '';

  // Trace data accumulated during streaming
  let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  const traceToolCalls: Array<{
    name: string;
    arguments?: Record<string, unknown>;
    result?: string;
    success: boolean;
    duration?: number;
    startTime?: number;
  }> = [];

  // Build StreamCallbacks that write SSE events
  const streamCallbacks: StreamCallbacks = {
    onChunk(chunk: StreamChunk) {
      // Accumulate content for suggestion extraction
      if (chunk.content) streamedContent += chunk.content;

      const data: StreamChunkResponse & { trace?: Record<string, unknown> } = {
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
            }
          : undefined,
      };

      // Add trace info and extract suggestions when stream is done
      if (chunk.done) {
        const { suggestions } = extractSuggestions(streamedContent);
        if (suggestions.length > 0) data.suggestions = suggestions;
        const streamDuration = Math.round(performance.now() - streamStartTime);
        data.trace = {
          duration: streamDuration,
          toolCalls: traceToolCalls.map(tc => ({
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            success: tc.success,
            duration: tc.duration,
          })),
          modelCalls: lastUsage ? [{
            provider,
            model,
            inputTokens: lastUsage.promptTokens,
            outputTokens: lastUsage.completionTokens,
            tokens: lastUsage.totalTokens,
            duration: streamDuration,
          }] : [],
          autonomyChecks: [],
          dbOperations: { reads: 0, writes: 0 },
          memoryOps: { adds: 0, recalls: 0 },
          triggersFired: [],
          errors: [],
          events: traceToolCalls.map(tc => ({
            type: 'tool_call',
            name: tc.name,
            duration: tc.duration,
            success: tc.success,
          })),
          request: {
            provider,
            model,
            endpoint: `/api/v1/chat`,
            messageCount: (body.history?.length ?? 0) + 1,
          },
          response: {
            status: 'success' as const,
            finishReason: chunk.finishReason,
          },
        };
      }

      // Store last usage for cost tracking
      if (chunk.usage) {
        lastUsage = {
          promptTokens: chunk.usage.promptTokens,
          completionTokens: chunk.usage.completionTokens,
          totalTokens: chunk.usage.totalTokens,
        };
      }

      sseStream.writeSSE({
        data: JSON.stringify(data),
        event: chunk.done ? 'done' : 'chunk',
      });
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
      let parsedArgs: Record<string, unknown> | undefined;
      try { parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : undefined; } catch { /* malformed */ }
      const displayName = toolCall.name === 'use_tool' && parsedArgs?.tool_name
        ? String(parsedArgs.tool_name)
        : toolCall.name;
      const displayArgs = toolCall.name === 'use_tool' && parsedArgs?.arguments
        ? parsedArgs.arguments as Record<string, unknown>
        : parsedArgs;

      traceToolCalls.push({
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
      let displayName = toolCall.name;
      try {
        if (toolCall.name === 'use_tool' && toolCall.arguments) {
          const args = JSON.parse(toolCall.arguments);
          if (args.tool_name) displayName = args.tool_name;
        }
      } catch { /* ignore parse errors */ }

      const traceEntry = traceToolCalls.find(tc => tc.name === displayName && !tc.result);
      if (traceEntry) {
        traceEntry.result = result.content;
        traceEntry.success = !(result.isError ?? false);
        traceEntry.duration = result.durationMs ?? (traceEntry.startTime ? Math.round(performance.now() - traceEntry.startTime) : undefined);
        delete traceEntry.startTime;
      }

      // Detect local execution metadata from result content
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

  // Normalize into NormalizedMessage
  const normalized: NormalizedMessage = {
    id: crypto.randomUUID(),
    sessionId: conversationId,
    role: 'user',
    content: chatMessage,
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
    stream: streamCallbacks,
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

  // Record usage if not already done by middleware
  const streamLatency = Math.round(performance.now() - streamStartTime);
  if (lastUsage) {
    try {
      await usageTracker.record({
        userId,
        sessionId: conversationId,
        provider: provider as AIProvider,
        model,
        inputTokens: lastUsage.promptTokens,
        outputTokens: lastUsage.completionTokens,
        totalTokens: lastUsage.totalTokens,
        latencyMs: streamLatency,
        requestType: 'chat',
      });
    } catch {
      // Ignore tracking errors
    }
  } else if (result.response.metadata.error) {
    try {
      await usageTracker.record({
        userId,
        provider: provider as AIProvider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: streamLatency,
        requestType: 'chat',
        error: result.response.metadata.error as string,
      });
    } catch {
      // Ignore
    }
  }
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
  // Use a fallback model for demo mode display, but validate for real requests
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

  // Get agent based on agentId or provider/model from request
  let agent: Awaited<ReturnType<typeof getAgent>>;

  if (body.agentId) {
    // Use specific agent if agentId provided
    agent = await getAgent(body.agentId);
    if (!agent) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(body.agentId)}` }, 404);
    }
  } else {
    // Use provider/model from request to create chat agent
    try {
      agent = await getOrCreateChatAgent(provider, model);
    } catch (error) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: error instanceof Error ? error.message : 'Failed to create agent' }, 400);
    }
  }

  // Load conversation if specified
  if (body.conversationId) {
    const loaded = agent.loadConversation(body.conversationId);
    if (!loaded) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(body.conversationId)}` }, 404);
    }
  }

  // Set workspace directory for file operations
  // Use session-based workspaces for isolated file storage
  const sessionId = body.workspaceId || body.conversationId || agent.getConversation().id;
  let _sessionWorkspacePath: string | undefined;
  try {
    // Get or create a session workspace for this chat
    const sessionWorkspace = getOrCreateSessionWorkspace(sessionId, body.agentId);
    _sessionWorkspacePath = sessionWorkspace.path;
    agent.setWorkspaceDir(sessionWorkspace.path);

    // Update the system prompt with the correct workspace path
    const currentPrompt = agent.getConversation().systemPrompt || '';
    const wsContext = getWorkspaceContext(sessionWorkspace.path);

    // Replace any existing workspace path reference or add new one
    const workspaceInfo = `\n\n## File Operations\nYour workspace directory for file operations is: \`${wsContext.workspaceDir}\`\nWhen creating files, use relative paths (e.g., "script.py") and they will be saved in your workspace.\nFull workspace path: ${wsContext.workspaceDir}`;

    // Remove any old workspace info and add new one
    const promptWithoutOldWs = currentPrompt.replace(/\n\n## File Operations[\s\S]*?(?=\n\n##|$)/g, '');
    const updatedPrompt = promptWithoutOldWs + workspaceInfo;
    agent.updateSystemPrompt(updatedPrompt);

    log.info(`Using session workspace: ${sessionWorkspace.id} at ${sessionWorkspace.path}`);
  } catch (err) {
    log.warn(`Failed to create session workspace:`, err);
    // Continue without workspace - use global default
  }

  // Load persistent execution permissions from DB
  const execPermissions = await executionPermissionsRepo.get(getUserId(c));
  agent.setExecutionPermissions(execPermissions);

  // Build tool catalog for the first message (sent only once per chat)
  let chatMessage = body.message;
  if (body.includeToolList) {
    try {
      const allToolDefs = agent.getAllToolDefinitions();
      const catalog = await buildToolCatalog(allToolDefs);
      if (catalog) {
        chatMessage = body.message + catalog;
        log.info('Tool context injected: custom tools/tables');
      }
    } catch (err) {
      log.warn('Failed to build tool catalog:', err);
    }
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

        // Wire real-time approval for 'prompt' mode execution
        agent.setRequestApproval(async (_category, actionType, description, params) => {
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
          });
        } finally {
          agent.setRequestApproval(undefined);
          agent.setExecutionPermissions(undefined);
        }
      });
    }

    // ── Legacy Streaming Path (fallback) ──────────────────────────────────
    return streamSSE(c, async (stream) => {
      const conversationId = agent.getConversation().id;
      const streamStartTime = performance.now();
      const streamAgentId = body.agentId ?? `chat-${provider}`;
      const streamUserId = getUserId(c);
      let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      // Wire real-time approval for 'prompt' mode execution
      agent.setRequestApproval(async (_category, actionType, description, params) => {
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

      // Expose direct tools to LLM if requested (from picker selection)
      if (body.directTools?.length) {
        agent.setAdditionalTools(body.directTools);
      }

      // Content accumulated for suggestion extraction on stream completion
      let legacyStreamedContent = '';

      // Collect tool execution info for trace
      const traceToolCalls: Array<{
        name: string;
        arguments?: Record<string, unknown>;
        result?: string;
        success: boolean;
        duration?: number;
        startTime?: number;
      }> = [];

      const result = await agent.chat(chatMessage, {
        stream: true,
        onBeforeToolCall: async (toolCall) => {
          const approval = await checkToolCallApproval(streamUserId, toolCall, {
            agentId: streamAgentId,
            conversationId,
            provider,
            model,
          });

          if (!approval.approved) {
            // Notify client about blocked tool call
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'tool_blocked',
                toolCall: { id: toolCall.id, name: toolCall.name },
                reason: approval.reason,
              }),
              event: 'autonomy',
            });
          }

          return {
            approved: approval.approved,
            reason: approval.reason,
          };
        },
        onChunk: async (chunk) => {
          // Accumulate content for suggestion extraction
          if (chunk.content) legacyStreamedContent += chunk.content;

          const data: StreamChunkResponse & { trace?: Record<string, unknown> } = {
            id: chunk.id,
            conversationId,
            delta: chunk.content,
            toolCalls: chunk.toolCalls?.map((tc) => {
              let args: Record<string, unknown> | undefined;
              try { args = tc.arguments ? JSON.parse(tc.arguments) : undefined; } catch { args = undefined; }
              return { id: tc.id, name: tc.name, arguments: args };
            }),
            done: chunk.done,
            finishReason: chunk.finishReason,
            usage: chunk.usage
              ? {
                  promptTokens: chunk.usage.promptTokens,
                  completionTokens: chunk.usage.completionTokens,
                  totalTokens: chunk.usage.totalTokens,
                }
              : undefined,
          };

          // Add trace info and extract suggestions when stream is done
          if (chunk.done) {
            const { suggestions } = extractSuggestions(legacyStreamedContent);
            if (suggestions.length > 0) data.suggestions = suggestions;
            const streamDuration = Math.round(performance.now() - streamStartTime);
            data.trace = {
              duration: streamDuration,
              toolCalls: traceToolCalls.map(tc => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result,
                success: tc.success,
                duration: tc.duration,
              })),
              modelCalls: lastUsage ? [{
                provider,
                model,
                inputTokens: lastUsage.promptTokens,
                outputTokens: lastUsage.completionTokens,
                tokens: lastUsage.totalTokens,
                duration: streamDuration,
              }] : [],
              autonomyChecks: [],
              dbOperations: { reads: 0, writes: 0 },
              memoryOps: { adds: 0, recalls: 0 },
              triggersFired: [],
              errors: [],
              events: traceToolCalls.map(tc => ({
                type: 'tool_call',
                name: tc.name,
                duration: tc.duration,
                success: tc.success,
              })),
              request: {
                provider,
                model,
                endpoint: `/api/v1/chat`,
                messageCount: (body.history?.length ?? 0) + 1,
              },
              response: {
                status: 'success' as const,
                finishReason: chunk.finishReason,
              },
            };
          }

          // Store last usage for cost tracking
          if (chunk.usage) {
            lastUsage = {
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: chunk.usage.totalTokens,
            };
          }

          await stream.writeSSE({
            data: JSON.stringify(data),
            event: chunk.done ? 'done' : 'chunk',
          });
        },
        onToolStart: async (toolCall) => {
          // Extract the real tool name from use_tool calls for better logs
          const parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : undefined;
          const displayName = toolCall.name === 'use_tool' && parsedArgs?.tool_name
            ? parsedArgs.tool_name
            : toolCall.name;
          const displayArgs = toolCall.name === 'use_tool' && parsedArgs?.arguments
            ? parsedArgs.arguments
            : parsedArgs;

          // Add to trace collection with real tool name
          traceToolCalls.push({
            name: displayName,
            arguments: displayArgs,
            success: true, // Will be updated in onToolEnd
            startTime: performance.now(),
          });

          await stream.writeSSE({
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
        onToolEnd: async (toolCall, result) => {
          // Extract real tool name for display
          let displayName = toolCall.name;
          try {
            if (toolCall.name === 'use_tool' && toolCall.arguments) {
              const args = JSON.parse(toolCall.arguments);
              if (args.tool_name) displayName = args.tool_name;
            }
          } catch { /* ignore parse errors */ }

          // Update trace with result (match by real tool name)
          const traceEntry = traceToolCalls.find(tc => tc.name === displayName && !tc.result);
          if (traceEntry) {
            traceEntry.result = result.content;
            traceEntry.success = !(result.isError ?? false);
            traceEntry.duration = result.durationMs ?? (traceEntry.startTime ? Math.round(performance.now() - traceEntry.startTime) : undefined);
            delete traceEntry.startTime;
          }

          // Detect local execution metadata from result content
          let sandboxed: boolean | undefined;
          let executionMode: string | undefined;
          try {
            const parsed = JSON.parse(result.content);
            if (typeof parsed === 'object' && parsed !== null && 'sandboxed' in parsed) {
              sandboxed = parsed.sandboxed;
              executionMode = parsed.executionMode;
            }
          } catch { /* not JSON or no sandbox info */ }

          await stream.writeSSE({
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
        onProgress: async (message, data) => {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'status',
              message,
              data,
              timestamp: new Date().toISOString(),
            }),
            event: 'progress',
          });
        },
      });

      // Clear direct tools after chat completes
      if (body.directTools?.length) {
        agent.clearAdditionalTools();
      }

      // Reset execution permissions and approval callback
      agent.setRequestApproval(undefined);
      agent.setExecutionPermissions(undefined);

      const streamLatency = Math.round(performance.now() - streamStartTime);

      if (!result.ok) {
        // Record failed streaming request
        try {
          await usageTracker.record({
            userId: streamUserId,
            provider: provider as AIProvider,
            model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            latencyMs: streamLatency,
            requestType: 'chat',
            error: result.error.message,
          });
        } catch (costErr) {
          log.warn('Failed to log cost metrics', { error: costErr instanceof Error ? costErr.message : costErr });
        }

        await stream.writeSSE({
          data: JSON.stringify({
            error: result.error.message,
          }),
          event: 'error',
        });
      } else if (lastUsage) {
        // Record successful streaming request
        try {
          await usageTracker.record({
            userId: streamUserId,
            sessionId: conversationId,
            provider: provider as AIProvider,
            model,
            inputTokens: lastUsage.promptTokens,
            outputTokens: lastUsage.completionTokens,
            totalTokens: lastUsage.totalTokens,
            latencyMs: streamLatency,
            requestType: 'chat',
          });
        } catch {
          // Ignore tracking errors
        }
      }

      // Save streaming chat to database (same as non-streaming)
      if (result.ok) {
        try {
          const chatRepo = new ChatRepository(streamUserId);
          const logsRepo = new LogsRepository(streamUserId);

          // Build trace info from collected data
          const streamTraceInfo = {
            duration: streamLatency,
            toolCalls: traceToolCalls.map(tc => ({
              name: tc.name,
              arguments: tc.arguments,
              result: tc.result,
              success: tc.success,
              duration: tc.duration,
            })),
            modelCalls: lastUsage ? [{
              provider,
              model,
              inputTokens: lastUsage.promptTokens,
              outputTokens: lastUsage.completionTokens,
              tokens: lastUsage.totalTokens,
              duration: streamLatency,
            }] : [],
            request: {
              provider,
              model,
              endpoint: '/api/v1/chat',
              messageCount: (body.history?.length ?? 0) + 1,
              streaming: true,
            },
            response: {
              status: 'success' as const,
              finishReason: result.value.finishReason,
            },
          };

          // Get or create conversation
          const dbConversation = await chatRepo.getOrCreateConversation(body.conversationId || conversationId, {
            title: body.message.slice(0, 50) + (body.message.length > 50 ? '...' : ''),
            agentId: body.agentId,
            agentName: body.agentId ? undefined : 'Chat',
            provider,
            model,
          });

          // Save user message
          await chatRepo.addMessage({
            conversationId: dbConversation.id,
            role: 'user',
            content: body.message,
            provider,
            model,
          });

          // Save assistant message with trace
          await chatRepo.addMessage({
            conversationId: dbConversation.id,
            role: 'assistant',
            content: result.value.content,
            provider,
            model,
            toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
            trace: streamTraceInfo as Record<string, unknown>,
            inputTokens: lastUsage?.promptTokens,
            outputTokens: lastUsage?.completionTokens,
          });

          // Extract payload breakdown from debug log
          const streamPayloadEntry = debugLog.getRecent(5).find(e => e.type === 'request');
          const streamPayloadInfo = streamPayloadEntry?.data as { payload?: Record<string, unknown> } | undefined;

          // Log the request with payload breakdown
          logsRepo.log({
            conversationId: dbConversation.id,
            type: 'chat',
            provider,
            model,
            endpoint: 'chat/completions',
            method: 'POST',
            requestBody: {
              message: body.message,
              history: body.history?.length ?? 0,
              streaming: true,
              payload: streamPayloadInfo?.payload ?? null,
            },
            responseBody: { contentLength: result.value.content.length, toolCalls: result.value.toolCalls?.length ?? 0 },
            statusCode: 200,
            inputTokens: lastUsage?.promptTokens,
            outputTokens: lastUsage?.completionTokens,
            totalTokens: lastUsage?.totalTokens,
            durationMs: streamLatency,
            ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
            userAgent: c.req.header('user-agent'),
          });

          log.info(`Saved streaming to history: conversation=${dbConversation.id}, messages=+2`);

          wsGateway.broadcast('chat:history:updated', {
            conversationId: dbConversation.id,
            title: dbConversation.title,
            source: 'web',
            messageCount: dbConversation.messageCount + 2,
          });
        } catch (err) {
          log.warn('Failed to save streaming chat history:', err);
        }
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
  // If the MessageBus is available, route through the unified pipeline.
  // This handles: context injection, agent execution, post-processing,
  // persistence, and audit in composable middleware stages.
  const bus = tryGetMessageBus();
  if (bus) {
    const busResult = await processNonStreamingViaBus(bus, {
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

    // Reset local execution permission
    agent.setExecutionPermissions(undefined);

    const processingTime = Math.round(performance.now() - startTime);

    // Check for errors
    if (busResult.response.metadata.error) {
      return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: busResult.response.metadata.error as string }, 500);
    }

    const conversation = agent.getConversation();
    const busUsage = busResult.response.metadata.tokens as { input: number; output: number } | undefined;
    const { content: busCleanContent, suggestions: busSuggestions } = extractSuggestions(busResult.response.content);

    return c.json({
      success: true,
      data: {
        id: busResult.response.id,
        conversationId: conversation.id,
        message: busCleanContent,
        response: busCleanContent,
        model,
        toolCalls: (busResult.response.metadata.toolCalls as Array<{ id: string; name: string; arguments: Record<string, unknown> }>) ?? undefined,
        usage: busUsage
          ? {
              promptTokens: busUsage.input,
              completionTokens: busUsage.output,
              totalTokens: busUsage.input + busUsage.output,
            }
          : undefined,
        finishReason: 'stop',
        suggestions: busSuggestions.length > 0 ? busSuggestions : undefined,
        trace: {
          duration: processingTime,
          toolCalls: [],
          modelCalls: [{ provider, model, duration: processingTime }],
          autonomyChecks: [],
          dbOperations: { reads: 0, writes: 0 },
          memoryOps: { adds: 0, recalls: 0 },
          triggersFired: [],
          errors: busResult.warnings ?? [],
          events: busResult.stages.map(s => ({ type: 'stage', name: s })),
        },
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTime,
      },
    });
  }

  // ── Legacy Direct Path (fallback) ─────────────────────────────────────────
  // Used when MessageBus is not available. Will be removed after full migration.

  // Create trace context for this request
  const traceCtx = createTraceContext(requestId, userId);

  // Run chat logic within trace context
  const { result, traceSummary } = await withTraceContextAsync(traceCtx, async () => {
    recordTraceInfo('Chat request started', { provider, model, agentId, workspaceId });

    // Inject memories and goals into system prompt (Personal AI Assistant feature)
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

      // Log orchestrator stats if any context was injected
      if (stats.memoriesUsed > 0 || stats.goalsUsed > 0) {
        recordTraceInfo('Context injected', {
          memoriesUsed: stats.memoriesUsed,
          goalsUsed: stats.goalsUsed,
        });
        log.info(`Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
      }
    } catch (error) {
      // Don't fail chat if orchestrator fails, just log
      recordTraceError('Orchestrator failed', { error: error instanceof Error ? error.message : String(error) });
      log.warn('Failed to build enhanced prompt:', error);
    }

    // Log chat start
    logChatEvent({
      type: 'start',
      agentId,
      sessionId: body.conversationId ?? 'new',
      provider,
      model,
      requestId,
    }).catch((e) => log.warn('Event logging failed:', e));

    // Expose direct tools to LLM if requested (from picker selection)
    if (body.directTools?.length) {
      agent.setAdditionalTools(body.directTools);
    }

    // Track model call timing
    const modelCallStart = Date.now();

    // Call chat with autonomy check callback for tool calls
    const result = await agent.chat(chatMessage, {
      onBeforeToolCall: async (toolCall) => {
        // Parse arguments if it's a string
        const toolArgs = typeof toolCall.arguments === 'string'
          ? JSON.parse(toolCall.arguments) as Record<string, unknown>
          : toolCall.arguments as Record<string, unknown>;
        const toolStart = traceToolCallStart(toolCall.name, toolArgs);

        const approval = await checkToolCallApproval(userId, toolCall, {
          agentId,
          conversationId: body.conversationId,
          provider,
          model,
        });

        // Record autonomy check
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

    // Clear direct tools after chat completes
    if (body.directTools?.length) {
      agent.clearAdditionalTools();
    }

    // Reset local execution permission
    agent.setExecutionPermissions(undefined);

    // Record model call
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

    // Get trace summary before returning
    const summary = getTraceSummary();
    return { result, traceSummary: summary };
  });

  const processingTime = performance.now() - startTime;

  if (!result.ok) {
    // Record failed request
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
      // Ignore tracking errors
    }

    // Log chat error
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

    // Log error to database
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
      // Ignore logging errors
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
      // Ignore tracking errors - don't fail the request
    }
  }

  // Log chat completion with tool call count
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

  // Post-chat processing: Extract memories, update goals, evaluate triggers
  // This runs asynchronously to not block the response
  Promise.all([
    extractMemories(userId, body.message, result.value.content).catch((e) =>
      log.warn('Memory extraction failed:', e)
    ),
    updateGoalProgress(userId, body.message, result.value.content, result.value.toolCalls).catch((e) =>
      log.warn('Goal progress update failed:', e)
    ),
    evaluateTriggers(userId, body.message, result.value.content).catch((e) =>
      log.warn('Trigger evaluation failed:', e)
    ),
  ]).then(([memoriesExtracted, _, triggerResult]) => {
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
  }).catch((error) => {
    log.error('Post-chat processing failed', { error: error instanceof Error ? error.message : error });
  });

  // Build trace info for response with enhanced debug data
  const recentDebugEntries = debugLog.getRecent(20);

  // Extract request info from debug log
  const requestEntry = recentDebugEntries.find(e => e.type === 'request');
  const responseEntry = recentDebugEntries.find(e => e.type === 'response');
  const retryEntries = recentDebugEntries.filter(e => e.type === 'retry');
  const toolCallEntries = recentDebugEntries.filter(e => e.type === 'tool_call' || e.type === 'tool_result');

  // Build enhanced tool calls with arguments and results
  const enhancedToolCalls = traceSummary?.toolCalls.map((tc) => {
    // Find matching debug entries for arguments and results
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
          // Try to find matching response entry for token breakdown
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
        // Enhanced debug info from debug log
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
          messageCount: 1, // Single user message
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

  const { content: legacyCleanContent, suggestions: legacySuggestions } = extractSuggestions(result.value.content);

  const response = {
    success: true,
    data: {
      id: result.value.id,
      conversationId: conversation.id,
      message: legacyCleanContent,
      response: legacyCleanContent,
      model,
      toolCalls: result.value.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.parse(tc.arguments),
      })),
      usage: result.value.usage
        ? {
            promptTokens: result.value.usage.promptTokens,
            completionTokens: result.value.usage.completionTokens,
            totalTokens: result.value.usage.totalTokens,
          }
        : undefined,
      finishReason: result.value.finishReason,
      suggestions: legacySuggestions.length > 0 ? legacySuggestions : undefined,
      // Include trace info for debugging
      trace: traceInfo,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
      processingTime: Math.round(processingTime),
    },
  };

  // Save chat history to database (async, non-blocking)
  try {
    const chatRepo = new ChatRepository(userId);
    const logsRepo = new LogsRepository(userId);

    // Get or create conversation
    const dbConversation = await chatRepo.getOrCreateConversation(body.conversationId || conversation.id, {
      title: body.message.slice(0, 50) + (body.message.length > 50 ? '...' : ''),
      agentId: body.agentId,
      agentName: body.agentId ? undefined : 'Chat',
      provider,
      model,
    });

    // Save user message
    await chatRepo.addMessage({
      conversationId: dbConversation.id,
      role: 'user',
      content: body.message,
      provider,
      model,
    });

    // Save assistant message (use cleaned content without suggestions tag)
    await chatRepo.addMessage({
      conversationId: dbConversation.id,
      role: 'assistant',
      content: legacyCleanContent,
      provider,
      model,
      toolCalls: result.value.toolCalls ? [...result.value.toolCalls] : undefined,
      trace: traceInfo as Record<string, unknown>,
      inputTokens: result.value.usage?.promptTokens,
      outputTokens: result.value.usage?.completionTokens,
    });

    // Extract payload breakdown from debug log
    const payloadEntry = recentDebugEntries.find(e => e.type === 'request');
    const payloadInfo = payloadEntry?.data as { payload?: Record<string, unknown> } | undefined;

    // Log the request with payload breakdown
    logsRepo.log({
      conversationId: dbConversation.id,
      type: 'chat',
      provider,
      model,
      endpoint: 'chat/completions',
      method: 'POST',
      requestBody: {
        message: body.message,
        history: body.history?.length ?? 0,
        payload: payloadInfo?.payload ?? null,
      },
      responseBody: { contentLength: result.value.content.length, toolCalls: result.value.toolCalls?.length ?? 0 },
      statusCode: 200,
      inputTokens: result.value.usage?.promptTokens,
      outputTokens: result.value.usage?.completionTokens,
      totalTokens: result.value.usage?.totalTokens,
      durationMs: Math.round(processingTime),
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    log.info(`Saved to history: conversation=${dbConversation.id}, messages=+2`);

    wsGateway.broadcast('chat:history:updated', {
      conversationId: dbConversation.id,
      title: dbConversation.title,
      source: 'web',
      messageCount: dbConversation.messageCount + 2,
    });
  } catch (err) {
    // Don't fail the request if history save fails
    log.warn('Failed to save chat history:', err);
  }

  return c.json(response);
});

/**
 * Get conversation history
 */
chatRoutes.get('/conversations/:id', async (c) => {
  const id = c.req.param('id');
  const agentId = c.req.query('agentId');

  // In demo mode, return empty conversation
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(agentId!)}` }, 404);
  }

  const memory = agent.getMemory();
  const conversation = memory.get(id);

  if (!conversation) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(id)}` }, 404);
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

  // In demo mode, just return success
  if (await isDemoMode()) {
    return apiResponse(c, {});
  }

  const agent = agentId ? await getAgent(agentId) : await getOrCreateDefaultAgent();

  if (!agent) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(agentId!)}` }, 404);
  }

  const memory = agent.getMemory();
  const deleted = memory.delete(id);

  // Also delete from database
  const chatRepo = new ChatRepository('default');
  await chatRepo.deleteConversation(id);

  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(id)}` }, 404);
  }

  return apiResponse(c, {});
});

// =====================================================
// CHAT HISTORY API (Database-backed)
// =====================================================

/**
 * List all conversations (with pagination)
 */
chatRoutes.get('/history', async (c) => {
  const userId = getUserId(c);
  const limit = parseLimit(c.req.query('limit'), 50);
  const offset = parseOffset(c.req.query('offset'));
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
    conversations: conversations.map(conv => ({
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
chatRoutes.post('/history/bulk-delete', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Request body is required' }, 400);
  }

  try {
    const chatRepo = new ChatRepository(userId);
    let deleted = 0;

    if (body.all === true) {
      // Delete all conversations for this user
      const conversations = await chatRepo.listConversations({ limit: 10000 });
      const ids = conversations.map(c => c.id);
      deleted = await chatRepo.deleteConversations(ids);
    } else if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
      deleted = await chatRepo.deleteOldConversations(body.olderThanDays);
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      if (body.ids.length > 500) {
        return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Maximum 500 IDs per request' }, 400);
      }
      deleted = await chatRepo.deleteConversations(body.ids);
    } else {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Provide ids array, all: true, or olderThanDays' }, 400);
    }

    return apiResponse(c, { deleted });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Bulk delete failed' }, 500);
  }
});

/**
 * Bulk archive/unarchive conversations
 * Body: { ids: string[], archived: boolean }
 */
chatRoutes.post('/history/bulk-archive', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || !Array.isArray(body.ids) || typeof body.archived !== 'boolean') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Provide ids array and archived boolean' }, 400);
  }

  if (body.ids.length > 500) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Maximum 500 IDs per request' }, 400);
  }

  try {
    const chatRepo = new ChatRepository(userId);
    const updated = await chatRepo.archiveConversations(body.ids, body.archived);

    return apiResponse(c, { updated, archived: body.archived });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Bulk archive failed' }, 500);
  }
});

/**
 * Get conversation with all messages
 */
chatRoutes.get('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const chatRepo = new ChatRepository(userId);
    const data = await chatRepo.getConversationWithMessages(id);

    if (!data) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(id)}` }, 404);
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
      messages: data.messages.map(msg => ({
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
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Failed to fetch conversation' }, 500);
  }
});

/**
 * Delete conversation from history
 */
chatRoutes.delete('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const chatRepo = new ChatRepository(userId);
    const deleted = await chatRepo.deleteConversation(id);

    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(id)}` }, 404);
    }

    return apiResponse(c, { deleted: true });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Failed to delete conversation' }, 500);
  }
});

/**
 * Archive/unarchive conversation
 */
chatRoutes.patch('/history/:id/archive', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null) as { archived: boolean };

  try {
    const chatRepo = new ChatRepository(userId);
    const updated = await chatRepo.updateConversation(id, { isArchived: body.archived });

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Conversation not found: ${sanitizeId(id)}` }, 404);
    }

    return apiResponse(c, { archived: updated.isArchived });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Failed to update conversation' }, 500);
  }
});

// =====================================================
// LOGS API (Debug/Analytics)
// =====================================================

/**
 * Get request logs
 */
chatRoutes.get('/logs', async (c) => {
  const userId = getUserId(c);
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));
  const type = c.req.query('type') as 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other' | undefined;
  const hasError = c.req.query('errors') === 'true' ? true : c.req.query('errors') === 'false' ? false : undefined;
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
    logs: logs.map(log => ({
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
chatRoutes.get('/logs/stats', async (c) => {
  const userId = getUserId(c);
  const days = getIntParam(c, 'days', 7, 1, 365);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logsRepo = new LogsRepository(userId);
  const stats = await logsRepo.getStats(startDate);

  return apiResponse(c, stats);
});

/**
 * Get single log detail
 */
chatRoutes.get('/logs/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);

  try {
    const logsRepo = new LogsRepository(userId);
    const log = await logsRepo.getLog(id);

    if (!log) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Log not found: ${sanitizeId(id)}` }, 404);
    }

    return apiResponse(c, log);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: error instanceof Error ? error.message : 'Failed to fetch log' }, 500);
  }
});

/**
 * Clear logs
 * Query params:
 * - all=true: Clear ALL logs
 * - olderThanDays=N: Clear logs older than N days (default: 30)
 */
chatRoutes.delete('/logs', async (c) => {
  const userId = getUserId(c);
  const clearAll = c.req.query('all') === 'true';
  const days = getIntParam(c, 'olderThanDays', 30, 1);

  const logsRepo = new LogsRepository(userId);
  const deleted = clearAll
    ? await logsRepo.clearAll()
    : await logsRepo.deleteOldLogs(days);

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
chatRoutes.post('/reset-context', async (c) => {
  const body = await c.req.json().catch(() => null) as { provider?: string; model?: string; clearAll?: boolean };

  if (body.clearAll) {
    // Clear all cached chat agents
    const count = clearAllChatAgentCaches();

    return apiResponse(c, {
      cleared: count,
      message: `Cleared ${count} chat agent caches`,
    });
  }

  // Reset specific provider/model context
  const provider = body.provider ?? 'openai';
  const model = body.model ?? await getDefaultModel(provider) ?? 'gpt-4o';

  const reset = resetChatAgentContext(provider, model);

  return apiResponse(c, {
    reset,
    provider,
    model,
    message: reset
      ? `Context reset for ${provider}/${model}`
      : `No cached agent found for ${provider}/${model}`,
  });
});

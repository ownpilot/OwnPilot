/**
 * Chat routes
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type {
  ApiResponse,
  ChatRequest,
  ChatResponse,
  StreamChunkResponse,
} from '../types/index.js';
import { getAgent, getOrCreateDefaultAgent, getOrCreateChatAgent, isDemoMode, getDefaultModel, getWorkspaceContext, resetChatAgentContext, clearAllChatAgentCaches } from './agents.js';
import { usageTracker } from './costs.js';
import { logChatEvent } from '../audit/index.js';
import { getDatabase } from '../db/connection.js';
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
  type TraceSummary,
} from '../tracing/index.js';
import { debugLog, type ToolDefinition } from '@ownpilot/core';
import { getOrCreateSessionWorkspace, getSessionWorkspace } from '../workspace/file-workspace.js';
import { parseLimit, parseOffset } from '../utils/index.js';
import { getCustomDataService } from '../services/custom-data-service.js';

export const chatRoutes = new Hono();

/**
 * Build a compact tool catalog for the first message.
 * Lists all available tool names grouped by category + custom data tables.
 * Sent only once at the start of a chat so the LLM knows what exists.
 */
async function buildToolCatalog(allTools: readonly ToolDefinition[]): Promise<string> {
  // Skip meta-tools from the catalog
  const skipTools = new Set(['search_tools', 'get_tool_help', 'use_tool']);
  const tools = allTools.filter(t => !skipTools.has(t.name));

  // Group by category
  const groups: Record<string, string[]> = {};
  for (const t of tools) {
    const cat = t.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(t.name);
  }

  const lines: string[] = [
    '',
    '---',
    '[TOOL CATALOG — Complete list of available tools. This catalog is sent once at the start of the chat.]',
    '',
    'AVAILABLE TOOLS (call via use_tool or directly if attached):',
  ];

  // Sort categories for consistent output
  const sortedCats = Object.keys(groups).sort();
  for (const cat of sortedCats) {
    const toolNames = groups[cat]!.sort();
    lines.push(`  [${cat}] ${toolNames.join(', ')}`);
  }

  // Fetch custom data tables
  try {
    const service = getCustomDataService();
    const tables = await service.listTables();
    if (tables.length > 0) {
      lines.push('');
      lines.push('CUSTOM DATA TABLES:');
      for (const t of tables) {
        const display = t.displayName && t.displayName !== t.name ? `${t.displayName} (${t.name})` : t.name;
        lines.push(`  • ${display}`);
      }
    }
  } catch {
    // Custom data not available — skip
  }

  lines.push('');
  lines.push('IMPORTANT: This catalog only lists tool NAMES. You do NOT know how to call these tools.');
  lines.push('Before executing any tool, you MUST look up its parameters first:');
  lines.push('  1. search_tools("keyword", include_params=true) → find tools + get parameter docs');
  lines.push('  2. OR get_tool_help("tool_name") → get parameter docs for a known tool name');
  lines.push('  3. THEN use_tool("tool_name", {parameters}) → execute with correct parameters');
  lines.push('NEVER guess parameters — always look them up first.');

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
 * Send a chat message
 */
chatRoutes.post('/', async (c) => {
  const rawBody = await c.req.json();
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

    const response: ApiResponse<ChatResponse> = {
      success: true,
      data: {
        id: crypto.randomUUID(),
        conversationId: 'demo-conversation',
        message: demoResponse,
        response: demoResponse,
        model,
        finishReason: 'stop',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
        processingTime: 50,
      },
    };

    return c.json(response);
  }

  // Validate model is available for non-demo mode
  if (!requestedModel) {
    throw new HTTPException(400, {
      message: `No model available for provider: ${provider}. Configure a default model in Settings.`,
    });
  }

  // Get agent based on agentId or provider/model from request
  let agent: Awaited<ReturnType<typeof getAgent>>;

  if (body.agentId) {
    // Use specific agent if agentId provided
    agent = await getAgent(body.agentId);
    if (!agent) {
      throw new HTTPException(404, {
        message: `Agent not found: ${body.agentId}`,
      });
    }
  } else {
    // Use provider/model from request to create chat agent
    try {
      agent = await getOrCreateChatAgent(provider, model);
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : 'Failed to create agent',
      });
    }
  }

  // Load conversation if specified
  if (body.conversationId) {
    const loaded = agent.loadConversation(body.conversationId);
    if (!loaded) {
      throw new HTTPException(404, {
        message: `Conversation not found: ${body.conversationId}`,
      });
    }
  }

  // Set workspace directory for file operations
  // Use session-based workspaces for isolated file storage
  const sessionId = body.workspaceId || body.conversationId || agent.getConversation().id;
  let sessionWorkspacePath: string | undefined;
  try {
    // Get or create a session workspace for this chat
    const sessionWorkspace = getOrCreateSessionWorkspace(sessionId, body.agentId);
    sessionWorkspacePath = sessionWorkspace.path;
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

    console.log(`[Chat] Using session workspace: ${sessionWorkspace.id} at ${sessionWorkspace.path}`);
  } catch (err) {
    console.warn(`[Chat] Failed to create session workspace:`, err);
    // Continue without workspace - use global default
  }

  // Build tool catalog for the first message (sent only once per chat)
  let chatMessage = body.message;
  if (body.includeToolList) {
    try {
      const allToolDefs = agent.getAllToolDefinitions();
      const catalog = await buildToolCatalog(allToolDefs);
      chatMessage = body.message + catalog;
      console.log(`[Chat] Tool catalog injected: ${allToolDefs.length} tools`);
    } catch (err) {
      console.warn('[Chat] Failed to build tool catalog:', err);
    }
  }

  // Handle streaming
  if (body.stream) {
    return streamSSE(c, async (stream) => {
      const conversationId = agent.getConversation().id;
      const streamStartTime = performance.now();
      const streamAgentId = body.agentId ?? `chat-${provider}`;
      const streamUserId = 'default'; // TODO: Get from auth context
      let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      // Expose direct tools to LLM if requested (from picker selection)
      if (body.directTools?.length) {
        agent.setAdditionalTools(body.directTools);
      }

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
          const data: StreamChunkResponse & { trace?: Record<string, unknown> } = {
            id: chunk.id,
            conversationId,
            delta: chunk.content,
            toolCalls: chunk.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments ? JSON.parse(tc.arguments) : undefined,
            })),
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

          // Add trace info when stream is done
          if (chunk.done) {
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

      const streamLatency = Math.round(performance.now() - streamStartTime);

      if (!result.ok) {
        // Record failed streaming request
        try {
          await usageTracker.record({
            userId: 'anonymous',
            provider: provider as AIProvider,
            model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            latencyMs: streamLatency,
            requestType: 'chat',
            error: result.error.message,
          });
        } catch {
          // Ignore
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
            userId: 'anonymous',
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

          console.log(`[Chat] Saved streaming to history: conversation=${dbConversation.id}, messages=+2`);
        } catch (err) {
          console.warn('[Chat] Failed to save streaming chat history:', err);
        }
      }
    });
  }

  // Non-streaming response
  const startTime = performance.now();
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const agentId = body.agentId ?? `chat-${provider}`;
  const userId = 'default'; // TODO: Get from auth context
  const workspaceId = body.workspaceId ?? null;

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
        console.log(`[Orchestrator] Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
      }
    } catch (error) {
      // Don't fail chat if orchestrator fails, just log
      recordTraceError('Orchestrator failed', { error: error instanceof Error ? error.message : String(error) });
      console.warn('[Orchestrator] Failed to build enhanced prompt:', error);
    }

    // Log chat start
    logChatEvent({
      type: 'start',
      agentId,
      sessionId: body.conversationId ?? 'new',
      provider,
      model,
      requestId,
    }).catch((e) => console.warn('[Chat] Event logging failed:', e));

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
          console.log(
            `[Autonomy] Tool call blocked: ${toolCall.name} - ${approval.reason ?? 'Requires approval'}`
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
        userId: 'anonymous', // TODO: Get from auth
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
    }).catch((e) => console.warn('[Chat] Event logging failed:', e));

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

    throw new HTTPException(500, {
      message: result.error.message,
    });
  }

  const conversation = agent.getConversation();

  // Record successful usage
  if (result.value.usage) {
    try {
      await usageTracker.record({
        userId: 'anonymous', // TODO: Get from auth
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
  }).catch((e) => console.warn('[Chat] Event logging failed:', e));

  // Post-chat processing: Extract memories, update goals, evaluate triggers
  // This runs asynchronously to not block the response
  Promise.all([
    extractMemories(userId, body.message, result.value.content).catch((e) =>
      console.warn('[Orchestrator] Memory extraction failed:', e)
    ),
    updateGoalProgress(userId, body.message, result.value.content, result.value.toolCalls).catch((e) =>
      console.warn('[Orchestrator] Goal progress update failed:', e)
    ),
    evaluateTriggers(userId, body.message, result.value.content).catch((e) =>
      console.warn('[Orchestrator] Trigger evaluation failed:', e)
    ),
  ]).then(([memoriesExtracted, _, triggerResult]) => {
    if (memoriesExtracted && (memoriesExtracted as number) > 0) {
      console.log(`[Orchestrator] Extracted ${memoriesExtracted} new memories from conversation`);
    }
    if (triggerResult && typeof triggerResult === 'object') {
      const { triggered, pending, executed } = triggerResult as {
        triggered: string[];
        pending: string[];
        executed: string[];
      };
      if (triggered.length > 0) {
        console.log(`[Orchestrator] ${triggered.length} triggers evaluated`);
      }
      if (executed.length > 0) {
        console.log(`[Orchestrator] ${executed.length} triggers executed successfully`);
      }
      if (pending.length > 0) {
        console.log(`[Orchestrator] ${pending.length} triggers pending/failed`);
      }
    }
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

  const response: ApiResponse<ChatResponse> = {
    success: true,
    data: {
      id: result.value.id,
      conversationId: conversation.id,
      message: result.value.content,
      response: result.value.content,
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

    // Save assistant message
    await chatRepo.addMessage({
      conversationId: dbConversation.id,
      role: 'assistant',
      content: result.value.content,
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

    console.log(`[Chat] Saved to history: conversation=${dbConversation.id}, messages=+2`);
  } catch (err) {
    // Don't fail the request if history save fails
    console.warn('[Chat] Failed to save chat history:', err);
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
    const response: ApiResponse = {
      success: true,
      data: {
        id,
        systemPrompt: 'You are a helpful AI assistant.',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };
    return c.json(response);
  }

  const agent = agentId ? await getAgent(agentId) : await getOrCreateDefaultAgent();

  if (!agent) {
    throw new HTTPException(404, {
      message: `Agent not found: ${agentId}`,
    });
  }

  const memory = agent.getMemory();
  const conversation = memory.get(id);

  if (!conversation) {
    throw new HTTPException(404, {
      message: `Conversation not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
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
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Delete conversation
 */
chatRoutes.delete('/conversations/:id', async (c) => {
  const id = c.req.param('id');
  const agentId = c.req.query('agentId');

  // In demo mode, just return success
  if (await isDemoMode()) {
    const response: ApiResponse = {
      success: true,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };
    return c.json(response);
  }

  const agent = agentId ? await getAgent(agentId) : await getOrCreateDefaultAgent();

  if (!agent) {
    throw new HTTPException(404, {
      message: `Agent not found: ${agentId}`,
    });
  }

  const memory = agent.getMemory();
  const deleted = memory.delete(id);

  // Also delete from database
  const chatRepo = new ChatRepository('default');
  await chatRepo.deleteConversation(id);

  if (!deleted) {
    throw new HTTPException(404, {
      message: `Conversation not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =====================================================
// CHAT HISTORY API (Database-backed)
// =====================================================

/**
 * List all conversations (with pagination)
 */
chatRoutes.get('/history', async (c) => {
  const userId = 'default'; // TODO: Get from auth context
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

  const response: ApiResponse = {
    success: true,
    data: {
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
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get conversation with all messages
 */
chatRoutes.get('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = 'default'; // TODO: Get from auth context

  const chatRepo = new ChatRepository(userId);
  const data = await chatRepo.getConversationWithMessages(id);

  if (!data) {
    throw new HTTPException(404, {
      message: `Conversation not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
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
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Delete conversation from history
 */
chatRoutes.delete('/history/:id', async (c) => {
  const id = c.req.param('id');
  const userId = 'default'; // TODO: Get from auth context

  const chatRepo = new ChatRepository(userId);
  const deleted = await chatRepo.deleteConversation(id);

  if (!deleted) {
    throw new HTTPException(404, {
      message: `Conversation not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Archive/unarchive conversation
 */
chatRoutes.patch('/history/:id/archive', async (c) => {
  const id = c.req.param('id');
  const userId = 'default'; // TODO: Get from auth context
  const body = await c.req.json<{ archived: boolean }>();

  const chatRepo = new ChatRepository(userId);
  const updated = await chatRepo.updateConversation(id, { isArchived: body.archived });

  if (!updated) {
    throw new HTTPException(404, {
      message: `Conversation not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: { archived: updated.isArchived },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =====================================================
// LOGS API (Debug/Analytics)
// =====================================================

/**
 * Get request logs
 */
chatRoutes.get('/logs', async (c) => {
  const userId = 'default'; // TODO: Get from auth context
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

  const response: ApiResponse = {
    success: true,
    data: {
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
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get log statistics
 */
chatRoutes.get('/logs/stats', async (c) => {
  const userId = 'default'; // TODO: Get from auth context
  const days = parseInt(c.req.query('days') ?? '7');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logsRepo = new LogsRepository(userId);
  const stats = await logsRepo.getStats(startDate);

  const response: ApiResponse = {
    success: true,
    data: stats,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get single log detail
 */
chatRoutes.get('/logs/:id', async (c) => {
  const id = c.req.param('id');
  const userId = 'default'; // TODO: Get from auth context

  const logsRepo = new LogsRepository(userId);
  const log = await logsRepo.getLog(id);

  if (!log) {
    throw new HTTPException(404, {
      message: `Log not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: log,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Clear logs
 * Query params:
 * - all=true: Clear ALL logs
 * - olderThanDays=N: Clear logs older than N days (default: 30)
 */
chatRoutes.delete('/logs', async (c) => {
  const userId = 'default'; // TODO: Get from auth context
  const clearAll = c.req.query('all') === 'true';
  const days = parseInt(c.req.query('olderThanDays') ?? '30');

  const logsRepo = new LogsRepository(userId);
  const deleted = clearAll
    ? await logsRepo.clearAll()
    : await logsRepo.deleteOldLogs(days);

  const response: ApiResponse = {
    success: true,
    data: {
      deleted,
      mode: clearAll ? 'all' : `older than ${days} days`,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =====================================================
// CONTEXT RESET API
// =====================================================

/**
 * Reset chat context for a provider/model
 * Call this when starting a "New Chat" to clear conversation memory
 */
chatRoutes.post('/reset-context', async (c) => {
  const body = await c.req.json<{ provider?: string; model?: string; clearAll?: boolean }>();

  if (body.clearAll) {
    // Clear all cached chat agents
    const count = clearAllChatAgentCaches();

    const response: ApiResponse = {
      success: true,
      data: {
        cleared: count,
        message: `Cleared ${count} chat agent caches`,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  }

  // Reset specific provider/model context
  const provider = body.provider ?? 'openai';
  const model = body.model ?? await getDefaultModel(provider) ?? 'gpt-4o';

  const reset = resetChatAgentContext(provider, model);

  const response: ApiResponse = {
    success: true,
    data: {
      reset,
      provider,
      model,
      message: reset
        ? `Context reset for ${provider}/${model}`
        : `No cached agent found for ${provider}/${model}`,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

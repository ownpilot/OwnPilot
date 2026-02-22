/**
 * Agent Execution Middleware
 *
 * Core pipeline stage: calls agent.chat() and produces the response.
 * This is the "innermost" middleware — it actually generates the AI response.
 */

import { randomUUID } from 'node:crypto';
import type { MessageMiddleware, StreamCallbacks, ContentPart } from '@ownpilot/core';
import type { NormalizedMessage, MessageProcessingResult } from '@ownpilot/core';
import { checkToolCallApproval } from '../../assistant/index.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:AgentExecution');

/** Minimal agent interface needed by this middleware */
interface ChatAgent {
  chat(
    message: string | readonly ContentPart[],
    options?: Record<string, unknown>
  ): Promise<{
    ok: boolean;
    value?: {
      id: string;
      content: string;
      finishReason?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };
    error?: { message: string; stack?: string };
  }>;
  getConversation(): { id: string; systemPrompt?: string };
  setAdditionalTools?(tools: string[]): void;
  clearAdditionalTools?(): void;
  setDirectToolMode?(enabled: boolean): void;
  updateSystemPrompt?(prompt: string): void;
}

/**
 * Create middleware that executes the AI agent.
 *
 * Expects:
 *   ctx.get('agent')    — the ChatAgent instance
 *   ctx.get('userId')   — user ID for autonomy checks
 *   ctx.get('provider') — AI provider name
 *   ctx.get('model')    — AI model name
 *
 * Sets:
 *   ctx.set('agentResult') — raw agent.chat() result
 *   ctx.set('usage')       — token usage data
 */
export function createAgentExecutionMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const agent = ctx.get<ChatAgent>('agent');
    if (!agent) {
      ctx.addWarning('No agent in context');
      ctx.aborted = true;
      ctx.abortReason = 'No agent available to process message';
      return next();
    }

    const userId = ctx.get<string>('userId') ?? 'default';
    const agentId = ctx.get<string>('agentId') ?? 'chat';
    const provider = ctx.get<string>('provider') ?? 'unknown';
    const model = ctx.get<string>('model') ?? 'unknown';
    const conversationId = ctx.get<string>('conversationId');
    const directTools = ctx.get<string[]>('directTools');
    const stream = ctx.get<StreamCallbacks>('stream');

    // Expose direct tools if requested
    if (directTools?.length && agent.setAdditionalTools) {
      agent.setAdditionalTools(directTools);
    }

    // Direct tool mode: expose all tools directly instead of through meta-tool indirection.
    // Used for channel flows (Telegram) where simpler models can't handle use_tool() pattern.
    const directToolMode = ctx.get<boolean>('directToolMode');
    let savedSystemPrompt: string | undefined;
    if (directToolMode && agent.setDirectToolMode) {
      agent.setDirectToolMode(true);

      // Swap out the meta-tool instructions for direct-calling instructions
      if (agent.updateSystemPrompt) {
        const currentPrompt = agent.getConversation().systemPrompt ?? '';
        savedSystemPrompt = currentPrompt;
        const directPrompt = currentPrompt.replace(
          /## How to Call Tools[\s\S]*?(?=\n## [^#]|$)/,
          `## How to Call Tools\nCall tools directly by function name. Names use __ (double underscore) instead of dots as namespace separator.\nNamespaces: core__ = built-in, custom__ = user-created, plugin__<id>__ = plugins, ext__<id>__ = extensions, mcp__<server>__ = MCP servers.\nExample: core__add_task({title:"Buy milk"}) calls the built-in add_task tool.\nWhen mentioning tools to users, use dot notation for readability (e.g., "core.add_task" not "core__add_task").\nUse search_tools("keyword") to discover tools, get_tool_help("tool_name") for parameters.\n\n`
        );
        if (directPrompt !== currentPrompt) {
          agent.updateSystemPrompt(directPrompt);
        }
      }
    }

    const startTime = Date.now();

    try {
      const chatOptions: Record<string, unknown> = {};

      // Add streaming callbacks if streaming
      if (stream) {
        chatOptions.stream = true;
        chatOptions.onChunk = stream.onChunk;
        chatOptions.onToolStart = stream.onToolStart;
        chatOptions.onToolEnd = stream.onToolEnd;
        chatOptions.onProgress = stream.onProgress;
      }

      // Add autonomy check callback.
      // If the stream provides onBeforeToolCall (e.g., to send SSE events for blocked tools),
      // use it — it's expected to include autonomy checking itself.
      // Otherwise, use the middleware's default autonomy check.
      if (stream?.onBeforeToolCall) {
        chatOptions.onBeforeToolCall = stream.onBeforeToolCall;
      } else {
        chatOptions.onBeforeToolCall = async (toolCall: {
          id: string;
          name: string;
          arguments: string;
        }) => {
          const approval = await checkToolCallApproval(userId, toolCall, {
            agentId,
            conversationId,
            provider,
            model,
          });

          if (!approval.approved) {
            log.info(
              `Tool call blocked: ${toolCall.name} - ${approval.reason ?? 'Requires approval'}`
            );
          }

          return { approved: approval.approved, reason: approval.reason };
        };
      }

      // Convert attachments to ContentPart[] for vision models
      let chatContent: string | readonly ContentPart[] = message.content;
      if (message.attachments?.length) {
        const parts: ContentPart[] = [{ type: 'text', text: message.content }];
        for (const att of message.attachments) {
          if (att.type === 'image' && att.data) {
            parts.push({
              type: 'image',
              data: att.data,
              mediaType: att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            });
          }
        }
        chatContent = parts;
      }

      const result = await agent.chat(chatContent, chatOptions);

      // Clear direct tools after chat
      if (directTools?.length && agent.clearAdditionalTools) {
        agent.clearAdditionalTools();
      }

      // Restore direct tool mode and system prompt
      if (directToolMode && agent.setDirectToolMode) {
        agent.setDirectToolMode(false);
        if (savedSystemPrompt !== undefined && agent.updateSystemPrompt) {
          agent.updateSystemPrompt(savedSystemPrompt);
        }
      }

      const durationMs = Date.now() - startTime;

      // Store raw result in context for downstream middleware
      ctx.set('agentResult', result);
      ctx.set('durationMs', durationMs);

      if (!result.ok) {
        ctx.set('error', result.error);

        return {
          response: {
            id: randomUUID(),
            sessionId: message.sessionId,
            role: 'assistant' as const,
            content: `Error: ${result.error?.message ?? 'Unknown error'}`,
            metadata: {
              ...message.metadata,
              provider,
              model,
              error: result.error?.message,
            },
            timestamp: new Date(),
          },
          streamed: !!stream,
          durationMs,
          stages: ['agent-execution'],
          warnings: [`Agent error: ${result.error?.message}`],
        };
      }

      // Store usage
      if (result.value?.usage) {
        ctx.set('usage', result.value.usage);
      }

      const responseMessage: NormalizedMessage = {
        id: result.value?.id ?? randomUUID(),
        sessionId: message.sessionId,
        role: 'assistant',
        content: result.value?.content ?? '',
        metadata: {
          source: message.metadata.source,
          provider,
          model,
          conversationId: agent.getConversation().id,
          toolCalls: result.value?.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
              ? (() => {
                  try {
                    return JSON.parse(tc.arguments);
                  } catch {
                    return {};
                  }
                })()
              : {},
          })),
          tokens: result.value?.usage
            ? {
                input: result.value.usage.promptTokens,
                output: result.value.usage.completionTokens,
              }
            : undefined,
        },
        timestamp: new Date(),
      };

      // Build pipeline result — downstream middleware can augment it
      const pipelineResult: MessageProcessingResult = {
        response: responseMessage,
        streamed: !!stream,
        durationMs,
        stages: ['agent-execution'],
      };

      // Store for downstream middleware (post-processing, persistence, audit)
      ctx.set('pipelineResult', pipelineResult);

      // Notify stream that pipeline is done
      if (stream?.onDone) {
        stream.onDone(pipelineResult);
      }

      // Return directly — outer middleware receives this via their next() calls
      return pipelineResult;
    } catch (error) {
      // Clear direct tools on error too
      if (directTools?.length && agent.clearAdditionalTools) {
        agent.clearAdditionalTools();
      }

      // Restore direct tool mode and system prompt on error
      if (directToolMode && agent.setDirectToolMode) {
        agent.setDirectToolMode(false);
        if (savedSystemPrompt !== undefined && agent.updateSystemPrompt) {
          agent.updateSystemPrompt(savedSystemPrompt);
        }
      }

      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Agent execution failed', { error: err.message, stack: err.stack });

      // Notify stream of error
      if (stream?.onError) {
        stream.onError(err);
      }

      return {
        response: {
          id: randomUUID(),
          sessionId: message.sessionId,
          role: 'assistant' as const,
          content: `Error: ${err.message}`,
          metadata: { ...message.metadata, error: err.message },
          timestamp: new Date(),
        },
        streamed: !!stream,
        durationMs: Date.now() - startTime,
        stages: ['agent-execution'],
        warnings: [`Agent execution error: ${err.message}`],
      };
    }
  };
}

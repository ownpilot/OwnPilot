/**
 * Agent Execution Middleware
 *
 * Core pipeline stage: calls agent.chat() and produces the response.
 * This is the "innermost" middleware — it actually generates the AI response.
 */

import { randomUUID } from 'node:crypto';
import type { MessageMiddleware, StreamCallbacks, PipelineContext } from '@ownpilot/core';
import type { NormalizedMessage, MessageProcessingResult } from '@ownpilot/core';
import { checkToolCallApproval } from '../../assistant/index.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:AgentExecution');

/** Minimal agent interface needed by this middleware */
interface ChatAgent {
  chat(message: string, options?: Record<string, unknown>): Promise<{
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
  getConversation(): { id: string };
  setAdditionalTools?(tools: string[]): void;
  clearAdditionalTools?(): void;
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
        chatOptions.onBeforeToolCall = async (toolCall: { id: string; name: string; arguments: string }) => {
          const approval = await checkToolCallApproval(userId, toolCall, {
            agentId,
            conversationId,
            provider,
            model,
          });

          if (!approval.approved) {
            log.info(`Tool call blocked: ${toolCall.name} - ${approval.reason ?? 'Requires approval'}`);
          }

          return { approved: approval.approved, reason: approval.reason };
        };
      }

      const result = await agent.chat(message.content, chatOptions);

      // Clear direct tools after chat
      if (directTools?.length && agent.clearAdditionalTools) {
        agent.clearAdditionalTools();
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
          toolCalls: result.value?.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
          })),
          tokens: result.value?.usage
            ? { input: result.value.usage.promptTokens, output: result.value.usage.completionTokens }
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

      // Store for downstream middleware
      ctx.set('pipelineResult', pipelineResult);

      // Continue to post-processing middleware
      const finalResult = await next();

      // Notify stream that pipeline is done
      if (stream?.onDone) {
        stream.onDone(finalResult);
      }

      return finalResult;
    } catch (error) {
      // Clear direct tools on error too
      if (directTools?.length && agent.clearAdditionalTools) {
        agent.clearAdditionalTools();
      }

      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Agent execution failed', { error: err.message });

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

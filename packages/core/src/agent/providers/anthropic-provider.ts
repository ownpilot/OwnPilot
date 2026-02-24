/**
 * Anthropic Provider
 *
 * Native Anthropic/Claude API implementation with prompt caching support.
 */

import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolCall,
  Message,
  AIProvider,
} from '../types.js';
import { BaseProvider, DEFAULT_RETRY_CONFIG } from '../base-provider.js';
import { withRetry } from '../retry.js';
import {
  logRequest,
  logResponse,
  logError,
  buildRequestDebugInfo,
  buildResponseDebugInfo,
  calculatePayloadBreakdown,
} from '../debug.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { sanitizeToolName, desanitizeToolName } from '../tool-namespace.js';

/**
 * Anthropic API response types
 */
interface AnthropicContent {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  id?: string;
  content?: AnthropicContent[];
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  content_block?: AnthropicContent;
  index?: number;
  message?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Anthropic provider
 */
export class AnthropicProvider extends BaseProvider {
  readonly type: AIProvider = 'anthropic';

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? 'https://api.anthropic.com/v1',
    });
  }

  isReady(): boolean {
    return !!this.config.apiKey;
  }

  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    if (!this.isReady()) {
      return err(new ValidationError('Anthropic API key not configured'));
    }

    // Extract system message
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const anthropicTools = this.buildAnthropicTools(request);
    const body = {
      model: request.model.model,
      max_tokens: request.model.maxTokens ?? 4096,
      system: systemMessage ? this.buildSystemBlocks(systemMessage) : undefined,
      messages: this.buildAnthropicMessages(otherMessages),
      temperature: request.model.temperature,
      top_p: request.model.topP,
      stop_sequences: request.model.stop as string[] | undefined,
      tools: anthropicTools,
      tool_choice: anthropicTools ? this.mapAnthropicToolChoice(request.toolChoice) : undefined,
    };

    const endpoint = `${this.config.baseUrl}/messages`;

    // Log request with payload breakdown
    const anthropicDebugInfo = buildRequestDebugInfo(
      'anthropic',
      request.model.model,
      endpoint,
      request.messages,
      request.tools,
      request.model.maxTokens ?? 4096,
      request.model.temperature,
      false
    );
    anthropicDebugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
    logRequest(anthropicDebugInfo);

    const startTime = Date.now();

    // Use retry wrapper for the actual API call
    const result = await withRetry(async () => {
      try {
        this.clearRequestTimeout();
        this.abortController = new AbortController();
        const anthropicTimeout = this.config.timeout ?? 300000;
        this.requestTimeoutId = setTimeout(() => {
          this.abortController?.abort();
        }, anthropicTimeout);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey!,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
          },
          body: JSON.stringify(body),
          signal: this.abortController.signal,
        });
        this.clearRequestTimeout();

        if (!response.ok) {
          const errorText = await response.text();
          const error = new InternalError(`Anthropic API error: ${response.status} - ${errorText}`);
          logError('anthropic', error, `HTTP ${response.status}`);
          return err(error);
        }

        const data = (await response.json()) as AnthropicResponse;

        // Extract text and tool use from content blocks
        let textContent = '';
        const toolCalls: ToolCall[] = [];

        for (const block of data.content ?? []) {
          if (block.type === 'text') {
            textContent += block.text ?? '';
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id ?? '',
              name: desanitizeToolName(block.name ?? ''),
              arguments: JSON.stringify(block.input ?? {}),
            });
          }
        }

        const completionResponse: CompletionResponse = {
          id: data.id ?? '',
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          finishReason: this.mapAnthropicStopReason(data.stop_reason ?? 'end_turn'),
          usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
            cachedTokens: (data.usage as Record<string, number> | undefined)
              ?.cache_read_input_tokens,
          },
          model: data.model ?? request.model.model,
          createdAt: new Date(),
        };

        // Log response
        logResponse(
          buildResponseDebugInfo('anthropic', completionResponse.model, Date.now() - startTime, {
            content: completionResponse.content,
            toolCalls: completionResponse.toolCalls,
            finishReason: completionResponse.finishReason,
            usage: completionResponse.usage,
            rawResponse: data,
          })
        );

        return ok(completionResponse);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Anthropic request', this.config.timeout ?? 300000);
          logError('anthropic', timeoutError, 'Request timeout');
          return err(timeoutError);
        }
        const internalError = new InternalError(
          `Anthropic request failed: ${getErrorMessage(error)}`
        );
        logError('anthropic', internalError, 'Request exception');
        return err(internalError);
      }
    }, DEFAULT_RETRY_CONFIG);

    // Cast result to expected type (withRetry only returns our specific error types)
    return result as Result<CompletionResponse, InternalError | TimeoutError | ValidationError>;
  }

  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    if (!this.isReady()) {
      yield err(new InternalError('Anthropic API key not configured'));
      return;
    }

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const streamTools = this.buildAnthropicTools(request);
    const body = {
      model: request.model.model,
      max_tokens: request.model.maxTokens ?? 4096,
      system: systemMessage ? this.buildSystemBlocks(systemMessage) : undefined,
      messages: this.buildAnthropicMessages(otherMessages),
      temperature: request.model.temperature,
      tools: streamTools,
      tool_choice: streamTools ? this.mapAnthropicToolChoice(request.toolChoice) : undefined,
      stream: true,
    };

    // Log streaming request with payload breakdown
    const anthropicStreamDebugInfo = buildRequestDebugInfo(
      'anthropic',
      request.model.model,
      `${this.config.baseUrl}/messages`,
      request.messages,
      request.tools,
      request.model.maxTokens ?? 4096,
      request.model.temperature,
      true
    );
    anthropicStreamDebugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
    logRequest(anthropicStreamDebugInfo);

    try {
      this.clearRequestTimeout();
      this.abortController = new AbortController();
      const streamTimeout = this.config.timeout ?? 300000;
      this.requestTimeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, streamTimeout);

      const response = await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey!,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
      this.clearRequestTimeout();

      if (!response.ok || !response.body) {
        yield err(new InternalError(`Anthropic stream error: ${response.status}`));
        return;
      }

      const reader = response.body.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = '';
        // Track tool calls across content blocks
        const toolCallBlocks: Array<{ id: string; name: string; arguments: string }> = [];
        let currentToolBlockIndex = -1;
        // Track input tokens from message_start
        let inputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data) as AnthropicStreamEvent;

              if (parsed.type === 'message_start') {
                // Capture input token count from the initial message
                inputTokens = parsed.message?.usage?.input_tokens ?? 0;
              } else if (parsed.type === 'content_block_start') {
                // Track tool_use blocks as they start
                if (parsed.content_block?.type === 'tool_use') {
                  currentToolBlockIndex = parsed.index ?? toolCallBlocks.length;
                  toolCallBlocks[currentToolBlockIndex] = {
                    id: parsed.content_block.id ?? '',
                    name: parsed.content_block.name
                      ? desanitizeToolName(parsed.content_block.name)
                      : '',
                    arguments: '',
                  };
                }
              } else if (parsed.type === 'content_block_delta') {
                if (
                  parsed.delta?.type === 'input_json_delta' &&
                  parsed.delta.partial_json != null
                ) {
                  // Accumulate tool call arguments
                  const blockIdx = parsed.index ?? currentToolBlockIndex;
                  if (blockIdx >= 0 && toolCallBlocks[blockIdx]) {
                    toolCallBlocks[blockIdx].arguments += parsed.delta.partial_json;
                  }
                } else {
                  // Text delta
                  yield ok({
                    id: '',
                    content: parsed.delta?.text,
                    done: false,
                  });
                }
              } else if (parsed.type === 'message_stop') {
                // Emit accumulated tool calls if any, then signal done
                // Filter out sparse array holes (indices may skip non-tool content blocks)
                const completedToolCalls = toolCallBlocks.filter(Boolean);
                yield ok({
                  id: '',
                  toolCalls: completedToolCalls.length > 0 ? completedToolCalls : undefined,
                  done: true,
                });
                return;
              } else if (parsed.type === 'message_delta') {
                const outputTokens = parsed.usage?.output_tokens ?? 0;
                yield ok({
                  id: '',
                  done: false,
                  finishReason: this.mapAnthropicStopReason(
                    parsed.delta?.stop_reason ?? 'end_turn'
                  ),
                  usage: {
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    totalTokens: inputTokens + outputTokens,
                  },
                });
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* already released */
        }
      }
    } catch (error) {
      yield err(new InternalError(`Anthropic stream failed: ${getErrorMessage(error)}`));
    }
  }

  async getModels(): Promise<Result<string[], InternalError>> {
    // Anthropic doesn't have a models endpoint, return known models
    return ok([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ]);
  }

  /**
   * Split system message into cacheable blocks for Anthropic prompt caching.
   * Static sections (persona, tools, capabilities) get cache_control so they
   * are cached across requests. Dynamic sections (current context, execution
   * info) are sent without cache_control and change per request.
   */
  private buildSystemBlocks(
    systemMessage: Message
  ): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
    const text =
      typeof systemMessage.content === 'string'
        ? systemMessage.content
        : systemMessage.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { text: string }).text)
            .join('\n');

    // Dynamic sections that change per-request — everything from here on is NOT cached
    const dynamicMarkers = ['## Current Context', '## Code Execution', '## File Operations'];
    let splitPoint = text.length;
    for (const marker of dynamicMarkers) {
      const idx = text.indexOf(marker);
      if (idx >= 0 && idx < splitPoint) splitPoint = idx;
    }

    const staticPart = text.slice(0, splitPoint).trimEnd();
    const dynamicPart = text.slice(splitPoint).trimStart();
    const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];

    if (staticPart) {
      blocks.push({ type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } });
    }
    if (dynamicPart) {
      blocks.push({ type: 'text', text: dynamicPart });
    }
    return blocks;
  }

  private buildAnthropicMessages(messages: readonly Message[]) {
    return messages.map((msg) => {
      // Tool result messages: include ALL results (not just the first)
      if (msg.role === 'tool' && msg.toolResults?.length) {
        return {
          role: 'user',
          content: msg.toolResults.map((result) => ({
            type: 'tool_result',
            tool_use_id: result.toolCallId,
            content: result.content,
            is_error: result.isError,
          })),
        };
      }

      const contentParts: unknown[] =
        typeof msg.content === 'string'
          ? msg.content
            ? [{ type: 'text', text: msg.content }]
            : []
          : msg.content.map((part) => {
              if (part.type === 'text') {
                return { type: 'text', text: part.text };
              } else if (part.type === 'image') {
                return {
                  type: 'image',
                  source: part.isUrl
                    ? { type: 'url', url: part.data }
                    : { type: 'base64', media_type: part.mediaType, data: part.data },
                };
              }
              return { type: 'text', text: '[Unsupported content]' };
            });

      // Assistant messages with tool calls: include tool_use blocks in content array
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.arguments);
          } catch {
            /* keep empty */
          }
          contentParts.push({
            type: 'tool_use',
            id: tc.id,
            name: sanitizeToolName(tc.name),
            input,
          });
        }
      }

      // Use string content for simple text-only messages, array for multi-block
      const content =
        contentParts.length === 1 && typeof msg.content === 'string' && !msg.toolCalls?.length
          ? msg.content
          : contentParts;

      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content,
      };
    });
  }

  private buildAnthropicTools(request: CompletionRequest) {
    if (!request.tools?.length) return undefined;

    return request.tools.map((tool) => ({
      name: sanitizeToolName(tool.name),
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  private mapAnthropicToolChoice(
    toolChoice: CompletionRequest['toolChoice']
  ): Record<string, unknown> | undefined {
    if (!toolChoice) return undefined;
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'none') return undefined; // Anthropic: omit tool_choice to disable
    if (toolChoice === 'required') return { type: 'any' };
    if (typeof toolChoice === 'object' && 'name' in toolChoice) {
      return { type: 'tool', name: sanitizeToolName(toolChoice.name) };
    }
    return undefined;
  }

  private mapAnthropicStopReason(
    reason: string
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

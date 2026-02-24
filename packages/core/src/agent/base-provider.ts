/**
 * Base AI Provider
 *
 * Abstract base class with shared functionality for all AI providers:
 * timeout management, message building, tool formatting, token counting.
 */

import type { Result } from '../types/result.js';
import type { InternalError, TimeoutError, ValidationError } from '../types/errors.js';
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolCall,
  AIProvider,
} from './types.js';
import type { IProvider } from './provider-types.js';
import type { RetryConfig } from './retry.js';
import { logRetry } from './debug.js';
import { sanitizeToolName, desanitizeToolName } from './tool-namespace.js';

/**
 * Default retry configuration for AI provider calls
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  addJitter: true,
  onRetry: (attempt, error, delayMs) => {
    logRetry(attempt, 3, error, delayMs);
  },
};

/**
 * Base provider with common functionality
 */
export abstract class BaseProvider implements IProvider {
  abstract readonly type: AIProvider;
  protected readonly config: ProviderConfig;
  protected abortController: AbortController | null = null;
  protected requestTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract isReady(): boolean;

  abstract complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>>;

  abstract stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown>;

  /**
   * Approximate token count (rough estimate: ~4 chars per token)
   */
  countTokens(messages: readonly Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const part of msg.content) {
          if (part.type === 'text') {
            totalChars += part.text.length;
          }
        }
      }
    }
    // Rough approximation: ~4 characters per token
    return Math.ceil(totalChars / 4);
  }

  abstract getModels(): Promise<Result<string[], InternalError>>;

  /**
   * Cancel ongoing request
   */
  cancel(): void {
    this.clearRequestTimeout();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Clear the request timeout to prevent stale timer leaks
   */
  protected clearRequestTimeout(): void {
    if (this.requestTimeoutId !== null) {
      clearTimeout(this.requestTimeoutId);
      this.requestTimeoutId = null;
    }
  }

  /**
   * Create fetch options with timeout
   */
  protected createFetchOptions(body: unknown, timeoutMs?: number): RequestInit {
    this.clearRequestTimeout();
    this.abortController = new AbortController();
    const timeout = timeoutMs ?? this.config.timeout ?? 300000; // 5 minutes default

    // Set up timeout (cleared after request completes)
    this.requestTimeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        ...(this.config.organization ? { 'OpenAI-Organization': this.config.organization } : {}),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    };
  }

  /**
   * Parse tool calls from response
   */
  protected parseToolCalls(toolCalls: unknown): ToolCall[] {
    if (!Array.isArray(toolCalls)) return [];

    return toolCalls.map((tc) => ({
      id: tc.id ?? '',
      name: desanitizeToolName(tc.function?.name ?? tc.name ?? ''),
      arguments: tc.function?.arguments ?? tc.arguments ?? '{}',
    }));
  }

  /**
   * Build messages for API request
   */
  protected buildMessages(messages: readonly Message[]): Array<{
    role: string;
    content: string | unknown[];
    tool_calls?: unknown[];
    tool_call_id?: string;
  }> {
    type OpenAIMsg = {
      role: string;
      content: string | unknown[];
      tool_calls?: unknown[];
      tool_call_id?: string;
    };
    return messages.flatMap((msg): OpenAIMsg | OpenAIMsg[] => {
      // Tool result messages: expand each result into a separate message (OpenAI requires one per tool_call_id)
      if (msg.role === 'tool' && msg.toolResults?.length) {
        return msg.toolResults.map(
          (result): OpenAIMsg => ({
            role: 'tool',
            content: result.content,
            tool_call_id: result.toolCallId,
          })
        );
      }

      const base: {
        role: string;
        content: string | unknown[];
        tool_calls?: unknown[];
        tool_call_id?: string;
      } = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((part) => {
                if (part.type === 'text') {
                  return { type: 'text', text: part.text };
                } else if (part.type === 'image') {
                  return {
                    type: 'image_url',
                    image_url: {
                      url: part.isUrl ? part.data : `data:${part.mediaType};base64,${part.data}`,
                    },
                  };
                }
                return { type: 'text', text: '[Unsupported content]' };
              }),
      };

      // Add tool calls for assistant messages
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        base.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: sanitizeToolName(tc.name),
            arguments: tc.arguments,
          },
        }));
      }

      return base;
    });
  }

  /**
   * Build tools for API request
   */
  protected buildTools(
    request: CompletionRequest
  ):
    | Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
    | undefined {
    if (!request.tools?.length) return undefined;

    return request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: sanitizeToolName(tool.name),
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

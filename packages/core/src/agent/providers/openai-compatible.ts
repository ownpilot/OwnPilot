/**
 * OpenAI-Compatible Provider
 *
 * Config-driven implementation that works with any OpenAI-compatible API:
 * - DeepSeek
 * - Groq
 * - Together AI
 * - Mistral AI
 * - Fireworks AI
 * - Perplexity
 * - xAI (Grok)
 * - And any other OpenAI-compatible endpoint
 *
 * All provider configurations are loaded from JSON files in ./configs/
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { sanitizeToolName, desanitizeToolName, normalizeToolArguments } from '../tool-namespace.js';
import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  AIProvider,
  TokenUsage,
  Message,
  ToolCall,
} from '../types.js';
import type { ProviderHealthResult } from '../provider-types.js';
import {
  loadProviderConfig,
  resolveProviderConfig,
  type ProviderConfig,
  type ResolvedProviderConfig,
} from './configs/index.js';
import { getAuthHeader, type ResolvedAuth } from './configs/types.js';
import { readSseData, runProviderHealthCheck, approximateTokenCount } from './shared.js';

/**
 * Build the Authorization header from either the new `resolvedAuth`
 * discriminated union or the legacy `apiKey` field. All supported auth
 * methods today reduce to `Bearer <value>`; centralising the resolution
 * means callsites do not have to know about the auth method.
 */
function authHeader(config: { resolvedAuth?: ResolvedAuth; apiKey?: string }): string {
  if (config.resolvedAuth) return getAuthHeader(config.resolvedAuth);
  return `Bearer ${config.apiKey ?? ''}`;
}

/**
 * OpenAI API response types
 */
interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
    reasoning_content?: string; // DeepSeek R1
  };
  delta?: {
    content?: string;
    reasoning_content?: string; // DeepSeek R1 streaming
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIResponse {
  id?: string;
  choices?: OpenAIChoice[];
  model?: string;
  created?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * OpenAI-compatible provider that uses JSON config files
 */
export class OpenAICompatibleProvider {
  readonly type: AIProvider;
  private readonly providerId: string;
  private readonly config: ResolvedProviderConfig;
  private abortController: AbortController | null = null;
  private requestTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
    this.providerId = config.id;
    this.type = config.id as AIProvider;
  }

  /**
   * Create provider from provider ID (loads config from JSON)
   */
  static fromProviderId(providerId: string): OpenAICompatibleProvider | null {
    const resolvedConfig = resolveProviderConfig(providerId);
    if (!resolvedConfig) {
      return null;
    }
    return new OpenAICompatibleProvider(resolvedConfig);
  }

  /**
   * Create provider with explicit API key
   */
  static fromProviderIdWithKey(
    providerId: string,
    apiKey: string
  ): OpenAICompatibleProvider | null {
    const config = loadProviderConfig(providerId);
    if (!config) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeyEnv, ...rest } = config;
    return new OpenAICompatibleProvider({ ...rest, apiKey });
  }

  /**
   * Get the provider's JSON config
   */
  getConfig(): ProviderConfig | undefined {
    return loadProviderConfig(this.providerId) ?? undefined;
  }

  /**
   * Get default model for this provider
   */
  getDefaultModel(): string | undefined {
    return this.config.models.find((m) => m.default)?.id ?? this.config.models[0]?.id;
  }

  isReady(): boolean {
    return !!this.config.apiKey && !!this.config.baseUrl;
  }

  async healthCheck(): Promise<Result<ProviderHealthResult, InternalError>> {
    return runProviderHealthCheck({
      providerId: this.providerId,
      ready: this.isReady(),
      notConfiguredError: 'API key or base URL not configured',
      request: (signal) =>
        fetch(`${this.config.baseUrl}/models`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader(this.config),
          },
          signal,
        }),
    });
  }

  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    if (!this.isReady()) {
      return err(new ValidationError(`${this.providerId} API key or base URL not configured`));
    }

    const model = request.model.model || this.getDefaultModel();
    if (!model) {
      return err(new ValidationError('No model specified'));
    }

    const body = this.buildRequestBody(request, model, false);

    try {
      const fetchOptions = this.createFetchOptions(body);
      // Inject conversation ID for session resume (Bridge uses this for --resume)
      if (request.metadata?.conversationId) {
        (fetchOptions.headers as Record<string, string>)['X-Conversation-Id'] =
          request.metadata.conversationId;
      }
      // Inject X-Runtime header for bridge multi-provider routing
      // Provider name 'bridge-opencode' → X-Runtime: opencode
      if (this.providerId.startsWith('bridge-')) {
        (fetchOptions.headers as Record<string, string>)['X-Runtime'] = this.providerId.replace(
          'bridge-',
          ''
        );
      }
      const response = await fetch(
        `${this.config.baseUrl}${this.config.endpoint ?? '/chat/completions'}`,
        fetchOptions
      );
      this.clearRequestTimeout();

      if (!response.ok) {
        const errorText = await response.text();
        return err(
          new InternalError(`${this.providerId} API error: ${response.status} - ${errorText}`)
        );
      }

      const data = (await response.json()) as OpenAIResponse;
      const choice = data.choices?.[0];

      if (!choice) {
        return err(new InternalError(`No response from ${this.providerId}`));
      }

      // Handle reasoning content (DeepSeek R1, QwQ, etc.)
      let content = choice.message?.content ?? '';
      if (choice.message?.reasoning_content) {
        content = `<thinking>\n${choice.message.reasoning_content}\n</thinking>\n\n${content}`;
      }

      // Extract Bridge session IDs from response headers (for session resume mapping)
      const bridgeConvId = response.headers.get('x-conversation-id') ?? undefined;
      const bridgeSessionId = response.headers.get('x-session-id') ?? undefined;

      return ok({
        id: data.id ?? '',
        content,
        toolCalls: this.parseToolCalls(choice.message?.tool_calls),
        finishReason: this.mapFinishReason(choice.finish_reason ?? 'stop'),
        usage: data.usage ? this.mapUsage(data.usage) : undefined,
        model: data.model ?? model,
        createdAt: new Date((data.created ?? Date.now() / 1000) * 1000),
        ...(bridgeConvId || bridgeSessionId
          ? {
              responseMetadata: { bridgeConversationId: bridgeConvId, bridgeSessionId },
            }
          : {}),
      });
    } catch (error) {
      // Clear the request timeout on the fetch-error path so a network error
      // before fetch resolves doesn't leak a setTimeout into the event loop.
      this.clearRequestTimeout();
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new TimeoutError(`${this.providerId} request`, this.config.timeout ?? 300000));
      }
      return err(new InternalError(`${this.providerId} request failed: ${getErrorMessage(error)}`));
    }
  }

  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    if (!this.isReady()) {
      yield err(new InternalError(`${this.providerId} API key or base URL not configured`));
      return;
    }

    const model = request.model.model || this.getDefaultModel();
    if (!model) {
      yield err(new InternalError('No model specified'));
      return;
    }

    const body = this.buildRequestBody(request, model, true);

    try {
      const fetchOptions = this.createFetchOptions(body);
      if (request.metadata?.conversationId) {
        (fetchOptions.headers as Record<string, string>)['X-Conversation-Id'] =
          request.metadata.conversationId;
      }
      // Inject X-Runtime header for bridge multi-provider routing (streaming path)
      if (this.providerId.startsWith('bridge-')) {
        (fetchOptions.headers as Record<string, string>)['X-Runtime'] = this.providerId.replace(
          'bridge-',
          ''
        );
      }
      const response = await fetch(
        `${this.config.baseUrl}${this.config.endpoint ?? '/chat/completions'}`,
        fetchOptions
      );
      this.clearRequestTimeout();

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        yield err(
          new InternalError(
            `${this.providerId} stream error: ${response.status}${errorText ? ` - ${errorText}` : ''}`
          )
        );
        return;
      }

      // Extract Bridge session IDs from response headers (streaming path — mirrors complete() line 197)
      const bridgeConvId = response.headers.get('x-conversation-id') ?? undefined;
      const bridgeSessionId = response.headers.get('x-session-id') ?? undefined;

      let reasoningBuffer = '';
      let reasoningDone = false;

      for await (const data of readSseData(response.body)) {
        if (process.env.OWNPILOT_DEBUG_STREAM) {
          console.log(`[stream:${this.providerId}] ${data.slice(0, 500)}`);
        }
        if (data === '[DONE]') {
          yield ok({
            id: '',
            done: true,
            ...(bridgeConvId || bridgeSessionId
              ? {
                  responseMetadata: { bridgeConversationId: bridgeConvId, bridgeSessionId },
                }
              : {}),
          });
          return;
        }

        try {
          const parsed = JSON.parse(data) as OpenAIResponse;
          const choice = parsed.choices?.[0];
          const delta = choice?.delta ?? {};

          // Handle reasoning content streaming (DeepSeek R1, QwQ, MiniMax-M2)
          if (delta.reasoning_content) {
            reasoningBuffer += delta.reasoning_content;
            yield ok({
              id: parsed.id ?? '',
              content: delta.reasoning_content,
              metadata: { type: 'reasoning' },
              done: false,
            });
            // Skip the rest of this iteration only when the chunk is
            // reasoning-only. Some providers (notably MiniMax) bundle
            // reasoning_content together with delta.content / tool_calls
            // / finish_reason in the SAME chunk — `continue` here would
            // silently drop the final answer or stop signal.
            if (!delta.content && !delta.tool_calls && choice?.finish_reason == null) {
              continue;
            }
          }

          // When switching from reasoning to content
          if (reasoningBuffer && !reasoningDone && delta.content) {
            reasoningDone = true;
            yield ok({
              id: parsed.id ?? '',
              content: '\n\n',
              done: false,
            });
          }

          yield ok({
            id: parsed.id ?? '',
            content: delta.content,
            toolCalls: delta.tool_calls?.map((tc) => ({
              id: tc.id,
              name: tc.function?.name ? desanitizeToolName(tc.function.name) : undefined,
              arguments: tc.function?.arguments,
            })),
            done: choice?.finish_reason != null,
            finishReason: choice?.finish_reason
              ? this.mapFinishReason(choice.finish_reason)
              : undefined,
            usage: parsed.usage ? this.mapUsage(parsed.usage) : undefined,
            ...(choice?.finish_reason != null && (bridgeConvId || bridgeSessionId)
              ? {
                  responseMetadata: { bridgeConversationId: bridgeConvId, bridgeSessionId },
                }
              : {}),
          });
        } catch {
          // Skip malformed chunks
        }
      }
    } catch (error) {
      // Clear timer on the fetch-error path — if the failure happens before
      // `await fetch` resolves we'd otherwise leak the 5-minute timeout.
      this.clearRequestTimeout();
      yield err(new InternalError(`${this.providerId} stream failed: ${getErrorMessage(error)}`));
    }
  }

  /**
   * Get models from JSON config (no API call needed)
   */
  async getModels(): Promise<Result<string[], InternalError>> {
    const models = this.config.models.map((m) => m.id);
    return ok(models);
  }

  /**
   * Fetch models from API (live, may have more models)
   */
  async fetchModelsFromAPI(): Promise<Result<string[], InternalError>> {
    if (!this.isReady()) {
      return err(new InternalError(`${this.providerId} API key not configured`));
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          Authorization: authHeader(this.config),
          ...this.config.headers,
        },
      });

      if (!response.ok) {
        // Fall back to config models
        return this.getModels();
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const models = data.data?.map((m) => m.id) ?? [];

      return ok(models);
    } catch {
      // Fall back to config models
      return this.getModels();
    }
  }

  /**
   * Approximate token count
   */
  countTokens(messages: readonly Message[]): number {
    return approximateTokenCount(messages);
  }

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

  private clearRequestTimeout(): void {
    if (this.requestTimeoutId !== null) {
      clearTimeout(this.requestTimeoutId);
      this.requestTimeoutId = null;
    }
  }

  private buildRequestBody(
    request: CompletionRequest,
    model: string,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(request.messages),
      stream,
    };

    // Optional parameters
    if (request.model.maxTokens) {
      body.max_tokens = request.model.maxTokens;
    }
    if (request.model.temperature !== undefined) {
      body.temperature = request.model.temperature;
    }
    if (request.model.topP !== undefined) {
      body.top_p = request.model.topP;
    }
    if (request.model.frequencyPenalty !== undefined) {
      body.frequency_penalty = request.model.frequencyPenalty;
    }
    if (request.model.presencePenalty !== undefined) {
      body.presence_penalty = request.model.presencePenalty;
    }
    if (request.model.stop) {
      body.stop = request.model.stop;
    }

    // Tools (only if provider supports it)
    if (this.config.features.toolUse) {
      const tools = this.buildTools(request);
      if (tools) {
        body.tools = tools;
        if (request.toolChoice) {
          body.tool_choice = request.toolChoice;
        }
      }
    }

    // JSON mode (only if provider supports it)
    if (request.model.responseFormat === 'json' && this.config.features.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    // User tracking
    if (request.user) {
      body.user = request.user;
    }

    // Stream options for usage in streaming
    if (stream) {
      body.stream_options = { include_usage: true };
    }

    return body;
  }

  private buildMessages(messages: readonly Message[]): Array<Record<string, unknown>> {
    type Msg = Record<string, unknown>;
    return messages.flatMap<Msg>((msg): Msg | Msg[] => {
      // Tool result messages: expand each result into a separate message (OpenAI requires one per tool_call_id)
      if (msg.role === 'tool' && msg.toolResults?.length) {
        return msg.toolResults.map(
          (result): Msg => ({
            role: 'tool',
            // A tool that succeeds with no output yields content "". Strict
            // providers (MiniMax code 2013 "chat content is empty", GLM/ZAI
            // code 1213) reject empty tool content — the single most common
            // way an agentic/tool-heavy run (e.g. Claw) trips them. Fall back
            // to a space so the turn is structurally valid.
            content: result.content === '' ? ' ' : result.content,
            tool_call_id: result.toolCallId,
          })
        );
      }

      // A tool role message without toolResults is structurally invalid for OpenAI (code 1214).
      // Skip it rather than sending an invalid payload.
      if (msg.role === 'tool') {
        return [];
      }

      const rawContent =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => {
              if (part.type === 'text') {
                return { type: 'text', text: part.text };
              } else if (part.type === 'image') {
                // Only include images if provider supports vision
                if (!this.config.features.vision) {
                  return { type: 'text', text: '[Image not supported by this provider]' };
                }
                return {
                  type: 'image_url',
                  image_url: {
                    url: part.isUrl ? part.data : `data:${part.mediaType};base64,${part.data}`,
                  },
                };
              }
              return { type: 'text', text: '[Unsupported content]' };
            });

      const base: Msg = {
        role: msg.role,
        // Empty assistant content alongside tool_calls is a cross-provider minefield:
        // some strict APIs (code 1214) reject "" and want null; others (Moonshot /
        // Kimi-style code 2013 "chat content is empty") reject null and want a string.
        // A single space satisfies both — non-empty for the former, non-null for the latter.
        content:
          msg.role === 'assistant' && msg.toolCalls?.length && rawContent === '' ? ' ' : rawContent,
      };

      // Add tool calls for assistant messages
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        base.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: sanitizeToolName(tc.name),
            // Valid JSON string required — strict providers (MiniMax 2013,
            // ZAI 1214) reject "" / malformed args on the replayed turn.
            arguments: normalizeToolArguments(tc.arguments),
          },
        }));
      }

      return base;
    });
  }

  private buildTools(request: CompletionRequest): Array<Record<string, unknown>> | undefined {
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

  private createFetchOptions(body: unknown): RequestInit {
    this.clearRequestTimeout();
    this.abortController = new AbortController();
    const timeout = this.config.timeout ?? 120000;

    this.requestTimeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(this.config),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    };
  }

  private parseToolCalls(toolCalls: unknown): ToolCall[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc) => ({
      id: tc.id ?? '',
      name: desanitizeToolName(tc.function?.name ?? tc.name ?? ''),
      arguments: tc.function?.arguments ?? tc.arguments ?? '{}',
    }));
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private mapUsage(usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }): TokenUsage {
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    };
  }
}

// =============================================================================
// Convenience factory functions (for backward compatibility)
// =============================================================================

/**
 * Create provider from provider ID
 */
export function createOpenAICompatibleProvider(
  providerId: string
): OpenAICompatibleProvider | null {
  return OpenAICompatibleProvider.fromProviderId(providerId);
}

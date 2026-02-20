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
import { sanitizeToolName, desanitizeToolName } from '../tool-namespace.js';
import type {
  ProviderConfig as LegacyProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  AIProvider,
  TokenUsage,
  Message,
  ToolCall,
} from '../types.js';
import {
  loadProviderConfig,
  resolveProviderConfig,
  type ProviderConfig,
  type ResolvedProviderConfig,
} from './configs/index.js';

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
  static fromProviderIdWithKey(providerId: string, apiKey: string): OpenAICompatibleProvider | null {
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
    return this.config.models.find(m => m.default)?.id ?? this.config.models[0]?.id;
  }

  isReady(): boolean {
    return !!this.config.apiKey && !!this.config.baseUrl;
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
      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        this.createFetchOptions(body)
      );
      this.clearRequestTimeout();

      if (!response.ok) {
        const errorText = await response.text();
        return err(new InternalError(`${this.providerId} API error: ${response.status} - ${errorText}`));
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

      return ok({
        id: data.id ?? '',
        content,
        toolCalls: this.parseToolCalls(choice.message?.tool_calls),
        finishReason: this.mapFinishReason(choice.finish_reason ?? 'stop'),
        usage: data.usage ? this.mapUsage(data.usage) : undefined,
        model: data.model ?? model,
        createdAt: new Date((data.created ?? Date.now() / 1000) * 1000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new TimeoutError(`${this.providerId} request`, this.config.timeout ?? 300000));
      }
      return err(
        new InternalError(`${this.providerId} request failed: ${getErrorMessage(error)}`)
      );
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
      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        this.createFetchOptions(body)
      );
      this.clearRequestTimeout();

      if (!response.ok || !response.body) {
        yield err(new InternalError(`${this.providerId} stream error: ${response.status}`));
        return;
      }

      const reader = response.body.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = '';
        let reasoningBuffer = '';
        let reasoningDone = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              yield ok({ id: '', done: true });
              return;
            }

            try {
              const parsed = JSON.parse(data) as OpenAIResponse;
              const choice = parsed.choices?.[0];
              const delta = choice?.delta ?? {};

              // Handle reasoning content streaming (DeepSeek R1, QwQ)
              if (delta.reasoning_content) {
                reasoningBuffer += delta.reasoning_content;
                yield ok({
                  id: parsed.id ?? '',
                  content: delta.reasoning_content,
                  metadata: { type: 'reasoning' },
                  done: false,
                });
                continue;
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
              });
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } finally {
        try { await reader.cancel(); } catch { /* already released */ }
      }
    } catch (error) {
      yield err(
        new InternalError(`${this.providerId} stream failed: ${getErrorMessage(error)}`)
      );
    }
  }

  /**
   * Get models from JSON config (no API call needed)
   */
  async getModels(): Promise<Result<string[], InternalError>> {
    const models = this.config.models.map(m => m.id);
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
          Authorization: `Bearer ${this.config.apiKey}`,
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
    return Math.ceil(totalChars / 4);
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

  private buildMessages(
    messages: readonly Message[]
  ): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      const base: Record<string, unknown> = {
        role: msg.role,
        content:
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

      // Add tool result for tool messages
      if (msg.role === 'tool' && msg.toolResults?.length) {
        const result = msg.toolResults[0];
        if (result) {
          base.tool_call_id = result.toolCallId;
          base.content = result.content;
        }
      }

      return base;
    });
  }

  private buildTools(
    request: CompletionRequest
  ): Array<Record<string, unknown>> | undefined {
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
        Authorization: `Bearer ${this.config.apiKey}`,
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
export function createOpenAICompatibleProvider(providerId: string): OpenAICompatibleProvider | null {
  return OpenAICompatibleProvider.fromProviderId(providerId);
}

/**
 * Create DeepSeek provider
 */
export function createDeepSeekProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('deepseek', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('deepseek');
}

/**
 * Create Groq provider
 */
export function createGroqProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('groq', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('groq');
}

/**
 * Create Together AI provider
 */
export function createTogetherProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('together', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('together');
}

/**
 * Create Fireworks AI provider
 */
export function createFireworksProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('fireworks', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('fireworks');
}

/**
 * Create Mistral AI provider
 */
export function createMistralProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('mistral', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('mistral');
}

/**
 * Create xAI (Grok) provider
 */
export function createXAIProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('xai', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('xai');
}

/**
 * Create Perplexity provider
 */
export function createPerplexityProvider(config?: LegacyProviderConfig): OpenAICompatibleProvider | null {
  if (config?.apiKey) {
    return OpenAICompatibleProvider.fromProviderIdWithKey('perplexity', config.apiKey);
  }
  return OpenAICompatibleProvider.fromProviderId('perplexity');
}

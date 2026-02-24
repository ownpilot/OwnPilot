/**
 * OpenAI Provider
 *
 * OpenAI-compatible provider implementation (works with OpenAI, Azure, local models).
 */

import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import type { Result } from '../../types/result.js';
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TokenUsage,
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
import { desanitizeToolName } from '../tool-namespace.js';

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
  };
  delta?: {
    content?: string;
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

interface OpenAIModelsResponse {
  data?: Array<{ id: string }>;
}

/**
 * OpenAI-compatible provider (works with OpenAI, Azure, local models)
 */
export class OpenAIProvider extends BaseProvider {
  readonly type: AIProvider = 'openai';

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? 'https://api.openai.com/v1',
    });
  }

  isReady(): boolean {
    return !!this.config.apiKey;
  }

  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    if (!this.isReady()) {
      return err(new ValidationError('OpenAI API key not configured'));
    }

    const body = {
      model: request.model.model,
      messages: this.buildMessages(request.messages),
      max_tokens: request.model.maxTokens,
      temperature: request.model.temperature,
      top_p: request.model.topP,
      frequency_penalty: request.model.frequencyPenalty,
      presence_penalty: request.model.presencePenalty,
      stop: request.model.stop,
      tools: this.buildTools(request),
      tool_choice: request.toolChoice,
      response_format:
        request.model.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      user: request.user,
      stream: false,
    };

    const endpoint = `${this.config.baseUrl}/chat/completions`;

    // Log request with payload breakdown
    const debugInfo = buildRequestDebugInfo(
      'openai',
      request.model.model,
      endpoint,
      request.messages,
      request.tools,
      request.model.maxTokens,
      request.model.temperature,
      false
    );
    debugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
    logRequest(debugInfo);

    const startTime = Date.now();

    // Use retry wrapper for the actual API call
    const result = await withRetry(async () => {
      try {
        const response = await fetch(endpoint, this.createFetchOptions(body));
        this.clearRequestTimeout();

        if (!response.ok) {
          const errorText = await response.text();
          const error = new InternalError(`OpenAI API error: ${response.status} - ${errorText}`);
          logError('openai', error, `HTTP ${response.status}`);
          return err(error);
        }

        const data = (await response.json()) as OpenAIResponse;
        const choice = data.choices?.[0];

        if (!choice) {
          const error = new InternalError('No response from OpenAI');
          logError('openai', error, 'Empty response');
          return err(error);
        }

        const toolCalls = this.parseToolCalls(choice.message?.tool_calls);
        const completionResponse: CompletionResponse = {
          id: data.id ?? '',
          content: choice.message?.content ?? '',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          finishReason: this.mapFinishReason(choice.finish_reason ?? 'stop'),
          usage: data.usage ? this.mapUsage(data.usage) : undefined,
          model: data.model ?? request.model.model,
          createdAt: new Date((data.created ?? Date.now() / 1000) * 1000),
        };

        // Log response
        logResponse(
          buildResponseDebugInfo('openai', completionResponse.model, Date.now() - startTime, {
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
          const timeoutError = new TimeoutError('OpenAI request', this.config.timeout ?? 300000);
          logError('openai', timeoutError, 'Request timeout');
          return err(timeoutError);
        }
        const internalError = new InternalError(`OpenAI request failed: ${getErrorMessage(error)}`);
        logError('openai', internalError, 'Request exception');
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
      yield err(new InternalError('OpenAI API key not configured'));
      return;
    }

    const body = {
      model: request.model.model,
      messages: this.buildMessages(request.messages),
      max_tokens: request.model.maxTokens,
      temperature: request.model.temperature,
      tools: this.buildTools(request),
      tool_choice: request.toolChoice,
      stream: true,
      stream_options: { include_usage: true },
    };

    // Log streaming request with payload breakdown
    const streamDebugInfo = buildRequestDebugInfo(
      'openai',
      request.model.model,
      `${this.config.baseUrl}/chat/completions`,
      request.messages,
      request.tools,
      request.model.maxTokens,
      request.model.temperature,
      true
    );
    streamDebugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
    logRequest(streamDebugInfo);

    try {
      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        this.createFetchOptions(body)
      );
      this.clearRequestTimeout();

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        const maskedKey = this.config.apiKey
          ? `${this.config.apiKey.slice(0, 6)}...${this.config.apiKey.slice(-4)}`
          : '(none)';
        const detail = [
          `status=${response.status}`,
          `url=${this.config.baseUrl}/chat/completions`,
          `key=${maskedKey}`,
          errorText ? `body=${errorText}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        logError('openai', new InternalError(`Stream error: ${detail}`), `HTTP ${response.status}`);
        yield err(
          new InternalError(`OpenAI stream error: ${response.status}${errorText ? ` - ${errorText}` : ''}`)
        );
        return;
      }

      const reader = response.body.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = '';

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

              yield ok({
                id: parsed.id ?? '',
                content: delta.content,
                toolCalls: delta.tool_calls?.map((tc) => ({
                  id: tc.id,
                  name: tc.function?.name ? desanitizeToolName(tc.function.name) : undefined,
                  arguments: tc.function?.arguments,
                  index: (tc as { index?: number }).index,
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
        try {
          await reader.cancel();
        } catch {
          /* already released */
        }
      }
    } catch (error) {
      yield err(new InternalError(`OpenAI stream failed: ${getErrorMessage(error)}`));
    }
  }

  async getModels(): Promise<Result<string[], InternalError>> {
    if (!this.isReady()) {
      return err(new InternalError('OpenAI API key not configured'));
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        return err(new InternalError(`Failed to fetch models: ${response.status}`));
      }

      const data = (await response.json()) as OpenAIModelsResponse;
      const models = data.data?.map((m) => m.id) ?? [];

      return ok(models);
    } catch (error) {
      return err(new InternalError(`Failed to fetch models: ${getErrorMessage(error)}`));
    }
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
  }): TokenUsage | undefined {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    };
  }
}

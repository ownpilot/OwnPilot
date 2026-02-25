/**
 * Google AI (Gemini) Provider
 *
 * Config-driven implementation for Google's Gemini models.
 * Configuration loaded from ./configs/google.json
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import { getLog } from '../../services/get-log.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { generateId } from '../../services/id-utils.js';
import { sanitizeToolName, desanitizeToolName } from '../tool-namespace.js';

const log = getLog('Google');
import type {
  ProviderConfig as LegacyProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  AIProvider,
  ToolCall,
  Message,
} from '../types.js';
import {
  loadProviderConfig,
  resolveProviderConfig,
  type ProviderConfig,
  type ResolvedProviderConfig,
} from './configs/index.js';
import {
  logRequest,
  logResponse,
  logRetry,
  buildRequestDebugInfo,
  buildResponseDebugInfo,
  calculatePayloadBreakdown,
} from '../debug.js';

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: ['AbortError', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'],
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/** Safely parse tool call arguments JSON, returning {} on failure */
function safeParseToolArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

/**
 * Schema-level keywords that Gemini does NOT support and that are unambiguously
 * schema keywords (never valid as user-defined property names inside `properties`).
 * Conservative list — only strip what actually causes 400 errors.
 */
const UNSUPPORTED_GEMINI_SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$ref',
  '$id',
  '$comment',
  '$defs',
  'additionalProperties',
  'patternProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'definitions',
  'dependentSchemas',
  'dependentRequired',
  'contentMediaType',
  'contentEncoding',
]);

/**
 * Recursively strip fields that Gemini doesn't understand from a JSON Schema object.
 * Returns a cleaned copy (does not mutate the original).
 *
 * IMPORTANT: Inside a `properties` map, keys are user-defined property names
 * (e.g., "title", "default", "pattern") — these must NEVER be stripped.
 * Only strip schema-level keywords from schema objects themselves.
 *
 * @param schema - The schema (or sub-schema) to sanitize
 * @param insidePropertiesMap - true when processing the direct children of a `properties` object
 */
function sanitizeGeminiSchema(schema: unknown, insidePropertiesMap = false): unknown {
  if (schema === null || schema === undefined) return schema;
  if (typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map((item) => sanitizeGeminiSchema(item));

  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Inside `properties`, keys are user-defined names — never strip them
    if (!insidePropertiesMap && UNSUPPORTED_GEMINI_SCHEMA_KEYWORDS.has(key)) continue;

    // When entering `properties`, mark children as property-name keys
    result[key] =
      key === 'properties' && typeof value === 'object' && value !== null && !Array.isArray(value)
        ? sanitizeGeminiSchema(value, true)
        : sanitizeGeminiSchema(value);
  }

  return result;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini API response types
 */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean; // For thinking models
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
        // Thought signature is required for Gemini 3+ thinking models when using function calls
        // Must be echoed back in functionResponse
        // API uses camelCase: thoughtSignature
        thoughtSignature?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number; // For thinking models
  };
}

/**
 * Google AI Provider for Gemini models
 *
 * Supports:
 * - Gemini 2.0 Flash (with thinking capabilities)
 * - Gemini 1.5 Pro/Flash
 * - Function calling
 * - Vision
 * - Streaming
 */
export class GoogleProvider {
  readonly type: AIProvider = 'google';
  private readonly providerId = 'google';
  private readonly config: ResolvedProviderConfig;
  private abortController: AbortController | null = null;
  private abortTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
  }

  /**
   * Create provider from environment (loads config from JSON)
   */
  static fromEnv(): GoogleProvider | null {
    const resolvedConfig = resolveProviderConfig('google');
    if (!resolvedConfig) {
      return null;
    }
    return new GoogleProvider(resolvedConfig);
  }

  /**
   * Create provider with explicit API key
   */
  static withApiKey(apiKey: string): GoogleProvider | null {
    const config = loadProviderConfig('google');
    if (!config) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeyEnv, ...rest } = config;
    return new GoogleProvider({ ...rest, apiKey });
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
    return !!this.config.apiKey;
  }

  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    if (!this.isReady()) {
      return err(new ValidationError('Google API key not configured'));
    }

    const model = request.model.model || this.getDefaultModel();
    if (!model) {
      return err(new ValidationError('No model specified'));
    }

    // Retry loop with exponential backoff
    let lastError: Error | null = null;
    let delay = RETRY_CONFIG.initialDelayMs;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      const result = await this.executeRequest(request, model, attempt);

      if (result.ok) {
        return result;
      }

      // Check if error is retryable
      const error = result.error;
      const isRetryable = this.isRetryableError(error);

      if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
        return result;
      }

      // Log retry attempt
      lastError = error;
      logRetry(attempt, RETRY_CONFIG.maxRetries, error, delay);
      log.info(`Retry ${attempt}/${RETRY_CONFIG.maxRetries} after ${delay}ms - ${error.message}`);

      // Wait before retry
      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }

    // Should not reach here, but just in case
    return err(
      new InternalError(
        `Google request failed after ${RETRY_CONFIG.maxRetries} retries: ${lastError?.message}`
      )
    );
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    // Timeout errors are retryable
    if (error instanceof TimeoutError) return true;
    if (error.name === 'AbortError') return true;

    // Network errors are retryable
    const errorName = error.name || '';
    const errorMessage = error.message || '';

    for (const retryableError of RETRY_CONFIG.retryableErrors) {
      if (errorName.includes(retryableError) || errorMessage.includes(retryableError)) {
        return true;
      }
    }

    // Check for retryable status codes in error message
    for (const statusCode of RETRY_CONFIG.retryableStatusCodes) {
      if (errorMessage.includes(`${statusCode}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Execute a single request attempt
   */
  private async executeRequest(
    request: CompletionRequest,
    model: string,
    attempt: number
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    const body = this.buildGeminiRequest(request);
    const startTime = Date.now();
    const endpoint = `${this.config.baseUrl}/models/${model}:generateContent`;

    // Log request with debug system (only on first attempt to avoid spam)
    if (attempt === 1) {
      const googleDebugInfo = buildRequestDebugInfo(
        'google',
        model,
        endpoint,
        request.messages,
        request.tools,
        request.model.maxTokens,
        request.model.temperature,
        request.stream ?? false
      );
      googleDebugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
      logRequest(googleDebugInfo);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey!,
        },
        body: JSON.stringify(body),
        signal: this.createAbortSignal(),
      });

      const durationMs = Date.now() - startTime;

      // Clear the timeout since the request completed (success or error response)
      this.clearAbortTimeout();

      if (!response.ok) {
        const errorText = await response.text();
        logResponse(
          buildResponseDebugInfo('google', model, durationMs, {
            error: `${response.status} - ${errorText}`,
          })
        );

        // Create appropriate error for retry logic
        const error = new InternalError(`Google API error: ${response.status} - ${errorText}`);
        return err(error);
      }

      const data = (await response.json()) as GeminiResponse;
      const candidate = data.candidates?.[0];

      if (!candidate?.content?.parts) {
        return err(new InternalError('No response from Google'));
      }

      let textContent = '';
      let thinkingContent = '';
      const toolCalls: ToolCall[] = [];

      for (const part of candidate.content.parts) {
        if (part.text) {
          // Separate thinking content from regular content
          if (part.thought) {
            thinkingContent += part.text;
          } else {
            textContent += part.text;
          }
        }
        if (part.functionCall) {
          toolCalls.push({
            id: generateId('call'),
            name: desanitizeToolName(part.functionCall.name),
            arguments: JSON.stringify(part.functionCall.args ?? {}),
            // Capture thoughtSignature for Gemini 3+ thinking models
            metadata: part.thoughtSignature
              ? { thoughtSignature: part.thoughtSignature }
              : undefined,
          });
        }
      }

      // Include thinking in response if present
      const finalContent = thinkingContent
        ? `<thinking>\n${thinkingContent}\n</thinking>\n\n${textContent}`
        : textContent;

      const finishReason = this.mapFinishReason(candidate.finishReason ?? 'STOP');
      const usage = data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount ?? 0,
            completionTokens:
              (data.usageMetadata.candidatesTokenCount ?? 0) +
              (data.usageMetadata.thoughtsTokenCount ?? 0),
            totalTokens: data.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined;

      // Log successful response
      logResponse(
        buildResponseDebugInfo('google', model, durationMs, {
          content: finalContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          finishReason,
          usage,
        })
      );

      return ok({
        id: `gemini_${Date.now()}`,
        content: finalContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason,
        usage,
        model,
        createdAt: new Date(),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        // Clear the timeout since we're handling the abort
        this.clearAbortTimeout();
        const timeout = this.config.timeout ?? 30000;
        logResponse(
          buildResponseDebugInfo('google', model, elapsed, {
            error: `TIMEOUT: Request aborted after ${elapsed}ms (timeout: ${timeout}ms, attempt ${attempt})`,
          })
        );
        return err(new TimeoutError('Google request', timeout));
      }

      // Clear the timeout for other errors too
      this.clearAbortTimeout();

      const errorMessage = getErrorMessage(error);
      logResponse(
        buildResponseDebugInfo('google', model, elapsed, {
          error: `${errorMessage} (attempt ${attempt})`,
        })
      );

      return err(new InternalError(`Google request failed: ${errorMessage}`));
    }
  }

  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    if (!this.isReady()) {
      yield err(new InternalError('Google API key not configured'));
      return;
    }

    const model = request.model.model || this.getDefaultModel();
    if (!model) {
      yield err(new InternalError('No model specified'));
      return;
    }

    const url = `${this.config.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;
    const body = this.buildGeminiRequest(request);

    // Log streaming request with payload breakdown
    const googleStreamDebugInfo = buildRequestDebugInfo(
      'google',
      model,
      url,
      request.messages,
      request.tools,
      request.model.maxTokens,
      request.model.temperature,
      true
    );
    googleStreamDebugInfo.payload = calculatePayloadBreakdown(body as Record<string, unknown>);
    logRequest(googleStreamDebugInfo);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey!,
        },
        body: JSON.stringify(body),
        signal: this.createAbortSignal(),
      });

      // Clear the timeout once we have a response
      this.clearAbortTimeout();

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        yield err(
          new InternalError(
            `Google stream error: ${response.status}${errorText ? ` - ${errorText}` : ''}`
          )
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
            if (!data) continue;

            try {
              const parsed = JSON.parse(data) as GeminiResponse;
              const candidate = parsed.candidates?.[0];

              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (part.text) {
                    yield ok({
                      id: `gemini_${Date.now()}`,
                      content: part.text,
                      metadata: part.thought ? { type: 'thinking' } : undefined,
                      done: false,
                    });
                  }
                  if (part.functionCall) {
                    yield ok({
                      id: `call_${Date.now()}`,
                      toolCalls: [
                        {
                          id: `call_${Date.now()}`,
                          name: desanitizeToolName(part.functionCall.name),
                          arguments: JSON.stringify(part.functionCall.args ?? {}),
                          // Capture thoughtSignature for Gemini 3+ thinking models
                          metadata: part.thoughtSignature
                            ? { thoughtSignature: part.thoughtSignature }
                            : undefined,
                        },
                      ],
                      done: false,
                    });
                  }
                }
              }

              if (candidate?.finishReason) {
                yield ok({
                  id: `gemini_${Date.now()}`,
                  done: true,
                  finishReason: this.mapFinishReason(candidate.finishReason),
                  usage: parsed.usageMetadata
                    ? {
                        promptTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                        completionTokens:
                          (parsed.usageMetadata.candidatesTokenCount ?? 0) +
                          (parsed.usageMetadata.thoughtsTokenCount ?? 0),
                        totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
                      }
                    : undefined,
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
      this.clearAbortTimeout();
      yield err(new InternalError(`Google stream failed: ${getErrorMessage(error)}`));
    }
  }

  /**
   * Get models from JSON config
   */
  async getModels(): Promise<Result<string[], InternalError>> {
    const models = this.config.models.map((m) => m.id);
    return ok(models);
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private createAbortSignal(): AbortSignal {
    // Clear any pending timeout from previous request to prevent it from
    // aborting this new request (fixes race condition bug)
    this.clearAbortTimeout();

    this.abortController = new AbortController();
    // 30 second timeout per attempt - with 3 retries this gives ~90s total
    const timeout = this.config.timeout ?? 30000;

    this.abortTimeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    return this.abortController.signal;
  }

  /**
   * Clear the abort timeout to prevent race conditions between requests
   */
  private clearAbortTimeout(): void {
    if (this.abortTimeoutId !== null) {
      clearTimeout(this.abortTimeoutId);
      this.abortTimeoutId = null;
    }
  }

  private buildGeminiRequest(request: CompletionRequest) {
    // Extract system instruction
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    // Gemini API requires `contents` to be non-empty. If only a system message
    // exists (or messages are empty entirely), inject a minimal user turn so the
    // request doesn't get rejected with INVALID_ARGUMENT.
    const contents = this.buildGeminiContents(otherMessages);
    if (contents.length === 0) {
      log.warn('Empty contents for Gemini request — injecting minimal user turn');
      contents.push({ role: 'user', parts: [{ text: '(start)' }] });
    }

    const geminiRequest: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.model.maxTokens,
        temperature: request.model.temperature,
        topP: request.model.topP,
        stopSequences: request.model.stop as string[] | undefined,
      },
    };

    // System instruction
    if (systemMessage) {
      geminiRequest.systemInstruction = {
        parts: [
          {
            text:
              typeof systemMessage.content === 'string'
                ? systemMessage.content
                : systemMessage.content
                    .filter((c) => c.type === 'text')
                    .map((c) => (c as { text: string }).text)
                    .join('\n'),
          },
        ],
      };
    }

    // Tools (if supported)
    if (this.config.features.toolUse) {
      const tools = this.buildGeminiTools(request);
      if (tools) {
        geminiRequest.tools = tools;
      }
    }

    return geminiRequest;
  }

  private buildGeminiContents(messages: readonly Message[]) {
    // Build maps of tool call IDs to their thoughtSignatures and function names
    const toolCallSignatures = new Map<string, string>();
    const toolCallNames = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          // Map toolCallId → function name (for functionResponse.name)
          toolCallNames.set(tc.id, tc.name);

          const signature = tc.metadata?.thoughtSignature;
          if (typeof signature === 'string') {
            toolCallSignatures.set(tc.id, signature);
            // Also map by name in case toolCallId uses name
            toolCallSignatures.set(tc.name, signature);
          }
        }
      }
    }

    return messages
      .filter((m) => m.role !== 'system')
      .map((msg) => {
        const parts: Array<Record<string, unknown>> = [];

        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else {
          for (const part of msg.content) {
            if (part.type === 'text') {
              parts.push({ text: part.text });
            } else if (part.type === 'image' && this.config.features.vision) {
              // Gemini supports inline image data
              if (part.isUrl) {
                // For URL images, we'd need to fetch and convert
                // For now, add a placeholder
                parts.push({ text: `[Image: ${part.data}]` });
              } else {
                parts.push({
                  inlineData: {
                    mimeType: part.mediaType,
                    data: part.data,
                  },
                });
              }
            }
          }
        }

        // Handle tool results
        if (msg.role === 'tool' && msg.toolResults) {
          for (const result of msg.toolResults) {
            const functionResponsePart: Record<string, unknown> = {
              functionResponse: {
                name: sanitizeToolName(toolCallNames.get(result.toolCallId) ?? result.toolCallId),
                response: { result: result.content },
              },
            };

            // Include thoughtSignature if available (required for Gemini 3+ thinking models)
            const signature = toolCallSignatures.get(result.toolCallId);
            if (signature) {
              functionResponsePart.thoughtSignature = signature;
            }

            parts.push(functionResponsePart);
          }
        }

        // Handle tool calls from assistant
        if (msg.role === 'assistant' && msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            const functionCallPart: Record<string, unknown> = {
              functionCall: {
                name: sanitizeToolName(tc.name),
                args: safeParseToolArgs(tc.arguments),
              },
            };

            // Include thoughtSignature if present (required for Gemini thinking models)
            const signature = tc.metadata?.thoughtSignature;
            if (typeof signature === 'string') {
              functionCallPart.thoughtSignature = signature;
            }
            // Note: thoughtSignature is only provided by thinking models (gemini-*-thinking-*)
            // Non-thinking models won't have this, and that's expected behavior

            parts.push(functionCallPart);
          }
        }

        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });
  }

  private buildGeminiTools(request: CompletionRequest) {
    if (!request.tools?.length) return undefined;

    return [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: sanitizeToolName(tool.name),
          description: tool.description,
          parameters: sanitizeGeminiSchema(tool.parameters),
        })),
      },
    ];
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'BLOCKLIST':
        return 'content_filter';
      case 'FUNCTION_CALL':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

/**
 * Create Google provider from environment
 */
export function createGoogleProvider(config?: LegacyProviderConfig): GoogleProvider | null {
  if (config?.apiKey) {
    return GoogleProvider.withApiKey(config.apiKey);
  }
  return GoogleProvider.fromEnv();
}

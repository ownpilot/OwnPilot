/**
 * Google AI (Gemini) Provider
 *
 * Config-driven implementation for Google's Gemini models.
 * Configuration loaded from ./configs/google.json
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
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
  getProviderConfig,
  resolveProviderConfig,
  type ProviderConfig,
  type ResolvedProviderConfig,
} from './configs/index.js';

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
    const config = getProviderConfig('google');
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
    return getProviderConfig(this.providerId);
  }

  /**
   * Get default model for this provider
   */
  getDefaultModel(): string | undefined {
    return this.config.models.find(m => m.default)?.id ?? this.config.models[0]?.id;
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

    const url = `${this.config.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;
    const body = this.buildGeminiRequest(request);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.createAbortSignal(),
      });

      if (!response.ok) {
        const error = await response.text();
        return err(new InternalError(`Google API error: ${response.status} - ${error}`));
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
          // Debug: Log thoughtSignature capture
          if (part.thoughtSignature) {
            console.log('[Google] Captured thoughtSignature for function call:', part.functionCall.name, part.thoughtSignature.substring(0, 50) + '...');
          } else {
            console.warn('[Google] No thoughtSignature received for function call:', part.functionCall.name);
          }
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
            // Capture thoughtSignature for Gemini 3+ thinking models
            metadata: part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : undefined,
          });
        }
      }

      // Include thinking in response if present
      const finalContent = thinkingContent
        ? `<thinking>\n${thinkingContent}\n</thinking>\n\n${textContent}`
        : textContent;

      return ok({
        id: `gemini_${Date.now()}`,
        content: finalContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: this.mapFinishReason(candidate.finishReason ?? 'STOP'),
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount ?? 0,
              completionTokens: (data.usageMetadata.candidatesTokenCount ?? 0) +
                               (data.usageMetadata.thoughtsTokenCount ?? 0),
              totalTokens: data.usageMetadata.totalTokenCount ?? 0,
            }
          : undefined,
        model,
        createdAt: new Date(),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new TimeoutError('Google request', this.config.timeout ?? 300000));
      }
      return err(
        new InternalError(`Google request failed: ${error instanceof Error ? error.message : String(error)}`)
      );
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

    const url = `${this.config.baseUrl}/models/${model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`;
    const body = this.buildGeminiRequest(request);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.createAbortSignal(),
      });

      if (!response.ok || !response.body) {
        yield err(new InternalError(`Google stream error: ${response.status}`));
        return;
      }

      const reader = response.body.getReader();
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
                  // Debug: Log thoughtSignature capture in streaming
                  if (part.thoughtSignature) {
                    console.log('[Google Stream] Captured thoughtSignature for function call:', part.functionCall.name, part.thoughtSignature.substring(0, 50) + '...');
                  } else {
                    console.warn('[Google Stream] No thoughtSignature received for function call:', part.functionCall.name);
                  }
                  yield ok({
                    id: `gemini_${Date.now()}`,
                    toolCalls: [{
                      id: `call_${Date.now()}`,
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args),
                      // Capture thoughtSignature for Gemini 3+ thinking models
                      metadata: part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : undefined,
                    }],
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
                      completionTokens: (parsed.usageMetadata.candidatesTokenCount ?? 0) +
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
    } catch (error) {
      yield err(
        new InternalError(`Google stream failed: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }

  /**
   * Get models from JSON config
   */
  async getModels(): Promise<Result<string[], InternalError>> {
    const models = this.config.models.map(m => m.id);
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
    this.abortController = new AbortController();
    const timeout = this.config.timeout ?? 120000;

    setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    return this.abortController.signal;
  }

  private buildGeminiRequest(request: CompletionRequest) {
    // Extract system instruction
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const geminiRequest: Record<string, unknown> = {
      contents: this.buildGeminiContents(otherMessages),
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
    // Build a map of tool call IDs to their thoughtSignatures for looking up when building responses
    const toolCallSignatures = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
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
                name: result.toolCallId,
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
                name: tc.name,
                args: JSON.parse(tc.arguments || '{}'),
              },
            };

            // Include thoughtSignature if present (for Gemini 3+ thinking models)
            const signature = tc.metadata?.thoughtSignature;
            if (typeof signature === 'string') {
              functionCallPart.thoughtSignature = signature;
              console.log('[Google Build] Including thoughtSignature for function call:', tc.name);
            } else {
              console.warn('[Google Build] Missing thoughtSignature for function call:', tc.name, 'metadata:', JSON.stringify(tc.metadata));
            }

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
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
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

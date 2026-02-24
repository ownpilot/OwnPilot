/**
 * AI Provider interface
 *
 * Public contract that all AI providers implement.
 */

import type { Result } from '../types/result.js';
import type { InternalError, TimeoutError, ValidationError } from '../types/errors.js';
import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  AIProvider,
} from './types.js';

/**
 * Provider interface - all AI providers implement this
 */
export interface IProvider {
  /** Provider type */
  readonly type: AIProvider;

  /** Check if provider is configured and ready */
  isReady(): boolean;

  /** Complete a chat request */
  complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>>;

  /** Stream a chat completion */
  stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown>;

  /** Count tokens in messages (approximate) */
  countTokens(messages: readonly Message[]): number;

  /** Get available models */
  getModels(): Promise<Result<string[], InternalError>>;
}

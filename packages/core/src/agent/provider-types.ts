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
 * Provider health check result
 */
export interface ProviderHealthResult {
  /** Provider identifier */
  providerId: string;
  /** Whether the provider is reachable */
  status: 'ok' | 'unavailable';
  /** Latency in milliseconds (undefined if unreachable) */
  latencyMs?: number;
  /** Error message (undefined if ok) */
  error?: string;
  /** Timestamp of the check */
  checkedAt: Date;
}

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

  /**
   * Health check - verify provider is reachable and responsive.
   * Called at boot to detect unavailable providers early.
   */
  healthCheck(): Promise<Result<ProviderHealthResult, InternalError>>;
}

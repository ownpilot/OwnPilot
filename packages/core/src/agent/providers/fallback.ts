/**
 * Fallback Provider
 *
 * Automatically tries alternative providers when the primary one fails.
 * This provides resilience against provider outages or rate limits.
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  AIProvider,
} from '../types.js';
import { type IProvider, createProvider } from '../provider.js';
import { logError, logRetry } from '../debug.js';

/**
 * Fallback provider configuration
 */
export interface FallbackProviderConfig {
  /** Primary provider configuration */
  primary: ProviderConfig;
  /** Fallback provider configurations (in priority order) */
  fallbacks: ProviderConfig[];
  /** Whether to enable fallback (default: true) */
  enableFallback?: boolean;
  /** Callback when fallback is triggered */
  onFallback?: (
    failedProvider: AIProvider,
    error: Error,
    nextProvider: AIProvider
  ) => void;
}

/**
 * Fallback provider that automatically tries alternative providers on failure
 */
export class FallbackProvider implements IProvider {
  readonly type: AIProvider;
  private readonly primary: IProvider;
  private readonly fallbacks: IProvider[];
  private readonly config: FallbackProviderConfig;
  private currentProviderIndex: number = 0;

  constructor(config: FallbackProviderConfig) {
    this.config = {
      enableFallback: true,
      ...config,
    };

    this.primary = createProvider(config.primary);
    this.type = config.primary.provider;
    this.fallbacks = config.fallbacks.map((fc) => createProvider(fc));
  }

  /**
   * Get all providers in order (primary + fallbacks)
   */
  private getAllProviders(): IProvider[] {
    return [this.primary, ...this.fallbacks];
  }

  /**
   * Check if any provider is ready
   */
  isReady(): boolean {
    return this.getAllProviders().some((p) => p.isReady());
  }

  /**
   * Complete request with automatic fallback
   */
  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    const providers = this.getAllProviders().filter((p) => p.isReady());

    if (providers.length === 0) {
      return err(new ValidationError('No providers are configured or ready'));
    }

    // If fallback is disabled, just use primary
    if (!this.config.enableFallback) {
      return this.primary.complete(request);
    }

    let lastError: InternalError | TimeoutError | ValidationError | null = null;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      if (!provider) continue;

      this.currentProviderIndex = i;

      try {
        console.log(`\n🔄 [Fallback] Trying provider ${i + 1}/${providers.length}: ${provider.type}`);

        const result = await provider.complete(request);

        if (result.ok) {
          if (i > 0) {
            // We used a fallback provider successfully
            console.log(`✅ [Fallback] Success with fallback provider: ${provider.type}`);
          }
          return result;
        }

        // Request failed
        lastError = result.error;
        const errorMessage = result.error.message;

        console.log(`❌ [Fallback] Provider ${provider.type} failed: ${errorMessage}`);
        logError(provider.type, result.error, 'Fallback triggered');

        // Check if we should try next provider
        if (i < providers.length - 1 && this.shouldFallback(result.error)) {
          const nextProvider = providers[i + 1];
          if (nextProvider) {
            console.log(`🔀 [Fallback] Switching to next provider: ${nextProvider.type}`);

            // Trigger callback
            if (this.config.onFallback) {
              this.config.onFallback(
                provider.type,
                result.error,
                nextProvider.type
              );
            }

            // Log retry/fallback
            logRetry(i + 1, providers.length, result.error, 0);
          }
        }
      } catch (error) {
        // Unexpected error during provider call
        const errorObj = error instanceof Error ? error : new Error(String(error));
        lastError = new InternalError(errorObj.message);
        console.log(`💥 [Fallback] Provider ${provider.type} threw exception: ${errorObj.message}`);
        logError(provider.type, errorObj, 'Exception during fallback');
      }
    }

    // All providers failed
    console.log(`\n❌ [Fallback] All ${providers.length} providers failed`);
    return err(lastError ?? new InternalError('All providers failed'));
  }

  /**
   * Stream with automatic fallback
   */
  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    const providers = this.getAllProviders().filter((p) => p.isReady());

    if (providers.length === 0) {
      yield err(new InternalError('No providers are configured or ready'));
      return;
    }

    // If fallback is disabled, just use primary
    if (!this.config.enableFallback) {
      yield* this.primary.stream(request);
      return;
    }

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      if (!provider) continue;

      this.currentProviderIndex = i;

      try {
        console.log(`\n🔄 [Fallback Stream] Trying provider ${i + 1}/${providers.length}: ${provider.type}`);

        let hasYielded = false;
        let hasError = false;
        let lastError: InternalError | null = null;

        const generator = provider.stream(request);

        for await (const result of generator) {
          if (!result.ok) {
            hasError = true;
            lastError = result.error;
            break;
          }

          hasYielded = true;
          yield result;

          // If we got a done chunk, we're finished
          if (result.value.done) {
            return;
          }
        }

        // If we yielded data and finished without error, we're done
        if (hasYielded && !hasError) {
          return;
        }

        // If error occurred, try next provider
        if (hasError && lastError) {
          console.log(`❌ [Fallback Stream] Provider ${provider.type} failed: ${lastError.message}`);

          if (i < providers.length - 1 && this.shouldFallback(lastError)) {
            const nextProvider = providers[i + 1];
            if (nextProvider) {
              console.log(`🔀 [Fallback Stream] Switching to next provider: ${nextProvider.type}`);

              if (this.config.onFallback) {
                this.config.onFallback(provider.type, lastError, nextProvider.type);
              }
            }
            continue;
          }

          // No more fallbacks, yield the error
          yield err(lastError);
          return;
        }
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.log(`💥 [Fallback Stream] Provider ${provider.type} threw exception: ${errorObj.message}`);

        if (i < providers.length - 1) {
          continue;
        }

        yield err(new InternalError(errorObj.message));
        return;
      }
    }

    yield err(new InternalError('All providers failed'));
  }

  /**
   * Count tokens using primary provider
   */
  countTokens(messages: readonly Message[]): number {
    return this.primary.countTokens(messages);
  }

  /**
   * Get models from all providers
   */
  async getModels(): Promise<Result<string[], InternalError>> {
    const allModels: string[] = [];
    const providers = this.getAllProviders().filter((p) => p.isReady());

    for (const provider of providers) {
      const result = await provider.getModels();
      if (result.ok) {
        allModels.push(...result.value);
      }
    }

    return ok([...new Set(allModels)]); // Deduplicate
  }

  /**
   * Determine if we should try the next provider based on the error
   */
  private shouldFallback(error: Error): boolean {
    // Always fallback on timeout
    if (error instanceof TimeoutError) {
      return true;
    }

    // Fallback on internal errors (typically API issues)
    if (error instanceof InternalError) {
      const message = error.message.toLowerCase();

      // Don't fallback on validation errors that would fail everywhere
      if (
        message.includes('invalid api key') ||
        message.includes('api key not configured') ||
        message.includes('not configured')
      ) {
        return false;
      }

      // Fallback on rate limits, server errors, timeouts, connection issues
      if (
        message.includes('timeout') ||
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('enotfound') ||
        message.includes('socket') ||
        message.includes('network')
      ) {
        return true;
      }

      // Default: try fallback for unknown errors
      return true;
    }

    // For validation errors, don't fallback (they'll fail everywhere)
    if (error instanceof ValidationError) {
      return false;
    }

    // Unknown error types: try fallback
    return true;
  }

  /**
   * Get the currently active provider type
   */
  getCurrentProvider(): AIProvider {
    const providers = this.getAllProviders();
    return providers[this.currentProviderIndex]?.type ?? this.type;
  }

  /**
   * Cancel request on all providers
   */
  cancel(): void {
    const providers = this.getAllProviders();
    for (const provider of providers) {
      if ('cancel' in provider && typeof provider.cancel === 'function') {
        provider.cancel();
      }
    }
  }
}

/**
 * Create a fallback provider from configuration
 */
export function createFallbackProvider(config: FallbackProviderConfig): FallbackProvider {
  return new FallbackProvider(config);
}

/**
 * Helper to create a provider with common fallbacks
 */
export function createProviderWithFallbacks(
  primary: ProviderConfig,
  options?: {
    fallbacks?: ProviderConfig[];
    enableFallback?: boolean;
    onFallback?: FallbackProviderConfig['onFallback'];
  }
): IProvider {
  // If no fallbacks provided, just return the primary provider
  if (!options?.fallbacks?.length) {
    return createProvider(primary);
  }

  return new FallbackProvider({
    primary,
    fallbacks: options.fallbacks,
    enableFallback: options.enableFallback ?? true,
    onFallback: options.onFallback,
  });
}

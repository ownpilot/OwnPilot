/**
 * Fallback Provider
 *
 * Automatically tries alternative providers when the primary one fails.
 * This provides resilience against provider outages or rate limits.
 */

import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import { getLog } from '../../services/get-log.js';

const log = getLog('Fallback');
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
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

/** Circuit breaker defaults */
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000; // 1 minute

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
  /** Consecutive failures before opening circuit (default: 5) */
  circuitBreakerThreshold?: number;
  /** Cooldown in ms before retesting an open circuit (default: 60000) */
  circuitBreakerCooldown?: number;
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
  private readonly circuits = new Map<string, CircuitBreakerEntry>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(config: FallbackProviderConfig) {
    this.config = {
      enableFallback: true,
      ...config,
    };

    this.primary = createProvider(config.primary);
    this.type = config.primary.provider;
    this.fallbacks = config.fallbacks.map((fc) => createProvider(fc));
    this.failureThreshold = config.circuitBreakerThreshold ?? CIRCUIT_FAILURE_THRESHOLD;
    this.cooldownMs = config.circuitBreakerCooldown ?? CIRCUIT_COOLDOWN_MS;
  }

  // ── Circuit Breaker ─────────────────────────────────────────────

  private getCircuit(providerType: string): CircuitBreakerEntry {
    let entry = this.circuits.get(providerType);
    if (!entry) {
      entry = { state: 'closed', failureCount: 0, lastFailureTime: 0, lastSuccessTime: 0 };
      this.circuits.set(providerType, entry);
    }
    return entry;
  }

  /** Returns true if the provider should be skipped */
  private isCircuitOpen(provider: IProvider): boolean {
    const circuit = this.getCircuit(provider.type);
    if (circuit.state === 'closed') return false;
    if (circuit.state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      if (Date.now() - circuit.lastFailureTime >= this.cooldownMs) {
        circuit.state = 'half-open';
        log.info(`CircuitBreaker ${provider.type}: open → half-open (cooldown elapsed)`);
        return false; // allow one test request
      }
      return true; // still open, skip
    }
    // half-open: allow request through
    return false;
  }

  private recordSuccess(provider: IProvider): void {
    const circuit = this.getCircuit(provider.type);
    if (circuit.state !== 'closed') {
      log.info(`CircuitBreaker ${provider.type}: ${circuit.state} → closed`);
    }
    circuit.state = 'closed';
    circuit.failureCount = 0;
    circuit.lastSuccessTime = Date.now();
  }

  private recordFailure(provider: IProvider): void {
    const circuit = this.getCircuit(provider.type);
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'half-open') {
      // Failed during test → re-open
      circuit.state = 'open';
      log.warn(`CircuitBreaker ${provider.type}: half-open → open (test failed)`);
    } else if (circuit.failureCount >= this.failureThreshold) {
      circuit.state = 'open';
      log.warn(`CircuitBreaker ${provider.type}: closed → open (${circuit.failureCount} consecutive failures)`);
    }
  }

  // ── Provider Access ───────────────────────────────────────────

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

      // Circuit breaker: skip providers whose circuit is open
      if (this.isCircuitOpen(provider)) {
        log.info(`Skipping ${provider.type} (circuit open)`);
        continue;
      }

      this.currentProviderIndex = i;

      try {
        log.info(`Trying provider ${i + 1}/${providers.length}: ${provider.type}`);

        const result = await provider.complete(request);

        if (result.ok) {
          this.recordSuccess(provider);
          if (i > 0) {
            log.info(`Success with fallback provider: ${provider.type}`);
          }
          return result;
        }

        // Request failed
        lastError = result.error;
        const errorMessage = result.error.message;

        log.warn(`Provider ${provider.type} failed: ${errorMessage}`);
        logError(provider.type, result.error, 'Fallback triggered');
        this.recordFailure(provider);

        // Check if we should try next provider
        if (i < providers.length - 1 && this.shouldFallback(result.error)) {
          const nextProvider = providers[i + 1];
          if (nextProvider) {
            log.info(`Switching to next provider: ${nextProvider.type}`);

            if (this.config.onFallback) {
              this.config.onFallback(
                provider.type,
                result.error,
                nextProvider.type
              );
            }

            logRetry(i + 1, providers.length, result.error, 0);
          }
        }
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        lastError = new InternalError(errorObj.message);
        log.error(`Provider ${provider.type} threw exception: ${errorObj.message}`);
        logError(provider.type, errorObj, 'Exception during fallback');
        this.recordFailure(provider);
      }
    }

    // All providers failed
    log.error(`All ${providers.length} providers failed`);
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

      // Circuit breaker: skip providers whose circuit is open
      if (this.isCircuitOpen(provider)) {
        log.info(`Stream: Skipping ${provider.type} (circuit open)`);
        continue;
      }

      this.currentProviderIndex = i;

      try {
        log.info(`Stream: Trying provider ${i + 1}/${providers.length}: ${provider.type}`);

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

          if (result.value.done) {
            this.recordSuccess(provider);
            return;
          }
        }

        // If we yielded data and finished without error, we're done
        if (hasYielded && !hasError) {
          this.recordSuccess(provider);
          return;
        }

        // If error occurred, try next provider
        if (hasError && lastError) {
          log.warn(`Stream: Provider ${provider.type} failed: ${lastError.message}`);
          this.recordFailure(provider);

          // If we already sent chunks to the client, do NOT retry with another
          // provider — the client would see duplicate/overlapping content.
          // Instead, signal the error and stop.
          if (hasYielded) {
            log.warn('Stream: Partial data already sent — cannot retry. Yielding error.');
            yield err(new InternalError(`Stream interrupted after partial data: ${lastError.message}`));
            return;
          }

          if (i < providers.length - 1 && this.shouldFallback(lastError)) {
            const nextProvider = providers[i + 1];
            if (nextProvider) {
              log.info(`Stream: Switching to next provider: ${nextProvider.type}`);

              if (this.config.onFallback) {
                this.config.onFallback(provider.type, lastError, nextProvider.type);
              }
            }
            continue;
          }

          yield err(lastError);
          return;
        }
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        log.error(`Stream: Provider ${provider.type} threw exception: ${errorObj.message}`);
        this.recordFailure(provider);

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

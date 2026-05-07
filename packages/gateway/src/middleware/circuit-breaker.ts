/**
 * Circuit Breaker Middleware
 *
 * Prevents cascading failures by temporarily rejecting requests to failing services.
 * Implements the standard circuit breaker pattern with CLOSED, OPEN, and HALF_OPEN states.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 */

import { createMiddleware } from 'hono/factory';
import { apiError, ERROR_CODES } from '../routes/helpers.js';
import { getLog } from '../services/log.js';
import { randomBytes } from 'node:crypto';

const log = getLog('CircuitBreaker');

function secureRandom(): number {
  return Number.parseInt(randomBytes(4).toString('hex'), 16) / 0xffffffff;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting to close (default: 30000) */
  resetTimeoutMs: number;
  /** Number of successes in HALF_OPEN to close (default: 2) */
  successThreshold: number;
  /** HTTP status codes that count as failures (default: [500, 502, 503, 504]) */
  failureStatusCodes: number[];
  /** Paths to exclude from circuit breaker (default: ['/health']) */
  excludePaths?: string[];
  /** Half-open request rate limit (percentage, 0-1) (default: 0.1) */
  halfOpenMaxRate?: number;
}

interface CircuitBreakerEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 2,
  failureStatusCodes: [500, 502, 503, 504],
  excludePaths: ['/health', '/api/v1/health'],
  halfOpenMaxRate: 0.1,
};

/**
 * In-memory store for circuit breaker states
 * Key: route path or service identifier
 */
const circuitStore = new Map<string, CircuitBreakerEntry>();

/**
 * Track active cleanup intervals for graceful shutdown
 */
const activeIntervals: Set<NodeJS.Timeout> = new Set();

/**
 * Stop all circuit breaker cleanup intervals (call on shutdown)
 */
export function stopAllCircuitBreakers(): void {
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  activeIntervals.clear();
}

/**
 * Get or create a circuit breaker entry for a key
 */
function getOrCreateEntry(key: string): CircuitBreakerEntry {
  let entry = circuitStore.get(key);
  if (!entry) {
    entry = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };
    circuitStore.set(key, entry);
  }
  return entry;
}

/**
 * Check if we should allow a request in HALF_OPEN state
 * (only allow a percentage of requests to test the service)
 */
function shouldAllowHalfOpenRequest(config: CircuitBreakerConfig): boolean {
  const maxRate = config.halfOpenMaxRate ?? 0.1;
  return secureRandom() < maxRate;
}

/**
 * Transition entry to OPEN state
 */
function openCircuit(entry: CircuitBreakerEntry, config: CircuitBreakerConfig, key: string): void {
  entry.state = 'OPEN';
  entry.nextAttemptTime = Date.now() + config.resetTimeoutMs;
  entry.successes = 0;
  log.warn(
    `[CircuitBreaker] Circuit OPENED for "${key}". Blocking requests for ${config.resetTimeoutMs}ms`
  );
}

/**
 * Transition entry to HALF_OPEN state
 */
function halfOpenCircuit(entry: CircuitBreakerEntry, key: string): void {
  entry.state = 'HALF_OPEN';
  entry.failures = 0;
  entry.successes = 0;
  log.info(`[CircuitBreaker] Circuit HALF_OPEN for "${key}". Testing recovery...`);
}

/**
 * Transition entry to CLOSED state
 */
function closeCircuit(entry: CircuitBreakerEntry, key: string): void {
  entry.state = 'CLOSED';
  entry.failures = 0;
  entry.successes = 0;
  log.info(`[CircuitBreaker] Circuit CLOSED for "${key}". Service recovered.`);
}

/**
 * Record a successful response
 */
function recordSuccess(
  entry: CircuitBreakerEntry,
  config: CircuitBreakerConfig,
  key: string
): void {
  if (entry.state === 'HALF_OPEN') {
    entry.successes++;
    if (entry.successes >= config.successThreshold) {
      closeCircuit(entry, key);
    }
  } else if (entry.state === 'CLOSED') {
    // Reset failures on success in CLOSED state
    entry.failures = 0;
  }
}

/**
 * Record a failed response
 */
function recordFailure(
  entry: CircuitBreakerEntry,
  config: CircuitBreakerConfig,
  key: string
): void {
  entry.failures++;
  entry.lastFailureTime = Date.now();

  if (entry.state === 'HALF_OPEN') {
    // Any failure in HALF_OPEN reopens immediately
    openCircuit(entry, config, key);
  } else if (entry.state === 'CLOSED' && entry.failures >= config.failureThreshold) {
    openCircuit(entry, config, key);
  }
}

/**
 * Create circuit breaker middleware
 *
 * Usage:
 * ```typescript
 * // Apply to specific routes
 * app.use('/api/v1/edge/*', createCircuitBreakerMiddleware({
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 * }));
 *
 * // Apply with custom config for external API calls
 * app.use('/api/v1/chat/*', createCircuitBreakerMiddleware({
 *   failureThreshold: 3,
 *   resetTimeoutMs: 60000,
 *   failureStatusCodes: [500, 502, 503, 504, 429],
 * }));
 * ```
 */
export function createCircuitBreakerMiddleware(userConfig?: Partial<CircuitBreakerConfig>) {
  const config: CircuitBreakerConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const failureStatusCodesSet = new Set(config.failureStatusCodes);
  const maxStoreSize = 1000;

  // Cleanup old entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of circuitStore.entries()) {
      // Clean up CLOSED entries that haven't failed recently
      if (entry.state === 'CLOSED' && now - entry.lastFailureTime > config.resetTimeoutMs * 2) {
        circuitStore.delete(key);
      }
      // Clean up if store is too large (keep most recently used)
      if (circuitStore.size > maxStoreSize) {
        const oldestKey = circuitStore.keys().next().value;
        if (oldestKey) {
          circuitStore.delete(oldestKey);
        }
      }
    }
  }, config.resetTimeoutMs);

  cleanupInterval.unref();
  activeIntervals.add(cleanupInterval);

  return createMiddleware(async (c, next) => {
    const path = c.req.path;

    // Check if path is excluded
    if (config.excludePaths?.some((p) => path.startsWith(p))) {
      return next();
    }

    // Use route path as circuit key, or custom key from context
    const circuitKey = c.get('circuitKey') ?? path;
    const entry = getOrCreateEntry(circuitKey);
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (entry.state === 'OPEN' && now >= entry.nextAttemptTime) {
      halfOpenCircuit(entry, circuitKey);
    }

    // If circuit is OPEN, reject immediately
    if (entry.state === 'OPEN') {
      const retryAfter = Math.ceil((entry.nextAttemptTime - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-Circuit-Breaker', 'OPEN');

      return apiError(
        c,
        {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: `Service temporarily unavailable. Please retry after ${retryAfter} seconds.`,
        },
        503
      );
    }

    // If circuit is HALF_OPEN, only allow limited traffic
    if (entry.state === 'HALF_OPEN' && !shouldAllowHalfOpenRequest(config)) {
      c.header('X-Circuit-Breaker', 'HALF_OPEN');
      c.header('Retry-After', '1');

      return apiError(
        c,
        {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: 'Service recovering. Please retry.',
        },
        503
      );
    }

    // Track if response was sent (to avoid double-processing)
    let responseSent = false;

    try {
      await next();
      responseSent = true;

      // Check response status
      const status = c.res?.status ?? 200;

      if (failureStatusCodesSet.has(status)) {
        recordFailure(entry, config, circuitKey);
      } else {
        recordSuccess(entry, config, circuitKey);
      }

      // Update header with final state (may have changed due to failure/success)
      c.header('X-Circuit-Breaker', entry.state);
    } catch (error) {
      if (!responseSent) {
        recordFailure(entry, config, circuitKey);
      }
      // Set header with current state even on error
      c.header('X-Circuit-Breaker', entry.state);
      throw error;
    }
  });
}

/**
 * Create a circuit breaker for specific service calls (non-middleware usage)
 *
 * Usage for wrapping external API calls:
 * ```typescript
 * const cb = createServiceCircuitBreaker('anthropic-api', {
 *   failureThreshold: 3,
 *   resetTimeoutMs: 60000,
 * });
 *
 * const result = await cb.execute(() => fetchAnthropicAPI(request));
 * ```
 */
export function createServiceCircuitBreaker(
  serviceName: string,
  userConfig?: Partial<CircuitBreakerConfig>
) {
  const config: CircuitBreakerConfig = { ...DEFAULT_CONFIG, ...userConfig };

  // Helper to get current entry from store (or create if reset)
  const getEntry = () => getOrCreateEntry(serviceName);

  return {
    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      const entry = getEntry();
      const now = Date.now();

      // Check if we should transition from OPEN to HALF_OPEN
      if (entry.state === 'OPEN' && now >= entry.nextAttemptTime) {
        halfOpenCircuit(entry, serviceName);
      }

      // If circuit is OPEN, reject immediately
      if (entry.state === 'OPEN') {
        const retryAfter = Math.ceil((entry.nextAttemptTime - now) / 1000);
        throw new CircuitBreakerError(
          `Service "${serviceName}" is unavailable. Retry after ${retryAfter}s`,
          retryAfter
        );
      }

      // If circuit is HALF_OPEN, only allow limited traffic
      if (entry.state === 'HALF_OPEN' && !shouldAllowHalfOpenRequest(config)) {
        throw new CircuitBreakerError(`Service "${serviceName}" is recovering. Please retry.`, 1);
      }

      try {
        const result = await fn();
        recordSuccess(getEntry(), config, serviceName);
        return result;
      } catch (error) {
        // Check if it's an HTTP error with failure status code
        if (error instanceof Response) {
          if (config.failureStatusCodes.includes(error.status)) {
            recordFailure(getEntry(), config, serviceName);
          }
        } else {
          // Network errors or exceptions count as failures
          recordFailure(getEntry(), config, serviceName);
        }
        throw error;
      }
    },

    /**
     * Get current circuit state
     */
    getState(): CircuitState {
      return getEntry().state;
    },

    /**
     * Force reset the circuit (for manual recovery)
     */
    reset(): void {
      closeCircuit(getEntry(), serviceName);
    },

    /**
     * Get statistics for the circuit
     */
    getStats(): { state: CircuitState; failures: number; successes: number } {
      const entry = getEntry();
      return {
        state: entry.state,
        failures: entry.failures,
        successes: entry.successes,
      };
    },
  };
}

/**
 * Error thrown when circuit breaker is OPEN
 */
export class CircuitBreakerError extends Error {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Get circuit breaker statistics for monitoring
 */
export function getCircuitBreakerStats(): Array<{
  key: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
}> {
  return Array.from(circuitStore.entries()).map(([key, entry]) => ({
    key,
    state: entry.state,
    failures: entry.failures,
    successes: entry.successes,
    lastFailureTime: entry.lastFailureTime,
  }));
}

/**
 * Reset all circuit breakers (for testing or manual recovery)
 */
export function resetAllCircuits(): void {
  circuitStore.clear();
}

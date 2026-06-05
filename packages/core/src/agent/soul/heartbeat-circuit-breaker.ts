/**
 * Heartbeat Circuit Breaker
 *
 * Per-agent circuit breaker that trips after consecutive task failures
 * and skips all tasks in runHeartbeat() when open, returning
 * skippedReason: 'circuit_open'.
 *
 * Unlike the HTTP middleware circuit breaker (gateway/middleware/circuit-breaker.ts),
 * this is stateful per-agent and is checked at the top of each heartbeat cycle.
 */

import { getLog } from '../../services/get-log.js';

const log = getLog('HeartbeatCircuitBreaker');

interface HeartbeatCircuitBreakerOptions {
  /** Consecutive failures before opening circuit (default: 3) */
  failureThreshold?: number;
  /** Cooldown in ms before attempting half-open (default: 60000) */
  cooldownMs?: number;
  /** Number of consecutive successes needed to close from half-open (default: 1) */
  successThreshold?: number;
}

const DEFAULT_OPTIONS: Required<HeartbeatCircuitBreakerOptions> = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  successThreshold: 1,
};

export type HeartbeatCircuitState = 'closed' | 'open' | 'half-open';

export interface HeartbeatCircuitSnapshot {
  state: HeartbeatCircuitState;
  failureCount: number;
  lastFailureAt: number;
  nextAttemptAt: number;
  consecutiveSuccesses: number;
}

/**
 * Heartbeat-level circuit breaker.
 * Thread-safe for use across async heartbeat cycles.
 */
export class HeartbeatCircuitBreaker {
  private _state: HeartbeatCircuitState = 'closed';
  private _failureCount = 0;
  private _lastFailureAt = 0;
  private _consecutiveSuccesses = 0;
  private readonly opts: Required<HeartbeatCircuitBreakerOptions>;

  constructor(options: HeartbeatCircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  get state(): HeartbeatCircuitState {
    return this._state;
  }

  get failureCount(): number {
    return this._failureCount;
  }

  /**
   * Check if circuit is open and should skip the cycle.
   * Automatically transitions open → half-open when cooldown elapses.
   */
  isOpen(): boolean {
    if (this._state === 'open') {
      if (Date.now() >= this._lastFailureAt + this.opts.cooldownMs) {
        this._transitionTo('half-open');
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Called at the start of runHeartbeat() — if open, returns true and the
   * caller should skip all tasks and return early with skippedReason: 'circuit_open'.
   */
  shouldSkipCycle(): boolean {
    return this.isOpen();
  }

  /**
   * Record a successful task. Resets failure count and keeps closed,
   * or advances half-open → closed.
   */
  recordSuccess(): void {
    if (this._state === 'half-open') {
      this._consecutiveSuccesses++;
      if (this._consecutiveSuccesses >= this.opts.successThreshold) {
        this._transitionTo('closed');
      }
    } else if (this._state === 'closed') {
      this._failureCount = 0;
    }
  }

  /**
   * Record a failed task. Increments failure count, may trip closed → open.
   * In half-open state, any failure immediately re-opens.
   */
  recordFailure(): void {
    this._failureCount++;
    this._lastFailureAt = Date.now();

    if (this._state === 'half-open') {
      this._transitionTo('open');
    } else if (this._state === 'closed' && this._failureCount >= this.opts.failureThreshold) {
      this._transitionTo('open');
    }
  }

  /**
   * Force-reset the circuit to closed state. Used for manual recovery or testing.
   */
  reset(): void {
    this._transitionTo('closed');
  }

  /**
   * Get a serializable snapshot for metrics events.
   */
  getSnapshot(): HeartbeatCircuitSnapshot {
    return {
      state: this._state,
      failureCount: this._failureCount,
      lastFailureAt: this._lastFailureAt,
      nextAttemptAt: this._lastFailureAt > 0 ? this._lastFailureAt + this.opts.cooldownMs : 0,
      consecutiveSuccesses: this._consecutiveSuccesses,
    };
  }

  private _transitionTo(newState: HeartbeatCircuitState): void {
    const prev = this._state;
    this._state = newState;

    if (newState === 'closed') {
      this._failureCount = 0;
      this._consecutiveSuccesses = 0;
    } else if (newState === 'half-open') {
      this._consecutiveSuccesses = 0;
    }

    log.info(`[CircuitBreaker] ${prev} → ${newState}`, {
      failureCount: this._failureCount,
      cooldownMs: this.opts.cooldownMs,
    });
  }
}

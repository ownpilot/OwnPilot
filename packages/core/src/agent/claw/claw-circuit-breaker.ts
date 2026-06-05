/**
 * Claw Circuit Breaker
 *
 * Per-claw circuit breaker. Tracks consecutive cycle failures and trips
 * the circuit open when the threshold is exceeded. A tripped circuit
 * causes the ClawManager to skip scheduling new cycles until the
 * cooldown elapses and a half-open probe succeeds.
 *
 * Shares the same state machine (closed → open → half-open → closed)
 * as HeartbeatCircuitBreaker but operates on clawId instead of agentId.
 */

import { getLog } from '../../services/get-log.js';

const log = getLog('ClawCircuitBreaker');

interface ClawCircuitBreakerOptions {
  /** Consecutive failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Cooldown in ms before attempting half-open (default: 60_000) */
  cooldownMs?: number;
  /** Number of consecutive successes needed to close from half-open (default: 1) */
  successThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ClawCircuitBreakerOptions> = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  successThreshold: 1,
};

export class ClawCircuitBreaker {
  private _state: 'closed' | 'open' | 'half-open' = 'closed';
  private _failureCount = 0;
  private _lastFailureAt = 0;
  private _consecutiveSuccesses = 0;
  private readonly opts: Required<ClawCircuitBreakerOptions>;

  constructor(options: ClawCircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  get state(): 'closed' | 'open' | 'half-open' {
    return this._state;
  }

  get failureCount(): number {
    return this._failureCount;
  }

  /**
   * Check if circuit is open. Automatically transitions open → half-open
   * when cooldown elapses.
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
   * Called at the start of a cycle — if open, caller should skip scheduling.
   */
  shouldSkipCycle(): boolean {
    return this.isOpen();
  }

  /**
   * Record a successful cycle. Resets failure count and advances half-open → closed.
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
   * Record a failed cycle. Increments failure count, may trip closed → open.
   * In half-open state, any failure immediately re-opens.
   */
  recordFailure(): void {
    this._failureCount++;
    this._lastFailureAt = Date.now();

    if (this._state === 'half-open') {
      this._transitionTo('open');
    } else if (this._state === 'closed' && this._failureCount >= this.opts.failureThreshold) {
      this._transitionTo('open');
      log.warn(
        `[ClawCircuitBreaker] Circuit opened after ${this._failureCount} consecutive failures`
      );
    }
  }

  /**
   * Force-reset the circuit to closed state.
   */
  reset(): void {
    this._transitionTo('closed');
  }

  /**
   * Get a serializable snapshot for metrics events.
   */
  getSnapshot(): import('./claw-types.js').ClawCircuitSnapshot {
    return {
      state: this._state,
      failureCount: this._failureCount,
      lastFailureAt: this._lastFailureAt,
      nextAttemptAt: this._lastFailureAt > 0 ? this._lastFailureAt + this.opts.cooldownMs : 0,
      consecutiveSuccesses: this._consecutiveSuccesses,
    };
  }

  private _transitionTo(newState: 'closed' | 'open' | 'half-open'): void {
    const prev = this._state;
    this._state = newState;

    if (newState === 'closed') {
      this._failureCount = 0;
      this._consecutiveSuccesses = 0;
    } else if (newState === 'half-open') {
      this._consecutiveSuccesses = 0;
    }

    if (prev !== newState) {
      log.info(`[ClawCircuitBreaker] ${prev} → ${newState}`, {
        failureCount: this._failureCount,
        cooldownMs: this.opts.cooldownMs,
      });
    }
  }
}

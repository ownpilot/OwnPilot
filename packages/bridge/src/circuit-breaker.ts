/**
 * Phase 14 — 3-Tier Circuit Breaker System
 *
 * SlidingWindowCircuitBreaker: count-based sliding window.
 *   - window: boolean[] of last N calls (true=success, false=failure)
 *   - Opens when failure count >= failureThreshold AND window.length >= 3
 *   - Half-open after halfOpenTimeout ms
 *   - Closes after successThreshold consecutive successes in half-open
 *
 * CircuitBreakerRegistry: manages named CB instances (same instance per name).
 *
 * Exported singletons:
 *   globalCb         — Tier-3: emergency brake for all CC spawning
 *   projectCbRegistry — Tier-2: per-project CB registry (key = projectDir)
 */

export type CbState = 'closed' | 'open' | 'half-open';

export interface CbOptions {
  failureThreshold?: number;  // failures in window before opening (default: 5)
  successThreshold?: number;  // successes in half-open before closing (default: 2)
  halfOpenTimeout?: number;   // ms before transitioning open→half-open (default: 30000)
  windowSize?: number;        // number of recent calls to track (default: 10)
}

export class SlidingWindowCircuitBreaker {
  private state: CbState = 'closed';
  private window: boolean[] = [];  // true = success, false = failure
  private openedAt: number | null = null;
  private halfOpenSuccesses = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly halfOpenTimeout: number;
  private readonly windowSize: number;

  constructor(options: CbOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.halfOpenTimeout = options.halfOpenTimeout ?? 30_000;
    this.windowSize = options.windowSize ?? 10;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.successThreshold) {
        this.state = 'closed';
        this.window = [];
        this.openedAt = null;
        this.halfOpenSuccesses = 0;
      }
    } else if (this.state === 'closed') {
      this.window.push(true);
      if (this.window.length > this.windowSize) this.window.shift();
    }
    // OPEN state: canExecute() returns false, so recordSuccess() shouldn't be reached.
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      // Re-open immediately on probe failure
      this.state = 'open';
      this.openedAt = Date.now();
      this.halfOpenSuccesses = 0;
      return;
    }
    this.window.push(false);
    if (this.window.length > this.windowSize) this.window.shift();

    const failures = this.window.filter((x) => !x).length;
    // Require at least 3 calls in window before opening (avoids premature open)
    if (failures >= this.failureThreshold && this.window.length >= 3) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  canExecute(): boolean {
    if (this.state === 'closed' || this.state === 'half-open') return true;
    // state === 'open': check if timeout has elapsed
    const elapsed = Date.now() - (this.openedAt ?? 0);
    if (elapsed > this.halfOpenTimeout) {
      this.state = 'half-open';
      this.halfOpenSuccesses = 0;
      return true;
    }
    return false;
  }

  getState(): CbState {
    return this.state;
  }

  getMetrics(): { state: CbState; failures: number; total: number; failureRate: number; openedAt: number | null } {
    const total = this.window.length;
    const failures = this.window.filter((x) => !x).length;
    const failureRate = total > 0 ? failures / total : 0;
    return { state: this.state, failures, total, failureRate, openedAt: this.openedAt };
  }

  reset(): void {
    this.state = 'closed';
    this.window = [];
    this.openedAt = null;
    this.halfOpenSuccesses = 0;
  }
}

export class CircuitBreakerRegistry {
  private cbs = new Map<string, SlidingWindowCircuitBreaker>();

  get(name: string, options?: CbOptions): SlidingWindowCircuitBreaker {
    const existing = this.cbs.get(name);
    if (existing) return existing;
    const cb = new SlidingWindowCircuitBreaker(options);
    this.cbs.set(name, cb);
    return cb;
  }

  getAll(): Map<string, SlidingWindowCircuitBreaker> {
    return this.cbs;
  }

  reset(name: string): void {
    const cb = this.cbs.get(name);
    if (cb) cb.reset();
  }

  resetAll(): void {
    for (const cb of this.cbs.values()) cb.reset();
  }

  getMetrics(): Record<string, ReturnType<SlidingWindowCircuitBreaker['getMetrics']>> {
    const result: Record<string, ReturnType<SlidingWindowCircuitBreaker['getMetrics']>> = {};
    for (const [name, cb] of this.cbs) {
      result[name] = cb.getMetrics();
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton instances (shared across the bridge process)
// ---------------------------------------------------------------------------

// Tier-3: global CB — emergency brake for all CC spawning
export const globalCb = new SlidingWindowCircuitBreaker({
  failureThreshold: 10,
  successThreshold: 3,
  halfOpenTimeout: 60_000,
  windowSize: 20,
});

// Tier-2: per-project CB registry (key = projectDir)
export const projectCbRegistry = new CircuitBreakerRegistry();

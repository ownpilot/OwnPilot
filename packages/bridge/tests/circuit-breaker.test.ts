import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SlidingWindowCircuitBreaker,
  CircuitBreakerRegistry,
  globalCb,
  projectCbRegistry,
} from '../src/circuit-breaker.ts';

/**
 * Unit tests for per-session circuit breaker logic extracted from ClaudeManager.
 *
 * CB state machine: CLOSED → (5 failures) → OPEN → (30s timeout) → HALF-OPEN → (success) → CLOSED
 *                                                                  → (failure) → OPEN
 */

// ---- Extracted circuit breaker logic (pure, testable) ----

interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half-open';
  openedAt: Date | null;
}

const CB_FAILURE_THRESHOLD = 5;
const CB_TIMEOUT_MS = 30_000;

function createCB(): CircuitBreakerState {
  return { failures: 0, lastFailure: null, state: 'closed', openedAt: null };
}

/**
 * Check if a request can proceed through the circuit breaker.
 * Throws if OPEN and timeout hasn't elapsed.
 * Transitions OPEN → HALF-OPEN if timeout has elapsed.
 */
function checkCircuitBreaker(cb: CircuitBreakerState, now: number): void {
  if (cb.state === 'closed') return;
  if (cb.state === 'open') {
    const elapsed = now - (cb.openedAt?.getTime() ?? 0);
    if (elapsed > CB_TIMEOUT_MS) {
      cb.state = 'half-open';
    } else {
      const retryIn = Math.ceil((CB_TIMEOUT_MS - elapsed) / 1000);
      throw new Error(`Circuit breaker OPEN — too many CC spawn failures (${cb.failures}). Retry in ${retryIn}s`);
    }
  }
  // half-open: allow probe through
}

function recordSuccess(cb: CircuitBreakerState): void {
  cb.failures = 0;
  cb.state = 'closed';
  cb.openedAt = null;
}

function recordFailure(cb: CircuitBreakerState): void {
  cb.failures++;
  cb.lastFailure = new Date();
  if (cb.failures >= CB_FAILURE_THRESHOLD) {
    cb.state = 'open';
    cb.openedAt = new Date();
  }
}

// ---- Tests ----

describe('per-session circuit breaker', () => {
  let cb: CircuitBreakerState;

  beforeEach(() => {
    cb = createCB();
  });

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      expect(cb.state).toBe('closed');
      expect(cb.failures).toBe(0);
      expect(cb.openedAt).toBeNull();
    });
  });

  describe('CLOSED state', () => {
    it('allows requests through (no throw)', () => {
      expect(() => checkCircuitBreaker(cb, Date.now())).not.toThrow();
    });

    it('stays closed after 1 failure', () => {
      recordFailure(cb);
      expect(cb.state).toBe('closed');
      expect(cb.failures).toBe(1);
    });

    it('stays closed after 4 failures (below threshold)', () => {
      for (let i = 0; i < 4; i++) recordFailure(cb);
      expect(cb.state).toBe('closed');
      expect(cb.failures).toBe(4);
    });

    it('resets failures on success', () => {
      for (let i = 0; i < 3; i++) recordFailure(cb);
      recordSuccess(cb);
      expect(cb.failures).toBe(0);
      expect(cb.state).toBe('closed');
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('opens after exactly 5 failures', () => {
      for (let i = 0; i < 5; i++) recordFailure(cb);
      expect(cb.state).toBe('open');
      expect(cb.failures).toBe(5);
      expect(cb.openedAt).not.toBeNull();
    });

    it('opens after more than 5 failures', () => {
      for (let i = 0; i < 7; i++) recordFailure(cb);
      expect(cb.state).toBe('open');
      expect(cb.failures).toBe(7);
    });
  });

  describe('OPEN state', () => {
    beforeEach(() => {
      // Force to OPEN
      for (let i = 0; i < 5; i++) recordFailure(cb);
    });

    it('rejects requests immediately', () => {
      const now = cb.openedAt!.getTime() + 1000; // 1s after opening
      expect(() => checkCircuitBreaker(cb, now)).toThrow(/Circuit breaker OPEN/);
    });

    it('includes retry time in error message', () => {
      const now = cb.openedAt!.getTime() + 10_000; // 10s after opening → 20s remaining
      expect(() => checkCircuitBreaker(cb, now)).toThrow(/Retry in 20s/);
    });

    it('rejects at exactly 30s (boundary)', () => {
      const now = cb.openedAt!.getTime() + CB_TIMEOUT_MS; // exactly 30s
      // Note: condition is `elapsed > CB_TIMEOUT_MS`, so exactly 30s still rejects
      expect(() => checkCircuitBreaker(cb, now)).toThrow(/Circuit breaker OPEN/);
    });
  });

  describe('OPEN → HALF-OPEN transition', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) recordFailure(cb);
    });

    it('transitions to HALF-OPEN after timeout elapses', () => {
      const now = cb.openedAt!.getTime() + CB_TIMEOUT_MS + 1; // just past 30s
      checkCircuitBreaker(cb, now); // should not throw
      expect(cb.state).toBe('half-open');
    });
  });

  describe('HALF-OPEN state', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) recordFailure(cb);
      // Manually set half-open (simulating timeout passage)
      cb.state = 'half-open';
    });

    it('allows probe request through', () => {
      expect(() => checkCircuitBreaker(cb, Date.now())).not.toThrow();
    });

    it('returns to CLOSED on success', () => {
      recordSuccess(cb);
      expect(cb.state).toBe('closed');
      expect(cb.failures).toBe(0);
      expect(cb.openedAt).toBeNull();
    });

    it('returns to OPEN on failure', () => {
      recordFailure(cb); // failures was 5, now 6 → ≥ threshold → OPEN
      expect(cb.state).toBe('open');
      expect(cb.openedAt).not.toBeNull();
    });
  });

  describe('per-session isolation', () => {
    it('one session CB does not affect another', () => {
      const cb1 = createCB();
      const cb2 = createCB();

      // Break cb1
      for (let i = 0; i < 5; i++) recordFailure(cb1);
      expect(cb1.state).toBe('open');

      // cb2 should still be closed
      expect(cb2.state).toBe('closed');
      expect(() => checkCircuitBreaker(cb2, Date.now())).not.toThrow();
    });

    it('independent recovery paths', () => {
      const cb1 = createCB();
      const cb2 = createCB();

      // Both break
      for (let i = 0; i < 5; i++) {
        recordFailure(cb1);
        recordFailure(cb2);
      }

      // Recover only cb1
      cb1.state = 'half-open';
      recordSuccess(cb1);

      expect(cb1.state).toBe('closed');
      expect(cb2.state).toBe('open');
    });
  });

  describe('aggregate CB state (for /health)', () => {
    function getAggregateState(
      cbs: CircuitBreakerState[],
    ): { failures: number; state: string; openedAt: Date | null } {
      let worstState: 'closed' | 'open' | 'half-open' = 'closed';
      let maxFailures = 0;
      let earliestOpen: Date | null = null;

      for (const cb of cbs) {
        if (cb.failures > maxFailures) maxFailures = cb.failures;
        if (cb.state === 'open') {
          worstState = 'open';
          if (!earliestOpen || (cb.openedAt && cb.openedAt < earliestOpen)) {
            earliestOpen = cb.openedAt;
          }
        } else if (cb.state === 'half-open' && worstState !== 'open') {
          worstState = 'half-open';
        }
      }
      return { failures: maxFailures, state: worstState, openedAt: earliestOpen };
    }

    it('reports closed when all CBs are closed', () => {
      const result = getAggregateState([createCB(), createCB()]);
      expect(result.state).toBe('closed');
      expect(result.failures).toBe(0);
    });

    it('reports open when any CB is open', () => {
      const cb1 = createCB();
      const cb2 = createCB();
      for (let i = 0; i < 5; i++) recordFailure(cb2);

      const result = getAggregateState([cb1, cb2]);
      expect(result.state).toBe('open');
      expect(result.failures).toBe(5);
    });

    it('reports half-open when worst is half-open', () => {
      const cb1 = createCB();
      const cb2 = createCB();
      cb2.state = 'half-open';
      cb2.failures = 5;

      const result = getAggregateState([cb1, cb2]);
      expect(result.state).toBe('half-open');
    });

    it('open takes precedence over half-open', () => {
      const cbOpen = createCB();
      for (let i = 0; i < 5; i++) recordFailure(cbOpen);
      const cbHalf = createCB();
      cbHalf.state = 'half-open';

      const result = getAggregateState([cbOpen, cbHalf]);
      expect(result.state).toBe('open');
    });

    it('reports empty set as closed', () => {
      const result = getAggregateState([]);
      expect(result.state).toBe('closed');
      expect(result.failures).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SlidingWindowCircuitBreaker — Phase 14 unit tests
// ---------------------------------------------------------------------------

describe('SlidingWindowCircuitBreaker', () => {
  let cb: SlidingWindowCircuitBreaker;

  beforeEach(() => {
    cb = new SlidingWindowCircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      halfOpenTimeout: 1000,
      windowSize: 5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('canExecute() returns true when closed', () => {
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after failureThreshold failures', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('canExecute() returns false when open and timeout not elapsed', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('does not open before failureThreshold is reached', () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
  });

  it('transitions to half-open after halfOpenTimeout elapses', () => {
    vi.useFakeTimers();
    try {
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      vi.advanceTimersByTime(1001);
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe('half-open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('canExecute() returns true when half-open (no timeout required)', () => {
    (cb as any).state = 'half-open';
    expect(cb.canExecute()).toBe(true);
  });

  it('closes after successThreshold consecutive successes in half-open', () => {
    (cb as any).state = 'half-open';
    cb.recordSuccess(); // halfOpenSuccesses=1, threshold=2 → still half-open
    expect(cb.getState()).toBe('half-open');
    cb.recordSuccess(); // halfOpenSuccesses=2, threshold=2 → closes
    expect(cb.getState()).toBe('closed');
  });

  it('re-opens from half-open on failure', () => {
    (cb as any).state = 'half-open';
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('getMetrics() returns correct structure with all required keys', () => {
    const m = cb.getMetrics();
    expect(m).toHaveProperty('state');
    expect(m).toHaveProperty('failures');
    expect(m).toHaveProperty('total');
    expect(m).toHaveProperty('failureRate');
    expect(m).toHaveProperty('openedAt');
  });

  it('getMetrics() tracks failure count and rate accurately', () => {
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordSuccess();
    const m = cb.getMetrics();
    expect(m.total).toBe(3);
    expect(m.failures).toBe(1);
    expect(m.failureRate).toBeCloseTo(1 / 3);
  });

  it('window slides — old calls drop off when window is full', () => {
    // windowSize=5: add 5 successes, then 3 failures → last 5 in window: [S,S,F,F,F]
    for (let i = 0; i < 5; i++) cb.recordSuccess();
    cb.recordFailure(); // window: [S,S,S,S,F]
    cb.recordFailure(); // window: [S,S,S,F,F]
    cb.recordFailure(); // window: [S,S,F,F,F] → 3 failures = threshold → opens
    expect(cb.getState()).toBe('open');
    const m = cb.getMetrics();
    expect(m.total).toBe(5);
    expect(m.failures).toBe(3);
  });

  it('getMetrics().openedAt is non-null when open', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    const m = cb.getMetrics();
    expect(m.state).toBe('open');
    expect(m.openedAt).not.toBeNull();
  });

  it('reset() resets to closed with empty window', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
    const m = cb.getMetrics();
    expect(m.failures).toBe(0);
    expect(m.total).toBe(0);
  });

  it('window minimum (3 calls) prevents premature open', () => {
    // Only 2 calls in window — even if both failures, should not open (min=3)
    const strictCb = new SlidingWindowCircuitBreaker({
      failureThreshold: 2,
      windowSize: 10,
      successThreshold: 2,
      halfOpenTimeout: 1000,
    });
    strictCb.recordFailure();
    strictCb.recordFailure();
    // 2 failures, threshold=2, but window.length=2 < 3 (min required)
    // Actually with threshold=2 and window.length=2, failures==threshold so it opens
    // unless we enforce the window.length>=3 rule
    expect(strictCb.getState()).toBe('closed'); // min 3 calls required
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  it('get() returns the same instance for the same name', () => {
    const a = registry.get('test');
    const b = registry.get('test');
    expect(a).toBe(b);
  });

  it('get() returns different instances for different names', () => {
    const a = registry.get('alpha');
    const b = registry.get('beta');
    expect(a).not.toBe(b);
  });

  it('resetAll() resets all registered CB states to closed', () => {
    const opts = { failureThreshold: 3, windowSize: 5, successThreshold: 2, halfOpenTimeout: 1000 };
    const a = registry.get('alpha', opts);
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    expect(a.getState()).toBe('open');
    registry.resetAll();
    expect(a.getState()).toBe('closed');
  });

  it('reset() resets a specific CB and leaves others untouched', () => {
    const opts = { failureThreshold: 3, windowSize: 5, successThreshold: 2, halfOpenTimeout: 1000 };
    const a = registry.get('alpha', opts);
    const b = registry.get('beta', opts);
    for (let i = 0; i < 3; i++) { a.recordFailure(); b.recordFailure(); }
    expect(a.getState()).toBe('open');
    expect(b.getState()).toBe('open');
    registry.reset('alpha');
    expect(a.getState()).toBe('closed');
    expect(b.getState()).toBe('open'); // beta untouched
  });

  it('getMetrics() returns metrics keyed by name for all registered CBs', () => {
    registry.get('alpha');
    registry.get('beta');
    const m = registry.getMetrics();
    expect(m).toHaveProperty('alpha');
    expect(m).toHaveProperty('beta');
  });
});

describe('exported singletons', () => {
  it('globalCb is an exported SlidingWindowCircuitBreaker instance', () => {
    expect(globalCb).toBeInstanceOf(SlidingWindowCircuitBreaker);
  });

  it('projectCbRegistry is an exported CircuitBreakerRegistry instance', () => {
    expect(projectCbRegistry).toBeInstanceOf(CircuitBreakerRegistry);
  });
});

/**
 * useDebouncedCallback Tests
 *
 * Tests the debounce timer behavior using a React mock that makes
 * the hook runnable without a DOM/jsdom environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock React hooks with minimal functional equivalents
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  useCallback: (fn: (...args: unknown[]) => void) => fn,
  useRef: <T>(initial: T) => ({ current: initial }),
  useEffect: () => {},
}));

import { useDebouncedCallback } from './useDebouncedCallback.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays invocation by the specified delay', () => {
    const callback = vi.fn();
    const debounced = useDebouncedCallback(callback, 300);

    debounced();
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on each call (trailing-edge debounce)', () => {
    const callback = vi.fn();
    const debounced = useDebouncedCallback(callback, 200);

    debounced();
    vi.advanceTimersByTime(100); // halfway through
    debounced(); // reset timer
    vi.advanceTimersByTime(100); // only 100ms since last call
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100); // now 200ms since last call
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires only once when called many times rapidly', () => {
    const callback = vi.fn();
    const debounced = useDebouncedCallback(callback, 100);

    for (let i = 0; i < 20; i++) {
      debounced();
    }

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to the callback', () => {
    const callback = vi.fn();
    const debounced = useDebouncedCallback(callback as (...args: unknown[]) => void, 50);

    debounced('hello', 42);
    vi.advanceTimersByTime(50);

    expect(callback).toHaveBeenCalledWith('hello', 42);
  });

  it('allows subsequent calls after the delay has fired', () => {
    const callback = vi.fn();
    const debounced = useDebouncedCallback(callback, 100);

    debounced();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);

    // Second batch
    debounced();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

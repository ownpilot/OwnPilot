import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleTTLCache } from './simple-ttl-cache.js';

describe('SimpleTTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores values until the TTL boundary', () => {
    const cache = new SimpleTTLCache<string>(1_000);
    cache.set('key', 'value');

    vi.advanceTimersByTime(999);
    expect(cache.get('key')).toBe('value');

    vi.advanceTimersByTime(1);
    expect(cache.get('key')).toBeUndefined();
    cache.destroy();
  });

  it('supports deleting one entry and flushing all entries', () => {
    const cache = new SimpleTTLCache<number>(10_000);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.del('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);

    cache.flushAll();
    expect(cache.get('b')).toBeUndefined();
    cache.destroy();
  });

  it('proactively prunes expired entries', () => {
    const cache = new SimpleTTLCache<string>(1_000);
    cache.set('expired', 'value');

    vi.advanceTimersByTime(60_000);

    expect(cache.get('expired')).toBeUndefined();
    cache.destroy();
  });

  it('destroy clears entries and stops the prune timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const cache = new SimpleTTLCache<string>(10_000);
    cache.set('key', 'value');

    cache.destroy();

    expect(cache.get('key')).toBeUndefined();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });
});

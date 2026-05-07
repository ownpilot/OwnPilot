import { describe, it, expect } from 'vitest';
import { BoundedMap } from './bounded-map.js';

describe('BoundedMap', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
      expect(map.get('a')).toBe(1);
      expect(map.get('b')).toBe(2);
    });

    it('should return undefined for missing keys', () => {
      const map = new BoundedMap<string, number>(3);
      expect(map.get('nonexistent')).toBeUndefined();
    });

    it('should report correct size', () => {
      const map = new BoundedMap<string, number>(3);
      expect(map.size).toBe(0);
      map.set('a', 1);
      expect(map.size).toBe(1);
      map.set('b', 2);
      expect(map.size).toBe(2);
    });

    it('should update existing key without increasing size', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('a', 100);
      expect(map.size).toBe(1);
      expect(map.get('a')).toBe(100);
    });

    it('should delete entries', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      expect(map.delete('a')).toBe(true);
      expect(map.has('a')).toBe(false);
      expect(map.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
      map.clear();
      expect(map.size).toBe(0);
    });

    it('should throw for maxSize < 1', () => {
      expect(() => new BoundedMap(0)).toThrow();
      expect(() => new BoundedMap(-1)).toThrow();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least-recently-used entry when at capacity', () => {
      const map = new BoundedMap<string, number>(3);

      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);

      // 'a' is LRU (only accessed at start)
      const evicted = map.set('d', 4);

      expect(evicted).toBe('a');
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(true);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });

    it('should update LRU timestamp on get', () => {
      const map = new BoundedMap<string, number>(3);

      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);

      // Access 'a', making it most recently used
      const aValue = map.get('a');
      expect(aValue).toBe(1);

      // Insert 'd' — should evict 'b' (now LRU among existing entries)
      const evicted = map.set('d', 4);

      expect(evicted).toBe('b');
      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(false);
    });

    it('should update LRU timestamp on set of existing key', () => {
      const map = new BoundedMap<string, number>(3);

      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);

      // Update 'a' — becomes most recently used
      map.set('a', 100);

      // Insert 'd' — should evict 'b' (oldest among a, b, c)
      const evicted = map.set('d', 4);

      expect(evicted).toBe('b');
    });

    it('should return evicted key from set', () => {
      const map = new BoundedMap<string, number>(2);
      map.set('first', 1);
      map.set('second', 2);

      const evicted = map.set('third', 3);

      expect(evicted).toBe('first');
    });

    it('should not evict when updating existing key', () => {
      const map = new BoundedMap<string, number>(2);
      map.set('a', 1);
      map.set('b', 2);

      const evicted = map.set('a', 100); // update, not insert

      expect(evicted).toBeUndefined();
      expect(map.size).toBe(2);
    });

    it('should handle size 1 correctly', () => {
      const map = new BoundedMap<string, number>(1);

      map.set('a', 1);
      expect(map.get('a')).toBe(1);

      const evicted = map.set('b', 2);
      expect(evicted).toBe('a');
      expect(map.get('a')).toBeUndefined();
      expect(map.get('b')).toBe(2);
    });
  });

  describe('FIFO eviction', () => {
    it('should evict oldest entry regardless of access time', () => {
      const map = new BoundedMap<string, number>(3, 'fifo');

      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);

      // Access 'a' but FIFO should still evict 'a' (oldest)
      map.get('a');

      const evicted = map.set('d', 4);

      expect(evicted).toBe('a');
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(true);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });

    it('should evict in insertion order', () => {
      const map = new BoundedMap<string, number>(2, 'fifo');

      map.set('a', 1);
      map.set('b', 2);
      expect(map.set('c', 3)).toBe('a'); // 'a' was first
      expect(map.set('d', 4)).toBe('b'); // 'b' was second
    });
  });

  describe('iteration', () => {
    it('should iterate over entries', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);

      const entries = [...map.entries()];
      expect(entries).toHaveLength(2);
      // entries() yields [K, V] pairs
      expect(entries.some(([k, v]) => k === 'a' && v === 1)).toBe(true);
      expect(entries.some(([k, v]) => k === 'b' && v === 2)).toBe(true);
    });

    it('should iterate over keys', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);

      const keys = [...map.keys()];
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('should iterate over values', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);

      const values = [...map.values()];
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('should not affect LRU order on iteration', () => {
      const map = new BoundedMap<string, number>(2);
      map.set('a', 1);
      map.set('b', 2);

      // Iterate (should not update LRU counter)
      // eslint-disable-next-line no-unused-vars
      for (const _entry of map.entries()) { /* exhaust iterator */ }

      // Insert 'c' — should evict 'a' (oldest LRU), not 'b'
      const evicted = map.set('c', 3);

      expect(evicted).toBe('a');
    });
  });

  describe('max property', () => {
    it('should return configured max size', () => {
      const map = new BoundedMap<string, number>(42);
      expect(map.max).toBe(42);
    });
  });
});
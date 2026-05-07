/**
 * BoundedMap — in-memory Map with size limit and LRU eviction.
 *
 * Used wherever in-memory collections need a hard size cap:
 * - ClawManager.tracks (MAX_CONCURRENT_CLAWS)
 * - FleetManager.fleets
 * - DynamicToolRegistry cached tools
 * - Idempotency keys (24h TTL + size cap)
 * - embedding_cache
 *
 * Eviction policy: least-recently-used when maxSize is exceeded.
 * Thread-unsafe — use within single-threaded contexts only.
 */

export type EvictionPolicy = 'lru' | 'fifo';

interface Entry<V> {
  value: V;
  /** Monotonic counter used for both LRU ordering and FIFO ordering */
  counter: number;
}

/** Global monotonic counter — incremented on every mutation (set/get for LRU, set for FIFO) */
let _counter = 0;
function nextCounter(): number {
  return ++_counter;
}

export class BoundedMap<K = string, V = unknown> {
  private readonly maxSize: number;
  private readonly evictionPolicy: EvictionPolicy;
  private readonly map: Map<K, Entry<V>>;

  constructor(maxSize: number, evictionPolicy: EvictionPolicy = 'lru') {
    if (maxSize < 1) {
      throw new Error(`BoundedMap maxSize must be >= 1, got ${maxSize}`);
    }
    this.maxSize = maxSize;
    this.evictionPolicy = evictionPolicy;
    this.map = new Map();
  }

  /**
   * Get a value and advance its counter (LRU tracking).
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.evictionPolicy === 'lru') {
      entry.counter = nextCounter();
    }
    return entry.value;
  }

  /**
   * Check if a key exists (does not update LRU counter).
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Set a value. Evicts the least-recently-used entry if at capacity.
   * Returns the evicted key if any, undefined otherwise.
   */
  set(key: K, value: V): K | undefined {
    if (this.map.has(key)) {
      const entry = this.map.get(key)!;
      entry.value = value;
      if (this.evictionPolicy === 'lru') {
        entry.counter = nextCounter();
      }
      return undefined;
    }

    let evictedKey: K | undefined;

    if (this.map.size >= this.maxSize) {
      evictedKey = this.evictOne();
    }

    this.map.set(key, {
      value,
      counter: nextCounter(),
    });

    return evictedKey;
  }

  /**
   * Delete a key. Returns true if the key existed.
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Number of entries currently stored.
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Maximum capacity.
   */
  get max(): number {
    return this.maxSize;
  }

  /**
   * Iterate over entries (key-value pairs) without affecting LRU order.
   */
  entries(): Iterable<[K, V]> {
     
    const map = this.map;
    return {
      *[Symbol.iterator](): Generator<[K, V]> {
        for (const [key, entry] of map) {
          yield [key, entry.value] as [K, V];
        }
      },
    };
  }

  /**
   * Iterate over keys without affecting LRU order.
   */
  keys(): Iterable<K> {
    return this.map.keys();
  }

  /**
   * Iterate over values without affecting LRU order.
   */
  values(): Iterable<V> {
     
    const map = this.map;
    return {
      *[Symbol.iterator](): Generator<V> {
        for (const entry of map.values()) {
          yield entry.value;
        }
      },
    };
  }

  /**
   * Evict one entry based on the configured eviction policy.
   * LRU: evict the entry with the lowest counter (oldest mutation).
   * FIFO: evict the entry with the lowest counter (oldest insertion).
   */
  private evictOne(): K | undefined {
    if (this.map.size === 0) return undefined;

    let targetKey: K | undefined;
    let bestCounter = Infinity;

    for (const [key, entry] of this.map) {
      if (entry.counter < bestCounter) {
        bestCounter = entry.counter;
        targetKey = key;
      }
    }

    if (targetKey !== undefined) {
      this.map.delete(targetKey);
      return targetKey;
    }
    return undefined;
  }
}
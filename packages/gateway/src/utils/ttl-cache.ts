/**
 * TTL Cache — generic in-memory cache with time-to-live expiration.
 *
 * Shared by: dashboard-briefing.ts, soul-heartbeat-service.ts, and others.
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TTLCache<K = string, V = unknown> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(opts?: { defaultTtlMs?: number; maxEntries?: number }) {
    this.defaultTtlMs = opts?.defaultTtlMs ?? 30 * 60 * 1000; // 30 min
    this.maxEntries = opts?.maxEntries ?? 500;
  }

  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
    if (this.cache.size > this.maxEntries) {
      this.prune();
    }
  }

  has(key: K): boolean {
    return this.get(key) !== null;
  }

  invalidate(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

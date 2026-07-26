/**
 * SimpleTTLCache — generic in-memory TTL cache with proactive eviction.
 *
 * Replaces node-cache dependency with zero-dependency alternative.
 * Proactively evicts expired entries every 60s to prevent unbounded growth.
 * All methods are synchronous.
 */
export class SimpleTTLCache<V> {
  private data = new Map<string, { value: V; expires: number }>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number) {
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  set(key: string, value: V): void {
    this.data.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  get(key: string): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expires) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  del(key: string): void {
    this.data.delete(key);
  }

  flushAll(): void {
    this.data.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (now >= entry.expires) this.data.delete(key);
    }
  }

  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.data.clear();
  }
}

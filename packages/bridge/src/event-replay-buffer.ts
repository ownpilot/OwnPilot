/**
 * SSE Event Replay Buffer
 *
 * Ring buffer of recent BridgeEvents. Used to replay missed events
 * to clients that reconnect with a Last-Event-ID header.
 *
 * Config (ENV):
 *   SSE_REPLAY_BUFFER_SIZE  — max events to keep (default 1000)
 *   SSE_REPLAY_TTL_MS       — TTL per event in ms (default 300_000 = 5 min)
 */

import type { BufferedEvent } from './event-bus.ts';

type StoredEvent = BufferedEvent & { _bufferedAt: number };

export class EventReplayBuffer {
  private buffer: StoredEvent[] = [];
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(options?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = options?.maxSize ?? (Number(process.env.SSE_REPLAY_BUFFER_SIZE) || 1000);
    this.ttlMs = options?.ttlMs ?? (Number(process.env.SSE_REPLAY_TTL_MS) || 300_000);
  }

  push(event: BufferedEvent): void {
    this.prune();
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift(); // Drop oldest
    }
    this.buffer.push({ ...event, _bufferedAt: Date.now() });
  }

  /** Return all events with id > lastEventId (ordered by id ascending). */
  since(lastEventId: number): BufferedEvent[] {
    return this.buffer.filter(e => e.id > lastEventId).map(({ _bufferedAt: _, ...event }) => event as BufferedEvent);
  }

  /** Remove expired entries. Returns count removed. */
  prune(): number {
    const cutoff = Date.now() - this.ttlMs;
    const before = this.buffer.length;
    this.buffer = this.buffer.filter(e => e._bufferedAt >= cutoff);
    return before - this.buffer.length;
  }

  get size(): number { return this.buffer.length; }
  get capacity(): number { return this.maxSize; }
}

/** Singleton replay buffer shared across SSE connections. */
export const replayBuffer = new EventReplayBuffer();

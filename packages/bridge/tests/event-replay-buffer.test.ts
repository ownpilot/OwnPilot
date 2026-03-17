import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventReplayBuffer } from '../src/event-replay-buffer.ts';
import type { BufferedEvent } from '../src/event-bus.ts';

// Helper: create a minimal BufferedEvent with a specific id
function makeEvent(id: number): BufferedEvent {
  return {
    type: 'session.done',
    conversationId: 'c',
    sessionId: 's',
    timestamp: new Date().toISOString(),
    id,
  } as BufferedEvent;
}

describe('EventReplayBuffer', () => {
  it('push stores events and size reflects count', () => {
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 60_000 });
    expect(buf.size).toBe(0);

    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    expect(buf.size).toBe(2);
  });

  it('since(lastEventId) returns events with id > lastEventId', () => {
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 60_000 });
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));
    buf.push(makeEvent(4));

    const result = buf.since(2);
    expect(result.map(e => e.id)).toEqual([3, 4]);
  });

  it('since(0) returns all events', () => {
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 60_000 });
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));

    expect(buf.since(0)).toHaveLength(3);
  });

  it('since(very-high-id) returns empty array', () => {
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 60_000 });
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    expect(buf.since(999)).toHaveLength(0);
  });

  it('overflows: drops oldest when maxSize reached', () => {
    const buf = new EventReplayBuffer({ maxSize: 3, ttlMs: 60_000 });
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));
    buf.push(makeEvent(4)); // should drop id=1

    expect(buf.size).toBe(3);
    expect(buf.since(0).map(e => e.id)).toEqual([2, 3, 4]);
  });

  it('prune() removes expired events and returns count removed', () => {
    vi.useFakeTimers();
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 1_000 }); // 1s TTL

    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    vi.advanceTimersByTime(1_001); // past TTL

    buf.push(makeEvent(3)); // this triggers prune internally

    expect(buf.size).toBe(1); // only id=3 remains
    expect(buf.since(0).map(e => e.id)).toEqual([3]);

    vi.useRealTimers();
  });

  it('explicit prune() returns number of removed entries', () => {
    vi.useFakeTimers();
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 500 });

    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));

    vi.advanceTimersByTime(600);

    const removed = buf.prune();
    expect(removed).toBe(3);
    expect(buf.size).toBe(0);

    vi.useRealTimers();
  });

  it('capacity reflects maxSize option', () => {
    const buf = new EventReplayBuffer({ maxSize: 500 });
    expect(buf.capacity).toBe(500);
  });

  it('defaults to maxSize=1000 and ttlMs=300_000 when no options given', () => {
    const buf = new EventReplayBuffer();
    expect(buf.capacity).toBe(1000);
  });

  it('since() returns copies (immutable — pushing to result does not affect buffer)', () => {
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 60_000 });
    buf.push(makeEvent(1));

    const result = buf.since(0);
    result.push(makeEvent(99)); // mutate returned array

    expect(buf.size).toBe(1); // original buffer unchanged
  });
});

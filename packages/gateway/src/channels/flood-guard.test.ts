/**
 * InboundFloodGuard unit tests — sliding window, per-sender isolation,
 * tracked-sender eviction, and warn-once behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InboundFloodGuard } from './flood-guard.js';

describe('InboundFloodGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows messages under the limit', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 3, windowMs: 1000 });
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
  });

  it('drops messages once the limit is reached', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 2, windowMs: 1000 });
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(true);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(true);
  });

  it('tracks senders independently (per channel + user)', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 1, windowMs: 1000 });
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u2')).toBe(false);
    expect(guard.shouldDrop('discord.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(true);
  });

  it('allows again after the window slides past old timestamps', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 2, windowMs: 1000 });
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(guard.shouldDrop('telegram.main', 'u1')).toBe(false);
  });

  it('never drops messages with an empty platformUserId', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 1, windowMs: 1000 });
    expect(guard.shouldDrop('telegram.main', '')).toBe(false);
    expect(guard.shouldDrop('telegram.main', '')).toBe(false);
    expect(guard.shouldDrop('telegram.main', '')).toBe(false);
  });

  it('evicts the oldest tracked sender beyond maxTracked', () => {
    const guard = new InboundFloodGuard({ maxPerWindow: 1, windowMs: 60_000, maxTracked: 2 });
    expect(guard.shouldDrop('ch', 'u1')).toBe(false);
    expect(guard.shouldDrop('ch', 'u2')).toBe(false);
    // u3 pushes the map over maxTracked → u1 (oldest) evicted
    expect(guard.shouldDrop('ch', 'u3')).toBe(false);
    // u1 was evicted, so its window restarted — allowed again despite limit 1
    // (this insert in turn evicts u2, the new oldest)
    expect(guard.shouldDrop('ch', 'u1')).toBe(false);
    // u3 stayed tracked throughout — at its limit, dropped
    expect(guard.shouldDrop('ch', 'u3')).toBe(true);
  });
});

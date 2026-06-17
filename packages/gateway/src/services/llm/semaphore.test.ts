/**
 * Tests for llm/semaphore.ts — LLM concurrency limiter.
 *
 * Tests the acquire/release FIFO queue, idempotent release,
 * setMaxSlots grow/shrink, and getDetailedSlots snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/repositories/settings/index.js', () => ({
  settingsRepo: {
    get: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@ownpilot/core/events', () => ({
  getEventSystem: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    onAny: vi.fn(),
  }),
}));

// Import after mocks — use dynamic import to get a fresh instance
const { getLlmSemaphore, resetLlmSemaphore } = await import('./semaphore.js');

describe('LlmSemaphore', () => {
  beforeEach(() => {
    resetLlmSemaphore();
  });

  it('acquires and releases a slot', async () => {
    const sem = getLlmSemaphore();
    const release = await sem.acquire('agent-1', 'test');
    expect(sem.activeCount).toBe(1);
    release();
    expect(sem.activeCount).toBe(0);
  });

  it('queues when all slots are occupied', async () => {
    const sem = getLlmSemaphore();
    const r1 = await sem.acquire('agent-1', 'test');
    const r2 = await sem.acquire('agent-2', 'test');
    const r3 = await sem.acquire('agent-3', 'test');

    // Default max is 3 — all slots filled
    expect(sem.activeCount).toBe(3);
    expect(sem.queuedCount).toBe(0);

    // This one should queue
    const acquirePromise = sem.acquire('agent-4', 'test');
    expect(sem.queuedCount).toBe(1);

    // Release a slot — queued caller should get it
    r3();
    const r4 = await acquirePromise;
    expect(sem.activeCount).toBe(3);
    expect(sem.queuedCount).toBe(0);

    r1();
    r2();
    r4();
  });

  it('release is idempotent', async () => {
    const sem = getLlmSemaphore();
    const release = await sem.acquire('agent-1', 'test');
    release();
    expect(sem.activeCount).toBe(0);
    // Second release should be a no-op
    release();
    expect(sem.activeCount).toBe(0);
  });

  it('setMaxSlots grows and drains queue', async () => {
    const sem = getLlmSemaphore();
    // Fill all 3 slots
    const r1 = await sem.acquire('a1', 'l');
    const r2 = await sem.acquire('a2', 'l');
    const r3 = await sem.acquire('a3', 'l');

    // Queue two more
    const p4 = sem.acquire('a4', 'l');
    const p5 = sem.acquire('a5', 'l');
    expect(sem.queuedCount).toBe(2);

    // Grow to 5 slots
    sem.setMaxSlots(5);
    expect(sem.currentMaxSlots).toBe(5);

    // Queued callers should now have their slots
    const r4 = await p4;
    const r5 = await p5;
    expect(sem.queuedCount).toBe(0);
    expect(sem.activeCount).toBe(5);

    r1();
    r2();
    r3();
    r4();
    r5();
  });

  it('setMaxSlots shrink keeps occupied slots valid', async () => {
    const sem = getLlmSemaphore();
    const r1 = await sem.acquire('a1', 'l');
    sem.setMaxSlots(1);

    // Slot still held — release should work
    expect(sem.activeCount).toBe(1);
    r1();
    expect(sem.activeCount).toBe(0);
  });

  it('getDetailedSlots returns active, queued, and free slots', async () => {
    const sem = getLlmSemaphore();
    const r1 = await sem.acquire('agent-x', 'label');

    const slots = sem.getDetailedSlots((id) => `Label-${id}`);
    expect(slots.length).toBe(3); // 3 default slots
    expect(slots[0]).toMatchObject({ agentId: 'agent-x', state: 'active', label: 'Label-agent-x' });
    expect(slots[1]).toMatchObject({ state: 'free' });

    r1();
  });

  it('FIFO ordering — queued callers are served in order', async () => {
    const sem = getLlmSemaphore();
    const r1 = await sem.acquire('a1', 'l');
    const r2 = await sem.acquire('a2', 'l');
    const r3 = await sem.acquire('a3', 'l');

    // Queue 3 in order
    const p4 = sem.acquire('a4', 'l');
    const p5 = sem.acquire('a5', 'l');

    // Release a3 → a4 should get the slot
    r3();
    const r4 = await p4;
    expect(sem.activeCount).toBe(3);

    // Release r4 → a5 should get the slot
    r4();
    const r5 = await p5;
    expect(sem.activeCount).toBe(3);

    r1();
    r2();
    r5();
  });
});

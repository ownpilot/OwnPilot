/**
 * LLM Concurrency Semaphore
 *
 * Limits the number of simultaneous LLM API calls across all agents
 * (claws, etc.). When all slots are occupied,
 * new callers wait in a FIFO queue — no busy-polling.
 *
 * Each slot tracks which agentId is holding it, enabling the UI to
 * render a live "LLM call lane" strip showing which claw is active.
 *
 * Settings-driven: reads `gateway.max_llm_concurrency` from settingsRepo
 * at startup and exposes `setMaxSlots()` for runtime reconfiguration.
 */

import { settingsRepo } from '../../db/repositories/settings/index.js';
import { getLog } from '../log.js';
import { getEventSystem } from '@ownpilot/core';

const log = getLog('LlmSemaphore');

const SETTINGS_KEY = 'gateway.max_llm_concurrency';

/** Default: allow 3 concurrent LLM calls — conservative to avoid provider 429s */
const DEFAULT_MAX_SLOTS = 3;

/**
 * Info about an active (or queued) LLM call, used by the UI to render
 * a live "which claw is using the LLM right now" strip.
 */

/**
 * Global LLM concurrency limiter.
 *
 * Uses a simple array-based slot map where each slot holds an agentId
 * (empty string = slot is free). The semaphore guarantees that at any
 * moment no more than `maxSlots` callers hold the lock simultaneously.
 */
class LlmSemaphore {
  /**
   * slot[i] = agentId occupying slot i, or '' if free.
   *
   * The array can grow past `maxSlots` temporarily when `setMaxSlots()`
   * shrinks the cap while permits are still held — those over-cap slots
   * stay occupied until their release fires, then the tail is trimmed.
   */
  private slots: string[] = [];

  /** FIFO wait queue */
  private waitQueue: Array<{ agentId: string; resolve: (release: () => void) => void }> = [];

  /**
   * Active permits — Map<token, slotIdx>. Each acquire() returns a release()
   * function bound to a unique Symbol. release() is idempotent: a second call
   * with the same token is a no-op. This is the primitive that closes the
   * three CRIT-2 bugs (race + double-resolve + setMaxSlots stale slot index).
   */
  private permits = new Map<symbol, number>();

  constructor(private maxSlots: number) {
    this.slots = new Array(maxSlots).fill('');
  }

  /**
   * Acquire a concurrency slot.
   *
   * @param agentId  Unique identifier of the agent acquiring the slot (e.g. claw id)
   * @param _label   Unused — kept for API compat; label is derived from agentId in getDetailedSlots
   * @returns A `release` function — call it when the LLM call is done. Safe
   *          to call multiple times (idempotent).
   *
   * If no slots are available the caller waits in FIFO order.
   */
  async acquire(agentId: string, _label: string): Promise<() => void> {
    // Fast path: a free slot exists and no-one is queued. Fully synchronous,
    // so two concurrent acquire() calls can't race to claim the same slot
    // (single-threaded JS guarantees the slot mutation runs to completion
    // before the next acquire() runs).
    const freeIdx = this.findFreeSlotIdx();
    if (freeIdx !== -1 && this.waitQueue.length === 0) {
      return this.assignSlot(freeIdx, agentId);
    }

    // Slow path: enqueue. release() handles handing the slot to the head of
    // the queue when it fires — we do NOT re-check the slots array here.
    return new Promise<() => void>((resolve) => {
      this.waitQueue.push({ agentId, resolve });
    });
  }

  private findFreeSlotIdx(): number {
    // Only consider slots within the current cap. Slots past the cap may be
    // occupied by permits issued before a setMaxSlots() shrink — they stay
    // valid until released but are not reusable.
    for (let i = 0; i < this.maxSlots; i++) {
      if ((this.slots[i] ?? '') === '') return i;
    }
    return -1;
  }

  private assignSlot(slotIdx: number, agentId: string): () => void {
    this.slots[slotIdx] = agentId;
    const token = Symbol(agentId);
    this.permits.set(token, slotIdx);
    this.emitUpdate();
    return () => this.release(token);
  }

  private release(token: symbol): void {
    const slotIdx = this.permits.get(token);
    if (slotIdx === undefined) return; // Already released — idempotent.
    this.permits.delete(token);
    this.slots[slotIdx] = '';

    // If the freed slot is within the current cap, hand it to the head of
    // the queue. If the slot is past the cap (post-shrink), trim the tail.
    if (slotIdx < this.maxSlots) {
      const next = this.waitQueue.shift();
      if (next) {
        const releaseFn = this.assignSlot(slotIdx, next.agentId);
        next.resolve(releaseFn);
        return; // assignSlot already emitted.
      }
    } else {
      while (
        this.slots.length > this.maxSlots &&
        (this.slots[this.slots.length - 1] ?? '') === ''
      ) {
        this.slots.pop();
      }
    }
    this.emitUpdate();
  }

  private emitUpdate(): void {
    try {
      const es = getEventSystem();
      es.emit('llm.slot.update' as never, 'llm-semaphore', {
        max: this.maxSlots,
        active: this.activeCount,
        queued: this.queuedCount,
      } as never);
    } catch {
      // Event system may not be initialized in tests
    }
  }

  /** Detailed snapshot of all slots and queued callers for the UI */
  getDetailedSlots(resolveLabel: (agentId: string) => string): Array<{
    slotIdx: number;
    agentId: string;
    label: string;
    state: 'active' | 'queued' | 'free';
  }> {
    const result: Array<{
      slotIdx: number;
      agentId: string;
      label: string;
      state: 'active' | 'queued' | 'free';
    }> = [];

    for (let i = 0; i < this.maxSlots; i++) {
      const agentId = this.slots[i];
      result.push({
        slotIdx: i,
        agentId: agentId ?? '',
        label: agentId ? resolveLabel(agentId) : `Slot ${i + 1}`,
        state: agentId ? 'active' : 'free',
      });
    }

    for (const { agentId } of this.waitQueue) {
      result.push({
        slotIdx: -1,
        agentId,
        label: agentId ? resolveLabel(agentId) : '(queued)',
        state: 'queued',
      });
    }

    return result;
  }

  get activeCount(): number {
    return this.slots.filter((s) => s !== '').length;
  }

  get queuedCount(): number {
    return this.waitQueue.length;
  }

  get currentMaxSlots(): number {
    return this.maxSlots;
  }

  /**
   * Update max concurrent slots at runtime.
   *
   * Growing the cap: extend the slot array with free slots and drain the
   * wait queue into the new slots.
   *
   * Shrinking the cap: NEVER destroy slots that still hold permits — the
   * release() closures captured those slot indices and would silently leak
   * permits if their slots disappeared. Over-cap slots stay occupied and
   * their permits stay valid; the trailing tail is trimmed in release()
   * once each over-cap slot frees up.
   */
  setMaxSlots(n: number): void {
    const desired = Math.max(1, n);
    if (desired === this.maxSlots) return;
    const prev = this.maxSlots;
    this.maxSlots = desired;

    if (desired > prev) {
      // Grow: extend slots, then drain queue into new free positions.
      while (this.slots.length < desired) this.slots.push('');
      while (this.waitQueue.length > 0) {
        const free = this.findFreeSlotIdx();
        if (free === -1) break;
        const next = this.waitQueue.shift()!;
        const releaseFn = this.assignSlot(free, next.agentId);
        next.resolve(releaseFn);
      }
    }
    // Shrink: nothing to do here — over-cap slots stay occupied until
    // released, at which point release() trims the tail.

    this.emitUpdate();
    log.info(`[LlmSemaphore] max slots updated from ${prev} to ${desired}`);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: LlmSemaphore | null = null;

export function getLlmSemaphore(): LlmSemaphore {
  if (!instance) {
    const stored = settingsRepo.get<number>(SETTINGS_KEY);
    const max = stored ?? DEFAULT_MAX_SLOTS;
    instance = new LlmSemaphore(max);
    log.info(`[LlmSemaphore] initialised with maxSlots=${max} (stored=${stored})`);
  }
  return instance;
}

/**
 * Reset the singleton (for testing or shutdown).
 */
export function resetLlmSemaphore(): void {
  instance = null;
}

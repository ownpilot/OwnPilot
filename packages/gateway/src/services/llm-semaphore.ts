/**
 * LLM Concurrency Semaphore
 *
 * Limits the number of simultaneous LLM API calls across all agents
 * (claws, fleet workers, subagents). When all slots are occupied,
 * new callers wait in a FIFO queue — no busy-polling.
 *
 * Each slot tracks which agentId is holding it, enabling the UI to
 * render a live "LLM call lane" strip showing which claw is active.
 *
 * Settings-driven: reads `gateway.max_llm_concurrency` from settingsRepo
 * at startup and exposes `setMaxSlots()` for runtime reconfiguration.
 */

import { settingsRepo } from '../db/repositories/settings.js';
import { getLog } from './log.js';
import { getEventSystem } from '@ownpilot/core';

const log = getLog('LlmSemaphore');

const SETTINGS_KEY = 'gateway.max_llm_concurrency';

/** Default: allow 3 concurrent LLM calls — conservative to avoid provider 429s */
const DEFAULT_MAX_SLOTS = 3;

/**
 * Info about an active (or queued) LLM call, used by the UI to render
 * a live "which claw is using the LLM right now" strip.
 */
export interface LlmSlotInfo {
  agentId: string;
  /** 'active' = currently in LLM call, 'queued' = waiting for a slot */
  state: 'active' | 'queued';
}

/**
 * Global LLM concurrency limiter.
 *
 * Uses a simple array-based slot map where each slot holds an agentId
 * (empty string = slot is free). The semaphore guarantees that at any
 * moment no more than `maxSlots` callers hold the lock simultaneously.
 */
export class LlmSemaphore {
  /** slot[i] = agentId occupying slot i, or '' if free */
  private slots: string[] = [];
  /** FIFO wait queue */
  private waitQueue: Array<{ agentId: string; resolve: (slotIdx: number) => void }> = [];

  constructor(private maxSlots: number) {
    this.slots = new Array(maxSlots).fill('');
  }

  /**
   * Acquire a concurrency slot.
   *
   * @param agentId  Unique identifier of the agent acquiring the slot (e.g. claw id)
   * @param _label   Unused — kept for API compat; label is derived from agentId in getDetailedSlots
   * @returns A `release` function — call it exactly once when the LLM call is done.
   *
   * If no slots are available the caller waits in FIFO order.
   */
  async acquire(agentId: string, _label: string): Promise<() => void> {
    // Fast path: a free slot exists and no-one is queued
    const freeIdx = this.slots.findIndex((s) => s === '');
    if (freeIdx !== -1 && this.waitQueue.length === 0) {
      this.slots[freeIdx] = agentId;
      this.emitUpdate();
      return () => this.release(agentId, freeIdx);
    }

    // Slow path: enqueue and wait
    return new Promise<() => void>((resolve) => {
      this.waitQueue.push({
        agentId,
        resolve: (slotIdx: number) => {
          this.slots[slotIdx] = agentId;
          this.emitUpdate();
          resolve(() => this.release(agentId, slotIdx));
        },
      });

      // Check again after enqueueing — a slot may have freed up
      const idx = this.slots.findIndex((s) => s === '');
      if (idx !== -1) {
        const waiter = this.waitQueue.shift();
        if (waiter) {
          waiter.resolve(idx);
        } else {
          // No one actually waiting, take it directly
          this.slots[idx] = agentId;
          this.emitUpdate();
          resolve(() => () => this.release(agentId, idx));
        }
      }
    });
  }

  private release(agentId: string, slotIdx: number): void {
    if (this.slots[slotIdx] !== agentId) return;
    this.slots[slotIdx] = '';

    const next = this.waitQueue.shift();
    if (next) {
      next.resolve(slotIdx);
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
  getDetailedSlots(
    resolveLabel: (agentId: string) => string
  ): Array<{
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

  /** Update max concurrent slots at runtime */
  setMaxSlots(n: number): void {
    const desired = Math.max(1, n);
    if (desired === this.maxSlots) return;

    const newSlots: string[] = [];
    for (let i = 0; i < desired; i++) {
      newSlots[i] = this.slots[i] ?? '';
    }
    this.slots = newSlots;
    this.emitUpdate();
    log.info(`[LlmSemaphore] max slots updated to ${n}`);
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

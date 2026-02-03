/**
 * HookBus - Sequential Interceptable Hook System
 *
 * Unlike events (fire-and-forget), hooks are:
 * - Sequential: handlers run in priority order, each awaited
 * - Interceptable: handlers can modify data and cancel operations
 * - Awaited: call() always returns a Promise with the final context
 *
 * Naming convention: colon-delimited (e.g. 'tool:before-execute')
 * to visually distinguish from dot-delimited events.
 */

import type { HookType, HookPayload } from './hook-map.js';
import type { HookContext, HookHandler, Unsubscribe } from './types.js';

// ============================================================================
// Interface
// ============================================================================

export interface IHookBus {
  /**
   * Register a hook handler. Lower priority numbers run first.
   * Default priority is 10. Returns an unsubscribe function.
   */
  tap<K extends HookType>(
    hook: K,
    handler: HookHandler<HookPayload<K>>,
    priority?: number,
  ): Unsubscribe;

  /**
   * Run all handlers for a hook sequentially in priority order.
   * Returns the (possibly modified) context after all handlers have run.
   */
  call<K extends HookType>(
    hook: K,
    data: HookPayload<K>,
  ): Promise<HookContext<HookPayload<K>>>;

  /**
   * Register a handler for a dynamic/untyped hook name (escape hatch).
   */
  tapAny(
    hook: string,
    handler: HookHandler,
    priority?: number,
  ): Unsubscribe;

  /**
   * Call a dynamic/untyped hook.
   */
  callAny(hook: string, data: unknown): Promise<HookContext>;

  /**
   * Remove all hook handlers.
   */
  clear(): void;
}

// ============================================================================
// Internal Types
// ============================================================================

interface TapEntry {
  handler: HookHandler;
  priority: number;
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_PRIORITY = 10;

export class HookBus implements IHookBus {
  private hooks = new Map<string, TapEntry[]>();

  tap<K extends HookType>(
    hook: K,
    handler: HookHandler<HookPayload<K>>,
    priority: number = DEFAULT_PRIORITY,
  ): Unsubscribe {
    return this.addTap(hook, handler as HookHandler, priority);
  }

  async call<K extends HookType>(
    hook: K,
    data: HookPayload<K>,
  ): Promise<HookContext<HookPayload<K>>> {
    return this.execute(hook, data) as Promise<HookContext<HookPayload<K>>>;
  }

  tapAny(
    hook: string,
    handler: HookHandler,
    priority: number = DEFAULT_PRIORITY,
  ): Unsubscribe {
    return this.addTap(hook, handler, priority);
  }

  async callAny(hook: string, data: unknown): Promise<HookContext> {
    return this.execute(hook, data);
  }

  clear(): void {
    this.hooks.clear();
  }

  // --- Internal ---

  private addTap(hook: string, handler: HookHandler, priority: number): Unsubscribe {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }

    const entry: TapEntry = { handler, priority };
    const entries = this.hooks.get(hook)!;
    entries.push(entry);

    // Sort by priority (lower runs first)
    entries.sort((a, b) => a.priority - b.priority);

    return () => {
      const arr = this.hooks.get(hook);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx !== -1) arr.splice(idx, 1);
        if (arr.length === 0) this.hooks.delete(hook);
      }
    };
  }

  /**
   * Execute all handlers for a hook sequentially.
   * Each handler can modify context.data and set context.cancelled.
   * Errors are caught and logged; remaining handlers still execute.
   */
  private async execute(hook: string, data: unknown): Promise<HookContext> {
    const context: HookContext = {
      type: hook,
      data,
      cancelled: false,
      metadata: {},
    };

    const entries = this.hooks.get(hook);
    if (!entries || entries.length === 0) {
      return context;
    }

    // Execute handlers sequentially in priority order
    for (const entry of entries) {
      try {
        await entry.handler(context);
      } catch (err) {
        console.error(`[HookBus] Handler error for "${hook}":`, err);
      }
    }

    return context;
  }
}

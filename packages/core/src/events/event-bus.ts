/**
 * EventBus - Enhanced Typed Event Bus
 *
 * Fire-and-forget event dispatching with:
 * - Compile-time type safety via EventMap
 * - Exact type, category, and wildcard pattern subscriptions
 * - once() and waitFor() support
 * - Error isolation (handler failures never propagate)
 */

import type { EventType, EventPayload } from './event-map.js';
import type { TypedEvent, EventHandler, Unsubscribe, EventCategory } from './types.js';
import { deriveCategory } from './types.js';

// ============================================================================
// Interface
// ============================================================================

export interface IEventBus {
  /**
   * Emit a typed event. Payload is type-checked against EventMap.
   * Category is auto-derived from the first segment of the type.
   * Fire-and-forget: handlers run asynchronously, errors are isolated.
   */
  emit<K extends EventType>(type: K, source: string, data: EventPayload<K>): void;

  /**
   * Emit a raw TypedEvent (backward compatibility + dynamic events).
   * Use this when you have a pre-constructed TypedEvent object.
   */
  emitRaw<T = unknown>(event: TypedEvent<T>): void;

  /**
   * Subscribe to a specific event type with full type safety.
   * Returns an unsubscribe function.
   */
  on<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe;

  /**
   * Subscribe once - handler is removed after first invocation.
   */
  once<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe;

  /**
   * Subscribe to a dynamic/untyped event type (escape hatch).
   */
  onAny(type: string, handler: EventHandler): Unsubscribe;

  /**
   * Unsubscribe a handler from a specific event type.
   */
  off(type: string, handler: EventHandler): void;

  /**
   * Subscribe to all events in a category.
   */
  onCategory(category: EventCategory, handler: EventHandler): Unsubscribe;

  /**
   * Subscribe using wildcard patterns.
   * '*' matches single segment, '**' matches any depth.
   * Examples: 'agent.*', 'channel.message.**', 'plugin.*.status'
   */
  onPattern(pattern: string, handler: EventHandler): Unsubscribe;

  /**
   * Wait for a specific event type. Returns a promise that resolves
   * with the first matching event, or rejects on timeout.
   * Defaults to 30s timeout to prevent handler leaks.
   */
  waitFor<K extends EventType>(
    type: K,
    timeoutMs?: number,
  ): Promise<TypedEvent<EventPayload<K>>>;

  /**
   * Remove all handlers (for testing/cleanup).
   */
  clear(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/** Maximum number of listeners allowed per event type / category / pattern. */
const MAX_LISTENERS_PER_EVENT = 100;

export class EventBus implements IEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private categoryHandlers = new Map<EventCategory, Set<EventHandler>>();
  private patternHandlers = new Map<string, Set<EventHandler>>();

  // --- Typed emit ---

  emit<K extends EventType>(type: K, source: string, data: EventPayload<K>): void {
    const event: TypedEvent<EventPayload<K>> = {
      type,
      category: deriveCategory(type),
      timestamp: new Date().toISOString(),
      source,
      data,
    };
    this.dispatch(event);
  }

  emitRaw<T = unknown>(event: TypedEvent<T>): void {
    this.dispatch(event);
  }

  // --- Subscriptions ---

  on<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe {
    return this.addHandler(type, handler as EventHandler);
  }

  once<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe {
    const wrappedHandler: EventHandler = (event) => {
      unsub();
      return (handler as EventHandler)(event);
    };
    const unsub = this.addHandler(type, wrappedHandler);
    return unsub;
  }

  onAny(type: string, handler: EventHandler): Unsubscribe {
    return this.addHandler(type, handler);
  }

  off(type: string, handler: EventHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  onCategory(category: EventCategory, handler: EventHandler): Unsubscribe {
    if (!this.categoryHandlers.has(category)) {
      this.categoryHandlers.set(category, new Set());
    }
    const set = this.categoryHandlers.get(category)!;
    if (set.size >= MAX_LISTENERS_PER_EVENT) {
      console.warn(
        `[EventBus] Max listeners (${MAX_LISTENERS_PER_EVENT}) reached for category "${category}". ` +
        `Handler not added. Possible memory leak.`,
      );
      return () => {};
    }
    set.add(handler);
    return () => {
      const s = this.categoryHandlers.get(category);
      if (s) {
        s.delete(handler);
        if (s.size === 0) this.categoryHandlers.delete(category);
      }
    };
  }

  onPattern(pattern: string, handler: EventHandler): Unsubscribe {
    if (!this.patternHandlers.has(pattern)) {
      this.patternHandlers.set(pattern, new Set());
    }
    const set = this.patternHandlers.get(pattern)!;
    if (set.size >= MAX_LISTENERS_PER_EVENT) {
      console.warn(
        `[EventBus] Max listeners (${MAX_LISTENERS_PER_EVENT}) reached for pattern "${pattern}". ` +
        `Handler not added. Possible memory leak.`,
      );
      return () => {};
    }
    set.add(handler);
    return () => {
      const s = this.patternHandlers.get(pattern);
      if (s) {
        s.delete(handler);
        if (s.size === 0) this.patternHandlers.delete(pattern);
      }
    };
  }

  waitFor<K extends EventType>(
    type: K,
    timeoutMs: number = 30_000,
  ): Promise<TypedEvent<EventPayload<K>>> {
    return new Promise((resolve, reject) => {
      const unsub = this.once(type, ((event: TypedEvent<EventPayload<K>>) => {
        clearTimeout(timer);
        resolve(event);
      }) as EventHandler<EventPayload<K>>);

      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`waitFor('${type}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  clear(): void {
    this.handlers.clear();
    this.categoryHandlers.clear();
    this.patternHandlers.clear();
  }

  // --- Internal ---

  private addHandler(type: string, handler: EventHandler): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type)!;
    if (set.size >= MAX_LISTENERS_PER_EVENT) {
      console.warn(
        `[EventBus] Max listeners (${MAX_LISTENERS_PER_EVENT}) reached for "${type}". ` +
        `Handler not added. Possible memory leak.`,
      );
      return () => {};
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Dispatch an event to all matching subscribers:
   * 1. Exact type match
   * 2. Category match
   * 3. Pattern match
   */
  private dispatch<T>(event: TypedEvent<T>): void {
    // Snapshot handler sets before iteration to prevent concurrent modification
    // when handlers unsubscribe themselves or others during dispatch.

    // 1. Exact type match
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of [...typeHandlers]) {
        this.safeCall(handler, event);
      }
    }

    // 2. Category match
    const catHandlers = this.categoryHandlers.get(event.category);
    if (catHandlers) {
      for (const handler of [...catHandlers]) {
        this.safeCall(handler, event);
      }
    }

    // 3. Pattern match
    for (const [pattern, patHandlers] of [...this.patternHandlers]) {
      if (this.matchPattern(pattern, event.type)) {
        for (const handler of [...patHandlers]) {
          this.safeCall(handler, event);
        }
      }
    }
  }

  /**
   * Fire-and-forget handler execution.
   * Async handlers run without blocking; errors are logged but never propagate.
   */
  private safeCall<T>(handler: EventHandler<T>, event: TypedEvent<T>): void {
    try {
      const result = handler(event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.error(`[EventBus] Async handler error for "${event.type}":`, err);
        });
      }
    } catch (err) {
      console.error(`[EventBus] Handler error for "${event.type}":`, err);
    }
  }

  /**
   * Match a dot-delimited pattern against an event type.
   * Supports '*' (single segment) and '**' (any depth).
   */
  private matchPattern(pattern: string, type: string): boolean {
    const patternParts = pattern.split('.');
    const typeParts = type.split('.');
    return this.matchParts(patternParts, 0, typeParts, 0);
  }

  private matchParts(
    pattern: string[], pi: number,
    type: string[], ti: number,
  ): boolean {
    while (pi < pattern.length && ti < type.length) {
      if (pattern[pi] === '**') {
        for (let i = ti; i <= type.length; i++) {
          if (this.matchParts(pattern, pi + 1, type, i)) return true;
        }
        return false;
      }
      if (pattern[pi] !== '*' && pattern[pi] !== type[ti]) {
        return false;
      }
      pi++;
      ti++;
    }
    while (pi < pattern.length && pattern[pi] === '**') pi++;
    return pi === pattern.length && ti === type.length;
  }
}

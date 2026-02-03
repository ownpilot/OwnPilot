/**
 * ScopedEventBus - Auto-Prefixed Event Namespace
 *
 * Provides a scoped view into the global event system.
 * Events emitted through a scoped bus are auto-prefixed before
 * reaching the global bus.
 *
 * Example:
 *   const channelBus = eventSystem.scoped('channel', 'channel-manager');
 *   channelBus.emit('connected', data);
 *   // → global bus receives 'channel.connected' from source 'channel-manager'
 *
 *   channelBus.on('connected', handler);
 *   // → subscribes to 'channel.connected' on global bus
 */

import type { EventHandler, HookHandler, HookContext, Unsubscribe } from './types.js';
import type { IEventBus } from './event-bus.js';
import type { IHookBus } from './hook-bus.js';

// ============================================================================
// Interfaces
// ============================================================================

export interface IScopedHookBus {
  /** Register a hook handler with auto-prefixed hook name. */
  tap(hook: string, handler: HookHandler, priority?: number): Unsubscribe;
  /** Call a hook with auto-prefixed hook name. */
  call(hook: string, data: unknown): Promise<HookContext>;
}

export interface IScopedBus {
  /** The prefix this scoped bus applies (e.g. 'channel') */
  readonly prefix: string;
  /** Default source for events emitted through this scoped bus */
  readonly source: string;

  /**
   * Emit an event with auto-prefixed type.
   * emit('connected', data) → global bus receives '{prefix}.connected'
   */
  emit(type: string, data: unknown): void;

  /**
   * Subscribe to events within this scope.
   * on('connected', handler) → subscribes to '{prefix}.connected' on global bus.
   */
  on(type: string, handler: EventHandler): Unsubscribe;

  /**
   * Subscribe once to events within this scope.
   */
  once(type: string, handler: EventHandler): Unsubscribe;

  /**
   * Subscribe to all events within this scope (prefix.* pattern).
   */
  onAll(handler: EventHandler): Unsubscribe;

  /**
   * Create a sub-scope.
   * scoped('channel').scoped('message') → prefix 'channel.message'
   */
  scoped(subPrefix: string, source?: string): IScopedBus;

  /**
   * Scoped hook bus for interceptable operations within this namespace.
   * Uses colon prefix: hooks.tap('before-execute', ...) → 'channel:before-execute'
   */
  readonly hooks: IScopedHookBus;
}

// ============================================================================
// Implementation
// ============================================================================

export class ScopedEventBus implements IScopedBus {
  readonly prefix: string;
  readonly source: string;
  readonly hooks: IScopedHookBus;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly hookBus: IHookBus,
    prefix: string,
    source: string,
  ) {
    this.prefix = prefix;
    this.source = source;
    this.hooks = new ScopedHookBusImpl(hookBus, prefix);
  }

  emit(type: string, data: unknown): void {
    const fullType = `${this.prefix}.${type}`;
    // Use emitRaw since the full type may not be in EventMap
    this.eventBus.emitRaw({
      type: fullType,
      category: fullType.split('.')[0] as import('./types.js').EventCategory,
      timestamp: new Date().toISOString(),
      source: this.source,
      data,
    });
  }

  on(type: string, handler: EventHandler): Unsubscribe {
    const fullType = `${this.prefix}.${type}`;
    return this.eventBus.onAny(fullType, handler);
  }

  once(type: string, handler: EventHandler): Unsubscribe {
    const fullType = `${this.prefix}.${type}`;
    const wrappedHandler: EventHandler = (event) => {
      unsub();
      return handler(event);
    };
    const unsub = this.eventBus.onAny(fullType, wrappedHandler);
    return unsub;
  }

  onAll(handler: EventHandler): Unsubscribe {
    return this.eventBus.onPattern(`${this.prefix}.**`, handler);
  }

  scoped(subPrefix: string, source?: string): IScopedBus {
    return new ScopedEventBus(
      this.eventBus,
      this.hookBus,
      `${this.prefix}.${subPrefix}`,
      source ?? this.source,
    );
  }
}

class ScopedHookBusImpl implements IScopedHookBus {
  constructor(
    private readonly hookBus: IHookBus,
    private readonly prefix: string,
  ) {}

  tap(hook: string, handler: HookHandler, priority?: number): Unsubscribe {
    const fullHook = `${this.prefix}:${hook}`;
    return this.hookBus.tapAny(fullHook, handler, priority);
  }

  async call(hook: string, data: unknown): Promise<HookContext> {
    const fullHook = `${this.prefix}:${hook}`;
    return this.hookBus.callAny(fullHook, data);
  }
}

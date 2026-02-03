/**
 * EventSystem - Unified Event & Hook Facade
 *
 * Single entry point combining:
 * - EventBus (fire-and-forget notifications)
 * - HookBus (sequential interceptable hooks)
 * - ScopedEventBus (auto-prefixed namespaces)
 *
 * Usage:
 *   const system = getEventSystem();
 *
 *   // Events (fire-and-forget)
 *   system.emit('agent.complete', 'orchestrator', { agentId: '...', ... });
 *   system.on('tool.executed', (event) => console.log(event.data.name));
 *
 *   // Hooks (interceptable)
 *   system.hooks.tap('tool:before-execute', async (ctx) => {
 *     if (isBadArgs(ctx.data.args)) ctx.cancelled = true;
 *   });
 *   const result = await system.hooks.call('tool:before-execute', { ... });
 *
 *   // Scoped (auto-prefix)
 *   const channelBus = system.scoped('channel', 'channel-manager');
 *   channelBus.emit('connected', data); // → 'channel.connected'
 */

import type { EventType, EventPayload } from './event-map.js';
import type { TypedEvent, EventHandler, Unsubscribe, EventCategory } from './types.js';
import type { IEventBus } from './event-bus.js';
import type { IHookBus } from './hook-bus.js';
import type { IScopedBus } from './scoped-bus.js';

import { EventBus } from './event-bus.js';
import { HookBus } from './hook-bus.js';
import { ScopedEventBus } from './scoped-bus.js';

// ============================================================================
// Interface
// ============================================================================

export interface IEventSystem extends IEventBus {
  /** Hook bus for interceptable operations */
  readonly hooks: IHookBus;

  /** Create a scoped event bus with auto-prefixed event types */
  scoped(prefix: string, source?: string): IScopedBus;
}

// ============================================================================
// Implementation
// ============================================================================

export class EventSystem implements IEventSystem {
  private readonly eventBus: EventBus;
  readonly hooks: IHookBus;

  constructor() {
    this.eventBus = new EventBus();
    this.hooks = new HookBus();
  }

  // --- Delegate to EventBus ---

  emit<K extends EventType>(type: K, source: string, data: EventPayload<K>): void {
    this.eventBus.emit(type, source, data);
  }

  emitRaw<T = unknown>(event: TypedEvent<T>): void {
    this.eventBus.emitRaw(event);
  }

  on<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe {
    return this.eventBus.on(type, handler);
  }

  once<K extends EventType>(type: K, handler: EventHandler<EventPayload<K>>): Unsubscribe {
    return this.eventBus.once(type, handler);
  }

  onAny(type: string, handler: EventHandler): Unsubscribe {
    return this.eventBus.onAny(type, handler);
  }

  off(type: string, handler: EventHandler): void {
    this.eventBus.off(type, handler);
  }

  onCategory(category: EventCategory, handler: EventHandler): Unsubscribe {
    return this.eventBus.onCategory(category, handler);
  }

  onPattern(pattern: string, handler: EventHandler): Unsubscribe {
    return this.eventBus.onPattern(pattern, handler);
  }

  waitFor<K extends EventType>(
    type: K,
    timeoutMs?: number,
  ): Promise<TypedEvent<EventPayload<K>>> {
    return this.eventBus.waitFor(type, timeoutMs);
  }

  // --- Scoped bus ---

  scoped(prefix: string, source?: string): IScopedBus {
    return new ScopedEventBus(
      this.eventBus,
      this.hooks as HookBus,
      prefix,
      source ?? prefix,
    );
  }

  // --- Clear ---

  clear(): void {
    this.eventBus.clear();
    this.hooks.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalEventSystem: EventSystem | null = null;

/**
 * Get the global EventSystem singleton.
 * Creates one on first call.
 */
export function getEventSystem(): IEventSystem {
  if (!globalEventSystem) {
    globalEventSystem = new EventSystem();
  }
  return globalEventSystem;
}

/**
 * Reset the global EventSystem (for testing).
 */
export function resetEventSystem(): void {
  if (globalEventSystem) {
    globalEventSystem.clear();
  }
  globalEventSystem = null;
}

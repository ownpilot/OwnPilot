/**
 * Gateway Event System
 *
 * Backed by unified EventSystem from @ownpilot/core.
 * GatewayEventEmitter wraps a ScopedBus with 'gateway' prefix.
 * ClientEventHandler wraps HookBus with 'client:' prefix.
 *
 * ServerEvents colon keys (channel:connected) are converted to dots
 * so they flow through the global bus as gateway.channel.connected.
 */

import {
  getEventSystem,
  type IScopedBus,
  type IHookBus,
  type TypedEvent,
} from '@ownpilot/core';
import type { ServerEvents, ClientEvents } from './types.js';
import { getLog } from '../services/log.js';

const _log = getLog('WSEvents');

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/** Convert colon-separated keys to dot-separated for the unified bus */
function toDot(key: string): string {
  return key.replace(/:/g, '.');
}

/**
 * Type-safe event emitter backed by ScopedBus.
 * Emitting 'channel:connected' flows to global bus as 'gateway.channel.connected'.
 */
export class GatewayEventEmitter {
  private bus: IScopedBus;

  constructor() {
    this.bus = getEventSystem().scoped('gateway', 'gateway');
  }

  /**
   * Subscribe to a server event
   */
  on<K extends keyof ServerEvents>(
    event: K,
    handler: EventHandler<ServerEvents[K]>
  ): () => void {
    return this.bus.on(toDot(event), (e: TypedEvent) => handler(e.data as ServerEvents[K]));
  }

  /**
   * Subscribe to any event (for logging/debugging)
   */
  onAny(handler: (event: string, data: unknown) => void): () => void {
    return this.bus.onAll((e: TypedEvent) => handler(e.type, e.data));
  }

  /**
   * Emit a server event
   */
  async emit<K extends keyof ServerEvents>(
    event: K,
    data: ServerEvents[K]
  ): Promise<void> {
    this.bus.emit(toDot(event), data);
  }

}

/**
 * Client event handler registry backed by HookBus.
 * Each client event is registered as a hook (client:chat.send, client:channel.connect, etc.)
 */
export class ClientEventHandler {
  private hookBus: IHookBus;
  private registeredEvents = new Set<string>();
  private unsubs: (() => void)[] = [];

  constructor() {
    this.hookBus = getEventSystem().hooks;
  }

  /**
   * Register a handler for a client event
   */
  handle<K extends keyof ClientEvents>(
    event: K,
    handler: (data: ClientEvents[K], sessionId?: string) => void | Promise<void>
  ): void {
    const hookName = `client:${toDot(event)}`;
    this.registeredEvents.add(event);
    const unsub = this.hookBus.tapAny(hookName, async (ctx) => {
      const { sessionId, ...data } = ctx.data as Record<string, unknown>;
      await handler(data as ClientEvents[K], sessionId as string | undefined);
    });
    this.unsubs.push(unsub);
  }

  /**
   * Process an incoming client event
   */
  async process<K extends keyof ClientEvents>(
    event: K,
    data: ClientEvents[K],
    sessionId?: string
  ): Promise<void> {
    const hookName = `client:${toDot(event)}`;
    const payload = { ...data, sessionId } as Record<string, unknown>;
    await this.hookBus.callAny(hookName, payload);
  }

  /**
   * Check if a handler exists
   */
  has<K extends keyof ClientEvents>(event: K): boolean {
    return this.registeredEvents.has(event);
  }

  /**
   * Cleanup all registered handlers
   */
  clear(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.registeredEvents.clear();
  }
}

/**
 * Global gateway event emitter instance
 */
export const gatewayEvents = new GatewayEventEmitter();

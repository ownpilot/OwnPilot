/**
 * Gateway Event System
 *
 * Type-safe event emitter for gateway events
 */

import type { ServerEvents, ClientEvents } from './types.js';

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;
type ClientEventHandler_Fn<T = unknown> = (data: T, sessionId?: string) => void | Promise<void>;

/**
 * Type-safe event emitter
 */
export class GatewayEventEmitter {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to a server event
   */
  on<K extends keyof ServerEvents>(
    event: K,
    handler: EventHandler<ServerEvents[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    const handlers = this.handlers.get(event)!;
    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  /**
   * Subscribe to any event (for logging/debugging)
   */
  onAny(handler: (event: string, data: unknown) => void): () => void {
    const wrappedHandler = handler as EventHandler;
    if (!this.handlers.has('*')) {
      this.handlers.set('*', new Set());
    }

    this.handlers.get('*')!.add(wrappedHandler);

    return () => {
      this.handlers.get('*')?.delete(wrappedHandler);
    };
  }

  /**
   * Emit a server event
   */
  async emit<K extends keyof ServerEvents>(
    event: K,
    data: ServerEvents[K]
  ): Promise<void> {
    // Call specific handlers
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      }
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await (handler as (event: string, data: unknown) => void)(event, data);
        } catch (error) {
          console.error(`Error in wildcard handler for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Remove all handlers for an event
   */
  off<K extends keyof ServerEvents>(event: K): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all handlers
   */
  removeAllListeners(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count for an event
   */
  listenerCount<K extends keyof ServerEvents>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

/**
 * Client event handler registry
 */
export class ClientEventHandler {
  private handlers = new Map<string, ClientEventHandler_Fn>();

  /**
   * Register a handler for a client event
   */
  handle<K extends keyof ClientEvents>(
    event: K,
    handler: ClientEventHandler_Fn<ClientEvents[K]>
  ): void {
    this.handlers.set(event, handler as ClientEventHandler_Fn);
  }

  /**
   * Process an incoming client event
   */
  async process<K extends keyof ClientEvents>(
    event: K,
    data: ClientEvents[K],
    sessionId?: string
  ): Promise<void> {
    const handler = this.handlers.get(event);
    if (handler) {
      await handler(data, sessionId);
    } else {
      console.warn(`No handler registered for client event: ${event}`);
    }
  }

  /**
   * Check if a handler exists
   */
  has<K extends keyof ClientEvents>(event: K): boolean {
    return this.handlers.has(event);
  }
}

/**
 * Global gateway event emitter instance
 */
export const gatewayEvents = new GatewayEventEmitter();

/**
 * UCP Pipeline
 *
 * Processes UCPMessages through a middleware chain.
 * Separate pipelines for inbound and outbound messages.
 *
 * This is the channel-level pipeline that runs BEFORE the core MessageBus.
 * It handles UCP-specific concerns: rate limiting, thread tracking,
 * language detection, content adaptation, and bridging.
 */

import type { UCPMessage } from './types.js';
import type { UCPMiddleware, NamedUCPMiddleware } from './middleware/types.js';

export class UCPPipeline {
  private inbound: NamedUCPMiddleware[] = [];
  private outbound: NamedUCPMiddleware[] = [];

  /**
   * Add middleware for inbound messages.
   */
  useInbound(name: string, fn: UCPMiddleware): this {
    this.inbound.push({ name, fn });
    return this;
  }

  /**
   * Add middleware for outbound messages.
   */
  useOutbound(name: string, fn: UCPMiddleware): this {
    this.outbound.push({ name, fn });
    return this;
  }

  /**
   * Add middleware for both inbound and outbound.
   */
  use(name: string, fn: UCPMiddleware): this {
    this.inbound.push({ name, fn });
    this.outbound.push({ name, fn });
    return this;
  }

  /**
   * Process an inbound message through the inbound middleware chain.
   */
  async processInbound(msg: UCPMessage): Promise<UCPMessage> {
    return this.runChain(msg, this.inbound);
  }

  /**
   * Process an outbound message through the outbound middleware chain.
   */
  async processOutbound(msg: UCPMessage): Promise<UCPMessage> {
    return this.runChain(msg, this.outbound);
  }

  /**
   * Get the names of registered inbound middleware.
   */
  getInboundNames(): string[] {
    return this.inbound.map((m) => m.name);
  }

  /**
   * Get the names of registered outbound middleware.
   */
  getOutboundNames(): string[] {
    return this.outbound.map((m) => m.name);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Execute a middleware chain in order.
   * Each middleware calls `next()` to pass to the next one.
   */
  private async runChain(msg: UCPMessage, chain: NamedUCPMiddleware[]): Promise<UCPMessage> {
    let index = 0;
    let current = msg;

    const next = async (): Promise<UCPMessage> => {
      if (index >= chain.length) {
        return current;
      }

      const mw = chain[index++]!;
      current = await mw.fn(current, next);
      return current;
    };

    return next();
  }
}

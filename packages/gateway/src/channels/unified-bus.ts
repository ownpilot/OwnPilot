/**
 * UnifiedChannelBus
 *
 * Central message routing hub that connects channel adapters to the UCP pipeline.
 * All channel messages (inbound and outbound) flow through this bus for unified
 * middleware processing (rate limiting, thread tracking, language detection).
 *
 * Architecture:
 *   Platform SDK -> Adapter.normalize() -> Bus.processInbound() [middleware] -> ChannelServiceImpl
 *   Platform SDK <- Adapter.denormalize() <- Bus.processOutbound() [middleware] <- response
 */

import {
  UCPPipeline,
  type UCPChannelAdapter,
  type UCPMessage,
  rateLimiter,
  threadTracker,
  languageDetector,
  createInMemoryThreadStore,
} from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('UnifiedChannelBus');

export class UnifiedChannelBus {
  private pipeline: UCPPipeline;
  private adapters = new Map<string, UCPChannelAdapter>();

  constructor() {
    this.pipeline = new UCPPipeline();

    // Wire default middleware
    const threadStore = createInMemoryThreadStore();
    this.pipeline.useInbound('language-detector', languageDetector());
    this.pipeline.useInbound('thread-tracker', threadTracker(threadStore));
    this.pipeline.useOutbound('rate-limiter', rateLimiter());
    this.pipeline.useOutbound('thread-tracker', threadTracker(threadStore));

    log.info('UnifiedChannelBus initialized', {
      inbound: this.pipeline.getInboundNames(),
      outbound: this.pipeline.getOutboundNames(),
    });
  }

  /**
   * Register a UCP channel adapter.
   * Once registered, messages for this channel will flow through the UCP pipeline.
   */
  registerAdapter(channelId: string, adapter: UCPChannelAdapter): void {
    this.adapters.set(channelId, adapter);
    log.info('Adapter registered', { channelId, platform: adapter.getPlatform() });
  }

  /**
   * Unregister a channel adapter.
   */
  unregisterAdapter(channelId: string): void {
    this.adapters.delete(channelId);
    log.info('Adapter unregistered', { channelId });
  }

  /**
   * Check if a channel has a registered UCP adapter.
   */
  hasAdapter(channelId: string): boolean {
    return this.adapters.has(channelId);
  }

  /**
   * Get a registered adapter.
   */
  getAdapter(channelId: string): UCPChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  /**
   * Get all registered adapter entries.
   */
  getAdapters(): Map<string, UCPChannelAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Process an inbound message through the UCP middleware pipeline.
   * Called after the adapter normalizes a platform message to UCPMessage.
   */
  async processInbound(msg: UCPMessage): Promise<UCPMessage> {
    return this.pipeline.processInbound(msg);
  }

  /**
   * Process an outbound message through the UCP middleware pipeline.
   * Called before the adapter denormalizes for platform delivery.
   */
  async processOutbound(msg: UCPMessage): Promise<UCPMessage> {
    return this.pipeline.processOutbound(msg);
  }

  /**
   * Send a UCPMessage to a specific channel.
   * Processes through outbound pipeline, then adapter.sendUCPMessage().
   * Returns the platform message ID.
   */
  async sendToChannel(channelId: string, msg: UCPMessage): Promise<string> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${channelId}`);
    }

    const processed = await this.pipeline.processOutbound(msg);
    return adapter.sendUCPMessage(processed);
  }

  /**
   * Normalize a raw platform message using the registered adapter.
   * Returns the normalized UCPMessage after running through inbound pipeline.
   */
  async normalizeInbound(channelId: string, raw: unknown): Promise<UCPMessage> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${channelId}`);
    }

    const normalized = adapter.normalize(raw);
    return this.pipeline.processInbound(normalized);
  }

  /**
   * Get the underlying pipeline (for custom middleware registration).
   */
  getPipeline(): UCPPipeline {
    return this.pipeline;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: UnifiedChannelBus | null = null;

/**
 * Get or create the UnifiedChannelBus singleton.
 */
export function getUnifiedBus(): UnifiedChannelBus {
  if (!instance) {
    instance = new UnifiedChannelBus();
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetUnifiedBus(): void {
  instance = null;
}

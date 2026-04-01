/**
 * Channel Hub 2.0 - Main Service
 *
 * Central service for managing all channels with:
 * - Universal adapter management
 * - Health monitoring
 * - Message routing
 * - E2E encryption coordination
 */

import { getLog } from '../../services/log.js';
import type { UniversalChannelAdapter, MessageHandler } from './universal-adapter.js';
import type {
  ChannelStatus,
  ChannelHealth,
  HubOutgoingMessage,
  QuickConnectInput,
  QuickConnectResult,
  ChannelSummary,
  ChannelEvent,
  ChannelEventHandler,
} from './types.js';
import { ConnectionWizard } from './connection-wizard.js';
import { getGlobalHealthMonitor } from './health-monitor.js';

const log = getLog('ChannelHub');

export interface HubOptions {
  enableHealthMonitoring: boolean;
  enableAutoRetry: boolean;
  maxChannels: number;
  defaultPrivacyLevel: 'standard' | 'enhanced' | 'paranoid';
}

export class ChannelHub {
  private adapters = new Map<string, UniversalChannelAdapter>();
  private wizard: ConnectionWizard;
  private healthMonitor: ReturnType<typeof getGlobalHealthMonitor>;
  private options: HubOptions;
  private globalMessageHandler?: MessageHandler;
  private eventHandlers = new Map<ChannelEvent['type'], Set<ChannelEventHandler>>();

  constructor(options: Partial<HubOptions> = {}) {
    this.options = {
      enableHealthMonitoring: true,
      enableAutoRetry: true,
      maxChannels: 50,
      defaultPrivacyLevel: 'enhanced',
      ...options,
    };

    this.wizard = new ConnectionWizard();
    this.healthMonitor = getGlobalHealthMonitor();

    if (this.options.enableHealthMonitoring) {
      this.healthMonitor.start();
    }

    log.info('Channel Hub 2.0 initialized');
  }

  // ========================================================================
  // Channel Management
  // ========================================================================

  /**
   * Quick connect a new channel.
   */
  async quickConnect(input: QuickConnectInput): Promise<QuickConnectResult> {
    if (this.adapters.size >= this.options.maxChannels) {
      throw new Error(`Maximum channel limit (${this.options.maxChannels}) reached`);
    }

    const result = await this.wizard.quickConnect(input);

    if (result.status === 'connected') {
      log.info(`Channel connected: ${result.channelId} (${input.platform})`);
    }

    return result;
  }

  /**
   * Register a channel adapter directly.
   */
  registerChannel(adapter: UniversalChannelAdapter): void {
    // We need to access the config - this is a design issue
    // For now, we'll use a workaround
    log.info(`Registering channel adapter`);

    // Start monitoring
    if (this.options.enableHealthMonitoring) {
      this.healthMonitor.monitor('unknown', adapter);
    }

    // Setup message handler
    if (this.globalMessageHandler) {
      adapter.onMessage(this.globalMessageHandler);
    }

    // Listen to events
    this.setupAdapterEvents(adapter);
  }

  /**
   * Disconnect and remove a channel.
   */
  async removeChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    log.info(`Removing channel: ${channelId}`);

    // Stop monitoring
    this.healthMonitor.unmonitor(channelId);

    // Disconnect
    await adapter.disconnect();

    // Remove from registry
    this.adapters.delete(channelId);

    // Emit event
    this.emitEvent({
      type: 'channel.disconnected',
      channelId,
      timestamp: new Date(),
      payload: { reason: 'manual_remove' },
    });
  }

  /**
   * Get a channel adapter by ID.
   */
  getChannel(channelId: string): UniversalChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  /**
   * Get all channels.
   */
  getAllChannels(): Map<string, UniversalChannelAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Get channel summaries for UI.
   */
  getChannelSummaries(): ChannelSummary[] {
    const summaries: ChannelSummary[] = [];

    for (const [channelId, adapter] of this.adapters) {
      const health = adapter.getHealth();

      summaries.push({
        id: channelId,
        name: channelId, // TODO: Store name in adapter
        platform: 'unknown', // TODO: Store platform in adapter
        status: adapter.getStatus(),
        privacyLevel: 'standard', // TODO: Store privacy config
        health: health.status,
        lastActivity: health.lastActivity,
        messageCount: health.throughput.messagesSent + health.throughput.messagesReceived,
      });
    }

    return summaries.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  // ========================================================================
  // Message Operations
  // ========================================================================

  /**
   * Send a message through a specific channel.
   */
  async sendMessage(
    channelId: string,
    message: HubOutgoingMessage
  ): Promise<string> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    return adapter.send(message);
  }

  /**
   * Send a message to all channels (broadcast).
   */
  async broadcastMessage(
    message: Omit<HubOutgoingMessage, 'channelId'>,
    filters?: { platform?: string[]; status?: ChannelStatus[] }
  ): Promise<Map<string, { success: boolean; messageId?: string; error?: string }>> {
    const results = new Map<string, { success: boolean; messageId?: string; error?: string }>();

    for (const [channelId, adapter] of this.adapters) {
      // Apply filters
      if (filters?.status && !filters.status.includes(adapter.getStatus())) {
        continue;
      }

      try {
        const fullMessage: HubOutgoingMessage = {
          ...message,
          channelId,
        };
        const messageId = await adapter.send(fullMessage);
        results.set(channelId, { success: true, messageId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(channelId, { success: false, error: errorMessage });
      }
    }

    return results;
  }

  /**
   * Register a global message handler for all channels.
   */
  onMessage(handler: MessageHandler): () => void {
    this.globalMessageHandler = handler;

    // Register with all existing adapters
    for (const adapter of this.adapters.values()) {
      adapter.onMessage(handler);
    }

    // Return unsubscribe function
    return () => {
      this.globalMessageHandler = undefined;
    };
  }

  // ========================================================================
  // Health & Monitoring
  // ========================================================================

  /**
   * Get health for a specific channel.
   */
  getChannelHealth(channelId: string): ChannelHealth | null {
    return this.healthMonitor.getChannelHealth(channelId);
  }

  /**
   * Get health for all channels.
   */
  getAllHealth(): Map<string, ChannelHealth> {
    return this.healthMonitor.getAllHealth();
  }

  /**
   * Get system-wide health summary.
   */
  getSystemHealth(): {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    disconnected: number;
    avgLatency: number;
    totalMessages: number;
  } {
    return this.healthMonitor.getSystemHealth();
  }

  /**
   * Force health check on all channels.
   */
  async checkAllHealth(): Promise<void> {
    await this.healthMonitor.checkAll();
  }

  // ========================================================================
  // Events
  // ========================================================================

  /**
   * Subscribe to channel events.
   */
  onEvent<T extends ChannelEvent['type']>(
    type: T,
    handler: ChannelEventHandler
  ): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }

    this.eventHandlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(type)?.delete(handler);
    };
  }

  /**
   * Pause a channel.
   */
  async pauseChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    await adapter.pause();
    log.info(`Channel paused: ${channelId}`);
  }

  /**
   * Resume a channel.
   */
  async resumeChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    await adapter.resume();
    log.info(`Channel resumed: ${channelId}`);
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private setupAdapterEvents(adapter: UniversalChannelAdapter): void {
    adapter.on('channel:status_changed', (event) => {
      this.emitEvent({
        type: 'channel.health.changed',
        channelId: event.channelId,
        timestamp: new Date(),
        payload: event,
      });
    });

    adapter.on('channel:error', (event) => {
      this.emitEvent({
        type: 'channel.error',
        channelId: event.channelId,
        timestamp: new Date(),
        payload: event,
      });
    });

    adapter.on('message:received', (event) => {
      this.emitEvent({
        type: 'message.received',
        channelId: event.channelId,
        timestamp: new Date(),
        payload: event,
      });
    });

    adapter.on('message:sent', (event) => {
      this.emitEvent({
        type: 'message.sent',
        channelId: event.channelId,
        timestamp: new Date(),
        payload: event,
      });
    });
  }

  private emitEvent(event: ChannelEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          log.error('Error in event handler:', error);
        }
      }
    }
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Disconnect all channels and cleanup.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Channel Hub...');

    // Stop health monitoring
    this.healthMonitor.stop();

    // Disconnect all channels
    const disconnectPromises: Promise<void>[] = [];
    for (const [channelId, adapter] of this.adapters) {
      disconnectPromises.push(
        adapter.disconnect().catch((error) => {
          log.error(`Error disconnecting channel ${channelId}:`, error);
        })
      );
    }

    await Promise.all(disconnectPromises);

    // Clear registry
    this.adapters.clear();

    log.info('Channel Hub shutdown complete');
  }
}

/**
 * Singleton instance.
 */
let globalHub: ChannelHub | null = null;

export function getGlobalChannelHub(): ChannelHub {
  if (!globalHub) {
    globalHub = new ChannelHub();
  }
  return globalHub;
}

export function resetGlobalChannelHub(): void {
  globalHub = null;
}

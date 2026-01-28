/**
 * Channel Manager
 *
 * Manages all channel adapters and integrates with the WebSocket gateway
 */

import type { ChannelType, ChannelStatus, Channel, IncomingMessage, OutgoingMessage } from '../ws/types.js';
import type { ChannelAdapter, AnyChannelConfig, ChannelAdapterFactory } from './types.js';
import { gatewayEvents } from '../ws/events.js';
import { sessionManager } from '../ws/session.js';

/**
 * Channel Manager
 *
 * Central registry for all channel adapters
 */
export class ChannelManager {
  private adapters = new Map<string, ChannelAdapter>();
  private factories = new Map<ChannelType, ChannelAdapterFactory>();

  /**
   * Register a channel adapter factory
   */
  registerFactory<T extends AnyChannelConfig>(
    type: ChannelType,
    factory: ChannelAdapterFactory<T>
  ): void {
    this.factories.set(type, factory as ChannelAdapterFactory);
    console.log(`Registered channel factory: ${type}`);
  }

  /**
   * Create and connect a channel
   */
  async connect(config: AnyChannelConfig): Promise<ChannelAdapter> {
    // Check if already exists
    if (this.adapters.has(config.id)) {
      throw new Error(`Channel ${config.id} already exists`);
    }

    // Get factory
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(`No factory registered for channel type: ${config.type}`);
    }

    // Create adapter
    const adapter = factory(config);

    // Setup event forwarding to WebSocket gateway
    this.setupEventForwarding(adapter);

    // Store adapter
    this.adapters.set(config.id, adapter);

    // Connect
    try {
      await adapter.connect();
      console.log(`Channel connected: ${config.type}:${config.id}`);

      // Emit connected event
      await gatewayEvents.emit('channel:connected', {
        channel: this.getChannelInfo(adapter),
      });
    } catch (error) {
      // Remove adapter on connection failure
      this.adapters.delete(config.id);
      throw error;
    }

    return adapter;
  }

  /**
   * Disconnect a channel
   */
  async disconnect(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    await adapter.disconnect();
    this.adapters.delete(channelId);

    // Emit disconnected event
    await gatewayEvents.emit('channel:disconnected', {
      channelId,
    });

    console.log(`Channel disconnected: ${channelId}`);
  }

  /**
   * Get a channel adapter
   */
  get(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  /**
   * Get all connected channels
   */
  getAll(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get all channels of a specific type
   */
  getByType(type: ChannelType): ChannelAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.type === type);
  }

  /**
   * Check if a channel exists
   */
  has(channelId: string): boolean {
    return this.adapters.has(channelId);
  }

  /**
   * Send message to a channel
   */
  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    try {
      const messageId = await adapter.sendMessage(message);

      // Emit success event
      await gatewayEvents.emit('channel:message:sent', {
        channelId,
        messageId,
      });

      return messageId;
    } catch (error) {
      // Emit error event
      await gatewayEvents.emit('channel:message:error', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Broadcast message to all channels of a type
   */
  async broadcast(type: ChannelType, message: OutgoingMessage): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const adapters = this.getByType(type);

    for (const adapter of adapters) {
      try {
        const messageId = await adapter.sendMessage(message);
        results.set(adapter.id, messageId);
      } catch (error) {
        console.error(`Failed to send to ${adapter.id}:`, error);
      }
    }

    return results;
  }

  /**
   * Get channel info for a specific adapter
   */
  private getChannelInfo(adapter: ChannelAdapter): Channel {
    return {
      id: adapter.id,
      type: adapter.type,
      name: adapter.name,
      status: adapter.status,
      connectedAt: adapter.status === 'connected' ? new Date() : undefined,
      config: {},
    };
  }

  /**
   * Process incoming channel message with AI and send response
   */
  private async processChannelMessage(adapter: ChannelAdapter, message: IncomingMessage): Promise<void> {
    try {
      // Skip empty messages
      if (!message.content?.trim()) {
        return;
      }

      // Send typing indicator
      await adapter.sendTyping?.(message.channelId);

      // Get or create agent
      const { getOrCreateDefaultAgent, isDemoMode } = await import('../routes/agents.js');
      const agent = await getOrCreateDefaultAgent();

      let response: string;

      if (isDemoMode()) {
        response = `[Demo Mode] I received your message: "${message.content.substring(0, 100)}"\n\nTo get real AI responses, configure an API key (OPENAI_API_KEY or ANTHROPIC_API_KEY).`;
      } else {
        // Process with AI agent
        const result = await agent.chat(message.content, {
          stream: false,
        });

        if (result.ok) {
          response = result.value.content;
        } else {
          response = `Sorry, I encountered an error: ${result.error.message}`;
        }
      }

      // Send response back to channel
      await adapter.sendMessage({
        channelId: message.channelId,
        content: response,
        replyToId: message.id,
        metadata: message.metadata,
      });

      console.log(`[${adapter.type}:${adapter.id}] Responded to ${message.senderName}`);
    } catch (error) {
      console.error(`[${adapter.type}:${adapter.id}] Failed to process message:`, error);

      // Try to send error message
      try {
        await adapter.sendMessage({
          channelId: message.channelId,
          content: `Sorry, I encountered an error processing your message.`,
          replyToId: message.id,
          metadata: message.metadata,
        });
      } catch {
        // Ignore send errors
      }
    }
  }

  /**
   * Setup event forwarding from adapter to WebSocket gateway
   */
  private setupEventForwarding(adapter: ChannelAdapter): void {
    // Forward status changes
    adapter.on('statusChange', async (status: ChannelStatus, error?: string) => {
      await gatewayEvents.emit('channel:status', {
        channelId: adapter.id,
        status,
        error,
      });

      // Broadcast to all WebSocket sessions subscribed to this channel
      sessionManager.broadcastToChannel(adapter.id, 'channel:status', {
        channelId: adapter.id,
        status,
        error,
      });
    });

    // Forward incoming messages and process with AI
    adapter.on('message', async (message: IncomingMessage) => {
      console.log(`[${adapter.type}:${adapter.id}] Message from ${message.senderName}: ${message.content.substring(0, 100)}...`);

      await gatewayEvents.emit('channel:message', { message });

      // Broadcast to all WebSocket sessions subscribed to this channel
      sessionManager.broadcastToChannel(adapter.id, 'channel:message', {
        message,
      });

      // Process message with AI and respond
      await this.processChannelMessage(adapter, message);
    });

    // Forward errors
    adapter.on('error', (error: Error) => {
      console.error(`[${adapter.type}:${adapter.id}] Error:`, error);
    });
  }

  /**
   * Disconnect all channels
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.adapters.keys()).map((id) =>
      this.disconnect(id).catch((error) => {
        console.error(`Failed to disconnect ${id}:`, error);
      })
    );

    await Promise.all(disconnectPromises);
  }

  /**
   * Get status summary
   */
  getStatus(): {
    total: number;
    connected: number;
    disconnected: number;
    error: number;
    byType: Record<string, number>;
  } {
    const adapters = Array.from(this.adapters.values());
    const byType: Record<string, number> = {};

    for (const adapter of adapters) {
      byType[adapter.type] = (byType[adapter.type] ?? 0) + 1;
    }

    return {
      total: adapters.length,
      connected: adapters.filter((a) => a.status === 'connected').length,
      disconnected: adapters.filter((a) => a.status === 'disconnected').length,
      error: adapters.filter((a) => a.status === 'error').length,
      byType,
    };
  }
}

/**
 * Global channel manager instance
 */
export const channelManager = new ChannelManager();

/**
 * Initialize channel manager with default factories
 * This should be called during app startup
 */
export async function initializeChannelFactories(): Promise<void> {
  // Dynamically import adapters to avoid circular dependencies
  const { createTelegramAdapter } = await import('./adapters/telegram.js');
  const { createDiscordAdapter } = await import('./adapters/discord.js');
  const { createSlackAdapter } = await import('./adapters/slack.js');

  channelManager.registerFactory('telegram', createTelegramAdapter);
  channelManager.registerFactory('discord', createDiscordAdapter);
  channelManager.registerFactory('slack', createSlackAdapter);

  // WebChat doesn't need an external adapter - handled by WebSocket server
  // Matrix, WhatsApp, Signal adapters can be added when implemented

  console.log('Channel factories initialized');

  // Load and connect channels from database
  await loadChannelsFromDatabase();
}

/**
 * Load channels from database and connect them
 */
async function loadChannelsFromDatabase(): Promise<void> {
  console.log('[Channels] Loading channels from database...');
  try {
    const { channelsRepo } = await import('../db/repositories/channels.js');
    console.log('[Channels] Repository imported, getting all channels...');
    const channels = channelsRepo.getAll();
    console.log(`[Channels] Found ${channels.length} channel(s) in database.`);

    if (channels.length === 0) {
      console.log('No channels configured in database');
      return;
    }

    console.log(`Loading ${channels.length} channel(s) from database...`);

    for (const channel of channels) {
      try {
        console.log(`[Channels] Connecting ${channel.type}:${channel.name}...`);
        // Build config based on channel type
        const config = {
          id: channel.id,
          type: channel.type as ChannelType,
          name: channel.name,
          ...channel.config,
        } as AnyChannelConfig;

        // Add timeout to prevent hanging on channel connection
        const connectWithTimeout = Promise.race([
          channelManager.connect(config),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)
          ),
        ]);

        await connectWithTimeout;
        channelsRepo.updateStatus(channel.id, 'connected');
        console.log(`  [OK] ${channel.type}:${channel.name} (${channel.id})`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`  [FAIL] ${channel.type}:${channel.name}: ${errMsg}`);
        channelsRepo.updateStatus(channel.id, 'error');
      }
    }
    console.log('[Channels] Finished loading channels from database.');
  } catch (error) {
    console.error('Failed to load channels from database:', error);
  }
}

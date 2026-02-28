/**
 * Channel Service Interface
 *
 * Unified interface for accessing channels from anywhere in the system.
 * Lives in packages/core as a pure abstraction.
 * Implemented by ChannelServiceImpl in packages/gateway.
 *
 * Usage:
 *   import { getChannelService } from '@ownpilot/core';
 *   const service = getChannelService();
 *   await service.send('channel.telegram', { platformChatId: '123', text: 'Hello' });
 */

import type {
  ChannelOutgoingMessage,
  ChannelPlatform,
  ChannelPluginAPI,
  ChannelPluginInfo,
} from './types.js';
import { hasServiceRegistry, getServiceRegistry } from '../services/registry.js';
import { Services } from '../services/tokens.js';

// ============================================================================
// Service Interface
// ============================================================================

export interface IChannelService {
  /**
   * Send a message through a specific channel plugin.
   * Returns the platform-specific message ID.
   */
  send(channelPluginId: string, message: ChannelOutgoingMessage): Promise<string>;

  /**
   * Broadcast a message to all connected channels of a given platform.
   * Returns a map of channelPluginId -> platformMessageId.
   */
  broadcast(
    platform: ChannelPlatform,
    message: ChannelOutgoingMessage
  ): Promise<Map<string, string>>;

  /**
   * Broadcast a message to ALL connected channels regardless of platform.
   */
  broadcastAll(message: ChannelOutgoingMessage): Promise<Map<string, string>>;

  /**
   * Get a channel plugin's API by plugin ID.
   */
  getChannel(channelPluginId: string): ChannelPluginAPI | undefined;

  /**
   * List all registered channel plugins with their status.
   */
  listChannels(): ChannelPluginInfo[];

  /**
   * Get all channel APIs for a specific platform.
   */
  getByPlatform(platform: ChannelPlatform): ChannelPluginAPI[];

  /**
   * Connect a channel (triggers the plugin's connect() method).
   */
  connect(channelPluginId: string): Promise<void>;

  /**
   * Disconnect a channel (triggers the plugin's disconnect() method).
   * Session data is preserved — reconnecting does not require re-authentication.
   */
  disconnect(channelPluginId: string): Promise<void>;

  /**
   * Logout a channel — disconnect and clear session data.
   * Forces re-authentication on next connect (e.g. new QR scan for WhatsApp).
   * Falls back to disconnect() if the plugin does not support logout.
   */
  logout(channelPluginId: string): Promise<void>;

  /**
   * Resolve a channel user to an OwnPilot user ID (via verification mapping).
   * Returns null if the user is not verified.
   */
  resolveUser(platform: ChannelPlatform, platformUserId: string): Promise<string | null>;
}

// ============================================================================
// Singleton Access
// ============================================================================

let _channelService: IChannelService | null = null;

/**
 * Set the channel service implementation.
 * Called once during gateway startup.
 * Also registers in ServiceRegistry if available.
 */
export function setChannelService(service: IChannelService): void {
  _channelService = service;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(Services.Channel)) {
        registry.register(Services.Channel, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

/**
 * Get the channel service.
 * Tries ServiceRegistry first, falls back to direct singleton.
 */
export function getChannelService(): IChannelService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Channel);
    } catch {
      // Not registered in registry yet
    }
  }

  if (!_channelService) {
    throw new Error(
      'ChannelService not initialized. Call setChannelService() during gateway startup.'
    );
  }
  return _channelService;
}

/**
 * Check if the channel service has been initialized.
 */
export function hasChannelService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(Services.Channel);
    } catch {
      // fall through
    }
  }
  return _channelService !== null;
}

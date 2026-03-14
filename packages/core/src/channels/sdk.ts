/**
 * Channel SDK — Functional adapter creation for new channel plugins
 *
 * Provides `createChannelAdapter()` for simple channel plugin creation
 * without needing to extend UCPChannelAdapter manually.
 */

import type { ChannelPlatform, ChannelOutgoingMessage, ChannelUser } from './types.js';
import { UCPChannelAdapter } from './ucp/adapter.js';
import type { UCPMessage, UCPChannelCapabilities, UCPFeature, UCPChannelLimits } from './ucp/types.js';

/** Configuration for creating a channel adapter via SDK. */
export interface ChannelAdapterConfig {
  /** Platform identifier (e.g., 'webchat', 'sms', 'email', 'matrix') */
  platform: string;

  /** Channel capabilities declaration */
  capabilities: {
    features: UCPFeature[];
    limits?: UCPChannelLimits;
  };

  /** Connect to the platform. Called when the channel is enabled. */
  connect: () => Promise<void>;

  /** Disconnect from the platform. Called when the channel is disabled. */
  disconnect: () => Promise<void>;

  /** Send a legacy text message. Returns platform message ID. */
  sendMessage: (message: ChannelOutgoingMessage) => Promise<string>;

  /** Convert platform-specific raw message to UCPMessage */
  normalize: (raw: unknown) => UCPMessage;

  /** Send a UCPMessage via the platform API. Returns platform message ID. */
  denormalize: (msg: UCPMessage) => Promise<string>;

  /** Optional: send typing indicator */
  sendTyping?: (platformChatId: string) => Promise<void>;

  /** Optional: edit a previously sent message */
  editMessage?: (platformMessageId: string, newText: string) => Promise<void>;

  /** Optional: delete a message */
  deleteMessage?: (platformMessageId: string) => Promise<void>;

  /** Optional: react to a message */
  reactToMessage?: (platformMessageId: string, emoji: string) => Promise<void>;

  /** Optional: resolve user info */
  resolveUser?: (platformUserId: string) => Promise<ChannelUser | null>;

  /** Optional: logout / clear session */
  logout?: () => Promise<void>;

  /** Optional: bot info */
  getBotInfo?: () => { username?: string; firstName?: string } | null;
}

/**
 * Create a channel adapter from a simple configuration object.
 *
 * This is the primary SDK entry point for creating new channel plugins.
 * It wraps the UCPChannelAdapter abstract class in a functional pattern.
 *
 * @example
 * ```typescript
 * const webchat = createChannelAdapter({
 *   platform: 'webchat',
 *   capabilities: {
 *     features: ['rich_text', 'markdown', 'images', 'buttons'],
 *     limits: { maxTextLength: 4096 },
 *   },
 *   connect: async () => { ... },
 *   disconnect: async () => { ... },
 *   sendMessage: async (msg) => { ... },
 *   normalize: (raw) => { ... },
 *   denormalize: async (msg) => { ... },
 * });
 * ```
 */
export function createChannelAdapter(config: ChannelAdapterConfig): UCPChannelAdapter {
  // Build capabilities with Set from array
  const capabilities: UCPChannelCapabilities = {
    channel: config.platform,
    features: new Set(config.capabilities.features),
    limits: config.capabilities.limits ?? {},
  };

  // Create concrete subclass via anonymous class
  class SDKChannelAdapter extends UCPChannelAdapter {
    readonly platform: ChannelPlatform = config.platform;
    readonly capabilities = capabilities;

    async connect(): Promise<void> {
      this._status = 'connecting';
      try {
        await config.connect();
        this._status = 'connected';
      } catch (err) {
        this._status = 'error';
        throw err;
      }
    }

    async disconnect(): Promise<void> {
      await config.disconnect();
      this._status = 'disconnected';
    }

    async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
      return config.sendMessage(message);
    }

    normalize(raw: unknown): UCPMessage {
      return config.normalize(raw);
    }

    async denormalize(msg: UCPMessage): Promise<string> {
      return config.denormalize(msg);
    }
  }

  const adapter = new SDKChannelAdapter();

  // Wire optional methods
  if (config.sendTyping) {
    adapter.sendTyping = config.sendTyping.bind(config);
  }
  if (config.editMessage) {
    adapter.editMessage = config.editMessage.bind(config);
  }
  if (config.deleteMessage) {
    adapter.deleteMessage = config.deleteMessage.bind(config);
  }
  if (config.reactToMessage) {
    adapter.reactToMessage = config.reactToMessage.bind(config);
  }
  if (config.resolveUser) {
    adapter.resolveUser = config.resolveUser.bind(config);
  }
  if (config.logout) {
    adapter.logout = config.logout.bind(config);
  }
  if (config.getBotInfo) {
    (adapter as unknown as { getBotInfo: typeof config.getBotInfo }).getBotInfo = config.getBotInfo.bind(config);
  }

  return adapter;
}

/**
 * UCP Channel Adapter — Abstract Base Class
 *
 * Extends the existing ChannelPluginAPI contract with:
 * - Rich content normalization (UCPMessage ↔ platform format)
 * - Capability declaration (what the platform supports)
 * - Automatic content adaptation (degrade rich content for limited platforms)
 *
 * New channel adapters extend this class and implement:
 *   1. `capabilities` — declare features & limits
 *   2. `normalize(raw)` — platform message → UCPMessage
 *   3. `denormalize(msg)` — UCPMessage → platform send
 *   4. `connect(config)` / `disconnect()` — lifecycle
 *
 * Everything else (content adaptation, send routing) is handled by the framework.
 *
 * Existing adapters (Telegram, WhatsApp) can adopt this incrementally by
 * adding a `getCapabilities()` method — full migration is not required.
 */

import type { ChannelPluginAPI, ChannelConnectionStatus, ChannelPlatform } from '../types.js';
import type { UCPMessage, UCPContent, UCPChannelCapabilities } from './types.js';
import { adaptContent } from './types.js';

// ============================================================================
// Abstract Base
// ============================================================================

/**
 * Abstract base class for UCP-aware channel adapters.
 *
 * Provides the ChannelPluginAPI interface (backward-compatible with existing
 * channel system) plus UCP-specific rich message handling.
 */
export abstract class UCPChannelAdapter implements ChannelPluginAPI {
  /** Platform identifier */
  abstract readonly platform: ChannelPlatform;

  /** Channel capabilities declaration */
  abstract readonly capabilities: UCPChannelCapabilities;

  /** Connection status */
  protected _status: ChannelConnectionStatus = 'disconnected';

  // --------------------------------------------------------------------------
  // ChannelPluginAPI — required implementations
  // --------------------------------------------------------------------------

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  /**
   * Send a legacy text-only outgoing message.
   * Default implementation wraps text in a UCPMessage and calls denormalize().
   */
  abstract sendMessage(message: {
    platformChatId: string;
    text: string;
    attachments?: Array<{
      type: 'image' | 'audio' | 'video' | 'file';
      url?: string;
      data?: Uint8Array;
      mimeType: string;
      filename?: string;
      size?: number;
    }>;
    replyToId?: string;
    options?: Record<string, unknown>;
  }): Promise<string>;

  getStatus(): ChannelConnectionStatus {
    return this._status;
  }

  getPlatform(): ChannelPlatform {
    return this.platform;
  }

  // --------------------------------------------------------------------------
  // UCP — required implementations
  // --------------------------------------------------------------------------

  /**
   * Convert a platform-specific raw message into a UCPMessage.
   * Called by the framework when an inbound message arrives.
   */
  abstract normalize(raw: unknown): UCPMessage;

  /**
   * Send a UCPMessage via the platform API.
   * The message content has already been adapted to this channel's capabilities.
   */
  abstract denormalize(msg: UCPMessage): Promise<string>;

  // --------------------------------------------------------------------------
  // UCP — optional overrides
  // --------------------------------------------------------------------------

  /** Send typing indicator (optional) */
  sendTyping?(_platformChatId: string): Promise<void>;

  /** Edit a previously sent message (optional) */
  editMessage?(_platformMessageId: string, _newText: string): Promise<void>;

  /** Delete a message (optional) */
  deleteMessage?(_platformMessageId: string): Promise<void>;

  /** React to a message with an emoji (optional) */
  reactToMessage?(_platformMessageId: string, _emoji: string): Promise<void>;

  /** Resolve user info from platform ID (optional) */
  resolveUser?(_platformUserId: string): Promise<{
    platformUserId: string;
    platform: ChannelPlatform;
    displayName: string;
    username?: string;
    avatarUrl?: string;
    isBot?: boolean;
    platformData?: Record<string, unknown>;
  } | null>;

  /** Logout and clear session (optional) */
  logout?(): Promise<void>;

  // --------------------------------------------------------------------------
  // Framework methods (don't override)
  // --------------------------------------------------------------------------

  /**
   * Send a UCPMessage with automatic content adaptation.
   *
   * 1. Adapts content blocks to fit this channel's capabilities
   * 2. Calls denormalize() to send via platform SDK
   */
  async sendUCPMessage(msg: UCPMessage): Promise<string> {
    const adapted = adaptContent(msg, this.capabilities);
    return this.denormalize(adapted);
  }

  /**
   * Check if this channel supports a specific feature.
   */
  hasFeature(feature: string): boolean {
    return this.capabilities.features.has(feature as never);
  }

  /**
   * Get the primary text content from a UCPMessage.
   * Useful for platforms that only support plain text.
   */
  extractText(msg: UCPMessage): string {
    const textBlocks = msg.content.filter((c) => c.type === 'text' && c.text);
    return textBlocks.map((c) => c.text!).join('\n\n');
  }

  /**
   * Get media content blocks from a UCPMessage.
   */
  extractMedia(msg: UCPMessage): UCPContent[] {
    return msg.content.filter((c) =>
      ['image', 'audio', 'video', 'file', 'sticker'].includes(c.type)
    );
  }
}

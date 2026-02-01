/**
 * Channel Plugin Types
 *
 * Unified type definitions for the channel-as-plugin architecture.
 * All channel plugins implement ChannelPluginAPI and communicate
 * via normalized message types through the EventBus.
 */

// ============================================================================
// Platform & Status
// ============================================================================

/**
 * Channel platform identifier.
 * Open string type - built-in plugins use well-known values (e.g. 'telegram'),
 * third-party plugins can define their own.
 */
export type ChannelPlatform = string;

/** Connection lifecycle states for a channel plugin. */
export type ChannelConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ============================================================================
// Channel User Identity
// ============================================================================

/** Normalized user identity from any channel platform. */
export interface ChannelUser {
  /** Platform-specific user ID (e.g., Telegram user ID, Discord snowflake) */
  platformUserId: string;
  /** Platform identifier */
  platform: ChannelPlatform;
  /** Display name */
  displayName: string;
  /** Username (if available, e.g., @username on Telegram) */
  username?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Whether this is a bot/system user */
  isBot?: boolean;
  /** Raw platform-specific data */
  platformData?: Record<string, unknown>;
}

// ============================================================================
// Messages
// ============================================================================

/** Normalized incoming message from any channel platform. */
export interface ChannelIncomingMessage {
  /** Unique message ID (plugin-scoped: "pluginId:platformMessageId") */
  id: string;
  /** Channel plugin ID that received this message */
  channelPluginId: string;
  /** Platform identifier */
  platform: ChannelPlatform;
  /** Platform-specific chat/room/conversation ID */
  platformChatId: string;
  /** Sender identity */
  sender: ChannelUser;
  /** Message text content */
  text: string;
  /** Attachments */
  attachments?: ChannelAttachment[];
  /** Reply-to message ID */
  replyToId?: string;
  /** Timestamp */
  timestamp: Date;
  /** Platform-specific metadata */
  metadata?: Record<string, unknown>;
}

/** Normalized outgoing message to any channel platform. */
export interface ChannelOutgoingMessage {
  /** Target platform chat/room/conversation ID */
  platformChatId: string;
  /** Text content */
  text: string;
  /** Attachments to send */
  attachments?: ChannelAttachment[];
  /** Reply-to message ID */
  replyToId?: string;
  /** Platform-specific options (e.g., parse_mode for Telegram) */
  options?: Record<string, unknown>;
}

/** Attachment in a channel message. */
export interface ChannelAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  /** Remote URL */
  url?: string;
  /** Binary data */
  data?: Uint8Array;
  /** MIME type */
  mimeType: string;
  /** Filename */
  filename?: string;
  /** Size in bytes */
  size?: number;
}

// ============================================================================
// Channel Plugin API
// ============================================================================

/**
 * The API that each channel plugin exposes via `plugin.api`.
 * ChannelServiceImpl discovers and calls these methods.
 */
export interface ChannelPluginAPI {
  /** Connect to the platform (start polling/websocket/webhook) */
  connect(): Promise<void>;

  /** Disconnect from the platform */
  disconnect(): Promise<void>;

  /** Send a message. Returns platform-specific message ID. */
  sendMessage(message: ChannelOutgoingMessage): Promise<string>;

  /** Get current connection status */
  getStatus(): ChannelConnectionStatus;

  /** Get platform identifier */
  getPlatform(): ChannelPlatform;

  /** Send typing indicator (optional) */
  sendTyping?(platformChatId: string): Promise<void>;

  /** Edit a sent message (optional) */
  editMessage?(platformMessageId: string, newText: string): Promise<void>;

  /** Delete a message (optional) */
  deleteMessage?(platformMessageId: string): Promise<void>;

  /** React to a message with an emoji (optional) */
  reactToMessage?(platformMessageId: string, emoji: string): Promise<void>;

  /** Resolve user info from platform (optional) */
  resolveUser?(platformUserId: string): Promise<ChannelUser | null>;
}

// ============================================================================
// Channel Plugin Info (for listing)
// ============================================================================

/** Summary info for a registered channel plugin. */
export interface ChannelPluginInfo {
  pluginId: string;
  platform: ChannelPlatform;
  name: string;
  status: ChannelConnectionStatus;
  icon?: string;
}

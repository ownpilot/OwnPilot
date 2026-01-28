/**
 * Channel types for messaging integrations
 */

/**
 * Base channel configuration
 */
export interface ChannelConfig {
  /** Channel type identifier */
  type: string;
  /** Whether the channel is enabled */
  enabled: boolean;
  /** Optional webhook URL for receiving messages */
  webhookUrl?: string;
}

/**
 * Telegram-specific configuration
 */
export interface TelegramConfig extends ChannelConfig {
  type: 'telegram';
  /** Bot token from @BotFather */
  botToken: string;
  /** Allowed chat IDs (empty = allow all) */
  allowedChatIds?: number[];
  /** Allowed user IDs (empty = allow all) */
  allowedUserIds?: number[];
  /** Maximum message length before splitting */
  maxMessageLength?: number;
  /** Parse mode for messages */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

/**
 * Incoming message from any channel
 */
export interface IncomingMessage {
  /** Unique message ID */
  id: string;
  /** Channel type */
  channel: string;
  /** Sender user ID */
  userId: string;
  /** Sender username (if available) */
  username?: string;
  /** Chat/conversation ID */
  chatId: string;
  /** Message text content */
  text: string;
  /** Timestamp */
  timestamp: Date;
  /** Original raw message data */
  raw: unknown;
}

/**
 * Outgoing message to any channel
 */
export interface OutgoingMessage {
  /** Chat/conversation ID to send to */
  chatId: string;
  /** Message text content */
  text: string;
  /** Reply to a specific message ID */
  replyToMessageId?: string;
  /** Parse mode for formatting */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

/**
 * Channel handler interface
 */
export interface ChannelHandler {
  /** Channel type identifier */
  readonly type: string;
  /** Whether the channel is ready */
  isReady(): boolean;
  /** Start the channel (bot, webhook, etc.) */
  start(): Promise<void>;
  /** Stop the channel */
  stop(): Promise<void>;
  /** Send a message */
  sendMessage(message: OutgoingMessage): Promise<void>;
  /** Set message handler */
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void;
}

/**
 * Channel events
 */
export type ChannelEvent =
  | { type: 'message'; message: IncomingMessage }
  | { type: 'error'; error: Error }
  | { type: 'connected' }
  | { type: 'disconnected' };

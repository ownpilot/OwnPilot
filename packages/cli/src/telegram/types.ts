/**
 * Telegram bot types for CLI standalone bot
 */

/**
 * Telegram-specific configuration
 */
export interface TelegramConfig {
  type: 'telegram';
  /** Whether the channel is enabled */
  enabled: boolean;
  /** Bot token from @BotFather */
  botToken: string;
  /** Optional webhook URL for receiving messages */
  webhookUrl?: string;
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
 * Incoming message from Telegram
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
 * Outgoing message to Telegram
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

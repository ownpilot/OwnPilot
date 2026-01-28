/**
 * Channel Adapter Types
 *
 * Base types for multi-channel communication
 */

import type {
  ChannelType,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
  Attachment,
} from '../ws/types.js';

/**
 * Channel adapter configuration base
 */
export interface ChannelConfig {
  /** Unique channel identifier */
  id: string;
  /** Channel type */
  type: ChannelType;
  /** Display name */
  name: string;
  /** Whether to auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
}

/**
 * Telegram-specific configuration
 */
export interface TelegramConfig extends ChannelConfig {
  type: 'telegram';
  /** Bot token from @BotFather */
  botToken: string;
  /** Allowed user IDs (empty = allow all) */
  allowedUsers?: number[];
  /** Allowed chat IDs */
  allowedChats?: number[];
  /** Webhook URL (optional, uses polling if not set) */
  webhookUrl?: string;
  /** Polling interval in ms */
  pollingInterval?: number;
}

/**
 * Discord-specific configuration
 */
export interface DiscordConfig extends ChannelConfig {
  type: 'discord';
  /** Bot token */
  botToken: string;
  /** Application ID */
  applicationId: string;
  /** Allowed server IDs */
  allowedGuilds?: string[];
  /** Allowed channel IDs */
  allowedChannels?: string[];
  /** Whether to respond to DMs */
  allowDMs?: boolean;
}

/**
 * Slack-specific configuration
 */
export interface SlackConfig extends ChannelConfig {
  type: 'slack';
  /** Bot token (xoxb-...) */
  botToken: string;
  /** App token (xapp-...) for Socket Mode */
  appToken?: string;
  /** Signing secret for webhook verification */
  signingSecret?: string;
  /** Allowed workspace IDs */
  allowedWorkspaces?: string[];
  /** Allowed channel IDs */
  allowedChannels?: string[];
}

/**
 * Matrix-specific configuration
 */
export interface MatrixConfig extends ChannelConfig {
  type: 'matrix';
  /** Homeserver URL */
  homeserverUrl: string;
  /** Access token */
  accessToken: string;
  /** User ID (@user:server.com) */
  userId: string;
  /** Allowed room IDs */
  allowedRooms?: string[];
  /** Device ID for E2EE */
  deviceId?: string;
}

/**
 * WhatsApp-specific configuration (via WhatsApp Business API)
 */
export interface WhatsAppConfig extends ChannelConfig {
  type: 'whatsapp';
  /** Phone number ID */
  phoneNumberId: string;
  /** WhatsApp Business Account ID */
  businessAccountId: string;
  /** Access token */
  accessToken: string;
  /** Webhook verify token */
  verifyToken?: string;
  /** Allowed phone numbers */
  allowedNumbers?: string[];
}

/**
 * Signal-specific configuration (via Signal CLI or signald)
 */
export interface SignalConfig extends ChannelConfig {
  type: 'signal';
  /** Signal phone number */
  phoneNumber: string;
  /** Signal CLI socket path or signald socket */
  socketPath: string;
  /** Allowed phone numbers */
  allowedNumbers?: string[];
}

/**
 * WebChat configuration (embedded web widget)
 */
export interface WebChatConfig extends ChannelConfig {
  type: 'webchat';
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
  /** Session timeout in ms */
  sessionTimeout?: number;
}

/**
 * Union type for all channel configs
 */
export type AnyChannelConfig =
  | TelegramConfig
  | DiscordConfig
  | SlackConfig
  | MatrixConfig
  | WhatsAppConfig
  | SignalConfig
  | WebChatConfig;

/**
 * Channel adapter events
 */
export interface ChannelAdapterEvents {
  /** Connection state changed */
  statusChange: (status: ChannelStatus, error?: string) => void;
  /** Message received */
  message: (message: IncomingMessage) => void;
  /** Message sent confirmation */
  messageSent: (messageId: string, externalId?: string) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Sender info from a channel
 */
export interface ChannelSender {
  /** Platform-specific user ID */
  id: string;
  /** Display name */
  name?: string;
  /** Username (if available) */
  username?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Is this a bot/system user */
  isBot?: boolean;
}

/**
 * Channel adapter interface
 *
 * All channel implementations must implement this interface
 */
export interface ChannelAdapter {
  /** Channel identifier */
  readonly id: string;
  /** Channel type */
  readonly type: ChannelType;
  /** Current connection status */
  readonly status: ChannelStatus;
  /** Channel display name */
  readonly name: string;

  /**
   * Connect to the channel
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the channel
   */
  disconnect(): Promise<void>;

  /**
   * Send a message to the channel
   */
  sendMessage(message: OutgoingMessage): Promise<string>;

  /**
   * Send a typing indicator
   */
  sendTyping?(chatId: string): Promise<void>;

  /**
   * Edit a previously sent message
   */
  editMessage?(messageId: string, content: string): Promise<void>;

  /**
   * Delete a message
   */
  deleteMessage?(messageId: string): Promise<void>;

  /**
   * React to a message
   */
  reactToMessage?(messageId: string, emoji: string): Promise<void>;

  /**
   * Upload an attachment
   */
  uploadAttachment?(attachment: Attachment): Promise<string>;

  /**
   * Get sender info
   */
  getSenderInfo?(senderId: string): Promise<ChannelSender | null>;

  /**
   * Register event handlers
   */
  on<K extends keyof ChannelAdapterEvents>(
    event: K,
    handler: ChannelAdapterEvents[K]
  ): void;

  /**
   * Remove event handler
   */
  off<K extends keyof ChannelAdapterEvents>(
    event: K,
    handler: ChannelAdapterEvents[K]
  ): void;
}

/**
 * Channel adapter factory function
 */
export type ChannelAdapterFactory<T extends AnyChannelConfig = AnyChannelConfig> = (
  config: T
) => ChannelAdapter;

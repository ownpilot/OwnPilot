/**
 * Channel Event Constants
 *
 * All channel events use the 'channel' category and follow
 * the dot-delimited naming: 'channel.{group}.{action}'.
 *
 * Subscribe via EventBus:
 *   eventBus.on(ChannelEvents.MESSAGE_RECEIVED, handler)       // exact
 *   eventBus.onPattern('channel.message.*', handler)           // group
 *   eventBus.onPattern('channel.**', handler)                  // all channel events
 */

import type {
  ChannelConnectionStatus,
  ChannelIncomingMessage,
  ChannelOutgoingMessage,
  ChannelPlatform,
  ChannelUser,
} from './types.js';

// ============================================================================
// Event Type Constants
// ============================================================================

export const ChannelEvents = {
  // Connection lifecycle
  CONNECTING: 'channel.connecting',
  CONNECTED: 'channel.connected',
  DISCONNECTED: 'channel.disconnected',
  RECONNECTING: 'channel.reconnecting',
  ERROR: 'channel.error',

  // Messaging
  MESSAGE_RECEIVED: 'channel.message.received',
  MESSAGE_SEND: 'channel.message.send',
  MESSAGE_SENT: 'channel.message.sent',
  MESSAGE_SEND_ERROR: 'channel.message.send_error',

  // User identity & auth
  USER_FIRST_SEEN: 'channel.user.first_seen',
  USER_VERIFIED: 'channel.user.verified',
  USER_BLOCKED: 'channel.user.blocked',
  USER_UNBLOCKED: 'channel.user.unblocked',

  // Platform-specific interactions
  TYPING: 'channel.typing',
  REACTION_ADDED: 'channel.reaction.added',
  MESSAGE_EDITED: 'channel.message.edited',
  MESSAGE_DELETED: 'channel.message.deleted',
} as const;

export type ChannelEventType = (typeof ChannelEvents)[keyof typeof ChannelEvents];

// ============================================================================
// Event Data Types
// ============================================================================

/** Data for connection lifecycle events */
export interface ChannelConnectionEventData {
  channelPluginId: string;
  platform: ChannelPlatform;
  status: ChannelConnectionStatus;
  error?: string;
}

/** Data for channel.message.received */
export interface ChannelMessageReceivedData {
  message: ChannelIncomingMessage;
}

/** Data for channel.message.send (request to send) */
export interface ChannelMessageSendData {
  channelPluginId: string;
  message: ChannelOutgoingMessage;
}

/** Data for channel.message.sent (confirmation) */
export interface ChannelMessageSentData {
  channelPluginId: string;
  platform: ChannelPlatform;
  platformMessageId: string;
  platformChatId: string;
}

/** Data for channel.message.send_error */
export interface ChannelMessageSendErrorData {
  channelPluginId: string;
  platform: ChannelPlatform;
  error: string;
  platformChatId: string;
}

/** Data for channel.user.first_seen */
export interface ChannelUserFirstSeenData {
  platform: ChannelPlatform;
  user: ChannelUser;
  channelPluginId: string;
}

/** Data for channel.user.verified */
export interface ChannelUserVerifiedData {
  platform: ChannelPlatform;
  platformUserId: string;
  ownpilotUserId: string;
  verificationMethod: 'pin' | 'oauth' | 'whitelist' | 'admin';
}

/** Data for channel.user.blocked / unblocked */
export interface ChannelUserBlockedData {
  platform: ChannelPlatform;
  platformUserId: string;
  reason?: string;
}

/** Data for channel.typing */
export interface ChannelTypingData {
  channelPluginId: string;
  platformChatId: string;
}

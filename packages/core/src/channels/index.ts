/**
 * @ownpilot/core - Channels Module
 *
 * Unified channel-as-plugin architecture for multi-platform messaging.
 * Channels are plugins that implement ChannelPluginAPI and communicate
 * through the EventBus.
 *
 * @example
 * ```typescript
 * import {
 *   createChannelPlugin,
 *   getChannelService,
 *   ChannelEvents,
 *   type ChannelPluginAPI,
 * } from '@ownpilot/core';
 * ```
 */

// Types
export type {
  ChannelPlatform,
  ChannelConnectionStatus,
  ChannelUser,
  ChannelIncomingMessage,
  ChannelOutgoingMessage,
  ChannelAttachment,
  ChannelPluginAPI,
  ChannelPluginInfo,
} from './types.js';

// Events
export {
  ChannelEvents,
  type ChannelEventType,
  type ChannelConnectionEventData,
  type ChannelMessageReceivedData,
  type ChannelMessageSendData,
  type ChannelMessageSentData,
  type ChannelMessageSendErrorData,
  type ChannelUserFirstSeenData,
  type ChannelUserVerifiedData,
  type ChannelUserBlockedData,
  type ChannelUserPendingData,
  type ChannelTypingData,
} from './events.js';

// Builder
export {
  ChannelPluginBuilder,
  createChannelPlugin,
  type ChannelPluginManifest,
  type ChannelApiFactory,
} from './builder.js';

// Service
export {
  type IChannelService,
  setChannelService,
  getChannelService,
  hasChannelService,
} from './service.js';

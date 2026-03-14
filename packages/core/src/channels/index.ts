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

// UCP (Universal Channel Protocol)
export {
  // Types
  type UCPContentType,
  type UCPFeature,
  type UCPButton,
  type UCPFormField,
  type UCPContent,
  type UCPIdentity,
  type UCPMetadata,
  type UCPMessage,
  type UCPChannelLimits,
  type UCPChannelCapabilities,
  type BridgeDirection,
  type UCPBridgeConfig,
  adaptContent,
  stripMarkdown,
  stripHtml,

  // Adapter
  UCPChannelAdapter,

  // Pipeline
  UCPPipeline,

  // Bridge
  UCPBridgeManager,
  type BridgeStore,
  type BridgeSendFn,

  // Middleware
  type UCPMiddleware,
  type NamedUCPMiddleware,
  rateLimiter,
  type RateLimiterConfig,
  threadTracker,
  createInMemoryThreadStore,
  type ThreadStore,
  languageDetector,
  detectLanguage,
  type LanguageDetection,
} from './ucp/index.js';

// SDK
export {
  createChannelAdapter,
  type ChannelAdapterConfig,
} from './sdk.js';

// Notifications
// Note: NotificationPriority is not re-exported here to avoid ambiguity with
// the identical type already exported from scheduler/notifications.ts.
// Both modules define the same 'low' | 'normal' | 'high' | 'urgent' union.
export {
  type Notification,
  type NotificationResult,
  type NotificationPreferences,
  type INotificationRouter,
} from './notifications.js';

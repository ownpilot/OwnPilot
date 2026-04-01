/**
 * Channel Hub 2.0
 *
 * Ultra-fast, private, bidirectional channel communication system.
 *
 * @example
 * ```typescript
 * import { ChannelHub, QuickConnectInput } from './hub/index.js';
 *
 * const hub = new ChannelHub();
 *
 * // Quick connect a channel
 * const result = await hub.quickConnect({
 *   platform: 'telegram',
 *   credential: 'your-bot-token',
 *   privacyLevel: 'enhanced',
 * });
 *
 * // Send a message
 * await hub.sendMessage(result.channelId, {
 *   recipientId: 'chat-id',
 *   content: { type: 'text', text: 'Hello!' },
 *   encrypt: true,
 * });
 *
 * // Listen to messages
 * hub.onMessage((message) => {
 *   console.log(`Received: ${message.content.text}`);
 * });
 * ```
 */

// Core Service
export { ChannelHub, getGlobalChannelHub, resetGlobalChannelHub } from './hub-service.js';

// Universal Adapter
export {
  UniversalChannelAdapter,
  type MessageHandler,
  type ConnectionResult,
} from './universal-adapter.js';

// Connection Wizard
export {
  ConnectionWizard,
  getGlobalConnectionWizard,
  resetGlobalConnectionWizard,
} from './connection-wizard.js';

// Health Monitor
export {
  ChannelHealthMonitor,
  getGlobalHealthMonitor,
  resetGlobalHealthMonitor,
} from './health-monitor.js';

// Types
export type {
  // Channel Config
  ChannelConfig,
  ChannelCredentials,
  PrivacyConfig,
  TransportConfig,
  WebhookConfig,
  WebSocketConfig,
  PollingConfig,
  RetryPolicy,
  ChannelStatus,
  PrivacyLevel,

  // Messages
  HubIncomingMessage,
  HubOutgoingMessage,
  MessageContent,
  StrippedMetadata,

  // Health
  ChannelHealth,
  HealthStatus,
  LatencyMetrics,
  ThroughputMetrics,
  ErrorMetrics,
  EncryptionStatus,

  // Wizard
  QuickConnectInput,
  QuickConnectResult,
  ConnectionWizardStep,
  WizardField,
  TunnelInfo,

  // Events
  ChannelEvent,
  ChannelEventType,
  ChannelEventHandler,

  // Bridge
  BridgeConfig,
  BridgeFilter,
  TransformRule,

  // API
  PaginatedChannels,
  ChannelSummary,
} from './types.js';

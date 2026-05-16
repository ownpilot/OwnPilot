/**
 * Universal Channel Protocol (UCP)
 *
 * Rich message normalization layer for multi-platform channel support.
 * Extends the existing ChannelPluginAPI system with:
 * - Rich content types (buttons, forms, cards, media, location, etc.)
 * - Channel capability negotiation and auto-degradation
 * - Cross-channel bridging
 * - UCP pipeline (middleware chain for channel-level processing)
 * - Language detection, rate limiting, thread tracking
 */

// Types
export type {
  UCPContentType,
  UCPFeature,
  UCPButton,
  UCPFormField,
  UCPContent,
  UCPIdentity,
  UCPMetadata,
  UCPMessage,
  UCPChannelLimits,
  UCPChannelCapabilities,
  BridgeDirection,
  UCPBridgeConfig,
} from './types.js';

export { adaptContent, stripMarkdown, stripHtml } from './types.js';

// Adapter base class
export { UCPChannelAdapter } from './adapter.js';

// Pipeline
export { UCPPipeline } from './pipeline.js';

// Bridge
export { UCPBridgeManager, type BridgeStore, type BridgeSendFn } from './bridge.js';

// Middleware
export {
  type UCPMiddleware,
  type NamedUCPMiddleware,
  rateLimiter,
  type RateLimiterConfig,
  inboundRateLimiter,
  InboundRateLimitError,
  type InboundRateLimiterConfig,
  threadTracker,
  createInMemoryThreadStore,
  type ThreadStore,
  languageDetector,
  detectLanguage,
  type LanguageDetection,
} from './middleware/index.js';

/**
 * Channel Hub 2.0 - Core Types
 *
 * Ultra-fast, private, bidirectional channel communication system.
 */

import type { ChannelPlatform, ChannelUser } from '@ownpilot/core';

// ============================================================================
// Channel Connection & Configuration
// ============================================================================

export type ChannelStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'paused';

export type PrivacyLevel =
  | 'standard'      // Platform native encryption
  | 'enhanced'      // OwnPilot E2E (Signal Protocol)
  | 'paranoid';     // E2E + Tor/Proxy + Ephemeral

export interface ChannelConfig {
  id: string;
  name: string;
  platform: ChannelPlatform;
  credentials: ChannelCredentials;
  privacy: PrivacyConfig;
  transport: TransportConfig;
  retryPolicy: RetryPolicy;
  metadata?: Record<string, unknown>;
}

export interface ChannelCredentials {
  type: 'token' | 'qr' | 'oauth' | 'webhook_secret' | 'certificate';
  value: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface PrivacyConfig {
  level: PrivacyLevel;
  e2eEnabled: boolean;
  metadataStripping: boolean;
  ephemeralTimeout?: number; // seconds, for paranoid mode
  identityKeyPath?: string;
}

export interface TransportConfig {
  type: 'webhook' | 'websocket' | 'polling' | 'grpc';
  webhook?: WebhookConfig;
  websocket?: WebSocketConfig;
  polling?: PollingConfig;
}

export interface WebhookConfig {
  url?: string; // Auto-generated if not provided
  path: string;
  secret: string;
  autoTunnel: boolean;
  tunnelProvider?: 'ngrok' | 'cloudflare' | 'localtunnel';
}

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export interface PollingConfig {
  interval: number; // milliseconds
  batchSize: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponential: boolean;
}

// ============================================================================
// Messages
// ============================================================================

export interface HubIncomingMessage {
  id: string;
  channelId: string;
  platform: ChannelPlatform;
  platformMessageId: string;
  sender: ChannelUser;
  content: MessageContent;
  timestamp: Date;
  replyTo?: string;
  threadId?: string;
  encrypted: boolean;
  metadata: StrippedMetadata;
}

export interface HubOutgoingMessage {
  channelId: string;
  recipientId: string;
  content: MessageContent;
  replyTo?: string;
  threadId?: string;
  encrypt: boolean;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface MessageContent {
  type: 'text' | 'image' | 'file' | 'audio' | 'video' | 'location' | 'contact' | 'encrypted';
  text?: string;
  fileUrl?: string;
  fileData?: Buffer;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  location?: { latitude: number; longitude: number; address?: string };
  contact?: { name: string; phone?: string; email?: string };
  encrypted?: unknown; // For Signal Protocol encrypted messages
}

// ============================================================================
// Security & Privacy
// ============================================================================

export interface StrippedMetadata {
  originalTimestamp: Date;
  processedAt: Date;
  stripped: string[]; // List of removed fields
  platform: string; // Minimal platform info
  decryptionError?: boolean; // Set when message decryption fails
}

export interface EncryptionStatus {
  enabled: boolean;
  protocol: 'signal' | 'pgp' | 'none';
  identityKeyFingerprint?: string;
  sessionEstablished: boolean;
  lastRotation: Date;
}

// ============================================================================
// Health & Monitoring
// ============================================================================

export interface ChannelHealth {
  status: HealthStatus;
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  errors: ErrorMetrics;
  encryption: EncryptionStatus;
  lastActivity: Date;
  connectedAt?: Date;
  disconnectedAt?: Date;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface LatencyMetrics {
  current: number; // milliseconds
  average: number;
  p95: number;
  p99: number;
}

export interface ThroughputMetrics {
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  messagesPerSecond: number;
}

export interface ErrorMetrics {
  totalErrors: number;
  consecutiveErrors: number;
  lastError?: {
    message: string;
    code: string;
    timestamp: Date;
  };
  errorRate: number; // errors per minute
}

// ============================================================================
// Connection Wizard
// ============================================================================

export interface QuickConnectInput {
  platform: ChannelPlatform;
  credential: string; // Token, QR data, etc.
  privacyLevel: PrivacyLevel;
  autoTunnel?: boolean;
  name?: string;
}

export interface QuickConnectResult {
  channelId: string;
  status: ChannelStatus;
  webhookUrl?: string;
  encryptionPublicKey?: string;
  health: ChannelHealth;
  setupTime: number; // milliseconds
}

export interface ConnectionWizardStep {
  id: string;
  title: string;
  description: string;
  fields: WizardField[];
  validation?: (data: Record<string, unknown>) => boolean | string;
}

export interface WizardField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'checkbox' | 'qr_scan';
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  helpText?: string;
}

// ============================================================================
// Events
// ============================================================================

export type ChannelEventType =
  | 'channel.connected'
  | 'channel.disconnected'
  | 'channel.error'
  | 'channel.health.changed'
  | 'message.received'
  | 'message.sent'
  | 'message.failed'
  | 'encryption.ready'
  | 'encryption.failed';

export interface ChannelEvent {
  type: ChannelEventType;
  channelId: string;
  timestamp: Date;
  payload: unknown;
}

export type ChannelEventHandler = (event: ChannelEvent) => void | Promise<void>;

// ============================================================================
// Bridge & Routing
// ============================================================================

export interface BridgeConfig {
  id: string;
  sourceChannelId: string;
  targetChannelId: string;
  bidirectional: boolean;
  filters: BridgeFilter[];
  transformRules: TransformRule[];
}

export interface BridgeFilter {
  type: 'sender' | 'content_type' | 'keyword' | 'regex';
  value: string;
  action: 'allow' | 'deny';
}

export interface TransformRule {
  type: 'prefix' | 'suffix' | 'replace' | 'template';
  config: Record<string, string>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedChannels {
  items: ChannelSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ChannelSummary {
  id: string;
  name: string;
  platform: ChannelPlatform;
  status: ChannelStatus;
  privacyLevel: PrivacyLevel;
  health: HealthStatus;
  lastActivity: Date;
  messageCount: number;
}

export interface TunnelInfo {
  url: string;
  type: 'ngrok' | 'cloudflare' | 'local';
  expiresAt?: Date;
  isPermanent: boolean;
}

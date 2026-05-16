/**
 * Public types and interfaces for the plugin isolation layer.
 *
 * Implementations live in sibling modules (`enforcer.ts`, `storage.ts`,
 * `network.ts`, …) and are wired together by `manager.ts`.
 */

import type { PluginId } from '../../types/branded.js';
import type { Result } from '../../types/result.js';

/**
 * Plugin capability - what a plugin can request access to
 */
export type PluginCapability =
  // Data capabilities
  | 'storage:read' // Read plugin's own storage
  | 'storage:write' // Write plugin's own storage
  | 'storage:quota:1mb' // 1MB storage quota
  | 'storage:quota:10mb' // 10MB storage quota
  | 'storage:quota:100mb' // 100MB storage quota
  // Network capabilities
  | 'network:fetch' // Make HTTP requests
  | 'network:domains:*' // Access any domain
  | 'network:domains:specific' // Access only declared domains
  // Execution capabilities
  | 'execute:javascript' // Run JavaScript code
  | 'execute:sandbox' // Use sandbox for code execution
  // UI capabilities
  | 'ui:notifications' // Send notifications
  | 'ui:dialogs' // Show dialogs
  | 'ui:widgets' // Render widgets
  // Tool capabilities
  | 'tools:register' // Register new tools
  | 'tools:invoke' // Invoke other tools
  // Event capabilities
  | 'events:subscribe' // Subscribe to events
  | 'events:emit' // Emit events
  // Inter-plugin
  | 'plugins:communicate'; // Communicate with other plugins

/**
 * Resource that a plugin is NEVER allowed to access
 */
export type ForbiddenResource =
  | 'memory:user' // User's secure memory
  | 'credentials:user' // User's credentials
  | 'memory:system' // System memory
  | 'credentials:system' // System credentials
  | 'audit:logs' // Audit logs (read)
  | 'audit:modify' // Audit logs (modify)
  | 'plugins:internal' // Other plugins' internal state
  | 'filesystem:system' // System files
  | 'process:spawn' // Spawn processes
  | 'process:env' // Environment variables
  | 'crypto:keys'; // Encryption keys;

/**
 * Plugin isolation configuration
 */
export interface IsolationConfig {
  /** Plugin ID */
  pluginId: PluginId;
  /** Granted capabilities */
  capabilities: PluginCapability[];
  /** Allowed network domains (if network:domains:specific) */
  allowedDomains?: string[];
  /** Storage quota in bytes */
  storageQuota: number;
  /** CPU time limit in ms */
  cpuLimit: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Execution timeout in ms */
  executionTimeout: number;
  /** Enable debug mode */
  debug?: boolean;
}

/**
 * Plugin execution context - what a plugin receives.
 * This is a PROXY that controls all access.
 */
export interface IsolatedPluginContext {
  /** Plugin identifier */
  readonly pluginId: string;
  /** Plugin version */
  readonly version: string;
  /** Granted capabilities */
  readonly capabilities: readonly PluginCapability[];

  /** Storage API - only plugin's own isolated storage */
  storage: IsolatedStorage;
  /** Network API - only if capability granted */
  network: IsolatedNetwork | null;
  /** Events API - filtered events only */
  events: IsolatedEvents;
  /** Logger API - logs are sanitized */
  log: IsolatedLogger;
  /** Inter-plugin API - mediated communication */
  plugins: IsolatedPluginAPI;
}

/**
 * Isolated storage - plugin can only access its own data
 */
export interface IsolatedStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<Result<void, StorageError>>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  usage(): Promise<{ used: number; quota: number }>;
  clear(): Promise<void>;
}

export type StorageError =
  | { type: 'quota_exceeded'; used: number; quota: number; requested: number }
  | { type: 'key_too_long'; maxLength: number }
  | { type: 'value_too_large'; maxSize: number }
  | { type: 'invalid_key'; reason: string }
  | { type: 'serialization_failed'; error: string };

/**
 * Isolated network - controlled HTTP access
 */
export interface IsolatedNetwork {
  fetch(
    url: string,
    options?: IsolatedFetchOptions
  ): Promise<Result<IsolatedResponse, NetworkError>>;
  isDomainAllowed(domain: string): boolean;
  getAllowedDomains(): readonly string[];
  getRateLimitStatus(): { remaining: number; resetAt: Date };
}

export interface IsolatedFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
}

export interface IsolatedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}

export type NetworkError =
  | { type: 'domain_not_allowed'; domain: string; allowed: string[] }
  | { type: 'protocol_not_allowed'; protocol: string }
  | { type: 'private_address_blocked'; host: string }
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'network_error'; message: string }
  | { type: 'response_too_large'; maxSize: number };

/**
 * Isolated events - filtered event access
 */
export interface IsolatedEvents {
  on(event: AllowedPluginEvent, handler: (data: unknown) => void): () => void;
  emit(event: string, data: unknown): void;
  removeAllListeners(): void;
}

export type AllowedPluginEvent =
  | 'plugin:enabled'
  | 'plugin:disabled'
  | 'plugin:config_changed'
  | 'message:received' // Sanitized, no PII
  | 'tool:called' // Tool call notification
  | 'schedule:triggered'; // Scheduled task

/**
 * Isolated logger - logs are sanitized before storage
 */
export interface IsolatedLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Isolated plugin communication API
 */
export interface IsolatedPluginAPI {
  getPublicAPI(pluginId: string): Promise<Record<string, unknown> | null>;
  sendMessage(pluginId: string, message: unknown): Promise<Result<void, PluginCommError>>;
  listPlugins(): Promise<Array<{ id: string; name: string; version: string }>>;
}

export type PluginCommError =
  | { type: 'plugin_not_found'; pluginId: string }
  | { type: 'communication_denied'; reason: string }
  | { type: 'message_too_large'; maxSize: number };

/**
 * Access violation tracking
 */
export interface AccessViolation {
  pluginId: PluginId;
  timestamp: Date;
  attemptedResource: ForbiddenResource | string;
  action: string;
  stackTrace?: string;
}

/**
 * Interface for plugin registry (to avoid circular dependency).
 */
export interface PluginRegistryInterface {
  getPlugin(id: string): { publicAPI?: Record<string, unknown> } | null;
  listPlugins(): Array<{ id: string; name: string; version: string }>;
  deliverMessage(from: string, to: string, message: unknown): void;
}

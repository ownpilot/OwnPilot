/**
 * Plugin Isolation Layer
 *
 * Provides complete isolation between plugins and system resources.
 * Plugins CANNOT access:
 * - User memory (SecureMemoryStore)
 * - User credentials (UserCredentialStore)
 * - Other plugins' data
 * - System internals
 *
 * All access is mediated through capability-based proxies.
 */

import { Worker, MessageChannel, type MessagePort } from 'node:worker_threads';
import { randomUUID, createHash, createVerify, createSign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PluginId } from '../types/branded.js';
import { createPluginId } from '../types/branded.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

// =============================================================================
// Types
// =============================================================================

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
  | 'crypto:keys' // Encryption keys;

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
 * Plugin execution context - what a plugin receives
 * This is a PROXY that controls all access
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
  /** Get value by key (only from plugin's namespace) */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Set value (only in plugin's namespace, quota enforced) */
  set<T = unknown>(key: string, value: T): Promise<Result<void, StorageError>>;
  /** Delete value */
  delete(key: string): Promise<boolean>;
  /** List all keys */
  keys(): Promise<string[]>;
  /** Get storage usage */
  usage(): Promise<{ used: number; quota: number }>;
  /** Clear all plugin data */
  clear(): Promise<void>;
}

/**
 * Storage error types
 */
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
  /** Make HTTP request (domain-restricted) */
  fetch(
    url: string,
    options?: IsolatedFetchOptions
  ): Promise<Result<IsolatedResponse, NetworkError>>;
  /** Check if domain is allowed */
  isDomainAllowed(domain: string): boolean;
  /** Get allowed domains */
  getAllowedDomains(): readonly string[];
  /** Get rate limit status */
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
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'network_error'; message: string }
  | { type: 'response_too_large'; maxSize: number };

/**
 * Isolated events - filtered event access
 */
export interface IsolatedEvents {
  /** Subscribe to allowed events */
  on(event: AllowedPluginEvent, handler: (data: unknown) => void): () => void;
  /** Emit event (only plugin-scoped events) */
  emit(event: string, data: unknown): void;
  /** Remove all listeners */
  removeAllListeners(): void;
}

/**
 * Events plugins are allowed to receive
 */
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
  /** Get another plugin's public API (if allowed) */
  getPublicAPI(pluginId: string): Promise<Record<string, unknown> | null>;
  /** Send message to another plugin */
  sendMessage(pluginId: string, message: unknown): Promise<Result<void, PluginCommError>>;
  /** List available plugins */
  listPlugins(): Promise<Array<{ id: string; name: string; version: string }>>;
}

export type PluginCommError =
  | { type: 'plugin_not_found'; pluginId: string }
  | { type: 'communication_denied'; reason: string }
  | { type: 'message_too_large'; maxSize: number };

// =============================================================================
// Isolation Enforcement
// =============================================================================

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
 * Isolation enforcer - monitors and blocks unauthorized access
 */
export class IsolationEnforcer {
  private violations: AccessViolation[] = [];
  private blockedPlugins: Set<string> = new Set();
  private readonly maxViolations: number;

  constructor(config: { maxViolations?: number } = {}) {
    this.maxViolations = config.maxViolations ?? 3;
  }

  /**
   * Check if access is allowed
   */
  checkAccess(
    pluginId: PluginId,
    resource: string,
    action: string
  ): Result<void, AccessViolation> {
    // Check if plugin is blocked
    if (this.blockedPlugins.has(pluginId)) {
      return err({
        pluginId,
        timestamp: new Date(),
        attemptedResource: resource,
        action,
        stackTrace: new Error().stack,
      });
    }

    // Check for forbidden resources
    const forbidden: ForbiddenResource[] = [
      'memory:user',
      'credentials:user',
      'memory:system',
      'credentials:system',
      'audit:logs',
      'audit:modify',
      'plugins:internal',
      'filesystem:system',
      'process:spawn',
      'process:env',
      'crypto:keys',
    ];

    if (forbidden.includes(resource as ForbiddenResource)) {
      const violation: AccessViolation = {
        pluginId,
        timestamp: new Date(),
        attemptedResource: resource as ForbiddenResource,
        action,
        stackTrace: new Error().stack,
      };

      this.recordViolation(violation);
      return err(violation);
    }

    return ok(undefined);
  }

  /**
   * Record a security violation
   */
  recordViolation(violation: AccessViolation): void {
    this.violations.push(violation);

    // Count violations for this plugin
    const pluginViolations = this.violations.filter(
      (v) => v.pluginId === violation.pluginId
    ).length;

    // Block plugin if too many violations
    if (pluginViolations >= this.maxViolations) {
      this.blockedPlugins.add(violation.pluginId);
      console.error(
        `[SECURITY] Plugin ${violation.pluginId} blocked after ${pluginViolations} violations`
      );
    }
  }

  /**
   * Get all violations
   */
  getViolations(pluginId?: PluginId): AccessViolation[] {
    if (pluginId) {
      return this.violations.filter((v) => v.pluginId === pluginId);
    }
    return [...this.violations];
  }

  /**
   * Check if plugin is blocked
   */
  isBlocked(pluginId: PluginId): boolean {
    return this.blockedPlugins.has(pluginId);
  }

  /**
   * Unblock a plugin (admin action)
   */
  unblock(pluginId: PluginId): void {
    this.blockedPlugins.delete(pluginId);
  }

  /**
   * Clear violations (admin action)
   */
  clearViolations(pluginId?: PluginId): void {
    if (pluginId) {
      this.violations = this.violations.filter((v) => v.pluginId !== pluginId);
    } else {
      this.violations = [];
    }
  }
}

// =============================================================================
// Isolated Storage Implementation
// =============================================================================

/**
 * Per-plugin isolated storage
 */
export class PluginIsolatedStorage implements IsolatedStorage {
  private data: Map<string, string> = new Map();
  private readonly pluginId: PluginId;
  private readonly quota: number;
  private readonly maxKeyLength = 256;
  private readonly maxValueSize = 1024 * 1024; // 1MB per value

  constructor(pluginId: PluginId, quota: number) {
    this.pluginId = pluginId;
    this.quota = quota;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const value = this.data.get(prefixedKey);
    if (value === undefined) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<Result<void, StorageError>> {
    // Validate key
    if (key.length > this.maxKeyLength) {
      return err({ type: 'key_too_long', maxLength: this.maxKeyLength });
    }

    if (!/^[a-zA-Z0-9_\-.:]+$/.test(key)) {
      return err({ type: 'invalid_key', reason: 'Key contains invalid characters' });
    }

    // Serialize value
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (e) {
      return err({
        type: 'serialization_failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Check value size
    if (serialized.length > this.maxValueSize) {
      return err({ type: 'value_too_large', maxSize: this.maxValueSize });
    }

    // Check quota
    const currentUsage = await this.calculateUsage();
    const existingSize = this.data.get(this.prefixKey(key))?.length ?? 0;
    const newUsage = currentUsage - existingSize + serialized.length;

    if (newUsage > this.quota) {
      return err({
        type: 'quota_exceeded',
        used: currentUsage,
        quota: this.quota,
        requested: serialized.length,
      });
    }

    this.data.set(this.prefixKey(key), serialized);
    return ok(undefined);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(this.prefixKey(key));
  }

  async keys(): Promise<string[]> {
    const prefix = `${this.pluginId}:`;
    const keys: string[] = [];

    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key.substring(prefix.length));
      }
    }

    return keys;
  }

  async usage(): Promise<{ used: number; quota: number }> {
    return {
      used: await this.calculateUsage(),
      quota: this.quota,
    };
  }

  async clear(): Promise<void> {
    const prefix = `${this.pluginId}:`;
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        this.data.delete(key);
      }
    }
  }

  private prefixKey(key: string): string {
    return `${this.pluginId}:${key}`;
  }

  private async calculateUsage(): Promise<number> {
    let total = 0;
    const prefix = `${this.pluginId}:`;

    for (const [key, value] of this.data.entries()) {
      if (key.startsWith(prefix)) {
        total += value.length;
      }
    }

    return total;
  }
}

// =============================================================================
// Isolated Network Implementation
// =============================================================================

/**
 * Rate limiter for network requests
 */
class RateLimiter {
  private requests: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number = 60, windowMs: number = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  canRequest(): boolean {
    this.cleanup();
    return this.requests.length < this.limit;
  }

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  getStatus(): { remaining: number; resetAt: Date } {
    this.cleanup();
    const oldest = this.requests[0];
    const resetAt = oldest ? new Date(oldest + this.windowMs) : new Date();

    return {
      remaining: Math.max(0, this.limit - this.requests.length),
      resetAt,
    };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter((t) => t > cutoff);
  }
}

/**
 * Isolated network access
 */
export class PluginIsolatedNetwork implements IsolatedNetwork {
  private readonly pluginId: PluginId;
  private readonly allowedDomains: string[];
  private readonly rateLimiter: RateLimiter;
  private readonly maxResponseSize = 10 * 1024 * 1024; // 10MB
  private readonly defaultTimeout = 30000;

  constructor(pluginId: PluginId, allowedDomains: string[] = ['*']) {
    this.pluginId = pluginId;
    this.allowedDomains = allowedDomains;
    this.rateLimiter = new RateLimiter(60, 60000);
  }

  async fetch(
    url: string,
    options: IsolatedFetchOptions = {}
  ): Promise<Result<IsolatedResponse, NetworkError>> {
    // Parse URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return err({ type: 'network_error', message: 'Invalid URL' });
    }

    // Check domain
    if (!this.isDomainAllowed(parsedUrl.hostname)) {
      return err({
        type: 'domain_not_allowed',
        domain: parsedUrl.hostname,
        allowed: this.allowedDomains,
      });
    }

    // Check rate limit
    if (!this.rateLimiter.canRequest()) {
      const status = this.rateLimiter.getStatus();
      return err({
        type: 'rate_limited',
        retryAfter: Math.ceil((status.resetAt.getTime() - Date.now()) / 1000),
      });
    }

    this.rateLimiter.recordRequest();

    // Prepare headers (sanitize)
    const headers: Record<string, string> = {
      'User-Agent': `OwnPilot-Plugin/${this.pluginId}`,
      ...options.headers,
    };

    // Remove potentially dangerous headers
    delete headers['Authorization'];
    delete headers['Cookie'];
    delete headers['X-API-Key'];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout ?? this.defaultTimeout);

      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body
          ? typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Check response size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseSize) {
        return err({ type: 'response_too_large', maxSize: this.maxResponseSize });
      }

      const body = await response.text();

      if (body.length > this.maxResponseSize) {
        return err({ type: 'response_too_large', maxSize: this.maxResponseSize });
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return ok({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        json<T>(): T {
          return JSON.parse(body) as T;
        },
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({ type: 'timeout', timeoutMs: options.timeout ?? this.defaultTimeout });
      }
      return err({
        type: 'network_error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  isDomainAllowed(domain: string): boolean {
    if (this.allowedDomains.includes('*')) return true;

    const normalizedDomain = domain.toLowerCase();

    for (const allowed of this.allowedDomains) {
      // Exact match
      if (allowed.toLowerCase() === normalizedDomain) return true;

      // Wildcard subdomain match (*.example.com)
      if (allowed.startsWith('*.')) {
        const baseDomain = allowed.substring(2).toLowerCase();
        if (
          normalizedDomain === baseDomain ||
          normalizedDomain.endsWith('.' + baseDomain)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  getAllowedDomains(): readonly string[] {
    return [...this.allowedDomains];
  }

  getRateLimitStatus(): { remaining: number; resetAt: Date } {
    return this.rateLimiter.getStatus();
  }
}

// =============================================================================
// Isolated Events Implementation
// =============================================================================

/**
 * Isolated event system
 */
export class PluginIsolatedEvents implements IsolatedEvents {
  private readonly pluginId: PluginId;
  private readonly emitter = new EventEmitter();
  private readonly allowedEvents: Set<AllowedPluginEvent> = new Set([
    'plugin:enabled',
    'plugin:disabled',
    'plugin:config_changed',
    'message:received',
    'tool:called',
    'schedule:triggered',
  ]);

  constructor(pluginId: PluginId) {
    this.pluginId = pluginId;
  }

  on(event: AllowedPluginEvent, handler: (data: unknown) => void): () => void {
    if (!this.allowedEvents.has(event)) {
      console.warn(`[Plugin:${this.pluginId}] Attempted to subscribe to disallowed event: ${event}`);
      return () => {};
    }

    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  emit(event: string, data: unknown): void {
    // Plugins can only emit to their own namespace
    const scopedEvent = `plugin:${this.pluginId}:${event}`;
    this.emitter.emit(scopedEvent, this.sanitizeData(data));
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Internal: dispatch event from system to plugin
   */
  _dispatch(event: AllowedPluginEvent, data: unknown): void {
    this.emitter.emit(event, this.sanitizeData(data));
  }

  private sanitizeData(data: unknown): unknown {
    // Remove potential PII or sensitive data
    if (typeof data !== 'object' || data === null) return data;

    const sanitized = { ...data as Record<string, unknown> };

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'apiKey',
      'secret',
      'credential',
      'ssn',
      'creditCard',
    ];

    for (const field of sensitiveFields) {
      delete sanitized[field];
      delete sanitized[field.toLowerCase()];
      delete sanitized[field.toUpperCase()];
    }

    return sanitized;
  }
}

// =============================================================================
// Isolated Logger Implementation
// =============================================================================

/**
 * Isolated logger that sanitizes output
 */
export class PluginIsolatedLogger implements IsolatedLogger {
  private readonly pluginId: PluginId;
  private readonly logs: Array<{
    level: string;
    message: string;
    data?: Record<string, unknown>;
    timestamp: Date;
  }> = [];
  private readonly maxLogs = 1000;

  constructor(pluginId: PluginId) {
    this.pluginId = pluginId;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  private log(level: string, message: string, data?: Record<string, unknown>): void {
    // Sanitize message
    const sanitizedMessage = this.sanitize(message);
    const sanitizedData = data ? this.sanitizeObject(data) : undefined;

    const entry = {
      level,
      message: sanitizedMessage,
      data: sanitizedData,
      timestamp: new Date(),
    };

    this.logs.push(entry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also output to console with prefix
    const prefix = `[Plugin:${this.pluginId}]`;
    switch (level) {
      case 'debug':
        console.debug(prefix, sanitizedMessage, sanitizedData ?? '');
        break;
      case 'info':
        console.info(prefix, sanitizedMessage, sanitizedData ?? '');
        break;
      case 'warn':
        console.warn(prefix, sanitizedMessage, sanitizedData ?? '');
        break;
      case 'error':
        console.error(prefix, sanitizedMessage, sanitizedData ?? '');
        break;
    }
  }

  private sanitize(text: string): string {
    // Redact potential secrets
    return text
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_CARD]');
  }

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip sensitive keys
      if (/password|secret|token|key|credential|auth/i.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (typeof value === 'string') {
        result[key] = this.sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Get logs (for debugging/admin)
   */
  getLogs(): typeof this.logs {
    return [...this.logs];
  }
}

// =============================================================================
// Isolated Plugin API Implementation
// =============================================================================

/**
 * Isolated inter-plugin communication
 */
export class PluginIsolatedPluginAPI implements IsolatedPluginAPI {
  private readonly pluginId: PluginId;
  private readonly registry: PluginRegistryInterface;
  private readonly enforcer: IsolationEnforcer;

  constructor(
    pluginId: PluginId,
    registry: PluginRegistryInterface,
    enforcer: IsolationEnforcer
  ) {
    this.pluginId = pluginId;
    this.registry = registry;
    this.enforcer = enforcer;
  }

  async getPublicAPI(targetPluginId: string): Promise<Record<string, unknown> | null> {
    // Check if target plugin exists
    const plugin = this.registry.getPlugin(targetPluginId);
    if (!plugin) return null;

    // Check if this plugin is allowed to access target
    const check = this.enforcer.checkAccess(
      this.pluginId,
      `plugin:${targetPluginId}:api`,
      'read'
    );

    if (!check.ok) return null;

    return plugin.publicAPI ?? null;
  }

  async sendMessage(
    targetPluginId: string,
    message: unknown
  ): Promise<Result<void, PluginCommError>> {
    // Check target exists
    const plugin = this.registry.getPlugin(targetPluginId);
    if (!plugin) {
      return err({ type: 'plugin_not_found', pluginId: targetPluginId });
    }

    // Check message size
    const messageStr = JSON.stringify(message);
    if (messageStr.length > 64 * 1024) {
      // 64KB max
      return err({ type: 'message_too_large', maxSize: 64 * 1024 });
    }

    // Send message through registry
    this.registry.deliverMessage(this.pluginId, targetPluginId, message);
    return ok(undefined);
  }

  async listPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    return this.registry.listPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
    }));
  }
}

/**
 * Interface for plugin registry (to avoid circular dependency)
 */
export interface PluginRegistryInterface {
  getPlugin(id: string): { publicAPI?: Record<string, unknown> } | null;
  listPlugins(): Array<{ id: string; name: string; version: string }>;
  deliverMessage(from: string, to: string, message: unknown): void;
}

// =============================================================================
// Plugin Isolation Manager
// =============================================================================

/**
 * Creates and manages isolated plugin contexts
 */
export class PluginIsolationManager {
  private readonly enforcer: IsolationEnforcer;
  private readonly contexts: Map<string, IsolatedPluginContext> = new Map();
  private readonly storages: Map<string, PluginIsolatedStorage> = new Map();
  private registry?: PluginRegistryInterface;

  constructor(config: { maxViolations?: number } = {}) {
    this.enforcer = new IsolationEnforcer(config);
  }

  /**
   * Set plugin registry reference
   */
  setRegistry(registry: PluginRegistryInterface): void {
    this.registry = registry;
  }

  /**
   * Create isolated context for a plugin
   */
  createContext(config: IsolationConfig): IsolatedPluginContext {
    const { pluginId, capabilities, allowedDomains, storageQuota } = config;

    // Create isolated components
    const storage = new PluginIsolatedStorage(pluginId, storageQuota);
    this.storages.set(pluginId, storage);

    const hasNetworkCapability =
      capabilities.includes('network:fetch') ||
      capabilities.includes('network:domains:*') ||
      capabilities.includes('network:domains:specific');

    const network = hasNetworkCapability
      ? new PluginIsolatedNetwork(pluginId, allowedDomains ?? [])
      : null;

    const events = new PluginIsolatedEvents(pluginId);
    const log = new PluginIsolatedLogger(pluginId);

    const plugins = this.registry
      ? new PluginIsolatedPluginAPI(pluginId, this.registry, this.enforcer)
      : ({
          getPublicAPI: async () => null,
          sendMessage: async () => err({ type: 'plugin_not_found', pluginId: '' } as PluginCommError),
          listPlugins: async () => [],
        } as IsolatedPluginAPI);

    const context: IsolatedPluginContext = {
      pluginId,
      version: '1.0.0',
      capabilities: Object.freeze([...capabilities]),
      storage,
      network,
      events,
      log,
      plugins,
    };

    this.contexts.set(pluginId, context);
    return context;
  }

  /**
   * Get context for a plugin
   */
  getContext(pluginId: string): IsolatedPluginContext | undefined {
    return this.contexts.get(pluginId);
  }

  /**
   * Destroy plugin context (cleanup)
   */
  async destroyContext(pluginId: string): Promise<void> {
    const context = this.contexts.get(pluginId);
    if (context) {
      context.events.removeAllListeners();
      await context.storage.clear();
      this.contexts.delete(pluginId);
      this.storages.delete(pluginId);
    }
  }

  /**
   * Get isolation enforcer
   */
  getEnforcer(): IsolationEnforcer {
    return this.enforcer;
  }

  /**
   * Check if plugin has capability
   */
  hasCapability(pluginId: string, capability: PluginCapability): boolean {
    const context = this.contexts.get(pluginId);
    return context?.capabilities.includes(capability) ?? false;
  }

  /**
   * Get all active contexts
   */
  getActiveContexts(): string[] {
    return [...this.contexts.keys()];
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new isolation manager
 */
export function createIsolationManager(
  config: { maxViolations?: number } = {}
): PluginIsolationManager {
  return new PluginIsolationManager(config);
}

/**
 * Default storage quotas by tier
 */
export const STORAGE_QUOTAS = {
  free: 1 * 1024 * 1024, // 1MB
  basic: 10 * 1024 * 1024, // 10MB
  pro: 100 * 1024 * 1024, // 100MB
  enterprise: 1024 * 1024 * 1024, // 1GB
} as const;

/**
 * Default resource limits
 */
export const DEFAULT_ISOLATION_LIMITS = {
  cpuLimit: 5000, // 5 seconds
  memoryLimit: 128 * 1024 * 1024, // 128MB
  executionTimeout: 30000, // 30 seconds
  storageQuota: STORAGE_QUOTAS.basic,
} as const;

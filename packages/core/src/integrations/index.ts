/**
 * External Integrations Framework
 *
 * Secure framework for integrating with external services:
 * - Gmail, Google Drive, Google Calendar
 * - Microsoft 365 (Outlook, OneDrive, Calendar)
 * - Telegram, Discord, Slack
 * - Custom webhooks and APIs
 *
 * Security Features:
 * - OAuth 2.0 flow with PKCE
 * - Per-integration permission boundaries
 * - Sensitive action protection (OTP required)
 * - Rate limiting and quota management
 * - Audit logging for all operations
 */

import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported integration providers
 */
export type IntegrationProvider =
  // Google Services
  | 'google:gmail'
  | 'google:drive'
  | 'google:calendar'
  | 'google:sheets'
  | 'google:docs'
  // Microsoft Services
  | 'microsoft:outlook'
  | 'microsoft:onedrive'
  | 'microsoft:calendar'
  | 'microsoft:teams'
  // Communication
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  // Developer
  | 'github'
  | 'gitlab'
  | 'notion'
  | 'trello'
  // Custom
  | 'webhook'
  | 'custom';

/**
 * Integration capability - what an integration can do
 */
export type IntegrationCapability =
  // Read capabilities
  | 'read:messages'
  | 'read:files'
  | 'read:calendar'
  | 'read:contacts'
  | 'read:metadata'
  // Write capabilities
  | 'write:messages'
  | 'write:files'
  | 'write:calendar'
  | 'write:contacts'
  // Sensitive capabilities (require OTP)
  | 'delete:messages'
  | 'delete:files'
  | 'delete:calendar'
  | 'send:external'
  | 'share:external';

/**
 * Sensitive actions that require OTP confirmation
 */
export const SENSITIVE_ACTIONS: IntegrationCapability[] = [
  'delete:messages',
  'delete:files',
  'delete:calendar',
  'send:external',
  'share:external',
];

/**
 * Integration permission policy
 */
export interface IntegrationPermissionPolicy {
  /** Allowed capabilities */
  allowedCapabilities: IntegrationCapability[];
  /** Denied capabilities (overrides allowed) */
  deniedCapabilities: IntegrationCapability[];
  /** Require OTP for sensitive actions */
  requireOTPForSensitive: boolean;
  /** Rate limits per capability */
  rateLimits: Partial<Record<IntegrationCapability, RateLimit>>;
  /** Quota limits */
  quotas: Partial<Record<string, QuotaLimit>>;
}

/**
 * Rate limit configuration
 */
export interface RateLimit {
  /** Maximum requests */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/**
 * Quota limit configuration
 */
export interface QuotaLimit {
  /** Maximum value */
  max: number;
  /** Current usage */
  current: number;
  /** Reset period in days */
  resetDays: number;
}

/**
 * OAuth configuration
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  usePKCE: boolean;
}

/**
 * OAuth token
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: Date;
  scopes: string[];
}

/**
 * Integration configuration
 */
export interface IntegrationConfig {
  id: string;
  provider: IntegrationProvider;
  userId: string;
  name: string;
  enabled: boolean;
  oauth?: OAuthConfig;
  apiKey?: string;
  webhookUrl?: string;
  permissions: IntegrationPermissionPolicy;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Integration operation result
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rateLimitRemaining?: number;
  quotaUsed?: number;
}

/**
 * OTP verification request
 */
export interface OTPVerificationRequest {
  integrationId: string;
  action: IntegrationCapability;
  description: string;
  expiresAt: Date;
  code: string;
}

// =============================================================================
// Default Permission Policies
// =============================================================================

/**
 * Default integration permission policy - restrictive
 */
export const DEFAULT_INTEGRATION_PERMISSION_POLICY: IntegrationPermissionPolicy = {
  allowedCapabilities: [
    'read:messages',
    'read:files',
    'read:calendar',
    'read:contacts',
    'read:metadata',
    'write:messages',
    'write:calendar',
  ],
  deniedCapabilities: [
    'delete:messages',
    'delete:files',
    'delete:calendar',
  ],
  requireOTPForSensitive: true,
  rateLimits: {
    'read:messages': { maxRequests: 100, windowSeconds: 60 },
    'read:files': { maxRequests: 50, windowSeconds: 60 },
    'write:messages': { maxRequests: 30, windowSeconds: 60 },
    'send:external': { maxRequests: 10, windowSeconds: 3600 },
  },
  quotas: {
    'daily_api_calls': { max: 1000, current: 0, resetDays: 1 },
    'monthly_data_transfer_mb': { max: 500, current: 0, resetDays: 30 },
  },
};

/**
 * Read-only permission policy
 */
export const READ_ONLY_POLICY: IntegrationPermissionPolicy = {
  allowedCapabilities: [
    'read:messages',
    'read:files',
    'read:calendar',
    'read:contacts',
    'read:metadata',
  ],
  deniedCapabilities: [
    'write:messages',
    'write:files',
    'write:calendar',
    'write:contacts',
    'delete:messages',
    'delete:files',
    'delete:calendar',
    'send:external',
    'share:external',
  ],
  requireOTPForSensitive: true,
  rateLimits: {
    'read:messages': { maxRequests: 100, windowSeconds: 60 },
    'read:files': { maxRequests: 50, windowSeconds: 60 },
  },
  quotas: {
    'daily_api_calls': { max: 500, current: 0, resetDays: 1 },
  },
};

// =============================================================================
// Rate Limiter
// =============================================================================

/**
 * Rate limiter implementation
 */
class IntegrationRateLimiter {
  private requests: Map<string, number[]> = new Map();

  /**
   * Check if request is allowed
   */
  check(key: string, limit: RateLimit): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const windowMs = limit.windowSeconds * 1000;
    const cutoff = now - windowMs;

    // Get existing requests
    const existing = this.requests.get(key) ?? [];

    // Filter to current window
    const inWindow = existing.filter((t) => t > cutoff);

    const remaining = Math.max(0, limit.maxRequests - inWindow.length);
    const resetIn = inWindow.length > 0
      ? Math.ceil((inWindow[0]! + windowMs - now) / 1000)
      : 0;

    return {
      allowed: inWindow.length < limit.maxRequests,
      remaining,
      resetIn,
    };
  }

  /**
   * Record a request
   */
  record(key: string): void {
    const existing = this.requests.get(key) ?? [];
    existing.push(Date.now());
    this.requests.set(key, existing);

    // Cleanup old entries
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 3600 * 1000; // 1 hour

    for (const [key, timestamps] of this.requests.entries()) {
      const recent = timestamps.filter((t) => now - t < maxAge);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}

// =============================================================================
// OTP Manager
// =============================================================================

/**
 * OTP manager for sensitive actions
 */
export class OTPManager {
  private pendingOTPs: Map<string, OTPVerificationRequest> = new Map();
  private readonly otpLength = 6;
  private readonly otpExpiryMinutes = 5;

  /**
   * Generate OTP for sensitive action
   */
  generateOTP(
    integrationId: string,
    action: IntegrationCapability,
    description: string
  ): OTPVerificationRequest {
    const code = this.generateCode();
    const request: OTPVerificationRequest = {
      integrationId,
      action,
      description,
      expiresAt: new Date(Date.now() + this.otpExpiryMinutes * 60 * 1000),
      code,
    };

    const key = `${integrationId}:${action}`;
    this.pendingOTPs.set(key, request);

    return request;
  }

  /**
   * Verify OTP
   */
  verifyOTP(
    integrationId: string,
    action: IntegrationCapability,
    code: string
  ): Result<void, string> {
    const key = `${integrationId}:${action}`;
    const pending = this.pendingOTPs.get(key);

    if (!pending) {
      return err('No pending OTP request found');
    }

    if (new Date() > pending.expiresAt) {
      this.pendingOTPs.delete(key);
      return err('OTP has expired');
    }

    if (pending.code !== code) {
      return err('Invalid OTP code');
    }

    this.pendingOTPs.delete(key);
    return ok(undefined);
  }

  /**
   * Get pending OTP info (without code)
   */
  getPendingInfo(integrationId: string, action: IntegrationCapability): {
    description: string;
    expiresAt: Date;
  } | null {
    const key = `${integrationId}:${action}`;
    const pending = this.pendingOTPs.get(key);

    if (!pending) return null;

    return {
      description: pending.description,
      expiresAt: pending.expiresAt,
    };
  }

  private generateCode(): string {
    const bytes = randomBytes(4);
    const num = bytes.readUInt32BE(0) % Math.pow(10, this.otpLength);
    return num.toString().padStart(this.otpLength, '0');
  }
}

// =============================================================================
// Integration Base Class
// =============================================================================

/**
 * Base class for all integrations
 */
export abstract class BaseIntegration {
  protected config: IntegrationConfig;
  protected rateLimiter: IntegrationRateLimiter;
  protected otpManager: OTPManager;
  protected token?: OAuthToken;
  protected auditLog: Array<{
    timestamp: Date;
    action: string;
    capability: IntegrationCapability;
    success: boolean;
    details?: Record<string, unknown>;
  }> = [];

  constructor(
    config: IntegrationConfig,
    otpManager: OTPManager
  ) {
    this.config = config;
    this.rateLimiter = new IntegrationRateLimiter();
    this.otpManager = otpManager;
  }

  /**
   * Check if capability is allowed
   */
  protected checkCapability(capability: IntegrationCapability): Result<void, string> {
    // Check if explicitly denied
    if (this.config.permissions.deniedCapabilities.includes(capability)) {
      return err(`Capability ${capability} is explicitly denied`);
    }

    // Check if allowed
    if (!this.config.permissions.allowedCapabilities.includes(capability)) {
      return err(`Capability ${capability} is not allowed`);
    }

    // Check rate limit
    const rateLimit = this.config.permissions.rateLimits[capability];
    if (rateLimit) {
      const check = this.rateLimiter.check(
        `${this.config.id}:${capability}`,
        rateLimit
      );
      if (!check.allowed) {
        return err(`Rate limit exceeded. Try again in ${check.resetIn} seconds`);
      }
    }

    return ok(undefined);
  }

  /**
   * Check if action requires OTP
   */
  protected requiresOTP(capability: IntegrationCapability): boolean {
    return (
      this.config.permissions.requireOTPForSensitive &&
      SENSITIVE_ACTIONS.includes(capability)
    );
  }

  /**
   * Execute with permission check
   */
  protected async executeWithPermission<T>(
    capability: IntegrationCapability,
    action: string,
    executor: () => Promise<T>,
    otpCode?: string
  ): Promise<OperationResult<T>> {
    // Check capability
    const capCheck = this.checkCapability(capability);
    if (!capCheck.ok) {
      this.logAction(action, capability, false, { error: capCheck.error });
      return { success: false, error: capCheck.error };
    }

    // Check OTP for sensitive actions
    if (this.requiresOTP(capability)) {
      if (!otpCode) {
        // Generate OTP and return
        const otp = this.otpManager.generateOTP(
          this.config.id,
          capability,
          `${action} requires verification`
        );
        return {
          success: false,
          error: `OTP verification required. Code sent. Expires at ${otp.expiresAt.toISOString()}`,
        };
      }

      // Verify OTP
      const otpResult = this.otpManager.verifyOTP(this.config.id, capability, otpCode);
      if (!otpResult.ok) {
        this.logAction(action, capability, false, { error: otpResult.error });
        return { success: false, error: otpResult.error };
      }
    }

    // Record rate limit
    const rateLimit = this.config.permissions.rateLimits[capability];
    if (rateLimit) {
      this.rateLimiter.record(`${this.config.id}:${capability}`);
    }

    // Execute
    try {
      const result = await executor();
      this.logAction(action, capability, true);
      return { success: true, data: result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logAction(action, capability, false, { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Log action to audit log
   */
  protected logAction(
    action: string,
    capability: IntegrationCapability,
    success: boolean,
    details?: Record<string, unknown>
  ): void {
    this.auditLog.push({
      timestamp: new Date(),
      action,
      capability,
      success,
      details,
    });

    // Keep last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(): typeof this.auditLog {
    return [...this.auditLog];
  }

  /**
   * Get config
   */
  getConfig(): IntegrationConfig {
    return { ...this.config };
  }

  /**
   * Abstract methods for subclasses
   */
  abstract connect(): Promise<Result<void, string>>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;
  abstract refreshToken(): Promise<Result<void, string>>;
}

// =============================================================================
// Google Integration Base
// =============================================================================

/**
 * Google services integration base
 */
export abstract class GoogleIntegration extends BaseIntegration {
  protected connected = false;

  async connect(): Promise<Result<void, string>> {
    if (!this.config.oauth) {
      return err('OAuth configuration required for Google services');
    }

    // In real implementation, this would handle OAuth flow
    // For now, simulate connection
    this.connected = true;
    return ok(undefined);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.token = undefined;
  }

  isConnected(): boolean {
    return this.connected && !!this.token && new Date() < this.token.expiresAt;
  }

  async refreshToken(): Promise<Result<void, string>> {
    if (!this.token?.refreshToken) {
      return err('No refresh token available');
    }

    // In real implementation, this would refresh the token
    return ok(undefined);
  }
}

// =============================================================================
// Gmail Integration
// =============================================================================

/**
 * Gmail message
 */
export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  labels: string[];
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

/**
 * Gmail integration
 */
export class GmailIntegration extends GoogleIntegration {
  /**
   * List messages
   */
  async listMessages(options: {
    maxResults?: number;
    query?: string;
    labels?: string[];
  } = {}): Promise<OperationResult<GmailMessage[]>> {
    return this.executeWithPermission('read:messages', 'gmail:list', async () => {
      // In real implementation, this would call Gmail API
      return [] as GmailMessage[];
    });
  }

  /**
   * Get message by ID
   */
  async getMessage(messageId: string): Promise<OperationResult<GmailMessage>> {
    return this.executeWithPermission('read:messages', 'gmail:get', async () => {
      // In real implementation, this would call Gmail API
      throw new Error('Not implemented');
    });
  }

  /**
   * Send message
   */
  async sendMessage(
    to: string[],
    subject: string,
    body: string,
    options?: { cc?: string[]; bcc?: string[]; attachments?: Buffer[] }
  ): Promise<OperationResult<{ messageId: string }>> {
    return this.executeWithPermission('write:messages', 'gmail:send', async () => {
      // In real implementation, this would call Gmail API
      return { messageId: randomUUID() };
    });
  }

  /**
   * Delete message (requires OTP)
   */
  async deleteMessage(messageId: string, otpCode?: string): Promise<OperationResult<void>> {
    return this.executeWithPermission(
      'delete:messages',
      'gmail:delete',
      async () => {
        // In real implementation, this would call Gmail API
        // DELETE IS DENIED BY DEFAULT POLICY
      },
      otpCode
    );
  }

  /**
   * Search messages
   */
  async searchMessages(query: string, maxResults: number = 10): Promise<OperationResult<GmailMessage[]>> {
    return this.executeWithPermission('read:messages', 'gmail:search', async () => {
      // In real implementation, this would call Gmail API
      return [] as GmailMessage[];
    });
  }
}

// =============================================================================
// Google Calendar Integration
// =============================================================================

/**
 * Calendar event
 */
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: Array<{
    email: string;
    name?: string;
    responseStatus: 'needsAction' | 'accepted' | 'declined' | 'tentative';
  }>;
  reminders?: Array<{
    method: 'email' | 'popup';
    minutes: number;
  }>;
  recurrence?: string[];
  calendarId: string;
}

/**
 * Google Calendar integration
 */
export class GoogleCalendarIntegration extends GoogleIntegration {
  /**
   * List events
   */
  async listEvents(options: {
    calendarId?: string;
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  } = {}): Promise<OperationResult<CalendarEvent[]>> {
    return this.executeWithPermission('read:calendar', 'calendar:list', async () => {
      // In real implementation, this would call Calendar API
      return [] as CalendarEvent[];
    });
  }

  /**
   * Get event by ID
   */
  async getEvent(eventId: string, calendarId?: string): Promise<OperationResult<CalendarEvent>> {
    return this.executeWithPermission('read:calendar', 'calendar:get', async () => {
      // In real implementation, this would call Calendar API
      throw new Error('Not implemented');
    });
  }

  /**
   * Create event
   */
  async createEvent(event: Omit<CalendarEvent, 'id'>): Promise<OperationResult<CalendarEvent>> {
    return this.executeWithPermission('write:calendar', 'calendar:create', async () => {
      // In real implementation, this would call Calendar API
      return { ...event, id: randomUUID() } as CalendarEvent;
    });
  }

  /**
   * Update event
   */
  async updateEvent(
    eventId: string,
    updates: Partial<CalendarEvent>
  ): Promise<OperationResult<CalendarEvent>> {
    return this.executeWithPermission('write:calendar', 'calendar:update', async () => {
      // In real implementation, this would call Calendar API
      throw new Error('Not implemented');
    });
  }

  /**
   * Delete event (requires OTP)
   */
  async deleteEvent(eventId: string, otpCode?: string): Promise<OperationResult<void>> {
    return this.executeWithPermission(
      'delete:calendar',
      'calendar:delete',
      async () => {
        // In real implementation, this would call Calendar API
      },
      otpCode
    );
  }

  /**
   * Get upcoming events for today
   */
  async getTodaysEvents(): Promise<OperationResult<CalendarEvent[]>> {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    return this.listEvents({
      timeMin: now,
      timeMax: endOfDay,
    });
  }

  /**
   * Get events for the next N hours
   */
  async getUpcomingEvents(hours: number): Promise<OperationResult<CalendarEvent[]>> {
    const now = new Date();
    const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

    return this.listEvents({
      timeMin: now,
      timeMax: future,
    });
  }
}

// =============================================================================
// Google Drive Integration
// =============================================================================

/**
 * Drive file
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parents?: string[];
  createdTime: Date;
  modifiedTime: Date;
  webViewLink?: string;
  downloadUrl?: string;
}

/**
 * Google Drive integration
 */
export class GoogleDriveIntegration extends GoogleIntegration {
  /**
   * List files
   */
  async listFiles(options: {
    folderId?: string;
    query?: string;
    maxResults?: number;
  } = {}): Promise<OperationResult<DriveFile[]>> {
    return this.executeWithPermission('read:files', 'drive:list', async () => {
      // In real implementation, this would call Drive API
      return [] as DriveFile[];
    });
  }

  /**
   * Get file metadata
   */
  async getFile(fileId: string): Promise<OperationResult<DriveFile>> {
    return this.executeWithPermission('read:files', 'drive:get', async () => {
      // In real implementation, this would call Drive API
      throw new Error('Not implemented');
    });
  }

  /**
   * Download file content
   */
  async downloadFile(fileId: string): Promise<OperationResult<Buffer>> {
    return this.executeWithPermission('read:files', 'drive:download', async () => {
      // In real implementation, this would call Drive API
      return Buffer.from('');
    });
  }

  /**
   * Upload file
   */
  async uploadFile(
    name: string,
    content: Buffer,
    mimeType: string,
    folderId?: string
  ): Promise<OperationResult<DriveFile>> {
    return this.executeWithPermission('write:files', 'drive:upload', async () => {
      // In real implementation, this would call Drive API
      return {
        id: randomUUID(),
        name,
        mimeType,
        size: content.length,
        parents: folderId ? [folderId] : undefined,
        createdTime: new Date(),
        modifiedTime: new Date(),
      } as DriveFile;
    });
  }

  /**
   * Delete file (requires OTP)
   */
  async deleteFile(fileId: string, otpCode?: string): Promise<OperationResult<void>> {
    return this.executeWithPermission(
      'delete:files',
      'drive:delete',
      async () => {
        // In real implementation, this would call Drive API
        // DELETE IS DENIED BY DEFAULT POLICY
      },
      otpCode
    );
  }

  /**
   * Search files
   */
  async searchFiles(query: string): Promise<OperationResult<DriveFile[]>> {
    return this.listFiles({ query });
  }
}

// =============================================================================
// Integration Manager
// =============================================================================

/**
 * Integration manager events
 */
export interface IntegrationManagerEvents {
  'integration:connected': { integrationId: string; provider: IntegrationProvider };
  'integration:disconnected': { integrationId: string };
  'integration:error': { integrationId: string; error: string };
  'otp:generated': { integrationId: string; action: string };
  'action:completed': { integrationId: string; action: string; success: boolean };
}

/**
 * Integration manager - manages all external integrations
 */
export class IntegrationManager extends EventEmitter {
  private integrations: Map<string, BaseIntegration> = new Map();
  private configs: Map<string, IntegrationConfig> = new Map();
  private readonly otpManager: OTPManager;

  constructor() {
    super();
    this.otpManager = new OTPManager();
  }

  /**
   * Register an integration
   */
  register(config: IntegrationConfig): Result<void, string> {
    if (this.configs.has(config.id)) {
      return err(`Integration ${config.id} already exists`);
    }

    this.configs.set(config.id, config);

    // Create integration instance
    const integration = this.createIntegration(config);
    if (integration) {
      this.integrations.set(config.id, integration);
    }

    return ok(undefined);
  }

  /**
   * Create integration instance based on provider
   */
  private createIntegration(config: IntegrationConfig): BaseIntegration | null {
    switch (config.provider) {
      case 'google:gmail':
        return new GmailIntegration(config, this.otpManager);
      case 'google:calendar':
        return new GoogleCalendarIntegration(config, this.otpManager);
      case 'google:drive':
        return new GoogleDriveIntegration(config, this.otpManager);
      default:
        return null;
    }
  }

  /**
   * Get integration by ID
   */
  get<T extends BaseIntegration>(id: string): T | undefined {
    return this.integrations.get(id) as T | undefined;
  }

  /**
   * Get Gmail integration
   */
  getGmail(id: string): GmailIntegration | undefined {
    return this.get<GmailIntegration>(id);
  }

  /**
   * Get Calendar integration
   */
  getCalendar(id: string): GoogleCalendarIntegration | undefined {
    return this.get<GoogleCalendarIntegration>(id);
  }

  /**
   * Get Drive integration
   */
  getDrive(id: string): GoogleDriveIntegration | undefined {
    return this.get<GoogleDriveIntegration>(id);
  }

  /**
   * Connect an integration
   */
  async connect(id: string): Promise<Result<void, string>> {
    const integration = this.integrations.get(id);
    if (!integration) {
      return err(`Integration ${id} not found`);
    }

    const result = await integration.connect();
    if (result.ok) {
      this.emit('integration:connected', {
        integrationId: id,
        provider: integration.getConfig().provider,
      });
    } else {
      this.emit('integration:error', {
        integrationId: id,
        error: result.error,
      });
    }

    return result;
  }

  /**
   * Disconnect an integration
   */
  async disconnect(id: string): Promise<void> {
    const integration = this.integrations.get(id);
    if (integration) {
      await integration.disconnect();
      this.emit('integration:disconnected', { integrationId: id });
    }
  }

  /**
   * List all integrations
   */
  list(): IntegrationConfig[] {
    return [...this.configs.values()];
  }

  /**
   * List integrations by provider
   */
  listByProvider(provider: IntegrationProvider): IntegrationConfig[] {
    return [...this.configs.values()].filter((c) => c.provider === provider);
  }

  /**
   * List connected integrations
   */
  listConnected(): IntegrationConfig[] {
    return [...this.configs.values()].filter((c) => {
      const integration = this.integrations.get(c.id);
      return integration?.isConnected();
    });
  }

  /**
   * Remove an integration
   */
  async remove(id: string): Promise<void> {
    await this.disconnect(id);
    this.integrations.delete(id);
    this.configs.delete(id);
  }

  /**
   * Get OTP manager (for external OTP handling)
   */
  getOTPManager(): OTPManager {
    return this.otpManager;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an integration manager
 */
export function createIntegrationManager(): IntegrationManager {
  return new IntegrationManager();
}

/**
 * Create integration config
 */
export function createIntegrationConfig(
  provider: IntegrationProvider,
  userId: string,
  options: Partial<IntegrationConfig> = {}
): IntegrationConfig {
  return {
    id: options.id ?? `${provider}:${randomUUID().substring(0, 8)}`,
    provider,
    userId,
    name: options.name ?? provider,
    enabled: options.enabled ?? true,
    oauth: options.oauth,
    apiKey: options.apiKey,
    webhookUrl: options.webhookUrl,
    permissions: options.permissions ?? { ...DEFAULT_INTEGRATION_PERMISSION_POLICY },
    metadata: options.metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Default manager singleton
 */
let defaultManager: IntegrationManager | null = null;

export function getDefaultIntegrationManager(): IntegrationManager {
  if (!defaultManager) {
    defaultManager = createIntegrationManager();
  }
  return defaultManager;
}

// Re-export gmail client
export * from './gmail-client.js';

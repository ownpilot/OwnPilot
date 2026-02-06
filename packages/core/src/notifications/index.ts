/**
 * Notification Channel System
 *
 * Multi-channel notification delivery:
 * - Telegram
 * - Email
 * - Push notifications
 * - Webhooks
 *
 * Features:
 * - Channel priority and fallback
 * - Delivery tracking
 * - Rate limiting
 * - Template support
 * - Scheduled notifications
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Notification channel types
 */
export type NotificationChannel =
  | 'telegram'
  | 'email'
  | 'push'
  | 'webhook'
  | 'sms';

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification status
 */
export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'cancelled';

/**
 * Notification content
 */
export interface NotificationContent {
  /** Title/subject */
  title: string;
  /** Body text */
  body: string;
  /** HTML body (for email) */
  htmlBody?: string;
  /** Markdown body (for Telegram) */
  markdownBody?: string;
  /** Embedded data */
  data?: Record<string, unknown>;
  /** Action buttons */
  actions?: Array<{
    label: string;
    url?: string;
    action?: string;
  }>;
  /** Attachments */
  attachments?: Array<{
    name: string;
    content: Buffer | string;
    mimeType: string;
  }>;
}

/**
 * Notification request
 */
export interface NotificationRequest {
  /** Unique ID */
  id?: string;
  /** User ID */
  userId: string;
  /** Notification content */
  content: NotificationContent;
  /** Target channels (in priority order) */
  channels: NotificationChannel[];
  /** Priority */
  priority: NotificationPriority;
  /** Schedule for later */
  scheduledAt?: Date;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Notification result
 */
export interface NotificationResult {
  id: string;
  status: NotificationStatus;
  channel?: NotificationChannel;
  deliveredAt?: Date;
  error?: string;
  retryCount: number;
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  priority: number;
  credentials: Record<string, string>;
  rateLimit?: {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
  };
  templates?: Record<string, string>;
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  userId: string;
  /** Enabled channels in priority order */
  channels: NotificationChannel[];
  /** Quiet hours (no notifications) */
  quietHours?: {
    start: string; // HH:MM
    end: string; // HH:MM
    timezone: string;
  };
  /** Priority filter (only receive this priority or higher) */
  minPriority: NotificationPriority;
  /** Channel-specific settings */
  channelSettings: Partial<Record<NotificationChannel, {
    enabled: boolean;
    chatId?: string;
    email?: string;
    webhookUrl?: string;
  }>>;
}

// =============================================================================
// Channel Handlers
// =============================================================================

/**
 * Base channel handler
 */
export interface ChannelHandler {
  channel: NotificationChannel;
  send(
    notification: NotificationRequest,
    userPrefs: UserNotificationPreferences,
    config: ChannelConfig
  ): Promise<Result<void, string>>;
  validateConfig(config: ChannelConfig): Result<void, string>;
}

/**
 * Telegram channel handler
 */
export class TelegramChannelHandler implements ChannelHandler {
  channel: NotificationChannel = 'telegram';

  async send(
    notification: NotificationRequest,
    userPrefs: UserNotificationPreferences,
    config: ChannelConfig
  ): Promise<Result<void, string>> {
    const chatId = userPrefs.channelSettings?.telegram?.chatId;
    if (!chatId) {
      return err('No Telegram chat ID configured');
    }

    const botToken = config.credentials.botToken;
    if (!botToken) {
      return err('Telegram bot token not configured');
    }

    try {
      // Format message
      const text = notification.content.markdownBody ??
        `*${notification.content.title}*\n\n${notification.content.body}`;

      // In real implementation, send via Telegram Bot API
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return err(`Telegram API error: ${error}`);
      }

      return ok(undefined);
    } catch (error) {
      return err(`Failed to send Telegram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  validateConfig(config: ChannelConfig): Result<void, string> {
    if (!config.credentials.botToken) {
      return err('Telegram bot token is required');
    }
    return ok(undefined);
  }
}

/**
 * Webhook channel handler (generic)
 */
export class WebhookChannelHandler implements ChannelHandler {
  channel: NotificationChannel = 'webhook';

  async send(
    notification: NotificationRequest,
    userPrefs: UserNotificationPreferences,
    config: ChannelConfig
  ): Promise<Result<void, string>> {
    const webhookUrl = userPrefs.channelSettings?.webhook?.webhookUrl ??
      config.credentials.webhookUrl;

    if (!webhookUrl) {
      return err('No webhook URL configured');
    }

    try {
      const payload = {
        id: notification.id,
        userId: notification.userId,
        title: notification.content.title,
        body: notification.content.body,
        priority: notification.priority,
        timestamp: new Date().toISOString(),
        data: notification.content.data,
        metadata: notification.metadata,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add auth header if configured
      if (config.credentials.authHeader) {
        headers['Authorization'] = config.credentials.authHeader;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        return err(`Webhook error: ${error}`);
      }

      return ok(undefined);
    } catch (error) {
      return err(`Failed to send webhook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  validateConfig(config: ChannelConfig): Result<void, string> {
    if (!config.credentials.webhookUrl) {
      return err('Webhook URL is required');
    }
    return ok(undefined);
  }
}

// =============================================================================
// Rate Limiter
// =============================================================================

/**
 * Notification rate limiter
 */
class NotificationRateLimiter {
  private counts: Map<string, { minute: number[]; hour: number[]; day: number[] }> = new Map();

  check(
    key: string,
    limits: { maxPerMinute: number; maxPerHour: number; maxPerDay: number }
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const counts = this.getCounts(key);

    // Clean old entries
    const minuteAgo = now - 60 * 1000;
    const hourAgo = now - 3600 * 1000;
    const dayAgo = now - 86400 * 1000;

    counts.minute = counts.minute.filter((t) => t > minuteAgo);
    counts.hour = counts.hour.filter((t) => t > hourAgo);
    counts.day = counts.day.filter((t) => t > dayAgo);

    // Remove stale keys to prevent unbounded Map growth
    if (counts.minute.length === 0 && counts.hour.length === 0 && counts.day.length === 0) {
      this.counts.delete(key);
      return { allowed: true };
    }

    // Check limits
    if (counts.minute.length >= limits.maxPerMinute) {
      return { allowed: false, reason: 'Minute limit exceeded' };
    }
    if (counts.hour.length >= limits.maxPerHour) {
      return { allowed: false, reason: 'Hour limit exceeded' };
    }
    if (counts.day.length >= limits.maxPerDay) {
      return { allowed: false, reason: 'Day limit exceeded' };
    }

    return { allowed: true };
  }

  record(key: string): void {
    const now = Date.now();
    const counts = this.getCounts(key);
    counts.minute.push(now);
    counts.hour.push(now);
    counts.day.push(now);
  }

  private getCounts(key: string) {
    if (!this.counts.has(key)) {
      this.counts.set(key, { minute: [], hour: [], day: [] });
    }
    return this.counts.get(key)!;
  }
}

// =============================================================================
// Notification Manager
// =============================================================================

/**
 * Notification manager events
 */
export interface NotificationManagerEvents {
  'notification:queued': { id: string; userId: string };
  'notification:sending': { id: string; channel: NotificationChannel };
  'notification:delivered': { id: string; channel: NotificationChannel };
  'notification:failed': { id: string; channel: NotificationChannel; error: string };
  'notification:scheduled': { id: string; scheduledAt: Date };
}

/**
 * Notification manager - central notification orchestration
 */
export class NotificationManager extends EventEmitter {
  private handlers: Map<NotificationChannel, ChannelHandler> = new Map();
  private configs: Map<NotificationChannel, ChannelConfig> = new Map();
  private userPrefs: Map<string, UserNotificationPreferences> = new Map();
  private queue: NotificationRequest[] = [];
  private results: Map<string, NotificationResult> = new Map();
  private readonly MAX_RESULTS = 1000;
  private rateLimiter: NotificationRateLimiter;
  private scheduled: Map<string, { notification: NotificationRequest; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private processing = false;

  constructor() {
    super();
    this.rateLimiter = new NotificationRateLimiter();

    // Register default handlers
    this.registerHandler(new TelegramChannelHandler());
    this.registerHandler(new WebhookChannelHandler());
  }

  /**
   * Register a channel handler
   */
  registerHandler(handler: ChannelHandler): void {
    this.handlers.set(handler.channel, handler);
  }

  /**
   * Configure a channel
   */
  configureChannel(config: ChannelConfig): Result<void, string> {
    const handler = this.handlers.get(config.channel);
    if (!handler) {
      return err(`No handler registered for channel ${config.channel}`);
    }

    const validation = handler.validateConfig(config);
    if (!validation.ok) {
      return validation;
    }

    this.configs.set(config.channel, config);
    return ok(undefined);
  }

  /**
   * Set user notification preferences
   */
  setUserPreferences(prefs: UserNotificationPreferences): void {
    this.userPrefs.set(prefs.userId, prefs);
  }

  /**
   * Get user notification preferences
   */
  getUserPreferences(userId: string): UserNotificationPreferences | undefined {
    return this.userPrefs.get(userId);
  }

  /**
   * Send notification
   */
  async send(request: NotificationRequest): Promise<NotificationResult> {
    const id = request.id ?? randomUUID();
    request.id = id;

    // Create initial result
    const result: NotificationResult = {
      id,
      status: 'pending',
      retryCount: 0,
    };
    this.results.set(id, result);

    // Evict oldest results to prevent unbounded growth
    if (this.results.size > this.MAX_RESULTS) {
      const iter = this.results.keys();
      const oldest = iter.next().value;
      if (oldest) this.results.delete(oldest);
    }

    // Handle scheduled notifications
    if (request.scheduledAt && request.scheduledAt > new Date()) {
      return this.scheduleNotification(request);
    }

    // Queue for immediate processing
    this.queue.push(request);
    this.emit('notification:queued', { id, userId: request.userId });

    // Process queue
    await this.processQueue();

    return this.results.get(id) ?? result;
  }

  /**
   * Schedule notification for later
   */
  private scheduleNotification(request: NotificationRequest): NotificationResult {
    const id = request.id!;
    const delay = request.scheduledAt!.getTime() - Date.now();

    const timeout = setTimeout(() => {
      this.scheduled.delete(id);
      request.scheduledAt = undefined;
      this.send(request);
    }, delay);

    this.scheduled.set(id, { notification: request, timeout });

    const result: NotificationResult = {
      id,
      status: 'pending',
      retryCount: 0,
    };
    this.results.set(id, result);

    this.emit('notification:scheduled', { id, scheduledAt: request.scheduledAt! });
    return result;
  }

  /**
   * Cancel scheduled notification
   */
  cancelScheduled(id: string): boolean {
    const scheduled = this.scheduled.get(id);
    if (scheduled) {
      clearTimeout(scheduled.timeout);
      this.scheduled.delete(id);

      const result = this.results.get(id);
      if (result) {
        result.status = 'cancelled';
      }

      return true;
    }
    return false;
  }

  /**
   * Process notification queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const notification = this.queue.shift()!;
      await this.processNotification(notification);
    }

    this.processing = false;
  }

  /**
   * Process single notification
   */
  private async processNotification(notification: NotificationRequest): Promise<void> {
    const result = this.results.get(notification.id!);
    if (!result) return;

    result.status = 'sending';

    // Get user preferences
    const userPrefs = this.userPrefs.get(notification.userId);
    if (!userPrefs) {
      result.status = 'failed';
      result.error = 'User preferences not found';
      return;
    }

    // Check quiet hours
    if (this.isInQuietHours(userPrefs)) {
      // Reschedule for after quiet hours
      const endTime = this.getQuietHoursEnd(userPrefs);
      if (endTime) {
        notification.scheduledAt = endTime;
        this.scheduleNotification(notification);
        return;
      }
    }

    // Check priority filter
    if (!this.passesPriorityFilter(notification.priority, userPrefs.minPriority)) {
      result.status = 'cancelled';
      result.error = 'Below user priority threshold';
      return;
    }

    // Determine channels to try (intersection of request and user prefs)
    const channels = notification.channels.filter(
      (c) => userPrefs.channels.includes(c) && this.configs.has(c)
    );

    if (channels.length === 0) {
      result.status = 'failed';
      result.error = 'No available channels';
      return;
    }

    // Try channels in order
    for (const channel of channels) {
      const config = this.configs.get(channel)!;
      const handler = this.handlers.get(channel)!;

      // Check rate limit
      if (config.rateLimit) {
        const rateLimitCheck = this.rateLimiter.check(
          `${notification.userId}:${channel}`,
          config.rateLimit
        );
        if (!rateLimitCheck.allowed) {
          continue; // Try next channel
        }
      }

      this.emit('notification:sending', { id: notification.id!, channel });

      const sendResult = await handler.send(notification, userPrefs, config);

      if (sendResult.ok) {
        result.status = 'delivered';
        result.channel = channel;
        result.deliveredAt = new Date();

        // Record rate limit
        if (config.rateLimit) {
          this.rateLimiter.record(`${notification.userId}:${channel}`);
        }

        this.emit('notification:delivered', { id: notification.id!, channel });
        return;
      }

      // Log failure and try next channel
      result.retryCount++;
      this.emit('notification:failed', {
        id: notification.id!,
        channel,
        error: sendResult.error,
      });
    }

    // All channels failed
    result.status = 'failed';
    result.error = 'All channels failed';
  }

  /**
   * Check if current time is in quiet hours
   */
  private isInQuietHours(prefs: UserNotificationPreferences): boolean {
    if (!prefs.quietHours) return false;

    const now = new Date();
    const [startHour, startMin] = prefs.quietHours.start.split(':').map(Number);
    const [endHour, endMin] = prefs.quietHours.end.split(':').map(Number);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startHour! * 60 + startMin!;
    const endMinutes = endHour! * 60 + endMin!;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Quiet hours span midnight
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }

  /**
   * Get end of quiet hours
   */
  private getQuietHoursEnd(prefs: UserNotificationPreferences): Date | null {
    if (!prefs.quietHours) return null;

    const now = new Date();
    const [endHour, endMin] = prefs.quietHours.end.split(':').map(Number);

    const endTime = new Date(now);
    endTime.setHours(endHour!, endMin!, 0, 0);

    if (endTime <= now) {
      endTime.setDate(endTime.getDate() + 1);
    }

    return endTime;
  }

  /**
   * Check if notification passes priority filter
   */
  private passesPriorityFilter(
    notifPriority: NotificationPriority,
    minPriority: NotificationPriority
  ): boolean {
    const priorityOrder: NotificationPriority[] = ['low', 'normal', 'high', 'urgent'];
    return priorityOrder.indexOf(notifPriority) >= priorityOrder.indexOf(minPriority);
  }

  /**
   * Get notification result
   */
  getResult(id: string): NotificationResult | undefined {
    return this.results.get(id);
  }

  /**
   * Get pending notifications for user
   */
  getPending(userId: string): NotificationRequest[] {
    return this.queue.filter((n) => n.userId === userId);
  }

  /**
   * Get scheduled notifications for user
   */
  getScheduled(userId: string): NotificationRequest[] {
    return [...this.scheduled.values()]
      .filter((s) => s.notification.userId === userId)
      .map((s) => s.notification);
  }
}

// =============================================================================
// Notification Templates
// =============================================================================

/**
 * Notification template
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  channel?: NotificationChannel;
  title: string;
  body: string;
  htmlBody?: string;
  markdownBody?: string;
  variables: string[];
}

/**
 * Template registry
 */
export class NotificationTemplateRegistry {
  private templates: Map<string, NotificationTemplate> = new Map();

  /**
   * Register template
   */
  register(template: NotificationTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get template
   */
  get(id: string): NotificationTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Render template
   */
  render(
    id: string,
    variables: Record<string, string>
  ): NotificationContent | null {
    const template = this.templates.get(id);
    if (!template) return null;

    const render = (text: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      return result;
    };

    return {
      title: render(template.title),
      body: render(template.body),
      htmlBody: template.htmlBody ? render(template.htmlBody) : undefined,
      markdownBody: template.markdownBody ? render(template.markdownBody) : undefined,
    };
  }

  /**
   * List templates
   */
  list(): NotificationTemplate[] {
    return [...this.templates.values()];
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create notification manager
 */
export function createNotificationManager(): NotificationManager {
  return new NotificationManager();
}

/**
 * Create template registry
 */
export function createTemplateRegistry(): NotificationTemplateRegistry {
  return new NotificationTemplateRegistry();
}

/**
 * Default notification manager singleton
 */
let defaultNotificationManager: NotificationManager | null = null;

export function getDefaultNotificationManager(): NotificationManager {
  if (!defaultNotificationManager) {
    defaultNotificationManager = createNotificationManager();
  }
  return defaultNotificationManager;
}

// =============================================================================
// Pre-built Templates
// =============================================================================

/**
 * Common notification templates
 */
export const COMMON_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'reminder',
    name: 'Reminder',
    title: 'Reminder: {{title}}',
    body: '{{message}}',
    markdownBody: '🔔 **Reminder**\n\n{{message}}',
    variables: ['title', 'message'],
  },
  {
    id: 'calendar_event',
    name: 'Calendar Event',
    title: '📅 {{event_title}}',
    body: '{{event_title}} starts in {{time_until}}.\n\n📍 {{location}}',
    markdownBody: '📅 **{{event_title}}**\n\n⏰ In {{time_until}}\n📍 {{location}}',
    variables: ['event_title', 'time_until', 'location'],
  },
  {
    id: 'task_due',
    name: 'Task Due',
    title: '⏰ Task: {{task_name}}',
    body: 'Task {{task_name}} is due.',
    markdownBody: '⏰ **Task Due**\n\n{{task_name}}',
    variables: ['task_name'],
  },
  {
    id: 'daily_summary',
    name: 'Daily Summary',
    title: '📊 Daily Summary',
    body: 'Today: {{event_count}} events, {{task_count}} tasks.',
    markdownBody: '📊 **Daily Summary**\n\n📅 {{event_count}} events\n✅ {{task_count}} tasks',
    variables: ['event_count', 'task_count'],
  },
  {
    id: 'expense_alert',
    name: 'Expense Alert',
    title: '💰 Expense Alert',
    body: 'Spent {{amount}} {{currency}} in {{category}}.',
    markdownBody: '💰 **Expense Recorded**\n\n📁 {{category}}\n💵 {{amount}} {{currency}}',
    variables: ['category', 'amount', 'currency'],
  },
];

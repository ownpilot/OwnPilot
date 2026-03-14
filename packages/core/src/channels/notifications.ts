/**
 * Unified Notification System Types
 *
 * Defines the notification routing interface and types
 * for cross-channel message delivery.
 */

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Notification title/subject */
  title: string;
  /** Notification body text */
  body: string;
  /** Priority level — affects routing decisions */
  priority: NotificationPriority;
  /** Source system that generated the notification */
  source: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** When the notification was created */
  createdAt: Date;
}

export interface NotificationResult {
  /** Which channels were attempted */
  attempted: string[];
  /** Which channels succeeded */
  delivered: string[];
  /** Which channels failed and why */
  failed: Array<{ channelId: string; error: string }>;
}

export interface NotificationPreferences {
  /** User ID these preferences belong to */
  userId: string;
  /** Ordered list of preferred channel plugin IDs (first = highest priority) */
  channelPriority: string[];
  /** Quiet hours (UTC) — skip non-urgent notifications during these times */
  quietHoursStart?: string; // HH:MM format, e.g. "22:00"
  quietHoursEnd?: string; // HH:MM format, e.g. "07:00"
  /** Minimum priority to send during quiet hours */
  quietHoursMinPriority: NotificationPriority;
  /** Minimum priority to send at all (filter out low-priority noise) */
  minPriority: NotificationPriority;
}

export interface INotificationRouter {
  /**
   * Send a notification to a user, respecting their channel preferences.
   * Tries channels in priority order until one succeeds.
   */
  notify(userId: string, notification: Notification): Promise<NotificationResult>;

  /**
   * Send a notification to a specific channel + chat ID (direct targeting).
   */
  notifyChannel(
    channelId: string,
    chatId: string,
    notification: Notification,
  ): Promise<string>;

  /**
   * Broadcast a notification to all connected channels.
   */
  broadcast(notification: Notification): Promise<NotificationResult>;

  /**
   * Get notification preferences for a user.
   */
  getPreferences(userId: string): Promise<NotificationPreferences | null>;

  /**
   * Set notification preferences for a user.
   */
  setPreferences(prefs: NotificationPreferences): Promise<void>;
}

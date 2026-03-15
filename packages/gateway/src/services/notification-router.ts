/**
 * Notification Router
 *
 * Routes notifications across connected channels based on user preferences.
 * Tries channels in priority order, respects quiet hours, and tracks delivery.
 */

import { randomUUID } from 'node:crypto';
import {
  getChannelService,
  type Notification,
  type NotificationPriority,
  type NotificationResult,
  type NotificationPreferences,
  type INotificationRouter,
} from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('NotificationRouter');

/** Priority ordering for comparison */
const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/** Preferences persisted via settings repo with in-memory cache */
import { settingsRepo } from '../db/repositories/index.js';
const PREFS_KEY_PREFIX = 'notification_prefs:';
const preferencesCache = new Map<string, NotificationPreferences>();

/** Default preferences for users without explicit settings */
const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'userId'> = {
  channelPriority: [], // empty = try all connected channels
  quietHoursMinPriority: 'high',
  minPriority: 'low',
};

/**
 * Check if current time (UTC) falls within quiet hours.
 */
function isQuietHours(start?: string, end?: string): boolean {
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const startParts = start.split(':').map(Number);
  const endParts = end.split(':').map(Number);
  const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

  if (startMinutes <= endMinutes) {
    // Same day range (e.g., 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

export class NotificationRouter implements INotificationRouter {
  async notify(userId: string, notification: Notification): Promise<NotificationResult> {
    const prefs = (await this.getPreferences(userId)) ?? {
      userId,
      ...DEFAULT_PREFERENCES,
    };

    // Check minimum priority
    if (PRIORITY_ORDER[notification.priority] < PRIORITY_ORDER[prefs.minPriority]) {
      log.debug('Notification filtered by minPriority', {
        id: notification.id,
        priority: notification.priority,
        minPriority: prefs.minPriority,
      });
      return { attempted: [], delivered: [], failed: [] };
    }

    // Check quiet hours
    if (isQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd)) {
      if (PRIORITY_ORDER[notification.priority] < PRIORITY_ORDER[prefs.quietHoursMinPriority]) {
        log.debug('Notification deferred by quiet hours', {
          id: notification.id,
          priority: notification.priority,
        });
        return { attempted: [], delivered: [], failed: [] };
      }
    }

    // Determine channel order
    const channelService = getChannelService();
    const allChannels = channelService.listChannels();
    const connectedChannels = allChannels.filter((ch) => ch.status === 'connected');

    let channelOrder: string[];
    if (prefs.channelPriority.length > 0) {
      // Use user's preferred order, only including connected channels
      const connectedIds = new Set(connectedChannels.map((ch) => ch.pluginId));
      channelOrder = prefs.channelPriority.filter((id) => connectedIds.has(id));
    } else {
      // Default: try all connected channels
      channelOrder = connectedChannels.map((ch) => ch.pluginId);
    }

    const result: NotificationResult = {
      attempted: [],
      delivered: [],
      failed: [],
    };

    // Try channels in priority order until one succeeds
    for (const channelId of channelOrder) {
      result.attempted.push(channelId);

      try {
        // For notify(), we use userId as the platformChatId
        // (each channel interprets this differently: phone number, email, room ID, etc.)
        await channelService.send(channelId, {
          platformChatId: userId,
          text: `${notification.title}\n\n${notification.body}`,
        });
        result.delivered.push(channelId);
        // Stop after first successful delivery
        break;
      } catch (error) {
        result.failed.push({
          channelId,
          error: String(error),
        });
        log.warn('Notification delivery failed, trying next channel', {
          channelId,
          error: String(error),
        });
      }
    }

    if (result.delivered.length === 0 && channelOrder.length > 0) {
      log.error('Notification delivery failed on all channels', {
        id: notification.id,
        attempted: result.attempted,
      });
    }

    return result;
  }

  async notifyChannel(
    channelId: string,
    chatId: string,
    notification: Notification
  ): Promise<string> {
    const channelService = getChannelService();
    return channelService.send(channelId, {
      platformChatId: chatId,
      text: `${notification.title}\n\n${notification.body}`,
    });
  }

  async broadcast(notification: Notification): Promise<NotificationResult> {
    const channelService = getChannelService();
    const allChannels = channelService.listChannels();
    const connectedChannels = allChannels.filter((ch) => ch.status === 'connected');

    const result: NotificationResult = {
      attempted: [],
      delivered: [],
      failed: [],
    };

    const promises = connectedChannels.map(async (ch) => {
      result.attempted.push(ch.pluginId);
      try {
        await channelService.send(ch.pluginId, {
          platformChatId: 'broadcast',
          text: `${notification.title}\n\n${notification.body}`,
        });
        result.delivered.push(ch.pluginId);
      } catch (error) {
        result.failed.push({
          channelId: ch.pluginId,
          error: String(error),
        });
      }
    });

    await Promise.allSettled(promises);
    return result;
  }

  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    // Check cache first
    const cached = preferencesCache.get(userId);
    if (cached) return cached;

    // Load from DB
    const stored = settingsRepo.get<string>(`${PREFS_KEY_PREFIX}${userId}`);
    if (stored) {
      try {
        const prefs = JSON.parse(stored) as NotificationPreferences;
        preferencesCache.set(userId, prefs);
        return prefs;
      } catch {
        return null;
      }
    }
    return null;
  }

  async setPreferences(prefs: NotificationPreferences): Promise<void> {
    await settingsRepo.set(`${PREFS_KEY_PREFIX}${prefs.userId}`, JSON.stringify(prefs));
    preferencesCache.set(prefs.userId, prefs);
    log.info('Notification preferences updated', { userId: prefs.userId });
  }
}

// Singleton
let _router: NotificationRouter | null = null;

export function getNotificationRouter(): NotificationRouter {
  if (!_router) {
    _router = new NotificationRouter();
  }
  return _router;
}

export function resetNotificationRouter(): void {
  _router = null;
}

/**
 * Helper to create a Notification object.
 */
export function createNotification(
  title: string,
  body: string,
  options?: {
    priority?: NotificationPriority;
    source?: string;
    metadata?: Record<string, unknown>;
  }
): Notification {
  return {
    id: randomUUID(),
    title,
    body,
    priority: options?.priority ?? 'normal',
    source: options?.source ?? 'system',
    metadata: options?.metadata,
    createdAt: new Date(),
  };
}

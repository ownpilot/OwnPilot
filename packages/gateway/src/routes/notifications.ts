/**
 * Notification Routes
 *
 * REST API for sending notifications and managing notification preferences.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { getNotificationRouter, createNotification } from '../services/notification-router.js';
import {
  validateBody,
  sendNotificationSchema,
  sendChannelNotificationSchema,
  broadcastNotificationSchema,
  notificationPreferencesSchema,
} from '../middleware/validation.js';
import type { NotificationPriority } from '@ownpilot/core';

const app = new Hono();

/**
 * POST /api/v1/notifications/send
 *
 * Send a notification to a user (routes through preferred channels).
 */
app.post('/send', async (c) => {
  try {
    const body = validateBody(sendNotificationSchema, await c.req.json());

    const notification = createNotification(body.title, body.body, {
      priority: body.priority,
      source: body.source,
      metadata: body.metadata,
    });

    const router = getNotificationRouter();
    // Scope to the authenticated user — never trust a client-supplied
    // body.userId, which would let one user push notifications onto another
    // user's channels (spam / phishing via the victim's connected channels).
    const userId = LOCAL_OWNER_ID;
    const result = await router.notify(userId, notification);

    return apiResponse(c, { notification: { id: notification.id }, result });
  } catch (error) {
    const msg = getErrorMessage(error);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

/**
 * POST /api/v1/notifications/channel
 *
 * Send a notification to a specific channel + chat ID.
 */
app.post('/channel', async (c) => {
  try {
    const body = validateBody(sendChannelNotificationSchema, await c.req.json());

    const notification = createNotification(body.title, body.body, {
      priority: body.priority,
      source: body.source,
    });

    const router = getNotificationRouter();
    const messageId = await router.notifyChannel(body.channelId, body.chatId, notification);

    return apiResponse(c, { notification: { id: notification.id }, messageId });
  } catch (error) {
    const msg = getErrorMessage(error);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

/**
 * POST /api/v1/notifications/broadcast
 *
 * Broadcast a notification to all connected channels.
 */
app.post('/broadcast', async (c) => {
  try {
    const body = validateBody(broadcastNotificationSchema, await c.req.json());

    const notification = createNotification(body.title, body.body, {
      priority: body.priority,
      source: body.source,
    });

    const router = getNotificationRouter();
    const result = await router.broadcast(notification);

    return apiResponse(c, { notification: { id: notification.id }, result });
  } catch (error) {
    const msg = getErrorMessage(error);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

/**
 * GET /api/v1/notifications/preferences/:userId
 *
 * Get notification preferences for a user.
 */
app.get('/preferences/:userId', async (c) => {
  try {
    // Use the authenticated identity, NOT the :userId path param — otherwise
    // any user could read another user's notification preferences (channel
    // priorities, quiet hours) by changing the id in the URL. The param is
    // retained for route shape / client compatibility but is not trusted.
    const userId = LOCAL_OWNER_ID;
    const router = getNotificationRouter();
    const prefs = await router.getPreferences(userId);

    return apiResponse(c, { preferences: prefs });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * PUT /api/v1/notifications/preferences/:userId
 *
 * Update notification preferences for a user.
 */
app.put('/preferences/:userId', async (c) => {
  try {
    // Authenticated identity only — the :userId path param is not trusted, or
    // any user could overwrite another user's notification preferences (e.g.
    // raise minPriority to silence their alerts). See GET handler above.
    const userId = LOCAL_OWNER_ID;
    const body = validateBody(notificationPreferencesSchema, await c.req.json());

    const router = getNotificationRouter();

    // Merge with existing preferences
    const existing = await router.getPreferences(userId);
    const prefs = {
      userId,
      channelPriority: body.channelPriority ?? existing?.channelPriority ?? [],
      quietHoursStart: body.quietHoursStart ?? existing?.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd ?? existing?.quietHoursEnd,
      quietHoursMinPriority:
        body.quietHoursMinPriority ??
        existing?.quietHoursMinPriority ??
        ('high' as NotificationPriority),
      minPriority: body.minPriority ?? existing?.minPriority ?? ('low' as NotificationPriority),
    };

    await router.setPreferences(prefs);

    return apiResponse(c, { preferences: prefs });
  } catch (error) {
    const msg = getErrorMessage(error);
    const isValidation = msg.startsWith('Validation failed');
    return apiError(
      c,
      {
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message: msg,
      },
      isValidation ? 400 : 500
    );
  }
});

export const notificationRoutes = app;

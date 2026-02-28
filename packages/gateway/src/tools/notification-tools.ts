/**
 * Notification Tools
 *
 * AI agent tools for proactively sending notifications to the user.
 * Used by the Pulse Engine (Autonomy) to reach out via Telegram and WebSocket.
 */

import {
  type ToolDefinition,
  getEventSystem,
  getErrorMessage,
  getServiceRegistry,
  Services,
} from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('NotificationTools');

// =============================================================================
// Tool Definitions
// =============================================================================

const sendUserNotificationDef: ToolDefinition = {
  name: 'send_user_notification',
  workflowUsable: false,
  description:
    'Send a proactive notification to the user via Telegram and web. Use this to deliver helpful, timely messages — weather updates, habit reminders, deadline nudges, or friendly check-ins. Keep messages brief and conversational.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message to send (keep it brief and natural)',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description:
          'Urgency level (default: low). High = important alert, medium = worth seeing soon, low = casual/informational',
      },
    },
    required: ['message'],
  },
  category: 'Automation',
};

export const NOTIFICATION_TOOLS: ToolDefinition[] = [sendUserNotificationDef];

// =============================================================================
// Shared Telegram Delivery Helper
// =============================================================================

/**
 * Send a message to the user via Telegram.
 * Looks up the linked Telegram user and active session, then sends.
 * Returns true if message was delivered, false if no Telegram is configured.
 */
export async function sendTelegramMessage(userId: string, text: string): Promise<boolean> {
  try {
    const registry = getServiceRegistry();
    const channelService = registry.get(Services.Channel);

    const { createChannelUsersRepository } = await import('../db/repositories/channel-users.js');
    const channelUsersRepo = createChannelUsersRepository();
    const channelUsers = await channelUsersRepo.findByOwnpilotUser(userId);
    const telegramUser = channelUsers.find((cu) => cu.platform === 'telegram');

    if (!telegramUser) {
      log.debug('No Telegram user linked, skipping notification');
      return false;
    }

    const { createChannelSessionsRepository } =
      await import('../db/repositories/channel-sessions.js');
    const sessionsRepo = createChannelSessionsRepository();
    const sessions = await sessionsRepo.listByUser(telegramUser.id);
    const activeSession = sessions.find((s) => s.isActive);

    if (!activeSession) {
      log.debug('No active Telegram session, skipping notification');
      return false;
    }

    await channelService.send('channel.telegram', {
      platformChatId: activeSession.platformChatId,
      text,
    });

    return true;
  } catch (error) {
    log.debug('Telegram notification failed', { error: String(error) });
    return false;
  }
}

// =============================================================================
// Executor
// =============================================================================

export async function executeNotificationTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  switch (toolName) {
    case 'send_user_notification': {
      const message = args.message as string;
      const urgency = (args.urgency as string) ?? 'low';

      if (!message?.trim()) {
        return { success: false, error: 'Message is required' };
      }

      try {
        const deliveries: string[] = [];

        // 1. Send via Telegram
        const emoji =
          urgency === 'high'
            ? '\u26a0\ufe0f'
            : urgency === 'medium'
              ? '\u2139\ufe0f'
              : '\ud83d\udcac';
        const telegramText = `${emoji} ${message}`;
        const telegramSent = await sendTelegramMessage(userId, telegramText);
        if (telegramSent) deliveries.push('telegram');

        // 2. Emit notification via EventBus (forwarded to WS clients by legacy bridge)
        try {
          getEventSystem().emit('gateway.system.notification', 'notification-tool', {
            type: urgency === 'high' ? 'warning' : ('info' as const),
            message,
            action: 'pulse_notification',
          });
          deliveries.push('websocket');
        } catch {
          // EventSystem may not be initialized
        }

        return {
          success: true,
          result: {
            delivered: deliveries,
            message:
              deliveries.length > 0
                ? `Notification sent via ${deliveries.join(', ')}`
                : 'No delivery channels available',
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    default:
      return { success: false, error: `Unknown notification tool: ${toolName}` };
  }
}

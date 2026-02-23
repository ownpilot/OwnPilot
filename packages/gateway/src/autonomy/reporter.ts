/**
 * Pulse Reporter
 *
 * Delivers pulse results to the user via WebSocket and Telegram.
 * Both channels are optional — failures are silently caught.
 */

import { getServiceRegistry, Services } from '@ownpilot/core';
import type { PulseResult } from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('PulseReporter');

// ============================================================================
// Types
// ============================================================================

export type Broadcaster = (event: string, data: unknown) => void;

// ============================================================================
// Reporter
// ============================================================================

/**
 * Report pulse results via WebSocket broadcast and Telegram message.
 */
export async function reportPulseResult(
  result: PulseResult,
  broadcaster?: Broadcaster
): Promise<void> {
  if (!result.reportMessage && result.actionsExecuted.every((a) => a.skipped)) {
    // Nothing to report — all actions were skipped or no message
    return;
  }

  const deliveries: Promise<void>[] = [];

  // 1. WebSocket broadcast
  if (broadcaster) {
    deliveries.push(broadcastWs(result, broadcaster));
  }

  // 2. Telegram notification (for non-trivial pulses)
  if (result.reportMessage && result.actionsExecuted.some((a) => a.success && !a.skipped)) {
    deliveries.push(sendTelegram(result));
  }

  await Promise.allSettled(deliveries);
}

// ============================================================================
// Delivery channels
// ============================================================================

async function broadcastWs(result: PulseResult, broadcaster: Broadcaster): Promise<void> {
  try {
    broadcaster('system:notification', {
      type: 'info',
      message: result.reportMessage || 'Pulse cycle completed.',
      action: 'pulse',
      data: {
        pulseId: result.pulseId,
        signalsFound: result.signalsFound,
        actionsExecuted: result.actionsExecuted.length,
        urgencyScore: result.urgencyScore,
      },
    });

    // Emit data:changed events for modified entities
    const modifiedTypes = new Set<string>();
    for (const action of result.actionsExecuted) {
      if (!action.success || action.skipped) continue;
      if (action.type === 'create_memory' || action.type === 'run_memory_cleanup') {
        modifiedTypes.add('memories');
      }
      if (action.type === 'update_goal_progress') {
        modifiedTypes.add('goals');
      }
    }
    for (const entityType of modifiedTypes) {
      broadcaster('data:changed', { type: entityType });
    }
  } catch (error) {
    log.debug('WebSocket broadcast failed', { error: String(error) });
  }
}

async function sendTelegram(result: PulseResult): Promise<void> {
  try {
    const registry = getServiceRegistry();
    const channelService = registry.get(Services.Channel);

    // Look up the user's Telegram chat ID via channel_users
    const { createChannelUsersRepository } = await import('../db/repositories/channel-users.js');
    const channelUsersRepo = createChannelUsersRepository();
    const channelUsers = await channelUsersRepo.findByOwnpilotUser(result.userId);
    const telegramUser = channelUsers.find((cu) => cu.platform === 'telegram');

    if (!telegramUser) {
      log.debug('No Telegram user linked, skipping notification');
      return;
    }

    // Get the latest session to find the chat ID
    const { createChannelSessionsRepository } = await import('../db/repositories/channel-sessions.js');
    const sessionsRepo = createChannelSessionsRepository();
    const sessions = await sessionsRepo.listByUser(telegramUser.id);
    const activeSession = sessions.find((s) => s.isActive);

    if (!activeSession) {
      log.debug('No active Telegram session, skipping notification');
      return;
    }

    // Format the message
    const emoji = result.urgencyScore >= 50 ? '\u26a0\ufe0f' : '\u2139\ufe0f';
    const message = `${emoji} *Pulse Report*\n${result.reportMessage}`;

    await channelService.send('channel.telegram', {
      platformChatId: activeSession.platformChatId,
      text: message,
    });
  } catch (error) {
    log.debug('Telegram notification failed', { error: String(error) });
  }
}

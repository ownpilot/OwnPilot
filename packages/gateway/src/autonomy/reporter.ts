/**
 * Pulse Reporter
 *
 * Reports pulse completion via WebSocket broadcast.
 * Proactive Telegram notifications are now handled by the
 * send_user_notification tool that the pulse agent calls directly.
 */

import { getLog } from '../services/log.js';
import type { PulseResult } from '@ownpilot/core';

const log = getLog('PulseReporter');

// ============================================================================
// Types
// ============================================================================

export type Broadcaster = (event: string, data: unknown) => void;

// ============================================================================
// Reporter
// ============================================================================

/**
 * Report pulse results via WebSocket broadcast.
 * Telegram delivery is handled by the agent via send_user_notification tool.
 */
export async function reportPulseResult(
  result: PulseResult,
  broadcaster?: Broadcaster
): Promise<void> {
  if (!broadcaster) return;

  try {
    // Broadcast completion notification
    if (result.reportMessage || result.actionsExecuted.some((a) => a.success && !a.skipped)) {
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
    }

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
      // Notification tool calls indicate potential data changes
      if (action.type === 'send_user_notification') {
        modifiedTypes.add('notifications');
      }
    }
    for (const entityType of modifiedTypes) {
      broadcaster('data:changed', { type: entityType });
    }
  } catch (error) {
    log.debug('WebSocket broadcast failed', { error: String(error) });
  }
}

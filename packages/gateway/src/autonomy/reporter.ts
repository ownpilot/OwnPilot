/**
 * Pulse Reporter
 *
 * Reports pulse completion via EventBus.
 * Proactive Telegram notifications are now handled by the
 * send_user_notification tool that the pulse agent calls directly.
 */

import { getEventSystem } from '@ownpilot/core';
import { getLog } from '../services/log.js';
import type { PulseResult } from '@ownpilot/core';

const log = getLog('PulseReporter');

// ============================================================================
// Types (kept for backward compatibility — unused internally now)
// ============================================================================

export type Broadcaster = (event: string, data: unknown) => void;

// ============================================================================
// Reporter
// ============================================================================

/**
 * Report pulse results via EventBus.
 * Legacy broadcaster parameter is ignored — all delivery goes through EventBus.
 */
export async function reportPulseResult(
  result: PulseResult,
  _broadcaster?: Broadcaster
): Promise<void> {
  try {
    const eventSystem = getEventSystem();

    // Broadcast completion notification
    if (result.reportMessage || result.actionsExecuted.some((a) => a.success && !a.skipped)) {
      eventSystem.emit('gateway.system.notification', 'pulse-reporter', {
        type: 'info' as const,
        message: result.reportMessage || 'Pulse cycle completed.',
        action: 'pulse',
      });
    }

    // Emit data:changed events for modified entities via raw events
    const modifiedTypes = new Set<string>();
    for (const action of result.actionsExecuted) {
      if (!action.success || action.skipped) continue;
      if (action.type === 'create_memory' || action.type === 'run_memory_cleanup') {
        modifiedTypes.add('memories');
      }
      if (action.type === 'update_goal_progress') {
        modifiedTypes.add('goals');
      }
      if (action.type === 'send_user_notification') {
        modifiedTypes.add('notifications');
      }
    }
    for (const entityType of modifiedTypes) {
      eventSystem.emitRaw({
        type: 'gateway.data.changed',
        category: 'gateway',
        source: 'pulse-reporter',
        data: { type: entityType },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    log.debug('EventBus emission failed', { error: String(error) });
  }
}

/**
 * Claw Manager — Scheduling logic
 *
 * Extracted from manager.ts: timer management for continuous/interval/event
 * modes, plus the immediate-schedule path used by steer.
 *
 * The executeCycle callback is passed as a parameter to break the circular
 * dependency back to the manager class.
 */

import { getEventSystem } from '@ownpilot/core/events';
import { getErrorMessage } from '@ownpilot/core/services';
import type { EventHandler } from '@ownpilot/core/events';
import type { ClawSession } from '@ownpilot/core/services/claw';
import type { ManagedClaw } from './manager-types.js';
import { PRIORITY_DELAY_MULTIPLIER } from './manager-task-plan.js';
import { getLog } from '../log.js';

const log = getLog('ClawManager');

// Scheduling constants
const DEFAULT_INTERVAL_MS = 300_000; // 5 min

// Continuous mode adaptive delays
const CONTINUOUS_MIN_DELAY_MS = 500; // Active: fast loop
const CONTINUOUS_MAX_DELAY_MS = 10_000; // Error: backoff
const CONTINUOUS_IDLE_DELAY_MS = 5_000; // No tool calls: slow down

/**
 * Execute-cycle callback type — decouples scheduling from the manager's
 * private executeCycle method.
 */
export type ExecuteCycleFn = (clawId: string) => Promise<unknown>;

/**
 * States from which it is safe to schedule the next cycle. Anything else
 * (paused, stopped, completed, failed, escalation_pending) means an
 * external actor has decided this claw should stop running.
 */
export function isSchedulableState(state: ClawSession['state']): boolean {
  return state === 'running' || state === 'waiting';
}

/**
 * Clear any pending timer and run a cycle on the next tick.
 */
export function scheduleImmediate(
  clawId: string,
  managed: ManagedClaw,
  executeCycle: ExecuteCycleFn
): void {
  clearScheduling(managed);
  managed.timer = setTimeout(() => {
    executeCycle(clawId).catch((err) => {
      log.error(`Steered cycle error: ${getErrorMessage(err)}`);
    });
  }, 0);
}

/**
 * Schedule the next cycle based on the claw's mode.
 */
export function scheduleNext(
  clawId: string,
  managed: ManagedClaw,
  executeCycle: ExecuteCycleFn
): void {
  clearScheduling(managed);

  switch (managed.session.config.mode) {
    case 'continuous':
      scheduleContinuous(clawId, managed, executeCycle);
      break;
    case 'interval':
      scheduleInterval(clawId, managed, executeCycle);
      break;
    case 'event':
      subscribeToEvents(clawId, managed, executeCycle);
      break;
    // single-shot handled separately in startClaw
  }
}

/**
 * Continuous mode: adaptive delay based on last cycle outcome.
 */
function scheduleContinuous(
  clawId: string,
  managed: ManagedClaw,
  executeCycle: ExecuteCycleFn
): void {
  let delay: number;
  if (managed.session.lastCycleDurationMs === null) {
    delay = CONTINUOUS_MIN_DELAY_MS; // First cycle — start fast
  } else if (managed.session.lastCycleError) {
    delay = CONTINUOUS_MAX_DELAY_MS; // Error — backoff
  } else if (managed.lastCycleToolCalls === 0) {
    delay = CONTINUOUS_IDLE_DELAY_MS; // Idle — slow down
  } else {
    delay = CONTINUOUS_MIN_DELAY_MS; // Active — fast loop
  }

  // Apply priority multiplier to delay
  const multiplier = PRIORITY_DELAY_MULTIPLIER[managed.priority] ?? 1.0;
  const finalDelay = delay * multiplier;

  managed.timer = setTimeout(() => {
    executeCycle(clawId).catch((err) => {
      log.error(`Continuous cycle error: ${getErrorMessage(err)}`);
    });
  }, finalDelay);
}

/**
 * Interval mode: fixed delay from config.
 */
function scheduleInterval(
  clawId: string,
  managed: ManagedClaw,
  executeCycle: ExecuteCycleFn
): void {
  const interval = managed.session.config.intervalMs ?? DEFAULT_INTERVAL_MS;
  managed.timer = setTimeout(() => {
    executeCycle(clawId).catch((err) => {
      log.error(`Interval cycle error: ${getErrorMessage(err)}`);
    });
  }, interval);
}

/**
 * Event mode: subscribe to EventBus events matching the claw's filters.
 * The claw cycles once per matching event (with self-trigger loop guard).
 */
function subscribeToEvents(
  clawId: string,
  managed: ManagedClaw,
  executeCycle: ExecuteCycleFn
): void {
  const filters = managed.session.config.eventFilters ?? [];
  if (filters.length === 0) return;

  const selfSource = `claw:${clawId}`;
  const selfMarker = clawId;

  try {
    const eventSystem = getEventSystem();
    for (const eventType of filters) {
      const handler: EventHandler = (event: unknown) => {
        // Guard against self-trigger loops when an event-mode claw filters on
        // event types it can emit itself (e.g. claw.*, claw.cycle.complete, claw.cycle.summary).
        const ev = event as
          | { source?: string; payload?: { _clawId?: string; clawId?: string } }
          | undefined;
        if (ev) {
          if (ev.source === selfSource || ev.source === 'claw-manager') return;
          const payloadClawId = ev.payload?._clawId ?? ev.payload?.clawId;
          if (payloadClawId === selfMarker) return;
        }

        if (managed.session.state === 'waiting') {
          managed.session.state = 'running';
          managed.dirty = true;
          managed.timer = setTimeout(() => {
            executeCycle(clawId).catch((err) => {
              log.error(`Event-triggered cycle error: ${getErrorMessage(err)}`);
            });
          }, 0);
        }
      };

      eventSystem.onAny(eventType, handler);
      managed.eventSubscriptions.push({ eventType, handler });
    }
  } catch {
    // Event system may not be initialized
  }
}

/**
 * Clear all scheduling: pending timers and event subscriptions.
 */
export function clearScheduling(managed: ManagedClaw): void {
  if (managed.timer) {
    clearTimeout(managed.timer);
    managed.timer = null;
  }

  // Unsubscribe from events
  try {
    const eventSystem = getEventSystem();
    for (const sub of managed.eventSubscriptions) {
      eventSystem.off(sub.eventType, sub.handler);
    }
  } catch {
    // Event system may not be initialized
  }
  managed.eventSubscriptions = [];
}

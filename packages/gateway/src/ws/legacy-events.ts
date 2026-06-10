/**
 * Legacy EventBus → WebSocket forwarding.
 *
 * Translates EventBus dot-notation events into the colon-separated WS
 * broadcasts existing UI components (RealtimeBridge.tsx) consume, while the
 * Event Monitor page receives dot-notation events via EventBusBridge.
 *
 * Extracted from ws/server.ts. Each event family gets ONE typed payload
 * interface documenting the emitter's contract — handlers cast `event.data`
 * to it once instead of per-field `as` casts. The interfaces are assertions,
 * not validations: emitters own the shape (ClawManager, crew-tools, channel
 * service); update the interface here when an emitter's payload changes.
 */

import { getEventSystem } from '@ownpilot/core';
import type { ServerEvents } from './types.js';

/** Broadcast fn shape — matches WSGatewayServer.broadcast. */
type Broadcast = <K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) => void;

type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Emitter payload contracts (one cast per handler instead of one per field)
// ---------------------------------------------------------------------------

/** trigger.success / trigger.failed (triggers/engine.ts) */
interface TriggerExecutionData {
  triggerId: string;
  triggerName: string;
  durationMs: number;
  error?: string;
}

/** pulse.* (autonomy/engine.ts) */
interface PulseEventData {
  stage?: string;
  pulseId?: string | null;
  [key: string]: unknown;
}

/** claw.* lifecycle events (services/claw/manager.ts) */
interface ClawEventData {
  clawId?: string;
  name: string;
  reason?: string;
  message: string;
  type: string;
  cycleNumber: number;
  success: boolean;
  toolCallsCount: number;
  durationMs: number;
  cost: number;
  error: string;
  state: string;
}

/** claw.output (services/claw/manager.ts) */
interface ClawOutputData {
  clawId: string;
  message: string;
  urgency: string;
  timestamp: string;
}

/** crew.task.* (tools/crew-tools.ts) */
interface CrewTaskData {
  crewId: string;
  taskId: string;
  taskName: string;
  priority: string;
  delegatedTo: string;
  createdBy: string;
  claimedBy: string;
  submittedBy: string;
}

/** channel.user.* (channels/service-impl.ts) */
interface ChannelUserEventData {
  channelPluginId?: string;
  platform?: string;
  platformUserId?: string;
  displayName?: string;
  ownpilotUserId?: string;
  verificationMethod?: string;
  user?: { platformUserId?: string; displayName?: string };
}

// ---------------------------------------------------------------------------
// Forwarding setup
// ---------------------------------------------------------------------------

/**
 * Subscribe the legacy forwarders on the global event system. Returns the
 * unsubscribe functions; the caller owns their lifecycle.
 */
export function setupLegacyEventForwarding(broadcast: Broadcast): Unsubscribe[] {
  const eventSystem = getEventSystem();
  const unsubs: Unsubscribe[] = [];

  // trigger.success / trigger.failed → trigger:executed
  unsubs.push(
    eventSystem.onPattern('trigger.*', (event) => {
      if (event.type === 'trigger.success' || event.type === 'trigger.failed') {
        const d = event.data as unknown as TriggerExecutionData;
        broadcast('trigger:executed', {
          triggerId: d.triggerId,
          triggerName: d.triggerName,
          status: event.type === 'trigger.success' ? 'success' : 'failure',
          durationMs: d.durationMs,
          error: d.error,
        } as ServerEvents['trigger:executed']);
      }
    })
  );

  // pulse.* → pulse:activity
  unsubs.push(
    eventSystem.onPattern('pulse.*', (event) => {
      const d = event.data as unknown as PulseEventData;
      const stageMap: Record<string, string> = {
        'pulse.started': 'started',
        'pulse.stage': 'stage',
        'pulse.completed': 'completed',
      };
      const status = stageMap[event.type] ?? event.type;
      broadcast('pulse:activity', {
        status,
        stage: d.stage ?? status,
        pulseId: d.pulseId ?? null,
        ...d,
      } as ServerEvents['pulse:activity']);
    })
  );

  // gateway.system.notification → system:notification
  unsubs.push(
    eventSystem.on('gateway.system.notification', (event) => {
      broadcast('system:notification', event.data as ServerEvents['system:notification']);
    })
  );

  // gateway.data.changed → data:changed
  unsubs.push(
    eventSystem.onAny('gateway.data.changed', (event) => {
      broadcast('data:changed', event.data as ServerEvents['data:changed']);
    })
  );

  // soul.heartbeat.completed → soul:heartbeat:completed
  unsubs.push(
    eventSystem.onAny('soul.heartbeat.completed', (event) => {
      broadcast(
        'soul:heartbeat:completed',
        event.data as unknown as ServerEvents['soul:heartbeat:completed']
      );
    })
  );

  // claw.* → claw:* (11 events from ClawManager)
  unsubs.push(
    eventSystem.onPattern('claw.*', (event) => {
      const d = event.data as unknown as ClawEventData;
      const clawId = d.clawId ?? '';

      switch (event.type) {
        case 'claw.started':
          broadcast('claw:started', { clawId, name: d.name });
          break;
        case 'claw.paused':
          broadcast('claw:paused', {
            clawId,
            ...(d.reason !== undefined ? { reason: d.reason } : {}),
          });
          break;
        case 'claw.resumed':
          broadcast('claw:resumed', {
            clawId,
            ...(d.reason !== undefined ? { reason: d.reason } : {}),
          });
          break;
        case 'claw.progress':
          broadcast('claw:progress', { clawId, message: d.message });
          break;
        case 'claw.escalation':
          broadcast('claw:escalation', { clawId, type: d.type, reason: d.reason ?? '' });
          break;
        case 'claw.cycle.skipped':
          broadcast('claw:cycle:skipped', { clawId, reason: d.reason ?? '' });
          break;
        case 'claw.cycle.start':
          broadcast('claw:cycle:start', { clawId, cycleNumber: d.cycleNumber });
          break;
        case 'claw.cycle.complete':
          broadcast('claw:cycle:complete', {
            clawId,
            cycleNumber: d.cycleNumber,
            success: d.success,
            toolCallsCount: d.toolCallsCount,
            durationMs: d.durationMs,
            cost: d.cost,
          });
          break;
        case 'claw.error':
          broadcast('claw:error', { clawId, error: d.error });
          break;
        case 'claw.stopped':
          broadcast('claw:stopped', { clawId, reason: d.reason ?? '' });
          break;
        case 'claw.update':
          broadcast('claw:update', { clawId, state: d.state });
          break;
        case 'claw.plan.updated':
          broadcast('claw:plan:updated', d as unknown as ServerEvents['claw:plan:updated']);
          break;
      }
    })
  );

  // claw.output → claw:output (live output feed for UI)
  unsubs.push(
    eventSystem.onAny('claw.output', (event) => {
      const d = event.data as unknown as ClawOutputData;
      broadcast('claw:output', {
        clawId: d.clawId,
        message: d.message,
        urgency: d.urgency,
        timestamp: d.timestamp,
      });
    })
  );

  // crew.task.* → crew:task:* (task lifecycle events from crew-tools)
  unsubs.push(
    eventSystem.onAny('crew.task.created', (event) => {
      const d = event.data as unknown as CrewTaskData;
      broadcast('crew:task:created', {
        crewId: d.crewId,
        taskId: d.taskId,
        taskName: d.taskName,
        priority: d.priority,
        delegatedTo: d.delegatedTo,
        createdBy: d.createdBy,
      });
    })
  );
  unsubs.push(
    eventSystem.onAny('crew.task.claimed', (event) => {
      const d = event.data as unknown as CrewTaskData;
      broadcast('crew:task:claimed', {
        crewId: d.crewId,
        taskId: d.taskId,
        taskName: d.taskName,
        claimedBy: d.claimedBy,
      });
    })
  );
  unsubs.push(
    eventSystem.onAny('crew.task.completed', (event) => {
      const d = event.data as unknown as CrewTaskData;
      broadcast('crew:task:completed', {
        crewId: d.crewId,
        taskId: d.taskId,
        taskName: d.taskName,
        submittedBy: d.submittedBy,
      });
    })
  );
  unsubs.push(
    eventSystem.onAny('crew.task.failed', (event) => {
      const d = event.data as unknown as CrewTaskData;
      broadcast('crew:task:failed', {
        crewId: d.crewId,
        taskId: d.taskId,
        taskName: d.taskName,
        submittedBy: d.submittedBy,
      });
    })
  );

  // channel.user.* → channel:user:* (pending, blocked, unblocked, verified, first_seen)
  unsubs.push(
    eventSystem.onPattern('channel.user.*', (event) => {
      const d = event.data as unknown as ChannelUserEventData;

      switch (event.type) {
        case 'channel.user.pending':
          broadcast('channel:user:pending', {
            channelId: d.channelPluginId ?? '',
            platform: d.platform ?? '',
            userId: '',
            platformUserId: d.platformUserId ?? '',
            displayName: d.displayName,
          });
          break;
        case 'channel.user.blocked':
          broadcast('channel:user:blocked', {
            channelId: d.channelPluginId ?? '',
            platform: d.platform ?? '',
            platformUserId: d.platformUserId ?? '',
          });
          break;
        case 'channel.user.unblocked':
          broadcast('channel:user:unblocked', {
            channelId: d.channelPluginId ?? '',
            platform: d.platform ?? '',
            platformUserId: d.platformUserId ?? '',
          });
          break;
        case 'channel.user.verified':
          broadcast('channel:user:verified', {
            channelId: '',
            platform: d.platform ?? '',
            platformUserId: d.platformUserId ?? '',
            ownpilotUserId: d.ownpilotUserId ?? '',
            verificationMethod: d.verificationMethod,
          });
          break;
        case 'channel.user.first_seen':
          broadcast('channel:user:first_seen', {
            channelId: d.channelPluginId ?? '',
            platform: d.platform ?? '',
            platformUserId: d.user?.platformUserId ?? '',
            displayName: d.user?.displayName ?? undefined,
          });
          break;
      }
    })
  );

  return unsubs;
}

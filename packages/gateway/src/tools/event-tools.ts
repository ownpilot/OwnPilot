/**
 * Event Tools
 *
 * Tools for interacting with the core EventBus system.
 * Allows extensions and agents to emit custom events,
 * wait for events, and list available event categories.
 */

import {
  type ToolDefinition,
  getEventSystem,
  getErrorMessage,
  type EventCategory,
} from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('EventTools');

// =============================================================================
// Tool Definitions
// =============================================================================

const emitEventDef: ToolDefinition = {
  name: 'emit_event',
  workflowUsable: true,
  description:
    'Emit a custom event to the EventBus. Events are automatically namespaced under ext.{source}. ' +
    'Other extensions, triggers, and the Event Monitor can react to these events. ' +
    'Use this to signal state changes, completion of tasks, or to coordinate between systems.',
  parameters: {
    type: 'object',
    properties: {
      event_type: {
        type: 'string',
        description:
          'Event type in dot-notation (e.g., "data.updated", "task.completed"). ' +
          'Will be automatically prefixed with ext.{source}.',
      },
      data: {
        type: 'object',
        description: 'Event payload data (arbitrary JSON object)',
      },
    },
    required: ['event_type', 'data'],
  },
  category: 'Events',
};

const waitForEventDef: ToolDefinition = {
  name: 'wait_for_event',
  workflowUsable: true,
  description:
    'Wait for a specific event to occur on the EventBus, with a timeout. ' +
    'Useful for synchronizing with asynchronous operations like background agent completion, ' +
    'trigger execution, or external signals. Returns the event data when received.',
  parameters: {
    type: 'object',
    properties: {
      event_type: {
        type: 'string',
        description:
          'Exact event type to wait for (e.g., "memory.created", "trigger.success", "background-agent.cycle.complete")',
      },
      timeout_ms: {
        type: 'number',
        description: 'Maximum time to wait in milliseconds (default: 30000, max: 300000)',
      },
    },
    required: ['event_type'],
  },
  category: 'Events',
};

const listEventCategoriesDef: ToolDefinition = {
  name: 'list_event_categories',
  workflowUsable: true,
  description:
    'List all available EventBus event categories and example event types. ' +
    'Useful for discovering what events are available in the system.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  category: 'Events',
};

export const EVENT_TOOLS: ToolDefinition[] = [
  emitEventDef,
  waitForEventDef,
  listEventCategoriesDef,
];

// =============================================================================
// Event Categories Reference
// =============================================================================

const EVENT_CATEGORIES_INFO = {
  agent: ['agent.iteration', 'agent.complete', 'agent.error', 'agent.tool_call'],
  tool: ['tool.registered', 'tool.executed'],
  resource: ['resource.created', 'resource.updated', 'resource.deleted'],
  memory: ['memory.created', 'memory.updated', 'memory.deleted'],
  trigger: ['trigger.fired', 'trigger.success', 'trigger.failed'],
  pulse: ['pulse.started', 'pulse.stage', 'pulse.completed'],
  chat: ['chat.completed'],
  channel: ['channel.connected', 'channel.message.received', 'channel.message.sent'],
  extension: ['extension.installed', 'extension.enabled', 'extension.disabled'],
  'background-agent': [
    'background-agent.started',
    'background-agent.cycle.complete',
    'background-agent.stopped',
  ],
  gateway: ['gateway.system.notification', 'gateway.chat.message'],
  system: ['system.startup', 'system.shutdown'],
  mcp: ['mcp.server.connected', 'mcp.server.disconnected'],
};

// =============================================================================
// Executor
// =============================================================================

export async function executeEventTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  switch (toolName) {
    case 'emit_event': {
      const eventType = args.event_type as string;
      const data = (args.data as Record<string, unknown>) ?? {};

      if (!eventType?.trim()) {
        return { success: false, error: 'event_type is required' };
      }

      // Namespace the event
      const namespacedType = `ext.${userId}.${eventType}`;

      try {
        const eventSystem = getEventSystem();
        eventSystem.emitRaw({
          type: namespacedType,
          category: 'extension' as EventCategory,
          source: `extension:${userId}`,
          data,
          timestamp: new Date().toISOString(),
        });

        log.debug('Event emitted', { eventType: namespacedType, userId });
        return { success: true, result: { emitted: namespacedType } };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'wait_for_event': {
      const eventType = args.event_type as string;
      const timeoutMs = Math.min(Math.max((args.timeout_ms as number) ?? 30_000, 100), 300_000);

      if (!eventType?.trim()) {
        return { success: false, error: 'event_type is required' };
      }

      try {
        const eventSystem = getEventSystem();
        // waitFor is typed — use onAny-based approach for dynamic event types
        const event = await new Promise<{ type: string; source: string; data: unknown }>(
          (resolve, reject) => {
            const timer = setTimeout(() => {
              unsub();
              reject(new Error(`Timeout waiting for event '${eventType}' after ${timeoutMs}ms`));
            }, timeoutMs);

            const unsub = eventSystem.onAny(eventType, (evt) => {
              clearTimeout(timer);
              unsub();
              resolve({ type: evt.type, source: evt.source, data: evt.data });
            });
          }
        );

        return {
          success: true,
          result: {
            event: {
              type: event.type,
              source: event.source,
              data: event.data,
            },
          },
        };
      } catch (error) {
        const msg = getErrorMessage(error);
        return { success: false, error: msg };
      }
    }

    case 'list_event_categories': {
      return {
        success: true,
        result: {
          categories: EVENT_CATEGORIES_INFO,
          description:
            'Use emit_event to emit custom events (auto-namespaced to ext.{userId}.*). ' +
            'Use wait_for_event to wait for any event type listed above.',
        },
      };
    }

    default:
      return { success: false, error: `Unknown event tool: ${toolName}` };
  }
}

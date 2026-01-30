/**
 * Trigger Management Tools
 *
 * AI agent tools for creating, managing, and firing triggers.
 */

import type { ToolDefinition, ToolExecutionResult as CoreToolResult } from '@ownpilot/core';
import { TriggersRepository } from '../db/repositories/triggers.js';
import { getTriggerEngine } from '../triggers/index.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const createTriggerDef: ToolDefinition = {
  name: 'create_trigger',
  description: `Create a proactive trigger that automates actions on schedule, event, or condition.

IMPORTANT for schedule triggers: You MUST provide a valid 5-field cron expression. Invalid cron will be rejected.
Cron format: "minute hour day month weekday"
- minute: 0-59, hour: 0-23, day: 1-31, month: 1-12, weekday: 0-6 (0=Sunday)
- Use * for any, */n for every n, n-m for range, n,m for list
Examples: "0 8 * * *" (daily 8AM), "0 9 * * 1-5" (weekdays 9AM), "*/15 * * * *" (every 15min), "0 20 * * *" (daily 8PM), "0 9 * * 1" (Monday 9AM), "0 0 1 * *" (1st of month midnight)`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the trigger (e.g. "Daily Report", "Low Progress Alert")',
      },
      description: {
        type: 'string',
        description: 'What this trigger does',
      },
      type: {
        type: 'string',
        description: 'Trigger type: schedule (cron-based), event (fires on system event), condition (checks periodically), webhook (external call)',
        enum: ['schedule', 'event', 'condition', 'webhook'],
      },
      cron: {
        type: 'string',
        description: 'REQUIRED for schedule type. 5-field cron: "minute hour day month weekday". Examples: "0 8 * * *" (daily 8AM), "0 9 * * 1-5" (weekdays 9AM), "*/30 * * * *" (every 30min)',
      },
      event_type: {
        type: 'string',
        description: 'For event type. Available events: goal_completed, memory_added, message_received',
      },
      condition: {
        type: 'string',
        description: 'For condition type. Available: stale_goals (goals not updated in N days), upcoming_deadline (goals due within N days), memory_threshold (memory count >= N), low_progress (goals below N% progress), no_activity (no recent activity)',
        enum: ['stale_goals', 'upcoming_deadline', 'memory_threshold', 'low_progress', 'no_activity'],
      },
      threshold: {
        type: 'number',
        description: 'For condition type. Meaning depends on condition: stale_goals=days (default 3), upcoming_deadline=days (default 7), memory_threshold=count (default 100), low_progress=percent (default 20)',
      },
      action_type: {
        type: 'string',
        description: 'What to do when triggered: chat (send AI prompt), tool (run a tool), notification (log message), goal_check (check stale goals), memory_summary (summarize memories)',
        enum: ['chat', 'tool', 'notification', 'goal_check', 'memory_summary'],
      },
      action_payload: {
        type: 'object',
        description: 'Action payload. For chat: {"prompt": "your instruction"}. For tool: {"tool": "tool_name", ...args}. For notification: {"message": "text"}. For goal_check: {"staleDays": 3}. For memory_summary: {}.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether trigger is active (default: true)',
      },
      priority: {
        type: 'number',
        description: 'Priority 1-10 (default: 5, higher = more important)',
      },
    },
    required: ['name', 'type', 'action_type', 'action_payload'],
  },
  category: 'Automation',
};

const listTriggersDef: ToolDefinition = {
  name: 'list_triggers',
  description: 'List all triggers with their status, type, and last fired time.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Filter by trigger type',
        enum: ['schedule', 'event', 'condition', 'webhook'],
      },
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled/disabled status',
      },
    },
  },
  category: 'Automation',
};

const enableTriggerDef: ToolDefinition = {
  name: 'enable_trigger',
  description: 'Enable or disable a trigger by its ID.',
  parameters: {
    type: 'object',
    properties: {
      trigger_id: {
        type: 'string',
        description: 'ID of the trigger to enable/disable',
      },
      enabled: {
        type: 'boolean',
        description: 'Set to true to enable, false to disable',
      },
    },
    required: ['trigger_id', 'enabled'],
  },
  category: 'Automation',
};

const fireTriggerDef: ToolDefinition = {
  name: 'fire_trigger',
  description: 'Manually fire a trigger immediately, regardless of its schedule or conditions.',
  parameters: {
    type: 'object',
    properties: {
      trigger_id: {
        type: 'string',
        description: 'ID of the trigger to fire',
      },
    },
    required: ['trigger_id'],
  },
  category: 'Automation',
};

const deleteTriggerDef: ToolDefinition = {
  name: 'delete_trigger',
  description: 'Delete a trigger permanently.',
  parameters: {
    type: 'object',
    properties: {
      trigger_id: {
        type: 'string',
        description: 'ID of the trigger to delete',
      },
    },
    required: ['trigger_id'],
  },
  category: 'Automation',
};

const triggerStatsDef: ToolDefinition = {
  name: 'trigger_stats',
  description: 'Get statistics about triggers: total count, enabled count, fires this week, success rate.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Automation',
};

export const TRIGGER_TOOLS: ToolDefinition[] = [
  createTriggerDef,
  listTriggersDef,
  enableTriggerDef,
  fireTriggerDef,
  deleteTriggerDef,
  triggerStatsDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executeTriggerTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const repo = new TriggersRepository(userId);

  switch (toolName) {
    case 'create_trigger': {
      const type = args.type as string;
      let config: Record<string, unknown> = {};

      if (type === 'schedule') {
        if (!args.cron) {
          return { success: false, error: 'Schedule triggers require a cron expression. Example: "0 8 * * *" for daily at 8 AM.' };
        }
        config = { cron: args.cron, timezone: 'local' };
      } else if (type === 'event') {
        if (!args.event_type) {
          return { success: false, error: 'Event triggers require an event_type. Available: goal_completed, memory_added, message_received.' };
        }
        config = { eventType: args.event_type };
      } else if (type === 'condition') {
        if (!args.condition) {
          return { success: false, error: 'Condition triggers require a condition. Available: stale_goals, upcoming_deadline, memory_threshold, low_progress, no_activity.' };
        }
        config = {
          condition: args.condition,
          threshold: args.threshold ?? 3,
          checkInterval: 60,
        };
      } else if (type === 'webhook') {
        config = {};
      }

      try {
        const trigger = await repo.create({
          name: args.name as string,
          description: args.description as string | undefined,
          type: type as 'schedule' | 'event' | 'condition' | 'webhook',
          config,
          action: {
            type: args.action_type as 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary',
            payload: (args.action_payload as Record<string, unknown>) ?? {},
          },
          enabled: args.enabled !== false,
          priority: (args.priority as number) ?? 5,
        });

        return {
          success: true,
          result: {
            id: trigger.id,
            name: trigger.name,
            type: trigger.type,
            enabled: trigger.enabled,
            nextFire: trigger.nextFire?.toISOString() ?? null,
            message: `Trigger "${trigger.name}" created successfully.` +
              (trigger.nextFire ? ` Next fire: ${trigger.nextFire.toISOString()}` : ''),
          },
        };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }

    case 'list_triggers': {
      const triggers = await repo.list({
        type: args.type as string | undefined as never,
        enabled: args.enabled as boolean | undefined,
        limit: 50,
      });

      return {
        success: true,
        result: triggers.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          enabled: t.enabled,
          priority: t.priority,
          lastFired: t.lastFired?.toISOString() ?? null,
          nextFire: t.nextFire?.toISOString() ?? null,
          fireCount: t.fireCount,
          description: t.description,
          actionType: t.action.type,
        })),
      };
    }

    case 'enable_trigger': {
      const triggerId = args.trigger_id as string;
      const enabled = args.enabled as boolean;
      const updated = await repo.update(triggerId, { enabled });
      if (!updated) {
        return { success: false, error: `Trigger not found: ${triggerId}` };
      }
      return {
        success: true,
        result: { id: triggerId, enabled, message: `Trigger ${enabled ? 'enabled' : 'disabled'}.` },
      };
    }

    case 'fire_trigger': {
      const triggerId = args.trigger_id as string;
      const trigger = await repo.get(triggerId);
      if (!trigger) {
        return { success: false, error: `Trigger not found: ${triggerId}` };
      }

      const engine = getTriggerEngine();
      if (!engine) {
        return { success: false, error: 'Trigger engine is not running.' };
      }

      try {
        await engine.fireTrigger(triggerId);
        return {
          success: true,
          result: { id: triggerId, name: trigger.name, message: `Trigger "${trigger.name}" fired manually.` },
        };
      } catch (e) {
        return { success: false, error: `Failed to fire trigger: ${(e as Error).message}` };
      }
    }

    case 'delete_trigger': {
      const triggerId = args.trigger_id as string;
      const deleted = await repo.delete(triggerId);
      if (!deleted) {
        return { success: false, error: `Trigger not found: ${triggerId}` };
      }
      return { success: true, result: { id: triggerId, message: 'Trigger deleted.' } };
    }

    case 'trigger_stats': {
      const stats = await repo.getStats();
      return { success: true, result: stats };
    }

    default:
      return { success: false, error: `Unknown trigger tool: ${toolName}` };
  }
}

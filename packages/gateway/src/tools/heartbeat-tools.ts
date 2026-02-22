/**
 * Heartbeat Management Tools
 *
 * AI agent tools for creating, managing heartbeat entries (NL-to-cron periodic tasks).
 */

import { type ToolDefinition, getErrorMessage } from '@ownpilot/core';
import { getHeartbeatService } from '../services/heartbeat-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const createHeartbeatDef: ToolDefinition = {
  name: 'create_heartbeat',
  workflowUsable: false,
  description: `Create a periodic task using natural language scheduling.

Write the schedule in plain English and the system converts it to a cron-based trigger automatically.

Supported schedule formats:
- "Every Morning 8:00", "Every Night 22:00", "Every Evening"
- "Every Day at 9:00", "Daily 17:00"
- "Every Hour", "Every 30 Minutes", "Every 2 Hours"
- "Every Monday 9:00", "Every Friday 17:00"
- "Weekdays 9:00", "Weekends 10:00"
- "Every Month 1st 9:00", "Every Month 15th"

The task description is what the AI should do when the heartbeat fires.`,
  parameters: {
    type: 'object',
    properties: {
      schedule: {
        type: 'string',
        description:
          'Natural language schedule (e.g., "Every Morning 8:00", "Every Friday 17:00", "Every Hour")',
      },
      task: {
        type: 'string',
        description:
          'What the AI should do when this fires (e.g., "Summarize my unread emails and pending tasks")',
      },
      name: {
        type: 'string',
        description: 'Optional friendly name for this heartbeat',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the heartbeat is active (default: true)',
      },
    },
    required: ['schedule', 'task'],
  },
  category: 'Automation',
};

const listHeartbeatsDef: ToolDefinition = {
  name: 'list_heartbeats',
  workflowUsable: false,
  description:
    'List all heartbeat periodic tasks with their schedules, status, and linked triggers.',
  parameters: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled/disabled status',
      },
    },
  },
  category: 'Automation',
};

const updateHeartbeatDef: ToolDefinition = {
  name: 'update_heartbeat',
  workflowUsable: false,
  description:
    'Update an existing heartbeat. Can change the schedule, task description, name, or enabled status.',
  parameters: {
    type: 'object',
    properties: {
      heartbeat_id: {
        type: 'string',
        description: 'ID of the heartbeat to update',
      },
      schedule: {
        type: 'string',
        description: 'New natural language schedule',
      },
      task: {
        type: 'string',
        description: 'New task description',
      },
      name: {
        type: 'string',
        description: 'New name',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable or disable',
      },
    },
    required: ['heartbeat_id'],
  },
  category: 'Automation',
};

const deleteHeartbeatDef: ToolDefinition = {
  name: 'delete_heartbeat',
  workflowUsable: false,
  description: 'Delete a heartbeat and its backing trigger permanently.',
  parameters: {
    type: 'object',
    properties: {
      heartbeat_id: {
        type: 'string',
        description: 'ID of the heartbeat to delete',
      },
    },
    required: ['heartbeat_id'],
  },
  category: 'Automation',
};

export const HEARTBEAT_TOOLS: ToolDefinition[] = [
  createHeartbeatDef,
  listHeartbeatsDef,
  updateHeartbeatDef,
  deleteHeartbeatDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executeHeartbeatTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getHeartbeatService();

  switch (toolName) {
    case 'create_heartbeat': {
      try {
        const heartbeat = await service.createHeartbeat(userId, {
          scheduleText: args.schedule as string,
          taskDescription: args.task as string,
          name: args.name as string | undefined,
          enabled: args.enabled !== false,
        });

        return {
          success: true,
          result: {
            id: heartbeat.id,
            name: heartbeat.name,
            schedule: heartbeat.scheduleText,
            cron: heartbeat.cron,
            enabled: heartbeat.enabled,
            triggerId: heartbeat.triggerId,
            message: `Heartbeat "${heartbeat.name}" created. Schedule: ${heartbeat.scheduleText} (cron: ${heartbeat.cron})`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_heartbeats': {
      const heartbeats = await service.listHeartbeats(userId, {
        enabled: args.enabled as boolean | undefined,
        limit: 50,
      });

      return {
        success: true,
        result: heartbeats.map((hb) => ({
          id: hb.id,
          name: hb.name,
          schedule: hb.scheduleText,
          cron: hb.cron,
          task: hb.taskDescription,
          enabled: hb.enabled,
          triggerId: hb.triggerId,
          tags: hb.tags,
        })),
      };
    }

    case 'update_heartbeat': {
      const heartbeatId = args.heartbeat_id as string;
      try {
        const updated = await service.updateHeartbeat(userId, heartbeatId, {
          scheduleText: args.schedule as string | undefined,
          taskDescription: args.task as string | undefined,
          name: args.name as string | undefined,
          enabled: args.enabled as boolean | undefined,
        });

        if (!updated) {
          return { success: false, error: `Heartbeat not found: ${heartbeatId}` };
        }

        return {
          success: true,
          result: {
            id: updated.id,
            name: updated.name,
            schedule: updated.scheduleText,
            cron: updated.cron,
            enabled: updated.enabled,
            message: `Heartbeat "${updated.name}" updated.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'delete_heartbeat': {
      const heartbeatId = args.heartbeat_id as string;
      const deleted = await service.deleteHeartbeat(userId, heartbeatId);
      if (!deleted) {
        return { success: false, error: `Heartbeat not found: ${heartbeatId}` };
      }
      return { success: true, result: { id: heartbeatId, message: 'Heartbeat deleted.' } };
    }

    default:
      return { success: false, error: `Unknown heartbeat tool: ${toolName}` };
  }
}

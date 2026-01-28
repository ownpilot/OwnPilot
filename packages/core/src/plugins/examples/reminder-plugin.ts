/**
 * Reminder Plugin
 *
 * Provides reminder and notification management.
 * Demonstrates: scheduled tasks, notifications, storage
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

interface Reminder {
  id: string;
  title: string;
  description?: string;
  dueAt: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
  priority: 'low' | 'medium' | 'high';
  tags?: string[];
  completed: boolean;
  notified: boolean;
  createdAt: string;
  completedAt?: string;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const createReminderTool: ToolDefinition = {
  name: 'reminder_create',
  description: 'Create a new reminder with optional recurrence',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Reminder title/message',
      },
      dueAt: {
        type: 'string',
        description: 'When to remind (ISO date or relative like "in 30 minutes", "tomorrow 9am")',
      },
      description: {
        type: 'string',
        description: 'Additional details',
      },
      repeat: {
        type: 'string',
        description: 'Recurrence pattern',
        enum: ['none', 'daily', 'weekly', 'monthly'],
      },
      priority: {
        type: 'string',
        description: 'Priority level',
        enum: ['low', 'medium', 'high'],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for organization',
      },
    },
    required: ['title', 'dueAt'],
  },
};

const listRemindersTool: ToolDefinition = {
  name: 'reminder_list',
  description: 'List reminders with optional filters',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['pending', 'completed', 'overdue', 'all'],
      },
      priority: {
        type: 'string',
        description: 'Filter by priority',
        enum: ['low', 'medium', 'high'],
      },
      tag: {
        type: 'string',
        description: 'Filter by tag',
      },
      limit: {
        type: 'number',
        description: 'Maximum number to return (default: 20)',
      },
    },
  },
};

const completeReminderTool: ToolDefinition = {
  name: 'reminder_complete',
  description: 'Mark a reminder as completed',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Reminder ID to complete',
      },
    },
    required: ['id'],
  },
};

const deleteReminderTool: ToolDefinition = {
  name: 'reminder_delete',
  description: 'Delete a reminder',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Reminder ID to delete',
      },
    },
    required: ['id'],
  },
};

const snoozeReminderTool: ToolDefinition = {
  name: 'reminder_snooze',
  description: 'Snooze a reminder for a specified duration',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Reminder ID to snooze',
      },
      duration: {
        type: 'string',
        description: 'Snooze duration (e.g., "15 minutes", "1 hour", "1 day")',
      },
    },
    required: ['id', 'duration'],
  },
};

const upcomingRemindersTool: ToolDefinition = {
  name: 'reminder_upcoming',
  description: 'Get reminders due in the next period',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        description: 'Time period to check',
        enum: ['1hour', '3hours', 'today', 'tomorrow', 'thisWeek'],
      },
    },
  },
};

// =============================================================================
// In-memory storage
// =============================================================================

const reminders: Map<string, Reminder> = new Map();

// =============================================================================
// Helper Functions
// =============================================================================

function parseRelativeTime(timeStr: string): Date {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // Check for ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(timeStr)) {
    return new Date(timeStr);
  }

  // Parse relative times
  const inMatch = lower.match(/in\s+(\d+)\s+(minute|hour|day|week)s?/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]!);
    const unit = inMatch[2];
    const result = new Date(now);

    switch (unit) {
      case 'minute':
        result.setMinutes(result.getMinutes() + amount);
        break;
      case 'hour':
        result.setHours(result.getHours() + amount);
        break;
      case 'day':
        result.setDate(result.getDate() + amount);
        break;
      case 'week':
        result.setDate(result.getDate() + amount * 7);
        break;
    }
    return result;
  }

  // Tomorrow
  if (lower.includes('tomorrow')) {
    const result = new Date(now);
    result.setDate(result.getDate() + 1);

    // Check for time
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]!);
      const minutes = parseInt(timeMatch[2] || '0');
      const ampm = timeMatch[3];

      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      result.setHours(hours, minutes, 0, 0);
    } else {
      result.setHours(9, 0, 0, 0); // Default 9 AM
    }
    return result;
  }

  // Today with time
  if (lower.includes('today')) {
    const result = new Date(now);
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]!);
      const minutes = parseInt(timeMatch[2] || '0');
      const ampm = timeMatch[3];

      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      result.setHours(hours, minutes, 0, 0);
    }
    return result;
  }

  // Default: try as date
  const parsed = new Date(timeStr);
  return isNaN(parsed.getTime()) ? new Date(now.getTime() + 60 * 60 * 1000) : parsed;
}

function parseSnoozeDuration(duration: string): number {
  const lower = duration.toLowerCase();
  const match = lower.match(/(\d+)\s*(minute|hour|day)s?/);

  if (!match) return 15 * 60 * 1000; // Default 15 minutes

  const amount = parseInt(match[1]!);
  const unit = match[2];

  switch (unit) {
    case 'minute':
      return amount * 60 * 1000;
    case 'hour':
      return amount * 60 * 60 * 1000;
    case 'day':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

// =============================================================================
// Tool Executors
// =============================================================================

const createReminderExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const title = params.title as string;
  const dueAtStr = params.dueAt as string;
  const description = params.description as string | undefined;
  const repeat = (params.repeat as Reminder['repeat']) || 'none';
  const priority = (params.priority as Reminder['priority']) || 'medium';
  const tags = params.tags as string[] | undefined;

  const dueAt = parseRelativeTime(dueAtStr);
  const id = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const reminder: Reminder = {
    id,
    title,
    description,
    dueAt: dueAt.toISOString(),
    repeat,
    priority,
    tags,
    completed: false,
    notified: false,
    createdAt: new Date().toISOString(),
  };

  reminders.set(id, reminder);

  return {
    content: {
      success: true,
      message: `Reminder set for ${dueAt.toLocaleString()}`,
      reminder,
    },
  };
};

const listRemindersExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const status = (params.status as string) || 'pending';
  const priority = params.priority as Reminder['priority'] | undefined;
  const tag = params.tag as string | undefined;
  const limit = (params.limit as number) || 20;

  const now = new Date();
  let list = Array.from(reminders.values());

  // Filter by status
  switch (status) {
    case 'pending':
      list = list.filter(r => !r.completed);
      break;
    case 'completed':
      list = list.filter(r => r.completed);
      break;
    case 'overdue':
      list = list.filter(r => !r.completed && new Date(r.dueAt) < now);
      break;
    // 'all' shows everything
  }

  // Filter by priority
  if (priority) {
    list = list.filter(r => r.priority === priority);
  }

  // Filter by tag
  if (tag) {
    list = list.filter(r => r.tags?.includes(tag));
  }

  // Sort by due date
  list.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  // Limit
  list = list.slice(0, limit);

  const overdue = list.filter(r => !r.completed && new Date(r.dueAt) < now);

  return {
    content: {
      success: true,
      reminders: list,
      count: list.length,
      overdueCount: overdue.length,
      totalCount: reminders.size,
    },
  };
};

const completeReminderExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const id = params.id as string;

  const reminder = reminders.get(id);
  if (!reminder) {
    return {
      content: { error: `Reminder not found: ${id}` },
      isError: true,
    };
  }

  reminder.completed = true;
  reminder.completedAt = new Date().toISOString();

  // Handle recurring reminders
  if (reminder.repeat !== 'none') {
    const nextDue = new Date(reminder.dueAt);

    switch (reminder.repeat) {
      case 'daily':
        nextDue.setDate(nextDue.getDate() + 1);
        break;
      case 'weekly':
        nextDue.setDate(nextDue.getDate() + 7);
        break;
      case 'monthly':
        nextDue.setMonth(nextDue.getMonth() + 1);
        break;
    }

    // Create next occurrence
    const nextId = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const nextReminder: Reminder = {
      ...reminder,
      id: nextId,
      dueAt: nextDue.toISOString(),
      completed: false,
      notified: false,
      completedAt: undefined,
    };
    reminders.set(nextId, nextReminder);

    return {
      content: {
        success: true,
        message: `Reminder completed. Next occurrence: ${nextDue.toLocaleString()}`,
        completedReminder: reminder,
        nextReminder,
      },
    };
  }

  return {
    content: {
      success: true,
      message: 'Reminder completed',
      reminder,
    },
  };
};

const deleteReminderExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const id = params.id as string;

  const reminder = reminders.get(id);
  if (!reminder) {
    return {
      content: { error: `Reminder not found: ${id}` },
      isError: true,
    };
  }

  reminders.delete(id);

  return {
    content: {
      success: true,
      message: `Reminder "${reminder.title}" deleted`,
      deletedId: id,
    },
  };
};

const snoozeReminderExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const id = params.id as string;
  const duration = params.duration as string;

  const reminder = reminders.get(id);
  if (!reminder) {
    return {
      content: { error: `Reminder not found: ${id}` },
      isError: true,
    };
  }

  const snoozeMs = parseSnoozeDuration(duration);
  const newDueAt = new Date(Date.now() + snoozeMs);

  reminder.dueAt = newDueAt.toISOString();
  reminder.notified = false;

  return {
    content: {
      success: true,
      message: `Reminder snoozed until ${newDueAt.toLocaleString()}`,
      reminder,
    },
  };
};

const upcomingRemindersExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const period = (params.period as string) || 'today';
  const now = new Date();
  let endTime: Date;

  switch (period) {
    case '1hour':
      endTime = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    case '3hours':
      endTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      break;
    case 'today':
      endTime = new Date(now);
      endTime.setHours(23, 59, 59, 999);
      break;
    case 'tomorrow':
      endTime = new Date(now);
      endTime.setDate(endTime.getDate() + 1);
      endTime.setHours(23, 59, 59, 999);
      break;
    case 'thisWeek':
      endTime = new Date(now);
      endTime.setDate(endTime.getDate() + (7 - endTime.getDay()));
      endTime.setHours(23, 59, 59, 999);
      break;
    default:
      endTime = new Date(now);
      endTime.setHours(23, 59, 59, 999);
  }

  const upcoming = Array.from(reminders.values())
    .filter(r => {
      if (r.completed) return false;
      const dueAt = new Date(r.dueAt);
      return dueAt >= now && dueAt <= endTime;
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return {
    content: {
      success: true,
      period,
      upcoming,
      count: upcoming.length,
      nextReminder: upcoming[0] || null,
    },
  };
};

// =============================================================================
// Message Handler
// =============================================================================

const reminderHandler: MessageHandler = {
  name: 'reminder-handler',
  description: 'Handles reminder-related requests',
  priority: 55,

  canHandle: async (message: string): Promise<boolean> => {
    const lower = message.toLowerCase();
    return /\b(remind|reminder|alarm|alert|notify|snooze)\b/i.test(lower);
  },

  handle: async (message: string, context: HandlerContext): Promise<HandlerResult> => {
    const lower = message.toLowerCase();

    // "Remind me to X" pattern
    const remindMatch = lower.match(/remind\s+me\s+(?:to\s+)?(.+?)(?:\s+(?:in|at|on|tomorrow|today)\s+.+)?$/i);
    if (remindMatch) {
      return { handled: false }; // Let AI handle with tool
    }

    // "Show my reminders"
    if (/show|list|what.*reminder/i.test(lower)) {
      return {
        handled: true,
        toolCalls: [
          {
            tool: 'reminder_list',
            args: { status: 'pending', limit: 10 },
          },
        ],
      };
    }

    return { handled: false };
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const reminderPlugin = createPlugin()
  .meta({
    id: 'reminders',
    name: 'Reminders',
    version: '1.0.0',
    description: 'Create and manage reminders with notifications',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'handlers', 'storage', 'scheduled', 'notifications'],
    permissions: ['notifications', 'storage'],
    icon: '⏰',
    configSchema: {
      type: 'object',
      properties: {
        defaultSnooze: {
          type: 'number',
          description: 'Default snooze duration in minutes',
          default: 15,
        },
        notifyBefore: {
          type: 'number',
          description: 'Minutes before due time to notify',
          default: 5,
        },
      },
    },
    defaultConfig: {
      defaultSnooze: 15,
      notifyBefore: 5,
    },
  })
  .tools([
    { definition: createReminderTool, executor: createReminderExecutor },
    { definition: listRemindersTool, executor: listRemindersExecutor },
    { definition: completeReminderTool, executor: completeReminderExecutor },
    { definition: deleteReminderTool, executor: deleteReminderExecutor },
    { definition: snoozeReminderTool, executor: snoozeReminderExecutor },
    { definition: upcomingRemindersTool, executor: upcomingRemindersExecutor },
  ])
  .handler(reminderHandler)
  .hooks({
    onLoad: async () => {
      console.log('[ReminderPlugin] Loaded');
    },
    onEnable: async () => {
      console.log('[ReminderPlugin] Enabled - would start reminder check scheduler');
    },
  })
  .build();

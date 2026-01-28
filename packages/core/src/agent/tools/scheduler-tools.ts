/**
 * Scheduler Management Tools
 *
 * AI-driven scheduler management:
 * - Create scheduled tasks from natural language
 * - List, update, delete tasks
 * - View task history
 * - Natural language to cron conversion
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult, ToolContext } from '../types.js';
import {
  Scheduler,
  createScheduler,
  createPromptTask,
  createToolTask,
  CRON_PRESETS,
  getNextRunTime,
  type ScheduledTask,
  type TaskPriority,
} from '../../scheduler/index.js';

// =============================================================================
// Natural Language Schedule Parser (Supports Turkish & English, One-time & Recurring)
// =============================================================================

/**
 * Parsed schedule result - either a cron expression (recurring) or a specific date (one-time)
 */
export interface ParsedSchedule {
  type: 'cron' | 'one-time';
  cron?: string;
  runAt?: Date;
  description: string;
}

/**
 * Parse time from text (supports 12h and 24h formats)
 */
function parseTime(text: string): { hour: number; minute: number } | null {
  // Turkish time patterns: "12:50'de", "12.50'de", "saat 12:50", "12:50 de"
  // English patterns: "12:50", "12:50am", "12:50 pm", "at 12:50"
  const patterns = [
    /(\d{1,2})[:.](\d{2})(?:'?de)?/i,           // 12:50, 12.50, 12:50'de
    /(\d{1,2})[:.](\d{2})\s*(am|pm)/i,          // 12:50 am/pm
    /saat\s*(\d{1,2})[:.]?(\d{2})?/i,           // saat 12:50, saat 12
    /at\s*(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i,  // at 12:50
    /(\d{1,2})\s*(am|pm)/i,                      // 12 am/pm
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let hour = parseInt(match[1]!, 10);
      const minute = match[2] ? parseInt(match[2], 10) : 0;
      const period = match[3]?.toLowerCase();

      if (period === 'pm' && hour < 12) hour += 12;
      else if (period === 'am' && hour === 12) hour = 0;

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return { hour, minute };
      }
    }
  }

  return null;
}

/**
 * Parse natural language to schedule (recurring cron OR one-time date)
 */
export function parseSchedule(text: string): ParsedSchedule | null {
  const normalized = text.toLowerCase().trim();
  const now = new Date();

  // Direct cron expression (5 parts)
  if (/^\d+\s+\d+\s+[\d*]+\s+[\d*]+\s+[\d*]+$/.test(normalized) ||
      /^[*\d,\-/]+\s+[*\d,\-/]+\s+[*\d,\-/]+\s+[*\d,\-/]+\s+[*\d,\-/]+$/.test(normalized)) {
    return { type: 'cron', cron: normalized, description: 'Custom cron expression' };
  }

  // Parse time from text
  const time = parseTime(normalized);

  // ==========================================================================
  // ONE-TIME SCHEDULES (Turkish & English)
  // ==========================================================================

  // "in X minutes" / "X dakika sonra" / "X dk sonra"
  const inMinutesMatch = normalized.match(/(?:in\s+)?(\d+)\s*(?:dakika|dk|minute|min)(?:\s*sonra)?/i);
  if (inMinutesMatch) {
    const minutes = parseInt(inMinutesMatch[1]!, 10);
    const runAt = new Date(now.getTime() + minutes * 60 * 1000);
    return {
      type: 'one-time',
      runAt,
      description: `In ${minutes} minutes (${runAt.toLocaleTimeString()})`,
    };
  }

  // "in X hours" / "X saat sonra"
  const inHoursMatch = normalized.match(/(?:in\s+)?(\d+)\s*(?:saat|hour|hr)(?:\s*sonra)?/i);
  if (inHoursMatch) {
    const hours = parseInt(inHoursMatch[1]!, 10);
    const runAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return {
      type: 'one-time',
      runAt,
      description: `In ${hours} hours (${runAt.toLocaleTimeString()})`,
    };
  }

  // "today at X" / "bugün X" / "bugün saat X"
  if (/today|bugün/.test(normalized) && time) {
    const runAt = new Date(now);
    runAt.setHours(time.hour, time.minute, 0, 0);
    // If time has passed, still schedule for today (user explicitly said "today")
    const timeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
    return {
      type: 'one-time',
      runAt,
      description: `Today at ${timeStr}`,
    };
  }

  // "tomorrow at X" / "yarın X" / "yarın saat X"
  if (/tomorrow|yarın/.test(normalized) && time) {
    const runAt = new Date(now);
    runAt.setDate(runAt.getDate() + 1);
    runAt.setHours(time.hour, time.minute, 0, 0);
    const timeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
    return {
      type: 'one-time',
      runAt,
      description: `Tomorrow at ${timeStr}`,
    };
  }

  // Just a bare time like "12:50" or "12:50'de" WITHOUT any recurring keyword
  // Treat as one-time for today (or tomorrow if time has passed)
  if (time && !/(every|her|daily|günlük|weekly|haftalık|monthly|aylık|morning|sabah|evening|akşam|weekday|hafta içi|weekend|hafta sonu)/.test(normalized)) {
    const runAt = new Date(now);
    runAt.setHours(time.hour, time.minute, 0, 0);

    // If time has already passed today, schedule for tomorrow
    if (runAt <= now) {
      runAt.setDate(runAt.getDate() + 1);
    }

    const timeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
    const isToday = runAt.getDate() === now.getDate();
    return {
      type: 'one-time',
      runAt,
      description: `${isToday ? 'Today' : 'Tomorrow'} at ${timeStr}`,
    };
  }

  // ==========================================================================
  // RECURRING SCHEDULES (Turkish & English)
  // ==========================================================================

  const hour = time?.hour ?? 9;
  const minute = time?.minute ?? 0;
  const timeStr = `${hour}:${minute.toString().padStart(2, '0')}`;

  // Every minute / Her dakika
  if (/every\s*minute|her\s*dakika/.test(normalized)) {
    return { type: 'cron', cron: CRON_PRESETS.everyMinute, description: 'Every minute' };
  }

  // Every X minutes / Her X dakikada
  const minuteInterval = normalized.match(/(?:every|her)\s*(\d+)\s*(?:dakika|minute|dk|min)/);
  if (minuteInterval) {
    const interval = parseInt(minuteInterval[1]!, 10);
    return { type: 'cron', cron: `*/${interval} * * * *`, description: `Every ${interval} minutes` };
  }

  // Every hour / Her saat
  if (/every\s*hour|hourly|her\s*saat|saatlik/.test(normalized)) {
    return { type: 'cron', cron: CRON_PRESETS.everyHour, description: 'Every hour' };
  }

  // Every X hours / Her X saatte
  const hourInterval = normalized.match(/(?:every|her)\s*(\d+)\s*(?:saat|hour|hr)/);
  if (hourInterval) {
    const interval = parseInt(hourInterval[1]!, 10);
    return { type: 'cron', cron: `0 */${interval} * * *`, description: `Every ${interval} hours` };
  }

  // Morning / Her sabah
  if (/every\s*morning|mornings|her\s*sabah|sabahları/.test(normalized)) {
    const h = time ? hour : 9;
    return { type: 'cron', cron: `${minute} ${h} * * *`, description: `Every morning at ${h}:${minute.toString().padStart(2, '0')}` };
  }

  // Evening / Her akşam
  if (/every\s*evening|evenings|her\s*akşam|akşamları/.test(normalized)) {
    const h = time ? hour : 18;
    return { type: 'cron', cron: `${minute} ${h} * * *`, description: `Every evening at ${h}:${minute.toString().padStart(2, '0')}` };
  }

  // Daily / Her gün / Günlük
  if (/every\s*day|daily|her\s*gün|günlük/.test(normalized)) {
    return { type: 'cron', cron: `${minute} ${hour} * * *`, description: `Daily at ${timeStr}` };
  }

  // Weekdays / Hafta içi
  if (/weekday|work\s*day|hafta\s*içi|iş\s*günü|iş\s*günleri/.test(normalized)) {
    return { type: 'cron', cron: `${minute} ${hour} * * 1-5`, description: `Weekdays at ${timeStr}` };
  }

  // Weekends / Hafta sonu
  if (/weekend|hafta\s*sonu/.test(normalized)) {
    return { type: 'cron', cron: `${minute} ${hour} * * 0,6`, description: `Weekends at ${timeStr}` };
  }

  // Specific days (Turkish & English)
  const dayMap: Record<string, { num: string; en: string }> = {
    // English
    'monday': { num: '1', en: 'Monday' }, 'mon': { num: '1', en: 'Monday' },
    'tuesday': { num: '2', en: 'Tuesday' }, 'tue': { num: '2', en: 'Tuesday' },
    'wednesday': { num: '3', en: 'Wednesday' }, 'wed': { num: '3', en: 'Wednesday' },
    'thursday': { num: '4', en: 'Thursday' }, 'thu': { num: '4', en: 'Thursday' },
    'friday': { num: '5', en: 'Friday' }, 'fri': { num: '5', en: 'Friday' },
    'saturday': { num: '6', en: 'Saturday' }, 'sat': { num: '6', en: 'Saturday' },
    'sunday': { num: '0', en: 'Sunday' }, 'sun': { num: '0', en: 'Sunday' },
    // Turkish
    'pazartesi': { num: '1', en: 'Monday' }, 'pzt': { num: '1', en: 'Monday' },
    'salı': { num: '2', en: 'Tuesday' }, 'sal': { num: '2', en: 'Tuesday' },
    'çarşamba': { num: '3', en: 'Wednesday' }, 'çar': { num: '3', en: 'Wednesday' },
    'perşembe': { num: '4', en: 'Thursday' }, 'per': { num: '4', en: 'Thursday' },
    'cuma': { num: '5', en: 'Friday' }, 'cum': { num: '5', en: 'Friday' },
    'cumartesi': { num: '6', en: 'Saturday' }, 'cmt': { num: '6', en: 'Saturday' },
    'pazar': { num: '0', en: 'Sunday' }, 'paz': { num: '0', en: 'Sunday' },
  };

  for (const [dayName, info] of Object.entries(dayMap)) {
    if (normalized.includes(dayName)) {
      return {
        type: 'cron',
        cron: `${minute} ${hour} * * ${info.num}`,
        description: `Every ${info.en} at ${timeStr}`,
      };
    }
  }

  // Weekly / Haftalık
  if (/weekly|haftalık/.test(normalized)) {
    return { type: 'cron', cron: `${minute} ${hour} * * 1`, description: `Weekly on Monday at ${timeStr}` };
  }

  // Monthly / Aylık
  if (/monthly|first\s*of\s*month|aylık|ayın\s*başı|ayın\s*1/i.test(normalized)) {
    return { type: 'cron', cron: `${minute} ${hour} 1 * *`, description: `Monthly on the 1st at ${timeStr}` };
  }

  // Specific day of month
  const dayOfMonth = normalized.match(/(?:ayın\s*)?(\d+)(?:st|nd|rd|th|\.|\s*'?i)?(?:\s*of\s*(?:the\s*)?month)?(?:\s*günü)?/);
  if (dayOfMonth && /ay|month/.test(normalized)) {
    const day = parseInt(dayOfMonth[1]!, 10);
    if (day >= 1 && day <= 31) {
      return { type: 'cron', cron: `${minute} ${hour} ${day} * *`, description: `Monthly on day ${day} at ${timeStr}` };
    }
  }

  return null;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use parseSchedule instead
 */
export function naturalLanguageToCron(text: string): { cron: string; description: string } | null {
  const result = parseSchedule(text);
  if (!result) return null;

  if (result.type === 'cron' && result.cron) {
    return { cron: result.cron, description: result.description };
  }

  // For one-time schedules, return a cron that runs at that time daily
  // This is a fallback for legacy code that only supports cron
  if (result.type === 'one-time' && result.runAt) {
    const cron = `${result.runAt.getMinutes()} ${result.runAt.getHours()} * * *`;
    return { cron, description: result.description + ' (converted to daily)' };
  }

  return null;
}

/**
 * Format cron expression for display
 */
export function formatCronDescription(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Common patterns
  if (cron === '* * * * *') return 'Every minute';
  if (minute?.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour?.startsWith('*/') && minute === '0') return `Every ${hour.slice(2)} hours`;
  if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
    return `Weekdays at ${hour}:${minute?.padStart(2, '0')}`;
  }
  if (dayOfWeek === '0,6' && dayOfMonth === '*' && month === '*') {
    return `Weekends at ${hour}:${minute?.padStart(2, '0')}`;
  }
  if (dayOfWeek === '*' && dayOfMonth === '*' && month === '*') {
    return `Daily at ${hour}:${minute?.padStart(2, '0')}`;
  }
  if (dayOfMonth === '1' && month === '*' && dayOfWeek === '*') {
    return `Monthly on the 1st at ${hour}:${minute?.padStart(2, '0')}`;
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (dayOfWeek && /^\d$/.test(dayOfWeek)) {
    return `Every ${days[parseInt(dayOfWeek, 10)]} at ${hour}:${minute?.padStart(2, '0')}`;
  }

  return `${cron} (custom)`;
}

// =============================================================================
// Scheduler Singleton for Tools
// =============================================================================

let schedulerInstance: Scheduler | null = null;

async function getScheduler(): Promise<Scheduler> {
  if (!schedulerInstance) {
    schedulerInstance = createScheduler();
    await schedulerInstance.initialize();
  }
  return schedulerInstance;
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Create scheduled task tool
 */
export const createScheduledTaskTool: ToolDefinition = {
  name: 'create_scheduled_task',
  description: `Create a new scheduled task. Supports both ONE-TIME and RECURRING schedules with natural language (Turkish & English):

ONE-TIME (tek seferlik):
- "12:50" or "12:50'de" - today at this time (or tomorrow if passed)
- "bugün 14:30" / "today at 2:30pm" - today at specific time
- "yarın 09:00" / "tomorrow at 9am" - tomorrow at specific time
- "5 dakika sonra" / "in 5 minutes" - relative time
- "2 saat sonra" / "in 2 hours" - relative time

RECURRING (tekrarlayan):
- "her sabah 9'da" / "every morning at 9" - daily recurring
- "her gün 12:50" / "daily at 12:50" - daily recurring
- "hafta içi 08:30" / "weekdays at 8:30" - weekdays only
- "her pazartesi" / "every monday" - weekly on specific day
- "aylık" / "monthly" - first of each month
- "her 15 dakikada" / "every 15 minutes" - interval

The task will run automatically at the specified times.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Task name (human readable)',
      },
      schedule: {
        type: 'string',
        description: 'When to run: natural language in Turkish or English. For one-time: "12:50", "bugün 14:30", "5 dakika sonra". For recurring: "her gün 9da", "weekdays at 8:30"',
      },
      taskType: {
        type: 'string',
        description: 'Type of task',
        enum: ['prompt', 'tool'],
      },
      prompt: {
        type: 'string',
        description: 'For prompt tasks: the instruction for the AI to execute',
      },
      toolName: {
        type: 'string',
        description: 'For tool tasks: name of the tool to call',
      },
      toolArgs: {
        type: 'object',
        description: 'For tool tasks: arguments to pass to the tool',
      },
      notifyChannels: {
        type: 'array',
        description: 'Channels to send results to (e.g., ["telegram", "email"])',
        items: { type: 'string' },
      },
      priority: {
        type: 'string',
        description: 'Task priority',
        enum: ['low', 'normal', 'high', 'critical'],
      },
      description: {
        type: 'string',
        description: 'Optional task description',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether task is enabled (default: true)',
      },
    },
    required: ['name', 'schedule', 'taskType'],
  },
};

export const createScheduledTaskExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();

    // Parse schedule (supports both one-time and recurring)
    const scheduleInput = args.schedule as string;
    const parsed = parseSchedule(scheduleInput);

    if (!parsed) {
      return {
        content: JSON.stringify({
          error: 'Could not parse schedule expression',
          input: scheduleInput,
          hint: 'Try formats like: "12:50" (one-time), "bugün 14:30", "5 dakika sonra", "her sabah 9da", "weekdays at 8:30", or cron "0 9 * * *"',
        }),
        isError: true,
      };
    }

    // Validate schedule
    let nextRun: Date | null = null;
    if (parsed.type === 'one-time' && parsed.runAt) {
      nextRun = parsed.runAt;
      // Check if time is in the past
      if (nextRun <= new Date()) {
        return {
          content: JSON.stringify({
            error: 'Scheduled time is in the past',
            requestedTime: nextRun.toLocaleString(),
            hint: 'Please specify a future time',
          }),
          isError: true,
        };
      }
    } else if (parsed.type === 'cron' && parsed.cron) {
      nextRun = getNextRunTime(parsed.cron);
      if (!nextRun) {
        return {
          content: JSON.stringify({
            error: 'Invalid cron expression - could not calculate next run time',
            cron: parsed.cron,
          }),
          isError: true,
        };
      }
    }

    // Build task payload
    const taskType = args.taskType as 'prompt' | 'tool';
    let payload;

    if (taskType === 'prompt') {
      if (!args.prompt) {
        return {
          content: 'Prompt is required for prompt-type tasks',
          isError: true,
        };
      }
      payload = createPromptTask(args.prompt as string);
    } else {
      if (!args.toolName) {
        return {
          content: 'Tool name is required for tool-type tasks',
          isError: true,
        };
      }
      payload = createToolTask(
        args.toolName as string,
        (args.toolArgs as Record<string, unknown>) ?? {}
      );
    }

    // Create task with appropriate schedule type
    const task = await scheduler.addTask({
      name: args.name as string,
      description: args.description as string | undefined,
      // For one-time tasks, use a dummy cron but set runAt and oneTime flag
      cron: parsed.type === 'cron' ? parsed.cron! : '0 0 1 1 *', // Dummy cron for one-time
      runAt: parsed.type === 'one-time' ? parsed.runAt?.toISOString() : undefined,
      oneTime: parsed.type === 'one-time',
      type: taskType,
      payload,
      enabled: (args.enabled as boolean) ?? true,
      priority: (args.priority as TaskPriority) ?? 'normal',
      userId: context.userId ?? 'anonymous',
      notifyChannels: args.notifyChannels as string[] | undefined,
    });

    const isOneTime = parsed.type === 'one-time';
    return {
      content: JSON.stringify({
        success: true,
        task: {
          id: task.id,
          name: task.name,
          schedule: parsed.description,
          scheduleType: isOneTime ? 'one-time' : 'recurring',
          cron: isOneTime ? undefined : parsed.cron,
          nextRun: task.nextRun,
          enabled: task.enabled,
          notifyChannels: task.notifyChannels,
        },
        message: isOneTime
          ? `One-time task "${task.name}" scheduled for ${nextRun!.toLocaleString()}`
          : `Recurring task "${task.name}" created. Next run: ${nextRun!.toLocaleString()}`,
      }),
    };
  } catch (error) {
    return {
      content: `Error creating scheduled task: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * List scheduled tasks tool
 */
export const listScheduledTasksTool: ToolDefinition = {
  name: 'list_scheduled_tasks',
  description: 'List all scheduled tasks. Shows task names, schedules, and next run times.',
  parameters: {
    type: 'object',
    properties: {
      includeDisabled: {
        type: 'boolean',
        description: 'Include disabled tasks (default: false)',
      },
      type: {
        type: 'string',
        description: 'Filter by task type',
        enum: ['prompt', 'tool'],
      },
    },
    required: [],
  },
};

export const listScheduledTasksExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();
    const userId = context.userId ?? 'anonymous';

    let tasks = scheduler.getUserTasks(userId);

    // Filter disabled
    if (!args.includeDisabled) {
      tasks = tasks.filter(t => t.enabled);
    }

    // Filter by type
    if (args.type) {
      tasks = tasks.filter(t => t.type === args.type);
    }

    // Sort by next run
    tasks.sort((a, b) => {
      if (!a.nextRun) return 1;
      if (!b.nextRun) return -1;
      return a.nextRun.localeCompare(b.nextRun);
    });

    const formatted = tasks.map(t => ({
      id: t.id,
      name: t.name,
      schedule: formatCronDescription(t.cron),
      cron: t.cron,
      type: t.type,
      enabled: t.enabled,
      priority: t.priority,
      nextRun: t.nextRun,
      lastRun: t.lastRun,
      lastStatus: t.lastStatus,
      notifyChannels: t.notifyChannels,
    }));

    return {
      content: JSON.stringify({
        count: formatted.length,
        tasks: formatted,
      }),
    };
  } catch (error) {
    return {
      content: `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Update scheduled task tool
 */
export const updateScheduledTaskTool: ToolDefinition = {
  name: 'update_scheduled_task',
  description: 'Update an existing scheduled task. Can change schedule, enable/disable, or modify notification channels.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to update',
      },
      name: {
        type: 'string',
        description: 'New task name',
      },
      schedule: {
        type: 'string',
        description: 'New schedule (natural language or cron)',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable or disable the task',
      },
      notifyChannels: {
        type: 'array',
        description: 'New notification channels',
        items: { type: 'string' },
      },
      priority: {
        type: 'string',
        description: 'New priority',
        enum: ['low', 'normal', 'high', 'critical'],
      },
    },
    required: ['taskId'],
  },
};

export const updateScheduledTaskExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();
    const taskId = args.taskId as string;

    const task = scheduler.getTask(taskId);
    if (!task) {
      return {
        content: `Task not found: ${taskId}`,
        isError: true,
      };
    }

    // Verify ownership
    const userId = context.userId ?? 'anonymous';
    if (task.userId !== userId) {
      return {
        content: 'Access denied: task belongs to another user',
        isError: true,
      };
    }

    // Build updates
    const updates: Partial<ScheduledTask> = {};

    if (args.name) updates.name = args.name as string;
    if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
    if (args.notifyChannels) updates.notifyChannels = args.notifyChannels as string[];
    if (args.priority) updates.priority = args.priority as TaskPriority;

    if (args.schedule) {
      const parsed = naturalLanguageToCron(args.schedule as string);
      if (!parsed) {
        return {
          content: 'Could not parse schedule expression',
          isError: true,
        };
      }
      updates.cron = parsed.cron;
    }

    const updated = await scheduler.updateTask(taskId, updates);

    return {
      content: JSON.stringify({
        success: true,
        task: {
          id: updated?.id,
          name: updated?.name,
          schedule: updated ? formatCronDescription(updated.cron) : undefined,
          enabled: updated?.enabled,
          nextRun: updated?.nextRun,
        },
        message: `Task "${updated?.name}" updated successfully`,
      }),
    };
  } catch (error) {
    return {
      content: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Delete scheduled task tool
 */
export const deleteScheduledTaskTool: ToolDefinition = {
  name: 'delete_scheduled_task',
  description: 'Delete a scheduled task. This action cannot be undone.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to delete',
      },
    },
    required: ['taskId'],
  },
};

export const deleteScheduledTaskExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();
    const taskId = args.taskId as string;

    const task = scheduler.getTask(taskId);
    if (!task) {
      return {
        content: `Task not found: ${taskId}`,
        isError: true,
      };
    }

    // Verify ownership
    const userId = context.userId ?? 'anonymous';
    if (task.userId !== userId) {
      return {
        content: 'Access denied: task belongs to another user',
        isError: true,
      };
    }

    await scheduler.deleteTask(taskId);

    return {
      content: JSON.stringify({
        success: true,
        deletedTask: task.name,
        message: `Task "${task.name}" deleted successfully`,
      }),
    };
  } catch (error) {
    return {
      content: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Get task history tool
 */
export const getTaskHistoryTool: ToolDefinition = {
  name: 'get_task_history',
  description: 'Get execution history for a scheduled task. Shows past runs, results, and any errors.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of history entries (default: 10)',
      },
    },
    required: ['taskId'],
  },
};

export const getTaskHistoryExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();
    const taskId = args.taskId as string;
    const limit = (args.limit as number) ?? 10;

    const task = scheduler.getTask(taskId);
    if (!task) {
      return {
        content: `Task not found: ${taskId}`,
        isError: true,
      };
    }

    // Verify ownership
    const userId = context.userId ?? 'anonymous';
    if (task.userId !== userId) {
      return {
        content: 'Access denied: task belongs to another user',
        isError: true,
      };
    }

    const history = scheduler.getTaskHistory(taskId, limit);

    return {
      content: JSON.stringify({
        task: {
          id: task.id,
          name: task.name,
        },
        historyCount: history.length,
        history: history.map(h => ({
          executionId: h.executionId,
          status: h.status,
          startedAt: h.startedAt,
          completedAt: h.completedAt,
          duration: h.duration ? `${h.duration}ms` : undefined,
          error: h.error,
        })),
      }),
    };
  } catch (error) {
    return {
      content: `Error getting history: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Trigger task manually tool
 */
export const triggerTaskTool: ToolDefinition = {
  name: 'trigger_task',
  description: 'Manually trigger a scheduled task to run immediately, regardless of its schedule.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to trigger',
      },
    },
    required: ['taskId'],
  },
};

export const triggerTaskExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  try {
    const scheduler = await getScheduler();
    const taskId = args.taskId as string;

    const task = scheduler.getTask(taskId);
    if (!task) {
      return {
        content: `Task not found: ${taskId}`,
        isError: true,
      };
    }

    // Verify ownership
    const userId = context.userId ?? 'anonymous';
    if (task.userId !== userId) {
      return {
        content: 'Access denied: task belongs to another user',
        isError: true,
      };
    }

    const result = await scheduler.triggerTask(taskId);

    return {
      content: JSON.stringify({
        task: task.name,
        triggered: true,
        result: result ? {
          status: result.status,
          duration: result.duration ? `${result.duration}ms` : undefined,
          error: result.error,
        } : null,
        message: result?.status === 'completed'
          ? `Task "${task.name}" completed successfully`
          : `Task "${task.name}" ${result?.status ?? 'triggered'}`,
      }),
    };
  } catch (error) {
    return {
      content: `Error triggering task: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// Export All Tools
// =============================================================================

export const SCHEDULER_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: createScheduledTaskTool, executor: createScheduledTaskExecutor },
  { definition: listScheduledTasksTool, executor: listScheduledTasksExecutor },
  { definition: updateScheduledTaskTool, executor: updateScheduledTaskExecutor },
  { definition: deleteScheduledTaskTool, executor: deleteScheduledTaskExecutor },
  { definition: getTaskHistoryTool, executor: getTaskHistoryExecutor },
  { definition: triggerTaskTool, executor: triggerTaskExecutor },
];

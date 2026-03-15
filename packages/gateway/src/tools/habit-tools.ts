/**
 * Habit Tracking Tools
 *
 * AI tools for managing habits with streak tracking and daily logging.
 * Uses the HabitsRepository which stores data in PostgreSQL.
 *
 * Tools: create_habit, list_habits, update_habit, delete_habit,
 *        log_habit, get_today_habits, get_habit_stats, archive_habit
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { HabitsRepository } from '../db/repositories/habits.js';
import type { ToolExecutionResult } from '../services/tool-executor.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const HABIT_TOOLS: ToolDefinition[] = [
  {
    name: 'create_habit',
    brief: 'Create a new habit to track daily',
    description: `Create a new habit for daily tracking with streaks.
Use for routines like exercise, reading, meditation, journaling, etc.
This is the PREFERRED tool for habit tracking — do NOT create custom tables for habits.`,
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Habit name (e.g., "Morning exercise", "Read 30 minutes")' },
        description: { type: 'string', description: 'Optional detailed description' },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'weekdays', 'custom'],
          description: 'How often (default: daily)',
        },
        targetDays: {
          type: 'array',
          items: { type: 'number' },
          description: 'Custom target days (0=Sunday, 1=Monday, ...6=Saturday). Only for frequency=custom.',
        },
        targetCount: {
          type: 'number',
          description: 'Number of times to complete per day (default: 1)',
        },
        unit: { type: 'string', description: 'Unit of measurement (e.g., "minutes", "pages", "glasses")' },
        category: { type: 'string', description: 'Category (e.g., "health", "learning", "mindfulness")' },
        reminderTime: { type: 'string', description: 'Reminder time in HH:mm format' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_habits',
    brief: 'List all habits with streak info',
    description: 'List habits with current streak, longest streak, and total completions. Supports filtering by category and archive status.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category' },
        isArchived: { type: 'boolean', description: 'Show archived habits (default: false)' },
        limit: { type: 'number', description: 'Maximum number of habits to return (default: 50)' },
      },
      required: [],
    },
  },
  {
    name: 'update_habit',
    brief: 'Update a habit name, frequency, or target',
    description: 'Update an existing habit. Only include the fields you want to change.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'The habit ID to update' },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'weekdays', 'custom'],
          description: 'New frequency',
        },
        targetDays: { type: 'array', items: { type: 'number' }, description: 'New target days' },
        targetCount: { type: 'number', description: 'New target count' },
        unit: { type: 'string', description: 'New unit' },
        category: { type: 'string', description: 'New category' },
        reminderTime: { type: 'string', description: 'New reminder time (HH:mm)' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'delete_habit',
    brief: 'Delete a habit and its logs permanently',
    description: 'Permanently delete a habit and all its completion logs. Use archive_habit to hide without deleting.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'The habit ID to delete' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'log_habit',
    brief: 'Log a habit completion for today or a specific date',
    description: `Record that a habit was completed. Automatically updates streaks.
If no date is provided, logs for today. If count > 1, records multiple completions.`,
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'The habit ID to log' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
        count: { type: 'number', description: 'Number of completions (default: 1)' },
        notes: { type: 'string', description: 'Optional notes about this completion' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'get_today_habits',
    brief: 'Get habits due today with completion status',
    description: 'Returns all habits scheduled for today with their completion status, current streak, and progress toward daily target.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_habit_stats',
    brief: 'Get detailed stats for a habit (streaks, completion rate)',
    description: 'Get detailed statistics for a habit including current/longest streak, weekly/monthly completion counts, and overall completion rate.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'The habit ID to get stats for' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'archive_habit',
    brief: 'Archive a habit (hide without deleting)',
    description: 'Archive a habit to hide it from the active list. Logs and streaks are preserved. Use update_habit with isArchived=false to unarchive.',
    category: 'productivity',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'The habit ID to archive' },
      },
      required: ['habitId'],
    },
  },
];

export const HABIT_TOOL_NAMES = HABIT_TOOLS.map((t) => t.name);

// ============================================================================
// Executor
// ============================================================================

export async function executeHabitTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  try {
    const repo = new HabitsRepository(userId);

    switch (toolName) {
      case 'create_habit': {
        const habit = await repo.create({
          name: args.name as string,
          description: args.description as string | undefined,
          frequency: (args.frequency as 'daily' | 'weekly' | 'weekdays' | 'custom') ?? 'daily',
          targetDays: args.targetDays as number[] | undefined,
          targetCount: (args.targetCount as number) ?? 1,
          unit: args.unit as string | undefined,
          category: args.category as string | undefined,
          reminderTime: args.reminderTime as string | undefined,
        });
        return { success: true, result: habit };
      }

      case 'list_habits': {
        const habits = await repo.list({
          category: args.category as string | undefined,
          isArchived: (args.isArchived as boolean) ?? false,
          limit: (args.limit as number) ?? 50,
        });
        return {
          success: true,
          result: {
            habits,
            total: habits.length,
            message: habits.length === 0
              ? 'No habits found. Create one with create_habit.'
              : `Found ${habits.length} habit(s).`,
          },
        };
      }

      case 'update_habit': {
        const { habitId, ...updates } = args as { habitId: string; [key: string]: unknown };
        const updated = await repo.update(habitId, updates);
        if (!updated) return { success: false, error: `Habit not found: ${habitId}` };
        return { success: true, result: updated };
      }

      case 'delete_habit': {
        const deleted = await repo.delete(args.habitId as string);
        if (!deleted) return { success: false, error: `Habit not found: ${args.habitId}` };
        return { success: true, result: { message: 'Habit deleted permanently.' } };
      }

      case 'log_habit': {
        const logEntry = await repo.logHabit(args.habitId as string, {
          date: args.date as string | undefined,
          count: args.count as number | undefined,
          notes: args.notes as string | undefined,
        });
        if (!logEntry) return { success: false, error: `Habit not found: ${args.habitId}` };
        return { success: true, result: { log: logEntry, message: 'Habit logged successfully!' } };
      }

      case 'get_today_habits': {
        const todayHabits = await repo.getTodayHabits();
        const progress = await repo.getTodayProgress();
        return {
          success: true,
          result: {
            habits: todayHabits,
            progress,
            message: todayHabits.length === 0
              ? 'No habits scheduled for today.'
              : `${progress.completed}/${progress.total} habits completed today.`,
          },
        };
      }

      case 'get_habit_stats': {
        const stats = await repo.getHabitStats(args.habitId as string);
        return { success: true, result: stats };
      }

      case 'archive_habit': {
        const archived = await repo.archive(args.habitId as string);
        if (!archived) return { success: false, error: `Habit not found: ${args.habitId}` };
        return { success: true, result: { message: 'Habit archived.', habit: archived } };
      }

      default:
        return { success: false, error: `Unknown habit tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

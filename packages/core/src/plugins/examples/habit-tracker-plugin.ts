/**
 * Habit Tracker Plugin
 *
 * Track daily habits and build streaks.
 * - Create and manage habits
 * - Daily check-ins
 * - Streak tracking
 * - Statistics and insights
 */

import { createPlugin } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'custom';
  customDays?: number[]; // 0-6 for Sunday-Saturday
  targetCount: number; // times per period
  color?: string;
  icon?: string;
  createdAt: string;
  archived: boolean;
}

interface HabitLog {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  completed: boolean;
  count: number;
  notes?: string;
  timestamp: string;
}

interface HabitStats {
  habitId: string;
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  completionRate: number; // percentage
  lastCompleted?: string;
}

// In-memory storage (replace with persistent storage)
const habits: Map<string, Habit> = new Map();
const logs: HabitLog[] = [];

// =============================================================================
// Helper Functions
// =============================================================================

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]!;
}

function calculateStats(habitId: string): HabitStats {
  const habitLogs = logs.filter(l => l.habitId === habitId && l.completed).sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  const today = new Date();

  // Calculate streaks
  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split('T')[0];

    const completed = habitLogs.some(l => l.date === dateStr);

    if (completed) {
      tempStreak++;
      if (i === 0 || currentStreak > 0) {
        currentStreak = tempStreak;
      }
    } else {
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
      tempStreak = 0;
      if (i === 0) currentStreak = 0;
    }
  }

  if (tempStreak > longestStreak) {
    longestStreak = tempStreak;
  }

  const last30Days = habitLogs.filter(l => {
    const logDate = new Date(l.date);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return logDate >= thirtyDaysAgo;
  }).length;

  return {
    habitId,
    currentStreak,
    longestStreak,
    totalCompletions: habitLogs.length,
    completionRate: Math.round((last30Days / 30) * 100),
    lastCompleted: habitLogs[0]?.date,
  };
}

// =============================================================================
// Tool Definitions
// =============================================================================

const createHabitTool: ToolDefinition = {
  name: 'habit_create',
  description: 'Create a new habit to track',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Habit name (e.g., "Exercise", "Read", "Meditate")',
      },
      description: {
        type: 'string',
        description: 'Detailed description or motivation',
      },
      frequency: {
        type: 'string',
        enum: ['daily', 'weekly', 'custom'],
        description: 'How often to perform this habit',
      },
      customDays: {
        type: 'array',
        items: { type: 'number' },
        description: 'For custom frequency: days of week (0=Sunday, 6=Saturday)',
      },
      targetCount: {
        type: 'number',
        description: 'Target completions per period (default: 1)',
      },
    },
    required: ['name'],
  },
};

const logHabitTool: ToolDefinition = {
  name: 'habit_log',
  description: 'Log a habit completion for today or a specific date',
  parameters: {
    type: 'object',
    properties: {
      habitId: {
        type: 'string',
        description: 'Habit ID or name',
      },
      date: {
        type: 'string',
        description: 'Date (YYYY-MM-DD), defaults to today',
      },
      count: {
        type: 'number',
        description: 'Number of completions (default: 1)',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about this completion',
      },
    },
    required: ['habitId'],
  },
};

const listHabitsTool: ToolDefinition = {
  name: 'habit_list',
  description: 'List all habits with their current status',
  parameters: {
    type: 'object',
    properties: {
      includeArchived: {
        type: 'boolean',
        description: 'Include archived habits',
      },
    },
    required: [],
  },
};

const habitStatsTool: ToolDefinition = {
  name: 'habit_stats',
  description: 'Get detailed statistics for a habit or all habits',
  parameters: {
    type: 'object',
    properties: {
      habitId: {
        type: 'string',
        description: 'Specific habit ID (or omit for all habits)',
      },
    },
    required: [],
  },
};

const habitTodayTool: ToolDefinition = {
  name: 'habit_today',
  description: 'Get today\'s habit checklist and progress',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const archiveHabitTool: ToolDefinition = {
  name: 'habit_archive',
  description: 'Archive or unarchive a habit',
  parameters: {
    type: 'object',
    properties: {
      habitId: {
        type: 'string',
        description: 'Habit ID to archive',
      },
      archive: {
        type: 'boolean',
        description: 'True to archive, false to unarchive',
      },
    },
    required: ['habitId'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const createHabitExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const habit: Habit = {
    id: `habit_${Date.now()}`,
    name: params.name as string,
    description: params.description as string | undefined,
    frequency: (params.frequency as Habit['frequency']) || 'daily',
    customDays: params.customDays as number[] | undefined,
    targetCount: (params.targetCount as number) || 1,
    createdAt: new Date().toISOString(),
    archived: false,
  };

  habits.set(habit.id, habit);

  return {
    content: {
      message: `Habit "${habit.name}" created`,
      habit,
      tip: 'Start small and be consistent. It takes about 66 days to form a new habit!',
    },
    isError: false,
  };
};

const logHabitExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  // Find habit by ID or name
  let habit: Habit | undefined;
  const habitId = params.habitId as string;

  habit = habits.get(habitId);
  if (!habit) {
    // Search by name
    for (const h of habits.values()) {
      if (h.name.toLowerCase().includes(habitId.toLowerCase())) {
        habit = h;
        break;
      }
    }
  }

  if (!habit) {
    return {
      content: { error: `Habit not found: ${habitId}` },
      isError: true,
    };
  }

  const date = (params.date as string) || getTodayString();
  const count = (params.count as number) || 1;

  // Check if already logged today
  const existingLog = logs.find(l => l.habitId === habit!.id && l.date === date);
  if (existingLog) {
    existingLog.count += count;
    existingLog.completed = existingLog.count >= habit.targetCount;
    existingLog.notes = params.notes as string || existingLog.notes;
  } else {
    logs.push({
      id: `log_${Date.now()}`,
      habitId: habit.id,
      date,
      completed: count >= habit.targetCount,
      count,
      notes: params.notes as string,
      timestamp: new Date().toISOString(),
    });
  }

  const stats = calculateStats(habit.id);

  return {
    content: {
      message: `Logged "${habit.name}" for ${date}`,
      habit: habit.name,
      date,
      count: existingLog?.count || count,
      stats: {
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
      },
      celebration: stats.currentStreak >= 7 ? `Amazing! ${stats.currentStreak} day streak!` : undefined,
    },
    isError: false,
  };
};

const listHabitsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const includeArchived = params.includeArchived as boolean;
  const today = getTodayString();

  const habitList = Array.from(habits.values())
    .filter(h => includeArchived || !h.archived)
    .map(h => {
      const stats = calculateStats(h.id);
      const todayLog = logs.find(l => l.habitId === h.id && l.date === today);

      return {
        id: h.id,
        name: h.name,
        frequency: h.frequency,
        completedToday: todayLog?.completed || false,
        currentStreak: stats.currentStreak,
        completionRate: stats.completionRate,
        archived: h.archived,
      };
    });

  return {
    content: {
      habits: habitList,
      total: habitList.length,
      completedToday: habitList.filter(h => h.completedToday).length,
    },
    isError: false,
  };
};

const habitStatsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  if (params.habitId) {
    const habit = habits.get(params.habitId as string);
    if (!habit) {
      return {
        content: { error: 'Habit not found' },
        isError: true,
      };
    }

    const stats = calculateStats(habit.id);
    return {
      content: {
        habit: habit.name,
        stats,
      },
      isError: false,
    };
  }

  // All habits stats
  const allStats = Array.from(habits.values())
    .filter(h => !h.archived)
    .map(h => ({
      habit: h.name,
      ...calculateStats(h.id),
    }));

  const overallCompletionRate = allStats.length > 0
    ? Math.round(allStats.reduce((sum, s) => sum + s.completionRate, 0) / allStats.length)
    : 0;

  return {
    content: {
      habits: allStats,
      overall: {
        totalHabits: allStats.length,
        averageCompletionRate: overallCompletionRate,
        totalCompletions: allStats.reduce((sum, s) => sum + s.totalCompletions, 0),
      },
    },
    isError: false,
  };
};

const habitTodayExecutor: ToolExecutor = async (): Promise<ToolExecutionResult> => {
  const today = getTodayString();
  const dayOfWeek = new Date().getDay();

  const todayHabits = Array.from(habits.values())
    .filter(h => {
      if (h.archived) return false;
      if (h.frequency === 'daily') return true;
      if (h.frequency === 'custom' && h.customDays) {
        return h.customDays.includes(dayOfWeek);
      }
      return true;
    })
    .map(h => {
      const todayLog = logs.find(l => l.habitId === h.id && l.date === today);
      const stats = calculateStats(h.id);

      return {
        id: h.id,
        name: h.name,
        completed: todayLog?.completed || false,
        count: todayLog?.count || 0,
        target: h.targetCount,
        streak: stats.currentStreak,
      };
    });

  const completed = todayHabits.filter(h => h.completed).length;
  const total = todayHabits.length;

  return {
    content: {
      date: today,
      habits: todayHabits,
      progress: {
        completed,
        total,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
      message: completed === total && total > 0
        ? 'All habits completed for today!'
        : `${completed}/${total} habits completed`,
    },
    isError: false,
  };
};

const archiveHabitExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const habit = habits.get(params.habitId as string);
  if (!habit) {
    return {
      content: { error: 'Habit not found' },
      isError: true,
    };
  }

  habit.archived = params.archive !== false;

  return {
    content: {
      message: habit.archived ? `Habit "${habit.name}" archived` : `Habit "${habit.name}" restored`,
      habit: habit.name,
      archived: habit.archived,
    },
    isError: false,
  };
};

// =============================================================================
// Plugin Export
// =============================================================================

export const habitTrackerPlugin = createPlugin()
  .meta({
    id: 'dev.ownpilot.habit-tracker',
    name: 'Habit Tracker',
    version: '1.0.0',
    description: 'Track daily habits, build streaks, and improve your routines',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'storage'],
    permissions: ['storage'],
    icon: '✅',
  })
  .tool(createHabitTool, createHabitExecutor)
  .tool(logHabitTool, logHabitExecutor)
  .tool(listHabitsTool, listHabitsExecutor)
  .tool(habitStatsTool, habitStatsExecutor)
  .tool(habitTodayTool, habitTodayExecutor)
  .tool(archiveHabitTool, archiveHabitExecutor)
  .build();

/**
 * Pomodoro Timer Plugin
 *
 * Provides Pomodoro technique time management tools.
 * - 25-minute work sessions
 * - 5-minute short breaks
 * - 15-minute long breaks (every 4 sessions)
 * - Session tracking and statistics
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

interface PomodoroSession {
  id: string;
  type: 'work' | 'short_break' | 'long_break';
  startedAt: string;
  endedAt?: string;
  completed: boolean;
  taskDescription?: string;
  interruptions: number;
}

interface PomodoroState {
  currentSession?: PomodoroSession;
  sessionsToday: number;
  totalWorkMinutesToday: number;
  streak: number;
  settings: {
    workDuration: number; // minutes
    shortBreakDuration: number;
    longBreakDuration: number;
    sessionsUntilLongBreak: number;
  };
}

// In-memory state (replace with persistent storage in production)
let state: PomodoroState = {
  sessionsToday: 0,
  totalWorkMinutesToday: 0,
  streak: 0,
  settings: {
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsUntilLongBreak: 4,
  },
};

// =============================================================================
// Tool Definitions
// =============================================================================

const startPomodoroTool: ToolDefinition = {
  name: 'pomodoro_start',
  description: 'Start a Pomodoro work session or break',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Session type',
        enum: ['work', 'short_break', 'long_break'],
      },
      task: {
        type: 'string',
        description: 'What are you working on? (for work sessions)',
      },
    },
    required: [],
  },
};

const stopPomodoroTool: ToolDefinition = {
  name: 'pomodoro_stop',
  description: 'Stop or complete the current Pomodoro session',
  parameters: {
    type: 'object',
    properties: {
      completed: {
        type: 'boolean',
        description: 'Whether the session was completed successfully',
      },
    },
    required: [],
  },
};

const pomodoroStatusTool: ToolDefinition = {
  name: 'pomodoro_status',
  description: 'Get current Pomodoro status and daily statistics',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const pomodoroSettingsTool: ToolDefinition = {
  name: 'pomodoro_settings',
  description: 'Update Pomodoro timer settings',
  parameters: {
    type: 'object',
    properties: {
      workDuration: {
        type: 'number',
        description: 'Work session duration in minutes (default: 25)',
      },
      shortBreakDuration: {
        type: 'number',
        description: 'Short break duration in minutes (default: 5)',
      },
      longBreakDuration: {
        type: 'number',
        description: 'Long break duration in minutes (default: 15)',
      },
      sessionsUntilLongBreak: {
        type: 'number',
        description: 'Work sessions before a long break (default: 4)',
      },
    },
    required: [],
  },
};

const pomodoroLogInterruptionTool: ToolDefinition = {
  name: 'pomodoro_interrupt',
  description: 'Log an interruption during the current session',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Reason for the interruption',
      },
    },
    required: [],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const startPomodoroExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  if (state.currentSession && !state.currentSession.endedAt) {
    return {
      content: {
        error: 'A session is already running',
        currentSession: state.currentSession,
      },
      isError: true,
    };
  }

  // Determine session type
  let sessionType: 'work' | 'short_break' | 'long_break' = params.type as 'work' | 'short_break' | 'long_break' || 'work';

  // Auto-suggest break type after completing work
  if (!params.type && state.sessionsToday > 0 && state.sessionsToday % state.settings.sessionsUntilLongBreak === 0) {
    sessionType = 'long_break';
  } else if (!params.type && state.currentSession?.type === 'work' && state.currentSession.completed) {
    sessionType = 'short_break';
  }

  const session: PomodoroSession = {
    id: `pomo_${Date.now()}`,
    type: sessionType,
    startedAt: new Date().toISOString(),
    completed: false,
    taskDescription: params.task as string,
    interruptions: 0,
  };

  state.currentSession = session;

  const duration = sessionType === 'work'
    ? state.settings.workDuration
    : sessionType === 'short_break'
      ? state.settings.shortBreakDuration
      : state.settings.longBreakDuration;

  return {
    content: {
      message: `Started ${sessionType.replace('_', ' ')} session`,
      session,
      duration: `${duration} minutes`,
      endTime: new Date(Date.now() + duration * 60 * 1000).toISOString(),
      tip: sessionType === 'work'
        ? 'Focus on your task. Avoid distractions!'
        : 'Take a real break. Step away from the screen!',
    },
    isError: false,
  };
};

const stopPomodoroExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  if (!state.currentSession || state.currentSession.endedAt) {
    return {
      content: {
        error: 'No active session to stop',
      },
      isError: true,
    };
  }

  const session = state.currentSession;
  session.endedAt = new Date().toISOString();
  session.completed = params.completed !== false;

  // Update stats
  if (session.type === 'work' && session.completed) {
    state.sessionsToday++;
    const durationMs = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
    state.totalWorkMinutesToday += Math.round(durationMs / 60000);
    state.streak++;
  }

  // Determine next recommendation
  let nextRecommendation = 'work';
  if (session.type === 'work' && session.completed) {
    if (state.sessionsToday % state.settings.sessionsUntilLongBreak === 0) {
      nextRecommendation = 'long_break';
    } else {
      nextRecommendation = 'short_break';
    }
  }

  return {
    content: {
      message: session.completed ? 'Session completed!' : 'Session stopped',
      session,
      stats: {
        sessionsToday: state.sessionsToday,
        totalWorkMinutes: state.totalWorkMinutesToday,
        streak: state.streak,
      },
      nextRecommendation,
    },
    isError: false,
  };
};

const pomodoroStatusExecutor: ToolExecutor = async (): Promise<ToolExecutionResult> => {
  let timeRemaining: string | null = null;

  if (state.currentSession && !state.currentSession.endedAt) {
    const duration = state.currentSession.type === 'work'
      ? state.settings.workDuration
      : state.currentSession.type === 'short_break'
        ? state.settings.shortBreakDuration
        : state.settings.longBreakDuration;

    const elapsed = Date.now() - new Date(state.currentSession.startedAt).getTime();
    const remaining = duration * 60 * 1000 - elapsed;

    if (remaining > 0) {
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timeRemaining = `${mins}:${secs.toString().padStart(2, '0')}`;
    } else {
      timeRemaining = 'Time is up!';
    }
  }

  return {
    content: {
      currentSession: state.currentSession,
      timeRemaining,
      stats: {
        sessionsToday: state.sessionsToday,
        totalWorkMinutes: state.totalWorkMinutesToday,
        streak: state.streak,
        sessionsUntilLongBreak: state.settings.sessionsUntilLongBreak - (state.sessionsToday % state.settings.sessionsUntilLongBreak),
      },
      settings: state.settings,
    },
    isError: false,
  };
};

const pomodoroSettingsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  if (params.workDuration) state.settings.workDuration = params.workDuration as number;
  if (params.shortBreakDuration) state.settings.shortBreakDuration = params.shortBreakDuration as number;
  if (params.longBreakDuration) state.settings.longBreakDuration = params.longBreakDuration as number;
  if (params.sessionsUntilLongBreak) state.settings.sessionsUntilLongBreak = params.sessionsUntilLongBreak as number;

  return {
    content: {
      message: 'Settings updated',
      settings: state.settings,
    },
    isError: false,
  };
};

const pomodoroLogInterruptionExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  if (!state.currentSession || state.currentSession.endedAt) {
    return {
      content: {
        error: 'No active session',
      },
      isError: true,
    };
  }

  state.currentSession.interruptions++;

  return {
    content: {
      message: 'Interruption logged',
      interruptions: state.currentSession.interruptions,
      tip: 'Try to minimize interruptions. Consider using "Do Not Disturb" mode.',
    },
    isError: false,
  };
};

// =============================================================================
// Plugin Export
// =============================================================================

export const pomodoroPlugin = createPlugin()
  .meta({
    id: 'dev.ownpilot.pomodoro',
    name: 'Pomodoro Timer',
    version: '1.0.0',
    description: 'Pomodoro technique time management - work sessions, breaks, and productivity tracking',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'notifications', 'storage'],
    permissions: ['storage', 'notifications'],
    icon: '🍅',
  })
  .tool(startPomodoroTool, startPomodoroExecutor)
  .tool(stopPomodoroTool, stopPomodoroExecutor)
  .tool(pomodoroStatusTool, pomodoroStatusExecutor)
  .tool(pomodoroSettingsTool, pomodoroSettingsExecutor)
  .tool(pomodoroLogInterruptionTool, pomodoroLogInterruptionExecutor)
  .build();

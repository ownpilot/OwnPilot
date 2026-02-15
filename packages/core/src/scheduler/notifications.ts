/**
 * Scheduler Notification Integration
 *
 * Connects the scheduler system with the notification system to allow
 * scheduled tasks to send notifications through various channels.
 *
 * Features:
 * - Automatic notifications on task completion/failure
 * - Configurable notification channels per task
 * - Smart notification content formatting
 * - Reminder notifications before scheduled tasks
 * - Notification preferences per user
 */

import type {
  ScheduledTask,
  TaskExecutionResult,
  TaskStatus,
  TaskPriority,
} from './index.js';

// Notification types (inlined — the full notifications module was removed as dead code)
export type NotificationChannel = 'telegram' | 'email' | 'webhook' | 'push' | 'sms';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface NotificationContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actions?: Array<{ label: string; action: string }>;
}
export interface NotificationRequest {
  userId: string;
  channels: NotificationChannel[];
  content: NotificationContent;
  priority: NotificationPriority;
  metadata?: Record<string, unknown>;
}
export interface UserNotificationPreferences {
  channels: NotificationChannel[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

// =============================================================================
// Types
// =============================================================================

/**
 * When to send notifications for a task
 */
export type TaskNotificationTrigger =
  | 'on_start'       // When task starts
  | 'on_complete'    // When task completes successfully
  | 'on_failure'     // When task fails
  | 'on_any_result'  // On any result (success or failure)
  | 'reminder';      // Before task runs

/**
 * Task notification configuration
 */
export interface TaskNotificationConfig {
  /** Notification triggers */
  triggers: TaskNotificationTrigger[];
  /** Channels to notify (overrides user defaults) */
  channels?: NotificationChannel[];
  /** Include task result in notification */
  includeResult?: boolean;
  /** Include execution duration */
  includeDuration?: boolean;
  /** Reminder minutes before execution */
  reminderMinutes?: number;
  /** Custom notification title template */
  titleTemplate?: string;
  /** Custom notification body template */
  bodyTemplate?: string;
  /** Quiet during certain hours */
  respectQuietHours?: boolean;
}

/**
 * Task notification event
 */
export interface TaskNotificationEvent {
  /** Event type */
  type: 'start' | 'complete' | 'failure' | 'reminder';
  /** Task */
  task: ScheduledTask;
  /** Execution result (if available) */
  result?: TaskExecutionResult;
  /** Timestamp */
  timestamp: string;
}

/**
 * Scheduler notification handler
 */
export type SchedulerNotificationHandler = (
  event: TaskNotificationEvent,
  notification: NotificationRequest
) => Promise<void>;

// =============================================================================
// Task Priority to Notification Priority Mapping
// =============================================================================

const PRIORITY_MAP: Record<TaskPriority, NotificationPriority> = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  critical: 'urgent',
};

// =============================================================================
// Default Notification Templates
// =============================================================================

/**
 * Default notification templates for scheduler events
 */
export const SCHEDULER_NOTIFICATION_TEMPLATES = {
  /** Task started */
  taskStarted: {
    title: '▶️ Task Started: {{taskName}}',
    body: 'Your scheduled task "{{taskName}}" has started.\n\nScheduled: {{scheduledTime}}',
  },

  /** Task completed successfully */
  taskCompleted: {
    title: '✅ Task Completed: {{taskName}}',
    body: 'Your scheduled task "{{taskName}}" completed successfully.\n\n{{#if duration}}Duration: {{duration}}ms\n\n{{/if}}{{#if result}}Result:\n{{result}}{{/if}}',
  },

  /** Task failed */
  taskFailed: {
    title: '❌ Task Failed: {{taskName}}',
    body: 'Your scheduled task "{{taskName}}" failed.\n\n{{#if error}}Error: {{error}}\n\n{{/if}}{{#if duration}}Duration: {{duration}}ms{{/if}}',
  },

  /** Task reminder */
  taskReminder: {
    title: '⏰ Upcoming Task: {{taskName}}',
    body: 'Reminder: "{{taskName}}" is scheduled to run in {{reminderMinutes}} minutes.\n\nScheduled: {{scheduledTime}}',
  },

  /** Daily summary */
  dailySummary: {
    title: '📊 Daily Task Summary',
    body: 'Tasks today:\n✅ Completed: {{completedCount}}\n❌ Failed: {{failedCount}}\n⏳ Pending: {{pendingCount}}\n\n{{#if topIssues}}Top issues:\n{{topIssues}}{{/if}}',
  },

  /** Weekly summary */
  weeklySummary: {
    title: '📈 Weekly Task Summary',
    body: 'Weekly overview:\n✅ Completed: {{completedCount}}\n❌ Failed: {{failedCount}}\n📊 Success rate: {{successRate}}%\n\nMost active tasks:\n{{topTasks}}',
  },
};

// =============================================================================
// Template Processor
// =============================================================================

/**
 * Process template with variables
 * Simple mustache-like template engine
 */
export function processTemplate(
  template: string,
  variables: Record<string, unknown>
): string {
  let result = template;

  // Handle conditionals: {{#if variable}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, variable, content) => {
      return variables[variable] ? content : '';
    }
  );

  // Handle simple variables: {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, variable) => {
    const value = variables[variable];
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  });

  return result.trim();
}

// =============================================================================
// Scheduler Notification Bridge
// =============================================================================

/**
 * Bridge between scheduler and notification system
 */
export class SchedulerNotificationBridge {
  private readonly notificationHandler: SchedulerNotificationHandler;
  private readonly taskNotificationConfigs: Map<string, TaskNotificationConfig> = new Map();
  private readonly userPreferences: Map<string, UserNotificationPreferences> = new Map();
  private reminderTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(notificationHandler: SchedulerNotificationHandler) {
    this.notificationHandler = notificationHandler;
  }

  /**
   * Set notification configuration for a task
   */
  setTaskNotificationConfig(taskId: string, config: TaskNotificationConfig): void {
    this.taskNotificationConfigs.set(taskId, config);
  }

  /**
   * Get notification configuration for a task
   */
  getTaskNotificationConfig(taskId: string): TaskNotificationConfig | undefined {
    return this.taskNotificationConfigs.get(taskId);
  }

  /**
   * Remove notification configuration for a task
   */
  removeTaskNotificationConfig(taskId: string): void {
    this.taskNotificationConfigs.delete(taskId);
    this.clearReminder(taskId);
  }

  /**
   * Set user notification preferences
   */
  setUserPreferences(userId: string, preferences: UserNotificationPreferences): void {
    this.userPreferences.set(userId, preferences);
  }

  /**
   * Get user notification preferences
   */
  getUserPreferences(userId: string): UserNotificationPreferences | undefined {
    return this.userPreferences.get(userId);
  }

  /**
   * Handle task start event
   */
  async onTaskStart(task: ScheduledTask): Promise<void> {
    const config = this.getNotificationConfigForTask(task);
    if (!config || !config.triggers.includes('on_start')) {
      return;
    }

    const event: TaskNotificationEvent = {
      type: 'start',
      task,
      timestamp: new Date().toISOString(),
    };

    const notification = this.buildNotification(event, config, task.userId);
    await this.notificationHandler(event, notification);
  }

  /**
   * Handle task completion event
   */
  async onTaskComplete(task: ScheduledTask, result: TaskExecutionResult): Promise<void> {
    const config = this.getNotificationConfigForTask(task);
    if (!config) {
      return;
    }

    const isSuccess = result.status === 'completed';
    const shouldNotify =
      config.triggers.includes('on_any_result') ||
      (isSuccess && config.triggers.includes('on_complete')) ||
      (!isSuccess && config.triggers.includes('on_failure'));

    if (!shouldNotify) {
      return;
    }

    const event: TaskNotificationEvent = {
      type: isSuccess ? 'complete' : 'failure',
      task,
      result,
      timestamp: new Date().toISOString(),
    };

    const notification = this.buildNotification(event, config, task.userId);
    await this.notificationHandler(event, notification);
  }

  /**
   * Schedule a reminder notification
   */
  scheduleReminder(task: ScheduledTask, nextRunTime: Date): void {
    const config = this.getNotificationConfigForTask(task);
    if (!config || !config.triggers.includes('reminder') || !config.reminderMinutes) {
      return;
    }

    // Clear existing reminder
    this.clearReminder(task.id);

    const reminderTime = new Date(nextRunTime.getTime() - config.reminderMinutes * 60 * 1000);
    const now = new Date();

    if (reminderTime <= now) {
      return; // Reminder time already passed
    }

    const delay = reminderTime.getTime() - now.getTime();
    const timer = setTimeout(async () => {
      const event: TaskNotificationEvent = {
        type: 'reminder',
        task,
        timestamp: new Date().toISOString(),
      };

      const notification = this.buildNotification(event, config, task.userId);
      await this.notificationHandler(event, notification);

      this.reminderTimers.delete(task.id);
    }, delay);

    this.reminderTimers.set(task.id, timer);
  }

  /**
   * Clear a scheduled reminder
   */
  clearReminder(taskId: string): void {
    const timer = this.reminderTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.reminderTimers.delete(taskId);
    }
  }

  /**
   * Clear all reminders
   */
  clearAllReminders(): void {
    for (const timer of this.reminderTimers.values()) {
      clearTimeout(timer);
    }
    this.reminderTimers.clear();
  }

  /**
   * Get notification config for a task (with fallback to defaults)
   */
  private getNotificationConfigForTask(task: ScheduledTask): TaskNotificationConfig | null {
    // Check for task-specific config
    const specificConfig = this.taskNotificationConfigs.get(task.id);
    if (specificConfig) {
      return specificConfig;
    }

    // Check if task has notification channels defined
    if (task.notifyChannels && task.notifyChannels.length > 0) {
      return {
        triggers: ['on_complete', 'on_failure'],
        channels: task.notifyChannels as NotificationChannel[],
        includeResult: true,
        includeDuration: true,
        respectQuietHours: true,
      };
    }

    return null;
  }

  /**
   * Build notification request from event
   */
  private buildNotification(
    event: TaskNotificationEvent,
    config: TaskNotificationConfig,
    userId: string
  ): NotificationRequest {
    const { task, result } = event;

    // Select template
    let template: { title: string; body: string };
    switch (event.type) {
      case 'start':
        template = SCHEDULER_NOTIFICATION_TEMPLATES.taskStarted;
        break;
      case 'complete':
        template = SCHEDULER_NOTIFICATION_TEMPLATES.taskCompleted;
        break;
      case 'failure':
        template = SCHEDULER_NOTIFICATION_TEMPLATES.taskFailed;
        break;
      case 'reminder':
        template = SCHEDULER_NOTIFICATION_TEMPLATES.taskReminder;
        break;
    }

    // Override with custom templates if provided
    if (config.titleTemplate) {
      template = { ...template, title: config.titleTemplate };
    }
    if (config.bodyTemplate) {
      template = { ...template, body: config.bodyTemplate };
    }

    // Build template variables
    const variables: Record<string, unknown> = {
      taskName: task.name,
      taskId: task.id,
      taskDescription: task.description,
      scheduledTime: task.nextRun,
      reminderMinutes: config.reminderMinutes,
    };

    if (result) {
      if (config.includeResult && result.result) {
        variables.result = typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2);
      }
      if (config.includeDuration && result.duration) {
        variables.duration = result.duration;
      }
      if (result.error) {
        variables.error = result.error;
      }
    }

    // Process templates
    const title = processTemplate(template.title, variables);
    const body = processTemplate(template.body, variables);

    // Determine channels
    const channels = config.channels ?? ['telegram']; // Default to telegram

    // Map task priority to notification priority
    const priority = PRIORITY_MAP[task.priority];

    // Build notification content
    const content: NotificationContent = {
      title,
      body,
      data: {
        taskId: task.id,
        taskName: task.name,
        eventType: event.type,
        executionId: result?.taskId,
      },
    };

    // Add actions for certain events
    if (event.type === 'failure' && result) {
      content.actions = [
        { label: 'Retry Task', action: 'retry' },
        { label: 'View Logs', action: 'view_logs' },
        { label: 'Disable Task', action: 'disable' },
      ];
    }

    // Build notification request
    const notification: NotificationRequest = {
      userId,
      channels,
      content,
      priority,
      metadata: {
        category: 'scheduled_task',
      },
    };

    return notification;
  }
}

// =============================================================================
// Integrated Scheduler with Notifications
// =============================================================================

/**
 * Configuration for scheduled task with notifications
 */
export interface NotifyingScheduledTask extends Omit<ScheduledTask, 'notifyChannels'> {
  /** Notification configuration */
  notifications?: TaskNotificationConfig;
}

/**
 * Extended scheduler configuration with notification support
 */
export interface NotifyingSchedulerConfig {
  /** Notification handler */
  notificationHandler: SchedulerNotificationHandler;
  /** Default notification config for all tasks */
  defaultNotificationConfig?: Partial<TaskNotificationConfig>;
  /** Enable daily summary notifications */
  enableDailySummary?: boolean;
  /** Daily summary time (cron format) */
  dailySummaryTime?: string;
  /** Enable weekly summary notifications */
  enableWeeklySummary?: boolean;
  /** Weekly summary day and time (cron format) */
  weeklySummaryTime?: string;
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Task execution statistics
 */
export interface TaskExecutionStats {
  /** Total tasks */
  total: number;
  /** Completed successfully */
  completed: number;
  /** Failed tasks */
  failed: number;
  /** Pending tasks */
  pending: number;
  /** Success rate percentage */
  successRate: number;
  /** Average duration (ms) */
  averageDuration: number;
  /** Most active tasks */
  topTasks: Array<{ name: string; executions: number }>;
  /** Common failure reasons */
  topIssues: Array<{ error: string; count: number }>;
}

/**
 * Calculate execution statistics from history
 */
export function calculateExecutionStats(
  history: Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>,
  tasks: Map<string, { name: string }>
): TaskExecutionStats {
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let totalDuration = 0;
  let durationCount = 0;

  const taskExecutions: Map<string, number> = new Map();
  const errorCounts: Map<string, number> = new Map();

  for (const [taskId, entries] of history) {
    taskExecutions.set(taskId, entries.length);

    for (const entry of entries) {
      switch (entry.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          if (entry.error) {
            const count = errorCounts.get(entry.error) ?? 0;
            errorCounts.set(entry.error, count + 1);
          }
          break;
        case 'pending':
          pending++;
          break;
      }

      if (entry.duration) {
        totalDuration += entry.duration;
        durationCount++;
      }
    }
  }

  const total = completed + failed + pending;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const averageDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

  // Get top tasks by execution count
  const topTasks = Array.from(taskExecutions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([taskId, executions]) => ({
      name: tasks.get(taskId)?.name ?? taskId,
      executions,
    }));

  // Get top issues
  const topIssues = Array.from(errorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([error, count]) => ({ error, count }));

  return {
    total,
    completed,
    failed,
    pending,
    successRate,
    averageDuration,
    topTasks,
    topIssues,
  };
}

/**
 * Build daily summary notification
 */
export function buildDailySummaryNotification(
  stats: TaskExecutionStats,
  userId: string
): NotificationRequest {
  const topIssues = stats.topIssues.length > 0
    ? stats.topIssues.map(i => `• ${i.error} (${i.count}x)`).join('\n')
    : '';

  const variables = {
    completedCount: stats.completed,
    failedCount: stats.failed,
    pendingCount: stats.pending,
    topIssues,
  };

  const title = processTemplate(SCHEDULER_NOTIFICATION_TEMPLATES.dailySummary.title, variables);
  const body = processTemplate(SCHEDULER_NOTIFICATION_TEMPLATES.dailySummary.body, variables);

  return {
    userId,
    channels: ['telegram'],
    content: {
      title,
      body,
    },
    priority: 'low',
    metadata: {
      category: 'summary',
    },
  };
}

/**
 * Build weekly summary notification
 */
export function buildWeeklySummaryNotification(
  stats: TaskExecutionStats,
  userId: string
): NotificationRequest {
  const topTasks = stats.topTasks.length > 0
    ? stats.topTasks.map(t => `• ${t.name}: ${t.executions} runs`).join('\n')
    : 'No tasks executed';

  const variables = {
    completedCount: stats.completed,
    failedCount: stats.failed,
    successRate: stats.successRate,
    topTasks,
  };

  const title = processTemplate(SCHEDULER_NOTIFICATION_TEMPLATES.weeklySummary.title, variables);
  const body = processTemplate(SCHEDULER_NOTIFICATION_TEMPLATES.weeklySummary.body, variables);

  return {
    userId,
    channels: ['telegram'],
    content: {
      title,
      body,
    },
    priority: 'low',
    metadata: {
      category: 'summary',
    },
  };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a scheduler notification bridge
 */
export function createSchedulerNotificationBridge(
  notificationHandler: SchedulerNotificationHandler
): SchedulerNotificationBridge {
  return new SchedulerNotificationBridge(notificationHandler);
}

/**
 * Create default notification config
 */
export function createDefaultTaskNotificationConfig(
  channels: NotificationChannel[] = ['telegram']
): TaskNotificationConfig {
  return {
    triggers: ['on_complete', 'on_failure'],
    channels,
    includeResult: true,
    includeDuration: true,
    respectQuietHours: true,
  };
}

/**
 * Create notification config for critical tasks
 */
export function createCriticalTaskNotificationConfig(
  channels: NotificationChannel[] = ['telegram', 'email']
): TaskNotificationConfig {
  return {
    triggers: ['on_start', 'on_complete', 'on_failure', 'reminder'],
    channels,
    includeResult: true,
    includeDuration: true,
    reminderMinutes: 15,
    respectQuietHours: false, // Critical tasks always notify
  };
}

/**
 * Create notification config for silent tasks (failure only)
 */
export function createSilentTaskNotificationConfig(
  channels: NotificationChannel[] = ['telegram']
): TaskNotificationConfig {
  return {
    triggers: ['on_failure'],
    channels,
    includeResult: false,
    includeDuration: true,
    respectQuietHours: true,
  };
}

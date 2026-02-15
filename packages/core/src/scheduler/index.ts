/**
 * Scheduler Module
 *
 * Cron-like task scheduling for the AI Gateway:
 * - Define recurring tasks
 * - Run tasks on schedule (cron expressions)
 * - Task persistence and recovery
 * - Result notifications
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';
import { generateId } from '../services/id-utils.js';

import type { SchedulerNotificationBridge, TaskNotificationConfig } from './notifications.js';

const log = getLog('Scheduler');

// =============================================================================
// Types
// =============================================================================

/**
 * Task priority
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Task status
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Scheduled task definition
 */
export interface ScheduledTask {
  /** Unique task ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Task description */
  description?: string;
  /** Cron expression (e.g., "0 9 * * *" for 9 AM daily) - for recurring tasks */
  cron: string;
  /** One-time run at specific date/time (ISO string) - for one-time tasks */
  runAt?: string;
  /** Whether this is a one-time task (auto-disabled after execution) */
  oneTime?: boolean;
  /** Task type */
  type: 'prompt' | 'tool' | 'workflow';
  /** Task payload (depends on type) */
  payload: TaskPayload;
  /** Whether task is enabled */
  enabled: boolean;
  /** Task priority */
  priority: TaskPriority;
  /** User who owns this task */
  userId: string;
  /** Notification channels (where to send results) */
  notifyChannels?: string[];
  /** Created timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
  /** Next scheduled run */
  nextRun?: string;
  /** Last run timestamp */
  lastRun?: string;
  /** Last run status */
  lastStatus?: TaskStatus;
  /** Max execution time in ms */
  timeout?: number;
  /** Retry on failure */
  retryOnFailure?: boolean;
  /** Max retry attempts */
  maxRetries?: number;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Task payload types
 */
export type TaskPayload =
  | PromptTaskPayload
  | ToolTaskPayload
  | WorkflowTaskPayload;

/**
 * Prompt-based task (AI will execute the prompt)
 */
export interface PromptTaskPayload {
  type: 'prompt';
  /** The prompt/instruction for the AI */
  prompt: string;
  /** Model preferences */
  modelPreferences?: {
    capabilities?: string[];
    preferredProviders?: string[];
    maxCost?: number;
  };
  /** Output format */
  outputFormat?: 'text' | 'json' | 'markdown';
  /** Context data to include */
  context?: Record<string, unknown>;
}

/**
 * Tool-based task (directly call a tool)
 */
export interface ToolTaskPayload {
  type: 'tool';
  /** Tool name to execute */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
}

/**
 * Workflow task (sequence of steps)
 */
export interface WorkflowTaskPayload {
  type: 'workflow';
  /** Workflow steps */
  steps: Array<{
    name: string;
    type: 'prompt' | 'tool';
    payload: PromptTaskPayload | ToolTaskPayload;
    /** Condition for execution (depends on previous step result) */
    condition?: string;
  }>;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  /** Task ID */
  taskId: string;
  /** Execution status */
  status: TaskStatus;
  /** Start time */
  startedAt: string;
  /** End time */
  completedAt?: string;
  /** Execution duration in ms */
  duration?: number;
  /** Result content */
  result?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Model used (for prompt tasks) */
  modelUsed?: string;
  /** Token usage */
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Task execution history entry
 */
export interface TaskHistoryEntry extends TaskExecutionResult {
  /** Execution ID */
  executionId: string;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Path to store task definitions */
  tasksFilePath?: string;
  /** Path to store execution history */
  historyFilePath?: string;
  /** Max history entries to keep per task */
  maxHistoryPerTask?: number;
  /** Default timeout for tasks in ms */
  defaultTimeout?: number;
  /** Check interval in ms */
  checkInterval?: number;
}

// =============================================================================
// Cron Parser (Simple Implementation)
// =============================================================================

/**
 * Parse cron expression and get next run time
 * Supports: minute hour day month weekday
 * Special values: asterisk (any), asterisk/n (every n), n-m (range), n,m (list)
 */
export function parseCronExpression(cron: string): CronParts | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  return {
    minute: parts[0]!,
    hour: parts[1]!,
    dayOfMonth: parts[2]!,
    month: parts[3]!,
    dayOfWeek: parts[4]!,
  };
}

interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/**
 * Check if a cron part matches a value
 */
function matchesCronPart(part: string, value: number, _max: number): boolean {
  // Any value
  if (part === '*') {
    return true;
  }

  // Step value (*/n)
  if (part.startsWith('*/')) {
    const step = parseInt(part.slice(2), 10);
    return value % step === 0;
  }

  // Range (n-m)
  if (part.includes('-')) {
    const [start, end] = part.split('-').map(n => parseInt(n, 10));
    return start !== undefined && end !== undefined && value >= start && value <= end;
  }

  // List (n,m,...)
  if (part.includes(',')) {
    const values = part.split(',').map(n => parseInt(n, 10));
    return values.includes(value);
  }

  // Exact value
  return parseInt(part, 10) === value;
}

/**
 * Check if current time matches cron expression
 */
export function matchesCron(cron: string, date: Date = new Date()): boolean {
  const parts = parseCronExpression(cron);
  if (!parts) {
    return false;
  }

  return (
    matchesCronPart(parts.minute, date.getMinutes(), 59) &&
    matchesCronPart(parts.hour, date.getHours(), 23) &&
    matchesCronPart(parts.dayOfMonth, date.getDate(), 31) &&
    matchesCronPart(parts.month, date.getMonth() + 1, 12) &&
    matchesCronPart(parts.dayOfWeek, date.getDay(), 6)
  );
}

/**
 * Get next run time for a cron expression
 */
export function getNextRunTime(cron: string, from: Date = new Date()): Date | null {
  const parts = parseCronExpression(cron);
  if (!parts) {
    return null;
  }

  // Start from next minute
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Search for next matching time (up to 1 year ahead)
  const maxIterations = 365 * 24 * 60; // 1 year in minutes
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(cron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

/**
 * Validate a cron expression and return diagnostic info
 */
export function validateCronExpression(cron: string): {
  valid: boolean;
  error?: string;
  nextFire?: Date;
} {
  if (!cron || typeof cron !== 'string') {
    return { valid: false, error: 'Cron expression is required and must be a string' };
  }

  const trimmed = cron.trim();
  if (!trimmed) {
    return { valid: false, error: 'Cron expression cannot be empty' };
  }

  const parts = parseCronExpression(trimmed);
  if (!parts) {
    return {
      valid: false,
      error: `Invalid cron format: expected 5 fields (minute hour day month weekday), got ${trimmed.split(/\s+/).length}`,
    };
  }

  // Validate each field's range
  const fieldValidations: Array<{ name: string; value: string; min: number; max: number }> = [
    { name: 'minute', value: parts.minute, min: 0, max: 59 },
    { name: 'hour', value: parts.hour, min: 0, max: 23 },
    { name: 'day of month', value: parts.dayOfMonth, min: 1, max: 31 },
    { name: 'month', value: parts.month, min: 1, max: 12 },
    { name: 'day of week', value: parts.dayOfWeek, min: 0, max: 6 },
  ];

  for (const field of fieldValidations) {
    const err = validateCronField(field.value, field.min, field.max);
    if (err) {
      return { valid: false, error: `Invalid ${field.name} field "${field.value}": ${err}` };
    }
  }

  // Try to calculate next fire time
  const nextFire = getNextRunTime(trimmed);
  if (!nextFire) {
    return {
      valid: false,
      error: 'Cron expression is syntactically valid but no matching time found within 365 days',
    };
  }

  return { valid: true, nextFire };
}

/**
 * Validate a single cron field value
 */
function validateCronField(value: string, min: number, max: number): string | null {
  if (value === '*') return null;

  // Step: */n
  if (value.startsWith('*/')) {
    const step = parseInt(value.slice(2), 10);
    if (isNaN(step) || step <= 0) return `step value must be a positive integer`;
    return null;
  }

  // Range: n-m
  if (value.includes('-') && !value.includes(',')) {
    const [startStr, endStr] = value.split('-');
    const start = parseInt(startStr!, 10);
    const end = parseInt(endStr!, 10);
    if (isNaN(start) || isNaN(end)) return `range values must be integers`;
    if (start < min || start > max) return `${start} is out of range ${min}-${max}`;
    if (end < min || end > max) return `${end} is out of range ${min}-${max}`;
    if (start > end) return `range start (${start}) must be <= end (${end})`;
    return null;
  }

  // List: n,m,...
  if (value.includes(',')) {
    const parts = value.split(',');
    for (const part of parts) {
      const num = parseInt(part.trim(), 10);
      if (isNaN(num)) return `"${part}" is not a valid integer`;
      if (num < min || num > max) return `${num} is out of range ${min}-${max}`;
    }
    return null;
  }

  // Exact value
  const num = parseInt(value, 10);
  if (isNaN(num)) return `"${value}" is not a valid integer`;
  if (num < min || num > max) return `${num} is out of range ${min}-${max}`;
  return null;
}

/**
 * Common cron presets
 */
export const CRON_PRESETS = {
  everyMinute: '* * * * *',
  every5Minutes: '*/5 * * * *',
  every15Minutes: '*/15 * * * *',
  everyHour: '0 * * * *',
  everyDay9AM: '0 9 * * *',
  everyDay6PM: '0 18 * * *',
  everyMorning: '0 8 * * *',
  everyEvening: '0 20 * * *',
  everyMonday: '0 9 * * 1',
  everyWeekday: '0 9 * * 1-5',
  everyWeekend: '0 10 * * 0,6',
  firstOfMonth: '0 9 1 * *',
  lastDayOfMonth: '0 9 28-31 * *',
} as const;

// =============================================================================
// Scheduler Class
// =============================================================================

/**
 * Task Scheduler
 */
export class Scheduler {
  private readonly config: Required<SchedulerConfig>;
  private tasks: Map<string, ScheduledTask> = new Map();
  private history: Map<string, TaskHistoryEntry[]> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private taskExecutor?: (task: ScheduledTask) => Promise<TaskExecutionResult>;
  private notificationBridge?: SchedulerNotificationBridge;

  constructor(config: SchedulerConfig = {}) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    const dataDir = path.join(homeDir, '.ownpilot');

    this.config = {
      tasksFilePath: config.tasksFilePath ?? path.join(dataDir, 'scheduled-tasks.json'),
      historyFilePath: config.historyFilePath ?? path.join(dataDir, 'task-history.json'),
      maxHistoryPerTask: config.maxHistoryPerTask ?? 100,
      defaultTimeout: config.defaultTimeout ?? 300000, // 5 minutes
      checkInterval: config.checkInterval ?? 60000, // 1 minute
    };
  }

  /**
   * Initialize scheduler (load tasks from storage)
   */
  async initialize(): Promise<void> {
    await this.loadTasks();
    await this.loadHistory();
    this.updateNextRunTimes();
  }

  /**
   * Set task executor function
   */
  setTaskExecutor(executor: (task: ScheduledTask) => Promise<TaskExecutionResult>): void {
    this.taskExecutor = executor;
  }

  /**
   * Set notification bridge for sending task notifications
   */
  setNotificationBridge(bridge: SchedulerNotificationBridge): void {
    this.notificationBridge = bridge;
  }

  /**
   * Configure notifications for a specific task
   */
  configureTaskNotifications(taskId: string, config: TaskNotificationConfig): void {
    if (this.notificationBridge) {
      this.notificationBridge.setTaskNotificationConfig(taskId, config);
    }
  }

  /**
   * Remove notification configuration for a task
   */
  removeTaskNotifications(taskId: string): void {
    if (this.notificationBridge) {
      this.notificationBridge.removeTaskNotificationConfig(taskId);
    }
  }

  /**
   * Start scheduler
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.checkTimer = setInterval(() => {
      try {
        this.checkAndRunTasks().catch(e => log.error('checkAndRunTasks failed:', e));
      } catch (err) {
        log.error('checkAndRunTasks threw synchronously:', err);
      }
    }, this.config.checkInterval);
    this.checkTimer.unref();

    log.info('Started with check interval: ' + this.config.checkInterval + 'ms');
  }

  /**
   * Stop scheduler
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.isRunning = false;

    // Clear all scheduled reminders
    if (this.notificationBridge) {
      this.notificationBridge.clearAllReminders();
    }

    log.info('Stopped');
  }

  /**
   * Add a new scheduled task
   */
  async addTask(
    task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'nextRun'>
  ): Promise<ScheduledTask> {
    const id = generateId('task');
    const now = new Date().toISOString();

    // Determine next run time - either from runAt (one-time) or cron (recurring)
    let nextRunDate: Date | null = null;
    if (task.runAt) {
      // One-time task: use runAt directly
      nextRunDate = new Date(task.runAt);
    } else if (task.cron) {
      // Recurring task: calculate from cron
      nextRunDate = getNextRunTime(task.cron);
    }

    const newTask: ScheduledTask = {
      ...task,
      id,
      createdAt: now,
      updatedAt: now,
      nextRun: nextRunDate?.toISOString(),
    };

    this.tasks.set(id, newTask);
    await this.saveTasks();

    // Schedule reminder notification if bridge is configured
    if (this.notificationBridge && nextRunDate && newTask.enabled) {
      this.notificationBridge.scheduleReminder(newTask, nextRunDate);
    }

    log.info(`Added task: ${newTask.name} Next run: ${newTask.nextRun} ${task.oneTime ? '(one-time)' : ''}`);
    return newTask;
  }

  /**
   * Update an existing task
   */
  async updateTask(id: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    const updatedTask: ScheduledTask = {
      ...task,
      ...updates,
      id, // Ensure ID can't be changed
      updatedAt: new Date().toISOString(),
    };

    // Recalculate next run if cron changed
    if (updates.cron && updates.cron !== task.cron) {
      updatedTask.nextRun = getNextRunTime(updates.cron)?.toISOString();
    }

    this.tasks.set(id, updatedTask);
    await this.saveTasks();

    return updatedTask;
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<boolean> {
    const existed = this.tasks.delete(id);
    if (existed) {
      await this.saveTasks();
    }
    return existed;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks for a user
   */
  getUserTasks(userId: string): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter(t => t.userId === userId);
  }

  /**
   * Get task history
   */
  getTaskHistory(taskId: string, limit?: number): TaskHistoryEntry[] {
    const history = this.history.get(taskId) ?? [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Manually trigger a task
   */
  async triggerTask(id: string): Promise<TaskExecutionResult | null> {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    return this.executeTask(task);
  }

  /**
   * Check and run due tasks
   */
  private async checkAndRunTasks(): Promise<void> {
    const now = new Date();

    for (const task of this.tasks.values()) {
      if (!task.enabled || !task.nextRun) {
        continue;
      }

      const nextRunDate = new Date(task.nextRun);
      if (now >= nextRunDate) {
        // Task is due
        log.info(`Running task: ${task.name} ${task.oneTime ? '(one-time)' : ''}`);

        try {
          await this.executeTask(task);
        } catch (error) {
          log.error(`Task failed: ${task.name}`, error);
        }

        // Handle one-time vs recurring tasks
        if (task.oneTime) {
          // One-time task: disable after execution
          task.enabled = false;
          task.nextRun = undefined;
          log.info(`One-time task completed and disabled: ${task.name}`);
        } else {
          // Recurring task: calculate next run from cron
          const newNextRun = getNextRunTime(task.cron, now);
          task.nextRun = newNextRun?.toISOString();

          // Schedule reminder for next run
          if (this.notificationBridge && newNextRun) {
            this.notificationBridge.scheduleReminder(task, newNextRun);
          }
        }

        await this.saveTasks();
      }
    }
  }

  /**
   * Execute a task
   */
  private async executeTask(task: ScheduledTask): Promise<TaskExecutionResult> {
    const startedAt = new Date().toISOString();

    // Update task status
    task.lastRun = startedAt;
    task.lastStatus = 'running';

    // Notify task start
    if (this.notificationBridge) {
      try {
        await this.notificationBridge.onTaskStart(task);
      } catch (err) {
        log.error('Failed to send start notification:', err);
      }
    }

    let result: TaskExecutionResult;

    try {
      if (!this.taskExecutor) {
        throw new Error('No task executor configured');
      }

      // Execute with timeout
      const timeoutMs = task.timeout ?? this.config.defaultTimeout;
      const executionPromise = this.taskExecutor(task);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Task execution timeout')), timeoutMs);
      });

      const executionResult = await Promise.race([executionPromise, timeoutPromise]);

      const completedAt = new Date().toISOString();
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      result = {
        ...executionResult,
        taskId: task.id,
        startedAt,
        completedAt,
        duration,
      };

      task.lastStatus = result.status;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      result = {
        taskId: task.id,
        status: 'failed',
        startedAt,
        completedAt,
        duration,
        error: getErrorMessage(error),
      };

      task.lastStatus = 'failed';
    }

    // Save to history
    await this.addToHistory(task.id, result);
    await this.saveTasks();

    // Notify task completion/failure
    if (this.notificationBridge) {
      try {
        await this.notificationBridge.onTaskComplete(task, result);
      } catch (err) {
        log.error('Failed to send completion notification:', err);
      }
    }

    return result;
  }

  /**
   * Add execution result to history
   */
  private async addToHistory(taskId: string, result: TaskExecutionResult): Promise<void> {
    if (!this.history.has(taskId)) {
      this.history.set(taskId, []);
    }

    const history = this.history.get(taskId)!;
    const entry: TaskHistoryEntry = {
      ...result,
      executionId: generateId('exec'),
    };

    history.push(entry);

    // Trim history if needed
    if (history.length > this.config.maxHistoryPerTask) {
      history.splice(0, history.length - this.config.maxHistoryPerTask);
    }

    await this.saveHistory();
  }

  /**
   * Update next run times for all tasks
   */
  private updateNextRunTimes(): void {
    const now = new Date();
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        task.nextRun = getNextRunTime(task.cron, now)?.toISOString();
      }
    }
  }

  /**
   * Load tasks from file
   */
  private async loadTasks(): Promise<void> {
    try {
      const content = await fs.readFile(this.config.tasksFilePath, 'utf-8');
      const tasks = JSON.parse(content) as ScheduledTask[];
      this.tasks = new Map(tasks.map(t => [t.id, t]));
      log.info(`Loaded ${this.tasks.size} tasks`);
    } catch {
      // File doesn't exist or is invalid
      this.tasks = new Map();
    }
  }

  /**
   * Save tasks to file
   */
  private async saveTasks(): Promise<void> {
    const tasks = Array.from(this.tasks.values());
    await fs.mkdir(path.dirname(this.config.tasksFilePath), { recursive: true });
    await fs.writeFile(this.config.tasksFilePath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  /**
   * Load history from file
   */
  private async loadHistory(): Promise<void> {
    try {
      const content = await fs.readFile(this.config.historyFilePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, TaskHistoryEntry[]>;
      this.history = new Map(Object.entries(data));
    } catch {
      this.history = new Map();
    }
  }

  /**
   * Save history to file
   */
  private async saveHistory(): Promise<void> {
    const data = Object.fromEntries(this.history);
    await fs.mkdir(path.dirname(this.config.historyFilePath), { recursive: true });
    await fs.writeFile(this.config.historyFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new scheduler instance
 */
export function createScheduler(config?: SchedulerConfig): Scheduler {
  return new Scheduler(config);
}

/**
 * Create a prompt task payload
 */
export function createPromptTask(
  prompt: string,
  options?: Partial<Omit<PromptTaskPayload, 'type' | 'prompt'>>
): PromptTaskPayload {
  return {
    type: 'prompt',
    prompt,
    ...options,
  };
}

/**
 * Create a tool task payload
 */
export function createToolTask(
  toolName: string,
  args: Record<string, unknown>
): ToolTaskPayload {
  return {
    type: 'tool',
    toolName,
    args,
  };
}

// =============================================================================
// Re-export Notifications Integration
// =============================================================================

export * from './notifications.js';

// =============================================================================
// Example Tasks
// =============================================================================

/**
 * Example scheduled tasks for reference
 */
export const EXAMPLE_TASKS = {
  morningBriefing: {
    name: 'Morning Briefing',
    description: 'Daily summary of news, weather, and schedule',
    cron: CRON_PRESETS.everyDay9AM,
    type: 'prompt' as const,
    payload: createPromptTask(
      'Prepare a morning briefing including: 1) Weather forecast for today, 2) Top 3 news headlines, 3) My schedule for today. Present in a concise, easy-to-read format.',
      { outputFormat: 'markdown' }
    ),
    priority: 'normal' as const,
  },
  weeklyExpenseReport: {
    name: 'Weekly Expense Report',
    description: 'Summarize expenses from the past week',
    cron: CRON_PRESETS.everyMonday,
    type: 'tool' as const,
    payload: createToolTask('expense_summary', { period: 'last_week' }),
    priority: 'low' as const,
  },
  dailyResearch: {
    name: 'Daily Research Task',
    description: 'Research a specific topic and prepare a report',
    cron: CRON_PRESETS.everyDay9AM,
    type: 'prompt' as const,
    payload: createPromptTask(
      'Research the latest developments in AI and prepare a summary with: 1) Key announcements, 2) New research papers, 3) Industry news. Format as bullet points.',
      {
        modelPreferences: {
          capabilities: ['reasoning'],
          maxCost: 0.50,
        },
        outputFormat: 'markdown',
      }
    ),
    priority: 'normal' as const,
  },
};

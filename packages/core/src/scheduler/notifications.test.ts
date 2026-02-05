/**
 * Scheduler Notification Integration Tests
 *
 * Tests for:
 * - processTemplate: Mustache-like template processor
 * - SchedulerNotificationBridge: Task notification lifecycle
 * - calculateExecutionStats: Execution history statistics
 * - buildDailySummaryNotification / buildWeeklySummaryNotification
 * - Factory functions for configs and bridge creation
 * - SCHEDULER_NOTIFICATION_TEMPLATES: Exported template objects
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processTemplate,
  SchedulerNotificationBridge,
  calculateExecutionStats,
  buildDailySummaryNotification,
  buildWeeklySummaryNotification,
  createSchedulerNotificationBridge,
  createDefaultTaskNotificationConfig,
  createCriticalTaskNotificationConfig,
  createSilentTaskNotificationConfig,
  SCHEDULER_NOTIFICATION_TEMPLATES,
} from './notifications.js';
import type {
  TaskNotificationConfig,
  TaskNotificationEvent,
  TaskExecutionStats,
} from './notifications.js';
import type { ScheduledTask, TaskExecutionResult } from './index.js';
import type { NotificationRequest } from '../notifications/index.js';

// =============================================================================
// Helpers
// =============================================================================

function makeMockTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Test Task',
    description: 'A test task description',
    cron: '0 9 * * *',
    type: 'prompt',
    payload: { type: 'prompt', prompt: 'Do something' },
    enabled: true,
    priority: 'normal',
    userId: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    nextRun: '2024-01-01T12:00:00Z',
    notifyChannels: undefined,
    ...overrides,
  };
}

function makeMockResult(overrides: Partial<TaskExecutionResult> = {}): TaskExecutionResult {
  return {
    taskId: 'exec-1',
    status: 'completed',
    startedAt: '2024-01-01T12:00:00Z',
    completedAt: '2024-01-01T12:00:01Z',
    result: 'done',
    duration: 1500,
    error: undefined,
    ...overrides,
  };
}

// =============================================================================
// processTemplate
// =============================================================================

describe('processTemplate', () => {
  it('substitutes simple {{variable}} placeholders', () => {
    const result = processTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('substitutes multiple variables', () => {
    const result = processTemplate('{{greeting}} {{name}}, you have {{count}} items', {
      greeting: 'Hi',
      name: 'Alice',
      count: 3,
    });
    expect(result).toBe('Hi Alice, you have 3 items');
  });

  it('replaces undefined variables with empty string', () => {
    const result = processTemplate('Value: {{missing}}', {});
    expect(result).toBe('Value:');
  });

  it('replaces null variables with empty string', () => {
    const result = processTemplate('Value: {{val}}', { val: null });
    expect(result).toBe('Value:');
  });

  it('converts object variables to JSON.stringify output', () => {
    const obj = { key: 'value' };
    const result = processTemplate('Data: {{data}}', { data: obj });
    expect(result).toContain('"key": "value"');
  });

  it('converts number variables to string', () => {
    const result = processTemplate('Count: {{count}}', { count: 42 });
    expect(result).toBe('Count: 42');
  });

  it('converts boolean variables to string', () => {
    const result = processTemplate('Active: {{active}}', { active: true });
    expect(result).toBe('Active: true');
  });

  it('handles {{#if variable}}...{{/if}} conditional blocks - truthy', () => {
    const result = processTemplate('{{#if name}}Hello {{name}}{{/if}}', { name: 'Bob' });
    expect(result).toBe('Hello Bob');
  });

  it('removes {{#if variable}}...{{/if}} block when variable is falsy', () => {
    const result = processTemplate('Start{{#if name}} Hello {{name}}{{/if}} End', {});
    expect(result).toBe('Start End');
  });

  it('handles multiple conditional blocks', () => {
    const template = '{{#if a}}A{{/if}} {{#if b}}B{{/if}}';
    expect(processTemplate(template, { a: true, b: false })).toBe('A');
    expect(processTemplate(template, { a: true, b: true })).toBe('A B');
    expect(processTemplate(template, { a: false, b: false })).toBe('');
  });

  it('trims whitespace from the final result', () => {
    const result = processTemplate('  Hello {{name}}  ', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('handles empty template', () => {
    const result = processTemplate('', {});
    expect(result).toBe('');
  });

  it('handles template with no variables', () => {
    const result = processTemplate('Static text', { unused: 'val' });
    expect(result).toBe('Static text');
  });

  it('handles conditional with multiline content', () => {
    const template = '{{#if error}}Error:\n{{error}}{{/if}}';
    const result = processTemplate(template, { error: 'Something broke' });
    expect(result).toBe('Error:\nSomething broke');
  });
});

// =============================================================================
// SchedulerNotificationBridge
// =============================================================================

describe('SchedulerNotificationBridge', () => {
  let handler: ReturnType<typeof vi.fn>;
  let bridge: SchedulerNotificationBridge;

  beforeEach(() => {
    handler = vi.fn().mockResolvedValue(undefined);
    bridge = new SchedulerNotificationBridge(handler);
  });

  // ---------------------------------------------------------------------------
  // Task notification config management
  // ---------------------------------------------------------------------------

  describe('task notification config', () => {
    it('stores and retrieves task notification config', () => {
      const config: TaskNotificationConfig = {
        triggers: ['on_complete'],
        channels: ['telegram'],
      };
      bridge.setTaskNotificationConfig('task-1', config);
      expect(bridge.getTaskNotificationConfig('task-1')).toBe(config);
    });

    it('returns undefined for unknown task config', () => {
      expect(bridge.getTaskNotificationConfig('nonexistent')).toBeUndefined();
    });

    it('removes task notification config and clears reminder', () => {
      bridge.setTaskNotificationConfig('task-1', {
        triggers: ['on_complete'],
      });
      bridge.removeTaskNotificationConfig('task-1');
      expect(bridge.getTaskNotificationConfig('task-1')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // User preferences management
  // ---------------------------------------------------------------------------

  describe('user preferences', () => {
    it('stores and retrieves user preferences', () => {
      const prefs = {
        userId: 'user-1',
        channels: ['telegram' as const],
        minPriority: 'normal' as const,
        channelSettings: {},
      };
      bridge.setUserPreferences('user-1', prefs);
      expect(bridge.getUserPreferences('user-1')).toBe(prefs);
    });

    it('returns undefined for unknown user', () => {
      expect(bridge.getUserPreferences('nonexistent')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // onTaskStart
  // ---------------------------------------------------------------------------

  describe('onTaskStart', () => {
    it('sends notification when config has on_start trigger', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['telegram'],
      });

      await bridge.onTaskStart(task);

      expect(handler).toHaveBeenCalledTimes(1);
      const [event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(event.type).toBe('start');
      expect(event.task).toBe(task);
      expect(notification.userId).toBe('user-1');
      expect(notification.content.title).toContain('Test Task');
    });

    it('does not send notification when config lacks on_start trigger', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
      });

      await bridge.onTaskStart(task);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not send notification when no config exists', async () => {
      const task = makeMockTask();
      await bridge.onTaskStart(task);
      expect(handler).not.toHaveBeenCalled();
    });

    it('uses fallback config from task.notifyChannels but on_start is not in defaults', async () => {
      const task = makeMockTask({ notifyChannels: ['telegram'] });
      // Fallback config has triggers: ['on_complete', 'on_failure'], not on_start
      await bridge.onTaskStart(task);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // onTaskComplete
  // ---------------------------------------------------------------------------

  describe('onTaskComplete', () => {
    it('sends notification on successful completion with on_complete trigger', async () => {
      const task = makeMockTask();
      const result = makeMockResult();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
        includeResult: true,
        includeDuration: true,
      });

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledTimes(1);
      const [event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(event.type).toBe('complete');
      expect(event.result).toBe(result);
      expect(notification.content.title).toContain('Completed');
      expect(notification.content.body).toContain('1500');
      expect(notification.content.body).toContain('done');
    });

    it('sends notification on failure with on_failure trigger', async () => {
      const task = makeMockTask();
      const result = makeMockResult({ status: 'failed', error: 'Timeout', result: undefined });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_failure'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledTimes(1);
      const [event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(event.type).toBe('failure');
      expect(notification.content.title).toContain('Failed');
      expect(notification.content.body).toContain('Timeout');
    });

    it('sends notification on any result with on_any_result trigger', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_any_result'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, makeMockResult({ status: 'completed' }));
      expect(handler).toHaveBeenCalledTimes(1);

      await bridge.onTaskComplete(task, makeMockResult({ status: 'failed' }));
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('does not send notification when trigger does not match', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, makeMockResult({ status: 'failed' }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not send notification when no config exists and no notifyChannels', async () => {
      const task = makeMockTask();
      await bridge.onTaskComplete(task, makeMockResult());
      expect(handler).not.toHaveBeenCalled();
    });

    it('uses fallback config from task.notifyChannels for completion', async () => {
      const task = makeMockTask({ notifyChannels: ['telegram', 'discord'] });
      const result = makeMockResult();

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledTimes(1);
      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.channels).toEqual(['telegram', 'discord']);
    });

    it('includes action buttons for failure events', async () => {
      const task = makeMockTask();
      const result = makeMockResult({ status: 'failed', error: 'crash' });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_failure'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, result);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.actions).toBeDefined();
      expect(notification.content.actions).toHaveLength(3);
      expect(notification.content.actions![0].label).toBe('Retry Task');
      expect(notification.content.actions![1].label).toBe('View Logs');
      expect(notification.content.actions![2].label).toBe('Disable Task');
    });

    it('does not include action buttons for success events', async () => {
      const task = makeMockTask();
      const result = makeMockResult({ status: 'completed' });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, result);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.actions).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Priority mapping
  // ---------------------------------------------------------------------------

  describe('priority mapping', () => {
    it.each([
      ['low', 'low'],
      ['normal', 'normal'],
      ['high', 'high'],
      ['critical', 'urgent'],
    ] as const)('maps task priority %s to notification priority %s', async (taskPriority, expectedNotifPriority) => {
      const task = makeMockTask({ priority: taskPriority });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['telegram'],
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.priority).toBe(expectedNotifPriority);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom templates
  // ---------------------------------------------------------------------------

  describe('custom templates', () => {
    it('uses custom titleTemplate when provided', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['telegram'],
        titleTemplate: 'Custom: {{taskName}}',
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.title).toBe('Custom: Test Task');
    });

    it('uses custom bodyTemplate when provided', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['telegram'],
        bodyTemplate: 'Running {{taskName}} ({{taskId}})',
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.body).toBe('Running Test Task (task-1)');
    });
  });

  // ---------------------------------------------------------------------------
  // Default channels
  // ---------------------------------------------------------------------------

  describe('default channels', () => {
    it('defaults to telegram when config has no channels', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        // no channels property
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.channels).toEqual(['telegram']);
    });

    it('uses config channels when specified', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['email', 'slack'],
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.channels).toEqual(['email', 'slack']);
    });
  });

  // ---------------------------------------------------------------------------
  // Notification metadata
  // ---------------------------------------------------------------------------

  describe('notification metadata', () => {
    it('includes scheduler metadata category in notifications', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_start'],
        channels: ['telegram'],
      });

      await bridge.onTaskStart(task);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.metadata).toEqual({ category: 'scheduled_task' });
    });

    it('includes task data in notification content', async () => {
      const task = makeMockTask();
      const result = makeMockResult();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
      });

      await bridge.onTaskComplete(task, result);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.data).toEqual({
        taskId: 'task-1',
        taskName: 'Test Task',
        eventType: 'complete',
        executionId: 'exec-1',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // includeResult / includeDuration
  // ---------------------------------------------------------------------------

  describe('result and duration inclusion', () => {
    it('omits result from body when includeResult is false', async () => {
      const task = makeMockTask();
      const result = makeMockResult({ result: 'secret output' });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
        includeResult: false,
        includeDuration: false,
      });

      await bridge.onTaskComplete(task, result);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.body).not.toContain('secret output');
      expect(notification.content.body).not.toContain('1500');
    });

    it('includes result and duration when flags are true', async () => {
      const task = makeMockTask();
      const result = makeMockResult({ result: 'output data', duration: 2500 });
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'],
        channels: ['telegram'],
        includeResult: true,
        includeDuration: true,
      });

      await bridge.onTaskComplete(task, result);

      const [_event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(notification.content.body).toContain('output data');
      expect(notification.content.body).toContain('2500');
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleReminder / clearReminder / clearAllReminders
  // ---------------------------------------------------------------------------

  describe('reminders', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      bridge.clearAllReminders();
      vi.useRealTimers();
    });

    it('schedules a reminder and fires it at the correct time', async () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 15,
      });

      const nextRunTime = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task, nextRunTime);

      // Reminder should fire at 10:45 (60min - 15min = 45min from now)
      expect(handler).not.toHaveBeenCalled();

      // Advance to just before reminder time
      await vi.advanceTimersByTimeAsync(44 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();

      // Advance past reminder time
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(handler).toHaveBeenCalledTimes(1);

      const [event, notification] = handler.mock.calls[0] as [TaskNotificationEvent, NotificationRequest];
      expect(event.type).toBe('reminder');
      expect(notification.content.title).toContain('Upcoming Task');
    });

    it('does not schedule reminder when trigger is missing', () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['on_complete'], // no 'reminder'
        channels: ['telegram'],
        reminderMinutes: 15,
      });

      const nextRunTime = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task, nextRunTime);

      vi.advanceTimersByTime(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not schedule reminder when reminderMinutes is not set', () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        // no reminderMinutes
      });

      const nextRunTime = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task, nextRunTime);

      vi.advanceTimersByTime(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not schedule reminder when reminder time has already passed', () => {
      const now = new Date('2024-01-01T10:50:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 15,
      });

      // nextRun is 11:00, reminder would be 10:45 which is before now (10:50)
      const nextRunTime = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task, nextRunTime);

      vi.advanceTimersByTime(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('clearReminder cancels a pending reminder', async () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 15,
      });

      const nextRunTime = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task, nextRunTime);

      // Clear before it fires
      bridge.clearReminder(task.id);

      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('clearReminder is safe to call for nonexistent timer', () => {
      expect(() => bridge.clearReminder('nonexistent')).not.toThrow();
    });

    it('clearAllReminders cancels all pending reminders', async () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task1 = makeMockTask({ id: 'task-1' });
      const task2 = makeMockTask({ id: 'task-2' });
      const config: TaskNotificationConfig = {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 15,
      };
      bridge.setTaskNotificationConfig('task-1', config);
      bridge.setTaskNotificationConfig('task-2', config);

      const nextRun = new Date('2024-01-01T11:00:00Z');
      bridge.scheduleReminder(task1, nextRun);
      bridge.scheduleReminder(task2, nextRun);

      bridge.clearAllReminders();

      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('replaces existing reminder when scheduling for the same task', async () => {
      const now = new Date('2024-01-01T10:00:00Z');
      vi.setSystemTime(now);

      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 5,
      });

      // First schedule: reminder at 10:55
      bridge.scheduleReminder(task, new Date('2024-01-01T11:00:00Z'));

      // Re-schedule: reminder at 11:55
      bridge.scheduleReminder(task, new Date('2024-01-01T12:00:00Z'));

      // Advance past original reminder time - should not fire
      await vi.advanceTimersByTimeAsync(56 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();

      // Advance to new reminder time
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // removeTaskNotificationConfig also clears reminder
  // ---------------------------------------------------------------------------

  describe('removeTaskNotificationConfig with reminder', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'));
    });

    afterEach(() => {
      bridge.clearAllReminders();
      vi.useRealTimers();
    });

    it('clears the associated reminder when config is removed', async () => {
      const task = makeMockTask();
      bridge.setTaskNotificationConfig(task.id, {
        triggers: ['reminder'],
        channels: ['telegram'],
        reminderMinutes: 15,
      });

      bridge.scheduleReminder(task, new Date('2024-01-01T11:00:00Z'));

      // Remove config (should also clear reminder)
      bridge.removeTaskNotificationConfig(task.id);

      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// calculateExecutionStats
// =============================================================================

describe('calculateExecutionStats', () => {
  it('calculates correct counts for completed/failed/pending', () => {
    const history = new Map<string, Array<{ status: 'completed' | 'failed' | 'pending'; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed', duration: 100 },
        { status: 'completed', duration: 200 },
        { status: 'failed', error: 'Timeout' },
      ]],
      ['t2', [
        { status: 'pending' },
        { status: 'completed', duration: 300 },
      ]],
    ]);
    const tasks = new Map([
      ['t1', { name: 'Task One' }],
      ['t2', { name: 'Task Two' }],
    ]);

    const stats = calculateExecutionStats(history, tasks);

    expect(stats.completed).toBe(3);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(5);
  });

  it('calculates correct success rate', () => {
    const history = new Map([
      ['t1', [
        { status: 'completed' as const, duration: 100 },
        { status: 'completed' as const, duration: 200 },
        { status: 'failed' as const, error: 'err' },
        { status: 'failed' as const, error: 'err' },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'Task' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.successRate).toBe(50); // 2 / 4 = 50%
  });

  it('returns 0 success rate when no executions', () => {
    const stats = calculateExecutionStats(new Map(), new Map());
    expect(stats.successRate).toBe(0);
    expect(stats.total).toBe(0);
  });

  it('calculates average duration correctly', () => {
    const history = new Map([
      ['t1', [
        { status: 'completed' as const, duration: 100 },
        { status: 'completed' as const, duration: 300 },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'Task' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(200); // (100 + 300) / 2
  });

  it('returns 0 average duration when no entries have duration', () => {
    const history = new Map([
      ['t1', [{ status: 'pending' as const }]],
    ]);
    const tasks = new Map([['t1', { name: 'Task' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(0);
  });

  it('computes topTasks sorted by execution count (max 5)', () => {
    const history = new Map([
      ['t1', [{ status: 'completed' as const }, { status: 'completed' as const }, { status: 'completed' as const }]],
      ['t2', [{ status: 'completed' as const }]],
      ['t3', [{ status: 'completed' as const }, { status: 'completed' as const }]],
    ]);
    const tasks = new Map([
      ['t1', { name: 'Alpha' }],
      ['t2', { name: 'Beta' }],
      ['t3', { name: 'Gamma' }],
    ]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topTasks).toHaveLength(3);
    expect(stats.topTasks[0]).toEqual({ name: 'Alpha', executions: 3 });
    expect(stats.topTasks[1]).toEqual({ name: 'Gamma', executions: 2 });
    expect(stats.topTasks[2]).toEqual({ name: 'Beta', executions: 1 });
  });

  it('falls back to taskId when task name is not found', () => {
    const history = new Map([
      ['t-unknown', [{ status: 'completed' as const }]],
    ]);
    const tasks = new Map<string, { name: string }>();

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topTasks[0].name).toBe('t-unknown');
  });

  it('computes topIssues sorted by frequency (max 3)', () => {
    const history = new Map([
      ['t1', [
        { status: 'failed' as const, error: 'Timeout' },
        { status: 'failed' as const, error: 'Timeout' },
        { status: 'failed' as const, error: 'Timeout' },
        { status: 'failed' as const, error: 'Auth error' },
        { status: 'failed' as const, error: 'Auth error' },
        { status: 'failed' as const, error: 'Network' },
        { status: 'failed' as const, error: 'Disk full' },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'Task' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topIssues).toHaveLength(3);
    expect(stats.topIssues[0]).toEqual({ error: 'Timeout', count: 3 });
    expect(stats.topIssues[1]).toEqual({ error: 'Auth error', count: 2 });
    // Third could be either 'Network' or 'Disk full' (both count=1)
    expect(stats.topIssues[2].count).toBe(1);
  });
});

// =============================================================================
// buildDailySummaryNotification
// =============================================================================

describe('buildDailySummaryNotification', () => {
  it('builds a daily summary with completed/failed/pending counts', () => {
    const stats: TaskExecutionStats = {
      total: 10,
      completed: 7,
      failed: 2,
      pending: 1,
      successRate: 70,
      averageDuration: 500,
      topTasks: [],
      topIssues: [],
    };

    const notification = buildDailySummaryNotification(stats, 'user-1');

    expect(notification.userId).toBe('user-1');
    expect(notification.channels).toEqual(['telegram']);
    expect(notification.priority).toBe('low');
    expect(notification.metadata).toEqual({ category: 'summary' });
    expect(notification.content.body).toContain('7');
    expect(notification.content.body).toContain('2');
    expect(notification.content.body).toContain('1');
  });

  it('includes top issues when present', () => {
    const stats: TaskExecutionStats = {
      total: 5,
      completed: 3,
      failed: 2,
      pending: 0,
      successRate: 60,
      averageDuration: 200,
      topTasks: [],
      topIssues: [
        { error: 'Timeout', count: 2 },
      ],
    };

    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('Timeout');
    expect(notification.content.body).toContain('2x');
  });

  it('omits top issues section when no issues exist', () => {
    const stats: TaskExecutionStats = {
      total: 5,
      completed: 5,
      failed: 0,
      pending: 0,
      successRate: 100,
      averageDuration: 200,
      topTasks: [],
      topIssues: [],
    };

    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.body).not.toContain('Top issues');
  });
});

// =============================================================================
// buildWeeklySummaryNotification
// =============================================================================

describe('buildWeeklySummaryNotification', () => {
  it('builds a weekly summary with counts, success rate, and top tasks', () => {
    const stats: TaskExecutionStats = {
      total: 50,
      completed: 45,
      failed: 5,
      pending: 0,
      successRate: 90,
      averageDuration: 1000,
      topTasks: [
        { name: 'Task A', executions: 20 },
        { name: 'Task B', executions: 15 },
      ],
      topIssues: [],
    };

    const notification = buildWeeklySummaryNotification(stats, 'user-1');

    expect(notification.userId).toBe('user-1');
    expect(notification.channels).toEqual(['telegram']);
    expect(notification.priority).toBe('low');
    expect(notification.metadata).toEqual({ category: 'summary' });
    expect(notification.content.body).toContain('45');
    expect(notification.content.body).toContain('5');
    expect(notification.content.body).toContain('90');
    expect(notification.content.body).toContain('Task A');
    expect(notification.content.body).toContain('20 runs');
    expect(notification.content.body).toContain('Task B');
  });

  it('shows "No tasks executed" when topTasks is empty', () => {
    const stats: TaskExecutionStats = {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      successRate: 0,
      averageDuration: 0,
      topTasks: [],
      topIssues: [],
    };

    const notification = buildWeeklySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('No tasks executed');
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('factory functions', () => {
  describe('createSchedulerNotificationBridge', () => {
    it('returns a SchedulerNotificationBridge instance', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const bridge = createSchedulerNotificationBridge(handler);
      expect(bridge).toBeInstanceOf(SchedulerNotificationBridge);
    });
  });

  describe('createDefaultTaskNotificationConfig', () => {
    it('returns config with on_complete and on_failure triggers', () => {
      const config = createDefaultTaskNotificationConfig();
      expect(config.triggers).toEqual(['on_complete', 'on_failure']);
      expect(config.includeResult).toBe(true);
      expect(config.includeDuration).toBe(true);
      expect(config.respectQuietHours).toBe(true);
    });

    it('defaults channels to telegram', () => {
      const config = createDefaultTaskNotificationConfig();
      expect(config.channels).toEqual(['telegram']);
    });

    it('accepts custom channels', () => {
      const config = createDefaultTaskNotificationConfig(['email', 'slack']);
      expect(config.channels).toEqual(['email', 'slack']);
    });
  });

  describe('createCriticalTaskNotificationConfig', () => {
    it('returns config with all triggers including reminder', () => {
      const config = createCriticalTaskNotificationConfig();
      expect(config.triggers).toEqual(['on_start', 'on_complete', 'on_failure', 'reminder']);
      expect(config.reminderMinutes).toBe(15);
      expect(config.respectQuietHours).toBe(false);
    });

    it('defaults channels to telegram and email', () => {
      const config = createCriticalTaskNotificationConfig();
      expect(config.channels).toEqual(['telegram', 'email']);
    });

    it('accepts custom channels', () => {
      const config = createCriticalTaskNotificationConfig(['slack']);
      expect(config.channels).toEqual(['slack']);
    });
  });

  describe('createSilentTaskNotificationConfig', () => {
    it('returns config with only on_failure trigger', () => {
      const config = createSilentTaskNotificationConfig();
      expect(config.triggers).toEqual(['on_failure']);
      expect(config.includeResult).toBe(false);
      expect(config.includeDuration).toBe(true);
      expect(config.respectQuietHours).toBe(true);
    });

    it('defaults channels to telegram', () => {
      const config = createSilentTaskNotificationConfig();
      expect(config.channels).toEqual(['telegram']);
    });

    it('accepts custom channels', () => {
      const config = createSilentTaskNotificationConfig(['webhook']);
      expect(config.channels).toEqual(['webhook']);
    });
  });
});

// =============================================================================
// SCHEDULER_NOTIFICATION_TEMPLATES
// =============================================================================

describe('SCHEDULER_NOTIFICATION_TEMPLATES', () => {
  it('exports taskStarted template', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskStarted).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskStarted.title).toContain('{{taskName}}');
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskStarted.body).toContain('{{taskName}}');
  });

  it('exports taskCompleted template with conditional blocks', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskCompleted).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskCompleted.body).toContain('{{#if duration}}');
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskCompleted.body).toContain('{{#if result}}');
  });

  it('exports taskFailed template with error conditional', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskFailed).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskFailed.body).toContain('{{#if error}}');
  });

  it('exports taskReminder template', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskReminder).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.taskReminder.body).toContain('{{reminderMinutes}}');
  });

  it('exports dailySummary template', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.dailySummary).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.dailySummary.body).toContain('{{completedCount}}');
  });

  it('exports weeklySummary template', () => {
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.weeklySummary).toBeDefined();
    expect(SCHEDULER_NOTIFICATION_TEMPLATES.weeklySummary.body).toContain('{{successRate}}');
  });
});

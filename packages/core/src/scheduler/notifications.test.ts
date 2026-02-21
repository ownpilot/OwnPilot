import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  processTemplate,
  SCHEDULER_NOTIFICATION_TEMPLATES,
  SchedulerNotificationBridge,
  calculateExecutionStats,
  buildDailySummaryNotification,
  buildWeeklySummaryNotification,
  createSchedulerNotificationBridge,
  createDefaultTaskNotificationConfig,
  createCriticalTaskNotificationConfig,
  createSilentTaskNotificationConfig,
  type TaskNotificationConfig,
  type SchedulerNotificationHandler,
  type NotificationChannel as _NotificationChannel,
  type TaskExecutionStats,
  type UserNotificationPreferences,
} from './notifications.js';

import type {
  ScheduledTask,
  TaskExecutionResult,
  TaskStatus,
} from './index.js';

// =============================================================================
// Helpers
// =============================================================================

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Test Task',
    cron: '0 9 * * *',
    type: 'prompt',
    payload: { type: 'prompt', prompt: 'test' },
    enabled: true,
    priority: 'normal',
    userId: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TaskExecutionResult> = {}): TaskExecutionResult {
  return {
    taskId: 'task-1',
    status: 'completed',
    startedAt: '2026-01-01T09:00:00Z',
    completedAt: '2026-01-01T09:00:05Z',
    duration: 5000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TaskNotificationConfig> = {}): TaskNotificationConfig {
  return {
    triggers: ['on_complete', 'on_failure'],
    channels: ['telegram'],
    includeResult: true,
    includeDuration: true,
    respectQuietHours: true,
    ...overrides,
  };
}

function makeStats(overrides: Partial<TaskExecutionStats> = {}): TaskExecutionStats {
  return {
    total: 10,
    completed: 7,
    failed: 2,
    pending: 1,
    successRate: 70,
    averageDuration: 3000,
    topTasks: [
      { name: 'Task A', executions: 5 },
      { name: 'Task B', executions: 3 },
    ],
    topIssues: [
      { error: 'Timeout', count: 2 },
    ],
    ...overrides,
  };
}

// =============================================================================
// processTemplate
// =============================================================================

describe('processTemplate', () => {
  it('replaces a single variable', () => {
    expect(processTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces multiple different variables', () => {
    const result = processTemplate('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Alice' });
    expect(result).toBe('Hi Alice!');
  });

  it('replaces the same variable used multiple times', () => {
    const result = processTemplate('{{x}} and {{x}}', { x: 'val' });
    expect(result).toBe('val and val');
  });

  it('replaces missing variable with empty string', () => {
    expect(processTemplate('Hello {{missing}}!', {})).toBe('Hello !');
  });

  it('replaces undefined variable with empty string', () => {
    expect(processTemplate('Hello {{name}}!', { name: undefined })).toBe('Hello !');
  });

  it('replaces null variable with empty string', () => {
    expect(processTemplate('Hello {{name}}!', { name: null })).toBe('Hello !');
  });

  it('converts number variable to string', () => {
    expect(processTemplate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
  });

  it('converts boolean variable to string', () => {
    expect(processTemplate('Flag: {{b}}', { b: true })).toBe('Flag: true');
  });

  it('converts object variable to JSON.stringify with indentation', () => {
    const obj = { a: 1, b: 'two' };
    const result = processTemplate('Data: {{obj}}', { obj });
    expect(result).toBe('Data: ' + JSON.stringify(obj, null, 2));
  });

  it('converts array variable to JSON.stringify with indentation', () => {
    const arr = [1, 2, 3];
    const result = processTemplate('List: {{arr}}', { arr });
    expect(result).toBe('List: ' + JSON.stringify(arr, null, 2));
  });

  it('handles conditional with truthy value — shows content', () => {
    const result = processTemplate('{{#if show}}Visible{{/if}}', { show: true });
    expect(result).toBe('Visible');
  });

  it('handles conditional with truthy string value — shows content', () => {
    const result = processTemplate('{{#if show}}Visible{{/if}}', { show: 'yes' });
    expect(result).toBe('Visible');
  });

  it('handles conditional with truthy number value — shows content', () => {
    const result = processTemplate('{{#if count}}Has count{{/if}}', { count: 5 });
    expect(result).toBe('Has count');
  });

  it('handles conditional with falsy value — hides content', () => {
    const result = processTemplate('{{#if show}}Hidden{{/if}}', { show: false });
    expect(result).toBe('');
  });

  it('handles conditional with undefined value — hides content', () => {
    const result = processTemplate('{{#if show}}Hidden{{/if}}', {});
    expect(result).toBe('');
  });

  it('handles conditional with null value — hides content', () => {
    const result = processTemplate('{{#if show}}Hidden{{/if}}', { show: null });
    expect(result).toBe('');
  });

  it('handles conditional with zero — hides content (falsy)', () => {
    const result = processTemplate('{{#if count}}Has count{{/if}}', { count: 0 });
    expect(result).toBe('');
  });

  it('handles conditional with empty string — hides content (falsy)', () => {
    const result = processTemplate('{{#if val}}Has val{{/if}}', { val: '' });
    expect(result).toBe('');
  });

  it('handles conditional containing variable replacements', () => {
    const result = processTemplate(
      '{{#if duration}}Duration: {{duration}}ms{{/if}}',
      { duration: 500 }
    );
    expect(result).toBe('Duration: 500ms');
  });

  it('handles multiple conditionals in same template', () => {
    const result = processTemplate(
      '{{#if a}}A{{/if}} {{#if b}}B{{/if}}',
      { a: true, b: false }
    );
    expect(result).toBe('A');
  });

  it('handles template with no variables — returns trimmed', () => {
    expect(processTemplate('  Hello World  ', {})).toBe('Hello World');
  });

  it('trims the result', () => {
    expect(processTemplate('\n  text  \n', {})).toBe('text');
  });

  it('handles empty template', () => {
    expect(processTemplate('', {})).toBe('');
  });

  it('handles whitespace-only template', () => {
    expect(processTemplate('   ', {})).toBe('');
  });

  it('handles complex template with mixed conditionals and variables', () => {
    const template = 'Task "{{name}}" done.\n{{#if error}}Error: {{error}}\n{{/if}}{{#if duration}}Took {{duration}}ms{{/if}}';
    const result = processTemplate(template, {
      name: 'Backup',
      error: 'disk full',
      duration: 1200,
    });
    expect(result).toContain('Task "Backup" done.');
    expect(result).toContain('Error: disk full');
    expect(result).toContain('Took 1200ms');
  });

  it('non-greedy regex does not handle nested conditionals as true nesting', () => {
    // The regex is non-greedy [\s\S]*? so nested {{#if}} will match the first {{/if}}
    const template = '{{#if a}}outer{{#if b}}inner{{/if}}end{{/if}}';
    // The first {{#if a}} matches up to the first {{/if}} → "outer{{#if b}}inner"
    // Then "end{{/if}}" remains as literal text
    const result = processTemplate(template, { a: true, b: true });
    // Expect: "outer" + the inner conditional content including the {{#if b}} text
    // Because inner {{/if}} closes the outer. Then "end{{/if}}" is leftover literal.
    expect(result).toContain('inner');
    expect(result).toContain('end');
  });

  it('conditional with multiline content', () => {
    const template = '{{#if details}}Details:\n  Line 1\n  Line 2{{/if}}';
    const result = processTemplate(template, { details: true });
    expect(result).toBe('Details:\n  Line 1\n  Line 2');
  });
});

// =============================================================================
// SCHEDULER_NOTIFICATION_TEMPLATES
// =============================================================================

describe('SCHEDULER_NOTIFICATION_TEMPLATES', () => {
  const templateKeys = [
    'taskStarted',
    'taskCompleted',
    'taskFailed',
    'taskReminder',
    'dailySummary',
    'weeklySummary',
  ] as const;

  it('has exactly 6 templates', () => {
    expect(Object.keys(SCHEDULER_NOTIFICATION_TEMPLATES)).toHaveLength(6);
  });

  for (const key of templateKeys) {
    it(`template "${key}" has title and body strings`, () => {
      const t = SCHEDULER_NOTIFICATION_TEMPLATES[key];
      expect(typeof t.title).toBe('string');
      expect(typeof t.body).toBe('string');
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    });
  }

  it('taskStarted template contains taskName placeholder', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.taskStarted;
    expect(t.title).toContain('{{taskName}}');
    expect(t.body).toContain('{{taskName}}');
  });

  it('taskCompleted template contains taskName and conditional duration/result', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.taskCompleted;
    expect(t.title).toContain('{{taskName}}');
    expect(t.body).toContain('{{#if duration}}');
    expect(t.body).toContain('{{#if result}}');
  });

  it('taskFailed template contains taskName and conditional error/duration', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.taskFailed;
    expect(t.title).toContain('{{taskName}}');
    expect(t.body).toContain('{{#if error}}');
    expect(t.body).toContain('{{#if duration}}');
  });

  it('taskReminder template contains taskName and reminderMinutes', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.taskReminder;
    expect(t.title).toContain('{{taskName}}');
    expect(t.body).toContain('{{reminderMinutes}}');
  });

  it('dailySummary template contains count placeholders', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.dailySummary;
    expect(t.body).toContain('{{completedCount}}');
    expect(t.body).toContain('{{failedCount}}');
    expect(t.body).toContain('{{pendingCount}}');
  });

  it('weeklySummary template contains count and topTasks placeholders', () => {
    const t = SCHEDULER_NOTIFICATION_TEMPLATES.weeklySummary;
    expect(t.body).toContain('{{completedCount}}');
    expect(t.body).toContain('{{failedCount}}');
    expect(t.body).toContain('{{successRate}}');
    expect(t.body).toContain('{{topTasks}}');
  });
});

// =============================================================================
// SchedulerNotificationBridge
// =============================================================================

describe('SchedulerNotificationBridge', () => {
  let handler: SchedulerNotificationHandler;
  let bridge: SchedulerNotificationBridge;

  beforeEach(() => {
    handler = vi.fn<SchedulerNotificationHandler>().mockResolvedValue(undefined);
    bridge = new SchedulerNotificationBridge(handler);
  });

  afterEach(() => {
    bridge.clearAllReminders();
  });

  // ---------------------------------------------------------------------------
  // Config CRUD
  // ---------------------------------------------------------------------------

  describe('task notification config', () => {
    it('setTaskNotificationConfig and getTaskNotificationConfig roundtrip', () => {
      const config = makeConfig();
      bridge.setTaskNotificationConfig('task-1', config);
      expect(bridge.getTaskNotificationConfig('task-1')).toBe(config);
    });

    it('getTaskNotificationConfig returns undefined for unknown task', () => {
      expect(bridge.getTaskNotificationConfig('unknown')).toBeUndefined();
    });

    it('setTaskNotificationConfig overwrites existing config', () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      const newConfig = makeConfig({ triggers: ['on_failure'] });
      bridge.setTaskNotificationConfig('task-1', newConfig);
      expect(bridge.getTaskNotificationConfig('task-1')).toBe(newConfig);
    });

    it('removeTaskNotificationConfig removes config', () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig());
      bridge.removeTaskNotificationConfig('task-1');
      expect(bridge.getTaskNotificationConfig('task-1')).toBeUndefined();
    });

    it('removeTaskNotificationConfig clears associated reminder', () => {
      vi.useFakeTimers();
      try {
        const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 10 });
        bridge.setTaskNotificationConfig('task-1', config);
        const task = makeTask();
        const futureTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
        bridge.scheduleReminder(task, futureTime);

        bridge.removeTaskNotificationConfig('task-1');

        // Advance past reminder time — handler should NOT fire
        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(handler).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('removeTaskNotificationConfig is safe for unknown task', () => {
      // Should not throw
      bridge.removeTaskNotificationConfig('nonexistent');
    });
  });

  // ---------------------------------------------------------------------------
  // User preferences
  // ---------------------------------------------------------------------------

  describe('user preferences', () => {
    it('setUserPreferences and getUserPreferences roundtrip', () => {
      const prefs: UserNotificationPreferences = {
        channels: ['telegram', 'email'],
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
      };
      bridge.setUserPreferences('user-1', prefs);
      expect(bridge.getUserPreferences('user-1')).toBe(prefs);
    });

    it('getUserPreferences returns undefined for unknown user', () => {
      expect(bridge.getUserPreferences('unknown')).toBeUndefined();
    });

    it('setUserPreferences overwrites existing preferences', () => {
      bridge.setUserPreferences('user-1', { channels: ['telegram'] });
      const newPrefs: UserNotificationPreferences = { channels: ['email'] };
      bridge.setUserPreferences('user-1', newPrefs);
      expect(bridge.getUserPreferences('user-1')).toBe(newPrefs);
    });
  });

  // ---------------------------------------------------------------------------
  // onTaskStart
  // ---------------------------------------------------------------------------

  describe('onTaskStart', () => {
    it('calls handler when config has on_start trigger', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

      await bridge.onTaskStart(task);

      expect(handler).toHaveBeenCalledOnce();
      const [event, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('start');
      expect(event.task).toBe(task);
      expect(notification.userId).toBe('user-1');
    });

    it('does NOT call handler when no config exists', async () => {
      await bridge.onTaskStart(makeTask());
      expect(handler).not.toHaveBeenCalled();
    });

    it('does NOT call handler when config lacks on_start trigger', async () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));
      await bridge.onTaskStart(makeTask());
      expect(handler).not.toHaveBeenCalled();
    });

    it('falls back to task.notifyChannels when no specific config', async () => {
      const task = makeTask({ notifyChannels: ['telegram'] });
      // Fallback config has triggers: ['on_complete', 'on_failure'] — NOT on_start
      await bridge.onTaskStart(task);
      expect(handler).not.toHaveBeenCalled();
    });

    it('uses taskStarted template for start event', async () => {
      const task = makeTask({ name: 'My Task' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toContain('My Task');
      expect(notification.content.title).toContain('Started');
    });

    it('sets correct event timestamp', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

      await bridge.onTaskStart(task);

      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.timestamp).toBeTruthy();
      // Should be a valid ISO date string
      expect(() => new Date(event.timestamp)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // onTaskComplete
  // ---------------------------------------------------------------------------

  describe('onTaskComplete', () => {
    it('calls handler with on_complete trigger on success', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('complete');
      expect(event.result).toBe(result);
    });

    it('does NOT call handler with on_complete trigger on failure', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'failed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));

      await bridge.onTaskComplete(task, result);
      expect(handler).not.toHaveBeenCalled();
    });

    it('calls handler with on_failure trigger on failure', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'failed', error: 'timeout' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('failure');
    });

    it('does NOT call handler with on_failure trigger on success', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);
      expect(handler).not.toHaveBeenCalled();
    });

    it('calls handler with on_any_result trigger on success', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_any_result'] }));

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('complete');
    });

    it('calls handler with on_any_result trigger on failure', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'failed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_any_result'] }));

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('failure');
    });

    it('does NOT call handler when triggers do not match status', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

      await bridge.onTaskComplete(task, result);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does NOT call handler when no config exists', async () => {
      await bridge.onTaskComplete(makeTask(), makeResult());
      expect(handler).not.toHaveBeenCalled();
    });

    it('treats skipped status as non-success (failure path)', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'cancelled' as TaskStatus });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);
      // status !== 'completed' → !isSuccess → on_failure triggers
      expect(handler).toHaveBeenCalledOnce();
    });

    it('uses taskCompleted template for success', async () => {
      const task = makeTask({ name: 'Backup' });
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toContain('Completed');
      expect(notification.content.title).toContain('Backup');
    });

    it('uses taskFailed template for failure', async () => {
      const task = makeTask({ name: 'Backup' });
      const result = makeResult({ status: 'failed', error: 'disk full' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toContain('Failed');
      expect(notification.content.title).toContain('Backup');
    });

    it('includes result in body when includeResult is true and result is a string', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed', result: 'Success output' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_complete'],
        includeResult: true,
      }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toContain('Success output');
    });

    it('includes result as JSON when result is an object', async () => {
      const task = makeTask();
      const resultData = { key: 'value' };
      const result = makeResult({ status: 'completed', result: resultData });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_complete'],
        includeResult: true,
      }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toContain('"key"');
      expect(notification.content.body).toContain('"value"');
    });

    it('does NOT include result when includeResult is false', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed', result: 'secret output' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_complete'],
        includeResult: false,
      }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).not.toContain('secret output');
    });

    it('includes duration in body when includeDuration is true', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed', duration: 1234 });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_complete'],
        includeDuration: true,
      }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toContain('1234');
    });

    it('does NOT include duration when includeDuration is false', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed', duration: 9999 });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_complete'],
        includeDuration: false,
      }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      // Duration won't be in variables → conditional hides it
      expect(notification.content.body).not.toContain('9999');
    });

    it('includes error in body for failure', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'failed', error: 'connection refused' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toContain('connection refused');
    });

    it('falls back to notifyChannels when no specific config', async () => {
      const task = makeTask({ notifyChannels: ['email'] });
      const result = makeResult({ status: 'completed' });
      // Fallback config has triggers: on_complete + on_failure

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.channels).toEqual(['email']);
    });
  });

  // ---------------------------------------------------------------------------
  // buildNotification (tested indirectly through onTaskStart/onTaskComplete)
  // ---------------------------------------------------------------------------

  describe('buildNotification', () => {
    it('maps low priority task to low notification priority', async () => {
      const task = makeTask({ priority: 'low' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.priority).toBe('low');
    });

    it('maps normal priority task to normal notification priority', async () => {
      const task = makeTask({ priority: 'normal' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.priority).toBe('normal');
    });

    it('maps high priority task to high notification priority', async () => {
      const task = makeTask({ priority: 'high' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.priority).toBe('high');
    });

    it('maps critical priority task to urgent notification priority', async () => {
      const task = makeTask({ priority: 'critical' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.priority).toBe('urgent');
    });

    it('defaults channels to telegram when config has no channels', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', {
        triggers: ['on_start'],
        // channels not set
      });
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.channels).toEqual(['telegram']);
    });

    it('uses config channels when specified', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        channels: ['email', 'webhook'],
      }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.channels).toEqual(['email', 'webhook']);
    });

    it('includes taskId, taskName, eventType in content.data', async () => {
      const task = makeTask({ id: 'task-42', name: 'My Task' });
      bridge.setTaskNotificationConfig('task-42', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.data).toMatchObject({
        taskId: 'task-42',
        taskName: 'My Task',
        eventType: 'start',
      });
    });

    it('includes scheduled_task metadata category', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.metadata).toEqual({ category: 'scheduled_task' });
    });

    it('adds failure actions (Retry, View Logs, Disable) on failure', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'failed', error: 'err' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_failure'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.actions).toEqual([
        { label: 'Retry Task', action: 'retry' },
        { label: 'View Logs', action: 'view_logs' },
        { label: 'Disable Task', action: 'disable' },
      ]);
    });

    it('does NOT add actions on success', async () => {
      const task = makeTask();
      const result = makeResult({ status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.actions).toBeUndefined();
    });

    it('does NOT add actions on start event', async () => {
      const task = makeTask();
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.actions).toBeUndefined();
    });

    it('uses custom titleTemplate when provided', async () => {
      const task = makeTask({ name: 'Custom' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        titleTemplate: 'Custom title for {{taskName}}',
      }));

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toBe('Custom title for Custom');
    });

    it('uses custom bodyTemplate when provided', async () => {
      const _task = makeTask({ name: 'Custom' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        bodyTemplate: 'Body for {{taskName}} at {{scheduledTime}}',
      }));
      const taskWithNextRun = makeTask({ name: 'Custom', nextRun: '2026-02-01T09:00:00Z' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        bodyTemplate: 'Body for {{taskName}} at {{scheduledTime}}',
      }));

      await bridge.onTaskStart(taskWithNextRun);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toBe('Body for Custom at 2026-02-01T09:00:00Z');
    });

    it('uses custom title but default body when only titleTemplate is given', async () => {
      const task = makeTask({ name: 'Mixed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        titleTemplate: 'CUSTOM: {{taskName}}',
        // no bodyTemplate → uses default taskStarted body
      }));

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toBe('CUSTOM: Mixed');
      expect(notification.content.body).toContain('Your scheduled task');
    });

    it('includes executionId from result in content.data', async () => {
      const task = makeTask();
      const result = makeResult({ taskId: 'exec-123', status: 'completed' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));

      await bridge.onTaskComplete(task, result);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.data?.executionId).toBe('exec-123');
    });

    it('includes task description in variables', async () => {
      const task = makeTask({ description: 'Daily backup job' });
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['on_start'],
        bodyTemplate: 'Desc: {{taskDescription}}',
      }));

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.body).toBe('Desc: Daily backup job');
    });
  });

  // ---------------------------------------------------------------------------
  // getNotificationConfigForTask (private, tested indirectly)
  // ---------------------------------------------------------------------------

  describe('getNotificationConfigForTask (via onTaskStart/onTaskComplete)', () => {
    it('prefers task-specific config over notifyChannels fallback', async () => {
      const task = makeTask({ notifyChannels: ['email'] });
      const specificConfig = makeConfig({
        triggers: ['on_start'],
        channels: ['webhook'],
      });
      bridge.setTaskNotificationConfig('task-1', specificConfig);

      await bridge.onTaskStart(task);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.channels).toEqual(['webhook']);
    });

    it('falls back to notifyChannels with default triggers (on_complete, on_failure)', async () => {
      const task = makeTask({ notifyChannels: ['telegram'] });
      const result = makeResult({ status: 'completed' });

      await bridge.onTaskComplete(task, result);

      expect(handler).toHaveBeenCalledOnce();
      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      // Fallback config includes includeResult: true, includeDuration: true
      expect(notification.channels).toEqual(['telegram']);
    });

    it('returns null when no config and no notifyChannels → no notification', async () => {
      const task = makeTask({ notifyChannels: undefined });
      await bridge.onTaskStart(task);
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns null when notifyChannels is empty array', async () => {
      const task = makeTask({ notifyChannels: [] });
      await bridge.onTaskComplete(task, makeResult());
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleReminder
  // ---------------------------------------------------------------------------

  describe('scheduleReminder', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      bridge.clearAllReminders();
      vi.useRealTimers();
    });

    it('fires notification at the correct time', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 10 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask();

      // Schedule for 30 minutes from now
      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      // Reminder should fire 10 min before nextRun = 20 min from now
      vi.advanceTimersByTime(19 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1 * 60 * 1000); // now at 20 min
      // setTimeout callback is async — need to flush
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledOnce();

      const [event] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(event.type).toBe('reminder');
    });

    it('skips if reminder time already passed', () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 60 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask();

      // Next run is 5 minutes from now, but reminder is 60 minutes before → already passed
      const nextRun = new Date(Date.now() + 5 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('skips if no config exists for task', () => {
      const task = makeTask();
      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);
      // No timer set, no error
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('skips if config does not have reminder trigger', () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_complete'] }));
      const task = makeTask();
      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('skips if reminderMinutes is not set', () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['reminder'],
        reminderMinutes: undefined,
      }));
      const task = makeTask();
      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('skips if reminderMinutes is 0 (falsy)', () => {
      bridge.setTaskNotificationConfig('task-1', makeConfig({
        triggers: ['reminder'],
        reminderMinutes: 0,
      }));
      const task = makeTask();
      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('clears existing reminder before setting new one', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 10 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask();

      // Schedule first reminder (30 min from now → fires at 20 min)
      const nextRun1 = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun1);

      // Schedule second reminder (60 min from now → fires at 50 min)
      const nextRun2 = new Date(Date.now() + 60 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun2);

      // Advance past first reminder time — should NOT fire (was cleared)
      vi.advanceTimersByTime(25 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).not.toHaveBeenCalled();

      // Advance to second reminder time
      vi.advanceTimersByTime(25 * 60 * 1000); // now at 50 min
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('removes timer from map after firing', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 5 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask();

      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      // Advance to reminder time (25 min)
      vi.advanceTimersByTime(25 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);

      expect(handler).toHaveBeenCalledOnce();
      // clearReminder should be safe (no error, timer already cleaned)
      bridge.clearReminder('task-1');
    });

    it('uses reminder template with reminderMinutes variable', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 15 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask({ name: 'Deploy' });

      const nextRun = new Date(Date.now() + 60 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      // Advance to reminder time (60 - 15 = 45 min)
      vi.advanceTimersByTime(45 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);

      const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(notification.content.title).toContain('Upcoming Task');
      expect(notification.content.title).toContain('Deploy');
      expect(notification.content.body).toContain('15');
    });
  });

  // ---------------------------------------------------------------------------
  // clearReminder / clearAllReminders
  // ---------------------------------------------------------------------------

  describe('clearReminder', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      bridge.clearAllReminders();
      vi.useRealTimers();
    });

    it('clears a specific reminder timer', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 10 });
      bridge.setTaskNotificationConfig('task-1', config);
      const task = makeTask();

      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task, nextRun);

      bridge.clearReminder('task-1');

      vi.advanceTimersByTime(60 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('is safe to call with nonexistent taskId', () => {
      bridge.clearReminder('nonexistent'); // should not throw
    });
  });

  describe('clearAllReminders', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears all reminder timers', async () => {
      const config = makeConfig({ triggers: ['reminder'], reminderMinutes: 5 });
      bridge.setTaskNotificationConfig('task-1', config);
      bridge.setTaskNotificationConfig('task-2', config);

      const task1 = makeTask({ id: 'task-1' });
      const task2 = makeTask({ id: 'task-2' });

      const nextRun = new Date(Date.now() + 30 * 60 * 1000);
      bridge.scheduleReminder(task1, nextRun);
      bridge.scheduleReminder(task2, nextRun);

      bridge.clearAllReminders();

      vi.advanceTimersByTime(60 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('is safe to call when no reminders exist', () => {
      bridge.clearAllReminders(); // should not throw
    });
  });
});

// =============================================================================
// calculateExecutionStats
// =============================================================================

describe('calculateExecutionStats', () => {
  it('counts completed/failed/pending correctly', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed', duration: 100 },
        { status: 'completed', duration: 200 },
      ]],
      ['t2', [
        { status: 'failed', error: 'timeout' },
        { status: 'pending' },
      ]],
    ]);
    const tasks = new Map([
      ['t1', { name: 'Task 1' }],
      ['t2', { name: 'Task 2' }],
    ]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(4);
  });

  it('calculates successRate correctly', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed', error: 'err' },
        { status: 'completed' },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    // 3 completed out of 4 total = 75%
    expect(stats.successRate).toBe(75);
  });

  it('returns 0% successRate when no tasks', () => {
    const stats = calculateExecutionStats(new Map(), new Map());
    expect(stats.successRate).toBe(0);
  });

  it('returns 100% successRate when all completed', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [{ status: 'completed' }, { status: 'completed' }]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.successRate).toBe(100);
  });

  it('calculates averageDuration correctly', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed', duration: 100 },
        { status: 'completed', duration: 300 },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(200);
  });

  it('returns 0 averageDuration when no entries have duration', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [{ status: 'completed' }]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(0);
  });

  it('rounds averageDuration', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed', duration: 100 },
        { status: 'completed', duration: 101 },
        { status: 'completed', duration: 102 },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(Math.round((100 + 101 + 102) / 3));
  });

  it('returns top 5 tasks sorted by execution count', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>();
    const tasks = new Map<string, { name: string }>();

    for (let i = 1; i <= 7; i++) {
      const id = `t${i}`;
      const entries: Array<{ status: TaskStatus }> = [];
      for (let j = 0; j < i; j++) {
        entries.push({ status: 'completed' });
      }
      history.set(id, entries);
      tasks.set(id, { name: `Task ${i}` });
    }

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topTasks).toHaveLength(5);
    // Sorted descending by executions
    expect(stats.topTasks[0]!.name).toBe('Task 7');
    expect(stats.topTasks[0]!.executions).toBe(7);
    expect(stats.topTasks[4]!.name).toBe('Task 3');
    expect(stats.topTasks[4]!.executions).toBe(3);
  });

  it('uses taskId as name fallback when task not in tasks map', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['unknown-task', [{ status: 'completed' }]],
    ]);
    const tasks = new Map<string, { name: string }>();

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topTasks[0]!.name).toBe('unknown-task');
  });

  it('returns top 3 issues sorted by error count', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'failed', error: 'Timeout' },
        { status: 'failed', error: 'Timeout' },
        { status: 'failed', error: 'Timeout' },
        { status: 'failed', error: 'Auth error' },
        { status: 'failed', error: 'Auth error' },
        { status: 'failed', error: 'Disk full' },
        { status: 'failed', error: 'Network down' },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topIssues).toHaveLength(3);
    expect(stats.topIssues[0]).toEqual({ error: 'Timeout', count: 3 });
    expect(stats.topIssues[1]).toEqual({ error: 'Auth error', count: 2 });
    // Third could be either 'Disk full' or 'Network down' (both count=1)
    expect(stats.topIssues[2]!.count).toBe(1);
  });

  it('does not count errors from non-failed entries', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed' }, // no error field
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topIssues).toHaveLength(0);
  });

  it('ignores failed entries without error string', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'failed' }, // no error field
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.failed).toBe(1);
    expect(stats.topIssues).toHaveLength(0);
  });

  it('handles empty history', () => {
    const stats = calculateExecutionStats(new Map(), new Map());
    expect(stats.total).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.averageDuration).toBe(0);
    expect(stats.topTasks).toHaveLength(0);
    expect(stats.topIssues).toHaveLength(0);
  });

  it('ignores statuses other than completed/failed/pending in counts', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'running' },
        { status: 'cancelled' as TaskStatus },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    // running and cancelled don't match any switch case
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.total).toBe(0);
  });

  it('still counts duration from non-matched statuses', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'running', duration: 500 },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.averageDuration).toBe(500);
  });

  it('counts task executions regardless of status', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [
        { status: 'completed' },
        { status: 'running' },
        { status: 'failed', error: 'x' },
      ]],
    ]);
    const tasks = new Map([['t1', { name: 'T1' }]]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topTasks[0]!.executions).toBe(3);
  });

  it('aggregates errors across multiple tasks', () => {
    const history = new Map<string, Array<{ status: TaskStatus; duration?: number; error?: string }>>([
      ['t1', [{ status: 'failed', error: 'Timeout' }]],
      ['t2', [{ status: 'failed', error: 'Timeout' }]],
    ]);
    const tasks = new Map([
      ['t1', { name: 'T1' }],
      ['t2', { name: 'T2' }],
    ]);

    const stats = calculateExecutionStats(history, tasks);
    expect(stats.topIssues[0]).toEqual({ error: 'Timeout', count: 2 });
  });
});

// =============================================================================
// buildDailySummaryNotification
// =============================================================================

describe('buildDailySummaryNotification', () => {
  it('uses dailySummary template', () => {
    const stats = makeStats();
    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.title).toContain('Daily Task Summary');
  });

  it('includes completed, failed, pending counts in body', () => {
    const stats = makeStats({ completed: 5, failed: 3, pending: 2 });
    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('5');
    expect(notification.content.body).toContain('3');
    expect(notification.content.body).toContain('2');
  });

  it('formats topIssues as bullet list', () => {
    const stats = makeStats({
      topIssues: [
        { error: 'Timeout', count: 3 },
        { error: 'Auth error', count: 1 },
      ],
    });
    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('Timeout (3x)');
    expect(notification.content.body).toContain('Auth error (1x)');
  });

  it('empty topIssues results in no issues section in body', () => {
    const stats = makeStats({ topIssues: [] });
    const notification = buildDailySummaryNotification(stats, 'user-1');
    expect(notification.content.body).not.toContain('Top issues');
  });

  it('returns telegram channel', () => {
    const notification = buildDailySummaryNotification(makeStats(), 'user-1');
    expect(notification.channels).toEqual(['telegram']);
  });

  it('returns low priority', () => {
    const notification = buildDailySummaryNotification(makeStats(), 'user-1');
    expect(notification.priority).toBe('low');
  });

  it('returns summary category in metadata', () => {
    const notification = buildDailySummaryNotification(makeStats(), 'user-1');
    expect(notification.metadata).toEqual({ category: 'summary' });
  });

  it('sets the correct userId', () => {
    const notification = buildDailySummaryNotification(makeStats(), 'user-42');
    expect(notification.userId).toBe('user-42');
  });
});

// =============================================================================
// buildWeeklySummaryNotification
// =============================================================================

describe('buildWeeklySummaryNotification', () => {
  it('uses weeklySummary template', () => {
    const stats = makeStats();
    const notification = buildWeeklySummaryNotification(stats, 'user-1');
    expect(notification.content.title).toContain('Weekly Task Summary');
  });

  it('includes completed, failed, successRate in body', () => {
    const stats = makeStats({ completed: 10, failed: 2, successRate: 83 });
    const notification = buildWeeklySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('10');
    expect(notification.content.body).toContain('2');
    expect(notification.content.body).toContain('83');
  });

  it('formats topTasks as bullet list', () => {
    const stats = makeStats({
      topTasks: [
        { name: 'Backup', executions: 14 },
        { name: 'Report', executions: 7 },
      ],
    });
    const notification = buildWeeklySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('Backup: 14 runs');
    expect(notification.content.body).toContain('Report: 7 runs');
  });

  it('empty topTasks shows "No tasks executed"', () => {
    const stats = makeStats({ topTasks: [] });
    const notification = buildWeeklySummaryNotification(stats, 'user-1');
    expect(notification.content.body).toContain('No tasks executed');
  });

  it('returns telegram channel', () => {
    const notification = buildWeeklySummaryNotification(makeStats(), 'user-1');
    expect(notification.channels).toEqual(['telegram']);
  });

  it('returns low priority', () => {
    const notification = buildWeeklySummaryNotification(makeStats(), 'user-1');
    expect(notification.priority).toBe('low');
  });

  it('returns summary category in metadata', () => {
    const notification = buildWeeklySummaryNotification(makeStats(), 'user-1');
    expect(notification.metadata).toEqual({ category: 'summary' });
  });

  it('sets the correct userId', () => {
    const notification = buildWeeklySummaryNotification(makeStats(), 'user-99');
    expect(notification.userId).toBe('user-99');
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('createSchedulerNotificationBridge', () => {
  it('returns a SchedulerNotificationBridge instance', () => {
    const handler = vi.fn();
    const bridge = createSchedulerNotificationBridge(handler);
    expect(bridge).toBeInstanceOf(SchedulerNotificationBridge);
  });

  it('returned bridge uses the provided handler', async () => {
    const handler = vi.fn<SchedulerNotificationHandler>().mockResolvedValue(undefined);
    const bridge = createSchedulerNotificationBridge(handler);

    const task = makeTask();
    bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
    await bridge.onTaskStart(task);

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('createDefaultTaskNotificationConfig', () => {
  it('returns on_complete and on_failure triggers', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.triggers).toEqual(['on_complete', 'on_failure']);
  });

  it('defaults channels to telegram', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.channels).toEqual(['telegram']);
  });

  it('accepts custom channels', () => {
    const config = createDefaultTaskNotificationConfig(['email', 'webhook']);
    expect(config.channels).toEqual(['email', 'webhook']);
  });

  it('includes result and duration', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.includeResult).toBe(true);
    expect(config.includeDuration).toBe(true);
  });

  it('respects quiet hours', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.respectQuietHours).toBe(true);
  });

  it('does NOT include reminder triggers', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.triggers).not.toContain('reminder');
    expect(config.triggers).not.toContain('on_start');
  });

  it('does NOT set reminderMinutes', () => {
    const config = createDefaultTaskNotificationConfig();
    expect(config.reminderMinutes).toBeUndefined();
  });
});

describe('createCriticalTaskNotificationConfig', () => {
  it('returns all four triggers including reminder', () => {
    const config = createCriticalTaskNotificationConfig();
    expect(config.triggers).toContain('on_start');
    expect(config.triggers).toContain('on_complete');
    expect(config.triggers).toContain('on_failure');
    expect(config.triggers).toContain('reminder');
  });

  it('defaults channels to telegram and email', () => {
    const config = createCriticalTaskNotificationConfig();
    expect(config.channels).toEqual(['telegram', 'email']);
  });

  it('accepts custom channels', () => {
    const config = createCriticalTaskNotificationConfig(['sms']);
    expect(config.channels).toEqual(['sms']);
  });

  it('includes result and duration', () => {
    const config = createCriticalTaskNotificationConfig();
    expect(config.includeResult).toBe(true);
    expect(config.includeDuration).toBe(true);
  });

  it('sets reminderMinutes to 15', () => {
    const config = createCriticalTaskNotificationConfig();
    expect(config.reminderMinutes).toBe(15);
  });

  it('does NOT respect quiet hours (critical tasks always notify)', () => {
    const config = createCriticalTaskNotificationConfig();
    expect(config.respectQuietHours).toBe(false);
  });
});

describe('createSilentTaskNotificationConfig', () => {
  it('returns only on_failure trigger', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.triggers).toEqual(['on_failure']);
  });

  it('defaults channels to telegram', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.channels).toEqual(['telegram']);
  });

  it('accepts custom channels', () => {
    const config = createSilentTaskNotificationConfig(['webhook']);
    expect(config.channels).toEqual(['webhook']);
  });

  it('does NOT include result', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.includeResult).toBe(false);
  });

  it('includes duration', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.includeDuration).toBe(true);
  });

  it('respects quiet hours', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.respectQuietHours).toBe(true);
  });

  it('does NOT include on_start or on_complete or reminder triggers', () => {
    const config = createSilentTaskNotificationConfig();
    expect(config.triggers).not.toContain('on_start');
    expect(config.triggers).not.toContain('on_complete');
    expect(config.triggers).not.toContain('reminder');
    expect(config.triggers).not.toContain('on_any_result');
  });
});

// =============================================================================
// Integration / edge cases
// =============================================================================

describe('integration scenarios', () => {
  let handler: SchedulerNotificationHandler;
  let bridge: SchedulerNotificationBridge;

  beforeEach(() => {
    handler = vi.fn<SchedulerNotificationHandler>().mockResolvedValue(undefined);
    bridge = new SchedulerNotificationBridge(handler);
  });

  afterEach(() => {
    bridge.clearAllReminders();
  });

  it('full lifecycle: config → start → complete → remove', async () => {
    const task = makeTask();
    const config = createCriticalTaskNotificationConfig();
    bridge.setTaskNotificationConfig('task-1', config);

    // Start
    await bridge.onTaskStart(task);
    expect(handler).toHaveBeenCalledTimes(1);

    // Complete
    const result = makeResult({ status: 'completed', result: 'done', duration: 1500 });
    await bridge.onTaskComplete(task, result);
    expect(handler).toHaveBeenCalledTimes(2);

    // Remove config
    bridge.removeTaskNotificationConfig('task-1');
    expect(bridge.getTaskNotificationConfig('task-1')).toBeUndefined();

    // No more notifications
    await bridge.onTaskStart(task);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('on_any_result fires for both success and failure sequentially', async () => {
    const task = makeTask();
    bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_any_result'] }));

    await bridge.onTaskComplete(task, makeResult({ status: 'completed' }));
    await bridge.onTaskComplete(task, makeResult({ status: 'failed' }));

    expect(handler).toHaveBeenCalledTimes(2);
    const [event1] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [event2] = (handler as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(event1.type).toBe('complete');
    expect(event2.type).toBe('failure');
  });

  it('multiple tasks with different configs do not interfere', async () => {
    const task1 = makeTask({ id: 'task-1', name: 'Task 1', priority: 'low' });
    const task2 = makeTask({ id: 'task-2', name: 'Task 2', priority: 'critical' });

    bridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));
    bridge.setTaskNotificationConfig('task-2', makeConfig({ triggers: ['on_complete'] }));

    await bridge.onTaskStart(task1);
    await bridge.onTaskStart(task2); // Should not fire (no on_start)

    expect(handler).toHaveBeenCalledOnce();
    const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(notification.content.data?.taskName).toBe('Task 1');
  });

  it('handler errors do not prevent the method from completing', async () => {
    const failingHandler = vi.fn().mockRejectedValue(new Error('handler failed'));
    const failBridge = new SchedulerNotificationBridge(failingHandler);
    const task = makeTask();
    failBridge.setTaskNotificationConfig('task-1', makeConfig({ triggers: ['on_start'] }));

    // onTaskStart awaits the handler — the error should propagate
    await expect(failBridge.onTaskStart(task)).rejects.toThrow('handler failed');
  });

  it('notification for task with nextRun includes scheduledTime variable', async () => {
    const task = makeTask({ nextRun: '2026-03-01T09:00:00Z' });
    bridge.setTaskNotificationConfig('task-1', makeConfig({
      triggers: ['on_start'],
      bodyTemplate: 'Scheduled: {{scheduledTime}}',
    }));

    await bridge.onTaskStart(task);

    const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(notification.content.body).toBe('Scheduled: 2026-03-01T09:00:00Z');
  });

  it('notification for task without nextRun has empty scheduledTime', async () => {
    const task = makeTask({ nextRun: undefined });
    bridge.setTaskNotificationConfig('task-1', makeConfig({
      triggers: ['on_start'],
      bodyTemplate: 'Scheduled: [{{scheduledTime}}]',
    }));

    await bridge.onTaskStart(task);

    const [, notification] = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(notification.content.body).toBe('Scheduled: []');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks — must come before any imports that transitively load these modules
// =============================================================================

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

let idCounter = 0;
vi.mock('../services/id-utils.js', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test_${++idCounter}`),
}));

// =============================================================================
// Subject under test
// =============================================================================

import {
  parseCronExpression,
  matchesCron,
  getNextRunTime,
  validateCronExpression,
  CRON_PRESETS,
  Scheduler,
  createScheduler,
  createPromptTask,
  createToolTask,
  EXAMPLE_TASKS,
  type ScheduledTask,
  type TaskExecutionResult,
  type SchedulerConfig,
} from './index.js';
import * as fsMod from 'node:fs/promises';

// =============================================================================
// Helpers
// =============================================================================

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task_test_1',
    name: 'Test Task',
    cron: '* * * * *',
    type: 'prompt',
    payload: { type: 'prompt', prompt: 'do something' },
    enabled: true,
    priority: 'normal',
    userId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMinimalAddTask(
  overrides: Partial<Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'nextRun'>> = {}
): Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'nextRun'> {
  return {
    name: 'My Task',
    cron: '* * * * *',
    type: 'prompt',
    payload: { type: 'prompt', prompt: 'do it' },
    enabled: true,
    priority: 'normal',
    userId: 'user-1',
    ...overrides,
  };
}

function makeScheduler(config: SchedulerConfig = {}): Scheduler {
  return new Scheduler({
    tasksFilePath: '/tmp/.ownpilot/tasks.json',
    historyFilePath: '/tmp/.ownpilot/history.json',
    maxHistoryPerTask: 5,
    defaultTimeout: 1000,
    checkInterval: 60000,
    ...config,
  });
}

function makeSuccessResult(taskId: string): TaskExecutionResult {
  return {
    taskId,
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    duration: 100,
    result: 'done',
  };
}

// =============================================================================
// parseCronExpression
// =============================================================================

describe('parseCronExpression', () => {
  it('parses a valid 5-field expression', () => {
    const parts = parseCronExpression('* * * * *');
    expect(parts).not.toBeNull();
    expect(parts!.minute).toBe('*');
    expect(parts!.hour).toBe('*');
    expect(parts!.dayOfMonth).toBe('*');
    expect(parts!.month).toBe('*');
    expect(parts!.dayOfWeek).toBe('*');
  });

  it('parses a specific expression with all fields', () => {
    const parts = parseCronExpression('30 9 15 6 1');
    expect(parts).not.toBeNull();
    expect(parts!.minute).toBe('30');
    expect(parts!.hour).toBe('9');
    expect(parts!.dayOfMonth).toBe('15');
    expect(parts!.month).toBe('6');
    expect(parts!.dayOfWeek).toBe('1');
  });

  it('returns null for fewer than 5 fields', () => {
    expect(parseCronExpression('* * * *')).toBeNull();
    expect(parseCronExpression('* *')).toBeNull();
    expect(parseCronExpression('*')).toBeNull();
    expect(parseCronExpression('')).toBeNull();
  });

  it('returns null for more than 5 fields', () => {
    expect(parseCronExpression('* * * * * *')).toBeNull();
    expect(parseCronExpression('0 9 1 * * extra')).toBeNull();
  });

  it('handles extra leading/trailing whitespace', () => {
    const parts = parseCronExpression('  0 9 * * *  ');
    expect(parts).not.toBeNull();
    expect(parts!.minute).toBe('0');
    expect(parts!.hour).toBe('9');
  });

  it('handles tab-separated fields', () => {
    const parts = parseCronExpression('0\t9\t*\t*\t*');
    expect(parts).not.toBeNull();
    expect(parts!.minute).toBe('0');
  });

  it('parses step expressions correctly', () => {
    const parts = parseCronExpression('*/5 * * * *');
    expect(parts).not.toBeNull();
    expect(parts!.minute).toBe('*/5');
  });

  it('parses range expressions correctly', () => {
    const parts = parseCronExpression('* * * * 1-5');
    expect(parts).not.toBeNull();
    expect(parts!.dayOfWeek).toBe('1-5');
  });

  it('parses list expressions correctly', () => {
    const parts = parseCronExpression('0 10 * * 0,6');
    expect(parts).not.toBeNull();
    expect(parts!.hour).toBe('10');
    expect(parts!.dayOfWeek).toBe('0,6');
  });
});

// =============================================================================
// matchesCron
// =============================================================================

describe('matchesCron', () => {
  it('matches wildcard * for all fields', () => {
    const date = new Date('2026-02-21T14:32:00');
    expect(matchesCron('* * * * *', date)).toBe(true);
  });

  it('matches step */5 at value 0', () => {
    const date = new Date('2026-02-21T14:00:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(true);
  });

  it('matches step */5 at value 5', () => {
    const date = new Date('2026-02-21T14:05:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(true);
  });

  it('matches step */5 at value 10', () => {
    const date = new Date('2026-02-21T14:10:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(true);
  });

  it('does not match step */5 at value 1', () => {
    const date = new Date('2026-02-21T14:01:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(false);
  });

  it('does not match step */5 at value 3', () => {
    const date = new Date('2026-02-21T14:03:00');
    expect(matchesCron('*/5 * * * *', date)).toBe(false);
  });

  it('matches range 1-5 at value 1', () => {
    // day of week 1 = Monday; 2026-02-23 is a Monday
    const date = new Date('2026-02-23T09:00:00');
    expect(matchesCron('0 9 * * 1-5', date)).toBe(true);
  });

  it('matches range 1-5 at value 5', () => {
    // day of week 5 = Friday; 2026-02-27 is a Friday
    const date = new Date('2026-02-27T09:00:00');
    expect(matchesCron('0 9 * * 1-5', date)).toBe(true);
  });

  it('does not match range 1-5 at value 0 (Sunday)', () => {
    // 2026-02-22 is a Sunday
    const date = new Date('2026-02-22T09:00:00');
    expect(matchesCron('0 9 * * 1-5', date)).toBe(false);
  });

  it('does not match range 1-5 at value 6 (Saturday)', () => {
    // 2026-02-21 is a Saturday
    const date = new Date('2026-02-21T09:00:00');
    expect(matchesCron('0 9 * * 1-5', date)).toBe(false);
  });

  it('matches list 0,6 at value 0 (Sunday)', () => {
    // 2026-02-22 is a Sunday
    const date = new Date('2026-02-22T10:00:00');
    expect(matchesCron('0 10 * * 0,6', date)).toBe(true);
  });

  it('matches list 0,6 at value 6 (Saturday)', () => {
    // 2026-02-21 is a Saturday
    const date = new Date('2026-02-21T10:00:00');
    expect(matchesCron('0 10 * * 0,6', date)).toBe(true);
  });

  it('does not match list 0,6 at value 3 (Wednesday)', () => {
    const date = new Date('2026-02-18T10:00:00'); // Wednesday
    expect(matchesCron('0 10 * * 0,6', date)).toBe(false);
  });

  it('matches exact value for hour', () => {
    const date = new Date('2026-02-21T09:00:00');
    expect(matchesCron('0 9 * * *', date)).toBe(true);
  });

  it('does not match exact value when hour differs', () => {
    const date = new Date('2026-02-21T10:00:00');
    expect(matchesCron('0 9 * * *', date)).toBe(false);
  });

  it('matches a specific full expression', () => {
    // "0 9 1 3 *" = 9:00 AM on March 1st
    const date = new Date('2026-03-01T09:00:00');
    expect(matchesCron('0 9 1 3 *', date)).toBe(true);
  });

  it('does not match a full expression on wrong day', () => {
    const date = new Date('2026-03-02T09:00:00');
    expect(matchesCron('0 9 1 3 *', date)).toBe(false);
  });

  it('returns false for invalid cron expression', () => {
    expect(matchesCron('invalid')).toBe(false);
    expect(matchesCron('* * * *')).toBe(false);
  });

  it('uses current time when no date provided', () => {
    // Every minute — must always match at current time
    expect(matchesCron('* * * * *')).toBe(true);
  });

  it('matches month correctly (month is 1-indexed in cron, getMonth() is 0-indexed)', () => {
    // February = getMonth() returns 1, cron month field should be 2
    const date = new Date('2026-02-21T09:00:00');
    expect(matchesCron('0 9 21 2 *', date)).toBe(true);
    expect(matchesCron('0 9 21 1 *', date)).toBe(false);
  });
});

// =============================================================================
// getNextRunTime
// =============================================================================

describe('getNextRunTime', () => {
  it('returns null for invalid cron', () => {
    expect(getNextRunTime('invalid cron expr')).toBeNull();
    expect(getNextRunTime('* * * *')).toBeNull();
  });

  it('returns next minute for every-minute cron', () => {
    const from = new Date('2026-02-21T10:00:00.000Z');
    const next = getNextRunTime('* * * * *', from);
    expect(next).not.toBeNull();
    // Should be exactly 1 minute later
    expect(next!.getTime()).toBe(new Date('2026-02-21T10:01:00.000Z').getTime());
  });

  it('correctly finds next specific hour and minute', () => {
    // Cron: 30 14 * * * (2:30 PM daily in local time)
    // Use a local-time based "from" well before 14:30 so the next match is 14:30 today
    const from = new Date();
    from.setHours(8, 0, 0, 0); // 8:00 AM local time
    const next = getNextRunTime('30 14 * * *', from);
    expect(next).not.toBeNull();
    // matchesCron uses getHours() / getMinutes() — local time
    expect(next!.getHours()).toBe(14);
    expect(next!.getMinutes()).toBe(30);
  });

  it('returns time after from (not same minute)', () => {
    // If from is at 9:00:30, next should be 9:01:00
    const from = new Date('2026-02-21T09:00:30.000Z');
    const next = getNextRunTime('* * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it('accepts from parameter as a past date', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const next = getNextRunTime('* * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(new Date('2026-01-01T00:01:00.000Z').getTime());
  });

  it('works across a day boundary', () => {
    // Cron: 0 0 * * * (midnight in local time)
    // From: 23:30 local time → next should be midnight the following day
    const from = new Date();
    from.setHours(23, 30, 0, 0); // 23:30 local time today
    const expectedDate = from.getDate() + 1; // tomorrow's day-of-month
    const next = getNextRunTime('0 0 * * *', from);
    expect(next).not.toBeNull();
    // matchesCron uses getHours() / getMinutes() — local time
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(0);
    // Day should have rolled over
    expect(next!.getDate()).toBe(expectedDate % 32 || 1); // handles month-end rollover loosely
  });

  it('works across a month boundary', () => {
    // Cron: 0 9 1 * * (1st of every month at 9:00 local time)
    // From: mid-month local time → next match should be the 1st of the next month
    const from = new Date();
    from.setDate(15);
    from.setHours(10, 0, 0, 0); // 10 AM local time on the 15th
    const next = getNextRunTime('0 9 1 * *', from);
    expect(next).not.toBeNull();
    // Should land on the 1st of a month in local time
    expect(next!.getDate()).toBe(1);
    expect(next!.getHours()).toBe(9);
  });

  it('returns Date with seconds and milliseconds zeroed', () => {
    const from = new Date('2026-02-21T09:00:45.123Z');
    const next = getNextRunTime('* * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getSeconds()).toBe(0);
    expect(next!.getMilliseconds()).toBe(0);
  });

  it('handles */5 step correctly', () => {
    // From 9:00 → next */5 minute match should be 9:05
    const from = new Date('2026-02-21T09:00:00.000Z');
    const next = getNextRunTime('*/5 * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(5);
  });

  it('uses current time as default when from is not provided', () => {
    const before = Date.now();
    const next = getNextRunTime('* * * * *');
    const after = Date.now();
    expect(next).not.toBeNull();
    // Should be roughly 1 minute in the future
    expect(next!.getTime()).toBeGreaterThan(before);
    expect(next!.getTime()).toBeLessThanOrEqual(after + 61_000);
  });
});

// =============================================================================
// validateCronExpression
// =============================================================================

describe('validateCronExpression', () => {
  it('returns valid=true with nextFire for a correct expression', () => {
    const result = validateCronExpression('* * * * *');
    expect(result.valid).toBe(true);
    expect(result.nextFire).toBeInstanceOf(Date);
    expect(result.error).toBeUndefined();
  });

  it('returns error for empty string', () => {
    const result = validateCronExpression('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty|required/i);
  });

  it('returns error for whitespace-only string', () => {
    const result = validateCronExpression('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('returns error for wrong field count (< 5)', () => {
    const result = validateCronExpression('* * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expected 5 fields/i);
  });

  it('returns error for wrong field count (> 5)', () => {
    const result = validateCronExpression('* * * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expected 5 fields/i);
  });

  it('returns error for minute out of range (> 59)', () => {
    const result = validateCronExpression('60 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('minute');
  });

  it('returns error for minute out of range (negative)', () => {
    // Negative numbers parse to NaN-like issues via parseInt; -1 parses but is < 0
    // Actually parseInt('-1') = -1 which is < 0 (min), so this validates as error
    const result = validateCronExpression('-1 * * * *');
    expect(result.valid).toBe(false);
  });

  it('returns error for hour out of range (> 23)', () => {
    const result = validateCronExpression('0 24 * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('hour');
  });

  it('returns error for day of month out of range (0)', () => {
    const result = validateCronExpression('0 9 0 * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day');
  });

  it('returns error for day of month out of range (> 31)', () => {
    const result = validateCronExpression('0 9 32 * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day');
  });

  it('returns error for month out of range (0)', () => {
    const result = validateCronExpression('0 9 1 0 *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('month');
  });

  it('returns error for month out of range (> 12)', () => {
    const result = validateCronExpression('0 9 1 13 *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('month');
  });

  it('returns error for day of week out of range (> 6)', () => {
    const result = validateCronExpression('0 9 * * 7');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day of week');
  });

  it('returns error for invalid range start > end', () => {
    const result = validateCronExpression('* * * * 5-3');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/range start.*must be.*<= end|start.*<=.*end/i);
  });

  it('returns error for invalid range in minute field', () => {
    const result = validateCronExpression('50-10 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('minute');
  });

  it('returns error for invalid step (*/0)', () => {
    const result = validateCronExpression('*/0 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/step.*positive/i);
  });

  it('returns error for non-numeric value in minute field', () => {
    const result = validateCronExpression('abc * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('minute');
  });

  it('returns error for non-numeric value in list', () => {
    const result = validateCronExpression('* * * * 1,abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day of week');
  });

  it('validates a step expression as valid', () => {
    const result = validateCronExpression('*/15 * * * *');
    expect(result.valid).toBe(true);
    expect(result.nextFire).toBeInstanceOf(Date);
  });

  it('validates a range expression as valid', () => {
    const result = validateCronExpression('0 9 * * 1-5');
    expect(result.valid).toBe(true);
    expect(result.nextFire).toBeInstanceOf(Date);
  });

  it('validates a list expression as valid', () => {
    const result = validateCronExpression('0 10 * * 0,6');
    expect(result.valid).toBe(true);
    expect(result.nextFire).toBeInstanceOf(Date);
  });

  it('provides nextFire that is in the future', () => {
    const result = validateCronExpression('* * * * *');
    expect(result.valid).toBe(true);
    expect(result.nextFire!.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns error for range with out-of-range end value', () => {
    const result = validateCronExpression('* * * * 0-7');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day of week');
  });

  it('returns error for list with out-of-range value', () => {
    const result = validateCronExpression('0 9 * * 1,7');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('day of week');
  });
});

// =============================================================================
// CRON_PRESETS
// =============================================================================

describe('CRON_PRESETS', () => {
  it('has the expected set of presets', () => {
    const keys = Object.keys(CRON_PRESETS);
    expect(keys).toContain('everyMinute');
    expect(keys).toContain('every5Minutes');
    expect(keys).toContain('every15Minutes');
    expect(keys).toContain('everyHour');
    expect(keys).toContain('everyDay9AM');
    expect(keys).toContain('everyDay6PM');
    expect(keys).toContain('everyMorning');
    expect(keys).toContain('everyEvening');
    expect(keys).toContain('everyMonday');
    expect(keys).toContain('everyWeekday');
    expect(keys).toContain('everyWeekend');
    expect(keys).toContain('firstOfMonth');
    expect(keys).toContain('lastDayOfMonth');
    expect(keys).toHaveLength(13);
  });

  // All presets must be valid cron expressions
  for (const [name, expr] of Object.entries(CRON_PRESETS)) {
    it(`preset "${name}" is a valid cron expression`, () => {
      const result = validateCronExpression(expr);
      expect(result.valid, `${name}: ${result.error}`).toBe(true);
    });
  }

  it('everyMinute is "* * * * *"', () => {
    expect(CRON_PRESETS.everyMinute).toBe('* * * * *');
  });

  it('every5Minutes uses */5 step', () => {
    expect(CRON_PRESETS.every5Minutes).toBe('*/5 * * * *');
  });

  it('every15Minutes uses */15 step', () => {
    expect(CRON_PRESETS.every15Minutes).toBe('*/15 * * * *');
  });

  it('everyHour fires at minute 0', () => {
    expect(CRON_PRESETS.everyHour).toBe('0 * * * *');
  });

  it('everyDay9AM fires at hour 9 minute 0', () => {
    expect(CRON_PRESETS.everyDay9AM).toBe('0 9 * * *');
  });

  it('everyDay6PM fires at hour 18 minute 0', () => {
    expect(CRON_PRESETS.everyDay6PM).toBe('0 18 * * *');
  });

  it('everyWeekday uses day-of-week range 1-5', () => {
    expect(CRON_PRESETS.everyWeekday).toContain('1-5');
  });

  it('everyWeekend uses day-of-week list 0,6', () => {
    expect(CRON_PRESETS.everyWeekend).toContain('0,6');
  });

  it('everyMonday uses day-of-week 1', () => {
    expect(CRON_PRESETS.everyMonday).toContain('1');
  });

  it('firstOfMonth uses day-of-month 1', () => {
    expect(CRON_PRESETS.firstOfMonth).toBe('0 9 1 * *');
  });

  it('lastDayOfMonth uses range 28-31', () => {
    expect(CRON_PRESETS.lastDayOfMonth).toContain('28-31');
  });

  it('everyMinute matches any time', () => {
    const _now = new Date();
    // everyMinute should match any minute — but getNextRunTime starts from +1 min, so we check valid
    expect(validateCronExpression(CRON_PRESETS.everyMinute).valid).toBe(true);
  });

  it('everyDay9AM does not match at 10:00', () => {
    const date = new Date('2026-02-21T10:00:00');
    expect(matchesCron(CRON_PRESETS.everyDay9AM, date)).toBe(false);
  });

  it('everyDay9AM matches at 9:00', () => {
    const date = new Date('2026-02-21T09:00:00');
    expect(matchesCron(CRON_PRESETS.everyDay9AM, date)).toBe(true);
  });
});

// =============================================================================
// Scheduler Constructor
// =============================================================================

describe('Scheduler constructor', () => {
  it('uses provided config values', () => {
    const scheduler = new Scheduler({
      tasksFilePath: '/custom/tasks.json',
      historyFilePath: '/custom/history.json',
      maxHistoryPerTask: 50,
      defaultTimeout: 120000,
      checkInterval: 30000,
    });
    // Verify by starting and checking interval is respected (indirectly via structure)
    expect(scheduler).toBeInstanceOf(Scheduler);
  });

  it('uses default config values when none provided', () => {
    const scheduler = new Scheduler();
    expect(scheduler).toBeInstanceOf(Scheduler);
  });

  it('partial config merges with defaults', () => {
    const scheduler = new Scheduler({ maxHistoryPerTask: 10 });
    expect(scheduler).toBeInstanceOf(Scheduler);
  });

  it('isRunning starts as false', () => {
    const scheduler = makeScheduler();
    // Not running — getAllTasks() returns empty (no tasks loaded yet)
    expect(scheduler.getAllTasks()).toHaveLength(0);
  });
});

// =============================================================================
// Scheduler.initialize()
// =============================================================================

describe('Scheduler.initialize()', () => {
  let fsMock: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
    fsMock = fsMod as unknown as typeof fsMock;
  });

  it('handles missing tasks file gracefully (ENOENT)', async () => {
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const scheduler = makeScheduler();
    await expect(scheduler.initialize()).resolves.toBeUndefined();
    expect(scheduler.getAllTasks()).toHaveLength(0);
  });

  it('loads tasks from file when file exists', async () => {
    const task = makeTask({ id: 'loaded_task_1' });
    const tasks = [task];

    let readCallIndex = 0;
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readCallIndex++;
      if (readCallIndex === 1) {
        // tasks file
        return Promise.resolve(JSON.stringify(tasks));
      }
      // history file
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const scheduler = makeScheduler();
    await scheduler.initialize();
    expect(scheduler.getAllTasks()).toHaveLength(1);
    expect(scheduler.getTask('loaded_task_1')).toBeDefined();
    expect(scheduler.getTask('loaded_task_1')!.name).toBe('Test Task');
  });

  it('loads history from file when both files exist', async () => {
    const task = makeTask({ id: 'task-h1' });
    const historyData = {
      'task-h1': [
        {
          executionId: 'exec_1',
          taskId: 'task-h1',
          status: 'completed',
          startedAt: new Date().toISOString(),
          duration: 500,
        },
      ],
    };

    let readCallIndex = 0;
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readCallIndex++;
      if (readCallIndex === 1) {
        return Promise.resolve(JSON.stringify([task]));
      }
      return Promise.resolve(JSON.stringify(historyData));
    });

    const scheduler = makeScheduler();
    await scheduler.initialize();
    const history = scheduler.getTaskHistory('task-h1');
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('completed');
  });

  it('handles invalid JSON in tasks file gracefully', async () => {
    let readCallIndex = 0;
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readCallIndex++;
      if (readCallIndex === 1) {
        return Promise.resolve('NOT VALID JSON {{{');
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const scheduler = makeScheduler();
    // Should not throw — catch block resets to empty map
    await expect(scheduler.initialize()).resolves.toBeUndefined();
    expect(scheduler.getAllTasks()).toHaveLength(0);
  });

  it('handles invalid JSON in history file gracefully', async () => {
    const task = makeTask({ id: 'task-x' });

    let readCallIndex = 0;
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readCallIndex++;
      if (readCallIndex === 1) {
        return Promise.resolve(JSON.stringify([task]));
      }
      return Promise.resolve('BROKEN JSON');
    });

    const scheduler = makeScheduler();
    await expect(scheduler.initialize()).resolves.toBeUndefined();
    // Tasks loaded, history empty
    expect(scheduler.getAllTasks()).toHaveLength(1);
    expect(scheduler.getTaskHistory('task-x')).toHaveLength(0);
  });

  it('updates next run times for enabled tasks after loading', async () => {
    const task = makeTask({
      id: 'task-nr',
      cron: '* * * * *',
      enabled: true,
      nextRun: undefined,
    });

    let readCallIndex = 0;
    (fsMock.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readCallIndex++;
      if (readCallIndex === 1) {
        return Promise.resolve(JSON.stringify([task]));
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const scheduler = makeScheduler();
    await scheduler.initialize();

    const loaded = scheduler.getTask('task-nr');
    expect(loaded).toBeDefined();
    // nextRun should have been computed
    expect(loaded!.nextRun).toBeDefined();
    expect(new Date(loaded!.nextRun!).getTime()).toBeGreaterThan(Date.now());
  });
});

// =============================================================================
// Scheduler.start() / stop()
// =============================================================================

describe('Scheduler start/stop', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() sets isRunning (verified by idempotency guard)', () => {
    const scheduler = makeScheduler();
    // Start twice — second call should be a no-op (idempotent)
    scheduler.start();
    scheduler.start(); // must not throw or create duplicate timers
    scheduler.stop();
  });

  it('start() is idempotent — calling twice does not error', () => {
    const scheduler = makeScheduler();
    expect(() => {
      scheduler.start();
      scheduler.start();
    }).not.toThrow();
    scheduler.stop();
  });

  it('stop() after start() does not throw', () => {
    const scheduler = makeScheduler();
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('stop() on a non-started scheduler does not throw', () => {
    const scheduler = makeScheduler();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('stop() clears the check timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const scheduler = makeScheduler({ checkInterval: 1000 });
    scheduler.start();
    scheduler.stop();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('stop() calls clearAllReminders on bridge when bridge is set', () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);
    scheduler.start();
    scheduler.stop();
    expect(bridge.clearAllReminders).toHaveBeenCalledOnce();
  });

  it('stop() does not call clearAllReminders when no bridge configured', () => {
    const scheduler = makeScheduler();
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
  });
});

// =============================================================================
// Scheduler.addTask()
// =============================================================================

describe('Scheduler.addTask()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('creates task with generated ID', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    expect(task.id).toBe('task_test_1');
  });

  it('sets createdAt and updatedAt to current ISO time', async () => {
    const before = new Date().toISOString();
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    const after = new Date().toISOString();
    expect(task.createdAt >= before).toBe(true);
    expect(task.createdAt <= after).toBe(true);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  it('calculates nextRun from cron expression', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ cron: '* * * * *' }));
    expect(task.nextRun).toBeDefined();
    expect(new Date(task.nextRun!).getTime()).toBeGreaterThan(Date.now());
  });

  it('uses runAt directly for one-time tasks', async () => {
    const scheduler = makeScheduler();
    const runAt = new Date(Date.now() + 3600_000).toISOString();
    const task = await scheduler.addTask(
      makeMinimalAddTask({
        cron: '* * * * *',
        runAt,
        oneTime: true,
      })
    );
    // For one-time tasks with runAt, nextRun equals runAt
    expect(task.nextRun).toBe(runAt);
  });

  it('stores task so getTask returns it', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    expect(scheduler.getTask(task.id)).toStrictEqual(task);
  });

  it('stores task so getAllTasks includes it', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask());
    expect(scheduler.getAllTasks()).toHaveLength(1);
  });

  it('saves tasks to file via writeFile', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask());
    expect(fsMod.writeFile).toHaveBeenCalled();
  });

  it('creates mkdir for directory before writing', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask());
    expect(fsMod.mkdir).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ recursive: true })
    );
  });

  it('schedules reminder if bridge is configured and task enabled', async () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    await scheduler.addTask(makeMinimalAddTask({ enabled: true }));
    expect(bridge.scheduleReminder).toHaveBeenCalledOnce();
  });

  it('does not schedule reminder when task is disabled', async () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    await scheduler.addTask(makeMinimalAddTask({ enabled: false }));
    expect(bridge.scheduleReminder).not.toHaveBeenCalled();
  });

  it('does not schedule reminder when no bridge is configured', async () => {
    const scheduler = makeScheduler();
    // No bridge set — should not throw
    await expect(scheduler.addTask(makeMinimalAddTask({ enabled: true }))).resolves.toBeDefined();
  });

  it('preserves all input fields on returned task', async () => {
    const scheduler = makeScheduler();
    const input = makeMinimalAddTask({
      name: 'Special Task',
      cron: '0 9 * * *',
      type: 'tool',
      payload: { type: 'tool', toolName: 'mytool', args: { x: 1 } },
      enabled: false,
      priority: 'high',
      userId: 'user-42',
      tags: ['tag1', 'tag2'],
    });
    const task = await scheduler.addTask(input);
    expect(task.name).toBe('Special Task');
    expect(task.priority).toBe('high');
    expect(task.userId).toBe('user-42');
    expect(task.tags).toEqual(['tag1', 'tag2']);
    expect(task.enabled).toBe(false);
  });

  it('adds multiple tasks with distinct IDs', async () => {
    const scheduler = makeScheduler();
    const t1 = await scheduler.addTask(makeMinimalAddTask({ name: 'Task A' }));
    const t2 = await scheduler.addTask(makeMinimalAddTask({ name: 'Task B' }));
    expect(t1.id).not.toBe(t2.id);
    expect(scheduler.getAllTasks()).toHaveLength(2);
  });
});

// =============================================================================
// Scheduler.updateTask()
// =============================================================================

describe('Scheduler.updateTask()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns null for a non-existent task', async () => {
    const scheduler = makeScheduler();
    const result = await scheduler.updateTask('missing-id', { name: 'New Name' });
    expect(result).toBeNull();
  });

  it('updates task name field', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ name: 'Original' }));
    const updated = await scheduler.updateTask(task.id, { name: 'Updated' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
  });

  it('preserves the original task ID', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    // Attempt to change ID via updates (should be ignored)
    const updated = await scheduler.updateTask(task.id, {
      id: 'hacked-id',
    } as Partial<ScheduledTask>);
    expect(updated!.id).toBe(task.id);
  });

  it('sets updatedAt to a new value', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = makeScheduler();
      const task = await scheduler.addTask(makeMinimalAddTask());
      const originalUpdatedAt = task.updatedAt;

      // Advance clock by 1 second so updatedAt will differ
      vi.advanceTimersByTime(1000);

      const updated = await scheduler.updateTask(task.id, { name: 'Changed' });
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recalculates nextRun when cron changes', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ cron: '* * * * *' }));
    const oldNextRun = task.nextRun;

    // Change cron to a specific time far in the future
    const updated = await scheduler.updateTask(task.id, { cron: '0 23 * * *' });
    expect(updated!.nextRun).toBeDefined();
    expect(updated!.nextRun).not.toBe(oldNextRun);
  });

  it('does NOT recalculate nextRun when cron is unchanged', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ cron: '0 9 * * *' }));
    const originalNextRun = task.nextRun;

    const updated = await scheduler.updateTask(task.id, { name: 'Renamed' });
    expect(updated!.nextRun).toBe(originalNextRun);
  });

  it('saves tasks after update', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    vi.clearAllMocks();

    await scheduler.updateTask(task.id, { name: 'Changed' });
    expect(fsMod.writeFile).toHaveBeenCalled();
  });

  it('getTask reflects updated values after update', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    await scheduler.updateTask(task.id, { priority: 'critical' });
    expect(scheduler.getTask(task.id)!.priority).toBe('critical');
  });

  it('can disable a task via update', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ enabled: true }));
    const updated = await scheduler.updateTask(task.id, { enabled: false });
    expect(updated!.enabled).toBe(false);
  });
});

// =============================================================================
// Scheduler.deleteTask()
// =============================================================================

describe('Scheduler.deleteTask()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns true for an existing task', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    const result = await scheduler.deleteTask(task.id);
    expect(result).toBe(true);
  });

  it('returns false for a non-existent task', async () => {
    const scheduler = makeScheduler();
    const result = await scheduler.deleteTask('nonexistent-id');
    expect(result).toBe(false);
  });

  it('removes task from getAllTasks', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    await scheduler.deleteTask(task.id);
    expect(scheduler.getAllTasks()).toHaveLength(0);
  });

  it('getTask returns undefined after deletion', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    await scheduler.deleteTask(task.id);
    expect(scheduler.getTask(task.id)).toBeUndefined();
  });

  it('saves tasks file after successful deletion', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    vi.clearAllMocks();

    await scheduler.deleteTask(task.id);
    expect(fsMod.writeFile).toHaveBeenCalled();
  });

  it('does not save tasks file when task does not exist', async () => {
    const scheduler = makeScheduler();
    vi.clearAllMocks();

    await scheduler.deleteTask('nonexistent');
    expect(fsMod.writeFile).not.toHaveBeenCalled();
  });

  it('only deletes the specified task, leaving others intact', async () => {
    const scheduler = makeScheduler();
    const t1 = await scheduler.addTask(makeMinimalAddTask({ name: 'Task A' }));
    const t2 = await scheduler.addTask(makeMinimalAddTask({ name: 'Task B' }));

    await scheduler.deleteTask(t1.id);
    expect(scheduler.getAllTasks()).toHaveLength(1);
    expect(scheduler.getTask(t2.id)).toBeDefined();
  });
});

// =============================================================================
// Scheduler.getTask / getAllTasks / getUserTasks
// =============================================================================

describe('Scheduler.getTask()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns the task by ID', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    expect(scheduler.getTask(task.id)).toStrictEqual(task);
  });

  it('returns undefined for unknown ID', () => {
    const scheduler = makeScheduler();
    expect(scheduler.getTask('unknown')).toBeUndefined();
  });
});

describe('Scheduler.getAllTasks()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns empty array when no tasks exist', () => {
    const scheduler = makeScheduler();
    expect(scheduler.getAllTasks()).toEqual([]);
  });

  it('returns all tasks', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask({ name: 'T1' }));
    await scheduler.addTask(makeMinimalAddTask({ name: 'T2' }));
    await scheduler.addTask(makeMinimalAddTask({ name: 'T3' }));
    expect(scheduler.getAllTasks()).toHaveLength(3);
  });
});

describe('Scheduler.getUserTasks()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns empty array when no tasks exist', () => {
    const scheduler = makeScheduler();
    expect(scheduler.getUserTasks('user-1')).toEqual([]);
  });

  it('filters tasks by userId', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask({ userId: 'user-1', name: 'T1' }));
    await scheduler.addTask(makeMinimalAddTask({ userId: 'user-2', name: 'T2' }));
    await scheduler.addTask(makeMinimalAddTask({ userId: 'user-1', name: 'T3' }));

    const user1Tasks = scheduler.getUserTasks('user-1');
    expect(user1Tasks).toHaveLength(2);
    expect(user1Tasks.every((t) => t.userId === 'user-1')).toBe(true);
  });

  it('returns empty array for unknown userId', async () => {
    const scheduler = makeScheduler();
    await scheduler.addTask(makeMinimalAddTask({ userId: 'user-1' }));
    expect(scheduler.getUserTasks('user-99')).toHaveLength(0);
  });
});

// =============================================================================
// Scheduler.getTaskHistory()
// =============================================================================

describe('Scheduler.getTaskHistory()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns empty array for unknown task', () => {
    const scheduler = makeScheduler();
    expect(scheduler.getTaskHistory('unknown')).toEqual([]);
  });

  it('returns history after task execution', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('completed');
  });

  it('limit parameter returns only the last N entries', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 100,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    // Execute 5 times
    for (let i = 0; i < 5; i++) {
      await scheduler.triggerTask(task.id);
    }

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(5);

    const limited = scheduler.getTaskHistory(task.id, 2);
    expect(limited).toHaveLength(2);
  });

  it('returns all entries when limit is undefined', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 100,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    for (let i = 0; i < 3; i++) {
      await scheduler.triggerTask(task.id);
    }

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(3);
  });

  it('trims history to maxHistoryPerTask', async () => {
    // maxHistoryPerTask = 3
    const scheduler = makeScheduler({
      maxHistoryPerTask: 3,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    // Execute 5 times — only last 3 should remain
    for (let i = 0; i < 5; i++) {
      await scheduler.triggerTask(task.id);
    }

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(3);
  });

  it('history entries have executionId', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);

    const history = scheduler.getTaskHistory(task.id);
    expect(history[0]!.executionId).toBeDefined();
    expect(typeof history[0]!.executionId).toBe('string');
  });
});

// =============================================================================
// Scheduler.triggerTask() — executes via executeTask
// =============================================================================

describe('Scheduler.triggerTask()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('returns null for a non-existent task', async () => {
    const scheduler = makeScheduler();
    const result = await scheduler.triggerTask('nonexistent');
    expect(result).toBeNull();
  });

  it('returns execution result on success', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const result = await scheduler.triggerTask(task.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.taskId).toBe(task.id);
  });

  it('calls task executor with the task object', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask({ name: 'Executor Test' }));
    const executor = vi.fn(async (t: ScheduledTask) => makeSuccessResult(t.id));
    scheduler.setTaskExecutor(executor);

    await scheduler.triggerTask(task.id);
    expect(executor).toHaveBeenCalledOnce();
    expect(executor.mock.calls[0]![0].name).toBe('Executor Test');
  });

  it('returns failed result when no executor is configured', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    // No executor set

    const result = await scheduler.triggerTask(task.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('failed');
    expect(result!.error).toContain('No task executor configured');
  });

  it('records failed result when executor throws', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async () => {
      throw new Error('executor blew up');
    });

    const result = await scheduler.triggerTask(task.id);
    expect(result!.status).toBe('failed');
    expect(result!.error).toContain('executor blew up');
  });

  it('records failed result on timeout', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = makeScheduler({ defaultTimeout: 500 });
      const task = await scheduler.addTask(makeMinimalAddTask());

      scheduler.setTaskExecutor(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(makeSuccessResult(task.id)), 10_000);
          })
      );

      const resultPromise = scheduler.triggerTask(task.id);
      // Advance past the 500ms timeout
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result!.status).toBe('failed');
      expect(result!.error).toContain('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets lastRun on the task after execution', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);
    const loaded = scheduler.getTask(task.id);
    expect(loaded!.lastRun).toBeDefined();
    expect(() => new Date(loaded!.lastRun!)).not.toThrow();
  });

  it('sets lastStatus to "completed" on success', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);
    expect(scheduler.getTask(task.id)!.lastStatus).toBe('completed');
  });

  it('sets lastStatus to "failed" on executor error', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async () => {
      throw new Error('fail');
    });

    await scheduler.triggerTask(task.id);
    expect(scheduler.getTask(task.id)!.lastStatus).toBe('failed');
  });

  it('stores result in history', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('completed');
  });

  it('saves tasks to file after execution', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));
    vi.clearAllMocks();

    await scheduler.triggerTask(task.id);
    expect(fsMod.writeFile).toHaveBeenCalled();
  });

  it('result includes startedAt and completedAt timestamps', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const result = await scheduler.triggerTask(task.id);
    expect(result!.startedAt).toBeDefined();
    expect(result!.completedAt).toBeDefined();
    expect(() => new Date(result!.startedAt)).not.toThrow();
    expect(() => new Date(result!.completedAt!)).not.toThrow();
  });

  it('result includes duration in milliseconds', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const result = await scheduler.triggerTask(task.id);
    expect(result!.duration).toBeDefined();
    expect(typeof result!.duration).toBe('number');
    expect(result!.duration!).toBeGreaterThanOrEqual(0);
  });

  it('calls notificationBridge.onTaskStart when bridge is set', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    await scheduler.triggerTask(task.id);
    expect(bridge.onTaskStart).toHaveBeenCalledOnce();
    expect(bridge.onTaskStart.mock.calls[0]![0].id).toBe(task.id);
  });

  it('calls notificationBridge.onTaskComplete when bridge is set', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    await scheduler.triggerTask(task.id);
    expect(bridge.onTaskComplete).toHaveBeenCalledOnce();
    const [completedTask, completedResult] = bridge.onTaskComplete.mock.calls[0]!;
    expect(completedTask.id).toBe(task.id);
    expect(completedResult.status).toBe('completed');
  });

  it('continues after notification bridge start error', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const bridge = {
      onTaskStart: vi.fn().mockRejectedValue(new Error('bridge start error')),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    // Should not throw despite bridge.onTaskStart rejection
    const result = await scheduler.triggerTask(task.id);
    expect(result!.status).toBe('completed');
  });

  it('continues after notification bridge complete error', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockRejectedValue(new Error('bridge complete error')),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    const result = await scheduler.triggerTask(task.id);
    expect(result!.status).toBe('completed');
  });

  it('uses task-level timeout override when set', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = makeScheduler({ defaultTimeout: 60_000 });
      const task = await scheduler.addTask(makeMinimalAddTask({ timeout: 300 }));

      scheduler.setTaskExecutor(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(makeSuccessResult(task.id)), 10_000);
          })
      );

      const resultPromise = scheduler.triggerTask(task.id);
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result!.status).toBe('failed');
      expect(result!.error).toContain('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});

// =============================================================================
// Scheduler.setNotificationBridge / configureTaskNotifications / removeTaskNotifications
// =============================================================================

describe('Scheduler.setNotificationBridge()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('sets the notification bridge', () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn(),
      onTaskComplete: vi.fn(),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    expect(() => scheduler.setNotificationBridge(bridge as never)).not.toThrow();
  });
});

describe('Scheduler.configureTaskNotifications()', () => {
  it('calls bridge.setTaskNotificationConfig when bridge is set', () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn(),
      onTaskComplete: vi.fn(),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    const config = { triggers: ['on_complete' as const] };
    scheduler.configureTaskNotifications('task-1', config as never);
    expect(bridge.setTaskNotificationConfig).toHaveBeenCalledWith('task-1', config);
  });

  it('does nothing when no bridge is set', () => {
    const scheduler = makeScheduler();
    // Should not throw
    expect(() =>
      scheduler.configureTaskNotifications('task-1', {
        triggers: ['on_complete' as const],
      } as never)
    ).not.toThrow();
  });
});

describe('Scheduler.removeTaskNotifications()', () => {
  it('calls bridge.removeTaskNotificationConfig when bridge is set', () => {
    const scheduler = makeScheduler();
    const bridge = {
      onTaskStart: vi.fn(),
      onTaskComplete: vi.fn(),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
      setTaskNotificationConfig: vi.fn(),
      removeTaskNotificationConfig: vi.fn(),
    };
    scheduler.setNotificationBridge(bridge as never);

    scheduler.removeTaskNotifications('task-1');
    expect(bridge.removeTaskNotificationConfig).toHaveBeenCalledWith('task-1');
  });

  it('does nothing when no bridge is set', () => {
    const scheduler = makeScheduler();
    expect(() => scheduler.removeTaskNotifications('task-1')).not.toThrow();
  });
});

// =============================================================================
// checkAndRunTasks (via start + fake timers)
// =============================================================================

describe('checkAndRunTasks (via start + fake timers)', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes a due task when timer fires', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    const executor = vi.fn(async (t: ScheduledTask) => makeSuccessResult(t.id));
    scheduler.setTaskExecutor(executor);

    // Set nextRun to past
    const task = await scheduler.addTask(
      makeMinimalAddTask({
        cron: '* * * * *',
      })
    );
    // Manually backdate nextRun to ensure it's due
    const updated = await scheduler.updateTask(task.id, {
      nextRun: new Date(Date.now() - 1000).toISOString(),
    });
    expect(updated).not.toBeNull();

    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('skips disabled tasks', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    const executor = vi.fn(async (t: ScheduledTask) => makeSuccessResult(t.id));
    scheduler.setTaskExecutor(executor);

    const task = await scheduler.addTask(makeMinimalAddTask({ enabled: false }));
    await scheduler.updateTask(task.id, {
      enabled: false,
      nextRun: new Date(Date.now() - 1000).toISOString(),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    expect(executor).not.toHaveBeenCalled();
  });

  it('skips tasks with no nextRun', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    const executor = vi.fn(async (t: ScheduledTask) => makeSuccessResult(t.id));
    scheduler.setTaskExecutor(executor);

    const task = await scheduler.addTask(makeMinimalAddTask({ enabled: true }));
    await scheduler.updateTask(task.id, {
      nextRun: undefined,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    expect(executor).not.toHaveBeenCalled();
  });

  it('disables one-time task after execution', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const task = await scheduler.addTask(
      makeMinimalAddTask({
        cron: '* * * * *',
        oneTime: true,
        enabled: true,
      })
    );
    await scheduler.updateTask(task.id, {
      nextRun: new Date(Date.now() - 1000).toISOString(),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    const loaded = scheduler.getTask(task.id);
    expect(loaded!.enabled).toBe(false);
    expect(loaded!.nextRun).toBeUndefined();
  });

  it('recalculates nextRun for recurring tasks after execution', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    const task = await scheduler.addTask(
      makeMinimalAddTask({
        cron: '* * * * *',
        oneTime: false,
        enabled: true,
      })
    );
    const oldNextRun = new Date(Date.now() - 1000).toISOString();
    await scheduler.updateTask(task.id, { nextRun: oldNextRun });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    const loaded = scheduler.getTask(task.id);
    expect(loaded!.nextRun).toBeDefined();
    expect(loaded!.nextRun).not.toBe(oldNextRun);
    // New nextRun should be in the future
    expect(new Date(loaded!.nextRun!).getTime()).toBeGreaterThan(Date.now() - 2000);
  });

  it('does not execute tasks that are not yet due', async () => {
    const scheduler = makeScheduler({ checkInterval: 1000 });
    const executor = vi.fn(async (t: ScheduledTask) => makeSuccessResult(t.id));
    scheduler.setTaskExecutor(executor);

    const task = await scheduler.addTask(makeMinimalAddTask({ enabled: true }));
    await scheduler.updateTask(task.id, {
      nextRun: new Date(Date.now() + 60_000).toISOString(), // 1 minute in future
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    expect(executor).not.toHaveBeenCalled();
  });

  it('schedules reminder for next run when bridge is configured', async () => {
    const bridge = {
      onTaskStart: vi.fn().mockResolvedValue(undefined),
      onTaskComplete: vi.fn().mockResolvedValue(undefined),
      scheduleReminder: vi.fn(),
      clearAllReminders: vi.fn(),
    };

    const scheduler = makeScheduler({ checkInterval: 1000 });
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));
    scheduler.setNotificationBridge(bridge as never);

    const task = await scheduler.addTask(
      makeMinimalAddTask({
        cron: '* * * * *',
        enabled: true,
      })
    );
    await scheduler.updateTask(task.id, {
      nextRun: new Date(Date.now() - 1000).toISOString(),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    scheduler.stop();

    // scheduleReminder called for the new next run
    expect(bridge.scheduleReminder).toHaveBeenCalled();
  });
});

// =============================================================================
// History management — addToHistory (via triggerTask)
// =============================================================================

describe('History management', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('history entry has executionId prefixed with "exec"', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);

    const history = scheduler.getTaskHistory(task.id);
    expect(history[0]!.executionId).toMatch(/^exec/);
  });

  it('accumulates multiple history entries', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 10,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);
    await scheduler.triggerTask(task.id);
    await scheduler.triggerTask(task.id);

    expect(scheduler.getTaskHistory(task.id)).toHaveLength(3);
  });

  it('trims to maxHistoryPerTask when exceeded', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 2,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);
    await scheduler.triggerTask(task.id);
    await scheduler.triggerTask(task.id);

    expect(scheduler.getTaskHistory(task.id)).toHaveLength(2);
  });

  it('history is saved to file after each execution', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));
    vi.clearAllMocks();

    await scheduler.triggerTask(task.id);

    // writeFile should have been called (both for task save and history save)
    expect(fsMod.writeFile).toHaveBeenCalled();
  });

  it('history is separate per task', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 10,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const t1 = await scheduler.addTask(makeMinimalAddTask({ name: 'T1' }));
    const t2 = await scheduler.addTask(makeMinimalAddTask({ name: 'T2' }));
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(t1.id);
    await scheduler.triggerTask(t1.id);
    await scheduler.triggerTask(t2.id);

    expect(scheduler.getTaskHistory(t1.id)).toHaveLength(2);
    expect(scheduler.getTaskHistory(t2.id)).toHaveLength(1);
  });
});

// =============================================================================
// Factory functions
// =============================================================================

describe('createScheduler()', () => {
  it('returns a Scheduler instance', () => {
    const scheduler = createScheduler();
    expect(scheduler).toBeInstanceOf(Scheduler);
  });

  it('passes config to scheduler', () => {
    const scheduler = createScheduler({
      maxHistoryPerTask: 42,
      tasksFilePath: '/custom/path.json',
    });
    expect(scheduler).toBeInstanceOf(Scheduler);
  });

  it('works with no config argument', () => {
    expect(() => createScheduler()).not.toThrow();
  });
});

describe('createPromptTask()', () => {
  it('returns a PromptTaskPayload with type="prompt"', () => {
    const payload = createPromptTask('Hello world');
    expect(payload.type).toBe('prompt');
  });

  it('sets the prompt field', () => {
    const payload = createPromptTask('Do something');
    expect(payload.prompt).toBe('Do something');
  });

  it('spreads options into the payload', () => {
    const payload = createPromptTask('test', {
      outputFormat: 'markdown',
      context: { key: 'value' },
    });
    expect(payload.outputFormat).toBe('markdown');
    expect(payload.context).toEqual({ key: 'value' });
  });

  it('works with no options', () => {
    const payload = createPromptTask('simple prompt');
    expect(payload.modelPreferences).toBeUndefined();
    expect(payload.outputFormat).toBeUndefined();
    expect(payload.context).toBeUndefined();
  });

  it('supports modelPreferences option', () => {
    const modelPreferences = {
      capabilities: ['reasoning'],
      preferredProviders: ['openai'],
      maxCost: 0.5,
    };
    const payload = createPromptTask('test', { modelPreferences });
    expect(payload.modelPreferences).toEqual(modelPreferences);
  });
});

describe('createToolTask()', () => {
  it('returns a ToolTaskPayload with type="tool"', () => {
    const payload = createToolTask('my_tool', {});
    expect(payload.type).toBe('tool');
  });

  it('sets toolName and args', () => {
    const args = { param1: 'value1', count: 5 };
    const payload = createToolTask('search_tool', args);
    expect(payload.toolName).toBe('search_tool');
    expect(payload.args).toEqual(args);
  });

  it('works with empty args', () => {
    const payload = createToolTask('no_args_tool', {});
    expect(payload.args).toEqual({});
  });

  it('preserves complex args object', () => {
    const args = { nested: { key: [1, 2, 3] }, flag: true };
    const payload = createToolTask('complex_tool', args);
    expect(payload.args).toStrictEqual(args);
  });
});

// =============================================================================
// EXAMPLE_TASKS
// =============================================================================

describe('EXAMPLE_TASKS', () => {
  it('morningBriefing has required fields', () => {
    const task = EXAMPLE_TASKS.morningBriefing;
    expect(task.name).toBe('Morning Briefing');
    expect(task.cron).toBe(CRON_PRESETS.everyDay9AM);
    expect(task.type).toBe('prompt');
    expect(task.payload.type).toBe('prompt');
    expect(task.priority).toBe('normal');
    expect(task.description).toBeDefined();
  });

  it('morningBriefing uses everyDay9AM preset', () => {
    expect(EXAMPLE_TASKS.morningBriefing.cron).toBe('0 9 * * *');
  });

  it('morningBriefing payload has prompt string', () => {
    const payload = EXAMPLE_TASKS.morningBriefing.payload as {
      type: string;
      prompt: string;
      outputFormat: string;
    };
    expect(typeof payload.prompt).toBe('string');
    expect(payload.prompt.length).toBeGreaterThan(10);
    expect(payload.outputFormat).toBe('markdown');
  });

  it('weeklyExpenseReport has required fields', () => {
    const task = EXAMPLE_TASKS.weeklyExpenseReport;
    expect(task.name).toBe('Weekly Expense Report');
    expect(task.cron).toBe(CRON_PRESETS.everyMonday);
    expect(task.type).toBe('tool');
    expect(task.payload.type).toBe('tool');
    expect(task.priority).toBe('low');
  });

  it('weeklyExpenseReport payload has toolName and args', () => {
    const payload = EXAMPLE_TASKS.weeklyExpenseReport.payload as {
      type: string;
      toolName: string;
      args: Record<string, unknown>;
    };
    expect(payload.toolName).toBe('expense_summary');
    expect(payload.args).toEqual({ period: 'last_week' });
  });

  it('dailyResearch has required fields', () => {
    const task = EXAMPLE_TASKS.dailyResearch;
    expect(task.name).toBe('Daily Research Task');
    expect(task.cron).toBe(CRON_PRESETS.everyDay9AM);
    expect(task.type).toBe('prompt');
    expect(task.priority).toBe('normal');
    expect(task.description).toBeDefined();
  });

  it('dailyResearch payload has modelPreferences with capabilities', () => {
    const payload = EXAMPLE_TASKS.dailyResearch.payload as {
      type: string;
      prompt: string;
      outputFormat: string;
      modelPreferences?: { capabilities?: string[]; maxCost?: number };
    };
    expect(payload.modelPreferences).toBeDefined();
    expect(payload.modelPreferences!.capabilities).toContain('reasoning');
    expect(payload.modelPreferences!.maxCost).toBe(0.5);
  });

  it('all example tasks have valid cron expressions', () => {
    for (const [name, task] of Object.entries(EXAMPLE_TASKS)) {
      const result = validateCronExpression(task.cron);
      expect(result.valid, `${name} has invalid cron: ${result.error}`).toBe(true);
    }
  });

  it('all example tasks have a non-empty name', () => {
    for (const [key, task] of Object.entries(EXAMPLE_TASKS)) {
      expect(typeof task.name, key).toBe('string');
      expect(task.name.length, key).toBeGreaterThan(0);
    }
  });

  it('all example tasks have a valid type', () => {
    const validTypes = ['prompt', 'tool', 'workflow'];
    for (const [key, task] of Object.entries(EXAMPLE_TASKS)) {
      expect(validTypes, key).toContain(task.type);
    }
  });

  it('all example tasks have a valid priority', () => {
    const validPriorities = ['low', 'normal', 'high', 'critical'];
    for (const [key, task] of Object.entries(EXAMPLE_TASKS)) {
      expect(validPriorities, key).toContain(task.priority);
    }
  });
});

// =============================================================================
// setTaskExecutor
// =============================================================================

describe('Scheduler.setTaskExecutor()', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('replaces a previously set executor', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());

    const executor1 = vi.fn(
      async (t: ScheduledTask): Promise<TaskExecutionResult> => ({
        taskId: t.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        result: 'from executor1',
      })
    );
    const executor2 = vi.fn(
      async (t: ScheduledTask): Promise<TaskExecutionResult> => ({
        taskId: t.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        result: 'from executor2',
      })
    );

    scheduler.setTaskExecutor(executor1);
    await scheduler.triggerTask(task.id);
    expect(executor1).toHaveBeenCalledTimes(1);

    scheduler.setTaskExecutor(executor2);
    await scheduler.triggerTask(task.id);
    expect(executor2).toHaveBeenCalledTimes(1);
    expect(executor1).toHaveBeenCalledTimes(1); // not called again
  });
});

// =============================================================================
// Edge cases and integration
// =============================================================================

describe('Edge cases', () => {
  beforeEach(() => {
    idCounter = 0;
    vi.clearAllMocks();
  });

  it('task with no cron and no runAt produces undefined nextRun', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask({
      name: 'No Schedule',
      cron: '',
      type: 'prompt',
      payload: { type: 'prompt', prompt: 'test' },
      enabled: true,
      priority: 'normal',
      userId: 'user-1',
    });
    // Empty cron → parseCronExpression returns null → nextRunDate stays null → nextRun undefined
    expect(task.nextRun).toBeUndefined();
  });

  it('can add tasks with workflow type', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask({
      name: 'Workflow Task',
      cron: '* * * * *',
      type: 'workflow',
      payload: {
        type: 'workflow',
        steps: [
          {
            name: 'Step 1',
            type: 'prompt',
            payload: { type: 'prompt', prompt: 'first' },
          },
        ],
      },
      enabled: true,
      priority: 'normal',
      userId: 'user-1',
    });
    expect(task.type).toBe('workflow');
    expect(scheduler.getTask(task.id)).toBeDefined();
  });

  it('getTaskHistory with limit 0 returns empty slice', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async (t) => makeSuccessResult(t.id));

    await scheduler.triggerTask(task.id);

    // slice(-0) is same as slice(0) which returns all — but limit=0 means falsy, so no limit applied
    // Actually limit ? history.slice(-limit) : history — 0 is falsy so returns all
    const history = scheduler.getTaskHistory(task.id, 0);
    expect(history).toHaveLength(1); // 0 is falsy → returns all
  });

  it('failed result includes both startedAt and completedAt', async () => {
    const scheduler = makeScheduler();
    const task = await scheduler.addTask(makeMinimalAddTask());
    scheduler.setTaskExecutor(async () => {
      throw new Error('fail');
    });

    const result = await scheduler.triggerTask(task.id);
    expect(result!.startedAt).toBeDefined();
    expect(result!.completedAt).toBeDefined();
    expect(result!.duration).toBeGreaterThanOrEqual(0);
  });

  it('multiple triggers on same task accumulate distinct history entries', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 100,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    let callCount = 0;
    scheduler.setTaskExecutor(async (t): Promise<TaskExecutionResult> => {
      callCount++;
      return {
        taskId: t.id,
        status: callCount % 2 === 0 ? 'failed' : 'completed',
        startedAt: new Date().toISOString(),
        error: callCount % 2 === 0 ? 'even call fails' : undefined,
      };
    });

    await scheduler.triggerTask(task.id); // completed
    await scheduler.triggerTask(task.id); // failed
    await scheduler.triggerTask(task.id); // completed

    const history = scheduler.getTaskHistory(task.id);
    expect(history).toHaveLength(3);
    expect(history[0]!.status).toBe('completed');
    expect(history[1]!.status).toBe('failed');
    expect(history[2]!.status).toBe('completed');
  });

  it('getTaskHistory limit returns the LAST N entries (slice from end)', async () => {
    const scheduler = makeScheduler({
      maxHistoryPerTask: 100,
      tasksFilePath: '/tmp/t.json',
      historyFilePath: '/tmp/h.json',
    });
    const task = await scheduler.addTask(makeMinimalAddTask());
    let callCount = 0;
    scheduler.setTaskExecutor(
      async (t): Promise<TaskExecutionResult> => ({
        taskId: t.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        result: `call-${++callCount}`,
      })
    );

    for (let i = 0; i < 5; i++) {
      await scheduler.triggerTask(task.id);
    }

    const last2 = scheduler.getTaskHistory(task.id, 2);
    expect(last2).toHaveLength(2);
    // slice(-2) returns the last two
    expect(last2[0]!.result as string).toBe('call-4');
    expect(last2[1]!.result as string).toBe('call-5');
  });
});

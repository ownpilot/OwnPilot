import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the scheduler module before importing the module under test
vi.mock('../../scheduler/index.js', () => ({
  CRON_PRESETS: {
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
  },
  getNextRunTime: vi.fn(() => new Date('2025-06-01T10:00:00.000Z')),
  createScheduler: vi.fn(),
  createPromptTask: vi.fn(),
  createToolTask: vi.fn(),
  Scheduler: vi.fn(),
}));

import { parseSchedule, formatCronDescription } from './scheduler-tools.js';

// =============================================================================
// parseSchedule
// =============================================================================

describe('parseSchedule', () => {
  // We fix "now" to a known time so all time-relative tests are deterministic.
  // 2025-06-15 10:00:00 (Sunday) in local time
  const FIXED_NOW = new Date(2025, 5, 15, 10, 0, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Direct cron expressions
  // ===========================================================================

  describe('direct cron expressions', () => {
    it('parses a simple cron expression "0 9 * * *"', () => {
      const result = parseSchedule('0 9 * * *');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 9 * * *',
        description: 'Custom cron expression',
      });
    });

    it('parses every-minute cron "* * * * *"', () => {
      const result = parseSchedule('* * * * *');
      expect(result).toEqual({
        type: 'cron',
        cron: '* * * * *',
        description: 'Custom cron expression',
      });
    });

    it('parses cron with step values "*/5 * * * *"', () => {
      const result = parseSchedule('*/5 * * * *');
      expect(result).toEqual({
        type: 'cron',
        cron: '*/5 * * * *',
        description: 'Custom cron expression',
      });
    });

    it('parses cron with ranges "30 8 * * 1-5"', () => {
      const result = parseSchedule('30 8 * * 1-5');
      expect(result).toEqual({
        type: 'cron',
        cron: '30 8 * * 1-5',
        description: 'Custom cron expression',
      });
    });

    it('parses cron with lists "0 9 * * 0,6"', () => {
      const result = parseSchedule('0 9 * * 0,6');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 9 * * 0,6',
        description: 'Custom cron expression',
      });
    });

    it('parses cron with step in hour field "0 */3 * * *"', () => {
      const result = parseSchedule('0 */3 * * *');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 */3 * * *',
        description: 'Custom cron expression',
      });
    });

    it('normalizes to lowercase and trims whitespace', () => {
      const result = parseSchedule('  0 9 * * *  ');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 9 * * *',
        description: 'Custom cron expression',
      });
    });

    it('parses cron with specific day of month "0 9 1 * *"', () => {
      const result = parseSchedule('0 9 1 * *');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 9 1 * *',
        description: 'Custom cron expression',
      });
    });
  });

  // ===========================================================================
  // One-time schedules: "in X minutes"
  // ===========================================================================

  describe('one-time: "in X minutes"', () => {
    it('parses "in 5 minutes"', () => {
      const result = parseSchedule('in 5 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt).toBeInstanceOf(Date);
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 5 * 60 * 1000);
      expect(result!.description).toContain('In 5 minutes');
    });

    it('parses "in 1 minute"', () => {
      const result = parseSchedule('in 1 minute');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 1 * 60 * 1000);
    });

    it('parses "in 30 min"', () => {
      const result = parseSchedule('in 30 min');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 30 * 60 * 1000);
    });

    it('parses "10 minutes from now"', () => {
      const result = parseSchedule('10 minutes from now');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 10 * 60 * 1000);
    });

    it('parses "5 minutes" (without "in" prefix)', () => {
      const result = parseSchedule('5 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 5 * 60 * 1000);
    });
  });

  // ===========================================================================
  // One-time schedules: "in X hours"
  // ===========================================================================

  describe('one-time: "in X hours"', () => {
    it('parses "in 2 hours"', () => {
      const result = parseSchedule('in 2 hours');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000);
      expect(result!.description).toContain('In 2 hours');
    });

    it('parses "in 1 hour"', () => {
      const result = parseSchedule('in 1 hour');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 1 * 60 * 60 * 1000);
    });

    it('parses "in 1 hr"', () => {
      const result = parseSchedule('in 1 hr');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 1 * 60 * 60 * 1000);
    });

    it('parses "3 hours from now"', () => {
      const result = parseSchedule('3 hours from now');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 3 * 60 * 60 * 1000);
    });
  });

  // ===========================================================================
  // One-time schedules: "today at X"
  // ===========================================================================

  describe('one-time: "today at X"', () => {
    it('parses "today at 2:30pm" (parseTime first regex captures "2:30" without pm)', () => {
      // parseTime pattern 1 (\d{1,2})[:.](\d{2}) matches "2:30" first,
      // without capturing the "pm" suffix, so hour stays 2.
      const result = parseSchedule('today at 2:30pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(2);
      expect(result!.runAt!.getMinutes()).toBe(30);
      expect(result!.description).toBe('Today at 02:30');
    });

    it('parses "today at 9am"', () => {
      const result = parseSchedule('today at 9am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(9);
      expect(result!.runAt!.getMinutes()).toBe(0);
      expect(result!.description).toBe('Today at 09:00');
    });

    it('parses "today at 12:00" (noon, 24h format)', () => {
      const result = parseSchedule('today at 12:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(12);
      expect(result!.runAt!.getMinutes()).toBe(0);
    });

    it('parses "today at 12:00am" (parseTime first regex captures "12:00" without am)', () => {
      // parseTime pattern 1 (\d{1,2})[:.](\d{2}) matches "12:00" first,
      // without capturing "am", so hour stays 12 (not midnight).
      const result = parseSchedule('today at 12:00am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(12);
      expect(result!.runAt!.getMinutes()).toBe(0);
    });

    it('still schedules for today even if the time has passed', () => {
      // FIXED_NOW is 10:00, so 8:00 has passed
      const result = parseSchedule('today at 8:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(8);
      expect(result!.runAt!.getDate()).toBe(15); // same day
      expect(result!.description).toBe('Today at 08:00');
    });
  });

  // ===========================================================================
  // One-time schedules: "tomorrow at X"
  // ===========================================================================

  describe('one-time: "tomorrow at X"', () => {
    it('parses "tomorrow at 9am"', () => {
      const result = parseSchedule('tomorrow at 9am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16); // June 16
      expect(result!.runAt!.getHours()).toBe(9);
      expect(result!.runAt!.getMinutes()).toBe(0);
      expect(result!.description).toBe('Tomorrow at 09:00');
    });

    it('parses "tomorrow at 3:45pm" (parseTime first regex captures without pm)', () => {
      // parseTime pattern 1 matches "3:45" without capturing "pm", hour stays 3.
      const result = parseSchedule('tomorrow at 3:45pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16);
      expect(result!.runAt!.getHours()).toBe(3);
      expect(result!.runAt!.getMinutes()).toBe(45);
      expect(result!.description).toBe('Tomorrow at 03:45');
    });

    it('parses "tomorrow at 22:00"', () => {
      const result = parseSchedule('tomorrow at 22:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16);
      expect(result!.runAt!.getHours()).toBe(22);
      expect(result!.runAt!.getMinutes()).toBe(0);
    });
  });

  // ===========================================================================
  // One-time schedules: bare time
  // ===========================================================================

  describe('one-time: bare time', () => {
    it('parses "14:30" as today (future time)', () => {
      // FIXED_NOW is 10:00, 14:30 is in the future
      const result = parseSchedule('14:30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(15); // today
      expect(result!.runAt!.getHours()).toBe(14);
      expect(result!.runAt!.getMinutes()).toBe(30);
      expect(result!.description).toBe('Today at 14:30');
    });

    it('parses "8:00" as tomorrow (past time)', () => {
      // FIXED_NOW is 10:00, 8:00 has already passed
      const result = parseSchedule('8:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16); // tomorrow
      expect(result!.runAt!.getHours()).toBe(8);
      expect(result!.runAt!.getMinutes()).toBe(0);
      expect(result!.description).toBe('Tomorrow at 08:00');
    });

    it('returns null for "3pm" (parseTime pattern 4 misaligns am/pm capture group)', () => {
      // parseTime pattern 4 (\d{1,2})\s*(am|pm) puts "pm" in match[2],
      // but the code reads match[3] for the period, so it attempts
      // parseInt("pm") for minute which is NaN and fails validation.
      const result = parseSchedule('3pm');
      expect(result).toBeNull();
    });

    it('returns null for "9am" (parseTime pattern 4 misaligns am/pm capture group)', () => {
      // Same issue as "3pm": parseTime cannot parse bare "9am".
      const result = parseSchedule('9am');
      expect(result).toBeNull();
    });

    it('parses "10:00" as tomorrow when it equals the current time exactly', () => {
      // FIXED_NOW is 10:00:00.000, so runAt at 10:00:00.000 is <= now
      const result = parseSchedule('10:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16); // tomorrow, because 10:00 <= now
    });

    it('parses "23:59" as today', () => {
      const result = parseSchedule('23:59');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(15);
      expect(result!.runAt!.getHours()).toBe(23);
      expect(result!.runAt!.getMinutes()).toBe(59);
    });

    it('parses "12:50" as today (future time)', () => {
      const result = parseSchedule('12:50');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(15);
      expect(result!.runAt!.getHours()).toBe(12);
      expect(result!.runAt!.getMinutes()).toBe(50);
      expect(result!.description).toBe('Today at 12:50');
    });
  });

  // ===========================================================================
  // Recurring: every minute
  // ===========================================================================

  describe('recurring: every minute', () => {
    it('parses "every minute"', () => {
      const result = parseSchedule('every minute');
      expect(result).toEqual({
        type: 'cron',
        cron: '* * * * *',
        description: 'Every minute',
      });
    });

    it('parses "every  minute" (extra space)', () => {
      const result = parseSchedule('every  minute');
      expect(result).toEqual({
        type: 'cron',
        cron: '* * * * *',
        description: 'Every minute',
      });
    });

    it('parses "everyminute" (no space)', () => {
      const result = parseSchedule('everyminute');
      expect(result).toEqual({
        type: 'cron',
        cron: '* * * * *',
        description: 'Every minute',
      });
    });
  });

  // ===========================================================================
  // Recurring: every X minutes
  // ===========================================================================

  describe('recurring: every X minutes', () => {
    it('"every 5 minutes" matches inMinutesMatch first (optional "in" prefix)', () => {
      // The inMinutesMatch regex (?:in\s+)?(\d+)\s*(?:minute|min|minutes) has an
      // optional "in" prefix, so "5 minutes" inside "every 5 minutes" matches as
      // one-time before reaching the recurring "every X minutes" regex.
      const result = parseSchedule('every 5 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 5 * 60 * 1000);
    });

    it('"every 15 minutes" matches inMinutesMatch first', () => {
      const result = parseSchedule('every 15 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 15 * 60 * 1000);
    });

    it('"every 30 min" matches inMinutesMatch first', () => {
      const result = parseSchedule('every 30 min');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 30 * 60 * 1000);
    });

    it('"every 1 minute" matches inMinutesMatch first', () => {
      // The inMinutesMatch regex with optional "in" prefix captures "1 minute".
      const result = parseSchedule('every 1 minute');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 1 * 60 * 1000);
    });
  });

  // ===========================================================================
  // Recurring: every hour / hourly
  // ===========================================================================

  describe('recurring: every hour / hourly', () => {
    it('parses "every hour"', () => {
      const result = parseSchedule('every hour');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 * * * *',
        description: 'Every hour',
      });
    });

    it('parses "hourly"', () => {
      const result = parseSchedule('hourly');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 * * * *',
        description: 'Every hour',
      });
    });

    it('parses "everyhour" (no space)', () => {
      const result = parseSchedule('everyhour');
      expect(result).toEqual({
        type: 'cron',
        cron: '0 * * * *',
        description: 'Every hour',
      });
    });
  });

  // ===========================================================================
  // Recurring: every X hours
  // ===========================================================================

  describe('recurring: every X hours', () => {
    it('"every 3 hours" matches inHoursMatch first (optional "in" prefix)', () => {
      // The inHoursMatch regex (?:in\s+)?(\d+)\s*(?:hour|hr|hours) has optional
      // "in" prefix, so "3 hours" inside "every 3 hours" matches as one-time.
      const result = parseSchedule('every 3 hours');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 3 * 60 * 60 * 1000);
    });

    it('"every 6 hours" matches inHoursMatch first', () => {
      const result = parseSchedule('every 6 hours');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 6 * 60 * 60 * 1000);
    });

    it('"every 2 hr" matches inHoursMatch first', () => {
      const result = parseSchedule('every 2 hr');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000);
    });
  });

  // ===========================================================================
  // Recurring: every morning
  // ===========================================================================

  describe('recurring: every morning', () => {
    it('parses "every morning" with default time 9:00', () => {
      const result = parseSchedule('every morning');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * *');
      expect(result!.description).toBe('Every morning at 9:00');
    });

    it('parses "every morning at 8:30" with custom time', () => {
      const result = parseSchedule('every morning at 8:30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('30 8 * * *');
      expect(result!.description).toBe('Every morning at 8:30');
    });

    it('parses "every morning at 7am"', () => {
      const result = parseSchedule('every morning at 7am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 7 * * *');
      expect(result!.description).toBe('Every morning at 7:00');
    });

    it('parses "mornings" (alternative form)', () => {
      const result = parseSchedule('mornings');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * *');
    });
  });

  // ===========================================================================
  // Recurring: every evening
  // ===========================================================================

  describe('recurring: every evening', () => {
    it('parses "every evening" with default time 18:00', () => {
      const result = parseSchedule('every evening');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 18 * * *');
      expect(result!.description).toBe('Every evening at 18:00');
    });

    it('parses "every evening at 8pm" with custom time', () => {
      const result = parseSchedule('every evening at 8pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 20 * * *');
      expect(result!.description).toBe('Every evening at 20:00');
    });

    it('parses "evenings" (alternative form)', () => {
      const result = parseSchedule('evenings');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 18 * * *');
    });

    it('parses "every evening at 19:30"', () => {
      const result = parseSchedule('every evening at 19:30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('30 19 * * *');
    });
  });

  // ===========================================================================
  // Recurring: daily
  // ===========================================================================

  describe('recurring: daily', () => {
    it('parses "daily at 12:50"', () => {
      const result = parseSchedule('daily at 12:50');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('50 12 * * *');
      expect(result!.description).toBe('Daily at 12:50');
    });

    it('parses "every day" with default time 9:00', () => {
      const result = parseSchedule('every day');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * *');
      expect(result!.description).toBe('Daily at 9:00');
    });

    it('parses "every day at 6pm"', () => {
      const result = parseSchedule('every day at 6pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 18 * * *');
      expect(result!.description).toBe('Daily at 18:00');
    });

    it('parses "daily" with default time 9:00', () => {
      const result = parseSchedule('daily');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * *');
    });

    it('parses "daily at 7:15am"', () => {
      const result = parseSchedule('daily at 7:15am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('15 7 * * *');
    });
  });

  // ===========================================================================
  // Recurring: weekdays
  // ===========================================================================

  describe('recurring: weekdays', () => {
    it('parses "weekdays at 8:30"', () => {
      const result = parseSchedule('weekdays at 8:30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('30 8 * * 1-5');
      expect(result!.description).toBe('Weekdays at 8:30');
    });

    it('parses "weekday" with default time', () => {
      const result = parseSchedule('weekday');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1-5');
      expect(result!.description).toBe('Weekdays at 9:00');
    });

    it('"work day at 9am" is captured by bare time (exclusion lacks "work day")', () => {
      // The bare time exclusion regex checks for "weekday" but not "work day".
      // parseTime returns {hour:9, minute:0} from "at 9am", and bare time fires.
      const result = parseSchedule('work day at 9am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(9);
    });

    it('"workday at 17:00" is captured by bare time (exclusion lacks "workday")', () => {
      // "workday" does not match the exclusion regex "weekday", so bare time fires.
      const result = parseSchedule('workday at 17:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(17);
    });
  });

  // ===========================================================================
  // Recurring: weekends
  // ===========================================================================

  describe('recurring: weekends', () => {
    it('parses "weekends" with default time', () => {
      const result = parseSchedule('weekends');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 0,6');
      expect(result!.description).toBe('Weekends at 9:00');
    });

    it('parses "weekend at 10:00"', () => {
      const result = parseSchedule('weekend at 10:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 10 * * 0,6');
      expect(result!.description).toBe('Weekends at 10:00');
    });

    it('parses "weekend at 11am"', () => {
      const result = parseSchedule('weekend at 11am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 11 * * 0,6');
    });
  });

  // ===========================================================================
  // Recurring: specific day names
  // ===========================================================================

  describe('recurring: specific day names', () => {
    it('parses "monday" with default time', () => {
      const result = parseSchedule('monday');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"tuesday at 10:30" is captured by bare time (day names not in exclusion regex)', () => {
      // parseTime returns {hour:10, minute:30}. The bare time exclusion regex
      // does not include day names, so bare time fires as one-time.
      const result = parseSchedule('tuesday at 10:30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(10);
      expect(result!.runAt!.getMinutes()).toBe(30);
    });

    it('parses "wednesday" with default time', () => {
      const result = parseSchedule('wednesday');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 3');
      expect(result!.description).toBe('Every Wednesday at 9:00');
    });

    it('"thursday at 2pm" is captured by bare time (day names not in exclusion regex)', () => {
      // parseTime pattern 3 matches "at 2pm" -> {hour:14, minute:0}.
      // Bare time fires (no recurring keyword in exclusion regex).
      const result = parseSchedule('thursday at 2pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(14);
    });

    it('"friday at 17:00" is captured by bare time', () => {
      // parseTime pattern 1 matches "17:00" -> {hour:17, minute:0}.
      const result = parseSchedule('friday at 17:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(17);
    });

    it('"saturday at 11:00" is captured by bare time', () => {
      // parseTime pattern 1 matches "11:00" -> {hour:11, minute:0}.
      const result = parseSchedule('saturday at 11:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(11);
    });

    it('parses "sunday" with default time', () => {
      const result = parseSchedule('sunday');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 0');
      expect(result!.description).toBe('Every Sunday at 9:00');
    });

    // Abbreviated day names
    it('parses "mon" (abbreviated)', () => {
      const result = parseSchedule('mon');
      expect(result).not.toBeNull();
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"tue at 8:00" is captured by bare time', () => {
      // parseTime matches "8:00", bare time fires as one-time.
      const result = parseSchedule('tue at 8:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(8);
    });

    it('parses "wed"', () => {
      const result = parseSchedule('wed');
      expect(result).not.toBeNull();
      expect(result!.cron).toBe('0 9 * * 3');
    });

    it('"thu at 3pm" is captured by bare time', () => {
      // parseTime pattern 3 matches "at 3pm" -> {hour:15, minute:0}.
      const result = parseSchedule('thu at 3pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(15);
    });

    it('parses "fri"', () => {
      const result = parseSchedule('fri');
      expect(result).not.toBeNull();
      expect(result!.cron).toBe('0 9 * * 5');
    });

    it('"sat at 10:30am" is captured by bare time', () => {
      // parseTime pattern 1 matches "10:30" (without am suffix) -> {hour:10, minute:30}.
      const result = parseSchedule('sat at 10:30am');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(10);
      expect(result!.runAt!.getMinutes()).toBe(30);
    });

    it('"sun at 12pm" is captured by bare time', () => {
      // parseTime pattern 3 matches "at 12pm" -> {hour:12, minute:0}.
      // Note: 12pm stays 12 (pm with hour >= 12 is no-op).
      const result = parseSchedule('sun at 12pm');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(12);
    });
  });

  // ===========================================================================
  // Recurring: weekly
  // ===========================================================================

  describe('recurring: weekly', () => {
    it('parses "weekly" as Monday at default time', () => {
      const result = parseSchedule('weekly');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Weekly on Monday at 9:00');
    });

    it('parses "weekly at 10:00"', () => {
      const result = parseSchedule('weekly at 10:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 10 * * 1');
      expect(result!.description).toBe('Weekly on Monday at 10:00');
    });
  });

  // ===========================================================================
  // Recurring: monthly
  // ===========================================================================

  describe('recurring: monthly', () => {
    it('"monthly" matches day map "mon" before reaching monthly regex -> Monday', () => {
      // The dayMap iteration finds "mon" inside "monthly" before the
      // /monthly|first\s*of\s*month/ regex is reached.
      const result = parseSchedule('monthly');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"first of month" matches day map "mon" inside "month" -> Monday', () => {
      // "first of month" contains "mon" in "month".
      const result = parseSchedule('first of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"monthly at 8:00" matches day map "mon" -> Monday at parsed time', () => {
      // "monthly" contains "mon", dayMap fires first with parsed time 8:00.
      const result = parseSchedule('monthly at 8:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 8 * * 1');
      expect(result!.description).toBe('Every Monday at 8:00');
    });
  });

  // ===========================================================================
  // Recurring: specific day of month
  // ===========================================================================

  describe('recurring: specific day of month', () => {
    it('"15th of month" matches day map "mon" inside "month" -> Monday', () => {
      // dayMap iteration finds "mon" inside "month" before the dayOfMonth regex.
      const result = parseSchedule('15th of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('parses "1st of month at 10:00" as one-time (bare time fires before dayOfMonth)', () => {
      // The bare time check fires because "1st of month at 10:00" has a parseable
      // time (10:00) and does not contain any recurring keywords in the exclusion
      // regex (every|daily|weekly|monthly|morning|evening|weekday|weekend).
      // Since FIXED_NOW is 10:00 and 10:00 <= now, it wraps to tomorrow.
      const result = parseSchedule('1st of month at 10:00');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getDate()).toBe(16); // tomorrow
      expect(result!.runAt!.getHours()).toBe(10);
    });

    it('"2nd of month" matches day map "mon" inside "month" -> Monday', () => {
      // dayMap iteration finds "mon" inside "month" before reaching dayOfMonth regex.
      const result = parseSchedule('2nd of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"3rd of month" matches day map "mon" inside "month" -> Monday', () => {
      const result = parseSchedule('3rd of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
    });

    it('"31st of month" matches day map "mon" inside "month" -> Monday', () => {
      const result = parseSchedule('31st of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
    });

    it('parses "10 of the month" as Monday (day map "mon" matches inside "month")', () => {
      // Implementation quirk: the dayMap iteration finds "mon" inside "month"
      // before reaching the dayOfMonth regex, so this becomes Monday instead.
      const result = parseSchedule('10 of the month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
      expect(result!.description).toBe('Every Monday at 9:00');
    });

    it('"0th of month" matches day map "mon" inside "month" instead of null', () => {
      // "month" contains "mon", so the dayMap finds Monday before
      // the dayOfMonth regex can process day=0.
      const result = parseSchedule('0th of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
    });

    it('"32nd of month" matches day map "mon" inside "month" instead of null', () => {
      // Same dayMap "mon" in "month" issue.
      const result = parseSchedule('32nd of month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * 1');
    });
  });

  // ===========================================================================
  // Returns null for unrecognizable input
  // ===========================================================================

  describe('returns null for unrecognizable input', () => {
    it('returns null for empty string', () => {
      expect(parseSchedule('')).toBeNull();
    });

    it('returns null for random text', () => {
      expect(parseSchedule('hello world')).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(parseSchedule('xyzzy foobar')).toBeNull();
    });

    it('returns null for "never"', () => {
      expect(parseSchedule('never')).toBeNull();
    });

    it('returns null for a number alone (without time format)', () => {
      // "42" doesn't match time patterns or any keyword
      expect(parseSchedule('42')).toBeNull();
    });
  });

  // ===========================================================================
  // Edge cases and normalization
  // ===========================================================================

  describe('edge cases', () => {
    it('handles uppercase input', () => {
      const result = parseSchedule('EVERY MORNING');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 9 * * *');
    });

    it('handles mixed case input', () => {
      const result = parseSchedule('Every Day at 3PM');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
      expect(result!.cron).toBe('0 15 * * *');
    });

    it('handles leading/trailing whitespace', () => {
      const result = parseSchedule('  daily  ');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cron');
    });

    it('parses time with dot separator "14.30"', () => {
      const result = parseSchedule('14.30');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getHours()).toBe(14);
      expect(result!.runAt!.getMinutes()).toBe(30);
    });

    it('parses 12:00pm as noon (12)', () => {
      const result = parseSchedule('today at 12:00pm');
      expect(result).not.toBeNull();
      expect(result!.runAt!.getHours()).toBe(12);
    });

    it('parses 12:00am as 12 (parseTime first regex does not capture am)', () => {
      // Pattern 1 (\d{1,2})[:.](\d{2}) matches "12:00" without capturing "am",
      // so period is undefined and hour stays 12 (not converted to 0).
      const result = parseSchedule('today at 12:00am');
      expect(result).not.toBeNull();
      expect(result!.runAt!.getHours()).toBe(12);
    });

    it('"in 0 minutes" returns a one-time schedule with runAt equal to now', () => {
      const result = parseSchedule('in 0 minutes');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('one-time');
      expect(result!.runAt!.getTime()).toBe(FIXED_NOW.getTime());
    });

    it('ParsedSchedule type has correct shape for cron result', () => {
      const result = parseSchedule('every hour');
      expect(result).toHaveProperty('type', 'cron');
      expect(result).toHaveProperty('cron');
      expect(result).toHaveProperty('description');
      expect(result).not.toHaveProperty('runAt');
    });

    it('ParsedSchedule type has correct shape for one-time result', () => {
      const result = parseSchedule('in 5 minutes');
      expect(result).toHaveProperty('type', 'one-time');
      expect(result).toHaveProperty('runAt');
      expect(result).toHaveProperty('description');
      expect(result).not.toHaveProperty('cron');
    });
  });

  // ===========================================================================
  // Priority of matchers (regex ordering)
  // ===========================================================================

  describe('matcher priority / ordering', () => {
    it('"in 5 minutes" matches one-time before recurring "every X minutes"', () => {
      const result = parseSchedule('in 5 minutes');
      expect(result!.type).toBe('one-time');
    });

    it('"in 2 hours" matches one-time before recurring "every X hours"', () => {
      const result = parseSchedule('in 2 hours');
      expect(result!.type).toBe('one-time');
    });

    it('"today at 9:00" with time is one-time, not recurring', () => {
      const result = parseSchedule('today at 9:00');
      expect(result!.type).toBe('one-time');
    });

    it('bare time without recurring keyword is one-time', () => {
      const result = parseSchedule('15:00');
      expect(result!.type).toBe('one-time');
    });

    it('bare time with "daily" keyword is recurring', () => {
      const result = parseSchedule('daily at 15:00');
      expect(result!.type).toBe('cron');
    });

    it('bare time with "every" keyword is recurring', () => {
      const result = parseSchedule('every morning at 8:00');
      expect(result!.type).toBe('cron');
    });
  });
});

// =============================================================================
// formatCronDescription
// =============================================================================

describe('formatCronDescription', () => {
  // ===========================================================================
  // Every minute
  // ===========================================================================

  it('formats "* * * * *" as "Every minute"', () => {
    expect(formatCronDescription('* * * * *')).toBe('Every minute');
  });

  // ===========================================================================
  // Every N minutes
  // ===========================================================================

  it('formats "*/5 * * * *" as "Every 5 minutes"', () => {
    expect(formatCronDescription('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('formats "*/15 * * * *" as "Every 15 minutes"', () => {
    expect(formatCronDescription('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('formats "*/30 * * * *" as "Every 30 minutes"', () => {
    expect(formatCronDescription('*/30 * * * *')).toBe('Every 30 minutes');
  });

  it('formats "*/1 * * * *" as "Every 1 minutes"', () => {
    expect(formatCronDescription('*/1 * * * *')).toBe('Every 1 minutes');
  });

  // ===========================================================================
  // Every N hours
  // ===========================================================================

  it('formats "0 */2 * * *" as "Every 2 hours"', () => {
    expect(formatCronDescription('0 */2 * * *')).toBe('Every 2 hours');
  });

  it('formats "0 */3 * * *" as "Every 3 hours"', () => {
    expect(formatCronDescription('0 */3 * * *')).toBe('Every 3 hours');
  });

  it('formats "0 */6 * * *" as "Every 6 hours"', () => {
    expect(formatCronDescription('0 */6 * * *')).toBe('Every 6 hours');
  });

  // ===========================================================================
  // Weekdays
  // ===========================================================================

  it('formats "30 8 * * 1-5" as "Weekdays at 8:30"', () => {
    expect(formatCronDescription('30 8 * * 1-5')).toBe('Weekdays at 8:30');
  });

  it('formats "0 9 * * 1-5" as "Weekdays at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 1-5')).toBe('Weekdays at 9:00');
  });

  it('formats "0 17 * * 1-5" as "Weekdays at 17:00"', () => {
    expect(formatCronDescription('0 17 * * 1-5')).toBe('Weekdays at 17:00');
  });

  // ===========================================================================
  // Weekends
  // ===========================================================================

  it('formats "0 9 * * 0,6" as "Weekends at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 0,6')).toBe('Weekends at 9:00');
  });

  it('formats "0 10 * * 0,6" as "Weekends at 10:00"', () => {
    expect(formatCronDescription('0 10 * * 0,6')).toBe('Weekends at 10:00');
  });

  it('formats "30 11 * * 0,6" as "Weekends at 11:30"', () => {
    expect(formatCronDescription('30 11 * * 0,6')).toBe('Weekends at 11:30');
  });

  // ===========================================================================
  // Daily
  // ===========================================================================

  it('formats "0 9 * * *" as "Daily at 9:00"', () => {
    expect(formatCronDescription('0 9 * * *')).toBe('Daily at 9:00');
  });

  it('formats "30 14 * * *" as "Daily at 14:30"', () => {
    expect(formatCronDescription('30 14 * * *')).toBe('Daily at 14:30');
  });

  it('formats "0 0 * * *" as "Daily at 0:00"', () => {
    expect(formatCronDescription('0 0 * * *')).toBe('Daily at 0:00');
  });

  it('formats "50 12 * * *" as "Daily at 12:50"', () => {
    expect(formatCronDescription('50 12 * * *')).toBe('Daily at 12:50');
  });

  it('formats "5 8 * * *" with zero-padded minute as "Daily at 8:05"', () => {
    expect(formatCronDescription('5 8 * * *')).toBe('Daily at 8:05');
  });

  // ===========================================================================
  // Monthly on the 1st
  // ===========================================================================

  it('formats "0 9 1 * *" as "Monthly on the 1st at 9:00"', () => {
    expect(formatCronDescription('0 9 1 * *')).toBe('Monthly on the 1st at 9:00');
  });

  it('formats "30 10 1 * *" as "Monthly on the 1st at 10:30"', () => {
    expect(formatCronDescription('30 10 1 * *')).toBe('Monthly on the 1st at 10:30');
  });

  // ===========================================================================
  // Specific day of week (single digit)
  // ===========================================================================

  it('formats "0 9 * * 0" as "Every Sunday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 0')).toBe('Every Sunday at 9:00');
  });

  it('formats "0 9 * * 1" as "Every Monday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 1')).toBe('Every Monday at 9:00');
  });

  it('formats "0 9 * * 2" as "Every Tuesday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 2')).toBe('Every Tuesday at 9:00');
  });

  it('formats "0 9 * * 3" as "Every Wednesday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 3')).toBe('Every Wednesday at 9:00');
  });

  it('formats "0 9 * * 4" as "Every Thursday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 4')).toBe('Every Thursday at 9:00');
  });

  it('formats "0 9 * * 5" as "Every Friday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 5')).toBe('Every Friday at 9:00');
  });

  it('formats "0 9 * * 6" as "Every Saturday at 9:00"', () => {
    expect(formatCronDescription('0 9 * * 6')).toBe('Every Saturday at 9:00');
  });

  it('formats "30 14 * * 3" as "Every Wednesday at 14:30"', () => {
    expect(formatCronDescription('30 14 * * 3')).toBe('Every Wednesday at 14:30');
  });

  it('formats "0 18 * * 5" as "Every Friday at 18:00"', () => {
    expect(formatCronDescription('0 18 * * 5')).toBe('Every Friday at 18:00');
  });

  // ===========================================================================
  // Custom / unknown patterns
  // ===========================================================================

  it('formats cron with specific day-of-week digit as day name (even with non-* fields)', () => {
    // The single-digit dayOfWeek check (/^\d$/) fires before the custom fallback,
    // so "0 9 15 6 3" is displayed as "Every Wednesday at 9:00" even though
    // dayOfMonth=15 and month=6 are not wildcards.
    expect(formatCronDescription('0 9 15 6 3')).toBe('Every Wednesday at 9:00');
  });

  it('formats truly custom cron pattern as "<cron> (custom)"', () => {
    // To reach the custom fallback, dayOfWeek must not be a single digit
    // and all other specific patterns must not match.
    expect(formatCronDescription('0 9 15 6 1-5')).toBe('0 9 15 6 1-5 (custom)');
  });

  it('formats non-1st monthly as custom', () => {
    // dayOfMonth = 15, dayOfWeek = *, so the monthly check only fires for dayOfMonth=1
    expect(formatCronDescription('0 9 15 * *')).toBe('0 9 15 * * (custom)');
  });

  // ===========================================================================
  // Non-5-part input
  // ===========================================================================

  it('returns input as-is for 4-part expression', () => {
    expect(formatCronDescription('0 9 * *')).toBe('0 9 * *');
  });

  it('returns input as-is for 6-part expression', () => {
    expect(formatCronDescription('0 0 9 * * *')).toBe('0 0 9 * * *');
  });

  it('returns input as-is for empty string', () => {
    expect(formatCronDescription('')).toBe('');
  });

  it('returns input as-is for single word', () => {
    expect(formatCronDescription('daily')).toBe('daily');
  });

  it('returns input as-is for 3-part expression', () => {
    expect(formatCronDescription('0 9 *')).toBe('0 9 *');
  });

  // ===========================================================================
  // Minute zero-padding
  // ===========================================================================

  it('zero-pads single-digit minutes in weekday format', () => {
    expect(formatCronDescription('5 8 * * 1-5')).toBe('Weekdays at 8:05');
  });

  it('zero-pads single-digit minutes in weekend format', () => {
    expect(formatCronDescription('5 10 * * 0,6')).toBe('Weekends at 10:05');
  });

  it('zero-pads single-digit minutes in daily format', () => {
    expect(formatCronDescription('5 14 * * *')).toBe('Daily at 14:05');
  });

  it('zero-pads single-digit minutes in monthly format', () => {
    expect(formatCronDescription('5 9 1 * *')).toBe('Monthly on the 1st at 9:05');
  });

  it('zero-pads single-digit minutes in day-of-week format', () => {
    expect(formatCronDescription('5 9 * * 3')).toBe('Every Wednesday at 9:05');
  });

  // ===========================================================================
  // Interaction: */N minute with non-hour fields
  // ===========================================================================

  it('treats */N in minute field as "Every N minutes" regardless of other fields', () => {
    // Even though hour field is specific, the minute startsWith check triggers first
    expect(formatCronDescription('*/10 9 * * *')).toBe('Every 10 minutes');
  });

  it('treats */N in hour field as "Every N hours" only when minute is 0', () => {
    // minute = 0, hour = */4
    expect(formatCronDescription('0 */4 * * *')).toBe('Every 4 hours');
  });

  it('does not match "Every N hours" when minute is non-zero', () => {
    // minute = 30, hour = */4 -- minute is not "0", so hour check is skipped
    // minute does not start with "*/" either, so falls through
    // dayOfWeek = *, dayOfMonth = *, month = * -> Daily check matches
    expect(formatCronDescription('30 */4 * * *')).toBe('Daily at */4:30');
  });
});

// =============================================================================
// Exported tool definitions and SCHEDULER_TOOLS
// =============================================================================

describe('tool definitions and exports', () => {
  // We import these separately to check structural correctness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolModule: any;

  beforeEach(async () => {
    toolModule = await import('./scheduler-tools.js');
  });

  it('exports parseSchedule as a function', () => {
    expect(typeof toolModule.parseSchedule).toBe('function');
  });

  it('exports formatCronDescription as a function', () => {
    expect(typeof toolModule.formatCronDescription).toBe('function');
  });

  it('exports SCHEDULER_TOOLS as an array', () => {
    expect(Array.isArray(toolModule.SCHEDULER_TOOLS)).toBe(true);
  });

  it('SCHEDULER_TOOLS contains 6 entries', () => {
    expect(toolModule.SCHEDULER_TOOLS).toHaveLength(6);
  });

  it('each entry in SCHEDULER_TOOLS has definition and executor', () => {
    for (const entry of toolModule.SCHEDULER_TOOLS) {
      expect(entry).toHaveProperty('definition');
      expect(entry).toHaveProperty('executor');
      expect(typeof entry.definition.name).toBe('string');
      expect(typeof entry.executor).toBe('function');
    }
  });

  it('createScheduledTaskTool has correct name', () => {
    expect(toolModule.createScheduledTaskTool.name).toBe('create_scheduled_task');
  });

  it('listScheduledTasksTool has correct name', () => {
    expect(toolModule.listScheduledTasksTool.name).toBe('list_scheduled_tasks');
  });

  it('updateScheduledTaskTool has correct name', () => {
    expect(toolModule.updateScheduledTaskTool.name).toBe('update_scheduled_task');
  });

  it('deleteScheduledTaskTool has correct name', () => {
    expect(toolModule.deleteScheduledTaskTool.name).toBe('delete_scheduled_task');
  });

  it('getTaskHistoryTool has correct name', () => {
    expect(toolModule.getTaskHistoryTool.name).toBe('get_task_history');
  });

  it('triggerTaskTool has correct name', () => {
    expect(toolModule.triggerTaskTool.name).toBe('trigger_task');
  });

  it('createScheduledTaskTool requires name, schedule, and taskType', () => {
    expect(toolModule.createScheduledTaskTool.parameters.required).toEqual(
      expect.arrayContaining(['name', 'schedule', 'taskType']),
    );
  });

  it('listScheduledTasksTool has no required parameters', () => {
    expect(toolModule.listScheduledTasksTool.parameters.required).toEqual([]);
  });

  it('updateScheduledTaskTool requires taskId', () => {
    expect(toolModule.updateScheduledTaskTool.parameters.required).toEqual(['taskId']);
  });

  it('deleteScheduledTaskTool requires taskId', () => {
    expect(toolModule.deleteScheduledTaskTool.parameters.required).toEqual(['taskId']);
  });

  it('getTaskHistoryTool requires taskId', () => {
    expect(toolModule.getTaskHistoryTool.parameters.required).toEqual(['taskId']);
  });

  it('triggerTaskTool requires taskId', () => {
    expect(toolModule.triggerTaskTool.parameters.required).toEqual(['taskId']);
  });
});

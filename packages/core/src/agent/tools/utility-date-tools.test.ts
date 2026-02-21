import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCurrentDateTimeExecutor,
  dateDiffExecutor,
  dateAddExecutor,
} from './utility-date-tools.js';

describe('getCurrentDateTimeExecutor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return iso format with iso string and timezone', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'iso' });
    const data = JSON.parse(result.content as string);
    expect(data.iso).toBe('2026-06-15T10:30:00.000Z');
    expect(data.timezone).toBeDefined();
  });

  it('should return unix format with unix seconds and milliseconds', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'unix' });
    const data = JSON.parse(result.content as string);
    expect(data.unixMs).toBe(new Date('2026-06-15T10:30:00.000Z').getTime());
    expect(data.unix).toBe(Math.floor(new Date('2026-06-15T10:30:00.000Z').getTime() / 1000));
    expect(data.timezone).toBeDefined();
  });

  it('should return locale format with formatted string and timezone', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'locale' });
    const data = JSON.parse(result.content as string);
    expect(typeof data.formatted).toBe('string');
    expect(data.formatted.length).toBeGreaterThan(0);
    expect(data.timezone).toBeDefined();
  });

  it('should return all fields when format is all', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'all' });
    const data = JSON.parse(result.content as string);
    expect(data.iso).toBe('2026-06-15T10:30:00.000Z');
    expect(typeof data.formatted).toBe('string');
    expect(data.unix).toBe(Math.floor(new Date('2026-06-15T10:30:00.000Z').getTime() / 1000));
    expect(data.unixMs).toBe(new Date('2026-06-15T10:30:00.000Z').getTime());
    expect(data.timezone).toBeDefined();
    expect(typeof data.date).toBe('string');
    expect(typeof data.time).toBe('string');
    expect(typeof data.dayOfWeek).toBe('string');
    expect(typeof data.weekNumber).toBe('number');
    expect(typeof data.quarter).toBe('number');
    expect(typeof data.isWeekend).toBe('boolean');
  });

  it('should default to all format when no format specified', async () => {
    const result = await getCurrentDateTimeExecutor({});
    const data = JSON.parse(result.content as string);
    expect(data.iso).toBeDefined();
    expect(data.formatted).toBeDefined();
    expect(data.unix).toBeDefined();
    expect(data.unixMs).toBeDefined();
    expect(data.dayOfWeek).toBeDefined();
    expect(data.weekNumber).toBeDefined();
    expect(data.quarter).toBeDefined();
    expect(data.isWeekend).toBeDefined();
  });

  it('should use explicit timezone when provided', async () => {
    const result = await getCurrentDateTimeExecutor({
      format: 'iso',
      timezone: 'UTC',
    });
    const data = JSON.parse(result.content as string);
    expect(data.timezone).toBe('UTC');
  });

  it('should return error for invalid timezone', async () => {
    const result = await getCurrentDateTimeExecutor({
      timezone: 'Invalid/Fake_Zone',
    });
    const data = JSON.parse(result.content as string);
    expect(data.error).toMatch(/Invalid timezone/i);
    expect(result.isError).toBe(true);
  });

  it('should compute quarter 2 for month June', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'all' });
    const data = JSON.parse(result.content as string);
    expect(data.quarter).toBe(2);
  });

  it('should return weekNumber as a number between 1 and 53', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'all' });
    const data = JSON.parse(result.content as string);
    expect(data.weekNumber).toBeGreaterThanOrEqual(1);
    expect(data.weekNumber).toBeLessThanOrEqual(53);
  });

  it('should report isWeekend false for Monday June 15 2026', async () => {
    const result = await getCurrentDateTimeExecutor({
      format: 'all',
      timezone: 'UTC',
    });
    const data = JSON.parse(result.content as string);
    expect(data.isWeekend).toBe(false);
  });

  it('should report isWeekend true for a Saturday', async () => {
    vi.setSystemTime(new Date('2026-06-13T10:30:00.000Z'));
    const result = await getCurrentDateTimeExecutor({
      format: 'all',
      timezone: 'UTC',
    });
    const data = JSON.parse(result.content as string);
    expect(data.isWeekend).toBe(true);
  });
});

describe('dateDiffExecutor', () => {
  it('should return zero difference for identical dates', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-15T10:00:00.000Z',
      date2: '2026-06-15T10:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference.days).toBe(0);
    expect(data.difference.hours).toBe(0);
    expect(data.difference.minutes).toBe(0);
    expect(data.difference.seconds).toBe(0);
    expect(data.isPositive).toBe(true);
  });

  it('should compute 10 days difference', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-01T00:00:00.000Z',
      date2: '2026-06-11T00:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference.days).toBe(10);
    expect(data.isPositive).toBe(true);
  });

  it('should return single number for specific unit days', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-01T00:00:00.000Z',
      date2: '2026-06-11T00:00:00.000Z',
      unit: 'days',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference).toBe(10);
    expect(data.unit).toBe('days');
  });

  it('should return hours for specific unit hours', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-01T00:00:00.000Z',
      date2: '2026-06-01T12:00:00.000Z',
      unit: 'hours',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference).toBe(12);
    expect(data.unit).toBe('hours');
  });

  it('should report isPositive false when date2 is before date1', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-15T00:00:00.000Z',
      date2: '2026-06-10T00:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.isPositive).toBe(false);
  });

  it('should return error for invalid date1', async () => {
    const result = await dateDiffExecutor({
      date1: 'not-a-date',
      date2: '2026-06-15T00:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.error).toMatch(/Invalid date/i);
    expect(result.isError).toBe(true);
  });

  it('should return error for invalid date2', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-06-15T00:00:00.000Z',
      date2: 'garbage',
    });
    const data = JSON.parse(result.content as string);
    expect(data.error).toMatch(/Invalid date/i);
    expect(result.isError).toBe(true);
  });

  it('should compute approximately 1 year for dates one year apart', async () => {
    const result = await dateDiffExecutor({
      date1: '2025-06-15T00:00:00.000Z',
      date2: '2026-06-15T00:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference.years).toBeCloseTo(1, 0);
  });

  it('should include from and to as ISO strings', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-01-01T00:00:00.000Z',
      date2: '2026-06-01T00:00:00.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.from).toBe('2026-01-01T00:00:00.000Z');
    expect(data.to).toBe('2026-06-01T00:00:00.000Z');
  });

  it('should include all 7 difference units in all mode', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-01-01T00:00:00.000Z',
      date2: '2026-06-15T12:30:45.000Z',
    });
    const data = JSON.parse(result.content as string);
    expect(data.difference).toHaveProperty('years');
    expect(data.difference).toHaveProperty('months');
    expect(data.difference).toHaveProperty('weeks');
    expect(data.difference).toHaveProperty('days');
    expect(data.difference).toHaveProperty('hours');
    expect(data.difference).toHaveProperty('minutes');
    expect(data.difference).toHaveProperty('seconds');
  });

  it('should compute months using diffDays / 30.44', async () => {
    const result = await dateDiffExecutor({
      date1: '2026-01-01T00:00:00.000Z',
      date2: '2026-04-01T00:00:00.000Z',
      unit: 'months',
    });
    const data = JSON.parse(result.content as string);
    // 90 days / 30.44 ≈ 2.956
    expect(data.difference).toBeCloseTo(2.956, 1);
  });
});

describe('dateAddExecutor', () => {
  it('should add 10 days to a fixed date', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-01T00:00:00.000Z',
      amount: 10,
      unit: 'days',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-06-11T00:00:00.000Z');
    expect(data.original).toBe('2026-06-01T00:00:00.000Z');
    expect(data.added.amount).toBe(10);
    expect(data.added.unit).toBe('days');
  });

  it('should subtract 5 hours with negative amount', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T10:00:00.000Z',
      amount: -5,
      unit: 'hours',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-06-15T05:00:00.000Z');
  });

  it('should add 1 month', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T00:00:00.000Z',
      amount: 1,
      unit: 'months',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-07-15T00:00:00.000Z');
  });

  it('should add 1 year', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T00:00:00.000Z',
      amount: 1,
      unit: 'years',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2027-06-15T00:00:00.000Z');
  });

  it('should add 2 weeks (14 days)', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-01T00:00:00.000Z',
      amount: 2,
      unit: 'weeks',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-06-15T00:00:00.000Z');
  });

  it('should add 30 minutes', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T10:00:00.000Z',
      amount: 30,
      unit: 'minutes',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-06-15T10:30:00.000Z');
  });

  it('should add 120 seconds', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T10:00:00.000Z',
      amount: 120,
      unit: 'seconds',
    });
    const data = JSON.parse(result.content as string);
    expect(data.result).toBe('2026-06-15T10:02:00.000Z');
  });

  it('should handle "now" as date string with fake timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T10:30:00.000Z'));
    try {
      const result = await dateAddExecutor({
        date: 'now',
        amount: 1,
        unit: 'days',
      });
      const data = JSON.parse(result.content as string);
      expect(data.result).toBe('2026-06-16T10:30:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return error for invalid date', async () => {
    const result = await dateAddExecutor({
      date: 'not-a-date',
      amount: 1,
      unit: 'days',
    });
    const data = JSON.parse(result.content as string);
    expect(data.error).toMatch(/Invalid date/i);
    expect(result.isError).toBe(true);
  });

  it('should include original, result, resultFormatted, and added in response', async () => {
    const result = await dateAddExecutor({
      date: '2026-06-15T00:00:00.000Z',
      amount: 3,
      unit: 'days',
    });
    const data = JSON.parse(result.content as string);
    expect(data.original).toBeDefined();
    expect(data.result).toBeDefined();
    expect(typeof data.resultFormatted).toBe('string');
    expect(data.added).toEqual({ amount: 3, unit: 'days' });
  });
});

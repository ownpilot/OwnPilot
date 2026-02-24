/**
 * Tests for time-tools executors
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TIME_EXECUTORS } from './time-tools.js';

const exec = (name: string, args: Record<string, unknown> = {}) =>
  TIME_EXECUTORS[name]!(args, {} as never);

describe('get_current_time', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns current time for default UTC timezone', async () => {
    const result = await exec('get_current_time', {});
    expect(result.content).toContain('Current time in UTC:');
  });

  it('returns current time for a specific timezone', async () => {
    const result = await exec('get_current_time', { timezone: 'America/New_York' });
    expect(result.content).toContain('Current time in America/New_York:');
  });

  it('falls back to UTC ISO string for invalid timezone', async () => {
    const result = await exec('get_current_time', { timezone: 'Invalid/Zone' });
    expect(result.content).toContain('Current time (UTC):');
  });

  it('uses UTC when timezone arg is undefined', async () => {
    const result = await exec('get_current_time', {});
    expect(result.content).toMatch(/^Current time in UTC:/);
  });
});

describe('format_date', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('handles now', async () => {
    const result = await exec('format_date', { date: 'now', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('handles today', async () => {
    const result = await exec('format_date', { date: 'today', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('handles tomorrow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: 'tomorrow', format: 'iso' });
    expect(result.content).toContain('2026-01-16');
  });
  it('handles yesterday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: 'yesterday', format: 'iso' });
    expect(result.content).toContain('2026-01-14');
  });
  it('handles next week', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: 'next week', format: 'iso' });
    expect(result.content).toContain('2026-01-22');
  });
  it('is case insensitive for TODAY', async () => {
    const result = await exec('format_date', { date: 'TODAY', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('is case insensitive for YESTERDAY', async () => {
    const result = await exec('format_date', { date: 'YESTERDAY', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('is case insensitive for Next Week', async () => {
    const result = await exec('format_date', { date: 'Next Week', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('formats as iso', async () => {
    const result = await exec('format_date', { date: '2026-01-15', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('formats as short', async () => {
    const result = await exec('format_date', { date: '2026-01-15', format: 'short' });
    expect(result.content).toMatch(/\d+\/\d+\/\d+/);
  });
  it('formats as long (default)', async () => {
    const result = await exec('format_date', { date: '2026-01-15' });
    expect(result.content).toContain('January');
  });
  it('formats as long explicitly', async () => {
    const result = await exec('format_date', { date: '2026-01-15', format: 'long' });
    expect(result.content).toContain('January');
  });
  it('formats as relative - today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: '2026-01-15T12:00:00Z', format: 'relative' });
    expect(result.content).toBe('Today');
  });
  it('formats as relative - tomorrow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: '2026-01-16T12:00:00Z', format: 'relative' });
    expect(result.content).toBe('Tomorrow');
  });
  it('formats as relative - yesterday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: '2026-01-14T12:00:00Z', format: 'relative' });
    expect(result.content).toBe('Yesterday');
  });
  it('formats as relative - future days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: '2026-01-20T12:00:00Z', format: 'relative' });
    expect(result.content).toBe('In 5 days');
  });
  it('formats as relative - past days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const result = await exec('format_date', { date: '2026-01-10T12:00:00Z', format: 'relative' });
    expect(result.content).toBe('5 days ago');
  });
  it('uses ISO for unknown format', async () => {
    const result = await exec('format_date', { date: '2026-01-15', format: 'custom_xyz' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('applies timezone to short format', async () => {
    const result = await exec('format_date', { date: '2026-01-15T23:00:00Z', format: 'short', timezone: 'America/New_York' });
    expect(result.content).toMatch(/\d+\/\d+\/\d+/);
  });
  it('applies timezone to long format', async () => {
    const result = await exec('format_date', { date: '2026-01-15T23:00:00Z', format: 'long', timezone: 'Asia/Tokyo' });
    expect(result.content).toContain('2026');
  });
  it('returns error for invalid date string', async () => {
    const result = await exec('format_date', { date: 'not-a-date-at-all' });
    expect(result.content).toContain('Error:');
    expect(result.isError).toBe(true);
  });
  it('returns error for garbage input', async () => {
    const result = await exec('format_date', { date: '!!!invalid!!!' });
    expect(result.isError).toBe(true);
  });
});

describe('date_diff', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('calculates difference in days (default unit)', async () => {
    const result = await exec('date_diff', { date1: '2026-01-10T00:00:00Z', date2: '2026-01-15T00:00:00Z' });
    expect(result.content).toBe('5.00 days');
  });
  it('calculates difference in seconds', async () => {
    const result = await exec('date_diff', { date1: '2026-01-15T00:00:00Z', date2: '2026-01-15T00:01:00Z', unit: 'seconds' });
    expect(result.content).toBe('60.00 seconds');
  });
  it('calculates difference in minutes', async () => {
    const result = await exec('date_diff', { date1: '2026-01-15T00:00:00Z', date2: '2026-01-15T02:00:00Z', unit: 'minutes' });
    expect(result.content).toBe('120.00 minutes');
  });
  it('calculates difference in hours', async () => {
    const result = await exec('date_diff', { date1: '2026-01-15T00:00:00Z', date2: '2026-01-15T12:00:00Z', unit: 'hours' });
    expect(result.content).toBe('12.00 hours');
  });
  it('calculates difference in weeks', async () => {
    const result = await exec('date_diff', { date1: '2026-01-01T00:00:00Z', date2: '2026-01-15T00:00:00Z', unit: 'weeks' });
    expect(result.content).toBe('2.00 weeks');
  });
  it('calculates difference in months', async () => {
    const result = await exec('date_diff', { date1: '2026-01-01T00:00:00Z', date2: '2026-03-02T10:33:36Z', unit: 'months' });
    expect(result.content).toMatch(/months$/);
  });
  it('calculates difference in years', async () => {
    const result = await exec('date_diff', { date1: '2025-01-01T00:00:00Z', date2: '2026-01-01T00:00:00Z', unit: 'years' });
    expect(result.content).toMatch(/years$/);
  });
  it('defaults date2 to now when not provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-20T00:00:00Z'));
    const result = await exec('date_diff', { date1: '2026-01-15T00:00:00Z', unit: 'days' });
    expect(result.content).toBe('5.00 days');
  });
  it('returns negative values when date1 is after date2', async () => {
    const result = await exec('date_diff', { date1: '2026-01-20T00:00:00Z', date2: '2026-01-15T00:00:00Z', unit: 'days' });
    expect(result.content).toBe('-5.00 days');
  });
  it('returns error for invalid date1', async () => {
    const result = await exec('date_diff', { date1: 'not-a-date', date2: '2026-01-15T00:00:00Z' });
    expect(result.content).toBe('Error: Invalid date');
    expect(result.isError).toBe(true);
  });
  it('returns error for invalid date2', async () => {
    const result = await exec('date_diff', { date1: '2026-01-15T00:00:00Z', date2: 'garbage' });
    expect(result.content).toBe('Error: Invalid date');
    expect(result.isError).toBe(true);
  });
  it('returns error for unknown unit', async () => {
    const result = await exec('date_diff', { date1: '2026-01-01T00:00:00Z', date2: '2026-01-15T00:00:00Z', unit: 'fortnights' });
    expect(result.content).toBe('Error: Unknown unit: fortnights');
    expect(result.isError).toBe(true);
  });
});

describe('add_to_date', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('adds seconds', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 30, unit: 'seconds' });
    expect(result.content).toBe('2026-01-15T00:00:30.000Z');
  });
  it('adds minutes', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 45, unit: 'minutes' });
    expect(result.content).toBe('2026-01-15T00:45:00.000Z');
  });
  it('adds hours', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 5, unit: 'hours' });
    expect(result.content).toBe('2026-01-15T05:00:00.000Z');
  });
  it('adds days', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 10, unit: 'days' });
    expect(result.content).toBe('2026-01-25T00:00:00.000Z');
  });
  it('adds weeks', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 2, unit: 'weeks' });
    expect(result.content).toBe('2026-01-29T00:00:00.000Z');
  });
  it('adds months', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 3, unit: 'months' });
    expect(result.content).toContain('2026-04');
  });
  it('adds years', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: 2, unit: 'years' });
    expect(result.content).toBe('2028-01-15T00:00:00.000Z');
  });
  it('subtracts days', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: -5, unit: 'days' });
    expect(result.content).toBe('2026-01-10T00:00:00.000Z');
  });
  it('subtracts months', async () => {
    const result = await exec('add_to_date', { date: '2026-06-15T00:00:00.000Z', amount: -3, unit: 'months' });
    expect(result.content).toContain('2026-03-15');
  });
  it('subtracts years', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00.000Z', amount: -1, unit: 'years' });
    expect(result.content).toBe('2025-01-15T00:00:00.000Z');
  });
  it('defaults date to now when not provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    const result = await exec('add_to_date', { amount: 1, unit: 'days' });
    expect(result.content).toBe('2026-01-16T00:00:00.000Z');
  });
  it('returns error for invalid date', async () => {
    const result = await exec('add_to_date', { date: 'not-a-date', amount: 5, unit: 'days' });
    expect(result.content).toBe('Error: Invalid date');
    expect(result.isError).toBe(true);
  });
  it('returns error for unknown unit', async () => {
    const result = await exec('add_to_date', { date: '2026-01-15T00:00:00Z', amount: 5, unit: 'centuries' });
    expect(result.content).toBe('Error: Unknown unit: centuries');
    expect(result.isError).toBe(true);
  });
});

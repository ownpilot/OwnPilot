/**
 * HeartbeatParser Tests
 *
 * Tests for NL-to-cron parsing and markdown parsing.
 */

import { describe, it, expect } from 'vitest';
import { parseSchedule, parseMarkdown, HeartbeatParseError } from './heartbeat-parser.js';

describe('parseSchedule', () => {
  // ==========================================================================
  // Every Morning / Evening / Night
  // ==========================================================================

  it('parses "Every Morning" with default time', () => {
    const result = parseSchedule('Every Morning');
    expect(result.cron).toBe('0 8 * * *');
    expect(result.normalized).toContain('08:00');
  });

  it('parses "Every Morning 9:30"', () => {
    const result = parseSchedule('Every Morning 9:30');
    expect(result.cron).toBe('30 9 * * *');
  });

  it('parses "Every Evening 20:00"', () => {
    const result = parseSchedule('Every Evening 20:00');
    expect(result.cron).toBe('0 20 * * *');
  });

  it('parses "Every Night" with default time', () => {
    const result = parseSchedule('Every Night');
    expect(result.cron).toBe('0 22 * * *');
  });

  it('parses "Every Afternoon"', () => {
    const result = parseSchedule('Every Afternoon');
    expect(result.cron).toBe('0 14 * * *');
  });

  // ==========================================================================
  // Every Day / Daily
  // ==========================================================================

  it('parses "Every Day at 9:00"', () => {
    const result = parseSchedule('Every Day at 9:00');
    expect(result.cron).toBe('0 9 * * *');
  });

  it('parses "Every Day" with default 09:00', () => {
    const result = parseSchedule('Every Day');
    expect(result.cron).toBe('0 9 * * *');
  });

  it('parses "Daily 17:00"', () => {
    const result = parseSchedule('Daily 17:00');
    expect(result.cron).toBe('0 17 * * *');
  });

  // ==========================================================================
  // Every Hour / N Minutes / N Hours
  // ==========================================================================

  it('parses "Every Hour"', () => {
    const result = parseSchedule('Every Hour');
    expect(result.cron).toBe('0 * * * *');
  });

  it('parses "Every 30 Minutes"', () => {
    const result = parseSchedule('Every 30 Minutes');
    expect(result.cron).toBe('*/30 * * * *');
  });

  it('parses "Every 15 minutes"', () => {
    const result = parseSchedule('Every 15 minutes');
    expect(result.cron).toBe('*/15 * * * *');
  });

  it('parses "Every 2 Hours"', () => {
    const result = parseSchedule('Every 2 Hours');
    expect(result.cron).toBe('0 */2 * * *');
  });

  it('parses "Every Minute"', () => {
    const result = parseSchedule('Every Minute');
    expect(result.cron).toBe('* * * * *');
  });

  // ==========================================================================
  // Weekdays
  // ==========================================================================

  it('parses "Every Monday 9:00"', () => {
    const result = parseSchedule('Every Monday 9:00');
    expect(result.cron).toBe('0 9 * * 1');
  });

  it('parses "Every Friday 17:00"', () => {
    const result = parseSchedule('Every Friday 17:00');
    expect(result.cron).toBe('0 17 * * 5');
  });

  it('parses "Every Sunday" with default time', () => {
    const result = parseSchedule('Every Sunday');
    expect(result.cron).toBe('0 9 * * 0');
  });

  it('parses short day names "Every Mon 8:30"', () => {
    const result = parseSchedule('Every Mon 8:30');
    expect(result.cron).toBe('30 8 * * 1');
  });

  // ==========================================================================
  // Weekdays / Weekends
  // ==========================================================================

  it('parses "Weekdays 9:00"', () => {
    const result = parseSchedule('Weekdays 9:00');
    expect(result.cron).toBe('0 9 * * 1-5');
  });

  it('parses "Every Weekday" with default time', () => {
    const result = parseSchedule('Every Weekday');
    expect(result.cron).toBe('0 9 * * 1-5');
  });

  it('parses "Weekends 10:00"', () => {
    const result = parseSchedule('Weekends 10:00');
    expect(result.cron).toBe('0 10 * * 0,6');
  });

  it('parses "Weekends" with default time', () => {
    const result = parseSchedule('Weekends');
    expect(result.cron).toBe('0 10 * * 0,6');
  });

  // ==========================================================================
  // Monthly
  // ==========================================================================

  it('parses "Every Month" with default day and time', () => {
    const result = parseSchedule('Every Month');
    expect(result.cron).toBe('0 9 1 * *');
  });

  it('parses "Every Month 15th 10:00"', () => {
    const result = parseSchedule('Every Month 15th 10:00');
    expect(result.cron).toBe('0 10 15 * *');
  });

  it('parses "Every Month on the 1st"', () => {
    const result = parseSchedule('Every Month on the 1st');
    expect(result.cron).toBe('0 9 1 * *');
  });

  // ==========================================================================
  // Case insensitivity
  // ==========================================================================

  it('is case insensitive', () => {
    expect(parseSchedule('every morning').cron).toBe('0 8 * * *');
    expect(parseSchedule('EVERY FRIDAY 17:00').cron).toBe('0 17 * * 5');
  });

  // ==========================================================================
  // "at" keyword
  // ==========================================================================

  it('handles "at" before time', () => {
    const result = parseSchedule('Every Day at 14:30');
    expect(result.cron).toBe('30 14 * * *');
  });

  it('handles bare hour with "at"', () => {
    const result = parseSchedule('Every Day at 8');
    expect(result.cron).toBe('0 8 * * *');
  });

  // ==========================================================================
  // Errors
  // ==========================================================================

  it('throws on empty string', () => {
    expect(() => parseSchedule('')).toThrow(HeartbeatParseError);
  });

  it('throws on unparseable input', () => {
    expect(() => parseSchedule('whenever I feel like it')).toThrow(HeartbeatParseError);
  });

  it('throws on invalid minutes range', () => {
    expect(() => parseSchedule('Every 0 Minutes')).toThrow(HeartbeatParseError);
    expect(() => parseSchedule('Every 60 Minutes')).toThrow(HeartbeatParseError);
  });

  it('throws on invalid hours range', () => {
    expect(() => parseSchedule('Every 0 Hours')).toThrow(HeartbeatParseError);
    expect(() => parseSchedule('Every 24 Hours')).toThrow(HeartbeatParseError);
  });

  // ==========================================================================
  // Normalized output
  // ==========================================================================

  it('returns human-readable normalized form', () => {
    const result = parseSchedule('Every Friday 17:00');
    expect(result.normalized).toBe('Every Friday at 17:00');
  });
});

describe('parseMarkdown', () => {
  it('parses a simple markdown with headings', () => {
    const md = `## Every Morning 8:00
Summarize my unread emails and pending tasks

## Every Friday 17:00
Generate weekly expense report and save as note`;

    const { entries, errors } = parseMarkdown(md);
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(0);

    expect(entries[0]!.scheduleText).toBe('Every Morning 8:00');
    expect(entries[0]!.cron).toBe('0 8 * * *');
    expect(entries[0]!.taskDescription).toBe('Summarize my unread emails and pending tasks');

    expect(entries[1]!.scheduleText).toBe('Every Friday 17:00');
    expect(entries[1]!.cron).toBe('0 17 * * 5');
    expect(entries[1]!.taskDescription).toBe('Generate weekly expense report and save as note');
  });

  it('collects errors for unparseable schedules', () => {
    const md = `## Every Morning 8:00
Valid task

## Whenever I feel like it
Invalid schedule task`;

    const { entries, errors } = parseMarkdown(md);
    expect(entries).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.scheduleText).toBe('Whenever I feel like it');
  });

  it('skips sections without task description', () => {
    const md = `## Every Morning 8:00
`;

    const { entries, errors } = parseMarkdown(md);
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('returns empty for empty markdown', () => {
    const { entries, errors } = parseMarkdown('');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('handles multiline task descriptions', () => {
    const md = `## Every Day 9:00
First line of the task.
Second line of the task.
Third line of the task.`;

    const { entries } = parseMarkdown(md);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskDescription).toContain('First line');
    expect(entries[0]!.taskDescription).toContain('Third line');
  });
});

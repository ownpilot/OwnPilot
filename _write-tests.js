const fs = require('fs');
const Q = String.fromCharCode(39);

function q(s) { return Q + s + Q; }

// ============================================================
// FILE 1: time-tools.test.ts
// ============================================================
const timeToolsTest = `/**
 * Tests for time-tools executors
 */

import { describe, it, expect, vi, afterEach } from ${q('vitest')};
import { TIME_EXECUTORS } from ${q('./time-tools.js')};

const exec = (name: string, args: Record<string, unknown> = {}) =>
  TIME_EXECUTORS[name]!(args, {} as never);

describe(${q('get_current_time')}, () => {
  afterEach(() => { vi.useRealTimers(); });

  it(${q('returns current time for default UTC timezone')}, async () => {
    const result = await exec(${q('get_current_time')}, {});
    expect(result.content).toContain(${q('Current time in UTC:')});
  });

  it(${q('returns current time for a specific timezone')}, async () => {
    const result = await exec(${q('get_current_time')}, { timezone: ${q('America/New_York')} });
    expect(result.content).toContain(${q('Current time in America/New_York:')});
  });

  it(${q('falls back to UTC ISO string for invalid timezone')}, async () => {
    const result = await exec(${q('get_current_time')}, { timezone: ${q('Invalid/Zone')} });
    expect(result.content).toContain(${q('Current time (UTC):')});
  });

  it(${q('uses UTC when timezone arg is undefined')}, async () => {
    const result = await exec(${q('get_current_time')}, {});
    expect(result.content).toMatch(/^Current time in UTC:/);
  });
});

describe(${q('format_date')}, () => {
  afterEach(() => { vi.useRealTimers(); });

  describe(${q('natural language dates')}, () => {
    it(${q('handles now')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('now')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(${q('handles today')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('today')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(${q('handles tomorrow')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('tomorrow')}, format: ${q('iso')} });
      expect(result.content).toContain(${q('2026-01-16')});
    });

    it(${q('handles yesterday')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('yesterday')}, format: ${q('iso')} });
      expect(result.content).toContain(${q('2026-01-14')});
    });

    it(${q('handles next week')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('next week')}, format: ${q('iso')} });
      expect(result.content).toContain(${q('2026-01-22')});
    });

    it(${q('is case insensitive for TODAY')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('TODAY')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(${q('is case insensitive for YESTERDAY')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('YESTERDAY')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(${q('is case insensitive for Next Week')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('Next Week')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe(${q('format options')}, () => {
    it(${q('formats as iso')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15')}, format: ${q('iso')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(${q('formats as short')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15')}, format: ${q('short')} });
      expect(result.content).toMatch(/\d+\/\d+\/\d+/);
    });

    it(${q('formats as long (default)')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15')} });
      expect(result.content).toContain(${q('January')});
    });

    it(${q('formats as long explicitly')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15')}, format: ${q('long')} });
      expect(result.content).toContain(${q('January')});
    });

    it(${q('formats as relative - today')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15T12:00:00Z')}, format: ${q('relative')} });
      expect(result.content).toBe(${q('Today')});
    });

    it(${q('formats as relative - tomorrow')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-16T12:00:00Z')}, format: ${q('relative')} });
      expect(result.content).toBe(${q('Tomorrow')});
    });

    it(${q('formats as relative - yesterday')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-14T12:00:00Z')}, format: ${q('relative')} });
      expect(result.content).toBe(${q('Yesterday')});
    });

    it(${q('formats as relative - future days')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-20T12:00:00Z')}, format: ${q('relative')} });
      expect(result.content).toBe(${q('In 5 days')});
    });

    it(${q('formats as relative - past days')}, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(${q('2026-01-15T12:00:00Z')}));
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-10T12:00:00Z')}, format: ${q('relative')} });
      expect(result.content).toBe(${q('5 days ago')});
    });

    it(${q('uses ISO for unknown format (default switch)')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15')}, format: ${q('custom_xyz')} });
      expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe(${q('timezone parameter')}, () => {
    it(${q('applies timezone to short format')}, async () => {
      const result = await exec(${q('format_date')}, { date: ${q('2026-01-15T23:00:00Z')}, format: ${q('short')}, timezone: ${q('America/New_York')} });
      expect(result.content).toMatch(/\d+\/\d+\/\d+/);
    });

    it(${q('applies timezone to long format')}, async () => {
      const result = await exec(${q('format_date'

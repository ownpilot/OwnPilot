// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authedFetch,
  getStateBadge,
  formatDuration,
  formatCost,
  timeAgo,
  inputClass,
  labelClass,
} from './utils';

describe('claws utils', () => {
  describe('authedFetch', () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;
      localStorage.clear();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      localStorage.clear();
    });

    it('uses same-origin credentials for cookie authentication', async () => {
      localStorage.setItem('ownpilot-session-token', 'abc123');

      await authedFetch('/api/v1/claws');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/v1/claws');
      expect((init as RequestInit).credentials).toBe('same-origin');
      expect((init as RequestInit).headers).not.toHaveProperty('X-Session-Token');
    });

    it('omits legacy localStorage token headers', async () => {
      await authedFetch('/api/v1/claws');

      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).headers).not.toHaveProperty('X-Session-Token');
    });

    it('preserves caller-supplied headers and request options', async () => {
      localStorage.setItem('ownpilot-session-token', 'tok');

      await authedFetch('/api/v1/claws/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      const [, init] = fetchMock.mock.calls[0]!;
      const req = init as RequestInit;
      expect(req.method).toBe('POST');
      expect(req.body).toBe('{}');
      expect(req.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(req.headers).not.toHaveProperty('X-Session-Token');
    });
  });

  describe('getStateBadge', () => {
    it.each([
      ['running', 'Running', 'text-green-600'],
      ['paused', 'Paused', 'text-amber-600'],
      ['starting', 'Starting', 'text-blue-600'],
      ['waiting', 'Waiting', 'text-cyan-600'],
      ['completed', 'Completed', 'text-emerald-600'],
      ['failed', 'Failed', 'text-red-600'],
      ['stopped', 'Stopped', 'text-gray-600'],
      ['escalation_pending', 'Escalation', 'text-purple-600'],
    ] as const)('returns the badge for %s', (state, expectedText, expectedColor) => {
      const badge = getStateBadge(state);
      expect(badge.text).toBe(expectedText);
      expect(badge.classes).toContain(expectedColor);
    });

    it('falls back to Idle for null', () => {
      const badge = getStateBadge(null);
      expect(badge.text).toBe('Idle');
      expect(badge.classes).toContain('bg-gray-500/15');
    });
  });

  describe('formatDuration', () => {
    it('formats sub-second durations in ms', () => {
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('formats seconds with one decimal', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(45_500)).toBe('45.5s');
    });

    it('formats minutes and seconds for >= 1 minute', () => {
      expect(formatDuration(60_000)).toBe('1m 0s');
      expect(formatDuration(125_000)).toBe('2m 5s');
    });
  });

  describe('formatCost', () => {
    it('formats to 4 decimal places with a dollar sign', () => {
      expect(formatCost(0)).toBe('$0.0000');
      expect(formatCost(0.0001)).toBe('$0.0001');
      expect(formatCost(1.23456)).toBe('$1.2346');
    });
  });

  describe('timeAgo', () => {
    const NOW = new Date('2026-04-23T12:00:00Z').getTime();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "never" for null input', () => {
      expect(timeAgo(null)).toBe('never');
    });

    it('returns "just now" for a timestamp within the last minute', () => {
      expect(timeAgo(new Date(NOW - 30_000).toISOString())).toBe('just now');
    });

    it('returns minutes ago within the last hour', () => {
      expect(timeAgo(new Date(NOW - 5 * 60_000).toISOString())).toBe('5m ago');
    });

    it('returns hours ago within the last day', () => {
      expect(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString())).toBe('3h ago');
    });

    it('returns days ago beyond 24 hours', () => {
      expect(timeAgo(new Date(NOW - 2 * 86_400_000).toISOString())).toBe('2d ago');
    });
  });

  describe('style constants', () => {
    it('inputClass contains expected base classes', () => {
      expect(inputClass).toContain('w-full');
      expect(inputClass).toContain('rounded-lg');
      expect(inputClass).toContain('border');
    });

    it('labelClass contains expected base classes', () => {
      expect(labelClass).toContain('text-xs');
      expect(labelClass).toContain('uppercase');
    });
  });
});

/**
 * Tests for metric/service.ts — Prometheus-compatible metrics.
 *
 * These assert *values*, not just substring presence. The previous version of
 * this suite only checked `toContain('# HELP')` / `toContain('_bucket')`, which
 * is why five separate exposition defects shipped green: duplicated family
 * headers, a double-cumulated histogram, a global `_sum` emitted per label,
 * unbounded raw-path cardinality, and unescaped label values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../agent/registry.js', () => ({
  getAgentRegistry: () => ({
    getSystemMetrics: () => ({
      totalActive: 2,
      byType: { claw: 1, soul: 1 },
    }),
  }),
}));

const { recordHttpRequest, renderMetrics, resetMetrics, startMetricsService, stopMetricsService } =
  await import('./service.js');

/** Extract the numeric value of the first sample whose line contains all fragments. */
function sampleValue(metrics: string, ...fragments: string[]): number | undefined {
  const line = metrics
    .split('\n')
    .find((l) => !l.startsWith('#') && fragments.every((f) => l.includes(f)));
  if (!line) return undefined;
  return Number(line.slice(line.lastIndexOf(' ') + 1));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('metric/service', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    stopMetricsService();
    resetMetrics();
  });

  describe('recordHttpRequest', () => {
    it('records requests with method/route/status labels', () => {
      recordHttpRequest('GET', '/api/v1/tasks', 200, 15);
      const metrics = renderMetrics();
      expect(metrics).toContain(
        'ownpilot_http_requests_total{method="GET",path="/api/v1/tasks",status="200"} 1'
      );
    });

    it('accumulates repeated requests into one series', () => {
      recordHttpRequest('POST', '/api/v1/test', 201, 10);
      recordHttpRequest('POST', '/api/v1/test', 201, 20);
      const metrics = renderMetrics();

      expect(sampleValue(metrics, 'ownpilot_http_requests_total{', 'path="/api/v1/test"')).toBe(2);
      // One series, not two.
      expect(countOccurrences(metrics, 'ownpilot_http_requests_total{method="POST"')).toBe(1);
    });

    it('skips health endpoints', () => {
      recordHttpRequest('GET', '/health', 200, 5);
      recordHttpRequest('GET', '/api/v1/health', 200, 5);
      const metrics = renderMetrics();
      expect(metrics).not.toContain('path="/health"');
      expect(metrics).not.toContain('path="/api/v1/health"');
    });

    it('skips the metrics scrape endpoint so scrapes do not count themselves', () => {
      recordHttpRequest('GET', '/api/v1/metrics', 200, 2);
      recordHttpRequest('GET', '/metrics', 200, 2);
      const metrics = renderMetrics();
      expect(metrics).not.toContain('path="/api/v1/metrics"');
      expect(metrics).not.toContain('path="/metrics"');
    });

    it('caps distinct series and folds the overflow into __other__', () => {
      // Cap is 1000 real series, plus the single __other__ overflow series.
      for (let i = 0; i < 1001; i++) {
        recordHttpRequest('GET', `/api/v1/r${i}`, 200, 5);
      }
      const afterCap = renderMetrics();
      expect(countOccurrences(afterCap, 'ownpilot_http_requests_total{')).toBe(1001);
      expect(afterCap).toContain('path="__other__"');

      // The property that matters: further distinct routes do not grow the map.
      for (let i = 1001; i < 3000; i++) {
        recordHttpRequest('GET', `/api/v1/r${i}`, 200, 5);
      }
      const afterFlood = renderMetrics();
      expect(countOccurrences(afterFlood, 'ownpilot_http_requests_total{')).toBe(1001);
      // They are counted, just aggregated.
      expect(sampleValue(afterFlood, 'ownpilot_http_requests_total{', 'path="__other__"')).toBe(
        2000
      );
    });
  });

  describe('renderMetrics — exposition format', () => {
    it('emits exactly one HELP/TYPE pair per family regardless of series count', () => {
      recordHttpRequest('GET', '/api/v1/a', 200, 10);
      recordHttpRequest('GET', '/api/v1/b', 200, 10);
      recordHttpRequest('POST', '/api/v1/c', 500, 10);
      const metrics = renderMetrics();

      expect(countOccurrences(metrics, '# HELP ownpilot_http_requests_total')).toBe(1);
      expect(countOccurrences(metrics, '# TYPE ownpilot_http_requests_total')).toBe(1);
      expect(countOccurrences(metrics, '# HELP ownpilot_http_request_duration_ms')).toBe(1);
      expect(countOccurrences(metrics, '# HELP ownpilot_active_agents')).toBe(1);
      expect(countOccurrences(metrics, '# TYPE ownpilot_active_agents')).toBe(1);
    });

    it('escapes quotes and backslashes in label values', () => {
      recordHttpRequest('GET', '/api/v1/x"y\\z', 200, 5);
      const metrics = renderMetrics();
      expect(metrics).toContain('path="/api/v1/x\\"y\\\\z"');
      // The raw, unescaped form must not appear.
      expect(metrics).not.toContain('path="/api/v1/x"y');
    });
  });

  describe('renderMetrics — histogram correctness', () => {
    it('reports one observation as count=1 with correct bucket boundaries', () => {
      recordHttpRequest('GET', '/api/v1/h', 200, 12);
      const metrics = renderMetrics();
      const key = 'path="GET_/api/v1/h"';

      // 12ms: below the 10ms bucket, at or under every bucket from 25ms up.
      expect(sampleValue(metrics, '_bucket{le="5",', key)).toBe(0);
      expect(sampleValue(metrics, '_bucket{le="10",', key)).toBe(0);
      expect(sampleValue(metrics, '_bucket{le="25",', key)).toBe(1);
      expect(sampleValue(metrics, '_bucket{le="50",', key)).toBe(1);
      expect(sampleValue(metrics, '_bucket{le="+Inf",', key)).toBe(1);
      expect(sampleValue(metrics, 'ownpilot_http_request_duration_ms_count{', key)).toBe(1);
      expect(sampleValue(metrics, 'ownpilot_http_request_duration_ms_sum{', key)).toBe(12);
    });

    it('keeps buckets monotonically non-decreasing', () => {
      recordHttpRequest('GET', '/api/v1/h', 200, 12);
      recordHttpRequest('GET', '/api/v1/h', 200, 300);
      const metrics = renderMetrics();
      const key = 'path="GET_/api/v1/h"';

      const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
      let previous = 0;
      for (const bound of buckets) {
        const value = sampleValue(metrics, `_bucket{le="${bound}",`, key)!;
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
      expect(sampleValue(metrics, '_bucket{le="+Inf",', key)).toBe(2);
      expect(sampleValue(metrics, 'ownpilot_http_request_duration_ms_count{', key)).toBe(2);
    });

    it('counts observations slower than the largest bucket', () => {
      recordHttpRequest('GET', '/api/v1/slow', 200, 60_000);
      const metrics = renderMetrics();
      const key = 'path="GET_/api/v1/slow"';

      // Falls into no bucket, but must still appear in +Inf and _count.
      expect(sampleValue(metrics, '_bucket{le="10000",', key)).toBe(0);
      expect(sampleValue(metrics, '_bucket{le="+Inf",', key)).toBe(1);
      expect(sampleValue(metrics, 'ownpilot_http_request_duration_ms_count{', key)).toBe(1);
      expect(sampleValue(metrics, 'ownpilot_http_request_duration_ms_sum{', key)).toBe(60_000);
    });

    it('tracks _sum per route rather than globally', () => {
      recordHttpRequest('GET', '/api/v1/one', 200, 100);
      recordHttpRequest('GET', '/api/v1/two', 200, 7);
      const metrics = renderMetrics();

      expect(
        sampleValue(metrics, 'ownpilot_http_request_duration_ms_sum{', 'path="GET_/api/v1/one"')
      ).toBe(100);
      expect(
        sampleValue(metrics, 'ownpilot_http_request_duration_ms_sum{', 'path="GET_/api/v1/two"')
      ).toBe(7);
    });
  });

  describe('agent metrics', () => {
    it('includes active agent gauges', () => {
      const metrics = renderMetrics();
      expect(sampleValue(metrics, 'ownpilot_active_agents{', 'type="total"')).toBe(2);
      expect(sampleValue(metrics, 'ownpilot_active_agents{', 'type="claw"')).toBe(1);
    });
  });

  describe('startMetricsService / stopMetricsService', () => {
    it('start is idempotent (calling twice does not error)', () => {
      startMetricsService();
      startMetricsService();
    });

    it('stop clears the timer (no error when not started)', () => {
      stopMetricsService();
      stopMetricsService();
    });
  });
});

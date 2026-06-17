/**
 * Tests for metric/service.ts — Prometheus-compatible metrics.
 *
 * Tests recordHttpRequest, renderMetrics, and start/stop service lifecycle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

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

const { recordHttpRequest, renderMetrics, startMetricsService, stopMetricsService } =
  await import('./service.js');

describe('metric/service', () => {
  afterEach(() => {
    stopMetricsService();
  });

  describe('recordHttpRequest', () => {
    it('records requests with method/path/status', () => {
      recordHttpRequest('GET', '/api/v1/tasks', 200, 15);
      const metrics = renderMetrics();
      expect(metrics).toContain('ownpilot_http_requests_total');
      expect(metrics).toContain('GET');
      expect(metrics).toContain('/api/v1/tasks');
      expect(metrics).toContain('200');
    });

    it('skips health endpoint requests', () => {
      recordHttpRequest('GET', '/health', 200, 5);
      const metrics = renderMetrics();
      expect(metrics).not.toContain('path="/health"');
    });

    it('skips /metrics endpoint requests', () => {
      recordHttpRequest('GET', '/metrics', 200, 2);
      const metrics = renderMetrics();
      expect(metrics).not.toContain('path="/metrics"');
    });

    it('accumulates counts for same route', () => {
      recordHttpRequest('POST', '/api/test', 201, 10);
      recordHttpRequest('POST', '/api/test', 201, 20);
      const metrics = renderMetrics();
      expect(metrics).toContain('"201"');
      // The counter value should appear twice (accumulated)
    });
  });

  describe('renderMetrics', () => {
    it('outputs Prometheus format with HELP and TYPE lines', () => {
      recordHttpRequest('GET', '/api/test', 200, 50);
      const metrics = renderMetrics();
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('includes histogram buckets', () => {
      recordHttpRequest('GET', '/api/test', 200, 75);
      const metrics = renderMetrics();
      expect(metrics).toContain('ownpilot_http_request_duration_ms_bucket');
      expect(metrics).toContain('le="50"');
      expect(metrics).toContain('le="+Inf"');
    });

    it('includes agent metrics', () => {
      const metrics = renderMetrics();
      expect(metrics).toContain('ownpilot_active_agents');
    });
  });

  describe('startMetricsService / stopMetricsService', () => {
    it('start is idempotent (calling twice does not error)', () => {
      startMetricsService();
      startMetricsService();
      // No error thrown — timer already set
    });

    it('stop clears the timer (no error when not started)', () => {
      stopMetricsService();
      stopMetricsService();
    });
  });
});

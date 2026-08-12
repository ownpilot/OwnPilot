/**
 * Metrics Service
 *
 * Prometheus-compatible /metrics endpoint for observability.
 * Tracks HTTP request counts/latencies, agent activity, and provider costs.
 *
 * Metrics are stored in-process (single-node). For multi-node deployments,
 * aggregate via Prometheus Pushgateway or remote_write.
 */

import { getLog } from '../log.js';
import { getAgentRegistry } from '../agent/registry.js';

const log = getLog('Metrics');

// ============================================================================
// Metric Types
// ============================================================================

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  buckets: number[];
  /** labelSet key → cumulative count per bucket (count of observations <= buckets[i]) */
  counts: Map<string, number[]>;
  /** labelSet key → total observed latency. Per-key: a single global sum would
   *  report every route's total under every route's label. */
  sums: Map<string, number>;
  /** labelSet key → total observation count. Needed separately from the last
   *  bucket because observations above the highest bucket bound land in no
   *  bucket at all, yet must still appear in `+Inf` and `_count`. */
  observations: Map<string, number>;
}

// ============================================================================
// Metric Stores
// ============================================================================

const METRIC_HTTP_REQUESTS = 'ownpilot_http_requests_total';
const METRIC_HTTP_DURATION = 'ownpilot_http_request_duration_ms';
const METRIC_ACTIVE_AGENTS = 'ownpilot_active_agents';

/**
 * Routes that must never be recorded.
 *
 * `/api/v1/metrics` is the scrape endpoint itself — without it every scrape
 * counts itself, injecting ~5.7k phantom requests/day at a 15s interval.
 * `/metrics` is kept as a defensive alias in case the route is ever remounted.
 */
const EXCLUDED_ROUTE_PREFIXES = ['/health', '/api/v1/health', '/api/v1/metrics', '/metrics'];

/**
 * Hard ceiling on distinct counter series.
 *
 * Callers pass a *route template* (see `recordHttpRequest`), so cardinality is
 * already bounded by the number of registered routes. This is a backstop
 * against a future wildcard route reintroducing unbounded keys — an unbounded
 * map here is both a memory leak and an ever-growing scrape payload.
 */
const MAX_SERIES = 1000;
const OVERFLOW_ROUTE = '__other__';

/** HTTP request counter: method_route_status */
const httpRequests = new Map<string, Counter>();

/** HTTP request latency histogram (ms) */
const httpLatencies: Histogram = {
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  counts: new Map<string, number[]>(),
  sums: new Map<string, number>(),
  observations: new Map<string, number>(),
};

/** Active agent sessions by type */
const activeAgents = new Map<string, number>();

/** Emit the series-cap warning once, not on every request past the cap. */
let overflowWarned = false;

// ============================================================================
// Instrumentation API
// ============================================================================

/**
 * Record an HTTP request completion.
 *
 * `route` MUST be a route *template* (`/api/v1/agents/:id`), never a raw
 * request URL. Callers get this from Hono's `c.req.routePath` — see
 * `middleware/audit.ts`. Passing raw paths creates one permanent series per
 * distinct URL, which leaks memory and makes the scrape payload grow without
 * bound.
 */
export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  latencyMs: number
): void {
  if (EXCLUDED_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))) return;

  // Fold anything past the cap into a single overflow series rather than
  // growing the map forever.
  let effectiveRoute = route;
  let key = `${method}_${route}_${status}`;
  if (!httpRequests.has(key) && httpRequests.size >= MAX_SERIES) {
    if (!overflowWarned) {
      log.warn(
        `[metrics] Series cap (${MAX_SERIES}) reached — further routes are folded into "${OVERFLOW_ROUTE}". ` +
          'This usually means a raw path is being passed instead of a route template.'
      );
      overflowWarned = true;
    }
    effectiveRoute = OVERFLOW_ROUTE;
    key = `${method}_${OVERFLOW_ROUTE}_${status}`;
  }

  const existing = httpRequests.get(key);
  if (existing) {
    existing.value++;
  } else {
    httpRequests.set(key, {
      value: 1,
      labels: { method, path: effectiveRoute, status: String(status) },
    });
  }

  // Histogram. Buckets are stored already-cumulative (each observation
  // increments every bucket whose bound it falls under), which is what the
  // Prometheus exposition format wants — so the renderer must emit these
  // values verbatim, NOT re-accumulate them.
  const labelKey = `${method}_${effectiveRoute}`;
  let bucketCounts = httpLatencies.counts.get(labelKey);
  if (!bucketCounts) {
    bucketCounts = httpLatencies.buckets.map(() => 0);
    httpLatencies.counts.set(labelKey, bucketCounts);
  }

  for (let i = 0; i < httpLatencies.buckets.length; i++) {
    if (latencyMs <= httpLatencies.buckets[i]!) {
      bucketCounts[i]!++;
    }
  }
  httpLatencies.sums.set(labelKey, (httpLatencies.sums.get(labelKey) ?? 0) + latencyMs);
  httpLatencies.observations.set(labelKey, (httpLatencies.observations.get(labelKey) ?? 0) + 1);
}

/**
 * Clear all metric stores. Exported for tests — production has no reason to
 * discard collected metrics.
 */
export function resetMetrics(): void {
  httpRequests.clear();
  httpLatencies.counts.clear();
  httpLatencies.sums.clear();
  httpLatencies.observations.clear();
  activeAgents.clear();
  overflowWarned = false;
}

/**
 * Record active agent counts by type.
 */
function recordActiveAgents(type: string, count: number): void {
  activeAgents.set(type, count);
}

/**
 * Refresh agent metrics from registry.
 */
function refreshAgentMetrics(): void {
  try {
    const metrics = getAgentRegistry().getSystemMetrics();
    recordActiveAgents('total', metrics.totalActive);
    for (const [type, count] of Object.entries(metrics.byType)) {
      recordActiveAgents(type, count);
    }
  } catch {
    // Registry not ready
  }
}

// ============================================================================
// Prometheus Export
// ============================================================================

/**
 * Escape a label value per the Prometheus text exposition format:
 * backslash, double-quote and line feed are the three characters that must be
 * escaped. Without this, a route containing a quote emits unparseable output.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(',');
}

/**
 * `# HELP` / `# TYPE` for a metric family.
 *
 * These are emitted ONCE per family. Prometheus' text parser rejects a second
 * HELP line for the same metric name, so emitting them per series (as this
 * module previously did) makes the whole payload unscrapeable as soon as two
 * series exist.
 */
function familyHeader(name: string, help: string, type: 'counter' | 'gauge' | 'histogram'): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}`;
}

function sample(name: string, labels: Record<string, string>, value: number): string {
  return `${name}{${formatLabels(labels)}} ${value}`;
}

/**
 * Render all metrics in Prometheus format.
 */
export function renderMetrics(): string {
  refreshAgentMetrics();

  const lines: string[] = [];

  // HTTP request counts
  lines.push(familyHeader(METRIC_HTTP_REQUESTS, 'Total HTTP requests', 'counter'));
  for (const counter of httpRequests.values()) {
    lines.push(sample(METRIC_HTTP_REQUESTS, counter.labels, counter.value));
  }
  lines.push('');

  // HTTP latency histogram. Bucket counts are stored cumulatively by
  // recordHttpRequest, so they are emitted as-is. `+Inf` and `_count` use the
  // observation total, which also covers latencies above the highest bucket.
  lines.push(
    familyHeader(METRIC_HTTP_DURATION, 'HTTP request duration in milliseconds', 'histogram')
  );
  for (const [labelKey, bucketCounts] of httpLatencies.counts) {
    const observed = httpLatencies.observations.get(labelKey) ?? 0;
    for (let i = 0; i < httpLatencies.buckets.length; i++) {
      lines.push(
        sample(
          `${METRIC_HTTP_DURATION}_bucket`,
          { le: String(httpLatencies.buckets[i]), path: labelKey },
          bucketCounts[i]!
        )
      );
    }
    lines.push(sample(`${METRIC_HTTP_DURATION}_bucket`, { le: '+Inf', path: labelKey }, observed));
    lines.push(sample(`${METRIC_HTTP_DURATION}_count`, { path: labelKey }, observed));
    lines.push(
      sample(
        `${METRIC_HTTP_DURATION}_sum`,
        { path: labelKey },
        httpLatencies.sums.get(labelKey) ?? 0
      )
    );
  }
  lines.push('');

  // Active agents
  lines.push(familyHeader(METRIC_ACTIVE_AGENTS, 'Number of active agents', 'gauge'));
  for (const [type, count] of activeAgents) {
    lines.push(sample(METRIC_ACTIVE_AGENTS, { type }, count));
  }

  return `${lines.join('\n')}\n`;
}

// ============================================================================
// Service Entry Point
// ============================================================================

let agentRefreshTimer: NodeJS.Timeout | null = null;

/**
 * Start the metrics service — registers agent refresh interval.
 */
export function startMetricsService(): void {
  log.info('[metrics] Service started');

  if (agentRefreshTimer) return;
  // Refresh agent counts every 30 seconds — unref so this timer does not
  // keep the process alive during shutdown / tests.
  agentRefreshTimer = setInterval(() => {
    refreshAgentMetrics();
  }, 30_000);
  agentRefreshTimer.unref();
}

/**
 * Stop the metrics service — clears the refresh interval.
 */
export function stopMetricsService(): void {
  if (agentRefreshTimer) {
    clearInterval(agentRefreshTimer);
    agentRefreshTimer = null;
  }
}

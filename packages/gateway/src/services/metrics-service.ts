/**
 * Metrics Service
 *
 * Prometheus-compatible /metrics endpoint for observability.
 * Tracks HTTP request counts/latencies, agent activity, and provider costs.
 *
 * Metrics are stored in-process (single-node). For multi-node deployments,
 * aggregate via Prometheus Pushgateway or remote_write.
 */

import { getLog } from './log.js';
import { getAgentRegistry } from './agent-registry.js';

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
  counts: Map<string, number[]>; // labelSet key → [count_per_bucket]
  sum: number;
}

// ============================================================================
// Metric Stores
// ============================================================================

/** HTTP request counter: method_path_status */
const httpRequests = new Map<string, Counter>();

/** HTTP request latency histogram (ms) */
const httpLatencies: Histogram = {
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  counts: new Map<string, number[]>(),
  sum: 0,
};

/** Active agent sessions by type */
const activeAgents = new Map<string, number>();

/** Provider cost counter (USD) by provider */
const providerCosts = new Map<string, number>();

/** Chat requests by provider+model+status */
const chatRequests = new Map<string, Counter>();

// ============================================================================
// Instrumentation API
// ============================================================================

/**
 * Record an HTTP request completion.
 */
export function recordHttpRequest(method: string, path: string, status: number, latencyMs: number): void {
  // Skip health/internal paths
  if (path.startsWith('/health') || path.startsWith('/metrics')) return;

  const key = `${method}_${path}_${status}`;
  const existing = httpRequests.get(key);
  if (existing) {
    existing.value++;
  } else {
    httpRequests.set(key, { value: 1, labels: { method, path, status: String(status) } });
  }

  // Histogram — increment all buckets that this latency falls into
  const labelKey = `${method}_${path}`;
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
  httpLatencies.sum += latencyMs;
}

/**
 * Record active agent counts by type.
 */
export function recordActiveAgents(type: string, count: number): void {
  activeAgents.set(type, count);
}

/**
 * Record provider cost in USD.
 */
export function recordProviderCost(provider: string, costUsd: number): void {
  const existing = providerCosts.get(provider);
  providerCosts.set(provider, (existing ?? 0) + costUsd);
}

/**
 * Record a chat request.
 */
export function recordChatRequest(provider: string, model: string, status: number): void {
  const key = `${provider}_${model}_${status}`;
  const existing = chatRequests.get(key);
  if (existing) {
    existing.value++;
  } else {
    chatRequests.set(key, {
      value: 1,
      labels: { provider, model, status: String(status) },
    });
  }
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

function formatCounter(name: string, help: string, value: number, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name}{${labelStr}} ${value}\n`;
}

function formatGauge(name: string, help: string, value: number, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}{${labelStr}} ${value}\n`;
}

function formatHistogram(
  name: string,
  help: string,
  buckets: number[],
  counts: Map<string, number[]>,
  sum: number
): string {
  const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];

  for (const [labelKey, bucketCounts] of counts) {
    let cumulative = 0;
    for (let i = 0; i < buckets.length; i++) {
      cumulative += bucketCounts[i]!;
      lines.push(`${name}_bucket{le="${buckets[i]}",path="${labelKey}"} ${cumulative}`);
    }
    lines.push(`${name}_bucket{le="+Inf",path="${labelKey}"} ${cumulative}`);
    lines.push(`${name}_count{path="${labelKey}"} ${cumulative}`);
    lines.push(`${name}_sum{path="${labelKey}"} ${sum}\n`);
  }

  return lines.join('\n');
}

/**
 * Render all metrics in Prometheus format.
 */
export function renderMetrics(): string {
  refreshAgentMetrics();

  const lines: string[] = [];

  // HTTP request counts
  for (const [, counter] of httpRequests) {
    lines.push(formatCounter('ownpilot_http_requests_total', 'Total HTTP requests', counter.value, counter.labels));
  }

  // HTTP latency histogram
  lines.push(
    formatHistogram(
      'ownpilot_http_request_duration_ms',
      'HTTP request duration in milliseconds',
      httpLatencies.buckets,
      httpLatencies.counts,
      httpLatencies.sum
    )
  );

  // Active agents
  for (const [type, count] of activeAgents) {
    lines.push(formatGauge('ownpilot_active_agents', 'Number of active agents', count, { type }));
  }

  // Provider costs
  for (const [provider, cost] of providerCosts) {
    lines.push(formatCounter('ownpilot_provider_cost_usd_total', 'Total provider cost in USD', cost, { provider }));
  }

  // Chat requests
  for (const [, counter] of chatRequests) {
    lines.push(formatCounter('ownpilot_chat_requests_total', 'Total chat requests', counter.value, counter.labels));
  }

  return lines.join('\n');
}

// ============================================================================
// Service Entry Point
// ============================================================================

/**
 * Start the metrics service — registers agent refresh interval.
 */
export function startMetricsService(): void {
  log.info('[metrics] Service started');

  // Refresh agent counts every 30 seconds
  setInterval(() => {
    refreshAgentMetrics();
  }, 30_000);
}

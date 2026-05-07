/**
 * Provider Metrics Repository
 *
 * Tracks per-provider/model telemetry for gap 24.4: telemetry-based routing.
 * Records latency, error rates, token usage, and cost.
 * Used by ModelRoutingService to compute moving averages.
 */

import { BaseRepository } from './base.js';

const TABLE = 'provider_metrics';

export interface ProviderMetric {
  id: string;
  providerId: string;
  modelId: string;
  recordedAt: Date;
  latencyMs: number;
  error: boolean;
  errorType: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  workflowId: string | null;
  agentId: string | null;
  userId: string | null;
}

export interface RecordMetricInput {
  id: string;
  providerId: string;
  modelId: string;
  latencyMs: number;
  error?: boolean;
  errorType?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  workflowId?: string | null;
  agentId?: string | null;
  userId?: string | null;
}

export interface RouteMetrics {
  providerId: string;
  modelId: string;
  avgLatencyMs: number;
  errorRate: number;
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  sampleCount: number;
}

export class ProviderMetricsRepository extends BaseRepository {
  /**
   * Record a provider call metric.
   */
  async record(input: RecordMetricInput): Promise<void> {
    const sql = `
      INSERT INTO ${TABLE} (id, provider_id, model_id, latency_ms, error, error_type, prompt_tokens, completion_tokens, cost_usd, workflow_id, agent_id, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    await this.execute(sql, [
      input.id,
      input.providerId,
      input.modelId,
      input.latencyMs,
      input.error ?? false,
      input.errorType ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.costUsd ?? null,
      input.workflowId ?? null,
      input.agentId ?? null,
      input.userId ?? null,
    ]);
  }

  /**
   * Get routing metrics for all provider/model combinations in the last hour.
   * Used by ModelRoutingService to compute cheapest/fastest/smartest routes.
   */
  async getRoutingMetrics(): Promise<RouteMetrics[]> {
    const sql = `
      SELECT
        provider_id,
        model_id,
        AVG(latency_ms)          AS avg_latency_ms,
        AVG(CASE WHEN error THEN 1.0 ELSE 0.0 END) AS error_rate,
        SUM(cost_usd)            AS total_cost_usd,
        SUM(prompt_tokens)       AS total_prompt_tokens,
        SUM(completion_tokens)   AS total_completion_tokens,
        COUNT(*)                 AS sample_count
      FROM ${TABLE}
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
      GROUP BY provider_id, model_id
      ORDER BY provider_id, model_id
    `;
    const rows = await this.query<{
      provider_id: string;
      model_id: string;
      avg_latency_ms: number;
      error_rate: number;
      total_cost_usd: number;
      total_prompt_tokens: number;
      total_completion_tokens: number;
      sample_count: string;
    }>(sql, []);

    return rows.map(r => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      avgLatencyMs: r.avg_latency_ms,
      errorRate: r.error_rate,
      totalCostUsd: r.total_cost_usd ?? 0,
      totalPromptTokens: r.total_prompt_tokens ?? 0,
      totalCompletionTokens: r.total_completion_tokens ?? 0,
      sampleCount: parseInt(r.sample_count, 10),
    }));
  }

  /**
   * Get cheapest provider/model by $/token (lowest total cost / total tokens).
   */
  async getCheapestRoute(): Promise<{ providerId: string; modelId: string; costPerToken: number } | null> {
    const sql = `
      SELECT
        provider_id,
        model_id,
        CASE WHEN SUM(prompt_tokens + completion_tokens) > 0
          THEN SUM(cost_usd) / SUM(prompt_tokens + completion_tokens)
          ELSE 999999
        END AS cost_per_token
      FROM ${TABLE}
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
        AND cost_usd IS NOT NULL
      GROUP BY provider_id, model_id
      ORDER BY cost_per_token ASC
      LIMIT 1
    `;
    const rows = await this.query<{ provider_id: string; model_id: string; cost_per_token: number }>(sql, []);
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { providerId: r.provider_id, modelId: r.model_id, costPerToken: r.cost_per_token };
  }

  /**
   * Get fastest provider/model by p50 latency (lowest median latency).
   */
  async getFastestRoute(): Promise<{ providerId: string; modelId: string; avgLatencyMs: number } | null> {
    const sql = `
      SELECT provider_id, model_id, AVG(latency_ms) AS avg_latency_ms
      FROM ${TABLE}
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
      GROUP BY provider_id, model_id
      ORDER BY avg_latency_ms ASC
      LIMIT 1
    `;
    const rows = await this.query<{ provider_id: string; model_id: string; avg_latency_ms: number }>(sql, []);
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { providerId: r.provider_id, modelId: r.model_id, avgLatencyMs: r.avg_latency_ms };
  }

  /**
   * Get most reliable provider/model (lowest error rate, min 10 samples).
   */
  async getMostReliableRoute(): Promise<{ providerId: string; modelId: string; errorRate: number } | null> {
    const sql = `
      SELECT provider_id, model_id, AVG(CASE WHEN error THEN 1.0 ELSE 0.0 END) AS error_rate
      FROM ${TABLE}
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
      GROUP BY provider_id, model_id
      HAVING COUNT(*) >= 10
      ORDER BY error_rate ASC
      LIMIT 1
    `;
    const rows = await this.query<{ provider_id: string; model_id: string; error_rate: number }>(sql, []);
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { providerId: r.provider_id, modelId: r.model_id, errorRate: r.error_rate };
  }

  /**
   * Purge metrics older than maxAgeDays.
   */
  async purgeOld(maxAgeDays = 30): Promise<number> {
    const result = await this.execute(
      `DELETE FROM ${TABLE} WHERE recorded_at < NOW() - INTERVAL '${maxAgeDays} days'`
    );
    return result.changes;
  }
}

// Singleton
let _repo: ProviderMetricsRepository | null = null;

export function getProviderMetricsRepository(): ProviderMetricsRepository {
  if (!_repo) _repo = new ProviderMetricsRepository();
  return _repo;
}
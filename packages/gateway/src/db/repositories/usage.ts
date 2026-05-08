/**
 * Usage Records Repository (PostgreSQL)
 *
 * Persists LLM usage records for cost tracking and analytics.
 * Complements in-memory UsageTracker — this provides durability.
 */

import { BaseRepository } from './base.js';
import type { UsageRecord } from '@ownpilot/core';

// ── Row Type ────────────────────────────────────────────────────────────────

interface UsageRecordRow {
  id: string;
  user_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: string;
  latency_ms: string;
  request_type: string;
  error: string | null;
  session_id: string | null;
  timestamp: string;
}

// ── Repository ───────────────────────────────────────────────────────────

export class UsageRepository extends BaseRepository {
  /**
   * Insert a usage record.
   */
  async save(record: UsageRecord): Promise<void> {
    await this.execute(
      `INSERT INTO usage_records
       (id, user_id, provider, model, input_tokens, output_tokens, cost, latency_ms, request_type, error, session_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.id,
        record.userId ?? null,
        record.provider,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.cost,
        record.latencyMs ?? 0,
        record.requestType ?? 'chat',
        record.error ?? null,
        record.sessionId ?? null,
        record.timestamp,
      ]
    );
  }

  /**
   * Get usage records for a time range with optional filters.
   */
  async getUsage(
    startDate: Date,
    endDate: Date,
    filters?: {
      userId?: string;
      provider?: string;
      model?: string;
    },
    limit = 10_000,
    offset = 0
  ): Promise<UsageRecord[]> {
    const conditions = ['timestamp >= $1', 'timestamp <= $2'];
    const params: unknown[] = [startDate.toISOString(), endDate.toISOString()];
    let idx = 3;

    if (filters?.userId) {
      conditions.push(`user_id = $${idx++}`);
      params.push(filters.userId);
    }
    if (filters?.provider) {
      conditions.push(`provider = $${idx++}`);
      params.push(filters.provider);
    }
    if (filters?.model) {
      conditions.push(`model = $${idx++}`);
      params.push(filters.model);
    }

    const rows = await this.query<UsageRecordRow>(
      `SELECT * FROM usage_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    return rows.map(rowToRecord);
  }

  /**
   * Get aggregate summary for a time range.
   */
  async getSummary(
    startDate: Date,
    endDate: Date,
    userId?: string
  ): Promise<{
    totalRecords: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    byProvider: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
    byModel: Record<string, { provider: string; requests: number; inputTokens: number; outputTokens: number; cost: number }>;
    byDay: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }>;
  }> {
    const conditions = ['timestamp >= $1', 'timestamp <= $2'];
    const params: unknown[] = [startDate.toISOString(), endDate.toISOString()];

    if (userId) {
      conditions.push('user_id = $3');
      params.push(userId);
    }

    const summaryRow = await this.queryOne<{
      total_records: string;
      total_input: string;
      total_output: string;
      total_cost: string;
    }>(
      `SELECT
         COUNT(*) AS total_records,
         COALESCE(SUM(input_tokens), 0) AS total_input,
         COALESCE(SUM(output_tokens), 0) AS total_output,
         COALESCE(SUM(cost), 0) AS total_cost
       FROM usage_records
       WHERE ${conditions.join(' AND ')}`,
      params
    );

    const providerRows = await this.query<{ provider: string; requests: string; input_tokens: string; output_tokens: string; cost: string }>(
      `SELECT provider, COUNT(*)::text AS requests,
              COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
              COALESCE(SUM(cost), 0)::text AS cost
       FROM usage_records
       WHERE ${conditions.join(' AND ')}
       GROUP BY provider`,
      params
    );

    const modelRows = await this.query<{ model: string; provider: string; requests: string; input_tokens: string; output_tokens: string; cost: string }>(
      `SELECT model, provider, COUNT(*)::text AS requests,
              COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
              COALESCE(SUM(cost), 0)::text AS cost
       FROM usage_records
       WHERE ${conditions.join(' AND ')}
       GROUP BY model, provider`,
      params
    );

    const dayRows = await this.query<{ day: string; requests: string; cost: string; input_tokens: string; output_tokens: string }>(
      `SELECT DATE(timestamp)::text AS day,
              COUNT(*)::text AS requests,
              COALESCE(SUM(cost), 0)::text AS cost,
              COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::text AS output_tokens
       FROM usage_records
       WHERE ${conditions.join(' AND ')}
       GROUP BY DATE(timestamp)
       ORDER BY day DESC`,
      params
    );

    const byProvider: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
    for (const r of providerRows) {
      byProvider[r.provider] = {
        requests: parseInt(r.requests, 10),
        inputTokens: parseInt(r.input_tokens, 10),
        outputTokens: parseInt(r.output_tokens, 10),
        cost: parseFloat(r.cost),
      };
    }

    const byModel: Record<string, { provider: string; requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
    for (const r of modelRows) {
      byModel[r.model] = {
        provider: r.provider,
        requests: parseInt(r.requests, 10),
        inputTokens: parseInt(r.input_tokens, 10),
        outputTokens: parseInt(r.output_tokens, 10),
        cost: parseFloat(r.cost),
      };
    }

    const byDay: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }> = {};
    for (const r of dayRows) {
      byDay[r.day] = {
        requests: parseInt(r.requests, 10),
        cost: parseFloat(r.cost),
        inputTokens: parseInt(r.input_tokens, 10),
        outputTokens: parseInt(r.output_tokens, 10),
      };
    }

    return {
      totalRecords: parseInt(summaryRow?.total_records ?? '0', 10),
      totalInputTokens: parseInt(summaryRow?.total_input ?? '0', 10),
      totalOutputTokens: parseInt(summaryRow?.total_output ?? '0', 10),
      totalCost: parseFloat(summaryRow?.total_cost ?? '0'),
      byProvider,
      byModel,
      byDay,
    };
  }
}

// ── Row Mapper ────────────────────────────────────────────────────────────

function rowToRecord(row: UsageRecordRow): UsageRecord {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    provider: row.provider as UsageRecord['provider'],
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.input_tokens + row.output_tokens,
    cost: parseFloat(row.cost),
    latencyMs: parseFloat(row.latency_ms),
    requestType: row.request_type as UsageRecord['requestType'],
    error: row.error ?? undefined,
    sessionId: row.session_id ?? undefined,
    timestamp: row.timestamp,
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _repo: UsageRepository | null = null;

export function getUsageRepository(): UsageRepository {
  if (!_repo) _repo = new UsageRepository();
  return _repo;
}

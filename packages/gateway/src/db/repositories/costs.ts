/**
 * Costs Repository (PostgreSQL)
 *
 * Tracks LLM API costs and token usage
 */

import { BaseRepository } from './base.js';

export interface Cost {
  id: string;
  provider: string;
  model: string;
  conversationId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  createdAt: Date;
}

interface CostRow {
  id: string;
  provider: string;
  model: string;
  conversation_id: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  created_at: string;
}

function rowToCost(row: CostRow): Cost {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    conversationId: row.conversation_id ?? undefined,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    totalTokens: Number(row.total_tokens),
    inputCost: Number(row.input_cost),
    outputCost: Number(row.output_cost),
    totalCost: Number(row.total_cost),
    createdAt: new Date(row.created_at),
  };
}

export interface CostSummary {
  provider: string;
  model: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface DailyCost {
  date: string;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
}

export class CostsRepository extends BaseRepository {
  async create(data: {
    id: string;
    provider: string;
    model: string;
    conversationId?: string;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
  }): Promise<Cost> {
    const totalTokens = data.inputTokens + data.outputTokens;
    const totalCost = data.inputCost + data.outputCost;

    await this.execute(
      `INSERT INTO costs (
        id, provider, model, conversation_id,
        input_tokens, output_tokens, total_tokens,
        input_cost, output_cost, total_cost
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        data.id,
        data.provider,
        data.model,
        data.conversationId ?? null,
        data.inputTokens,
        data.outputTokens,
        totalTokens,
        data.inputCost,
        data.outputCost,
        totalCost,
      ]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create cost');
    return result;
  }

  async getById(id: string): Promise<Cost | null> {
    const row = await this.queryOne<CostRow>(
      `SELECT * FROM costs WHERE id = $1`,
      [id]
    );
    return row ? rowToCost(row) : null;
  }

  async getAll(limit = 100, offset = 0): Promise<Cost[]> {
    const rows = await this.query<CostRow>(
      `SELECT * FROM costs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToCost);
  }

  async getByProvider(provider: string, limit = 100): Promise<Cost[]> {
    const rows = await this.query<CostRow>(
      `SELECT * FROM costs WHERE provider = $1 ORDER BY created_at DESC LIMIT $2`,
      [provider, limit]
    );
    return rows.map(rowToCost);
  }

  async getByConversation(conversationId: string): Promise<Cost[]> {
    const rows = await this.query<CostRow>(
      `SELECT * FROM costs WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return rows.map(rowToCost);
  }

  async getSummaryByProvider(): Promise<CostSummary[]> {
    const rows = await this.query<{
      provider: string;
      model: string;
      total_calls: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_tokens: string;
      total_cost: string;
    }>(
      `SELECT
        provider,
        model,
        COUNT(*) as total_calls,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost) as total_cost
      FROM costs
      GROUP BY provider, model
      ORDER BY total_cost DESC`
    );

    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      totalCalls: parseInt(row.total_calls, 10),
      totalInputTokens: parseInt(row.total_input_tokens || '0', 10),
      totalOutputTokens: parseInt(row.total_output_tokens || '0', 10),
      totalTokens: parseInt(row.total_tokens || '0', 10),
      totalCost: parseFloat(row.total_cost || '0'),
    }));
  }

  async getDailyCosts(days = 30): Promise<DailyCost[]> {
    const rows = await this.query<{
      date: string;
      total_calls: string;
      total_tokens: string;
      total_cost: string;
    }>(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as total_calls,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost) as total_cost
      FROM costs
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC`
    );

    return rows.map((row) => ({
      date: row.date,
      totalCalls: parseInt(row.total_calls, 10),
      totalTokens: parseInt(row.total_tokens || '0', 10),
      totalCost: parseFloat(row.total_cost || '0'),
    }));
  }

  async getTotalCost(): Promise<number> {
    const row = await this.queryOne<{ total: string | null }>(
      `SELECT SUM(total_cost) as total FROM costs`
    );
    return parseFloat(row?.total ?? '0');
  }

  async getTotalTokens(): Promise<{ input: number; output: number; total: number }> {
    const row = await this.queryOne<{
      input: string | null;
      output: string | null;
      total: string | null;
    }>(
      `SELECT
        SUM(input_tokens) as input,
        SUM(output_tokens) as output,
        SUM(total_tokens) as total
      FROM costs`
    );

    return {
      input: parseInt(row?.input ?? '0', 10),
      output: parseInt(row?.output ?? '0', 10),
      total: parseInt(row?.total ?? '0', 10),
    };
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM costs`
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const costsRepo = new CostsRepository();

// Factory function
export function createCostsRepository(): CostsRepository {
  return new CostsRepository();
}

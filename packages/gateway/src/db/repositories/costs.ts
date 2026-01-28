/**
 * Costs Repository
 *
 * Tracks LLM API costs and token usage
 */

import { getDatabase } from '../connection.js';

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
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    inputCost: row.input_cost,
    outputCost: row.output_cost,
    totalCost: row.total_cost,
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

export class CostsRepository {
  private db = getDatabase();

  create(data: {
    id: string;
    provider: string;
    model: string;
    conversationId?: string;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
  }): Cost {
    const totalTokens = data.inputTokens + data.outputTokens;
    const totalCost = data.inputCost + data.outputCost;

    const stmt = this.db.prepare(`
      INSERT INTO costs (
        id, provider, model, conversation_id,
        input_tokens, output_tokens, total_tokens,
        input_cost, output_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.provider,
      data.model,
      data.conversationId ?? null,
      data.inputTokens,
      data.outputTokens,
      totalTokens,
      data.inputCost,
      data.outputCost,
      totalCost
    );

    return this.getById(data.id)!;
  }

  getById(id: string): Cost | null {
    const stmt = this.db.prepare<string, CostRow>(`
      SELECT * FROM costs WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToCost(row) : null;
  }

  getAll(limit = 100, offset = 0): Cost[] {
    const stmt = this.db.prepare<[number, number], CostRow>(`
      SELECT * FROM costs ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset).map(rowToCost);
  }

  getByProvider(provider: string, limit = 100): Cost[] {
    const stmt = this.db.prepare<[string, number], CostRow>(`
      SELECT * FROM costs WHERE provider = ? ORDER BY created_at DESC LIMIT ?
    `);

    return stmt.all(provider, limit).map(rowToCost);
  }

  getByConversation(conversationId: string): Cost[] {
    const stmt = this.db.prepare<string, CostRow>(`
      SELECT * FROM costs WHERE conversation_id = ? ORDER BY created_at ASC
    `);

    return stmt.all(conversationId).map(rowToCost);
  }

  getSummaryByProvider(): CostSummary[] {
    const stmt = this.db.prepare<[], {
      provider: string;
      model: string;
      total_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_cost: number;
    }>(`
      SELECT
        provider,
        model,
        COUNT(*) as total_calls,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost) as total_cost
      FROM costs
      GROUP BY provider, model
      ORDER BY total_cost DESC
    `);

    return stmt.all().map((row) => ({
      provider: row.provider,
      model: row.model,
      totalCalls: row.total_calls,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_tokens,
      totalCost: row.total_cost,
    }));
  }

  getDailyCosts(days = 30): DailyCost[] {
    const stmt = this.db.prepare<number, {
      date: string;
      total_calls: number;
      total_tokens: number;
      total_cost: number;
    }>(`
      SELECT
        date(created_at) as date,
        COUNT(*) as total_calls,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost) as total_cost
      FROM costs
      WHERE created_at >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `);

    return stmt.all(days).map((row) => ({
      date: row.date,
      totalCalls: row.total_calls,
      totalTokens: row.total_tokens,
      totalCost: row.total_cost,
    }));
  }

  getTotalCost(): number {
    const stmt = this.db.prepare<[], { total: number | null }>(`
      SELECT SUM(total_cost) as total FROM costs
    `);

    return stmt.get()?.total ?? 0;
  }

  getTotalTokens(): { input: number; output: number; total: number } {
    const stmt = this.db.prepare<[], {
      input: number | null;
      output: number | null;
      total: number | null;
    }>(`
      SELECT
        SUM(input_tokens) as input,
        SUM(output_tokens) as output,
        SUM(total_tokens) as total
      FROM costs
    `);

    const result = stmt.get();
    return {
      input: result?.input ?? 0,
      output: result?.output ?? 0,
      total: result?.total ?? 0,
    };
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM costs
    `);

    return stmt.get()?.count ?? 0;
  }
}

export const costsRepo = new CostsRepository();

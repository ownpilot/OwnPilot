/**
 * Budget Tracker
 *
 * Tracks per-agent spending across heartbeat cycles.
 * Queries the heartbeat_log table for daily/monthly totals.
 */

import type { SoulAutonomy } from './types.js';

/**
 * Database query interface (subset of DatabaseAdapter).
 */
export interface IBudgetDatabase {
  query<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Per-agent budget tracking and enforcement.
 */
export class BudgetTracker {
  constructor(private db: IBudgetDatabase) {}

  /**
   * Check if the agent has remaining daily budget.
   */
  async checkBudget(agentId: string, autonomy: SoulAutonomy): Promise<boolean> {
    const dailySpend = await this.getDailySpend(agentId);
    return dailySpend < autonomy.maxCostPerDay;
  }

  /**
   * Record a spend amount (no-op if heartbeat_log already stores cost).
   * Can be extended with Redis caching for hot-path checks.
   */
  async recordSpend(_agentId: string, _amount: number): Promise<void> {
    // Cost is already recorded in heartbeat_log table.
    // This method exists as an extension point for caching.
  }

  /**
   * Get total spend for an agent today.
   */
  async getDailySpend(agentId: string): Promise<number> {
    const rows = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(cost), 0) AS total
       FROM heartbeat_log
       WHERE agent_id = $1 AND created_at::date = CURRENT_DATE`,
      [agentId]
    );
    return parseFloat(rows[0]?.total ?? '0');
  }

  /**
   * Get total spend for an agent this month.
   */
  async getMonthlySpend(agentId: string): Promise<number> {
    const rows = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(cost), 0) AS total
       FROM heartbeat_log
       WHERE agent_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [agentId]
    );
    return parseFloat(rows[0]?.total ?? '0');
  }
}

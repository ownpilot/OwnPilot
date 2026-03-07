/**
 * Coding Agent Subscriptions Repository
 *
 * Budget and subscription tracking per coding agent provider.
 */

import { BaseRepository } from './base.js';

// =============================================================================
// ROW TYPE
// =============================================================================

interface SubscriptionRow {
  id: string;
  user_id: string;
  provider_ref: string;
  tier: string | null;
  monthly_budget_usd: number;
  current_spend_usd: number;
  max_concurrent_sessions: number;
  reset_at: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface CodingAgentSubscriptionRecord {
  id: string;
  userId: string;
  providerRef: string;
  tier?: string;
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  maxConcurrentSessions: number;
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSubscriptionInput {
  providerRef: string;
  tier?: string;
  monthlyBudgetUsd?: number;
  currentSpendUsd?: number;
  maxConcurrentSessions?: number;
  resetAt?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: SubscriptionRow): CodingAgentSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    providerRef: row.provider_ref,
    tier: row.tier ?? undefined,
    monthlyBudgetUsd: Number(row.monthly_budget_usd),
    currentSpendUsd: Number(row.current_spend_usd),
    maxConcurrentSessions: Number(row.max_concurrent_sessions),
    resetAt: row.reset_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CodingAgentSubscriptionsRepository extends BaseRepository {
  async getByProvider(
    providerRef: string,
    userId = 'default'
  ): Promise<CodingAgentSubscriptionRecord | null> {
    const row = await this.queryOne<SubscriptionRow>(
      'SELECT * FROM coding_agent_subscriptions WHERE provider_ref = $1 AND user_id = $2',
      [providerRef, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async list(userId = 'default'): Promise<CodingAgentSubscriptionRecord[]> {
    const rows = await this.query<SubscriptionRow>(
      'SELECT * FROM coding_agent_subscriptions WHERE user_id = $1 ORDER BY provider_ref',
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async upsert(
    input: UpsertSubscriptionInput,
    userId = 'default'
  ): Promise<CodingAgentSubscriptionRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO coding_agent_subscriptions (
        id, user_id, provider_ref, tier, monthly_budget_usd, current_spend_usd,
        max_concurrent_sessions, reset_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, provider_ref) DO UPDATE SET
        tier = EXCLUDED.tier,
        monthly_budget_usd = EXCLUDED.monthly_budget_usd,
        current_spend_usd = EXCLUDED.current_spend_usd,
        max_concurrent_sessions = EXCLUDED.max_concurrent_sessions,
        reset_at = EXCLUDED.reset_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        userId,
        input.providerRef,
        input.tier ?? null,
        input.monthlyBudgetUsd ?? 0,
        input.currentSpendUsd ?? 0,
        input.maxConcurrentSessions ?? 3,
        input.resetAt ?? null,
        now,
        now,
      ]
    );

    const record = await this.getByProvider(input.providerRef, userId);
    if (!record) throw new Error('Failed to upsert subscription');
    return record;
  }

  async addSpend(providerRef: string, userId: string, amountUsd: number): Promise<void> {
    await this.execute(
      `UPDATE coding_agent_subscriptions
       SET current_spend_usd = current_spend_usd + $1, updated_at = $2
       WHERE provider_ref = $3 AND user_id = $4`,
      [amountUsd, new Date().toISOString(), providerRef, userId]
    );
  }

  async resetMonthlySpend(userId = 'default'): Promise<void> {
    const now = new Date().toISOString();
    await this.execute(
      `UPDATE coding_agent_subscriptions
       SET current_spend_usd = 0, reset_at = $1, updated_at = $1
       WHERE user_id = $2`,
      [now, userId]
    );
  }

  async delete(providerRef: string, userId = 'default'): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM coding_agent_subscriptions WHERE provider_ref = $1 AND user_id = $2',
      [providerRef, userId]
    );
    return (result?.changes ?? 0) > 0;
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const codingAgentSubscriptionsRepo = new CodingAgentSubscriptionsRepository();

export function createCodingAgentSubscriptionsRepository(): CodingAgentSubscriptionsRepository {
  return new CodingAgentSubscriptionsRepository();
}

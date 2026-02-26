/**
 * CLI Tool Policies Repository
 *
 * Per-user, per-tool execution policies (allowed/prompt/blocked).
 * Used by the CLI tool service to enforce security policies.
 */

import { BaseRepository } from './base.js';
import type { CliToolPolicy } from '@ownpilot/core';

// =============================================================================
// ROW TYPE
// =============================================================================

interface PolicyRow {
  id: string;
  user_id: string;
  tool_name: string;
  policy: string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface ToolPolicyRecord {
  toolName: string;
  policy: CliToolPolicy;
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CliToolPoliciesRepository extends BaseRepository {
  /**
   * Get the policy for a specific tool.
   * Returns null if no custom policy is set (caller should use catalog default).
   */
  async getPolicy(toolName: string, userId = 'default'): Promise<CliToolPolicy | null> {
    const row = await this.queryOne<PolicyRow>(
      'SELECT * FROM cli_tool_policies WHERE tool_name = $1 AND user_id = $2',
      [toolName, userId]
    );
    return row ? (row.policy as CliToolPolicy) : null;
  }

  /**
   * Set the policy for a specific tool (UPSERT).
   */
  async setPolicy(toolName: string, policy: CliToolPolicy, userId = 'default'): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO cli_tool_policies (id, user_id, tool_name, policy, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, tool_name) DO UPDATE SET
         policy = EXCLUDED.policy,
         updated_at = EXCLUDED.updated_at`,
      [id, userId, toolName, policy, now, now]
    );
  }

  /**
   * List all policies for a user.
   */
  async listPolicies(userId = 'default'): Promise<ToolPolicyRecord[]> {
    const rows = await this.query<PolicyRow>(
      'SELECT * FROM cli_tool_policies WHERE user_id = $1 ORDER BY tool_name',
      [userId]
    );
    return rows.map((r) => ({
      toolName: r.tool_name,
      policy: r.policy as CliToolPolicy,
    }));
  }

  /**
   * Delete a policy (revert to catalog default).
   */
  async deletePolicy(toolName: string, userId = 'default'): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM cli_tool_policies WHERE tool_name = $1 AND user_id = $2',
      [toolName, userId]
    );
    return (result?.changes ?? 0) > 0;
  }

  /**
   * Batch set policies for multiple tools.
   */
  async batchSetPolicies(
    policies: Array<{ toolName: string; policy: CliToolPolicy }>,
    userId = 'default'
  ): Promise<void> {
    for (const p of policies) {
      await this.setPolicy(p.toolName, p.policy, userId);
    }
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const cliToolPoliciesRepo = new CliToolPoliciesRepository();

export function createCliToolPoliciesRepository(): CliToolPoliciesRepository {
  return new CliToolPoliciesRepository();
}

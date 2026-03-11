/**
 * Agent Registry
 *
 * Unified registry for all agent types. Provides a single point to query
 * running agents, their states, and resource usage across the entire system.
 *
 * This does NOT replace type-specific services — it wraps them to provide
 * a unified view for cross-cutting concerns like dashboard, monitoring,
 * and resource budgeting.
 */

import type {
  AgentType,
  UnifiedAgentState,
  ResourceMetrics,
} from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('AgentRegistry');

// ============================================================================
// Types
// ============================================================================

/** Summary of a running agent, regardless of type. */
export interface AgentSummary {
  id: string;
  type: AgentType;
  name: string;
  state: UnifiedAgentState;
  userId: string;
  startedAt: Date | null;
  metrics: ResourceMetrics;
}

/** Aggregated metrics across all agent types. */
export interface SystemAgentMetrics {
  totalActive: number;
  byType: Record<AgentType, number>;
  totalTokensUsed: number;
  totalCostUsd: number;
}

// ============================================================================
// Registry
// ============================================================================

/** Type-specific adapter that bridges to the underlying service. */
export interface AgentTypeAdapter {
  type: AgentType;
  /** List active agent summaries for a user (or all users if userId omitted). */
  listActive(userId?: string): AgentSummary[];
  /** Get a single agent summary by ID. */
  get(agentId: string, userId: string): AgentSummary | null;
  /** Cancel an agent by ID. Returns true if successfully cancelled. */
  cancel(agentId: string, userId: string): Promise<boolean>;
}

class AgentRegistryImpl {
  private adapters = new Map<AgentType, AgentTypeAdapter>();

  /** Register a type-specific adapter. */
  registerAdapter(adapter: AgentTypeAdapter): void {
    this.adapters.set(adapter.type, adapter);
    log.debug(`Registered adapter for agent type: ${adapter.type}`);
  }

  /** List all active agents across all types. */
  listAll(userId?: string): AgentSummary[] {
    const results: AgentSummary[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        results.push(...adapter.listActive(userId));
      } catch (err) {
        log.warn(`Failed to list ${adapter.type} agents`, { error: err });
      }
    }
    return results;
  }

  /** Get a single agent by type + ID. */
  get(type: AgentType, agentId: string, userId: string): AgentSummary | null {
    const adapter = this.adapters.get(type);
    if (!adapter) return null;
    try {
      return adapter.get(agentId, userId);
    } catch {
      return null;
    }
  }

  /** Cancel an agent by type + ID. */
  async cancel(
    type: AgentType,
    agentId: string,
    userId: string
  ): Promise<boolean> {
    const adapter = this.adapters.get(type);
    if (!adapter) return false;
    return adapter.cancel(agentId, userId);
  }

  /** Get aggregated metrics across all types. */
  getSystemMetrics(userId?: string): SystemAgentMetrics {
    const byType: Record<string, number> = {};
    let totalTokens = 0;
    let totalCost = 0;
    let totalActive = 0;

    for (const adapter of this.adapters.values()) {
      try {
        const agents = adapter.listActive(userId);
        byType[adapter.type] = agents.length;
        totalActive += agents.length;
        for (const agent of agents) {
          totalTokens += agent.metrics.tokensUsed;
          totalCost += agent.metrics.costUsd;
        }
      } catch {
        byType[adapter.type] = 0;
      }
    }

    return {
      totalActive,
      byType: byType as Record<AgentType, number>,
      totalTokensUsed: totalTokens,
      totalCostUsd: totalCost,
    };
  }
}

// Singleton
let registry: AgentRegistryImpl | null = null;

export function getAgentRegistry(): AgentRegistryImpl {
  if (!registry) {
    registry = new AgentRegistryImpl();
  }
  return registry;
}

export function resetAgentRegistry(): void {
  registry = null;
}

/**
 * AutonomousAgentResult - Base result type for all autonomous agent executions.
 *
 * Shared by ClawCycleResult, FleetWorkerResult, and SubagentSession.
 * Each subtype extends this with domain-specific fields while maintaining a
 * consistent shape for cross-agent observability and reporting.
 *
 * Note: Named AutonomousAgentResult (not AgentExecutionResult) to avoid
 * collision with the existing AgentExecutionResult in agent-executor/.
 */

/** Base result type for all autonomous agent executions */
export interface AutonomousAgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    args: unknown;
    result: unknown;
    success?: boolean;
    durationMs?: number;
  }>;
  tokensUsed?: { prompt: number; completion: number };
  durationMs: number;
  error?: string;
}

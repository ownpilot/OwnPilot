/**
 * Agent System Domain
 *
 * Bounded context for all agent lifecycle management:
 * regular agents, coding agents, background agents, soul agents,
 * subagents, orchestra, crews, and inter-agent messaging.
 *
 * Tables: agents, agent_souls, agent_crews, agent_crew_members,
 *         agent_messages, heartbeat_log, background_agents,
 *         background_agent_*, subagent_history, orchestra_executions,
 *         orchestration_runs
 *
 * Routes: /agents, /souls, /crews, /background-agents, /subagents,
 *         /orchestra, /agent-messages, /heartbeat-logs, /agent-command
 *
 * Public API: AgentRegistry (unified agent management)
 */

export const agentSystemDomain = {
  name: 'agent-system' as const,

  /** Route groups owned by this domain */
  routes: [
    '/api/v1/agents',
    '/api/v1/chat',
    '/api/v1/souls',
    '/api/v1/crews',
    '/api/v1/agent-messages',
    '/api/v1/heartbeat-logs',
    '/api/v1/agent-command',
    '/api/v1/audit',
    '/api/v1/debug',
    '/api/v1/heartbeats',
    '/api/v1/background-agents',
    '/api/v1/subagents',
    '/api/v1/orchestra',
  ],

  /** Database tables owned by this domain */
  tables: [
    'agents',
    'agent_souls',
    'agent_crews',
    'agent_crew_members',
    'agent_messages',
    'heartbeat_log',
    'background_agents',
    'background_agent_configs',
    'background_agent_history',
    'subagent_history',
    'orchestra_executions',
    'orchestration_runs',
  ],

  /** Services that form the public API of this domain */
  publicServices: [
    'agent-registry',
    'soul-heartbeat-service',
    'background-agent-service',
    'subagent-service',
    'orchestra-engine',
    'coding-agent-orchestrator',
  ],
} as const;

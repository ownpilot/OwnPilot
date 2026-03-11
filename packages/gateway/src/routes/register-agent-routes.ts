/**
 * Agent Domain Route Registration
 *
 * Mounts all agent-related routes: core agents, souls, crews,
 * background agents, subagents, orchestra, and agent messaging.
 */

import type { Hono } from 'hono';
import {
  agentRoutes,
  chatRoutes,
  soulRoutes,
  crewRoutes,
  agentMessageRoutes,
  heartbeatLogRoutes,
  agentCommandCenterRoutes,
  debugRoutes,
  auditRoutes,
  heartbeatsRoutes,
  backgroundAgentsRoutes,
  subagentRoutes,
  orchestraRoutes,
} from './index.js';

export function registerAgentRoutes(app: Hono): void {
  app.route('/api/v1/agents', agentRoutes);
  app.route('/api/v1/chat', chatRoutes);

  // Agent Souls & Crews
  app.route('/api/v1/souls', soulRoutes);
  app.route('/api/v1/crews', crewRoutes);
  app.route('/api/v1/agent-messages', agentMessageRoutes);
  app.route('/api/v1/heartbeat-logs', heartbeatLogRoutes);

  // Agent Command Center (unified control for all agents)
  app.route('/api/v1/agent-command', agentCommandCenterRoutes);

  // Audit & Debug
  app.route('/api/v1/audit', auditRoutes);
  app.route('/api/v1/debug', debugRoutes);

  // Heartbeats (NL-to-cron periodic tasks)
  app.route('/api/v1/heartbeats', heartbeatsRoutes);

  // Background Agents (persistent, long-running autonomous agents)
  app.route('/api/v1/background-agents', backgroundAgentsRoutes);

  // Subagents (ephemeral, task-oriented child agents)
  app.route('/api/v1/subagents', subagentRoutes);

  // Agent Orchestra (multi-agent collaboration & delegation)
  app.route('/api/v1/orchestra', orchestraRoutes);
}

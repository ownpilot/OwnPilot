/**
 * Agent Domain Route Registration
 *
 * Mounts all agent-related routes: core agents, souls, crews,
 * claws, heartbeats, audit, and agent messaging.
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
  clawRoutes,
  agenticRoutes,
} from '../index.js';

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

  // Claws (unified autonomous agent runtime)
  app.route('/api/v1/claws', clawRoutes);

  // Agentic (unified task execution across all agent types)
  app.route('/api/v1/agentic', agenticRoutes);
}

/**
 * v2 API Route Registration
 *
 * Side-by-side v2 API: all v1 routes mirrored at /api/v2/ using the same handlers.
 * New breaking changes land in v2. v1 is kept for backward compatibility with
 * a documented deprecation timeline.
 *
 * See ADR-002 (gap 24.7) for versioning strategy details.
 */

import type { Hono } from 'hono';
import {
  // Platform
  healthRoutes,
  uiAuthRoutes,
  settingsRoutes,
  profileRoutes,
  providersRoutes,
  modelsRoutes,
  modelConfigsRoutes,
  modelRoutingRoutes,
  configServicesRoutes,
  toolsRoutes,
  customToolsRoutes,
  databaseRoutes,
  dashboardRoutes,
  securityRoutes,
  pluginsRoutes,
  workspaceRoutes,
  fileWorkspaceRoutes,
  // Agent
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
  subagentRoutes,
  orchestraRoutes,
  fleetRoutes,
  clawRoutes,
  // Data
  personalDataRoutes,
  customDataRoutes,
  memoriesRoutes,
  goalsRoutes,
  expensesRoutes,
  costRoutes,
  artifactsRoutes,
  productivityRoutes,
  // Automation
  triggersRoutes,
  plansRoutes,
  workflowRoutes,
  autonomyRoutes,
  executionPermissionsRoutes,
  // Integration
  channelRoutes,
  channelAuthRoutes,
  composioRoutes,
  mcpRoutes,
  localProvidersRoutes,
  codingAgentsRoutes,
  cliProvidersRoutes,
  cliToolsRoutes,
  cliChatRoutes,
  browserRoutes,
  voiceRoutes,
  edgeRoutes,
  bridgeRoutes,
  extensionsRoutes,
  skillsRoutes,
  webhookRoutes,
  notificationRoutes,
} from './index.js';

export function registerV2Routes(app: Hono): void {
  // Health (no version prefix — shared with v1)
  app.route('/health', healthRoutes);

  // ── Platform Domain ──────────────────────────────────────────────────────────

  // Auth
  app.route('/api/v2/auth', uiAuthRoutes);

  // Settings & Profile
  app.route('/api/v2/settings', settingsRoutes);
  app.route('/api/v2/profile', profileRoutes);

  // Providers & Models
  app.route('/api/v2/providers', providersRoutes);
  app.route('/api/v2/models', modelsRoutes);
  app.route('/api/v2/model-configs', modelConfigsRoutes);
  app.route('/api/v2/model-routing', modelRoutingRoutes);

  // Config Center
  app.route('/api/v2/config-services', configServicesRoutes);

  // Tools
  app.route('/api/v2/tools', toolsRoutes);
  app.route('/api/v2/custom-tools', customToolsRoutes);

  // Database Admin
  app.route('/api/v2/db', databaseRoutes);

  // Dashboard
  app.route('/api/v2/dashboard', dashboardRoutes);

  // Security
  app.route('/api/v2/security', securityRoutes);

  // Plugins
  app.route('/api/v2/plugins', pluginsRoutes);

  // Workspaces
  app.route('/api/v2/workspaces', workspaceRoutes);
  app.route('/api/v2/file-workspaces', fileWorkspaceRoutes);

  // ── Agent Domain ─────────────────────────────────────────────────────────────

  app.route('/api/v2/agents', agentRoutes);
  app.route('/api/v2/chat', chatRoutes);

  // Souls & Crews
  app.route('/api/v2/souls', soulRoutes);
  app.route('/api/v2/crews', crewRoutes);
  app.route('/api/v2/agent-messages', agentMessageRoutes);
  app.route('/api/v2/heartbeat-logs', heartbeatLogRoutes);

  // Agent Command Center
  app.route('/api/v2/agent-command', agentCommandCenterRoutes);

  // Audit & Debug
  app.route('/api/v2/audit', auditRoutes);
  app.route('/api/v2/debug', debugRoutes);

  // Heartbeats
  app.route('/api/v2/heartbeats', heartbeatsRoutes);

  // Subagents
  app.route('/api/v2/subagents', subagentRoutes);

  // Orchestra
  app.route('/api/v2/orchestra', orchestraRoutes);

  // Fleet
  app.route('/api/v2/fleet', fleetRoutes);

  // Claws
  app.route('/api/v2/claws', clawRoutes);

  // ── Data Domain ──────────────────────────────────────────────────────────────

  // Personal data (tasks, bookmarks, notes, calendar, contacts, summary)
  app.route('/api/v2', personalDataRoutes);

  // Custom data
  app.route('/api/v2/custom-data', customDataRoutes);

  // Memory
  app.route('/api/v2/memories', memoriesRoutes);

  // Goals
  app.route('/api/v2/goals', goalsRoutes);

  // Expenses
  app.route('/api/v2/expenses', expensesRoutes);

  // Costs
  app.route('/api/v2/costs', costRoutes);

  // Artifacts
  app.route('/api/v2/artifacts', artifactsRoutes);

  // Productivity
  app.route('/api/v2', productivityRoutes);

  // ── Automation Domain ────────────────────────────────────────────────────────

  app.route('/api/v2/triggers', triggersRoutes);
  app.route('/api/v2/plans', plansRoutes);
  app.route('/api/v2/workflows', workflowRoutes);
  app.route('/api/v2/autonomy', autonomyRoutes);
  app.route('/api/v2/execution-permissions', executionPermissionsRoutes);

  // ── Integration Domain ──────────────────────────────────────────────────────

  // Webhooks stay at /webhooks (same as v1 — external callers use secret path)
  app.route('/webhooks', webhookRoutes);

  // Channels
  app.route('/api/v2/channels', channelRoutes);
  app.route('/api/v2/channels/auth', channelAuthRoutes);

  // Bridges
  app.route('/api/v2/bridges', bridgeRoutes);

  // Composio
  app.route('/api/v2/composio', composioRoutes);

  // MCP
  app.route('/api/v2/mcp', mcpRoutes);

  // Local Providers
  app.route('/api/v2/local-providers', localProvidersRoutes);

  // Coding Agents
  app.route('/api/v2/coding-agents', codingAgentsRoutes);

  // CLI Providers
  app.route('/api/v2/cli-providers', cliProvidersRoutes);

  // CLI Tools
  app.route('/api/v2/cli-tools', cliToolsRoutes);

  // CLI Chat
  app.route('/api/v2/cli-chat', cliChatRoutes);

  // Browser
  app.route('/api/v2/browser', browserRoutes);

  // Voice
  app.route('/api/v2/voice', voiceRoutes);

  // Edge
  app.route('/api/v2/edge', edgeRoutes);

  // Extensions
  app.route('/api/v2/extensions', extensionsRoutes);

  // Skills
  app.route('/api/v2/skills', skillsRoutes);

  // Notifications
  app.route('/api/v2/notifications', notificationRoutes);
}

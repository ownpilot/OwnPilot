/**
 * Integration Domain Route Registration
 *
 * Mounts all integration-related routes: channels, composio,
 * MCP, coding agents, CLI tools, browser, voice, edge, bridges,
 * extensions, skills, and webhooks.
 */

import type { Hono } from 'hono';
import {
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
} from './index.js';

export function registerIntegrationRoutes(app: Hono): void {
  // Webhooks - mounted outside /api/v1 since external services cannot send API keys.
  // Secret path segment provides authentication.
  app.route('/webhooks', webhookRoutes);

  // Channels
  app.route('/api/v1/channels', channelRoutes);
  app.route('/api/v1/channels/auth', channelAuthRoutes);

  // Channel Bridges (UCP cross-channel bridging)
  app.route('/api/v1/bridges', bridgeRoutes);

  // Composio (OAuth app integrations — Gmail, GitHub, Slack, etc.)
  app.route('/api/v1/composio', composioRoutes);

  // MCP (Model Context Protocol — external server connections + tool exposure)
  app.route('/api/v1/mcp', mcpRoutes);

  // Local AI Providers (LM Studio, Ollama, etc.)
  app.route('/api/v1/local-providers', localProvidersRoutes);

  // Coding Agents (external AI coding CLI orchestration)
  app.route('/api/v1/coding-agents', codingAgentsRoutes);

  // CLI Providers (custom coding agent provider registry)
  app.route('/api/v1/cli-providers', cliProvidersRoutes);

  // CLI Tools (discovery, policies, installation for all CLI tools)
  app.route('/api/v1/cli-tools', cliToolsRoutes);

  // CLI Chat Providers (use CLI subscriptions as chat providers)
  app.route('/api/v1/cli-chat', cliChatRoutes);

  // Browser (headless browser automation)
  app.route('/api/v1/browser', browserRoutes);

  // Voice (STT/TTS REST API)
  app.route('/api/v1/voice', voiceRoutes);

  // Edge devices (IoT/MQTT delegation)
  app.route('/api/v1/edge', edgeRoutes);

  // User Extensions (shareable tool + prompt + trigger bundles)
  app.route('/api/v1/extensions', extensionsRoutes);

  // Skills (npm discovery, install, permissions)
  app.route('/api/v1/skills', skillsRoutes);
}

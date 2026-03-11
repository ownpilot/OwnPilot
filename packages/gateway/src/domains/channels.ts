/**
 * Channels & Integration Domain
 *
 * Bounded context for external integrations:
 * messaging channels, bridges, MCP servers,
 * composio, browser automation, voice, edge/IoT.
 *
 * Tables: channels, channel_messages, channel_sessions,
 *         channel_users, channel_verification_tokens,
 *         channel_bridges, oauth_integrations,
 *         edge_devices, edge_commands, edge_telemetry,
 *         browser_workflows
 *
 * Routes: /channels, /bridges, /mcp, /composio, /browser,
 *         /voice, /edge, /webhooks, /local-providers,
 *         /coding-agents, /cli-*
 */

export const channelsDomain = {
  name: 'channels' as const,

  routes: [
    '/webhooks',
    '/api/v1/channels',
    '/api/v1/channels/auth',
    '/api/v1/bridges',
    '/api/v1/composio',
    '/api/v1/mcp',
    '/api/v1/local-providers',
    '/api/v1/coding-agents',
    '/api/v1/cli-providers',
    '/api/v1/cli-tools',
    '/api/v1/cli-chat',
    '/api/v1/browser',
    '/api/v1/voice',
    '/api/v1/edge',
    '/api/v1/extensions',
    '/api/v1/skills',
  ],

  tables: [
    'channels',
    'channel_messages',
    'channel_sessions',
    'channel_users',
    'channel_verification_tokens',
    'channel_bridges',
    'oauth_integrations',
    'edge_devices',
    'edge_commands',
    'edge_telemetry',
    'browser_workflows',
  ],

  publicServices: [
    'channel-service',
    'edge-service',
    'mcp-client-service',
    'composio-service',
    'browser-service',
    'voice-service',
  ],
} as const;

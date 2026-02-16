/**
 * Composio Integration Plugin
 *
 * Provides access to 1000+ OAuth app integrations via Composio SDK.
 * Registers 4 meta-tools: composio_search, composio_execute, composio_connect, composio_status.
 *
 * The AI uses these to dynamically discover and execute actions on connected apps
 * (Gmail, GitHub, Slack, Notion, Jira, and 500+ more).
 */

import {
  createPlugin,
  type PluginCapability,
  type PluginPermission,
  type ConfigFieldDefinition,
} from '@ownpilot/core';
import { composioService } from '../services/composio-service.js';
import { getLog } from '../services/log.js';

const log = getLog('ComposioPlugin');

// Default userId for single-user deployment
const DEFAULT_USER_ID = 'default';

// =============================================================================
// Tool Executors
// =============================================================================

async function composioSearchExecutor(args: Record<string, unknown>) {
  if (!composioService.isConfigured()) {
    return {
      content: 'Composio API key not configured. Set it in Config Center → Composio, or set COMPOSIO_API_KEY environment variable.',
      isError: true,
    };
  }

  try {
    const query = String(args.query ?? '');
    const app = args.app ? String(args.app) : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    const actions = await composioService.searchActions(query, app, limit);

    if (actions.length === 0) {
      return {
        content: `No Composio actions found for "${query}"${app ? ` in app "${app}"` : ''}. Try a broader search or different app name.`,
      };
    }

    const results = actions.map(a => ({
      action: a.slug,
      name: a.name,
      app: a.appName,
      description: a.description,
    }));

    return {
      content: JSON.stringify({
        query,
        app: app ?? null,
        count: results.length,
        actions: results,
        hint: 'Use composio_execute with the action slug to run an action. The user must connect the app first via composio_connect.',
      }, null, 2),
    };
  } catch (err) {
    log.error('composio_search failed:', err);
    return {
      content: `Composio search failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

async function composioExecuteExecutor(args: Record<string, unknown>) {
  if (!composioService.isConfigured()) {
    return {
      content: 'Composio API key not configured. Set it in Config Center → Composio, or set COMPOSIO_API_KEY environment variable.',
      isError: true,
    };
  }

  try {
    const action = String(args.action ?? '');
    if (!action) {
      return { content: 'Missing required parameter: action (e.g., "GITHUB_CREATE_ISSUE")', isError: true };
    }

    const actionArgs = (args.arguments && typeof args.arguments === 'object')
      ? args.arguments as Record<string, unknown>
      : {};

    const result = await composioService.executeAction(DEFAULT_USER_ID, action, actionArgs);

    return {
      content: JSON.stringify({
        action,
        success: true,
        result: result,
      }, null, 2),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('composio_execute failed:', err);

    // Detect connection-not-found errors and give helpful guidance
    if (message.includes('connected account') || message.includes('ConnectedAccountNotFound')) {
      const action = String(args.action ?? '');
      const appHint = action.split('_')[0]?.toLowerCase() ?? '';
      return {
        content: `No connected account found for this action. The user needs to connect the app first.\n\nUse composio_connect with app: "${appHint}" to start the OAuth authorization flow.`,
        isError: true,
      };
    }

    return {
      content: `Composio action execution failed: ${message}`,
      isError: true,
    };
  }
}

async function composioConnectExecutor(args: Record<string, unknown>) {
  if (!composioService.isConfigured()) {
    return {
      content: 'Composio API key not configured. Set it in Config Center → Composio, or set COMPOSIO_API_KEY environment variable.',
      isError: true,
    };
  }

  try {
    const app = String(args.app ?? '');
    if (!app) {
      return { content: 'Missing required parameter: app (e.g., "github", "gmail", "slack")', isError: true };
    }

    // Check if already connected
    const existing = await composioService.getConnectionStatus(DEFAULT_USER_ID, app);
    if (existing && existing.status === 'ACTIVE') {
      return {
        content: JSON.stringify({
          app,
          status: 'already_connected',
          message: `${app} is already connected and active. You can use composio_execute to run actions.`,
        }, null, 2),
      };
    }

    const connectionReq = await composioService.initiateConnection(DEFAULT_USER_ID, app);

    if (connectionReq.redirectUrl) {
      return {
        content: JSON.stringify({
          app,
          status: 'authorization_required',
          redirectUrl: connectionReq.redirectUrl,
          connectionId: connectionReq.connectedAccountId,
          message: `Please open this URL to authorize ${app}: ${connectionReq.redirectUrl}`,
        }, null, 2),
      };
    }

    return {
      content: JSON.stringify({
        app,
        status: connectionReq.connectionStatus,
        connectionId: connectionReq.connectedAccountId,
        message: `Connection initiated for ${app}. Status: ${connectionReq.connectionStatus}`,
      }, null, 2),
    };
  } catch (err) {
    log.error('composio_connect failed:', err);
    return {
      content: `Failed to connect app: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

async function composioStatusExecutor(args: Record<string, unknown>) {
  if (!composioService.isConfigured()) {
    return {
      content: 'Composio API key not configured. Set it in Config Center → Composio, or set COMPOSIO_API_KEY environment variable.',
      isError: true,
    };
  }

  try {
    const app = args.app ? String(args.app) : undefined;

    if (app) {
      const connection = await composioService.getConnectionStatus(DEFAULT_USER_ID, app);
      if (!connection) {
        return {
          content: JSON.stringify({
            app,
            connected: false,
            message: `${app} is not connected. Use composio_connect to authorize.`,
          }, null, 2),
        };
      }
      return {
        content: JSON.stringify({
          app,
          connected: true,
          status: connection.status,
          connectionId: connection.id,
        }, null, 2),
      };
    }

    // List all connections
    const connections = await composioService.getConnections(DEFAULT_USER_ID);

    if (connections.length === 0) {
      return {
        content: JSON.stringify({
          connections: [],
          count: 0,
          message: 'No apps connected yet. Use composio_search to find available apps and composio_connect to authorize them.',
        }, null, 2),
      };
    }

    return {
      content: JSON.stringify({
        connections: connections.map(c => ({
          app: c.appName,
          status: c.status,
          connectionId: c.id,
        })),
        count: connections.length,
      }, null, 2),
    };
  } catch (err) {
    log.error('composio_status failed:', err);
    return {
      content: `Failed to check status: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// =============================================================================
// Plugin Builder
// =============================================================================

const pluginConfigSchema: ConfigFieldDefinition[] = [
  {
    name: 'auto_suggest',
    label: 'Auto-suggest Composio tools',
    type: 'boolean',
    defaultValue: true,
    description: 'AI will suggest connecting apps when relevant tools are not found locally',
    order: 0,
  },
];

export function buildComposioPlugin() {
  return createPlugin()
    .meta({
      id: 'composio',
      name: 'Composio Integration',
      version: '1.0.0',
      description: '1000+ OAuth app integrations via Composio (Gmail, GitHub, Notion, Jira, Slack and more)',
      author: { name: 'OwnPilot' },
      capabilities: ['tools'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '\uD83D\uDD17',
      category: 'integration' as 'productivity',
      pluginConfigSchema,
      defaultConfig: { auto_suggest: true },
      requiredServices: [
        {
          name: 'composio',
          displayName: 'Composio',
          category: 'integrations',
          description: 'API key for Composio platform — connect 1000+ apps via OAuth',
          docsUrl: 'https://docs.composio.dev',
          configSchema: [
            {
              name: 'api_key',
              label: 'API Key',
              type: 'secret' as const,
              required: true,
              placeholder: 'comp-...',
              description: 'Get your API key from composio.dev dashboard',
              order: 0,
            },
          ],
        },
      ],
    })
    .tool(
      {
        name: 'composio_search',
        description: "Search Composio's 1000+ app integrations for available actions. Use this to find tools for Gmail, GitHub, Slack, Notion, Jira, and 500+ other apps.",
        brief: 'Search 1000+ Composio app actions',
        parameters: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query (e.g., "send email", "create issue", "list repos")' },
            app: { type: 'string', description: 'Filter by app name (e.g., "github", "gmail", "slack"). Optional.' },
            limit: { type: 'number', description: 'Max results (default 10, max 25)' },
          },
          required: ['query'],
        },
        tags: [
          'composio', 'integration', 'oauth', 'gmail', 'github', 'slack', 'notion', 'jira',
          'google', 'calendar', 'drive', 'sheets', 'trello', 'asana', 'linear', 'discord',
          'twitter', 'linkedin', 'dropbox', 'salesforce', 'hubspot', 'stripe', 'shopify',
        ],
        category: 'Integration',
      },
      composioSearchExecutor,
    )
    .tool(
      {
        name: 'composio_execute',
        description: 'Execute a Composio action on a connected app. The user must have connected the app first. Use composio_search to find action names.',
        brief: 'Execute Composio app action',
        parameters: {
          type: 'object' as const,
          properties: {
            action: { type: 'string', description: 'Action name (e.g., "GITHUB_CREATE_ISSUE", "GMAIL_SEND_EMAIL")' },
            arguments: { type: 'object', description: 'Action arguments (varies per action)' },
          },
          required: ['action'],
        },
        category: 'Integration',
      },
      composioExecuteExecutor,
    )
    .tool(
      {
        name: 'composio_connect',
        description: "Start connecting a new app via OAuth. Returns a URL the user must visit to authorize. Use composio_status to check current connections.",
        brief: 'Connect new app via OAuth',
        parameters: {
          type: 'object' as const,
          properties: {
            app: { type: 'string', description: 'App to connect (e.g., "github", "gmail", "slack")' },
          },
          required: ['app'],
        },
        requiresConfirmation: true,
        category: 'Integration',
      },
      composioConnectExecutor,
    )
    .tool(
      {
        name: 'composio_status',
        description: "List all connected Composio apps and their status, or check a specific app's connection.",
        brief: 'Check Composio connection status',
        parameters: {
          type: 'object' as const,
          properties: {
            app: { type: 'string', description: 'Specific app to check (optional, omit for all)' },
          },
        },
        category: 'Integration',
      },
      composioStatusExecutor,
    )
    .build();
}

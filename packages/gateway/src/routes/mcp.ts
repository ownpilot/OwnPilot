/**
 * MCP Routes
 *
 * REST endpoints for managing external MCP server connections,
 * plus the MCP protocol endpoint for exposing OwnPilot tools.
 */

import { Hono } from 'hono';
import { getBaseName, getServiceRegistry, Services } from '@ownpilot/core';
import { getMcpServersRepo } from '../db/repositories/mcp-servers.js';
import { handleMcpRequest } from '../services/mcp-server-service.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  sanitizeId,
  getUserId,
} from './helpers.js';
import {
  validateBody,
  mcpToolCallSchema,
  createMcpServerSchema,
  mcpToolSettingsSchema,
} from '../middleware/validation.js';

const log = getLog('McpRoutes');

export const mcpRoutes = new Hono();

// =============================================================================
// MCP PROTOCOL ENDPOINT — Streamable HTTP for external MCP clients
// =============================================================================

mcpRoutes.all('/serve', async (c) => {
  const response = await handleMcpRequest(c.req.raw);
  return response;
});

/**
 * GET /serve/info — MCP server metadata and exposed tools
 *
 * Returns the information needed to connect to OwnPilot as an MCP server,
 * including the endpoint URL, protocol, exposed tools, and config snippets.
 */
mcpRoutes.get('/serve/info', async (c) => {
  try {
    const registry = getSharedToolRegistry();
    const allTools = registry.getAllTools();

    // Build the server URL from the current request
    const proto =
      c.req.header('x-forwarded-proto') ?? (c.req.url.startsWith('https') ? 'https' : 'http');
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost:8080';
    const baseUrl = `${proto}://${host}`;
    const endpoint = `${baseUrl}/api/v1/mcp/serve`;

    // Categorize tools by source/namespace
    const tools = allTools.map((t) => ({
      name: getBaseName(t.definition.name),
      qualifiedName: t.definition.name,
      description: t.definition.description,
      category: t.definition.category,
    }));

    return apiResponse(c, {
      server: {
        name: 'OwnPilot',
        version: '1.0.0',
        protocol: 'Streamable HTTP (MCP)',
        endpoint,
        transport: 'streamable-http',
      },
      tools: {
        count: tools.length,
        items: tools,
      },
      // Ready-to-use config snippets for popular MCP clients
      configSnippets: {
        claude_desktop: {
          label: 'Claude Desktop',
          description: 'Add to claude_desktop_config.json under "mcpServers"',
          config: {
            ownpilot: {
              transport: 'streamable-http',
              url: endpoint,
            },
          },
        },
        cursor: {
          label: 'Cursor',
          description: 'Add to .cursor/mcp.json in your project',
          config: {
            mcpServers: {
              ownpilot: {
                transport: 'streamable-http',
                url: endpoint,
              },
            },
          },
        },
        claude_code: {
          label: 'Claude Code',
          description: 'Use --mcp-config .mcp.json flag or add to project .mcp.json',
          config: {
            mcpServers: {
              ownpilot: {
                type: 'http',
                url: endpoint,
              },
            },
          },
        },
        gemini_cli: {
          label: 'Gemini CLI',
          description: 'Add to ~/.gemini/settings.json under "mcpServers"',
          config: {
            mcpServers: {
              ownpilot: {
                type: 'streamable-http',
                url: endpoint,
              },
            },
          },
        },
        codex_cli: {
          label: 'Codex CLI',
          description: 'Add to ~/.codex/mcp.json under "mcpServers"',
          config: {
            mcpServers: {
              ownpilot: {
                type: 'streamable-http',
                url: endpoint,
              },
            },
          },
        },
        generic_http: {
          label: 'Generic HTTP Client',
          description: 'Any MCP client supporting Streamable HTTP',
          config: {
            url: endpoint,
            transport: 'streamable-http',
          },
        },
      },
    });
  } catch (err) {
    log.error('Failed to get MCP server info:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// CLI MCP TOOL-CALL PROXY — Used by the stdio MCP server for CLI tools
// =============================================================================

/**
 * POST /tool-call — Execute an OwnPilot meta-tool via HTTP.
 *
 * The standalone MCP stdio server (cli-mcp-server) proxies CLI tool calls here.
 * Accepts: { tool_name, arguments }
 * Returns: { content, isError }
 */
mcpRoutes.post('/tool-call', async (c) => {
  try {
    const body = validateBody(mcpToolCallSchema, await c.req.json());

    const { tool_name: toolName, arguments: toolArgs } = body;

    const registry = getSharedToolRegistry();
    const context = {
      callId: `mcp-cli-${Date.now()}`,
      userId: 'default',
      conversationId: 'mcp-cli',
      source: 'mcp' as const,
    };

    // Import executors dynamically to avoid circular deps
    const { executeSearchTools, executeGetToolHelp, executeUseTool, executeBatchUseTool } =
      await import('../tools/agent-tool-registry.js');

    let result: { content: unknown; isError?: boolean };

    switch (toolName) {
      case 'search_tools':
        result = await executeSearchTools(registry, toolArgs ?? {});
        break;
      case 'get_tool_help':
        result = await executeGetToolHelp(registry, toolArgs ?? {});
        break;
      case 'use_tool':
        result = await executeUseTool(registry, toolArgs ?? {}, context);
        break;
      case 'batch_use_tool':
        result = await executeBatchUseTool(registry, toolArgs ?? {}, context);
        break;
      default:
        result = {
          content: `Unknown meta-tool: ${toolName}. Use search_tools, get_tool_help, use_tool, or batch_use_tool.`,
          isError: true,
        };
    }

    return apiResponse(c, { content: String(result.content), isError: result.isError ?? false });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('MCP tool-call failed:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// REST MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * GET / — List all configured MCP servers
 */
mcpRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const repo = getMcpServersRepo();
    const servers = await repo.getAll(userId);

    // Enrich with live connection status
    const mcpService = getServiceRegistry().get(Services.McpClient);
    const enriched = servers.map((s) => ({
      ...s,
      connected: mcpService.isConnected(s.name),
    }));

    return apiResponse(c, { servers: enriched, count: enriched.length });
  } catch (err) {
    log.error('Failed to list MCP servers:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * POST / — Add new MCP server configuration
 */
mcpRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const rawBody = await c.req.json();
    const body = validateBody(createMcpServerSchema, rawBody);
    // enabled is a pass-through field not in the schema
    const enabled = typeof (rawBody as Record<string, unknown>).enabled === 'boolean' ? (rawBody as Record<string, unknown>).enabled as boolean : undefined;

    // Validate transport-specific fields
    if (body.transport === 'stdio' && !body.command?.trim()) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Command is required for stdio transport' },
        400
      );
    }
    if ((body.transport === 'sse' || body.transport === 'streamable-http') && !body.url?.trim()) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'URL is required for network transport' },
        400
      );
    }

    const repo = getMcpServersRepo();

    // Check uniqueness scoped to user
    const existing = await repo.getByName(body.name.trim(), userId);
    if (existing) {
      return apiError(
        c,
        { code: ERROR_CODES.ALREADY_EXISTS, message: `MCP server "${body.name}" already exists` },
        409
      );
    }

    const server = await repo.create({
      name: body.name.trim(),
      displayName: body.displayName.trim(),
      transport: body.transport,
      command: body.command?.trim(),
      args: body.args,
      env: body.env,
      url: body.url?.trim(),
      headers: body.headers,
      enabled,
      autoConnect: body.autoConnect,
      userId,
    });

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'created', id: server.id });
    return apiResponse(c, server, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('Failed to create MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id — Get server details
 */
mcpRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    return apiResponse(c, {
      ...server,
      connected: getServiceRegistry().get(Services.McpClient).isConnected(server.name),
    });
  } catch (err) {
    log.error('Failed to get MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * PUT /:id — Update server configuration
 */
mcpRoutes.put('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const body = await c.req.json<{
      name?: string;
      displayName?: string;
      transport?: 'stdio' | 'sse' | 'streamable-http';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      enabled?: boolean;
      autoConnect?: boolean;
    }>();

    const repo = getMcpServersRepo();
    const existing = await repo.getById(id);
    if (!existing || existing.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // If connected, disconnect first (config is changing)
    const mcpService = getServiceRegistry().get(Services.McpClient);
    if (mcpService.isConnected(existing.name)) {
      await mcpService.disconnect(existing.name);
    }

    const updated = await repo.update(id, {
      name: body.name?.trim(),
      displayName: body.displayName?.trim(),
      transport: body.transport,
      command: body.command?.trim(),
      args: body.args,
      env: body.env,
      url: body.url?.trim(),
      headers: body.headers,
      enabled: body.enabled,
      autoConnect: body.autoConnect,
    });

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, updated);
  } catch (err) {
    log.error('Failed to update MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * DELETE /:id — Delete server configuration
 */
mcpRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // Disconnect if connected
    const mcpService = getServiceRegistry().get(Services.McpClient);
    if (mcpService.isConnected(server.name)) {
      await mcpService.disconnect(server.name);
    }

    await repo.delete(id);

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'deleted', id });
    return apiResponse(c, { deleted: true });
  } catch (err) {
    log.error('Failed to delete MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * POST /:id/connect — Connect to server
 */
mcpRoutes.post('/:id/connect', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const tools = await getServiceRegistry().get(Services.McpClient).connect(server);

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { connected: true, tools, toolCount: tools.length });
  } catch (err) {
    log.error('Failed to connect MCP server:', err);
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err, 'Failed to connect') },
      500
    );
  }
});

/**
 * POST /:id/disconnect — Disconnect from server
 */
mcpRoutes.post('/:id/disconnect', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    await getServiceRegistry().get(Services.McpClient).disconnect(server.name);

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { disconnected: true });
  } catch (err) {
    log.error('Failed to disconnect MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * PATCH /:id/tool-settings — Update per-tool settings (e.g. workflowUsable)
 */
mcpRoutes.patch('/:id/tool-settings', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const body = validateBody(mcpToolSettingsSchema, await c.req.json());

    const repo = getMcpServersRepo();
    const server = await repo.getById(id);
    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const existingToolSettings = (server.metadata?.toolSettings ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const toolSettings = { ...existingToolSettings };
    toolSettings[body.toolName] = {
      ...(toolSettings[body.toolName] ?? {}),
      workflowUsable: body.workflowUsable,
    };
    const metadata = { ...server.metadata, toolSettings };
    await repo.update(id, { metadata });

    // Re-register tools if server is connected
    const mcpService = getServiceRegistry().get(Services.McpClient);
    if (mcpService.isConnected(server.name)) {
      await mcpService.refreshToolRegistration?.(server.name);
    }

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { toolName: body.toolName, workflowUsable: body.workflowUsable });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:')) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('Failed to update MCP tool settings:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id/tools — List tools from a connected server
 */
mcpRoutes.get('/:id/tools', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const mcpService = getServiceRegistry().get(Services.McpClient);
    if (!mcpService.isConnected(server.name)) {
      return apiError(
        c,
        { code: ERROR_CODES.BAD_REQUEST, message: 'Server is not connected. Connect first.' },
        400
      );
    }

    const tools = mcpService.getServerTools(server.name);
    return apiResponse(c, { tools, count: tools.length });
  } catch (err) {
    log.error('Failed to list MCP server tools:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

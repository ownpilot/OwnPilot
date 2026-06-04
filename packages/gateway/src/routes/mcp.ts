/**
 * MCP Routes
 *
 * REST endpoints for managing external MCP server connections,
 * plus the MCP protocol endpoint for exposing OwnPilot tools.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { getBaseName, getMcpClientService } from '@ownpilot/core';
import { getMcpServersRepo } from '../db/repositories/mcp-servers.js';
import { handleMcpRequest } from '../services/mcp/server.js';
import { getSharedToolRegistry } from '../services/tool/executor.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, sanitizeId } from './helpers.js';
import {
  validateBody,
  mcpToolCallSchema,
  createMcpServerSchema,
  updateMcpServerSchema,
  mcpToolSettingsSchema,
} from '../middleware/validation.js';
import { PUBLIC_BASE_URL } from '../config/defaults.js';
import { MCP_SERVER_PRESETS, getMcpPreset, resolvePresetInstall } from '../mcp/presets.js';

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

    // Build the server URL — HDR-002: prefer configured PUBLIC_BASE_URL over request headers
    const baseUrl =
      PUBLIC_BASE_URL ||
      `${c.req.header('x-forwarded-proto') ?? (c.req.url.startsWith('https') ? 'https' : 'http')}://${c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost:8080'}`;
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
    const userId = LOCAL_OWNER_ID;
    const context = {
      callId: `mcp-cli-${Date.now()}`,
      userId,
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
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('MCP tool-call failed:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// REST MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * GET /presets — Curated catalog of recommended external MCP servers
 *
 * Returns the static preset list defined in `mcp/presets.ts`. Each entry
 * includes the transport invocation, declared env vars, install hint, and any
 * warning the UI should surface.
 */
mcpRoutes.get('/presets', (c) => {
  return apiResponse(c, { presets: MCP_SERVER_PRESETS, count: MCP_SERVER_PRESETS.length });
});

/**
 * POST /presets/:id/install — Install a preset as a new MCP server row
 *
 * Body (all optional):
 *   { name?, displayName?, extraArgs?, env?, enabled?, autoConnect? }
 *
 * `extraArgs` are appended to the preset's baseline args (filesystem and
 * sqlite presets require this for the path argument). `env` is filtered to the
 * preset's declared vars before being persisted.
 */
mcpRoutes.post('/presets/:id/install', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const presetId = c.req.param('id');
    const preset = getMcpPreset(presetId);
    if (!preset) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Unknown MCP preset: ${presetId}` },
        404
      );
    }

    const rawBody = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      displayName?: unknown;
      extraArgs?: unknown;
      env?: unknown;
      enabled?: unknown;
      autoConnect?: unknown;
    };

    let resolved;
    try {
      resolved = resolvePresetInstall(preset, {
        name: typeof rawBody.name === 'string' ? rawBody.name : undefined,
        displayName: typeof rawBody.displayName === 'string' ? rawBody.displayName : undefined,
        extraArgs: Array.isArray(rawBody.extraArgs)
          ? rawBody.extraArgs.filter((x): x is string => typeof x === 'string')
          : undefined,
        env:
          rawBody.env && typeof rawBody.env === 'object'
            ? Object.fromEntries(
                Object.entries(rawBody.env as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
              )
            : undefined,
        enabled: typeof rawBody.enabled === 'boolean' ? rawBody.enabled : undefined,
        autoConnect: typeof rawBody.autoConnect === 'boolean' ? rawBody.autoConnect : undefined,
      });
    } catch (validationErr) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(validationErr) },
        400
      );
    }

    const repo = getMcpServersRepo();
    const existing = await repo.getByName(resolved.name, userId);
    if (existing) {
      return apiError(
        c,
        {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: `MCP server "${resolved.name}" already exists. Pass a different "name" in the body to install a second copy.`,
        },
        409
      );
    }

    const server = await repo.create({
      name: resolved.name,
      displayName: resolved.displayName,
      transport: resolved.transport,
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      enabled: resolved.enabled,
      autoConnect: resolved.autoConnect,
      userId,
    });

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'created', id: server.id });
    return apiResponse(
      c,
      { server, preset: { id: preset.id, displayName: preset.displayName } },
      201
    );
  } catch (err) {
    log.error('Failed to install MCP preset:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET / — List all configured MCP servers
 */
mcpRoutes.get('/', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = getMcpServersRepo();
    const servers = await repo.getAll(userId);

    // Enrich with live connection status
    const mcpService = getMcpClientService();
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
    const userId = LOCAL_OWNER_ID;
    const rawBody = await c.req.json();
    const body = validateBody(createMcpServerSchema, rawBody);
    // enabled is a pass-through field not in the schema
    const enabled =
      typeof (rawBody as Record<string, unknown>).enabled === 'boolean'
        ? ((rawBody as Record<string, unknown>).enabled as boolean)
        : undefined;

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
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('Failed to create MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id — Get server details
 */
mcpRoutes.get('/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    return apiResponse(c, {
      ...server,
      connected: getMcpClientService().isConnected(server.name),
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
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    // R3: validate body shape + enums (transport is the only field with a
    // fixed enum). Schema also strips `name`/`displayName` from the partial
    // so a client cannot quietly break the routing key.
    const body = validateBody(updateMcpServerSchema, await c.req.json());

    const repo = getMcpServersRepo();
    const existing = await repo.getById(id);
    if (!existing || existing.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // If connected, disconnect first (config is changing)
    const mcpService = getMcpClientService();
    if (mcpService.isConnected(existing.name)) {
      await mcpService.disconnect(existing.name);
    }

    // Note: name/displayName are intentionally NOT updateable (the schema
    // omits them and the routing layer caches by them). The repo.update()
    // call passes only the fields the client is allowed to change.
    const updated = await repo.update(id, {
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
    // R3: surface validation errors as 400 instead of generic 500.
    const msg = getErrorMessage(err);
    const isValidation = msg.startsWith('Validation failed');
    if (isValidation) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: msg }, 400);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

/**
 * DELETE /:id — Delete server configuration
 */
mcpRoutes.delete('/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // Disconnect if connected
    const mcpService = getMcpClientService();
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
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const tools = await getMcpClientService().connect(server);

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
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    await getMcpClientService().disconnect(server.name);

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
    const userId = LOCAL_OWNER_ID;
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
    const mcpService = getMcpClientService();
    if (mcpService.isConnected(server.name)) {
      await mcpService.refreshToolRegistration?.(server.name);
    }

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { toolName: body.toolName, workflowUsable: body.workflowUsable });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    log.error('Failed to update MCP tool settings:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id/tools — List tools from a connected server
 */
mcpRoutes.get('/:id/tools', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server || server.userId !== userId) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const mcpService = getMcpClientService();
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

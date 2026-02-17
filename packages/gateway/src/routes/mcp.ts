/**
 * MCP Routes
 *
 * REST endpoints for managing external MCP server connections,
 * plus the MCP protocol endpoint for exposing OwnPilot tools.
 */

import { Hono } from 'hono';
import { getMcpServersRepo } from '../db/repositories/mcp-servers.js';
import { mcpClientService } from '../services/mcp-client-service.js';
import { handleMcpRequest } from '../services/mcp-server-service.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, sanitizeId } from './helpers.js';

const log = getLog('McpRoutes');

export const mcpRoutes = new Hono();

// =============================================================================
// MCP PROTOCOL ENDPOINT — Streamable HTTP for external MCP clients
// =============================================================================

mcpRoutes.all('/serve', async (c) => {
  const response = await handleMcpRequest(c.req.raw);
  return response;
});

// =============================================================================
// REST MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * GET / — List all configured MCP servers
 */
mcpRoutes.get('/', async (c) => {
  try {
    const repo = getMcpServersRepo();
    const servers = await repo.getAll();

    // Enrich with live connection status
    const enriched = servers.map(s => ({
      ...s,
      connected: mcpClientService.isConnected(s.name),
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
    const body = await c.req.json<{
      name: string;
      displayName: string;
      transport: 'stdio' | 'sse' | 'streamable-http';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      enabled?: boolean;
      autoConnect?: boolean;
    }>();

    if (!body.name?.trim()) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Name is required' }, 400);
    }
    if (!body.displayName?.trim()) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Display name is required' }, 400);
    }
    if (!body.transport) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Transport type is required' }, 400);
    }

    // Validate transport-specific fields
    if (body.transport === 'stdio' && !body.command?.trim()) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Command is required for stdio transport' }, 400);
    }
    if ((body.transport === 'sse' || body.transport === 'streamable-http') && !body.url?.trim()) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'URL is required for network transport' }, 400);
    }

    const repo = getMcpServersRepo();

    // Check uniqueness
    const existing = await repo.getByName(body.name.trim());
    if (existing) {
      return apiError(c, { code: ERROR_CODES.ALREADY_EXISTS, message: `MCP server "${body.name}" already exists` }, 409);
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
      enabled: body.enabled,
      autoConnect: body.autoConnect,
    });

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'created', id: server.id });
    return apiResponse(c, server, 201);
  } catch (err) {
    log.error('Failed to create MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id — Get server details
 */
mcpRoutes.get('/:id', async (c) => {
  try {
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    return apiResponse(c, {
      ...server,
      connected: mcpClientService.isConnected(server.name),
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
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // If connected, disconnect first (config is changing)
    if (mcpClientService.isConnected(existing.name)) {
      await mcpClientService.disconnect(existing.name);
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
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    // Disconnect if connected
    if (mcpClientService.isConnected(server.name)) {
      await mcpClientService.disconnect(server.name);
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
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    const tools = await mcpClientService.connect(server);

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { connected: true, tools, toolCount: tools.length });
  } catch (err) {
    log.error('Failed to connect MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err, 'Failed to connect') }, 500);
  }
});

/**
 * POST /:id/disconnect — Disconnect from server
 */
mcpRoutes.post('/:id/disconnect', async (c) => {
  try {
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    await mcpClientService.disconnect(server.name);

    wsGateway.broadcast('data:changed', { entity: 'mcp_server', action: 'updated', id });
    return apiResponse(c, { disconnected: true });
  } catch (err) {
    log.error('Failed to disconnect MCP server:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * GET /:id/tools — List tools from a connected server
 */
mcpRoutes.get('/:id/tools', async (c) => {
  try {
    const id = sanitizeId(c.req.param('id'));
    const repo = getMcpServersRepo();
    const server = await repo.getById(id);

    if (!server) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'MCP server not found' }, 404);
    }

    if (!mcpClientService.isConnected(server.name)) {
      return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Server is not connected. Connect first.' }, 400);
    }

    const tools = mcpClientService.getServerTools(server.name);
    return apiResponse(c, { tools, count: tools.length });
  } catch (err) {
    log.error('Failed to list MCP server tools:', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

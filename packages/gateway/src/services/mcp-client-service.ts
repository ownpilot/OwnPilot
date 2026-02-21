/**
 * MCP Client Service
 *
 * Manages connections to external MCP servers.
 * Each server connection registers its tools into the shared ToolRegistry
 * with the `mcp.{serverName}.` namespace prefix.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolDefinition, ToolExecutionResult, ToolExecutor } from '@ownpilot/core';
import { getMcpServersRepo, type McpServerRecord } from '../db/repositories/mcp-servers.js';
import { getSharedToolRegistry } from './tool-executor.js';
import { getLog } from './log.js';

const log = getLog('McpClient');

// =============================================================================
// TYPES
// =============================================================================

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpConnection {
  client: Client;
  transport: Transport;
  tools: McpToolInfo[];
  serverName: string;
}

// =============================================================================
// SERVICE
// =============================================================================

class McpClientService {
  private connections = new Map<string, McpConnection>();

  /**
   * Connect to a configured MCP server and register its tools.
   */
  async connect(server: McpServerRecord): Promise<McpToolInfo[]> {
    const repo = getMcpServersRepo();

    // Disconnect if already connected
    if (this.connections.has(server.name)) {
      await this.disconnect(server.name);
    }

    await repo.updateStatus(server.id, 'connecting');

    let transport: ReturnType<typeof this.createTransport> | undefined;
    try {
      // Create transport based on type
      transport = this.createTransport(server);

      // Create MCP client
      const client = new Client(
        { name: 'OwnPilot', version: '1.0.0' },
        { capabilities: {} },
      );

      // Connect
      await client.connect(transport);

      // List available tools
      const result = await client.listTools();
      const mcpTools: McpToolInfo[] = (result.tools ?? []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      // Register tools in ToolRegistry
      this.registerToolsInRegistry(server.name, mcpTools);

      // Store connection
      this.connections.set(server.name, {
        client,
        transport,
        tools: mcpTools,
        serverName: server.name,
      });

      // Update DB status
      await repo.updateStatus(server.id, 'connected', undefined, mcpTools.length);
      log.info(`Connected to MCP server "${server.displayName}" — ${mcpTools.length} tools`);

      return mcpTools;
    } catch (err) {
      // Clean up transport if connection was established but subsequent steps failed
      if (transport) {
        try { await transport.close?.(); } catch { /* ignore cleanup error */ }
      }
      const message = err instanceof Error ? err.message : String(err);
      await repo.updateStatus(server.id, 'error', message);
      log.error(`Failed to connect to MCP server "${server.displayName}":`, err);
      throw err;
    }
  }

  /**
   * Disconnect from a server and unregister its tools.
   */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    // Unregister tools
    const registry = getSharedToolRegistry();
    registry.unregisterMcpTools(serverName);

    // Close transport
    try {
      await conn.transport.close?.();
    } catch (err) {
      log.warn(`Error closing transport for "${serverName}":`, err);
    }

    this.connections.delete(serverName);

    // Update DB status
    const repo = getMcpServersRepo();
    const server = await repo.getByName(serverName);
    if (server) {
      await repo.updateStatus(server.id, 'disconnected', undefined, 0);
    }

    log.info(`Disconnected from MCP server "${serverName}"`);
  }

  /**
   * Disconnect all servers (for graceful shutdown).
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.allSettled(names.map(name => this.disconnect(name)));
  }

  /**
   * Check if a server is connected.
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }

  /**
   * Get tools from a connected server.
   */
  getServerTools(serverName: string): McpToolInfo[] {
    return this.connections.get(serverName)?.tools ?? [];
  }

  /**
   * Call a tool on a connected MCP server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const result = await conn.client.callTool({ name: toolName, arguments: args });

    // Extract text content from MCP result
    if (result && 'content' in result && Array.isArray(result.content)) {
      const texts = result.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text: string }) => c.text);
      return texts.length === 1 ? texts[0] : texts.join('\n');
    }

    return result;
  }

  /**
   * Auto-connect all enabled servers with auto_connect=true.
   */
  async autoConnect(): Promise<void> {
    const repo = getMcpServersRepo();
    const servers = await repo.getEnabled();

    if (servers.length === 0) return;

    log.info(`Auto-connecting ${servers.length} MCP server(s)...`);

    const results = await Promise.allSettled(
      servers.map(server => this.connect(server)),
    );

    let connected = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') connected++;
      else failed++;
    }

    if (connected > 0) log.info(`MCP: ${connected} server(s) connected`);
    if (failed > 0) log.warn(`MCP: ${failed} server(s) failed to connect`);
  }

  /**
   * Get status summary of all servers.
   */
  getStatus(): Map<string, { connected: boolean; toolCount: number }> {
    const status = new Map<string, { connected: boolean; toolCount: number }>();
    for (const [name, conn] of this.connections) {
      status.set(name, { connected: true, toolCount: conn.tools.length });
    }
    return status;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private createTransport(server: McpServerRecord): Transport {
    switch (server.transport) {
      case 'stdio': {
        if (!server.command) {
          throw new Error('stdio transport requires a command');
        }

        return new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: {
            ...process.env as Record<string, string>,
            ...server.env,
          },
          stderr: 'pipe',
        });
      }
      case 'sse': {
        if (!server.url) {
          throw new Error('SSE transport requires a URL');
        }
        return new SSEClientTransport(new URL(server.url), {
          requestInit: {
            headers: server.headers,
          },
        });
      }
      case 'streamable-http': {
        if (!server.url) {
          throw new Error('Streamable HTTP transport requires a URL');
        }
        return new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: {
            headers: server.headers,
          },
        });
      }
      default:
        throw new Error(`Unsupported transport: ${server.transport}`);
    }
  }

  private registerToolsInRegistry(serverName: string, mcpTools: McpToolInfo[]): void {
    const registry = getSharedToolRegistry();
    const toolsMap = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();

    for (const tool of mcpTools) {
      const definition: ToolDefinition = {
        name: tool.name,
        description: tool.description ?? `Tool from MCP server "${serverName}"`,
        parameters: (tool.inputSchema as ToolDefinition['parameters']) ?? {
          type: 'object' as const,
          properties: {},
        },
        category: 'MCP',
        tags: ['mcp', serverName],
      };

      const executor = async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
        try {
          const result = await this.callTool(serverName, tool.name, args);
          return { content: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
        } catch (err) {
          return {
            content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      };

      toolsMap.set(tool.name, { definition, executor });
    }

    registry.registerMcpTools(serverName, toolsMap);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const mcpClientService = new McpClientService();

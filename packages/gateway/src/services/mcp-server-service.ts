/**
 * MCP Server Service
 *
 * Exposes OwnPilot's tool registry as an MCP server via Streamable HTTP.
 * External MCP clients (Claude Desktop, other agents) can connect to
 * discover and call OwnPilot's tools.
 *
 * Uses the low-level Server class (not McpServer) because our tool definitions
 * use raw JSON schemas, not Zod schemas.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getBaseName } from '@ownpilot/core';
import { getSharedToolRegistry } from './tool-executor.js';
import { getLog } from './log.js';

const log = getLog('McpServer');

// =============================================================================
// TRANSPORT SESSION MAP (stateful — one transport per session)
// =============================================================================

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
const sessionLastActivity = new Map<string, number>();

/** Max session age before cleanup (30 minutes) */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Cleanup interval (5 minutes) */
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sid, lastActivity] of sessionLastActivity) {
      if (now - lastActivity > SESSION_MAX_AGE_MS) {
        const transport = sessions.get(sid);
        if (transport) {
          transport.close().catch(() => {});
        }
        sessions.delete(sid);
        sessionLastActivity.delete(sid);
        log.info('Cleaned up stale MCP session', { sessionId: sid });
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

function touchSession(sid: string): void {
  sessionLastActivity.set(sid, Date.now());
}

// =============================================================================
// LAZY MCP SERVER (created once, reused)
// =============================================================================

let mcpServer: Server | null = null;

function getOrCreateMcpServer(): Server {
  if (mcpServer) return mcpServer;

  mcpServer = new Server({ name: 'OwnPilot', version: '1.0.0' }, { capabilities: { tools: {} } });

  const registry = getSharedToolRegistry();

  // tools/list — return raw JSON schemas from our ToolRegistry
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = registry.getAllTools();
    return {
      tools: allTools.map((tool) => ({
        name: getBaseName(tool.definition.name),
        description: tool.definition.description,
        inputSchema: {
          type: 'object' as const,
          properties: (tool.definition.parameters.properties ?? {}) as Record<string, unknown>,
          ...(tool.definition.parameters.required?.length && {
            required: [...tool.definition.parameters.required],
          }),
        },
      })),
    };
  });

  // tools/call — execute tool via ToolRegistry
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Resolve base name to qualified name
    const allTools = registry.getAllTools();
    const match = allTools.find((t) => getBaseName(t.definition.name) === name);

    if (!match) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await registry.execute(
        match.definition.name,
        (args ?? {}) as Record<string, unknown>,
        { userId: 'default', conversationId: 'mcp-session' }
      );

      const text =
        typeof result === 'string'
          ? result
          : result && typeof result === 'object' && 'content' in result
            ? String((result as { content: unknown }).content)
            : JSON.stringify(result, null, 2);

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  log.info('MCP Server initialized');
  return mcpServer;
}

// =============================================================================
// REQUEST HANDLER (called from Hono route)
// =============================================================================

/**
 * Handle an incoming MCP request (POST, GET, or DELETE).
 * Called from the Hono route handler.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = getOrCreateMcpServer();

  // Extract session ID from header
  const sessionId = request.headers.get('mcp-session-id');

  if (request.method === 'GET' || request.method === 'DELETE') {
    // GET = SSE stream, DELETE = terminate session
    if (sessionId && sessions.has(sessionId)) {
      touchSession(sessionId);
      const transport = sessions.get(sessionId)!;
      return transport.handleRequest(request);
    }
    // No session — return 400 for GET, 404 for DELETE
    if (request.method === 'DELETE') {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // GET without valid session
    return new Response(JSON.stringify({ error: 'Invalid or missing session' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // For POST requests — create transport per session (or stateless)
  if (request.method === 'POST') {
    // Check if this is an existing session
    if (sessionId && sessions.has(sessionId)) {
      touchSession(sessionId);
      const transport = sessions.get(sessionId)!;
      return transport.handleRequest(request);
    }

    // New session — create transport
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
        touchSession(sid);
        startSessionCleanup();
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        sessionLastActivity.delete(sid);
      },
    });

    // Connect server to this transport
    await server.connect(transport);

    return transport.handleRequest(request);
  }

  // Unsupported method
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'GET, POST, DELETE' },
  });
}

/**
 * Invalidate the cached MCP server (e.g., when tools change).
 */
export function invalidateMcpServer(): void {
  mcpServer = null;
  // Close all sessions
  for (const [sid, transport] of sessions) {
    transport.close().catch(() => {});
    sessions.delete(sid);
  }
  sessionLastActivity.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * MCP Server Service
 *
 * Exposes OwnPilot's tool registry as an MCP server via Streamable HTTP.
 * External MCP clients (Claude Desktop, other agents) can connect to
 * discover and call OwnPilot's tools.
 *
 * Uses the low-level Server class (not McpServer) because our tool definitions
 * use raw JSON schemas, not Zod schemas.
 *
 * Each session gets its own Server instance (MCP SDK requirement — a Server
 * can only be connected to one transport at a time).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getBaseName } from '@ownpilot/core';
import { getSharedToolRegistry } from './tool-executor.js';
import { getLog } from './log.js';
import { emitMcpToolEvent } from '../mcp/mcp-events.js';

const log = getLog('McpServer');

// =============================================================================
// TRANSPORT SESSION MAP (stateful — one transport per session)
// =============================================================================

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  /** Correlation ID linking this MCP session to a chat SSE stream */
  correlationId?: string;
}

const sessions = new Map<string, McpSession>();
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
        const session = sessions.get(sid);
        if (session) {
          session.server.close().catch(() => {});
          session.transport.close().catch(() => {});
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
// MCP SERVER FACTORY (one per session)
// =============================================================================

function createMcpServer(correlationId?: string): Server {
  const server = new Server({ name: 'OwnPilot', version: '1.0.0' }, { capabilities: { tools: {} } });

  const registry = getSharedToolRegistry();

  // tools/list — return raw JSON schemas from our ToolRegistry
  server.setRequestHandler(ListToolsRequestSchema, async () => {
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

  // tools/call — execute tool via ToolRegistry, emit real-time events
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

    // Emit tool_start event for real-time tracking
    if (correlationId) {
      emitMcpToolEvent({
        type: 'tool_start',
        correlationId,
        toolName: name,
        arguments: (args ?? {}) as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });
    }

    const startTime = performance.now();

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

      // Emit tool_end event
      if (correlationId) {
        emitMcpToolEvent({
          type: 'tool_end',
          correlationId,
          toolName: name,
          result: {
            success: true,
            preview: text.substring(0, 500),
            durationMs: Math.round(performance.now() - startTime),
          },
          timestamp: new Date().toISOString(),
        });
      }

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const errorText = `Error: ${err instanceof Error ? err.message : String(err)}`;

      // Emit tool_end event with error
      if (correlationId) {
        emitMcpToolEvent({
          type: 'tool_end',
          correlationId,
          toolName: name,
          result: {
            success: false,
            preview: errorText.substring(0, 500),
            durationMs: Math.round(performance.now() - startTime),
          },
          timestamp: new Date().toISOString(),
        });
      }

      return {
        content: [{ type: 'text' as const, text: errorText }],
        isError: true,
      };
    }
  });

  return server;
}

// =============================================================================
// REQUEST HANDLER (called from Hono route)
// =============================================================================

/**
 * Handle an incoming MCP request (POST, GET, or DELETE).
 * Called from the Hono route handler.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  // Extract session ID from header
  const sessionId = request.headers.get('mcp-session-id');

  // Extract correlation ID from URL query parameter (links MCP session to chat SSE stream)
  const url = new URL(request.url, 'http://localhost');
  const correlationId = url.searchParams.get('correlationId') ?? undefined;

  if (request.method === 'GET' || request.method === 'DELETE') {
    // GET = SSE stream, DELETE = terminate session
    if (sessionId && sessions.has(sessionId)) {
      touchSession(sessionId);
      const session = sessions.get(sessionId)!;
      return session.transport.handleRequest(request);
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
      const session = sessions.get(sessionId)!;
      return session.transport.handleRequest(request);
    }

    // New session — create transport + server pair
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, correlationId });
        touchSession(sid);
        startSessionCleanup();
        log.info('MCP session initialized', { sessionId: sid, correlationId });
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        sessionLastActivity.delete(sid);
      },
    });

    // Each session gets its own Server instance (MCP SDK requirement)
    // Pass correlationId so tool calls emit events for the linked chat stream
    const server = createMcpServer(correlationId);
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
  // Close all sessions and their servers
  for (const [sid, session] of sessions) {
    session.server.close().catch(() => {});
    session.transport.close().catch(() => {});
    sessions.delete(sid);
  }
  sessionLastActivity.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

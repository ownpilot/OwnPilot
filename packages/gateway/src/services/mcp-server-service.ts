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
import { randomUUID } from 'node:crypto';
import {
  searchToolsDefinition,
  getToolHelpDefinition,
  useToolDefinition,
  batchUseToolDefinition,
  debugLog,
} from '@ownpilot/core';
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
          session.server
            .close()
            .catch((e) => log.debug('MCP session server close error', { error: String(e) }));
          session.transport
            .close()
            .catch((e) => log.debug('MCP session transport close error', { error: String(e) }));
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

/**
 * Convert a ToolDefinition's parameter schema to MCP inputSchema format.
 */
function toInputSchema(def: {
  parameters: { properties?: Record<string, unknown>; required?: readonly string[] };
}) {
  return {
    type: 'object' as const,
    properties: (def.parameters.properties ?? {}) as Record<string, unknown>,
    ...(def.parameters.required?.length && { required: [...def.parameters.required] }),
  };
}

/**
 * The 4 meta-tool definitions exposed via MCP.
 * LLM discovers tools via search_tools, gets docs via get_tool_help,
 * executes via use_tool / batch_use_tool. This keeps the MCP tool list
 * small (4 tools) instead of flooding the LLM context with 250+ schemas.
 */
const META_TOOLS = [
  {
    name: searchToolsDefinition.name,
    description: searchToolsDefinition.description,
    inputSchema: toInputSchema(searchToolsDefinition),
  },
  {
    name: getToolHelpDefinition.name,
    description: getToolHelpDefinition.description,
    inputSchema: toInputSchema(getToolHelpDefinition),
  },
  {
    name: useToolDefinition.name,
    description: useToolDefinition.description,
    inputSchema: toInputSchema(useToolDefinition),
  },
  {
    name: batchUseToolDefinition.name,
    description: batchUseToolDefinition.description,
    inputSchema: toInputSchema(batchUseToolDefinition),
  },
];

function recordMcpToolDebug(event: {
  phase: 'start' | 'end';
  toolName: string;
  correlationId?: string;
  arguments?: Record<string, unknown>;
  success?: boolean;
  preview?: string;
  durationMs?: number;
}): void {
  if (event.phase === 'start') {
    debugLog.add({
      type: 'tool_call',
      provider: 'mcp',
      model: 'ownpilot',
      data: {
        source: 'mcp',
        toolName: event.toolName,
        correlationId: event.correlationId,
        arguments: event.arguments,
      },
    });
    log.debug(`MCP tool start: ${event.toolName}`, {
      correlationId: event.correlationId,
      arguments: event.arguments,
    });
    return;
  }

  debugLog.add({
    type: 'tool_result',
    provider: 'mcp',
    model: 'ownpilot',
    duration: event.durationMs,
    data: {
      source: 'mcp',
      toolName: event.toolName,
      correlationId: event.correlationId,
      success: event.success,
      result: event.preview,
      durationMs: event.durationMs,
    },
  });
  log.debug(`MCP tool end: ${event.toolName}`, {
    correlationId: event.correlationId,
    success: event.success,
    durationMs: event.durationMs,
    preview: event.preview,
  });
}

function createMcpServer(correlationId?: string): Server {
  const server = new Server(
    { name: 'OwnPilot', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // tools/list — expose only the 4 meta-tools (not all 250+ tools)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: META_TOOLS };
  });

  // tools/call — route to the shared meta-tool executors
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    // Emit tool_start event for real-time tracking
    if (correlationId) {
      emitMcpToolEvent({
        type: 'tool_start',
        correlationId,
        toolName: name,
        arguments: toolArgs,
        timestamp: new Date().toISOString(),
      });
    }
    recordMcpToolDebug({
      phase: 'start',
      toolName: name,
      correlationId,
      arguments: toolArgs,
    });

    const startTime = performance.now();

    try {
      // Lazy import to avoid circular deps
      const { executeSearchTools, executeGetToolHelp, executeUseTool, executeBatchUseTool } =
        await import('../tools/agent-tool-registry.js');

      const registry = getSharedToolRegistry();
      const context = {
        callId: randomUUID(),
        userId: 'default',
        conversationId: 'mcp-session',
      };

      let result: { content: unknown; isError?: boolean };

      switch (name) {
        case 'search_tools':
          result = await executeSearchTools(registry, toolArgs);
          break;
        case 'get_tool_help':
          result = await executeGetToolHelp(registry, toolArgs);
          break;
        case 'use_tool':
          result = await executeUseTool(registry, toolArgs, context);
          break;
        case 'batch_use_tool':
          result = await executeBatchUseTool(registry, toolArgs, context);
          break;
        default:
          result = {
            content: `Unknown tool: ${name}. Available tools: search_tools, get_tool_help, use_tool, batch_use_tool.`,
            isError: true,
          };
      }

      const text =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content, null, 2);

      // Emit tool_end event
      if (correlationId) {
        emitMcpToolEvent({
          type: 'tool_end',
          correlationId,
          toolName: name,
          result: {
            success: !result.isError,
            preview: text.substring(0, 500),
            durationMs: Math.round(performance.now() - startTime),
          },
          timestamp: new Date().toISOString(),
        });
      }
      recordMcpToolDebug({
        phase: 'end',
        toolName: name,
        correlationId,
        success: !result.isError,
        preview: text.substring(0, 500),
        durationMs: Math.round(performance.now() - startTime),
      });

      return {
        content: [{ type: 'text' as const, text }],
        ...(result.isError && { isError: true }),
      };
    } catch (err) {
      const errorText = `Error: ${err instanceof Error ? err.message : String(err)}`;

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
      recordMcpToolDebug({
        phase: 'end',
        toolName: name,
        correlationId,
        success: false,
        preview: errorText.substring(0, 500),
        durationMs: Math.round(performance.now() - startTime),
      });

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
    session.server
      .close()
      .catch((e) => log.debug('MCP server close error on invalidate', { error: String(e) }));
    session.transport
      .close()
      .catch((e) => log.debug('MCP transport close error on invalidate', { error: String(e) }));
    sessions.delete(sid);
  }
  sessionLastActivity.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

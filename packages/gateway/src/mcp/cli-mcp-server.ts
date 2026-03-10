#!/usr/bin/env node
/**
 * OwnPilot CLI MCP Server
 *
 * Standalone stdio MCP server that exposes OwnPilot's 4 meta-tools
 * to CLI tools (Claude Code, Gemini CLI, Codex CLI).
 *
 * The CLIs spawn this as a child process via MCP stdio transport.
 * It proxies tool calls to OwnPilot's HTTP API.
 *
 * Usage:
 *   OWNPILOT_URL=http://localhost:8080 node cli-mcp-server.js
 *
 * Environment:
 *   OWNPILOT_URL   — OwnPilot gateway base URL (default: http://localhost:8080)
 *   OWNPILOT_KEY   — Optional API key for authentication
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// =============================================================================
// Config
// =============================================================================

const OWNPILOT_URL = process.env.OWNPILOT_URL || 'http://localhost:8080';
const OWNPILOT_KEY = process.env.OWNPILOT_KEY || '';

// =============================================================================
// Tool Definitions (matching OwnPilot's 4 meta-tools)
// =============================================================================

const TOOLS = [
  {
    name: 'search_tools',
    description:
      'Search OwnPilot tools by keyword or intent. AND matching: "email send" finds send_email. Use "all" to list every tool. Returns parameter docs by default.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search keywords (e.g. "email", "send email", "task add"). Multiple words use AND logic. Use "all" to list everything.',
        },
        category: {
          type: 'string',
          description: 'Optional: filter by category name',
        },
        include_params: {
          type: 'boolean',
          description: 'Include full parameter docs. Default: true.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_tool_help',
    description:
      'Get parameter docs for one or more OwnPilot tools by name. Accepts tool_name (single) or tool_names (array).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description: 'Qualified tool name (e.g., "core.add_task").',
        },
        tool_names: {
          type: 'array',
          description: 'Array of qualified tool names.',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'use_tool',
    description:
      'Execute any OwnPilot tool by its qualified name (namespace.tool_name). Core tools: "core.*", custom: "custom.*". Use search_tools first to discover available tools and their parameters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description:
            'Qualified tool name with namespace prefix (e.g., "core.add_task", "core.search_web").',
        },
        arguments: {
          type: 'object',
          description: 'Tool arguments. Must match the tool parameter schema.',
        },
      },
      required: ['tool_name', 'arguments'],
    },
  },
  {
    name: 'batch_use_tool',
    description:
      'Execute multiple OwnPilot tools in parallel. Faster than sequential use_tool calls. Max 20 per batch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        calls: {
          type: 'array',
          description: 'Array of { tool_name, arguments } objects.',
          items: {
            type: 'object',
            properties: {
              tool_name: { type: 'string' },
              arguments: { type: 'object' },
            },
            required: ['tool_name', 'arguments'],
          },
        },
      },
      required: ['calls'],
    },
  },
];

// =============================================================================
// HTTP Proxy to OwnPilot API
// =============================================================================

async function callOwnPilotTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
  const url = `${OWNPILOT_URL}/api/v1/mcp/tool-call`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (OWNPILOT_KEY) {
    headers['Authorization'] = `Bearer ${OWNPILOT_KEY}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool_name: toolName, arguments: args }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        content: `OwnPilot API error (${response.status}): ${text}`,
        isError: true,
      };
    }

    const data = (await response.json()) as {
      ok: boolean;
      data?: { content: string; isError?: boolean };
      error?: { message: string };
    };

    if (data.ok && data.data) {
      return {
        content: data.data.content,
        isError: data.data.isError ?? false,
      };
    }

    return {
      content: data.error?.message ?? 'Unknown error from OwnPilot',
      isError: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: `Failed to connect to OwnPilot at ${OWNPILOT_URL}: ${msg}`,
      isError: true,
    };
  }
}

// =============================================================================
// MCP Server
// =============================================================================

function createServer(): Server {
  const server = new Server(
    {
      name: 'ownpilot',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    const result = await callOwnPilotTool(name, toolArgs);

    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  });

  return server;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

// Only auto-start when run directly (not during tests)
if (!process.env.VITEST) {
  main().catch((error) => {
    process.stderr.write(`OwnPilot MCP server error: ${error}\n`);
    process.exit(1);
  });
}

export { createServer, callOwnPilotTool, TOOLS, main };

/**
 * CLI Workspace Manager
 *
 * Creates and manages a workspace directory for CLI chat sessions.
 * Each workspace contains:
 * - .mcp.json — MCP server auto-discovery config
 * - CLAUDE.md — Context file for Claude Code
 * - GEMINI.md — Context file for Gemini CLI
 * - AGENTS.md — Generic OwnPilot tool guide (referenced by CLI-specific files)
 *
 * The CLI runs inside this workspace, picks up MCP config automatically,
 * and reads the context file as project instructions.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceConfig {
  /** OwnPilot gateway URL (default: http://localhost:8080) */
  gatewayUrl?: string;
  /** Base directory for workspaces (default: ~/.ownpilot/workspace) */
  baseDir?: string;
}

export interface WorkspaceInfo {
  /** Workspace directory path */
  dir: string;
  /** MCP config file path */
  mcpConfigPath: string;
}

// =============================================================================
// Context Files
// =============================================================================

function buildMcpConfig(gatewayUrl: string): string {
  const mcpUrl = `${gatewayUrl}/api/v1/mcp/serve`;
  return JSON.stringify(
    {
      mcpServers: {
        ownpilot: {
          // Claude Code format
          type: 'streamable-http',
          url: mcpUrl,
          // Gemini CLI format (uses httpUrl instead of url+type)
          httpUrl: mcpUrl,
        },
      },
    },
    null,
    2
  );
}

function buildAgentsMd(): string {
  return `# OwnPilot Tools

You are connected to **OwnPilot**, a personal AI assistant platform with 150+ tools.
Access them through 4 MCP tools provided by the \`ownpilot\` MCP server.

## How to Use Tools

### Step 1: Search
\`\`\`
search_tools(query: "keyword")
\`\`\`
Find tools by keyword. Use \`"all"\` to list everything. Returns tool names with parameter docs.

### Step 2: Get Help (optional)
\`\`\`
get_tool_help(tool_name: "core.add_task")
\`\`\`
Get detailed parameter documentation for a specific tool.

### Step 3: Execute
\`\`\`
use_tool(tool_name: "core.add_task", arguments: { title: "Buy milk", priority: "high" })
\`\`\`
Execute a single tool. Or execute multiple in parallel:
\`\`\`
batch_use_tool(calls: [
  { tool_name: "core.list_tasks", arguments: { status: "pending" } },
  { tool_name: "core.search_memory", arguments: { query: "meeting notes" } }
])
\`\`\`

## Tool Namespaces
- \`core.*\` — Built-in tools (tasks, memory, email, web, goals, etc.)
- \`custom.*\` — User-created tools
- \`plugin.*\` — Plugin-provided tools
- \`skill.*\` — Skill-provided tools

## Common Tools
| Tool | Description |
|------|-------------|
| \`core.add_task\` | Create a task |
| \`core.list_tasks\` | List tasks with filters |
| \`core.add_memory\` | Save to long-term memory |
| \`core.search_memory\` | Search memory |
| \`core.search_web\` | Web search |
| \`core.web_fetch\` | Fetch URL content |
| \`core.send_email\` | Send email |
| \`core.manage_goal\` | Create/update goals |

## Important
- **Always search first** — don't guess tool names
- Tool names include namespace prefix: \`core.add_task\`, not just \`add_task\`
- If a tool call fails, read the error — it includes correct parameter docs
`;
}

function buildClaudeMd(): string {
  return `# OwnPilot Workspace

This workspace is managed by OwnPilot. You have access to OwnPilot's tool system
via the \`ownpilot\` MCP server (configured in \`.mcp.json\`).

Read AGENTS.md for the full tool usage guide.

Key points:
- Use \`search_tools\` to discover tools, then \`use_tool\` to execute them
- Tool names have namespace prefixes: \`core.*\`, \`custom.*\`, \`plugin.*\`
- Use \`batch_use_tool\` for parallel execution of multiple tools
- Always search before using — don't guess tool names
`;
}

function buildGeminiMd(): string {
  return `# OwnPilot Workspace

This workspace is managed by OwnPilot. You have access to OwnPilot's tool system
via the \`ownpilot\` MCP server.

Read AGENTS.md for the full tool usage guide.

Key points:
- Use \`search_tools\` to discover tools, then \`use_tool\` to execute them
- Tool names have namespace prefixes: \`core.*\`, \`custom.*\`, \`plugin.*\`
- Use \`batch_use_tool\` for parallel execution of multiple tools
- Always search before using — don't guess tool names
`;
}

// =============================================================================
// Workspace Management
// =============================================================================

function getDefaultBaseDir(): string {
  return join(homedir(), '.ownpilot', 'workspace');
}

/**
 * Ensure the CLI workspace exists with up-to-date config files.
 * Creates the workspace if it doesn't exist, or updates files if they do.
 */
export async function ensureWorkspace(config: WorkspaceConfig = {}): Promise<WorkspaceInfo> {
  const gatewayUrl = config.gatewayUrl || 'http://localhost:8080';
  const dir = config.baseDir || getDefaultBaseDir();

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Write config files (always overwrite to keep in sync)
  await Promise.all([
    writeFile(join(dir, '.mcp.json'), buildMcpConfig(gatewayUrl), 'utf-8'),
    writeFile(join(dir, 'AGENTS.md'), buildAgentsMd(), 'utf-8'),
    writeFile(join(dir, 'CLAUDE.md'), buildClaudeMd(), 'utf-8'),
    writeFile(join(dir, 'GEMINI.md'), buildGeminiMd(), 'utf-8'),
  ]);

  return {
    dir,
    mcpConfigPath: join(dir, '.mcp.json'),
  };
}

/**
 * Create a temporary workspace for a single CLI session.
 * Useful for isolated sessions that don't persist.
 */
export async function createTempWorkspace(
  config: WorkspaceConfig = {}
): Promise<WorkspaceInfo & { cleanup: () => Promise<void> }> {
  const sessionId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), 'ownpilot', sessionId);

  const info = await ensureWorkspace({ ...config, baseDir: dir });

  return {
    ...info,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    },
  };
}

/**
 * Get the workspace directory path without creating it.
 */
export function getWorkspaceDir(config: WorkspaceConfig = {}): string {
  return config.baseDir || getDefaultBaseDir();
}

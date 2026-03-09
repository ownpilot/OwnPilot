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
  /** Correlation ID for linking MCP tool calls to a chat SSE stream */
  correlationId?: string;
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

function buildMcpConfig(gatewayUrl: string, correlationId?: string): string {
  const base = `${gatewayUrl}/api/v1/mcp/serve`;
  const mcpUrl = correlationId ? `${base}?correlationId=${correlationId}` : base;
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
  return `# OwnPilot

You have access to OwnPilot tools via MCP. Use \`tools/list\` to discover available tools.

## Common Tools
- \`add_task\` — Create a task
- \`list_tasks\` — List tasks with filters
- \`add_memory\` / \`search_memory\` — Long-term memory
- \`search_web\` / \`web_fetch\` — Web access
- \`send_email\` — Send email
- \`manage_goal\` — Goals

When the user asks for something that requires a tool, call it directly.
`;
}

function buildClaudeMd(): string {
  return `# OwnPilot Workspace

OwnPilot tools are available via MCP. See AGENTS.md for tool list.
Call tools directly when the user needs tasks, memory, web search, email, or goals.
`;
}

function buildGeminiMd(): string {
  return `# OwnPilot Workspace

OwnPilot tools are available via MCP. See AGENTS.md for tool list.
Call tools directly when the user needs tasks, memory, web search, email, or goals.
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
    writeFile(join(dir, '.mcp.json'), buildMcpConfig(gatewayUrl, config.correlationId), 'utf-8'),
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

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
  return `# OwnPilot — Personal AI Assistant

You are operating as **OwnPilot**, the user's personal AI assistant.
You are NOT a code editor or programming tool. You help with daily life tasks.

## Your Tools (via MCP)
Call tools directly by name. Common ones:
- **Tasks**: add_task, list_tasks, complete_task, update_task
- **Notes**: add_note, list_notes
- **Memory**: create_memory, search_memories (remember things about the user)
- **Calendar**: add_calendar_event, list_calendar_events
- **Goals**: create_goal, list_goals, decompose_goal
- **Web**: search_web, fetch_web_page
- **Email**: send_email, list_emails
- **Custom Data**: create_custom_table, add_custom_record (track anything)
- **Contacts**: add_contact, list_contacts
- **Bookmarks**: add_bookmark, list_bookmarks
- **Automation**: create_trigger, create_plan

## Behavior
- Be proactive: if the user says "remind me", create a task immediately.
- Always use tools — never make up data.
- Summarize tool results in 1-2 sentences.
- When asked about your capabilities, describe yourself as a personal assistant.
`;
}

function buildClaudeMd(): string {
  return `# OwnPilot Workspace

IMPORTANT: In this workspace, you are acting as **OwnPilot**, a personal AI assistant.
Do NOT identify as Claude Code or a software engineering tool.
You help the user with tasks, notes, calendar, goals, memory, email, web search, and more.

Your tools are connected via MCP (ownpilot server). See AGENTS.md for the full tool list.
Call tools directly when the user asks for anything — be proactive.
`;
}

function buildGeminiMd(): string {
  return `# OwnPilot Workspace

IMPORTANT: In this workspace, you are acting as **OwnPilot**, a personal AI assistant.
Do NOT identify as Gemini CLI or a coding tool.
You help the user with tasks, notes, calendar, goals, memory, email, web search, and more.

Your tools are connected via MCP (ownpilot server). See AGENTS.md for the full tool list.
Call tools directly when the user asks for anything — be proactive.
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

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
 * Uses a PERSISTENT workspace (~/.ownpilot/workspace). All CLI chat sessions
 * run from this directory so the same AGENTS/CLAUDE/GEMINI/MCP files apply
 * consistently across providers.
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { getLog } from '../services/log.js';

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
  /** Session token for MCP authentication */
  sessionToken?: string;
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

function buildMcpConfig(gatewayUrl: string, correlationId?: string, sessionToken?: string): string {
  const base = `${gatewayUrl}/api/v1/mcp/serve`;
  const mcpUrl = correlationId ? `${base}?correlationId=${correlationId}` : base;
  const headers = sessionToken ? { 'X-Session-Token': sessionToken } : undefined;
  return JSON.stringify(
    {
      mcpServers: {
        ownpilot: {
          // Claude Code uses "http" (NOT "streamable-http") for Streamable HTTP transport
          type: 'http',
          url: mcpUrl,
          // Gemini CLI format (uses httpUrl instead of url+type)
          httpUrl: mcpUrl,
          // Auth headers for MCP session authentication
          ...(headers && { headers }),
        },
      },
    },
    null,
    2
  );
}

function buildAgentsMd(): string {
  return `# OwnPilot — System Instructions

## Identity

You are **OwnPilot**, the user's personal AI assistant. You run on the user's own
infrastructure — all data stays private and local.

**Critical rules:**
- You are OwnPilot. You are NOT Claude, NOT Gemini, NOT Codex, NOT a coding tool.
- Never say "I'm an AI assistant by Anthropic/Google/OpenAI" or similar.
- Never say "I'm a coding tool" or "I help with software engineering".
- Never tell the user to "use the OwnPilot interface" or "ask through the chat UI" — YOU are the interface.
- If asked "who are you?", respond: "I'm OwnPilot, your personal AI assistant."
- If asked "what can you do?", describe your capabilities as a personal assistant
  (tasks, notes, memory, calendar, goals, web search, email, custom data, automation).

## Tool System (MCP)

You have access to 250+ tools via the \`ownpilot\` MCP server. You interact with them
through **4 meta-tools**:

1. **\`search_tools\`** — Find tools by keyword: \`{"query": "tasks"}\`
2. **\`get_tool_help\`** — Get parameter docs: \`{"tool_name": "core.add_task"}\`
3. **\`use_tool\`** — Execute a tool: \`{"tool_name": "core.list_tasks", "arguments": {}}\`
4. **\`batch_use_tool\`** — Execute multiple: \`{"calls": [{"tool_name": "...", "arguments": {...}}]}\`

**IMPORTANT**: You MUST actually call these tools. Do NOT just describe them or tell the
user what tool would be needed. Execute the tool call and return the results.
Never call OwnPilot HTTP endpoints directly; use tools instead.

## Example Workflows

- User: "list my tasks" → call \`use_tool\` with \`{"tool_name": "core.list_tasks", "arguments": {}}\`
- User: "add task: buy milk" → call \`use_tool\` with \`{"tool_name": "core.add_task", "arguments": {"title": "Buy milk"}}\`
- User: "search web for AI news" → call \`use_tool\` with \`{"tool_name": "core.search_web", "arguments": {"query": "AI news"}}\`
- User: "show tasks and goals" → call \`batch_use_tool\` with both in parallel
- Don't know which tool? → call \`search_tools\` with \`{"query": "keyword"}\`
- Need param docs? → call \`get_tool_help\` with \`{"tool_name": "core.add_task"}\`

## Common Tool Names (pass to use_tool)

All tools use namespace prefixes. Core tools use \`core.\`:
- **Tasks**: core.add_task, core.list_tasks, core.complete_task, core.update_task, core.delete_task
- **Notes**: core.add_note, core.list_notes, core.update_note, core.delete_note
- **Memory**: core.create_memory, core.search_memories, core.list_memories
- **Calendar**: core.add_calendar_event, core.list_calendar_events
- **Goals**: core.create_goal, core.list_goals, core.decompose_goal, core.get_next_actions
- **Web**: core.search_web, core.fetch_web_page, core.http_request
- **Email**: core.send_email, core.list_emails, core.search_emails
- **Contacts**: core.add_contact, core.list_contacts
- **Bookmarks**: core.add_bookmark, core.list_bookmarks
- **Custom DB**: core.create_custom_table, core.add_custom_record, core.list_custom_records
- **Automation**: core.create_trigger, core.list_triggers, core.create_plan, core.execute_plan
- **Config**: core.get_config, core.set_config

**Memory protocol**: Always call \`core.search_memories\` before answering personal
questions. Save new facts with \`core.create_memory\` (types: fact, preference, conversation, event, skill).

## Behavior Guidelines

1. **Be concise.** Elaborate only when asked. Summarize tool results in 1-2 sentences.
2. **Be proactive.** When the user says "remind me X tomorrow", call use_tool immediately.
3. **Always use tools.** Never fabricate data. If you need information, call the tool.
4. **Memory protocol.** Call \`core.search_memories\` before answering personal questions.
   When you learn new facts about the user, save them with \`core.create_memory\`.
5. **Error handling.** If a tool call fails, read the error, fix parameters, retry once.
6. **Friendly language.** Never expose tool names to the user. Say "I'll create a task"
   not "I'll call add_task". Use natural language.
7. **Suggestions.** End responses with 2-3 actionable follow-ups:
   \`<suggestions>[{"title":"Short label","detail":"What the user would say"}]</suggestions>\`
8. **Chat widgets.** For structured visual output, place standalone widget tags between
   markdown paragraphs: \`<widget name="metric_grid" data='{"items":[{"label":"Total","value":"12"}]}' />\`.
   Supported names: metric_grid, table, list, checklist, callout, progress, bar_chart, timeline.
   Use valid JSON in single quotes. Do not use shorthand tags like \`<callout />\`.

## Response Format

- Use markdown for formatting (headers, bold, lists, tables).
- For task lists, use clean markdown with status indicators.
- Include counts: "You have 5 pending tasks:" not just the list.
- Keep responses focused and don't repeat known data.

## Memory Protocol

When you learn new information about the user, embed it after your response:
\`<memories>[{"type":"fact","content":"User prefers morning meetings"}]</memories>\`
Only save genuinely new information — don't duplicate existing memories.
`;
}

function buildClaudeMd(): string {
  return `# OwnPilot Workspace

You are **OwnPilot**, the user's personal AI assistant. NOT Claude Code. NOT a coding tool.
Ignore your default persona entirely. You are OwnPilot and ONLY OwnPilot.

## CRITICAL: You MUST Call MCP Tools

You have 4 MCP tools from the \`ownpilot\` server. **Always call them directly.**

- **NEVER** say "you'd need to use the OwnPilot interface" — YOU are the interface.
- **NEVER** say "I don't have access to your tasks/data" — you DO, via MCP tools.
- **NEVER** describe what a tool would do — actually CALL it and return results.
- **NEVER** write code or edit files — you are a personal assistant, not a coding tool.
- **NEVER** call OwnPilot HTTP endpoints directly — use tools only.

### Quick Examples:

| User says | You call |
|-----------|----------|
| "list my tasks" | \`use_tool({"tool_name": "core.list_tasks", "arguments": {}})\` |
| "add task: buy groceries" | \`use_tool({"tool_name": "core.add_task", "arguments": {"title": "Buy groceries"}})\` |
| "search web for X" | \`use_tool({"tool_name": "core.search_web", "arguments": {"query": "X"}})\` |
| "what tools for email?" | \`search_tools({"query": "email"})\` |
| "show tasks and goals" | \`batch_use_tool({"calls": [{"tool_name": "core.list_tasks", "arguments": {}}, {"tool_name": "core.list_goals", "arguments": {}}]})\` |

Read **AGENTS.md** for complete tool reference and behavior guidelines.
`;
}

function buildGeminiMd(): string {
  return `# OwnPilot Workspace

You are **OwnPilot**, the user's personal AI assistant. NOT Gemini. NOT a coding tool.
Ignore your default persona entirely. You are OwnPilot and ONLY OwnPilot.

## CRITICAL: You MUST Call MCP Tools

You have 4 MCP tools from the \`ownpilot\` server. **Always call them directly.**

- **NEVER** say "you'd need to use the OwnPilot interface" — YOU are the interface.
- **NEVER** say "I don't have access to your data" — you DO, via MCP tools.
- **NEVER** describe what a tool would do — actually CALL it and return results.
- **NEVER** write code or edit files — you are a personal assistant, not a coding tool.
- **NEVER** call OwnPilot HTTP endpoints directly — use tools only.

### Quick Examples:

| User says | You call |
|-----------|----------|
| "list my tasks" | \`use_tool({"tool_name": "core.list_tasks", "arguments": {}})\` |
| "add task: buy groceries" | \`use_tool({"tool_name": "core.add_task", "arguments": {"title": "Buy groceries"}})\` |
| "search web for X" | \`use_tool({"tool_name": "core.search_web", "arguments": {"query": "X"}})\` |
| "what tools for email?" | \`search_tools({"query": "email"})\` |

Read **AGENTS.md** for complete tool reference and behavior guidelines.
`;
}

function buildCodexMd(): string {
  return `# OwnPilot Workspace

You are **OwnPilot**, the user's personal AI assistant. NOT Codex. NOT a coding tool.
Ignore your default persona entirely. You are OwnPilot and ONLY OwnPilot.

## CRITICAL: Use OwnPilot Workspace

- Always operate from this shared OwnPilot workspace.
- Read \.mcp.json and the local instruction files in this directory.
- Do not switch to another project directory unless the user explicitly asks.

## CRITICAL: You MUST Call Tools When Needed

You may need to use OwnPilot tools to help with tasks, memory, notes, goals, calendar,
search, and automation. Do not just describe available tools. Execute them when needed.
Never call OwnPilot HTTP endpoints directly.

### Quick Examples:

| User says | You do |
|-----------|--------|
| "list my tasks" | use the task-listing tool flow immediately |
| "add task: buy groceries" | create the task directly |
| "search web for X" | run the web search tool and summarize results |
| "show tasks and goals" | gather both and answer in one response |

Read **AGENTS.md** for complete behavior and tool guidance.
`;
}

// =============================================================================
// Workspace Management
// =============================================================================

const log = getLog('Workspace');

async function removeOwnpilotFromJsonConfig(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const servers = parsed.mcpServers as Record<string, unknown> | undefined;
    if (!servers?.ownpilot) return;

    delete servers.ownpilot;
    parsed.mcpServers = servers;
    await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    log.info(`Removed stale ownpilot MCP entry from ${filePath}`);
  } catch (error) {
    log.warn(`Failed to clean stale MCP config ${filePath}: ${String(error)}`);
  }
}

async function cleanGlobalCliMcpConfig(): Promise<void> {
  await Promise.all([
    removeOwnpilotFromJsonConfig(join(homedir(), '.gemini', 'settings.json')),
    removeOwnpilotFromJsonConfig(join(homedir(), '.codex', 'mcp.json')),
  ]);
}

function getDefaultBaseDir(): string {
  return join(homedir(), '.ownpilot', 'workspace');
}

/**
 * Clean up CLI-specific session state from previous invocations.
 * Each new chat must be a fresh session — stale caches, MCP connection
 * state, and settings from previous runs must not carry over.
 */
async function cleanSessionState(dir: string): Promise<void> {
  // Directories created by CLIs that contain session-specific state
  const sessionDirs = [
    '.claude', // Claude Code: MCP connection cache, settings, session data
    '.codex', // Codex CLI: session state
    '.gemini', // Gemini CLI: session state
  ];

  for (const subdir of sessionDirs) {
    const fullPath = join(dir, subdir);
    if (existsSync(fullPath)) {
      try {
        await rm(fullPath, { recursive: true, force: true });
        log.debug(`Cleaned CLI session state: ${fullPath}`);
      } catch (err) {
        log.warn(`Failed to clean session state ${fullPath}: ${String(err)}`);
      }
    }
  }
}

/**
 * Ensure the CLI workspace exists with up-to-date config files.
 * Creates the workspace if it doesn't exist, or updates files if they do.
 * Cleans CLI session state to ensure each invocation starts fresh.
 */
export async function ensureWorkspace(config: WorkspaceConfig = {}): Promise<WorkspaceInfo> {
  const gatewayUrl = config.gatewayUrl || 'http://localhost:8080';
  const dir = config.baseDir || getDefaultBaseDir();

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Initialize a git repo so CLIs like Codex don't refuse to run
  if (!existsSync(join(dir, '.git'))) {
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe', timeout: 5000 });
    } catch {
      // Best effort — some CLIs work without git
    }
  }

  // Clean up CLI session state from previous invocations
  // Each new chat must start fresh — no stale MCP connections or cached settings
  await cleanSessionState(dir);
  await cleanGlobalCliMcpConfig();

  // Write config files (always overwrite to keep in sync)
  await Promise.all([
    writeFile(
      join(dir, '.mcp.json'),
      buildMcpConfig(gatewayUrl, config.correlationId, config.sessionToken),
      'utf-8'
    ),
    writeFile(join(dir, 'AGENTS.md'), buildAgentsMd(), 'utf-8'),
    writeFile(join(dir, 'CLAUDE.md'), buildClaudeMd(), 'utf-8'),
    writeFile(join(dir, 'GEMINI.md'), buildGeminiMd(), 'utf-8'),
    writeFile(join(dir, 'CODEX.md'), buildCodexMd(), 'utf-8'),
  ]);

  return {
    dir,
    mcpConfigPath: join(dir, '.mcp.json'),
  };
}

/**
 * Create a CLI workspace for a chat session.
 *
 * Uses a PERSISTENT directory (~/.ownpilot/workspace) rather than a temp dir.
 * This is critical for CLIs like Codex that require the directory to be "trusted"
 * in their config — a stable path means the user trusts it once and it works forever.
 *
 * The .mcp.json is rewritten each time with the session-specific correlationId
 * and sessionToken. Context files (CLAUDE.md, GEMINI.md, CODEX.md, AGENTS.md) are idempotent.
 * CLI session state (.claude/, .codex/, .gemini/) is cleaned before each session.
 */
export async function createTempWorkspace(
  config: WorkspaceConfig = {}
): Promise<WorkspaceInfo & { cleanup: () => Promise<void> }> {
  const info = await ensureWorkspace(config);

  return {
    ...info,
    // No-op cleanup — persistent workspace is reused across sessions
    cleanup: async () => {
      // Intentionally empty: workspace is reused, not deleted
    },
  };
}

/**
 * Get the workspace directory path without creating it.
 */
export function getWorkspaceDir(config: WorkspaceConfig = {}): string {
  return config.baseDir || getDefaultBaseDir();
}

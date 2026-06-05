/**
 * MCP Server Presets
 *
 * Curated catalog of well-known external MCP servers users can install with
 * one click. Each preset declares the transport invocation plus any required
 * env vars / install prerequisites so the install endpoint can validate the
 * config before persisting a row.
 *
 * Presets are NOT a sandbox — they are convenience wrappers around the same
 * `POST /api/v1/mcp` config shape. Users can always edit the resulting row.
 */

type PresetEnvKind = 'secret' | 'plain';

export interface PresetEnvVar {
  name: string;
  description: string;
  kind: PresetEnvKind;
  required: boolean;
}

export interface McpServerPreset {
  /** Stable preset id used in routes (kebab-case). */
  id: string;
  /** Default `name` when creating the mcp_servers row. User can override. */
  defaultName: string;
  displayName: string;
  description: string;
  /** Free-text category for UI grouping. */
  category: 'browser' | 'filesystem' | 'web' | 'memory' | 'devtools' | 'reasoning';
  /** Upstream homepage / repo. */
  homepage: string;
  /** Short install hint shown above the action button. */
  installHint: string;
  /** Transport shape used to create the server row. */
  transport: 'stdio';
  command: string;
  args: string[];
  /** Env vars the preset accepts. Required ones must be supplied at install. */
  env: PresetEnvVar[];
  /**
   * Optional warning the UI should surface (privacy/cost/dependency footprint).
   * Lets us be upfront about non-obvious tradeoffs without burying them in docs.
   */
  warning?: string;
}

export const MCP_SERVER_PRESETS: readonly McpServerPreset[] = [
  // ===========================================================================
  // Browser automation
  // ===========================================================================
  {
    id: 'browser-use',
    defaultName: 'browser-use',
    displayName: 'Browser Use',
    description:
      'Python framework for AI-driven browser automation (vision + DOM). Spawns a real browser per session — heavier than puppeteer-core but better at SPA-heavy pages and multi-step navigation.',
    category: 'browser',
    homepage: 'https://github.com/browser-use/browser-use',
    installHint:
      'Requires Python + uv on the host. `uvx --from "browser-use[cli]" browser-use --mcp` will auto-install on first run.',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'browser-use[cli]', 'browser-use', '--mcp'],
    env: [
      {
        name: 'OPENAI_API_KEY',
        description: "Used by browser-use's internal reasoning loop (OpenAI or Anthropic).",
        kind: 'secret',
        required: false,
      },
      {
        name: 'ANTHROPIC_API_KEY',
        description: "Alternative to OPENAI_API_KEY for browser-use's reasoning loop.",
        kind: 'secret',
        required: false,
      },
      {
        name: 'BROWSER_USE_HEADLESS',
        description: 'Set to "false" to display the browser window during runs.',
        kind: 'plain',
        required: false,
      },
    ],
    warning:
      "browser-use runs its own agentic loop, so each task burns additional LLM tokens on top of OwnPilot's. Either OPENAI_API_KEY or ANTHROPIC_API_KEY must be set for the server to function.",
  },
  {
    id: 'playwright-mcp',
    defaultName: 'playwright',
    displayName: 'Playwright MCP',
    description:
      "Microsoft's Playwright MCP server — DOM-based browser automation (no vision). Lower per-call cost than browser-use, native Node.js.",
    category: 'browser',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    installHint: 'Node.js + npx required. First run downloads playwright browsers (~300MB).',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    env: [],
  },

  // ===========================================================================
  // Filesystem
  // ===========================================================================
  {
    id: 'filesystem',
    defaultName: 'filesystem',
    displayName: 'Filesystem',
    description:
      'Read / write / search files within an allowlisted directory. The reference filesystem MCP server.',
    category: 'filesystem',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    installHint:
      'Pass one or more allowed directories as extra args. The server refuses any access outside them.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: [],
    warning:
      'You must append at least one absolute directory path to args before saving (e.g. add "/Users/me/projects"). Without an allowlisted root the server starts but exposes nothing.',
  },

  // ===========================================================================
  // Web fetch
  // ===========================================================================
  {
    id: 'fetch',
    defaultName: 'fetch',
    displayName: 'Fetch',
    description:
      'Fetch web pages and convert them to markdown. Lightweight alternative to driving a real browser.',
    category: 'web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    installHint: 'Python + uvx — `uvx mcp-server-fetch`.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: [],
  },

  // ===========================================================================
  // Memory / reasoning helpers
  // ===========================================================================
  {
    id: 'sequential-thinking',
    defaultName: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description:
      'Lets the agent record a step-by-step reasoning trace. Useful for long-horizon planning when the host LLM does not support native thinking blocks.',
    category: 'reasoning',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    installHint: 'Node.js + npx.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: [],
  },
  {
    id: 'memory',
    defaultName: 'mcp-memory',
    displayName: 'Memory (knowledge graph)',
    description:
      "Reference knowledge-graph memory server. Independent of OwnPilot's native memory — best used for project-scoped graphs when you want isolation.",
    category: 'memory',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    installHint: 'Node.js + npx.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: [
      {
        name: 'MEMORY_FILE_PATH',
        description: 'Absolute path of the JSON file backing the graph.',
        kind: 'plain',
        required: false,
      },
    ],
  },

  // ===========================================================================
  // Devtools
  // ===========================================================================
  {
    id: 'git',
    defaultName: 'git',
    displayName: 'Git (Python MCP)',
    description:
      'Repository inspection (status, log, diff, blame, search). Read-only by default. Complements our native git_* tools when you want MCP-side namespacing.',
    category: 'devtools',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    installHint: 'Python + uvx.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git'],
    env: [],
  },
  {
    id: 'sqlite',
    defaultName: 'sqlite',
    displayName: 'SQLite',
    description: 'Query / inspect a SQLite database file via SQL.',
    category: 'devtools',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    installHint: 'Python + uvx. Pass the database path with `--db-path /abs/path/db.sqlite`.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite'],
    env: [],
    warning:
      'Append `--db-path` plus an absolute path to args before saving, or the server has no database to operate on.',
  },
];

const PRESETS_BY_ID = new Map<string, McpServerPreset>(MCP_SERVER_PRESETS.map((p) => [p.id, p]));

export function getMcpPreset(id: string): McpServerPreset | undefined {
  return PRESETS_BY_ID.get(id);
}

/**
 * Resolve a preset + user-supplied overrides into the row shape accepted by
 * `mcpServersRepo.create()`. Required env vars missing from `env` will throw.
 */
interface ResolvedPresetInstall {
  name: string;
  displayName: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  autoConnect: boolean;
}

interface PresetInstallOverrides {
  name?: string;
  displayName?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
}

export function resolvePresetInstall(
  preset: McpServerPreset,
  overrides: PresetInstallOverrides = {}
): ResolvedPresetInstall {
  const env = { ...(overrides.env ?? {}) };

  for (const declared of preset.env) {
    if (declared.required && !env[declared.name]?.trim()) {
      throw new Error(`Preset "${preset.id}" requires env var ${declared.name}`);
    }
  }

  // Drop any env keys not declared by the preset to avoid leaking unrelated
  // secrets into the child process. Users who need extras must edit the row
  // post-install.
  const declaredNames = new Set(preset.env.map((e) => e.name));
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (declaredNames.has(k) && typeof v === 'string' && v.length > 0) filteredEnv[k] = v;
  }

  return {
    name: overrides.name?.trim() || preset.defaultName,
    displayName: overrides.displayName?.trim() || preset.displayName,
    transport: 'stdio',
    command: preset.command,
    args: [...preset.args, ...(overrides.extraArgs ?? [])],
    env: filteredEnv,
    enabled: overrides.enabled ?? true,
    autoConnect: overrides.autoConnect ?? true,
  };
}

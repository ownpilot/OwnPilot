/**
 * CLI MCP Registration Utility
 *
 * Registers the OwnPilot MCP server with CLI tools so they can use
 * OwnPilot's tools natively via MCP protocol.
 *
 * Supported CLIs:
 * - Claude Code: ~/.claude/mcp.json
 * - Gemini CLI: ~/.gemini/settings.json
 * - Codex CLI: ~/.codex/mcp.json (or project-level .mcp.json)
 *
 * Usage as module:
 *   import { registerMcpForCli, registerMcpForAllClis } from './register-cli-mcp.js';
 *   await registerMcpForAllClis({ gatewayUrl: 'http://localhost:8080' });
 *
 * Usage as script:
 *   npx tsx register-cli-mcp.ts [--url http://localhost:8080] [--cli claude|gemini|codex|all]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { isBinaryInstalled } from '../services/binary-utils.js';

// =============================================================================
// Types
// =============================================================================

export interface McpRegistrationConfig {
  /** OwnPilot gateway URL (default: http://localhost:8080) */
  gatewayUrl?: string;
  /** Path to the MCP server script */
  serverScript?: string;
}

export interface McpRegistrationResult {
  cli: string;
  success: boolean;
  configPath: string;
  message: string;
}

type CliName = 'claude' | 'gemini' | 'codex';

// =============================================================================
// Config Paths
// =============================================================================

function getConfigPath(cli: CliName): string {
  const home = homedir();
  switch (cli) {
    case 'claude':
      return join(home, '.claude', 'mcp.json');
    case 'gemini':
      return join(home, '.gemini', 'settings.json');
    case 'codex':
      return join(home, '.codex', 'mcp.json');
  }
}

// =============================================================================
// MCP Config Builders
// =============================================================================

function buildMcpEntry(cli: CliName, config: McpRegistrationConfig): Record<string, unknown> {
  const gatewayUrl = config.gatewayUrl || 'http://localhost:8080';

  // Prefer HTTP (direct connection to running gateway via Streamable HTTP protocol)
  // Falls back to stdio (spawns the MCP server script)
  // NOTE: Claude Code uses "http" as the type name for Streamable HTTP transport
  if (config.serverScript) {
    return {
      type: 'stdio',
      command: 'node',
      args: [config.serverScript],
      env: {
        OWNPILOT_URL: gatewayUrl,
      },
    };
  }

  if (cli === 'gemini') {
    return {
      httpUrl: `${gatewayUrl}/api/v1/mcp/serve`,
      trust: true,
    };
  }

  // Codex only supports stdio transport (not HTTP)
  if (cli === 'codex') {
    return {
      type: 'stdio',
      command: 'node',
      args: [config.serverScript || './cli-mcp-server.js'],
      env: {
        OWNPILOT_URL: gatewayUrl,
      },
    };
  }

  return {
    type: 'http',
    url: `${gatewayUrl}/api/v1/mcp/serve`,
  };
}

// =============================================================================
// Registration Functions
// =============================================================================

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Register OwnPilot MCP server with Claude Code.
 * Config: ~/.claude/mcp.json → { mcpServers: { ownpilot: { ... } } }
 */
async function registerClaude(config: McpRegistrationConfig): Promise<McpRegistrationResult> {
  const configPath = getConfigPath('claude');

  try {
    const existing = await readJsonFile(configPath);
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    servers.ownpilot = buildMcpEntry('claude', config);
    existing.mcpServers = servers;

    await writeJsonFile(configPath, existing);

    return {
      cli: 'claude',
      success: true,
      configPath,
      message: 'OwnPilot MCP registered with Claude Code',
    };
  } catch (error) {
    return {
      cli: 'claude',
      success: false,
      configPath,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Register OwnPilot MCP server with Gemini CLI.
 * Config: ~/.gemini/settings.json → { mcpServers: { ownpilot: { ... } } }
 */
async function registerGemini(config: McpRegistrationConfig): Promise<McpRegistrationResult> {
  const configPath = getConfigPath('gemini');

  try {
    const existing = await readJsonFile(configPath);
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    servers.ownpilot = buildMcpEntry('gemini', config);
    existing.mcpServers = servers;

    await writeJsonFile(configPath, existing);

    return {
      cli: 'gemini',
      success: true,
      configPath,
      message: 'OwnPilot MCP registered with Gemini CLI',
    };
  } catch (error) {
    return {
      cli: 'gemini',
      success: false,
      configPath,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Register OwnPilot MCP server with Codex CLI.
 * Config: ~/.codex/mcp.json → { mcpServers: { ownpilot: { ... } } }
 */
async function registerCodex(config: McpRegistrationConfig): Promise<McpRegistrationResult> {
  const configPath = getConfigPath('codex');

  try {
    const existing = await readJsonFile(configPath);
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    servers.ownpilot = buildMcpEntry('codex', config);
    existing.mcpServers = servers;

    await writeJsonFile(configPath, existing);

    return {
      cli: 'codex',
      success: true,
      configPath,
      message: 'OwnPilot MCP registered with Codex CLI',
    };
  } catch (error) {
    return {
      cli: 'codex',
      success: false,
      configPath,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const REGISTRARS: Record<
  CliName,
  (config: McpRegistrationConfig) => Promise<McpRegistrationResult>
> = {
  claude: registerClaude,
  gemini: registerGemini,
  codex: registerCodex,
};

/**
 * Register OwnPilot MCP for a specific CLI.
 */
export async function registerMcpForCli(
  cli: CliName,
  config: McpRegistrationConfig = {}
): Promise<McpRegistrationResult> {
  if (!isBinaryInstalled(cli)) {
    return {
      cli,
      success: false,
      configPath: getConfigPath(cli),
      message: `${cli} CLI is not installed`,
    };
  }

  return REGISTRARS[cli](config);
}

/**
 * Register OwnPilot MCP for all installed CLIs.
 */
export async function registerMcpForAllClis(
  config: McpRegistrationConfig = {}
): Promise<McpRegistrationResult[]> {
  const clis: CliName[] = ['claude', 'gemini', 'codex'];
  const results: McpRegistrationResult[] = [];

  for (const cli of clis) {
    results.push(await registerMcpForCli(cli, config));
  }

  return results;
}

/**
 * Unregister OwnPilot MCP from a specific CLI.
 */
export async function unregisterMcpForCli(cli: CliName): Promise<McpRegistrationResult> {
  const configPath = getConfigPath(cli);

  try {
    const existing = await readJsonFile(configPath);
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    if (!servers.ownpilot) {
      return { cli, success: true, configPath, message: 'OwnPilot MCP was not registered' };
    }

    delete servers.ownpilot;
    existing.mcpServers = servers;

    await writeJsonFile(configPath, existing);

    return { cli, success: true, configPath, message: `OwnPilot MCP unregistered from ${cli}` };
  } catch (error) {
    return {
      cli,
      success: false,
      configPath,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get the MCP config snippet for a CLI (without writing to disk).
 */
export function getMcpConfigSnippet(
  cli: CliName,
  config: McpRegistrationConfig = {}
): { configPath: string; snippet: Record<string, unknown> } {
  return {
    configPath: getConfigPath(cli),
    snippet: {
      mcpServers: {
        ownpilot: buildMcpEntry(cli, config),
      },
    },
  };
}

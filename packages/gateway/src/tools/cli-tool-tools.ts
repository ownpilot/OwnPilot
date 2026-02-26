/**
 * CLI Tool Tools
 *
 * AI agent tools for discovering, executing, and installing CLI tools.
 * Unlike coding agent tools (session-based, long-running), these are
 * lightweight fire-and-forget executions.
 *
 * Security: Only tools from the catalog or user-registered custom providers
 * can be executed (binary allowlist). Per-tool policies enforce allowed/prompt/blocked.
 */

import type { ToolDefinition, CliInstallMethod } from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { getCliToolService } from '../services/cli-tool-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const runCliToolDef: ToolDefinition = {
  name: 'run_cli_tool',
  workflowUsable: true,
  description: `Execute an installed CLI tool and return its output. Only tools from the known catalog or user-registered custom providers can run (binary allowlist).

Use list_cli_tools first to see available tools and their status. If a tool is not installed globally but is available via npx, it will be auto-invoked via npx.

Examples:
- run_cli_tool(name="eslint", args=["--format", "json", "src/"], cwd="/project")
- run_cli_tool(name="prettier", args=["--check", "**/*.ts"], cwd="/project")
- run_cli_tool(name="git", args=["status"], cwd="/project")
- run_cli_tool(name="docker", args=["ps"], cwd="/home/user")
- run_cli_tool(name="tsc", args=["--noEmit"], cwd="/project")

Tools blocked by policy will be rejected. Tools with 'prompt' policy may require user approval.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          "Tool name from catalog (e.g., 'eslint', 'prettier', 'docker', 'git') or custom provider ('custom:my-tool')",
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command-line arguments to pass to the tool',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (absolute path)',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Timeout in seconds (default: 60, max: 300)',
      },
    },
    required: ['name', 'args', 'cwd'],
  },
  category: 'CLI Tools',
  tags: ['cli', 'tool', 'execute', 'system'],
};

const listCliToolsDef: ToolDefinition = {
  name: 'list_cli_tools',
  workflowUsable: true,
  description:
    'List all available CLI tools (built-in catalog + custom providers) with their installation status, version, npx availability, risk level, and execution policy. Check this before running a CLI tool.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'CLI Tools',
  tags: ['cli', 'tool', 'discovery', 'status'],
};

const installCliToolDef: ToolDefinition = {
  name: 'install_cli_tool',
  workflowUsable: false,
  description: `Install a missing CLI tool globally via npm or pnpm. Only tools from the known catalog can be installed. Requires user approval.

Examples:
- install_cli_tool(name="prettier", method="pnpm-global")
- install_cli_tool(name="eslint", method="npm-global")`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Tool name from the catalog (e.g., "prettier", "eslint")',
      },
      method: {
        type: 'string',
        enum: ['npm-global', 'pnpm-global'],
        description: 'Installation method (npm install -g or pnpm add -g)',
      },
    },
    required: ['name', 'method'],
  },
  category: 'CLI Tools',
  tags: ['cli', 'tool', 'install', 'setup'],
};

export const CLI_TOOL_TOOLS: ToolDefinition[] = [runCliToolDef, listCliToolsDef, installCliToolDef];

// =============================================================================
// Executor
// =============================================================================

export async function executeCliToolTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getCliToolService();

  switch (toolName) {
    case 'run_cli_tool': {
      try {
        const name = args.name as string;
        const cliArgs = (args.args as string[]) ?? [];
        const cwd = args.cwd as string;

        if (!name) return { success: false, error: 'name is required' };
        if (!cwd) return { success: false, error: 'cwd is required' };

        const result = await service.executeTool(name, cliArgs, cwd, userId);

        return {
          success: result.success,
          result: {
            toolName: result.toolName,
            exitCode: result.exitCode,
            stdout: truncateOutput(result.stdout, 8000),
            stderr: truncateOutput(result.stderr, 2000),
            durationMs: result.durationMs,
            truncated: result.truncated,
          },
          error: result.error,
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_cli_tools': {
      try {
        const tools = await service.listTools(userId);
        return { success: true, result: tools };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'install_cli_tool': {
      try {
        const name = args.name as string;
        const method = args.method as CliInstallMethod;

        if (!name) return { success: false, error: 'name is required' };
        if (!method) return { success: false, error: 'method is required' };

        const result = await service.installTool(name, method, userId);
        return {
          success: result.success,
          result: {
            toolName: result.toolName,
            exitCode: result.exitCode,
            output: result.stdout,
          },
          error: result.error,
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    default:
      return { success: false, error: `Unknown CLI tool tool: ${toolName}` };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Truncate output to avoid huge tool results in LLM context */
function truncateOutput(output: string, maxLen: number): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2) - 20;
  return output.slice(0, half) + '\n\n... [output truncated] ...\n\n' + output.slice(-half);
}

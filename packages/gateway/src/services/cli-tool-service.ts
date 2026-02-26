/**
 * CLI Tool Service
 *
 * Discovers, executes, and installs CLI tools. Unlike the coding agent service
 * (long-running sessions with PTY/WS streaming), this service handles
 * short-lived fire-and-forget CLI tool executions (linters, formatters, etc.).
 *
 * Security layers:
 * 1. Binary allowlist: only catalog + custom provider tools can execute
 * 2. Per-tool policies: allowed/prompt/blocked per user
 * 3. Environment sanitization: strip OwnPilot secrets
 * 4. Process isolation: spawn() with args array (no shell injection)
 */

import type {
  ICliToolService,
  CliToolStatus,
  CliToolExecutionResult,
  CliToolPolicy,
  CliInstallMethod,
} from '@ownpilot/core';
import { getErrorMessage } from '@ownpilot/core';
import { CLI_TOOLS_BY_NAME } from './cli-tools-catalog.js';
import { discoverTools, clearDiscoveryCache } from './cli-tools-discovery.js';
import { cliToolPoliciesRepo } from '../db/repositories/cli-tool-policies.js';
import { cliProvidersRepo } from '../db/repositories/cli-providers.js';
import {
  isBinaryInstalled,
  validateCwd,
  createSanitizedEnv,
  spawnCliProcess,
  MAX_OUTPUT_SIZE,
} from './binary-utils.js';
import { getLog } from './log.js';

const log = getLog('CliToolService');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute (shorter than coding agents)
const MAX_TIMEOUT_MS = 300_000; // 5 minutes

// =============================================================================
// SERVICE
// =============================================================================

class CliToolService implements ICliToolService {
  async listTools(userId = 'default'): Promise<CliToolStatus[]> {
    return discoverTools(userId);
  }

  async executeTool(
    name: string,
    args: string[],
    cwd: string,
    userId = 'default'
  ): Promise<CliToolExecutionResult> {
    const start = Date.now();

    // 1. Resolve the tool (catalog or custom provider) — binary allowlist
    const resolved = await this.resolveTool(name, userId);
    if (!resolved) {
      return this.errorResult(
        name,
        start,
        `Tool '${name}' not found in catalog or custom providers. Use list_cli_tools to see available tools.`
      );
    }

    // 2. Check policy
    const policy = await this.getToolPolicy(name, userId);
    if (policy === 'blocked') {
      return this.errorResult(
        name,
        start,
        `Tool '${name}' is blocked by policy. Update the policy in Settings to 'allowed' or 'prompt'.`
      );
    }

    // 3. Validate cwd
    let resolvedCwd: string;
    try {
      resolvedCwd = validateCwd(cwd);
    } catch (err) {
      return this.errorResult(name, start, getErrorMessage(err));
    }

    // 4. Check if binary is installed — try npx fallback
    let command = resolved.binaryName;
    let execArgs = args;
    if (!isBinaryInstalled(resolved.binaryName)) {
      if (resolved.npxPackage && isBinaryInstalled('npx')) {
        command = 'npx';
        execArgs = ['--yes', resolved.npxPackage, ...args];
      } else {
        return this.errorResult(
          name,
          start,
          `Tool '${name}' (binary: ${resolved.binaryName}) is not installed. Use install_cli_tool to install it.`
        );
      }
    }

    // 5. Execute via spawnCliProcess (safe, no shell injection)
    const env = createSanitizedEnv(name);
    const timeout = Math.min(DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    log.info(`Executing CLI tool: ${name}`, { command, args: execArgs, cwd: resolvedCwd });

    try {
      const result = await spawnCliProcess(command, execArgs, {
        cwd: resolvedCwd,
        env,
        timeout,
      });

      const truncated =
        result.stdout.length >= MAX_OUTPUT_SIZE || result.stderr.length >= MAX_OUTPUT_SIZE;

      return {
        success: result.exitCode === 0,
        toolName: name,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - start,
        truncated,
        error:
          result.exitCode !== 0
            ? result.stderr || `Exited with code ${result.exitCode}`
            : undefined,
      };
    } catch (err) {
      return this.errorResult(name, start, getErrorMessage(err));
    }
  }

  async installTool(
    name: string,
    method: CliInstallMethod,
    userId = 'default'
  ): Promise<CliToolExecutionResult> {
    const start = Date.now();

    const toolEntry = CLI_TOOLS_BY_NAME.get(name);
    if (!toolEntry) {
      return this.errorResult(
        name,
        start,
        `Tool '${name}' not found in catalog. Only catalog tools can be installed.`
      );
    }

    if (!toolEntry.installMethods.includes(method)) {
      return this.errorResult(
        name,
        start,
        `Install method '${method}' is not available for '${name}'. Available: ${toolEntry.installMethods.join(', ')}`
      );
    }

    const pkg = toolEntry.npmPackage ?? toolEntry.npxPackage;
    if (!pkg && (method === 'npm-global' || method === 'pnpm-global')) {
      return this.errorResult(
        name,
        start,
        `No npm package defined for '${name}'. Use a different install method.`
      );
    }

    let command: string;
    let args: string[];
    switch (method) {
      case 'npm-global':
        command = 'npm';
        args = ['install', '-g', pkg!];
        break;
      case 'pnpm-global':
        command = 'pnpm';
        args = ['add', '-g', pkg!];
        break;
      default:
        return this.errorResult(
          name,
          start,
          `Install method '${method}' requires manual installation.`
        );
    }

    log.info(`Installing CLI tool: ${name}`, { command, args, method });

    const env = createSanitizedEnv(name);

    try {
      const result = await spawnCliProcess(command, args, {
        cwd: process.cwd(),
        env,
        timeout: MAX_TIMEOUT_MS,
      });

      // Clear discovery cache after install attempt
      clearDiscoveryCache(userId);

      return {
        success: result.exitCode === 0,
        toolName: name,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - start,
        truncated: false,
        error:
          result.exitCode !== 0
            ? result.stderr || `Installation failed with code ${result.exitCode}`
            : undefined,
      };
    } catch (err) {
      return this.errorResult(name, start, getErrorMessage(err));
    }
  }

  async getToolPolicy(name: string, userId = 'default'): Promise<CliToolPolicy> {
    try {
      const policy = await cliToolPoliciesRepo.getPolicy(name, userId);
      if (policy) return policy;
    } catch {
      // DB not ready — use catalog default
    }
    const toolEntry = CLI_TOOLS_BY_NAME.get(name);
    return toolEntry?.defaultPolicy ?? 'prompt';
  }

  async setToolPolicy(name: string, policy: CliToolPolicy, userId = 'default'): Promise<void> {
    await cliToolPoliciesRepo.setPolicy(name, policy, userId);
  }

  async refreshDiscovery(): Promise<void> {
    clearDiscoveryCache();
  }

  // ===========================================================================
  // PRIVATE
  // ===========================================================================

  /**
   * Resolve a tool name to its binary. Returns null if not in allowlist.
   */
  private async resolveTool(
    name: string,
    userId: string
  ): Promise<{ binaryName: string; npxPackage?: string } | null> {
    // Check catalog first
    const catalogEntry = CLI_TOOLS_BY_NAME.get(name);
    if (catalogEntry) {
      return { binaryName: catalogEntry.binaryName, npxPackage: catalogEntry.npxPackage };
    }

    // Check custom providers
    if (name.startsWith('custom:')) {
      const customName = name.slice(7);
      try {
        const cp = await cliProvidersRepo.getByName(customName, userId);
        if (cp) return { binaryName: cp.binary };
      } catch {
        // DB not ready
      }
    }

    return null;
  }

  private errorResult(toolName: string, start: number, error: string): CliToolExecutionResult {
    return {
      success: false,
      toolName,
      stdout: '',
      stderr: '',
      exitCode: -1,
      durationMs: Date.now() - start,
      truncated: false,
      error,
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: CliToolService | null = null;

export function getCliToolService(): CliToolService {
  if (!instance) {
    instance = new CliToolService();
  }
  return instance;
}

export { CliToolService };

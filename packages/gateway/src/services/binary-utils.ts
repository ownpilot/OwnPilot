/**
 * Binary Utilities
 *
 * Shared helpers for detecting, validating, and spawning CLI binaries.
 * Used by both the coding agent service and the CLI tool service.
 *
 * All spawn functions use explicit args arrays — no shell injection possible.
 * Environment is sanitized to strip OwnPilot secrets before spawning.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { isBuiltinProvider } from '@ownpilot/core';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum output size (stdout or stderr) captured from a child process */
export const MAX_OUTPUT_SIZE = 1_048_576; // 1 MB

/** Built-in provider env var names (needed by createSanitizedEnv) */
const API_KEY_ENV_VARS: Record<string, string> = {
  'claude-code': 'ANTHROPIC_API_KEY',
  codex: 'CODEX_API_KEY',
  'gemini-cli': 'GEMINI_API_KEY',
};

// =============================================================================
// BINARY DETECTION
// =============================================================================

/**
 * Check if a CLI binary is installed using execFileSync (safe, no shell injection).
 */
export function isBinaryInstalled(binary: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(cmd, [binary], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get version of a CLI binary using execFileSync (safe, no shell injection).
 */
export function getBinaryVersion(binary: string, flag = '--version'): string | undefined {
  try {
    const output = execFileSync(binary, [flag], {
      stdio: 'pipe',
      timeout: 10000,
      encoding: 'utf8',
    });
    return output.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

// =============================================================================
// PATH VALIDATION
// =============================================================================

/**
 * Validate working directory: must be absolute, no path traversal.
 */
export function validateCwd(cwd: string): string {
  const resolved = resolve(cwd);
  if (!isAbsolute(resolved)) {
    throw new Error(`Working directory must be an absolute path: ${cwd}`);
  }
  if (resolved.includes('..')) {
    throw new Error(`Working directory must not contain path traversal: ${cwd}`);
  }
  return resolved;
}

// =============================================================================
// ENVIRONMENT SANITIZATION
// =============================================================================

/**
 * Create a sanitized environment for child processes.
 * Strips OwnPilot secrets, optionally injects the target API key.
 * API key is optional — CLIs support login-based auth.
 */
export function createSanitizedEnv(
  provider: string,
  apiKey?: string,
  apiKeyEnvVar?: string
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  // Remove sensitive OwnPilot variables
  const sensitivePatterns = [
    /^OWNPILOT_/i,
    /^DATABASE_/i,
    /^ADMIN_KEY$/i,
    /^JWT_SECRET$/i,
    /^SESSION_SECRET$/i,
  ];
  for (const key of Object.keys(env)) {
    if (sensitivePatterns.some((p) => p.test(key))) {
      delete env[key];
    }
  }

  // Remove nesting-detection env vars so child CLIs don't refuse to start
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;

  // Inject the provider's API key if available
  if (apiKey) {
    // For built-in providers, use the known env var name
    const envVarName = apiKeyEnvVar
      ?? (isBuiltinProvider(provider) ? API_KEY_ENV_VARS[provider] : undefined);
    if (envVarName) {
      env[envVarName] = apiKey;
    }
  }

  return env;
}

// =============================================================================
// PROCESS SPAWNING
// =============================================================================

/**
 * Spawn a CLI as a child process and collect output.
 * Uses spawn() with explicit args array (no shell injection).
 */
export function spawnCliProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: Record<string, string>;
    timeout: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc: ChildProcess = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Force kill after 5s grace period
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }, options.timeout);

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += chunk.toString();
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += chunk.toString();
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`Process timed out after ${options.timeout}ms`));
      } else {
        resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
      }
    });
  });
}

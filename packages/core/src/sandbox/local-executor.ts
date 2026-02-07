/**
 * Local Code Executor
 *
 * Executes code directly on the host machine without Docker.
 * Used as a fallback when Docker is not available.
 *
 * Security measures:
 * - Timeout enforcement
 * - Output size limits
 * - Workspace directory scoping
 * - Environment sanitization (strips sensitive vars)
 * - Dangerous command blocking (reuses isCommandBlocked)
 */

import { spawn } from 'child_process';
import * as os from 'os';
import type { SandboxResult } from './docker.js';
import { isCommandBlocked } from '../security/index.js';

// =============================================================================
// Types
// =============================================================================

export interface LocalExecOptions {
  /** Execution timeout in ms (default: 30000) */
  timeout?: number;
  /** Max output size in bytes (default: 1MB) */
  maxOutputSize?: number;
  /** Working directory for the process */
  workspaceDir?: string;
  /** Extra environment variables */
  env?: Record<string, string>;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1MB

/**
 * Environment variables to strip from child processes.
 * Prevents leaking API keys and secrets.
 */
const SENSITIVE_ENV_PREFIXES = [
  'OPENAI_',
  'ANTHROPIC_',
  'GOOGLE_',
  'AZURE_',
  'AWS_',
  'DEEPSEEK_',
  'GROQ_',
  'API_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'CREDENTIAL',
  'SMTP_',
  'DATABASE_URL',
  'DB_',
];

/**
 * Create a sanitized environment for child processes.
 * Strips sensitive variables while preserving PATH and system essentials.
 */
function createSanitizedEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const processEnv = process.env;

  for (const [key, value] of Object.entries(processEnv)) {
    if (!value) continue;
    const upperKey = key.toUpperCase();
    const isSensitive = SENSITIVE_ENV_PREFIXES.some(prefix => upperKey.includes(prefix));
    if (!isSensitive) {
      env[key] = value;
    }
  }

  // Merge extra env vars
  if (extra) {
    Object.assign(env, extra);
  }

  return env;
}

/**
 * Truncate output if it exceeds max size.
 */
function truncateOutput(output: string, maxSize: number): string {
  if (output.length <= maxSize) return output;
  return output.slice(0, maxSize) + `\n\n... [Output truncated at ${maxSize} bytes]`;
}

// =============================================================================
// Executors
// =============================================================================

/**
 * Execute JavaScript code locally using Node.js.
 */
export async function executeJavaScriptLocal(
  code: string,
  options?: LocalExecOptions,
): Promise<SandboxResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxOutput = options?.maxOutputSize ?? DEFAULT_MAX_OUTPUT;
  const startTime = Date.now();

  return new Promise<SandboxResult>((resolve) => {
    const env = createSanitizedEnv(options?.env);
    const child = spawn('node', ['-e', code], {
      cwd: options?.workspaceDir ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        success: !timedOut && exitCode === 0,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode,
        executionTimeMs: Date.now() - startTime,
        timedOut,
        error: timedOut ? `Execution timed out after ${timeout}ms` : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode: null,
        executionTimeMs: Date.now() - startTime,
        error: `Failed to start process: ${err.message}`,
      });
    });

    // Close stdin immediately
    child.stdin?.end();
  });
}

/**
 * Execute Python code locally.
 */
export async function executePythonLocal(
  code: string,
  options?: LocalExecOptions,
): Promise<SandboxResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxOutput = options?.maxOutputSize ?? DEFAULT_MAX_OUTPUT;
  const startTime = Date.now();

  // Determine Python command (python3 on Unix, python on Windows)
  const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';

  return new Promise<SandboxResult>((resolve) => {
    const env = createSanitizedEnv(options?.env);
    const child = spawn(pythonCmd, ['-c', code], {
      cwd: options?.workspaceDir ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        success: !timedOut && exitCode === 0,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode,
        executionTimeMs: Date.now() - startTime,
        timedOut,
        error: timedOut ? `Execution timed out after ${timeout}ms` : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode: null,
        executionTimeMs: Date.now() - startTime,
        error: `Failed to start process: ${err.message}. Is ${pythonCmd} installed?`,
      });
    });

    child.stdin?.end();
  });
}

/**
 * Execute a shell command locally.
 */
export async function executeShellLocal(
  command: string,
  options?: LocalExecOptions,
): Promise<SandboxResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxOutput = options?.maxOutputSize ?? DEFAULT_MAX_OUTPUT;
  const startTime = Date.now();

  // Check for blocked dangerous commands
  if (isCommandBlocked(command)) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      executionTimeMs: 0,
      error: 'This command is blocked for security reasons.',
    };
  }

  const isWindows = os.platform() === 'win32';
  const shell = isWindows ? 'cmd' : 'sh';
  const shellFlag = isWindows ? '/c' : '-c';

  return new Promise<SandboxResult>((resolve) => {
    const env = createSanitizedEnv(options?.env);
    const child = spawn(shell, [shellFlag, command], {
      cwd: options?.workspaceDir ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        success: !timedOut && exitCode === 0,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode,
        executionTimeMs: Date.now() - startTime,
        timedOut,
        error: timedOut ? `Execution timed out after ${timeout}ms` : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout: truncateOutput(stdout, maxOutput),
        stderr: truncateOutput(stderr, maxOutput),
        exitCode: null,
        executionTimeMs: Date.now() - startTime,
        error: `Failed to start process: ${err.message}`,
      });
    });

    child.stdin?.end();
  });
}

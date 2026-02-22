/**
 * Code Execution Tools
 * Safe code execution for Node.js, Python, and shell commands
 *
 * Supports Docker sandbox (preferred) and local execution (with user approval).
 * Execution mode is controlled by EXECUTION_MODE env var:
 * - 'docker': Docker only (most secure)
 * - 'local': Local only (requires approval)
 * - 'auto': Try Docker first, fall back to local with approval (default)
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult, ToolContext } from '../tools.js';
import type { ExecutionCategory } from '../types.js';
import type { ExecutionMode } from '../../sandbox/execution-mode.js';
import type { SandboxResult } from '../../sandbox/docker.js';
import {
  isDockerAvailable,
  executePythonSandbox,
  executeJavaScriptSandbox,
  executeShellSandbox,
} from '../../sandbox/docker.js';
import { logSandboxExecution } from '../debug.js';
import { checkCriticalPatterns, isCommandBlocked } from '../../security/index.js';

/** Debug logging for execution security — only active when DEBUG_EXEC_SECURITY env is set */
const EXEC_DEBUG = typeof process !== 'undefined' && !!process.env.DEBUG_EXEC_SECURITY;
const securityLog = EXEC_DEBUG
  ? (...args: unknown[]) => console.log('[ExecSecurity]', ...args)
  : () => {};
const securityWarn = EXEC_DEBUG
  ? (...args: unknown[]) => console.warn('[ExecSecurity]', ...args)
  : () => {};
import { analyzeCodeRisk } from '../../security/code-analyzer.js';
import { getExecutionMode } from '../../sandbox/execution-mode.js';
import {
  executeJavaScriptLocal,
  executePythonLocal,
  executeShellLocal,
} from '../../sandbox/local-executor.js';

// Environment flag to use relaxed Docker security (bypasses --no-new-privileges flag issues)
const DOCKER_RELAXED_SECURITY = process.env.DOCKER_SANDBOX_RELAXED_SECURITY === 'true';

// Security: Maximum execution time (30 seconds)
const MAX_EXECUTION_TIME = 30000;

// Security: Maximum output size (1MB)
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Truncate output if too large
 */
function truncateOutput(output: string, maxSize: number = MAX_OUTPUT_SIZE): string {
  if (output.length <= maxSize) return output;
  const truncated = output.slice(0, maxSize);
  return truncated + `\n\n... [Output truncated at ${maxSize} bytes]`;
}

const DOCKER_REQUIRED_ERROR = {
  error: 'Docker is required for code execution in this mode.',
  reason:
    'Code execution without Docker sandbox would allow arbitrary code to run on the host system.',
  solution:
    'Set execution mode to "Auto" or "Local" in the Execution Security panel, or install Docker.',
  securityNote: 'This restriction exists to protect your system from malicious code.',
};

const EXECUTION_DISABLED_ERROR: ToolExecutionResult = {
  content: {
    error: 'Code execution is disabled.',
    solution: 'Enable code execution in the Execution Security panel above the chat input.',
  },
  isError: true,
};

/**
 * Resolve execution config from context permissions, falling back to env var.
 * Returns { enabled, mode } where enabled=true means the master switch is on.
 */
function resolveExecutionConfig(context: ToolContext): { enabled: boolean; mode: ExecutionMode } {
  const perms = context.executionPermissions;
  if (perms && typeof perms.enabled === 'boolean') {
    return { enabled: perms.enabled, mode: perms.mode ?? getExecutionMode() };
  }
  // Fallback: env var (CLI/API context without DB permissions)
  return { enabled: true, mode: getExecutionMode() };
}

/**
 * Format a local execution result into a ToolExecutionResult.
 */
function formatLocalResult(result: SandboxResult, language: string): ToolExecutionResult {
  return {
    content: {
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      exitCode: result.exitCode,
      sandboxed: false,
      executionMode: 'local',
      language,
      error: result.error,
    },
    isError: !result.success,
  };
}

/**
 * Layered permission check for ALL code execution (Layers 1-4).
 * Applies to both Docker sandbox and local execution paths.
 *
 * Layer 1: Critical pattern blocklist (regex, ALWAYS blocks)
 * Layer 2: Code risk analysis (for display in approval dialog)
 * Layer 3: Per-category permission check (blocked/prompt/allowed)
 * Layer 4: Real-time user approval (when mode is 'prompt')
 *
 * Returns { allowed: true } to proceed, or { allowed: false, error } to block.
 */
async function checkExecutionPermission(
  category: ExecutionCategory,
  code: string,
  language: 'javascript' | 'python' | 'shell',
  context: ToolContext,
  sandboxed: boolean = false
): Promise<{ allowed: boolean; error?: ToolExecutionResult }> {
  const permissions = context.executionPermissions;

  securityLog(
    `checkPermission: category=${category}, enabled=${permissions?.enabled}, mode=${permissions?.mode}, permLevel=${permissions?.[category]}, hasRequestApproval=${!!context.requestApproval}, userId=${context.userId}`
  );

  // Layer 0: Master switch — instant reject when disabled
  if (permissions && permissions.enabled === false) {
    securityLog(`${category}: BLOCKED by master switch (enabled=false)`);
    return { allowed: false, error: EXECUTION_DISABLED_ERROR };
  }

  // undefined permissions: only allow in CLI/API context (no userId AND no requestApproval)
  // In web/chat context, treat as blocked to prevent security bypass
  if (permissions === undefined) {
    if (!context.userId && !context.requestApproval) {
      // CLI or direct API — no user session, no approval channel → backward compat
      securityLog(`${category}: ALLOWED (CLI/API backward compat, no userId, no requestApproval)`);
      return { allowed: true };
    }
    // Web/chat context but permissions failed to load → block for safety
    securityWarn(
      `${category}: permissions=undefined in user context (userId=${context.userId}) → blocked`
    );
    return {
      allowed: false,
      error: {
        content: {
          error: `${category} is blocked: execution permissions failed to load.`,
          solution: 'Refresh the page or check the Execution Security panel.',
        },
        isError: true,
      },
    };
  }

  const mode = permissions[category] ?? 'blocked';
  securityLog(`${category}: resolved permission mode = '${mode}'`);

  // Layer 1: Critical pattern check (ALWAYS blocks, even if 'allowed')
  const critical = checkCriticalPatterns(code);
  if (critical.blocked) {
    return {
      allowed: false,
      error: {
        content: {
          error: 'Blocked by security policy',
          reason: critical.reason,
          severity: 'critical',
        },
        isError: true,
      },
    };
  }

  // Layer 3: Per-category permission check
  if (mode === 'blocked') {
    return {
      allowed: false,
      error: {
        content: {
          error: `${category} is blocked in Execution Security settings.`,
          solution:
            'Open the Execution Security panel above the chat input and change the permission level.',
          currentLevel: 'blocked',
        },
        isError: true,
      },
    };
  }

  if (mode === 'prompt') {
    // Layer 2: Risk analysis for display
    const risk = analyzeCodeRisk(code, language);

    // Layer 4: Real-time approval
    if (!context.requestApproval) {
      securityWarn(`${category}: mode=prompt but NO requestApproval callback — blocking`);
      return {
        allowed: false,
        error: {
          content: {
            error: `${category} requires approval but no approval channel available.`,
            solution: 'Set to "allowed" in Execution Security settings for automated contexts.',
          },
          isError: true,
        },
      };
    }

    securityLog(`${category}: mode=prompt, requesting user approval via SSE...`);
    const execEnv = sandboxed ? 'in Docker sandbox' : 'locally (no Docker sandbox)';
    const approved = await context.requestApproval(
      'code_execution',
      category,
      `Execute ${language} code ${execEnv}`,
      { code: code.slice(0, 2000), riskAnalysis: risk }
    );

    securityLog(`${category}: user approval result = ${approved}`);
    if (!approved) {
      return {
        allowed: false,
        error: {
          content: { error: `${category} execution rejected by user.` },
          isError: true,
        },
      };
    }
  }

  // 'allowed' or approved 'prompt' → proceed
  securityLog(`${category}: ALLOWED (mode=${mode})`);
  return { allowed: true };
}

// ============================================================================
// EXECUTE JAVASCRIPT TOOL
// ============================================================================

export const executeJavaScriptTool: ToolDefinition = {
  name: 'execute_javascript',
  brief: 'Run JavaScript/Node.js code',
  description:
    'Execute JavaScript/Node.js code. Uses Docker sandbox when available, or runs locally with user approval if EXECUTION_MODE allows.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (max 30000)',
        default: 10000,
      },
    },
    required: ['code'],
  },
};

export const executeJavaScriptExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  const { mode } = resolveExecutionConfig(context);
  // Skip Docker check entirely when mode is 'local' (avoids 5s timeout)
  const dockerReady = mode === 'local' ? false : await isDockerAvailable();

  // Local execution path (when Docker is not available or mode is 'local')
  if (mode === 'local' || (mode === 'auto' && !dockerReady)) {
    const permCheck = await checkExecutionPermission(
      'execute_javascript',
      code,
      'javascript',
      context,
      false
    );
    if (!permCheck.allowed) return permCheck.error!;
    const localResult = await executeJavaScriptLocal(code, { timeout });
    logSandboxExecution({
      tool: 'execute_javascript',
      language: 'javascript',
      sandboxed: false,
      codePreview: code.slice(0, 100),
      exitCode: localResult.exitCode,
      durationMs: Date.now() - startTime,
      success: localResult.success,
      error: localResult.error,
      timedOut: localResult.timedOut,
    });
    return formatLocalResult(localResult, 'javascript');
  }

  // Docker-only mode but Docker not available
  if (mode === 'docker' && !dockerReady) {
    logSandboxExecution({
      tool: 'execute_javascript',
      language: 'javascript',
      sandboxed: false,
      codePreview: code.slice(0, 100),
      exitCode: null,
      durationMs: Date.now() - startTime,
      success: false,
      error: 'Docker not available',
    });
    return { content: DOCKER_REQUIRED_ERROR, isError: true };
  }

  // Permission check applies to Docker sandbox too
  const permCheck = await checkExecutionPermission(
    'execute_javascript',
    code,
    'javascript',
    context,
    true
  );
  if (!permCheck.allowed) return permCheck.error!;

  // Docker execution path
  const result = await executeJavaScriptSandbox(code, {
    timeout,
    relaxedSecurity: DOCKER_RELAXED_SECURITY,
  });
  const durationMs = Date.now() - startTime;

  // Log sandbox execution
  logSandboxExecution({
    tool: 'execute_javascript',
    language: 'javascript',
    sandboxed: true,
    dockerImage: 'node:20-slim',
    codePreview: code.slice(0, 100),
    exitCode: result.exitCode,
    durationMs,
    success: result.success,
    error: result.error,
    timedOut: result.timedOut,
  });

  return {
    content: {
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      exitCode: result.exitCode,
      sandboxed: true,
      dockerImage: 'node:20-slim',
      relaxedSecurity: DOCKER_RELAXED_SECURITY,
      error: result.error,
    },
    isError: !result.success,
  };
};

// ============================================================================
// EXECUTE PYTHON TOOL
// ============================================================================

export const executePythonTool: ToolDefinition = {
  name: 'execute_python',
  brief: 'Run Python code',
  description:
    'Execute Python code. Uses Docker sandbox when available, or runs locally with user approval if EXECUTION_MODE allows.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (max 30000)',
        default: 10000,
      },
    },
    required: ['code'],
  },
};

export const executePythonExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  const { mode } = resolveExecutionConfig(context);
  const dockerReady = mode === 'local' ? false : await isDockerAvailable();

  // Local execution path
  if (mode === 'local' || (mode === 'auto' && !dockerReady)) {
    const permCheck = await checkExecutionPermission(
      'execute_python',
      code,
      'python',
      context,
      false
    );
    if (!permCheck.allowed) return permCheck.error!;
    const localResult = await executePythonLocal(code, { timeout });
    logSandboxExecution({
      tool: 'execute_python',
      language: 'python',
      sandboxed: false,
      codePreview: code.slice(0, 100),
      exitCode: localResult.exitCode,
      durationMs: Date.now() - startTime,
      success: localResult.success,
      error: localResult.error,
      timedOut: localResult.timedOut,
    });
    return formatLocalResult(localResult, 'python');
  }

  // Docker-only mode but Docker not available
  if (mode === 'docker' && !dockerReady) {
    logSandboxExecution({
      tool: 'execute_python',
      language: 'python',
      sandboxed: false,
      codePreview: code.slice(0, 100),
      exitCode: null,
      durationMs: Date.now() - startTime,
      success: false,
      error: 'Docker not available',
    });
    return { content: DOCKER_REQUIRED_ERROR, isError: true };
  }

  // Permission check applies to Docker sandbox too
  const permCheck = await checkExecutionPermission('execute_python', code, 'python', context, true);
  if (!permCheck.allowed) return permCheck.error!;

  // Docker execution path
  const result = await executePythonSandbox(code, {
    timeout,
    relaxedSecurity: DOCKER_RELAXED_SECURITY,
  });
  const durationMs = Date.now() - startTime;

  // Log sandbox execution
  logSandboxExecution({
    tool: 'execute_python',
    language: 'python',
    sandboxed: true,
    dockerImage: 'python:3.11-slim',
    codePreview: code.slice(0, 100),
    exitCode: result.exitCode,
    durationMs,
    success: result.success,
    error: result.error,
    timedOut: result.timedOut,
  });

  return {
    content: {
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      exitCode: result.exitCode,
      sandboxed: true,
      dockerImage: 'python:3.11-slim',
      relaxedSecurity: DOCKER_RELAXED_SECURITY,
      error: result.error,
    },
    isError: !result.success,
  };
};

// ============================================================================
// EXECUTE SHELL COMMAND TOOL
// ============================================================================

export const executeShellTool: ToolDefinition = {
  name: 'execute_shell',
  brief: 'Run shell commands',
  description:
    'Execute a shell command. Uses Docker sandbox when available, or runs locally with user approval if EXECUTION_MODE allows. Blocked commands include: rm -rf /, mkfs, dd if=/dev, fork bombs, chmod -R 777 /, shutdown/reboot/halt, format c:, and similar destructive operations.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (max 30000)',
        default: 10000,
      },
    },
    required: ['command'],
  },
};

export const executeShellExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const command = params.command as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  // Security: Block dangerous commands (centralized in security/index.ts)
  if (isCommandBlocked(command)) {
    logSandboxExecution({
      tool: 'execute_shell',
      language: 'shell',
      sandboxed: false,
      command,
      exitCode: null,
      durationMs: Date.now() - startTime,
      success: false,
      error: 'Command blocked for security reasons',
    });
    return {
      content: { error: 'This command is blocked for security reasons' },
      isError: true,
    };
  }

  const { mode } = resolveExecutionConfig(context);
  const dockerReady = mode === 'local' ? false : await isDockerAvailable();

  // Local execution path
  if (mode === 'local' || (mode === 'auto' && !dockerReady)) {
    const permCheck = await checkExecutionPermission(
      'execute_shell',
      command,
      'shell',
      context,
      false
    );
    if (!permCheck.allowed) return permCheck.error!;
    const localResult = await executeShellLocal(command, { timeout });
    logSandboxExecution({
      tool: 'execute_shell',
      language: 'shell',
      sandboxed: false,
      command,
      exitCode: localResult.exitCode,
      durationMs: Date.now() - startTime,
      success: localResult.success,
      error: localResult.error,
      timedOut: localResult.timedOut,
    });
    return formatLocalResult(localResult, 'shell');
  }

  // Docker-only mode but Docker not available
  if (mode === 'docker' && !dockerReady) {
    logSandboxExecution({
      tool: 'execute_shell',
      language: 'shell',
      sandboxed: false,
      command,
      exitCode: null,
      durationMs: Date.now() - startTime,
      success: false,
      error: 'Docker not available',
    });
    return { content: DOCKER_REQUIRED_ERROR, isError: true };
  }

  // Permission check applies to Docker sandbox too
  const shellPermCheck = await checkExecutionPermission(
    'execute_shell',
    command,
    'shell',
    context,
    true
  );
  if (!shellPermCheck.allowed) return shellPermCheck.error!;

  // Execute in Docker sandbox
  const result = await executeShellSandbox(command, {
    timeout,
    relaxedSecurity: DOCKER_RELAXED_SECURITY,
  });
  const durationMs = Date.now() - startTime;

  // Log sandbox execution
  logSandboxExecution({
    tool: 'execute_shell',
    language: 'shell',
    sandboxed: true,
    dockerImage: 'alpine:latest',
    command,
    exitCode: result.exitCode,
    durationMs,
    success: result.success,
    error: result.error,
    timedOut: result.timedOut,
  });

  return {
    content: {
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      exitCode: result.exitCode,
      sandboxed: true,
      dockerImage: 'alpine:latest',
      relaxedSecurity: DOCKER_RELAXED_SECURITY,
      error: result.error,
    },
    isError: !result.success,
  };
};

// ============================================================================
// COMPILE CODE TOOL (Disabled - requires host access)
// ============================================================================

export const compileCodeTool: ToolDefinition = {
  name: 'compile_code',
  brief: 'Compile source code',
  description:
    'Compile source code using a specified compiler. Requires local execution mode (no Docker sandbox). Supported compilers: tsc, gcc, g++, rustc, go, javac.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the source file to compile',
      },
      compiler: {
        type: 'string',
        description: 'Compiler to use',
        enum: ['tsc', 'gcc', 'g++', 'rustc', 'go', 'javac'],
      },
      args: {
        type: 'string',
        description: 'Additional compiler arguments (e.g., "-o output", "--outDir dist")',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (max 60000)',
        default: 30000,
      },
    },
    required: ['filePath'],
  },
};

/** Allowed compilers — prevents arbitrary command injection */
const ALLOWED_COMPILERS = new Set(['tsc', 'gcc', 'g++', 'rustc', 'go', 'javac']);

export const compileCodeExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const filePath = params.filePath as string;
  const compiler = (params.compiler as string) || 'tsc';
  const extraArgs = (params.args as string) || '';
  const timeout = Math.min((params.timeout as number) || 30000, 60000);
  const startTime = Date.now();

  if (!ALLOWED_COMPILERS.has(compiler)) {
    return {
      content: {
        error: `Unknown compiler: ${compiler}. Allowed: ${[...ALLOWED_COMPILERS].join(', ')}`,
      },
      isError: true,
    };
  }

  const { mode } = resolveExecutionConfig(context);

  // Compilation requires local access — Docker can't access host files
  if (mode === 'docker') {
    return {
      content: {
        error: 'compile_code requires local execution mode.',
        reason: 'Docker sandbox cannot access host filesystem for compilation.',
        solution: 'Set execution mode to "Auto" or "Local" in the Execution Security panel.',
      },
      isError: true,
    };
  }

  // Build the compile command
  let command: string;
  if (compiler === 'go') {
    command = `go build ${extraArgs} ${filePath}`.trim();
  } else {
    command = `${compiler} ${extraArgs} ${filePath}`.trim();
  }

  const permCheck = await checkExecutionPermission('compile_code', command, 'shell', context);
  if (!permCheck.allowed) return permCheck.error!;

  const localResult = await executeShellLocal(command, { timeout });
  logSandboxExecution({
    tool: 'compile_code',
    language: 'shell',
    sandboxed: false,
    command,
    exitCode: localResult.exitCode,
    durationMs: Date.now() - startTime,
    success: localResult.success,
    error: localResult.error,
    timedOut: localResult.timedOut,
  });

  return {
    content: {
      stdout: truncateOutput(localResult.stdout),
      stderr: truncateOutput(localResult.stderr),
      exitCode: localResult.exitCode,
      compiler,
      filePath,
      sandboxed: false,
      executionMode: 'local',
      error: localResult.error,
    },
    isError: !localResult.success,
  };
};

// ============================================================================
// NPM/PACKAGE MANAGER TOOL (Disabled - requires host access)
// ============================================================================

export const packageManagerTool: ToolDefinition = {
  name: 'package_manager',
  brief: 'Run package manager commands',
  description:
    'Run package manager commands (npm, yarn, pnpm, pip). Requires local execution mode. Supports install, uninstall, update, list, run scripts, and other standard commands.',
  parameters: {
    type: 'object',
    properties: {
      manager: {
        type: 'string',
        description: 'Package manager to use',
        enum: ['npm', 'yarn', 'pnpm', 'pip'],
      },
      command: {
        type: 'string',
        description:
          'Subcommand to run (e.g., "install", "install lodash", "run build", "list --depth=0")',
      },
      timeout: {
        type: 'number',
        description:
          'Execution timeout in milliseconds (max 120000, default 60000). Package installations may need more time.',
        default: 60000,
      },
    },
    required: ['manager', 'command'],
  },
};

/** Allowed package managers — prevents arbitrary command injection */
const ALLOWED_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'pip']);

/** Package manager subcommands that are blocked for safety */
const BLOCKED_PM_SUBCOMMANDS = new Set([
  'publish', // Don't accidentally publish packages
  'unpublish', // Don't remove published packages
  'login', // Don't handle auth tokens
  'logout',
  'adduser',
  'token',
  'owner',
  'access',
]);

export const packageManagerExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const manager = params.manager as string;
  const subcommand = params.command as string;
  const timeout = Math.min((params.timeout as number) || 60000, 120000);
  const startTime = Date.now();

  if (!ALLOWED_MANAGERS.has(manager)) {
    return {
      content: {
        error: `Unknown package manager: ${manager}. Allowed: ${[...ALLOWED_MANAGERS].join(', ')}`,
      },
      isError: true,
    };
  }

  // Check for blocked subcommands
  const firstWord = subcommand.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstWord && BLOCKED_PM_SUBCOMMANDS.has(firstWord)) {
    return {
      content: {
        error: `Subcommand '${firstWord}' is blocked for safety. Blocked: ${[...BLOCKED_PM_SUBCOMMANDS].join(', ')}`,
      },
      isError: true,
    };
  }

  const { mode } = resolveExecutionConfig(context);

  // Package management requires local access — Docker can't access host filesystem
  if (mode === 'docker') {
    return {
      content: {
        error: 'package_manager requires local execution mode.',
        reason: 'Docker sandbox cannot access host filesystem for package management.',
        solution: 'Set execution mode to "Auto" or "Local" in the Execution Security panel.',
      },
      isError: true,
    };
  }

  // Build the command
  const command = `${manager} ${subcommand}`.trim();

  const permCheck = await checkExecutionPermission('package_manager', command, 'shell', context);
  if (!permCheck.allowed) return permCheck.error!;

  const localResult = await executeShellLocal(command, { timeout });
  logSandboxExecution({
    tool: 'package_manager',
    language: 'shell',
    sandboxed: false,
    command,
    exitCode: localResult.exitCode,
    durationMs: Date.now() - startTime,
    success: localResult.success,
    error: localResult.error,
    timedOut: localResult.timedOut,
  });

  return {
    content: {
      stdout: truncateOutput(localResult.stdout),
      stderr: truncateOutput(localResult.stderr),
      exitCode: localResult.exitCode,
      manager,
      subcommand,
      sandboxed: false,
      executionMode: 'local',
      error: localResult.error,
    },
    isError: !localResult.success,
  };
};

// ============================================================================
// EXPORT ALL CODE EXECUTION TOOLS
// ============================================================================

export const CODE_EXECUTION_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: executeJavaScriptTool, executor: executeJavaScriptExecutor },
  { definition: executePythonTool, executor: executePythonExecutor },
  { definition: executeShellTool, executor: executeShellExecutor },
  { definition: compileCodeTool, executor: compileCodeExecutor },
  { definition: packageManagerTool, executor: packageManagerExecutor },
];

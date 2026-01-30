/**
 * Code Execution Tools
 * Safe code execution for Node.js, Python, and shell commands
 *
 * SECURITY: Code execution REQUIRES Docker sandbox for isolation.
 * Without Docker, ALL code execution is blocked - no exceptions.
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import {
  isDockerAvailable,
  executePythonSandbox,
  executeJavaScriptSandbox,
  executeShellSandbox,
} from '../../sandbox/docker.js';
import { logSandboxExecution } from '../debug.js';

// Environment flag to use relaxed Docker security (bypasses --no-new-privileges flag issues)
const DOCKER_RELAXED_SECURITY = process.env.DOCKER_SANDBOX_RELAXED_SECURITY === 'true';

// Security: Maximum execution time (30 seconds)
const MAX_EXECUTION_TIME = 30000;

// Security: Maximum output size (1MB)
const MAX_OUTPUT_SIZE = 1024 * 1024;

// Security: Blocked shell commands
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=/dev',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  // Windows dangerous commands
  'format c:',
  'del /f /s /q c:\\',
  'rd /s /q c:\\',
];

/**
 * Check if command is blocked
 */
function isBlockedCommand(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  return BLOCKED_COMMANDS.some((blocked) => lowerCommand.includes(blocked.toLowerCase()));
}

/**
 * Truncate output if too large
 */
function truncateOutput(output: string, maxSize: number = MAX_OUTPUT_SIZE): string {
  if (output.length <= maxSize) return output;
  const truncated = output.slice(0, maxSize);
  return truncated + `\n\n... [Output truncated at ${maxSize} bytes]`;
}

/**
 * Standard error message when Docker is not available
 */
const DOCKER_REQUIRED_ERROR = {
  error: 'Docker is REQUIRED for code execution. This is a security requirement and cannot be bypassed.',
  reason: 'Code execution without Docker sandbox would allow arbitrary code to run on the host system.',
  solution: 'Please install and start Docker: https://docs.docker.com/get-docker/',
  securityNote: 'This restriction exists to protect your system from malicious code.',
};

// ============================================================================
// EXECUTE JAVASCRIPT TOOL
// ============================================================================

export const executeJavaScriptTool: ToolDefinition = {
  name: 'execute_javascript',
  description: 'Execute JavaScript/Node.js code in a Docker sandboxed environment. Requires Docker to be running.',
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

export const executeJavaScriptExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  // SECURITY: Docker is MANDATORY - no exceptions
  const dockerReady = await isDockerAvailable();
  if (!dockerReady) {
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
    return {
      content: DOCKER_REQUIRED_ERROR,
      isError: true,
    };
  }

  // Execute in Docker sandbox
  const result = await executeJavaScriptSandbox(code, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
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
  description: 'Execute Python code in a Docker sandboxed environment. Requires Docker to be running.',
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

export const executePythonExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const code = params.code as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  // SECURITY: Docker is MANDATORY - no exceptions
  const dockerReady = await isDockerAvailable();
  if (!dockerReady) {
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
    return {
      content: DOCKER_REQUIRED_ERROR,
      isError: true,
    };
  }

  // Execute in Docker sandbox
  const result = await executePythonSandbox(code, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
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
  description: 'Execute a shell command in a Docker sandboxed environment. Requires Docker to be running. Blocked commands include: rm -rf /, mkfs, dd if=/dev, fork bombs, chmod -R 777 /, shutdown/reboot/halt, format c:, and similar destructive operations.',
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

export const executeShellExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const command = params.command as string;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);
  const startTime = Date.now();

  // Security: Block dangerous commands
  if (isBlockedCommand(command)) {
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

  // SECURITY: Docker is MANDATORY - no exceptions
  const dockerReady = await isDockerAvailable();
  if (!dockerReady) {
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
    return {
      content: DOCKER_REQUIRED_ERROR,
      isError: true,
    };
  }

  // Execute in Docker sandbox
  const result = await executeShellSandbox(command, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
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
  description: 'Compile source code. Currently disabled for security - use Docker-based build tools instead.',
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
    },
    required: ['filePath'],
  },
};

export const compileCodeExecutor: ToolExecutor = async (_params, _context): Promise<ToolExecutionResult> => {
  // Compilation requires host access - disabled for security
  return {
    content: {
      error: 'compile_code is disabled for security reasons.',
      reason: 'Compilation requires direct host system access which bypasses sandbox isolation.',
      alternative: 'Use execute_shell with Docker to run build commands, or use a CI/CD pipeline.',
    },
    isError: true,
  };
};

// ============================================================================
// NPM/PACKAGE MANAGER TOOL (Disabled - requires host access)
// ============================================================================

export const packageManagerTool: ToolDefinition = {
  name: 'package_manager',
  description: 'Run package manager commands. Currently disabled for security - use Docker-based build tools instead.',
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
        description: 'Command to run',
      },
    },
    required: ['manager', 'command'],
  },
};

export const packageManagerExecutor: ToolExecutor = async (_params, _context): Promise<ToolExecutionResult> => {
  // Package managers require host access - disabled for security
  return {
    content: {
      error: 'package_manager is disabled for security reasons.',
      reason: 'Package managers require direct host system access which bypasses sandbox isolation.',
      alternative: 'Use execute_shell with Docker to run package manager commands in a container.',
    },
    isError: true,
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

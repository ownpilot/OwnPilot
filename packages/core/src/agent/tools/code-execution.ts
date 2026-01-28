/**
 * Code Execution Tools
 * Safe code execution for Node.js, Python, and shell commands
 *
 * SECURITY: Code execution requires Docker sandbox for isolation.
 * Without Docker, execution is blocked for security reasons.
 */

import { spawn, exec, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import {
  isDockerAvailable,
  executePythonSandbox,
  executeJavaScriptSandbox,
  executeShellSandbox,
} from '../../sandbox/docker.js';

const execAsync = promisify(exec);

// Environment flag to allow unsafe execution (for development only!)
const ALLOW_UNSAFE_EXECUTION = process.env.ALLOW_UNSAFE_CODE_EXECUTION === 'true';

// Environment flag to use relaxed Docker security (bypasses --no-new-privileges flag issues)
const DOCKER_RELAXED_SECURITY = process.env.DOCKER_SANDBOX_RELAXED_SECURITY === 'true';

// Security: Maximum execution time (30 seconds)
const MAX_EXECUTION_TIME = 30000;

// Security: Maximum output size (1MB)
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Get allowed working directories (evaluated at runtime)
 * @param workspaceDir Optional workspace directory override from context
 */
function getAllowedWorkDirs(workspaceDir?: string): string[] {
  return [
    workspaceDir ?? process.env.WORKSPACE_DIR ?? process.cwd(),
    os.tmpdir(),
  ];
}

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
];

/**
 * Check if working directory is allowed
 * @param dir Directory to check
 * @param workspaceDir Optional workspace directory override from context
 */
function isAllowedWorkDir(dir: string, workspaceDir?: string): boolean {
  const normalizedDir = path.resolve(dir);
  const allowedDirs = getAllowedWorkDirs(workspaceDir);
  return allowedDirs.some((allowed: string) => {
    const normalizedAllowed = path.resolve(allowed);
    return normalizedDir === normalizedAllowed || normalizedDir.startsWith(normalizedAllowed + path.sep);
  });
}

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
 * Helper to safely run a child process with timeout
 */
function runProcess(
  child: ChildProcess,
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode: number | null) => {
      clearTimeout(timeoutId);
      if (killed) {
        resolve({
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
          exitCode,
          error: 'Process killed due to timeout',
        });
      } else {
        resolve({
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
          exitCode,
        });
      }
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode: null,
        error: error.message,
      });
    });
  });
}

// ============================================================================
// EXECUTE JAVASCRIPT TOOL
// ============================================================================

export const executeJavaScriptTool: ToolDefinition = {
  name: 'execute_javascript',
  description: 'Execute JavaScript/Node.js code in a sandboxed environment. Returns stdout, stderr, and execution result.',
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

  // Try Docker sandbox first (secure)
  const dockerReady = await isDockerAvailable();
  if (dockerReady) {
    const result = await executeJavaScriptSandbox(code, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
    return {
      content: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        sandboxed: true,
        relaxedSecurity: DOCKER_RELAXED_SECURITY,
        error: result.error,
      },
      isError: !result.success,
    };
  }

  // No Docker - check if unsafe execution is allowed
  if (!ALLOW_UNSAFE_EXECUTION) {
    return {
      content: {
        error: 'Code execution requires Docker for security isolation. Please install Docker or set ALLOW_UNSAFE_CODE_EXECUTION=true (development only).',
        hint: 'Install Docker: https://docs.docker.com/get-docker/',
      },
      isError: true,
    };
  }

  // Unsafe fallback (only if explicitly enabled)
  console.warn('[SECURITY] Executing JavaScript code without sandbox isolation!');

  // Create temp file for code
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `exec_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);

  try {
    // Wrap code to capture result
    const wrappedCode = `
const __originalConsoleLog = console.log;
const __logs = [];
console.log = (...args) => {
  __logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
  __originalConsoleLog(...args);
};

try {
  const __result = await (async () => {
    ${code}
  })();

  console.log = __originalConsoleLog;
  console.log(JSON.stringify({
    success: true,
    result: __result,
    logs: __logs
  }));
} catch (error) {
  console.log = __originalConsoleLog;
  console.log(JSON.stringify({
    success: false,
    error: error.message,
    stack: error.stack,
    logs: __logs
  }));
}
`;

    await fs.writeFile(tempFile, wrappedCode, 'utf-8');

    const child = spawn('node', ['--experimental-vm-modules', tempFile], {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_ENV: 'sandbox',
      },
    });

    const result = await runProcess(child, timeout);

    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    if (result.error) {
      return {
        content: { error: result.error, stdout: result.stdout, stderr: result.stderr, sandboxed: false },
        isError: true,
      };
    }

    try {
      const parsed = JSON.parse(result.stdout.trim());
      return {
        content: {
          result: parsed.result,
          logs: parsed.logs,
          error: parsed.error,
          exitCode: result.exitCode,
          sandboxed: false,
        },
        isError: !parsed.success,
      };
    } catch {
      return {
        content: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          sandboxed: false,
        },
        isError: result.exitCode !== 0,
      };
    }
  } catch (error) {
    return {
      content: { error: error instanceof Error ? error.message : 'Unknown error' },
      isError: true,
    };
  }
};

// ============================================================================
// EXECUTE PYTHON TOOL
// ============================================================================

export const executePythonTool: ToolDefinition = {
  name: 'execute_python',
  description: 'Execute Python code. Returns stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute',
      },
      pythonPath: {
        type: 'string',
        description: 'Path to Python executable (default: python3 or python)',
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
  const pythonPath = params.pythonPath as string | undefined;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);

  // Try Docker sandbox first (secure)
  const dockerReady = await isDockerAvailable();
  if (dockerReady) {
    const result = await executePythonSandbox(code, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
    return {
      content: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        sandboxed: true,
        relaxedSecurity: DOCKER_RELAXED_SECURITY,
        error: result.error,
      },
      isError: !result.success,
    };
  }

  // No Docker - check if unsafe execution is allowed
  if (!ALLOW_UNSAFE_EXECUTION) {
    return {
      content: {
        error: 'Code execution requires Docker for security isolation. Please install Docker or set ALLOW_UNSAFE_CODE_EXECUTION=true (development only).',
        hint: 'Install Docker: https://docs.docker.com/get-docker/',
      },
      isError: true,
    };
  }

  // Unsafe fallback (only if explicitly enabled)
  console.warn('[SECURITY] Executing Python code without sandbox isolation!');

  // Find Python executable
  const python = pythonPath || (process.platform === 'win32' ? 'python' : 'python3');

  // Create temp file for code
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `exec_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

  try {
    await fs.writeFile(tempFile, code, 'utf-8');

    const child = spawn(python, [tempFile], {
      cwd: tempDir,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });

    const result = await runProcess(child, timeout);

    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    if (result.error) {
      return {
        content: {
          error: result.error,
          stdout: result.stdout,
          stderr: result.stderr,
          sandboxed: false,
          hint: 'Make sure Python is installed and available in PATH',
        },
        isError: true,
      };
    }

    return {
      content: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        sandboxed: false,
      },
      isError: result.exitCode !== 0,
    };
  } catch (error) {
    return {
      content: { error: error instanceof Error ? error.message : 'Unknown error' },
      isError: true,
    };
  }
};

// ============================================================================
// EXECUTE SHELL COMMAND TOOL
// ============================================================================

export const executeShellTool: ToolDefinition = {
  name: 'execute_shell',
  description: 'Execute a shell command. Use with caution - some dangerous commands are blocked.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
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

export const executeShellExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const command = params.command as string;
  const cwd = params.cwd as string | undefined;
  const timeout = Math.min((params.timeout as number) || 10000, MAX_EXECUTION_TIME);

  // Security checks
  if (isBlockedCommand(command)) {
    return {
      content: { error: 'This command is blocked for security reasons' },
      isError: true,
    };
  }

  // Try Docker sandbox first (secure)
  const dockerReady = await isDockerAvailable();
  if (dockerReady) {
    const result = await executeShellSandbox(command, { timeout, relaxedSecurity: DOCKER_RELAXED_SECURITY });
    return {
      content: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        sandboxed: true,
        relaxedSecurity: DOCKER_RELAXED_SECURITY,
        error: result.error,
      },
      isError: !result.success,
    };
  }

  // No Docker - check if unsafe execution is allowed
  if (!ALLOW_UNSAFE_EXECUTION) {
    return {
      content: {
        error: 'Shell execution requires Docker for security isolation. Please install Docker or set ALLOW_UNSAFE_CODE_EXECUTION=true (development only).',
        hint: 'Install Docker: https://docs.docker.com/get-docker/',
      },
      isError: true,
    };
  }

  // Unsafe fallback (only if explicitly enabled)
  console.warn('[SECURITY] Executing shell command without sandbox isolation!');

  const workDir = cwd || context.workspaceDir || process.cwd();
  if (!isAllowedWorkDir(workDir, context.workspaceDir)) {
    return {
      content: { error: `Working directory not allowed: ${workDir}` },
      isError: true,
    };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: MAX_OUTPUT_SIZE,
      cwd: workDir,
      env: process.env,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    });

    return {
      content: {
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        sandboxed: false,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      content: {
        stdout: truncateOutput(execError.stdout || ''),
        stderr: truncateOutput(execError.stderr || ''),
        error: execError.message,
        exitCode: execError.code,
        sandboxed: false,
      },
      isError: true,
    };
  }
};

// ============================================================================
// COMPILE CODE TOOL
// ============================================================================

export const compileCodeTool: ToolDefinition = {
  name: 'compile_code',
  description: 'Compile source code using appropriate compiler (TypeScript, C/C++, Rust, Go, etc.)',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the source file to compile',
      },
      outputPath: {
        type: 'string',
        description: 'Path for the compiled output (optional)',
      },
      compiler: {
        type: 'string',
        description: 'Compiler to use (auto-detected if not specified)',
        enum: ['tsc', 'gcc', 'g++', 'rustc', 'go', 'javac'],
      },
      flags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional compiler flags',
      },
    },
    required: ['filePath'],
  },
};

function detectCompiler(ext: string): string | null {
  const compilerMap: Record<string, string> = {
    '.ts': 'tsc',
    '.tsx': 'tsc',
    '.c': 'gcc',
    '.cpp': 'g++',
    '.cc': 'g++',
    '.cxx': 'g++',
    '.rs': 'rustc',
    '.go': 'go',
    '.java': 'javac',
  };
  return compilerMap[ext] || null;
}

export const compileCodeExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const filePath = params.filePath as string;
  const outputPath = params.outputPath as string | undefined;
  const compiler = params.compiler as string | undefined;
  const flags = (params.flags as string[]) || [];

  // Determine compiler from file extension if not specified
  const ext = path.extname(filePath).toLowerCase();
  let cmd: string;
  let args: string[];

  const detectedCompiler = compiler || detectCompiler(ext);

  if (!detectedCompiler) {
    return {
      content: {
        error: `Unknown compiler for extension: ${ext}`,
        hint: 'Specify the compiler explicitly using the compiler parameter',
      },
      isError: true,
    };
  }

  switch (detectedCompiler) {
    case 'tsc':
      cmd = 'npx';
      args = ['tsc', filePath, ...flags];
      if (outputPath) args.push('--outDir', path.dirname(outputPath));
      break;

    case 'gcc':
      cmd = 'gcc';
      args = [filePath, '-o', outputPath || filePath.replace(ext, ''), ...flags];
      break;

    case 'g++':
      cmd = 'g++';
      args = [filePath, '-o', outputPath || filePath.replace(ext, ''), ...flags];
      break;

    case 'rustc':
      cmd = 'rustc';
      args = [filePath, '-o', outputPath || filePath.replace(ext, ''), ...flags];
      break;

    case 'go':
      cmd = 'go';
      args = ['build', '-o', outputPath || filePath.replace(ext, ''), filePath, ...flags];
      break;

    case 'javac':
      cmd = 'javac';
      args = [filePath, ...flags];
      if (outputPath) args.push('-d', path.dirname(outputPath));
      break;

    default:
      return {
        content: {
          error: `Unknown compiler: ${detectedCompiler}`,
          hint: 'Specify the compiler explicitly using the compiler parameter',
        },
        isError: true,
      };
  }

  try {
    const child = spawn(cmd, args, {
      cwd: path.dirname(filePath),
    });

    const result = await runProcess(child, MAX_EXECUTION_TIME);

    if (result.error) {
      return {
        content: {
          compiler: detectedCompiler,
          error: result.error,
          hint: `Make sure ${detectedCompiler} is installed and available in PATH`,
        },
        isError: true,
      };
    }

    return {
      content: {
        compiler: detectedCompiler,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        outputPath: outputPath || (result.exitCode === 0 ? filePath.replace(ext, '') : undefined),
      },
      isError: result.exitCode !== 0,
    };
  } catch (error) {
    return {
      content: { error: error instanceof Error ? error.message : 'Unknown error' },
      isError: true,
    };
  }
};

// ============================================================================
// NPM/PACKAGE MANAGER TOOL
// ============================================================================

export const packageManagerTool: ToolDefinition = {
  name: 'package_manager',
  description: 'Run package manager commands (npm, yarn, pnpm, pip)',
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
        description: 'Command to run (install, add, remove, update, list, etc.)',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Package names (for install/add/remove)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
      flags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional flags',
      },
    },
    required: ['manager', 'command'],
  },
};

export const packageManagerExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const manager = params.manager as string;
  const command = params.command as string;
  const packages = (params.packages as string[]) || [];
  const cwd = params.cwd as string | undefined;
  const flags = (params.flags as string[]) || [];

  const workDir = cwd || context.workspaceDir || process.cwd();
  if (!isAllowedWorkDir(workDir, context.workspaceDir)) {
    return {
      content: { error: `Working directory not allowed: ${workDir}` },
      isError: true,
    };
  }

  // Build command args
  let args: string[];

  switch (manager) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
    case 'pip':
      args = [command, ...packages, ...flags];
      break;
    default:
      return {
        content: { error: `Unknown package manager: ${manager}` },
        isError: true,
      };
  }

  try {
    const child = spawn(manager, args, {
      cwd: workDir,
      env: process.env,
      shell: true,
    });

    const result = await runProcess(child, MAX_EXECUTION_TIME * 2); // Give more time for package installs

    if (result.error) {
      return {
        content: {
          manager,
          command,
          error: result.error,
          hint: `Make sure ${manager} is installed and available in PATH`,
        },
        isError: true,
      };
    }

    return {
      content: {
        manager,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      isError: result.exitCode !== 0,
    };
  } catch (error) {
    return {
      content: { error: error instanceof Error ? error.message : 'Unknown error' },
      isError: true,
    };
  }
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

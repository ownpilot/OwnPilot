/**
 * Tests for code-execution.ts
 * Covers all 5 executors: JS, Python, Shell, Compile, PackageManager
 * Tests permission checks, Docker/local dispatch, error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock functions ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  isDockerAvailable: vi.fn().mockResolvedValue(false),
  executePythonSandbox: vi.fn(),
  executeJavaScriptSandbox: vi.fn(),
  executeShellSandbox: vi.fn(),
  getExecutionMode: vi.fn().mockReturnValue('auto' as const),
  executeJavaScriptLocal: vi.fn(),
  executePythonLocal: vi.fn(),
  executeShellLocal: vi.fn(),
  checkCriticalPatterns: vi.fn().mockReturnValue({ blocked: false }),
  isCommandBlocked: vi.fn().mockReturnValue(false),
  analyzeCodeRisk: vi.fn().mockReturnValue({ riskLevel: 'low', reasons: [] }),
  logSandboxExecution: vi.fn(),
}));

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../sandbox/docker.js', () => ({
  isDockerAvailable: mocks.isDockerAvailable,
  executePythonSandbox: mocks.executePythonSandbox,
  executeJavaScriptSandbox: mocks.executeJavaScriptSandbox,
  executeShellSandbox: mocks.executeShellSandbox,
}));

vi.mock('../../sandbox/execution-mode.js', () => ({
  getExecutionMode: mocks.getExecutionMode,
}));

vi.mock('../../sandbox/local-executor.js', () => ({
  executeJavaScriptLocal: mocks.executeJavaScriptLocal,
  executePythonLocal: mocks.executePythonLocal,
  executeShellLocal: mocks.executeShellLocal,
}));

vi.mock('../../security/index.js', () => ({
  checkCriticalPatterns: mocks.checkCriticalPatterns,
  isCommandBlocked: mocks.isCommandBlocked,
}));

vi.mock('../../security/code-analyzer.js', () => ({
  analyzeCodeRisk: mocks.analyzeCodeRisk,
}));

vi.mock('../debug.js', () => ({
  logSandboxExecution: mocks.logSandboxExecution,
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import type { ToolContext } from '../tools.js';
import {
  executeJavaScriptTool,
  executeJavaScriptExecutor,
  executePythonTool,
  executePythonExecutor,
  executeShellTool,
  executeShellExecutor,
  compileCodeTool,
  compileCodeExecutor,
  packageManagerTool,
  packageManagerExecutor,
  CODE_EXECUTION_TOOLS,
} from './code-execution.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    userId: 'test-user',
    executionPermissions: {
      enabled: true,
      mode: 'auto',
      execute_javascript: 'allowed',
      execute_python: 'allowed',
      execute_shell: 'allowed',
      compile_code: 'allowed',
      package_manager: 'allowed',
    },
    ...overrides,
  } as ToolContext;
}

const successResult = {
  success: true,
  stdout: 'hello world',
  stderr: '',
  exitCode: 0,
  executionTimeMs: 50,
};

const dockerSuccessResult = {
  success: true,
  stdout: 'docker output',
  stderr: '',
  exitCode: 0,
  executionTimeMs: 100,
};

// ── Reset all mocks before each test ────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Restore defaults
  mocks.isDockerAvailable.mockResolvedValue(false);
  mocks.checkCriticalPatterns.mockReturnValue({ blocked: false });
  mocks.isCommandBlocked.mockReturnValue(false);
  mocks.analyzeCodeRisk.mockReturnValue({ riskLevel: 'low', reasons: [] });
  mocks.getExecutionMode.mockReturnValue('auto');
});

// ============================================================================
// Tool definitions
// ============================================================================

describe('Tool definitions', () => {
  it('executeJavaScriptTool has name, description, and parameters', () => {
    expect(executeJavaScriptTool.name).toBe('execute_javascript');
    expect(executeJavaScriptTool.description).toBeTruthy();
    expect(executeJavaScriptTool.parameters).toBeDefined();
    expect(executeJavaScriptTool.parameters.properties).toHaveProperty('code');
  });

  it('executePythonTool has name, description, and parameters', () => {
    expect(executePythonTool.name).toBe('execute_python');
    expect(executePythonTool.description).toBeTruthy();
    expect(executePythonTool.parameters).toBeDefined();
    expect(executePythonTool.parameters.properties).toHaveProperty('code');
  });

  it('executeShellTool has name, description, and parameters', () => {
    expect(executeShellTool.name).toBe('execute_shell');
    expect(executeShellTool.description).toBeTruthy();
    expect(executeShellTool.parameters).toBeDefined();
    expect(executeShellTool.parameters.properties).toHaveProperty('command');
  });

  it('compileCodeTool has name, description, and parameters', () => {
    expect(compileCodeTool.name).toBe('compile_code');
    expect(compileCodeTool.description).toBeTruthy();
    expect(compileCodeTool.parameters).toBeDefined();
    expect(compileCodeTool.parameters.properties).toHaveProperty('filePath');
    expect(compileCodeTool.parameters.properties).toHaveProperty('compiler');
  });

  it('packageManagerTool has name, description, and parameters', () => {
    expect(packageManagerTool.name).toBe('package_manager');
    expect(packageManagerTool.description).toBeTruthy();
    expect(packageManagerTool.parameters).toBeDefined();
    expect(packageManagerTool.parameters.properties).toHaveProperty('manager');
    expect(packageManagerTool.parameters.properties).toHaveProperty('command');
  });

  it('CODE_EXECUTION_TOOLS contains 5 entries', () => {
    expect(CODE_EXECUTION_TOOLS).toHaveLength(5);
    const names = CODE_EXECUTION_TOOLS.map((t) => t.definition.name);
    expect(names).toEqual([
      'execute_javascript',
      'execute_python',
      'execute_shell',
      'compile_code',
      'package_manager',
    ]);
  });
});

// ============================================================================
// executeJavaScriptExecutor
// ============================================================================

describe('executeJavaScriptExecutor', () => {
  it('calls executeJavaScriptLocal when Docker is unavailable in auto mode', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(successResult);

    await executeJavaScriptExecutor({ code: 'console.log("hi")' }, createContext());

    expect(mocks.executeJavaScriptLocal).toHaveBeenCalledWith('console.log("hi")', { timeout: 10000 });
    expect(mocks.isDockerAvailable).toHaveBeenCalled();
  });

  it('returns formatted local result with sandboxed=false', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(successResult);

    const result = await executeJavaScriptExecutor({ code: 'console.log("hi")' }, createContext());

    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
      sandboxed: false,
      executionMode: 'local',
      language: 'javascript',
    });
  });

  it('calls executeJavaScriptSandbox when Docker is available', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    mocks.executeJavaScriptSandbox.mockResolvedValue(dockerSuccessResult);

    await executeJavaScriptExecutor({ code: '1+1' }, createContext());

    expect(mocks.executeJavaScriptSandbox).toHaveBeenCalledWith('1+1', expect.objectContaining({ timeout: 10000 }));
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
  });

  it('returns Docker result with sandboxed=true', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    mocks.executeJavaScriptSandbox.mockResolvedValue(dockerSuccessResult);

    const result = await executeJavaScriptExecutor({ code: '1+1' }, createContext());

    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'docker output',
      sandboxed: true,
      dockerImage: 'node:20-slim',
    });
  });

  it('blocks when execution is disabled (enabled=false)', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: false,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
    expect(mocks.executeJavaScriptSandbox).not.toHaveBeenCalled();
  });

  it('blocks when category permission is "blocked"', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'blocked',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'execute_javascript is blocked in Execution Security settings.',
    });
  });

  it('returns Docker required error when mode=docker and Docker unavailable', async () => {
    mocks.isDockerAvailable.mockResolvedValue(false);

    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'Docker is required for code execution in this mode.',
    });
  });

  it('caps timeout at 30000ms', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(successResult);

    await executeJavaScriptExecutor({ code: 'x', timeout: 999999 }, createContext());

    expect(mocks.executeJavaScriptLocal).toHaveBeenCalledWith('x', { timeout: 30000 });
  });
});

// ============================================================================
// executePythonExecutor
// ============================================================================

describe('executePythonExecutor', () => {
  it('calls executePythonLocal when Docker is unavailable in auto mode', async () => {
    mocks.executePythonLocal.mockResolvedValue(successResult);

    const result = await executePythonExecutor({ code: 'print("hi")' }, createContext());

    expect(mocks.executePythonLocal).toHaveBeenCalledWith('print("hi")', { timeout: 10000 });
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'hello world',
      sandboxed: false,
      executionMode: 'local',
      language: 'python',
    });
  });

  it('calls executePythonSandbox when Docker is available', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    mocks.executePythonSandbox.mockResolvedValue(dockerSuccessResult);

    const result = await executePythonExecutor({ code: 'print("hi")' }, createContext());

    expect(mocks.executePythonSandbox).toHaveBeenCalledWith('print("hi")', expect.objectContaining({ timeout: 10000 }));
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'docker output',
      sandboxed: true,
      dockerImage: 'python:3.11-slim',
    });
  });

  it('blocks when execution is disabled', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: false,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executePythonExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
  });
});

// ============================================================================
// executeShellExecutor
// ============================================================================

describe('executeShellExecutor', () => {
  it('blocks dangerous commands via isCommandBlocked', async () => {
    mocks.isCommandBlocked.mockReturnValue(true);

    const result = await executeShellExecutor({ command: 'rm -rf /' }, createContext());

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'This command is blocked for security reasons',
    });
    expect(mocks.executeShellLocal).not.toHaveBeenCalled();
    expect(mocks.executeShellSandbox).not.toHaveBeenCalled();
  });

  it('calls executeShellLocal when Docker is unavailable', async () => {
    mocks.executeShellLocal.mockResolvedValue(successResult);

    const result = await executeShellExecutor({ command: 'echo hello' }, createContext());

    expect(mocks.executeShellLocal).toHaveBeenCalledWith('echo hello', { timeout: 10000 });
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'hello world',
      sandboxed: false,
      executionMode: 'local',
      language: 'shell',
    });
  });

  it('calls executeShellSandbox when Docker is available', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    mocks.executeShellSandbox.mockResolvedValue(dockerSuccessResult);

    const result = await executeShellExecutor({ command: 'ls -la' }, createContext());

    expect(mocks.executeShellSandbox).toHaveBeenCalledWith('ls -la', expect.objectContaining({ timeout: 10000 }));
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      stdout: 'docker output',
      sandboxed: true,
      dockerImage: 'alpine:latest',
    });
  });

  it('blocks when execution is disabled', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: false,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeShellExecutor({ command: 'echo hi' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
  });
});

// ============================================================================
// compileCodeExecutor
// ============================================================================

describe('compileCodeExecutor', () => {
  it('rejects unknown compiler', async () => {
    const result = await compileCodeExecutor(
      { filePath: 'main.xyz', compiler: 'unknown-compiler' },
      createContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: expect.stringContaining('Unknown compiler: unknown-compiler'),
    });
    expect(mocks.executeShellLocal).not.toHaveBeenCalled();
  });

  it('rejects docker mode (requires local access)', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await compileCodeExecutor(
      { filePath: 'main.go', compiler: 'go' },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'compile_code requires local execution mode.',
    });
  });

  it('builds correct command for go compiler', async () => {
    mocks.executeShellLocal.mockResolvedValue(successResult);

    const result = await compileCodeExecutor(
      { filePath: 'main.go', compiler: 'go', args: '-o output' },
      createContext(),
    );

    expect(mocks.executeShellLocal).toHaveBeenCalledWith(
      'go build -o output main.go',
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      compiler: 'go',
      filePath: 'main.go',
      sandboxed: false,
      executionMode: 'local',
    });
  });

  it('builds correct command for tsc compiler', async () => {
    mocks.executeShellLocal.mockResolvedValue(successResult);

    const result = await compileCodeExecutor(
      { filePath: 'index.ts', compiler: 'tsc', args: '--outDir dist' },
      createContext(),
    );

    expect(mocks.executeShellLocal).toHaveBeenCalledWith(
      'tsc --outDir dist index.ts',
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      compiler: 'tsc',
      filePath: 'index.ts',
    });
  });
});

// ============================================================================
// packageManagerExecutor
// ============================================================================

describe('packageManagerExecutor', () => {
  it('rejects unknown package manager', async () => {
    const result = await packageManagerExecutor(
      { manager: 'bun', command: 'install' },
      createContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: expect.stringContaining('Unknown package manager: bun'),
    });
  });

  it.each(['publish', 'unpublish', 'login', 'logout', 'adduser', 'token', 'owner', 'access'])(
    'blocks dangerous subcommand: %s',
    async (sub) => {
      const result = await packageManagerExecutor(
        { manager: 'npm', command: sub },
        createContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content).toMatchObject({
        error: expect.stringContaining(`Subcommand '${sub}' is blocked for safety`),
      });
    },
  );

  it('rejects docker mode (requires local access)', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await packageManagerExecutor(
      { manager: 'npm', command: 'install lodash' },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'package_manager requires local execution mode.',
    });
  });

  it('builds correct command and executes locally', async () => {
    mocks.executeShellLocal.mockResolvedValue(successResult);

    const result = await packageManagerExecutor(
      { manager: 'pnpm', command: 'install lodash' },
      createContext(),
    );

    expect(mocks.executeShellLocal).toHaveBeenCalledWith(
      'pnpm install lodash',
      expect.objectContaining({ timeout: 60000 }),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toMatchObject({
      manager: 'pnpm',
      subcommand: 'install lodash',
      sandboxed: false,
      executionMode: 'local',
    });
  });
});

// ============================================================================
// Permission checks (cross-cutting)
// ============================================================================

describe('Permission checks', () => {
  it('blocks when checkCriticalPatterns returns blocked', async () => {
    mocks.checkCriticalPatterns.mockReturnValue({
      blocked: true,
      reason: 'Destructive pattern detected',
    });
    mocks.executeJavaScriptLocal.mockResolvedValue(successResult);

    const result = await executeJavaScriptExecutor({ code: 'rm -rf /' }, createContext());

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'Blocked by security policy',
      reason: 'Destructive pattern detected',
      severity: 'critical',
    });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
  });

  it('blocks when category permission is "blocked"', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'blocked',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executePythonExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'execute_python is blocked in Execution Security settings.',
      currentLevel: 'blocked',
    });
  });

  it('prompts for approval when mode is "prompt" and requestApproval is provided', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    mocks.executeJavaScriptLocal.mockResolvedValue(successResult);

    const ctx = createContext({
      requestApproval,
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'prompt',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'console.log(1)' }, ctx);

    expect(requestApproval).toHaveBeenCalledWith(
      'code_execution',
      'execute_javascript',
      expect.stringContaining('Execute javascript code'),
      expect.objectContaining({ code: expect.any(String) }),
    );
    expect(result.isError).toBe(false);
    expect(mocks.executeJavaScriptLocal).toHaveBeenCalled();
  });

  it('blocks when mode is "prompt" but no requestApproval callback', async () => {
    const ctx = createContext({
      // no requestApproval
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'prompt',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: expect.stringContaining('requires approval but no approval channel available'),
    });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
  });

  it('blocks when user rejects approval in prompt mode', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);

    const ctx = createContext({
      requestApproval,
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'prompt',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });

    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: expect.stringContaining('execution rejected by user'),
    });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
  });
});

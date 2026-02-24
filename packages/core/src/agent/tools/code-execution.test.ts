/**
 * Tests for code-execution.ts
 * Covers the 4-layer permission system, Docker/local dispatch, error formats,
 * output truncation, and tool definitions.
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
  analyzeCodeRisk: vi.fn().mockReturnValue({ level: 'low', factors: [] }),
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

const localSuccess = {
  success: true,
  stdout: 'hello world',
  stderr: '',
  exitCode: 0,
};

const dockerSuccess = {
  success: true,
  stdout: 'docker output',
  stderr: '',
  exitCode: 0,
};

// ── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDockerAvailable.mockResolvedValue(false);
  mocks.checkCriticalPatterns.mockReturnValue({ blocked: false });
  mocks.isCommandBlocked.mockReturnValue(false);
  mocks.analyzeCodeRisk.mockReturnValue({ level: 'low', factors: [] });
  mocks.getExecutionMode.mockReturnValue('auto');
});

// ============================================================================
// 1. Tool definitions — correct names, required params, CODE_EXECUTION_TOOLS
// ============================================================================

describe('tool definitions', () => {
  it('should have correct names and required parameters', () => {
    expect(executeJavaScriptTool.name).toBe('execute_javascript');
    expect(executeJavaScriptTool.parameters.required).toContain('code');

    expect(executePythonTool.name).toBe('execute_python');
    expect(executePythonTool.parameters.required).toContain('code');

    expect(executeShellTool.name).toBe('execute_shell');
    expect(executeShellTool.parameters.required).toContain('command');
  });

  it('should export CODE_EXECUTION_TOOLS with all five tools', () => {
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
// 2. Master switch (enabled=false) blocks ALL execution
// ============================================================================

describe('master switch (enabled=false)', () => {
  const disabledPerms = {
    enabled: false as const,
    mode: 'auto' as const,
    execute_javascript: 'allowed' as const,
    execute_python: 'allowed' as const,
    execute_shell: 'allowed' as const,
    compile_code: 'allowed' as const,
    package_manager: 'allowed' as const,
  };

  it('should block JavaScript when master switch is off', async () => {
    const ctx = createContext({ executionPermissions: disabledPerms });
    const result = await executeJavaScriptExecutor({ code: 'x' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
    expect(mocks.executeJavaScriptSandbox).not.toHaveBeenCalled();
  });

  it('should block Python when master switch is off', async () => {
    const ctx = createContext({ executionPermissions: disabledPerms });
    const result = await executePythonExecutor({ code: 'x' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
  });

  it('should block shell when master switch is off', async () => {
    const ctx = createContext({ executionPermissions: disabledPerms });
    const result = await executeShellExecutor({ command: 'echo hi' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ error: 'Code execution is disabled.' });
  });
});

// ============================================================================
// 3. Layer 1 — Critical pattern blocking (always blocks, even if 'allowed')
// ============================================================================

describe('Layer 1: critical pattern blocking', () => {
  it('should block code matching critical patterns even when permission is allowed', async () => {
    mocks.checkCriticalPatterns.mockReturnValue({
      blocked: true,
      reason: 'Destructive command: rm -rf /',
    });
    mocks.executeJavaScriptLocal.mockResolvedValue(localSuccess);

    const ctx = createContext(); // all 'allowed'
    const result = await executeJavaScriptExecutor({ code: 'rm -rf /' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'Blocked by security policy',
      reason: 'Destructive command: rm -rf /',
      severity: 'critical',
    });
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
  });

  it('should block fork bombs via critical pattern check', async () => {
    mocks.checkCriticalPatterns.mockReturnValue({
      blocked: true,
      reason: 'Fork bomb detected',
    });

    const result = await executeShellExecutor({ command: ':(){ :|:& };:' }, createContext());
    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({ severity: 'critical' });
  });
});

// ============================================================================
// 4. Layer 3 — Per-category permission mode: 'blocked', 'prompt', 'allowed'
// ============================================================================

describe('Layer 3: per-category permission', () => {
  it('should block when execute_javascript is "blocked"', async () => {
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
      currentLevel: 'blocked',
    });
  });

  it('should block when execute_python is "blocked"', async () => {
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
    });
  });

  it('should block when execute_shell is "blocked"', async () => {
    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'blocked',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });
    const result = await executeShellExecutor({ command: 'ls' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'execute_shell is blocked in Execution Security settings.',
    });
  });
});

// ============================================================================
// 5. Layer 4 — Prompt mode: requestApproval callback
// ============================================================================

describe('Layer 4: prompt mode and user approval', () => {
  it('should block when mode="prompt" but no requestApproval callback exists', async () => {
    const ctx = createContext({
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

  it('should call requestApproval and proceed when user approves', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    mocks.executeJavaScriptLocal.mockResolvedValue(localSuccess);

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
      expect.objectContaining({ code: expect.any(String) })
    );
    expect(result.isError).toBe(false);
    expect(mocks.executeJavaScriptLocal).toHaveBeenCalled();
  });

  it('should block when user rejects the approval prompt', async () => {
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

  it('should pass risk analysis data to requestApproval', async () => {
    mocks.analyzeCodeRisk.mockReturnValue({ level: 'high', factors: ['network access'] });
    const requestApproval = vi.fn().mockResolvedValue(true);
    mocks.executeShellLocal.mockResolvedValue(localSuccess);

    const ctx = createContext({
      requestApproval,
      executionPermissions: {
        enabled: true,
        mode: 'auto',
        execute_shell: 'prompt',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });
    await executeShellExecutor({ command: 'curl http://example.com' }, ctx);

    expect(requestApproval).toHaveBeenCalledWith(
      'code_execution',
      'execute_shell',
      expect.any(String),
      expect.objectContaining({
        riskAnalysis: expect.objectContaining({ level: 'high' }),
      })
    );
  });
});

// ============================================================================
// 6. Docker vs local mode selection
// ============================================================================

describe('Docker vs local mode selection', () => {
  it('should use local executor when Docker is unavailable in auto mode', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(localSuccess);

    const result = await executeJavaScriptExecutor({ code: 'console.log("hi")' }, createContext());

    expect(mocks.isDockerAvailable).toHaveBeenCalled();
    expect(mocks.executeJavaScriptLocal).toHaveBeenCalledWith('console.log("hi")', {
      timeout: 10000,
    });
    expect(result.content).toMatchObject({ sandboxed: false, executionMode: 'local' });
  });

  it('should skip Docker check when mode is "local"', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(localSuccess);

    const ctx = createContext({
      executionPermissions: {
        enabled: true,
        mode: 'local',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      },
    });
    await executeJavaScriptExecutor({ code: 'x' }, ctx);

    expect(mocks.isDockerAvailable).not.toHaveBeenCalled();
    expect(mocks.executeJavaScriptLocal).toHaveBeenCalled();
  });

  it('should use Docker sandbox when Docker is available and mode is auto', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    mocks.executeJavaScriptSandbox.mockResolvedValue(dockerSuccess);

    const result = await executeJavaScriptExecutor({ code: '1+1' }, createContext());

    expect(mocks.executeJavaScriptSandbox).toHaveBeenCalled();
    expect(mocks.executeJavaScriptLocal).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({ sandboxed: true, dockerImage: 'node:20-slim' });
  });

  it('should return Docker required error when mode=docker and Docker unavailable', async () => {
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
    const result = await executePythonExecutor({ code: 'print(1)' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'Docker is required for code execution in this mode.',
    });
  });
});

// ============================================================================
// 7. Shell: isCommandBlocked
// ============================================================================

describe('shell: isCommandBlocked', () => {
  it('should block dangerous shell commands via isCommandBlocked', async () => {
    mocks.isCommandBlocked.mockReturnValue(true);

    const result = await executeShellExecutor({ command: 'rm -rf /' }, createContext());

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      error: 'This command is blocked for security reasons',
    });
    expect(mocks.executeShellLocal).not.toHaveBeenCalled();
    expect(mocks.executeShellSandbox).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 8. Error format validation
// ============================================================================

describe('error format', () => {
  it('execution disabled error should include solution field', async () => {
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
    const content = result.content as Record<string, unknown>;
    expect(content.error).toBe('Code execution is disabled.');
    expect(content.solution).toContain('Execution Security panel');
  });

  it('Docker required error should include reason and securityNote', async () => {
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
    const result = await executeShellExecutor({ command: 'ls' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toBe('Docker is required for code execution in this mode.');
    expect(content.reason).toBeTruthy();
    expect(content.securityNote).toBeTruthy();
    expect(content.solution).toContain('Set execution mode');
  });
});

// ============================================================================
// 9. Output truncation for large outputs
// ============================================================================

describe('output truncation', () => {
  it('should truncate large stdout from local execution', async () => {
    const bigOutput = 'x'.repeat(2 * 1024 * 1024); // 2 MB
    mocks.executeJavaScriptLocal.mockResolvedValue({
      stdout: bigOutput,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await executeJavaScriptExecutor({ code: 'big()' }, createContext());
    const content = result.content as Record<string, unknown>;
    const stdout = content.stdout as string;

    expect(stdout.length).toBeLessThan(bigOutput.length);
    expect(stdout).toContain('Output truncated at');
  });

  it('should truncate large stderr from Docker execution', async () => {
    mocks.isDockerAvailable.mockResolvedValue(true);
    const bigStderr = 'e'.repeat(2 * 1024 * 1024);
    mocks.executePythonSandbox.mockResolvedValue({
      stdout: '',
      stderr: bigStderr,
      exitCode: 1,
      success: false,
    });

    const result = await executePythonExecutor({ code: 'bad()' }, createContext());
    const content = result.content as Record<string, unknown>;
    const stderr = content.stderr as string;

    expect(stderr.length).toBeLessThan(bigStderr.length);
    expect(stderr).toContain('Output truncated at');
  });

  it('should not truncate output within the limit', async () => {
    const smallOutput = 'short output';
    mocks.executeShellLocal.mockResolvedValue({
      stdout: smallOutput,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await executeShellExecutor({ command: 'echo short' }, createContext());
    const content = result.content as Record<string, unknown>;
    expect(content.stdout).toBe('short output');
    expect(content.stdout as string).not.toContain('truncated');
  });
});

// ============================================================================
// 10. Timeout capping
// ============================================================================

describe('timeout capping', () => {
  it('should cap timeout at 30000ms for JavaScript', async () => {
    mocks.executeJavaScriptLocal.mockResolvedValue(localSuccess);

    await executeJavaScriptExecutor({ code: 'x', timeout: 999999 }, createContext());

    expect(mocks.executeJavaScriptLocal).toHaveBeenCalledWith('x', { timeout: 30000 });
  });
});

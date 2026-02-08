/**
 * Tests for code execution permission checking.
 * Verifies that the ExecutionPermissions system correctly controls code execution.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../types.js';
import { executeJavaScriptExecutor } from './code-execution.js';

// Mock Docker to always be unavailable (force local path)
vi.mock('../../sandbox/docker.js', () => ({
  isDockerAvailable: vi.fn().mockResolvedValue(false),
  executePythonSandbox: vi.fn(),
  executeJavaScriptSandbox: vi.fn(),
  executeShellSandbox: vi.fn(),
}));

// Mock local executor to avoid actually running code
vi.mock('../../sandbox/local-executor.js', () => ({
  executeJavaScriptLocal: vi.fn().mockResolvedValue({
    success: true,
    stdout: 'Hello World\n',
    stderr: '',
    exitCode: 0,
    executionTimeMs: 10,
  }),
  executePythonLocal: vi.fn(),
  executeShellLocal: vi.fn(),
}));

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: 'test-call',
    conversationId: 'test-conv',
    userId: 'test-user',
    ...overrides,
  };
}

describe('Code Execution Permissions', () => {
  it('should block execution when master switch is OFF', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: false,
          mode: 'local',
          execute_javascript: 'allowed',
          execute_python: 'allowed',
          execute_shell: 'allowed',
          compile_code: 'allowed',
          package_manager: 'allowed',
        },
      }),
    );

    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('disabled');
  });

  it('should block execution when category is blocked', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: true,
          mode: 'local',
          execute_javascript: 'blocked',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        },
      }),
    );

    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('blocked');
  });

  it('should block when mode is prompt but no requestApproval callback', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: true,
          mode: 'local',
          execute_javascript: 'prompt',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        },
        // No requestApproval callback!
      }),
    );

    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('approval');
  });

  it('should block when mode is prompt and user rejects', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: true,
          mode: 'local',
          execute_javascript: 'prompt',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        },
        requestApproval: async () => false, // User rejects
      }),
    );

    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('rejected');
  });

  it('should allow execution when category is allowed', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: true,
          mode: 'local',
          execute_javascript: 'allowed',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        },
      }),
    );

    expect(result.isError).toBeFalsy();
    const content = result.content as Record<string, unknown>;
    expect(content.stdout).toBe('Hello World\n');
    expect(content.sandboxed).toBe(false);
    expect(content.executionMode).toBe('local');
  });

  it('should allow execution when mode is prompt and user approves', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        executionPermissions: {
          enabled: true,
          mode: 'local',
          execute_javascript: 'prompt',
          execute_python: 'blocked',
          execute_shell: 'blocked',
          compile_code: 'blocked',
          package_manager: 'blocked',
        },
        requestApproval: async () => true, // User approves
      }),
    );

    expect(result.isError).toBeFalsy();
    const content = result.content as Record<string, unknown>;
    expect(content.stdout).toBe('Hello World\n');
  });

  it('should block when permissions are undefined in web context (userId present)', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        userId: 'some-user',
        // executionPermissions: undefined — simulates failed DB load
      }),
    );

    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('failed to load');
  });

  it('should allow in CLI context (no userId, no requestApproval, no permissions)', async () => {
    const result = await executeJavaScriptExecutor(
      { code: 'console.log("hello")' },
      makeContext({
        userId: undefined,
        // No executionPermissions, no requestApproval → CLI backward compat
      }),
    );

    // Should succeed in CLI mode
    expect(result.isError).toBeFalsy();
    const content = result.content as Record<string, unknown>;
    expect(content.stdout).toBe('Hello World\n');
  });
});

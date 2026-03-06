/**
 * CLI Tool Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockService, mockGetCliToolService } = vi.hoisted(() => {
  const mockService = {
    executeTool: vi.fn(),
    listTools: vi.fn(),
    installTool: vi.fn(),
  };
  const mockGetCliToolService = vi.fn(() => mockService);
  return { mockService, mockGetCliToolService };
});

vi.mock('../services/cli-tool-service.js', () => ({
  getCliToolService: mockGetCliToolService,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };
});

import { executeCliToolTool, CLI_TOOL_TOOLS } from './cli-tool-tools.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI_TOOL_TOOLS', () => {
  it('exports an array of tool definitions', () => {
    expect(Array.isArray(CLI_TOOL_TOOLS)).toBe(true);
    expect(CLI_TOOL_TOOLS.length).toBe(3);
  });

  it('includes run_cli_tool, list_cli_tools, install_cli_tool', () => {
    const names = CLI_TOOL_TOOLS.map((t) => t.name);
    expect(names).toContain('run_cli_tool');
    expect(names).toContain('list_cli_tools');
    expect(names).toContain('install_cli_tool');
  });

  it('run_cli_tool has required parameters: name, args, cwd', () => {
    const def = CLI_TOOL_TOOLS.find((t) => t.name === 'run_cli_tool')!;
    expect(def.parameters.required).toContain('name');
    expect(def.parameters.required).toContain('args');
    expect(def.parameters.required).toContain('cwd');
  });
});

describe('executeCliToolTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- run_cli_tool ----

  describe('run_cli_tool', () => {
    it('executes tool and returns result', async () => {
      mockService.executeTool.mockResolvedValueOnce({
        success: true,
        toolName: 'eslint',
        exitCode: 0,
        stdout: 'No errors',
        stderr: '',
        durationMs: 500,
        truncated: false,
        error: undefined,
      });

      const result = await executeCliToolTool(
        'run_cli_tool',
        { name: 'eslint', args: ['src/'], cwd: '/project' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        toolName: 'eslint',
        exitCode: 0,
        stdout: 'No errors',
        stderr: '',
        durationMs: 500,
        truncated: false,
      });
      expect(mockService.executeTool).toHaveBeenCalledWith(
        'eslint',
        ['src/'],
        '/project',
        'user-1'
      );
    });

    it('returns error when name is missing', async () => {
      const result = await executeCliToolTool('run_cli_tool', { args: [], cwd: '/project' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name is required');
      expect(mockService.executeTool).not.toHaveBeenCalled();
    });

    it('returns error when cwd is missing', async () => {
      const result = await executeCliToolTool('run_cli_tool', { name: 'eslint', args: [] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('cwd is required');
      expect(mockService.executeTool).not.toHaveBeenCalled();
    });

    it('uses empty args array when args not provided', async () => {
      mockService.executeTool.mockResolvedValueOnce({
        success: true,
        toolName: 'git',
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 10,
        truncated: false,
      });

      await executeCliToolTool('run_cli_tool', { name: 'git', cwd: '/project' });
      expect(mockService.executeTool).toHaveBeenCalledWith('git', [], '/project', 'default');
    });

    it('truncates stdout and stderr when over limits', async () => {
      const longOutput = 'x'.repeat(10000);
      mockService.executeTool.mockResolvedValueOnce({
        success: true,
        toolName: 'eslint',
        exitCode: 0,
        stdout: longOutput,
        stderr: longOutput,
        durationMs: 100,
        truncated: true,
      });

      const result = await executeCliToolTool('run_cli_tool', {
        name: 'eslint',
        args: [],
        cwd: '/project',
      });
      const r = result.result as Record<string, string>;
      expect(r.stdout.length).toBeLessThan(longOutput.length);
      expect(r.stderr.length).toBeLessThan(longOutput.length);
      expect(r.stdout).toContain('truncated');
    });

    it('returns error when service throws', async () => {
      mockService.executeTool.mockRejectedValueOnce(new Error('ENOENT: binary not found'));
      const result = await executeCliToolTool('run_cli_tool', {
        name: 'eslint',
        args: [],
        cwd: '/project',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('passes failure result from service', async () => {
      mockService.executeTool.mockResolvedValueOnce({
        success: false,
        toolName: 'eslint',
        exitCode: 1,
        stdout: '',
        stderr: 'Parse error',
        durationMs: 50,
        truncated: false,
        error: 'Parse error',
      });

      const result = await executeCliToolTool('run_cli_tool', {
        name: 'eslint',
        args: [],
        cwd: '/project',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Parse error');
    });
  });

  // ---- list_cli_tools ----

  describe('list_cli_tools', () => {
    it('returns list of tools', async () => {
      const tools = [
        { name: 'eslint', installed: true },
        { name: 'prettier', installed: false },
      ];
      mockService.listTools.mockResolvedValueOnce(tools);

      const result = await executeCliToolTool('list_cli_tools', {}, 'user-1');
      expect(result.success).toBe(true);
      expect(result.result).toEqual(tools);
      expect(mockService.listTools).toHaveBeenCalledWith('user-1');
    });

    it('uses default userId when not provided', async () => {
      mockService.listTools.mockResolvedValueOnce([]);
      await executeCliToolTool('list_cli_tools', {});
      expect(mockService.listTools).toHaveBeenCalledWith('default');
    });

    it('returns error when service throws', async () => {
      mockService.listTools.mockRejectedValueOnce(new Error('DB error'));
      const result = await executeCliToolTool('list_cli_tools', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  // ---- install_cli_tool ----

  describe('install_cli_tool', () => {
    it('installs tool and returns result', async () => {
      mockService.installTool.mockResolvedValueOnce({
        success: true,
        toolName: 'prettier',
        exitCode: 0,
        stdout: 'installed',
        stderr: '',
        durationMs: 2000,
        truncated: false,
      });

      const result = await executeCliToolTool(
        'install_cli_tool',
        { name: 'prettier', method: 'npm-global' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockService.installTool).toHaveBeenCalledWith('prettier', 'npm-global', 'user-1');
    });

    it('returns error when name is missing', async () => {
      const result = await executeCliToolTool('install_cli_tool', { method: 'npm-global' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name is required');
      expect(mockService.installTool).not.toHaveBeenCalled();
    });

    it('returns error when method is missing', async () => {
      const result = await executeCliToolTool('install_cli_tool', { name: 'prettier' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('method is required');
      expect(mockService.installTool).not.toHaveBeenCalled();
    });

    it('returns error when service throws', async () => {
      mockService.installTool.mockRejectedValueOnce(new Error('npm not found'));
      const result = await executeCliToolTool('install_cli_tool', {
        name: 'prettier',
        method: 'npm-global',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('npm not found');
    });
  });

  // ---- unknown tool ----

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeCliToolTool('nonexistent_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown CLI tool tool: nonexistent_tool');
    });
  });
});

describe('truncateOutput (via run_cli_tool)', () => {
  it('does not truncate output within limit', async () => {
    const output = 'hello world'; // within 8000 chars
    mockService.executeTool.mockResolvedValueOnce({
      success: true,
      toolName: 'git',
      exitCode: 0,
      stdout: output,
      stderr: '',
      durationMs: 10,
      truncated: false,
    });

    const result = await executeCliToolTool('run_cli_tool', {
      name: 'git',
      args: [],
      cwd: '/project',
    });
    expect((result.result as Record<string, string>).stdout).toBe('hello world');
  });
});

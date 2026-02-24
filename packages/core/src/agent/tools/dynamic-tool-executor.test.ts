/**
 * Tests for dynamic tool executor
 *
 * Covers: executeDynamicTool — sandbox creation, permission mapping, tool code wrapping,
 *         success/failure result handling, globals injection, callTool, listTools, config bridge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const mockSandboxExecute = vi.hoisted(() => vi.fn());
const mockCreateSandbox = vi.hoisted(() => vi.fn(() => ({ execute: mockSandboxExecute })));
const mockCreateScopedFs = vi.hoisted(() => vi.fn(() => ({ readFile: vi.fn() })));
const mockCreateScopedExec = vi.hoisted(() => vi.fn(() => ({ exec: vi.fn() })));
const mockIsToolCallAllowed = vi.hoisted(() => vi.fn());
const mockCreateSafeFetch = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockMapPermissions = vi.hoisted(() =>
  vi.fn(() => ({
    network: false,
    fsRead: false,
    fsWrite: false,
    spawn: false,
    env: false,
  }))
);
const mockCreateSandboxUtils = vi.hoisted(() =>
  vi.fn(() => ({
    hash: vi.fn(),
    uuid: vi.fn(),
  }))
);
const mockGetBaseName = vi.hoisted(() =>
  vi.fn((name: string) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.substring(i + 1) : name;
  })
);

const mockUtilityTools = vi.hoisted(() => [
  {
    definition: {
      name: 'test_util',
      description: 'A utility',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    },
    executor: vi.fn(),
  },
]);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../sandbox/executor.js', () => ({
  createSandbox: mockCreateSandbox,
}));

vi.mock('../../sandbox/scoped-apis.js', () => ({
  createScopedFs: mockCreateScopedFs,
  createScopedExec: mockCreateScopedExec,
}));

vi.mock('./dynamic-tool-permissions.js', () => ({
  isToolCallAllowed: mockIsToolCallAllowed,
}));

vi.mock('./dynamic-tool-sandbox.js', () => ({
  createSafeFetch: mockCreateSafeFetch,
  mapPermissions: mockMapPermissions,
  createSandboxUtils: mockCreateSandboxUtils,
}));

vi.mock('../tool-namespace.js', () => ({
  getBaseName: mockGetBaseName,
}));

vi.mock('./utility-tools.js', () => ({
  UTILITY_TOOLS: mockUtilityTools,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { executeDynamicTool } from './dynamic-tool-executor.js';
import type { DynamicToolDefinition } from './dynamic-tool-types.js';
import type { ToolContext, ToolDefinition, ToolExecutor } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<DynamicToolDefinition> = {}): DynamicToolDefinition {
  return {
    name: 'my_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    code: 'return "hello";',
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: 'call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeDynamicTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMapPermissions.mockReturnValue({
      network: false,
      fsRead: false,
      fsWrite: false,
      spawn: false,
      env: false,
    });
    mockIsToolCallAllowed.mockReturnValue({ allowed: true });
  });

  // --- Success path ---

  it('returns success result when sandbox executes successfully', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: {
        success: true,
        value: 'hello world',
        executionTime: 42,
      },
    });

    const result = await executeDynamicTool(makeTool(), { input: 'test' }, makeContext());

    expect(result.isError).toBe(false);
    expect(result.content).toBe('hello world');
    expect(result.metadata).toEqual({
      executionTime: 42,
      dynamicTool: 'my_tool',
    });
  });

  it('creates sandbox with correct pluginId', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ name: 'weather_fetch' }), {}, makeContext());

    expect(mockCreateSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'dynamic:weather_fetch',
      })
    );
  });

  it('calls mapPermissions with tool permissions', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(
      makeTool({ permissions: ['network', 'filesystem'] }),
      {},
      makeContext()
    );

    expect(mockMapPermissions).toHaveBeenCalledWith(['network', 'filesystem']);
  });

  it('uses empty array when permissions are undefined', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ permissions: undefined }), {}, makeContext());

    expect(mockMapPermissions).toHaveBeenCalledWith([]);
  });

  it('sets resource limits on sandbox', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    expect(mockCreateSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        limits: {
          maxExecutionTime: 30000,
          maxCpuTime: 5000,
          maxMemory: 50 * 1024 * 1024,
        },
      })
    );
  });

  // --- Failure paths ---

  it('returns error when sandbox execution fails (success=false)', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: {
        success: false,
        error: 'ReferenceError: x is not defined',
        executionTime: 10,
        stack: 'at line 1',
      },
    });

    const result = await executeDynamicTool(makeTool(), {}, makeContext());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tool execution failed');
    expect(result.content).toContain('ReferenceError');
    expect(result.metadata).toEqual(
      expect.objectContaining({
        dynamicTool: 'my_tool',
        stack: 'at line 1',
      })
    );
  });

  it('returns error when sandbox returns Result.err', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: false,
      error: {
        message: 'Sandbox timeout',
        name: 'TimeoutError',
      },
    });

    const result = await executeDynamicTool(makeTool(), {}, makeContext());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tool execution error');
    expect(result.content).toContain('Sandbox timeout');
    expect(result.metadata).toEqual({
      dynamicTool: 'my_tool',
      errorType: 'TimeoutError',
    });
  });

  // --- Globals injection ---

  it('injects fetch when tool has network permission', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ permissions: ['network'] }), {}, makeContext());

    expect(mockCreateSafeFetch).toHaveBeenCalledWith('my_tool');
    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.fetch).toBeDefined();
  });

  it('does not inject fetch when tool lacks network permission', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ permissions: [] }), {}, makeContext());

    expect(mockCreateSafeFetch).not.toHaveBeenCalled();
    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.fetch).toBeUndefined();
  });

  it('injects scoped fs when tool has local + filesystem permissions', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(
      makeTool({ permissions: ['local', 'filesystem'] }),
      {},
      makeContext({ workspaceDir: '/my/workspace' })
    );

    expect(mockCreateScopedFs).toHaveBeenCalledWith('/my/workspace');
  });

  it('does not inject scoped fs when only local permission', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ permissions: ['local'] }), {}, makeContext());

    // createScopedFs might still be called for local permission alone,
    // but let's check the globals
    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    // Only local without filesystem should not inject fs
    expect(globals.fs).toBeUndefined();
  });

  it('injects scoped exec when tool has local + shell permissions', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(
      makeTool({ permissions: ['local', 'shell'] }),
      {},
      makeContext({ workspaceDir: '/my/workspace' })
    );

    expect(mockCreateScopedExec).toHaveBeenCalledWith('/my/workspace');
  });

  it('does not inject scoped exec without local permission', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ permissions: ['shell'] }), {}, makeContext());

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.exec).toBeUndefined();
  });

  it('uses process.cwd() when workspaceDir is not set', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(
      makeTool({ permissions: ['local', 'filesystem', 'shell'] }),
      {},
      makeContext()
    );

    expect(mockCreateScopedFs).toHaveBeenCalledWith(process.cwd());
    expect(mockCreateScopedExec).toHaveBeenCalledWith(process.cwd());
  });

  it('injects __args__ and __context__ globals', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    const args = { input: 'hello' };
    const context = makeContext({ callId: 'c1', conversationId: 'conv-2', userId: 'u1' });
    await executeDynamicTool(makeTool(), args, context);

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.__args__).toEqual(args);
    expect(globals.__context__).toEqual({
      toolName: 'my_tool',
      callId: 'c1',
      conversationId: 'conv-2',
      userId: 'u1',
    });
  });

  it('injects crypto utilities', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.crypto).toBeDefined();
    expect(typeof globals.crypto.randomUUID).toBe('function');
    expect(typeof globals.crypto.randomBytes).toBe('function');
    expect(typeof globals.crypto.createHash).toBe('function');
  });

  it('injects sandbox utils', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    expect(mockCreateSandboxUtils).toHaveBeenCalled();
    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.utils).toBeDefined();
  });

  it('injects config bridge', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    const mockGetFieldValue = vi.fn().mockReturnValue('api-key-123');
    await executeDynamicTool(makeTool(), {}, makeContext({ getFieldValue: mockGetFieldValue }));

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.config).toBeDefined();
    expect(typeof globals.config.get).toBe('function');
  });

  it('blocks setTimeout in sandbox', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.setTimeout).toBeUndefined();
  });

  // --- Wrapped code ---

  it('wraps tool code with args and context destructuring', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: 'ok', executionTime: 1 },
    });

    await executeDynamicTool(makeTool({ code: 'return args.x;' }), {}, makeContext());

    const wrappedCode = mockSandboxExecute.mock.calls[0]![0];
    expect(wrappedCode).toContain('const args = __args__');
    expect(wrappedCode).toContain('const context = __context__');
    expect(wrappedCode).toContain('return args.x;');
  });

  // --- utils.callTool ---

  describe('utils.callTool', () => {
    it('calls tool from callableTools when provided', async () => {
      const callableTool = {
        definition: {
          name: 'my_callable',
          description: 'A callable tool',
          parameters: { type: 'object' as const, properties: {} },
        },
        executor: vi.fn().mockResolvedValue({ content: '{"result": 42}', isError: false }),
      };

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext(), [callableTool]);

      // Get the callTool function from injected globals
      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const callTool = globals.utils.callTool;
      expect(typeof callTool).toBe('function');

      // Actually call it
      const result = await callTool('my_callable', { arg: 'value' });
      expect(callableTool.executor).toHaveBeenCalledWith({ arg: 'value' }, expect.any(Object));
      expect(result).toEqual({ result: 42 });
    });

    it('throws when tool is blocked', async () => {
      mockIsToolCallAllowed.mockReturnValue({
        allowed: false,
        reason: 'Tool is blocked',
      });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      await expect(globals.utils.callTool('execute_shell', {})).rejects.toThrow('Tool is blocked');
    });

    it('throws when tool is not found', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      await expect(globals.utils.callTool('nonexistent_tool', {})).rejects.toThrow('not found');
    });

    it('throws when called tool returns error', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });
      mockUtilityTools[0]!.executor.mockResolvedValue({
        content: 'Something failed',
        isError: true,
      });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      await expect(globals.utils.callTool('test_util', {})).rejects.toThrow('Something failed');
    });

    it('returns string content when JSON parsing fails', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });
      mockUtilityTools[0]!.executor.mockResolvedValue({
        content: 'plain text result',
        isError: false,
      });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = await globals.utils.callTool('test_util', {});
      expect(result).toBe('plain text result');
    });

    it('returns non-string content directly', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });
      mockUtilityTools[0]!.executor.mockResolvedValue({
        content: 12345,
        isError: false,
      });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = await globals.utils.callTool('test_util', {});
      expect(result).toBe(12345);
    });

    it('falls back to UTILITY_TOOLS when no callableTools provided', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });
      mockUtilityTools[0]!.executor.mockResolvedValue({
        content: '{"ok": true}',
        isError: false,
      });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = await globals.utils.callTool('test_util', { q: 'hello' });
      expect(result).toEqual({ ok: true });
    });

    it('resolves tool by base name when exact match fails', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });

      const callableTools = [
        {
          definition: {
            name: 'core.calculate',
            description: 'Calculate',
            parameters: { type: 'object' as const, properties: {} },
          },
          executor: vi.fn().mockResolvedValue({ content: '"42"', isError: false }),
        },
      ];

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext(), callableTools);

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = await globals.utils.callTool('calculate', {});
      expect(result).toBe('42');
    });

    it('includes available tools in error message', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      try {
        await globals.utils.callTool('nonexistent', {});
      } catch (err: unknown) {
        expect((err as Error).message).toContain('Available tools');
      }
    });
  });

  // --- utils.listTools ---

  describe('utils.listTools', () => {
    it('returns list of allowed tools from callable tools', async () => {
      const callableTools = [
        {
          definition: {
            name: 'core.search',
            description: 'Search',
            parameters: { type: 'object' as const, properties: { q: { type: 'string' } } },
          },
          executor: vi.fn(),
        },
        {
          definition: {
            name: 'core.execute_shell',
            description: 'Shell',
            parameters: { type: 'object' as const, properties: {} },
          },
          executor: vi.fn(),
        },
      ];

      // First call for search -> allowed, second for execute_shell -> blocked
      mockIsToolCallAllowed
        .mockReturnValueOnce({ allowed: true }) // during callTool execution prep
        .mockReturnValueOnce({ allowed: true }) // listTools: search
        .mockReturnValueOnce({ allowed: false }); // listTools: execute_shell

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext(), callableTools);

      // Reset mock completely — vi.clearAllMocks does NOT clear mockReturnValueOnce queue
      mockIsToolCallAllowed.mockReset();
      mockIsToolCallAllowed
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false });

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const tools = globals.utils.listTools();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('search');
      expect(tools[0].description).toBe('Search');
      expect(tools[0].parameters).toEqual(['q']);
    });

    it('falls back to UTILITY_TOOLS when no callableTools', async () => {
      mockIsToolCallAllowed.mockReturnValue({ allowed: true });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const tools = globals.utils.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- utils config helpers ---

  describe('utils config helpers', () => {
    it('getApiKey calls context.getApiKey', async () => {
      const mockGetApiKey = vi.fn().mockReturnValue('key-123');

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext({ getApiKey: mockGetApiKey }));

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = globals.utils.getApiKey('openai');
      expect(mockGetApiKey).toHaveBeenCalledWith('openai');
      expect(result).toBe('key-123');
    });

    it('getServiceConfig calls context.getServiceConfig', async () => {
      const mockGetServiceConfig = vi.fn().mockReturnValue({ apiKey: 'k' });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(
        makeTool(),
        {},
        makeContext({ getServiceConfig: mockGetServiceConfig })
      );

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = globals.utils.getServiceConfig('weather');
      expect(mockGetServiceConfig).toHaveBeenCalledWith('weather');
      expect(result).toEqual({ apiKey: 'k' });
    });

    it('getServiceConfig returns null when context function not provided', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      expect(globals.utils.getServiceConfig('x')).toBeNull();
    });

    it('getConfigEntry calls context.getConfigEntry', async () => {
      const mockGetConfigEntry = vi.fn().mockReturnValue({ data: {} });

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext({ getConfigEntry: mockGetConfigEntry }));

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      globals.utils.getConfigEntry('smtp', 'Work');
      expect(mockGetConfigEntry).toHaveBeenCalledWith('smtp', 'Work');
    });

    it('getConfigEntry returns null when context function not provided', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      expect(globals.utils.getConfigEntry('smtp')).toBeNull();
    });

    it('getConfigEntries calls context.getConfigEntries', async () => {
      const mockGetConfigEntries = vi.fn().mockReturnValue([{ data: {} }]);

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(
        makeTool(),
        {},
        makeContext({ getConfigEntries: mockGetConfigEntries })
      );

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = globals.utils.getConfigEntries('smtp');
      expect(mockGetConfigEntries).toHaveBeenCalledWith('smtp');
      expect(result).toEqual([{ data: {} }]);
    });

    it('getConfigEntries returns empty array when context function not provided', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext());

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      expect(globals.utils.getConfigEntries('smtp')).toEqual([]);
    });

    it('getFieldValue calls context.getFieldValue', async () => {
      const mockGetFieldValue = vi.fn().mockReturnValue('smtp.example.com');

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext({ getFieldValue: mockGetFieldValue }));

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = globals.utils.getFieldValue('smtp', 'host', 'Work');
      expect(mockGetFieldValue).toHaveBeenCalledWith('smtp', 'host', 'Work');
      expect(result).toBe('smtp.example.com');
    });

    it('config.get calls context.getFieldValue', async () => {
      const mockGetFieldValue = vi.fn().mockReturnValue('value-from-config');

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      await executeDynamicTool(makeTool(), {}, makeContext({ getFieldValue: mockGetFieldValue }));

      const globals = mockCreateSandbox.mock.calls[0]![0].globals;
      const result = await globals.config.get('weather', 'api_key');
      expect(mockGetFieldValue).toHaveBeenCalledWith('weather', 'api_key');
      expect(result).toBe('value-from-config');
    });
  });

  // --- Common globals ---

  it('injects standard JavaScript globals', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(globals.JSON).toBe(JSON);
    expect(globals.Math).toBe(Math);
    expect(globals.Date).toBe(Date);
    expect(globals.Array).toBe(Array);
    expect(globals.Object).toBe(Object);
    expect(globals.String).toBe(String);
    expect(globals.Number).toBe(Number);
    expect(globals.Boolean).toBe(Boolean);
    expect(globals.RegExp).toBe(RegExp);
    expect(globals.Map).toBe(Map);
    expect(globals.Set).toBe(Set);
    expect(globals.parseInt).toBe(parseInt);
    expect(globals.parseFloat).toBe(parseFloat);
    expect(globals.isNaN).toBe(isNaN);
    expect(globals.isFinite).toBe(isFinite);
    expect(globals.encodeURIComponent).toBe(encodeURIComponent);
    expect(globals.decodeURIComponent).toBe(decodeURIComponent);
    expect(globals.encodeURI).toBe(encodeURI);
    expect(globals.decodeURI).toBe(decodeURI);
  });

  it('sets debug to false', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    expect(mockCreateSandbox).toHaveBeenCalledWith(expect.objectContaining({ debug: false }));
  });

  // --- Console injection ---

  it('injects console with log, warn, error methods', async () => {
    mockSandboxExecute.mockResolvedValue({
      ok: true,
      value: { success: true, value: null, executionTime: 1 },
    });

    await executeDynamicTool(makeTool(), {}, makeContext());

    const globals = mockCreateSandbox.mock.calls[0]![0].globals;
    expect(typeof globals.console.log).toBe('function');
    expect(typeof globals.console.warn).toBe('function');
    expect(typeof globals.console.error).toBe('function');
  });
});

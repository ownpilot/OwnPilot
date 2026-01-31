/**
 * Tool Executor Tests
 *
 * Tests the shared tool executor service which creates a ToolRegistry
 * with all providers registered and provides executeTool/hasTool functions
 * with plugin fallback support.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToolRegistry = {
  has: vi.fn(),
  execute: vi.fn(),
  setApiKeyCenter: vi.fn(),
  registerProvider: vi.fn(),
};

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    ToolRegistry: vi.fn(() => mockToolRegistry),
    registerAllTools: vi.fn(),
    registerCoreTools: vi.fn(),
  };
});

vi.mock('./config-center-impl.js', () => ({
  gatewayConfigCenter: { mocked: true },
}));

const mockPluginRegistry = {
  getTool: vi.fn(),
};

vi.mock('../plugins/index.js', () => ({
  getDefaultPluginRegistry: vi.fn(async () => mockPluginRegistry),
}));

const mockMemoryProvider = { name: 'memory', getTools: vi.fn(() => []) };
const mockGoalProvider = { name: 'goal', getTools: vi.fn(() => []) };
const mockCustomDataProvider = { name: 'custom-data', getTools: vi.fn(() => []) };
const mockPersonalDataProvider = { name: 'personal-data', getTools: vi.fn(() => []) };
const mockTriggerProvider = { name: 'trigger', getTools: vi.fn(() => []) };
const mockPlanProvider = { name: 'plan', getTools: vi.fn(() => []) };

vi.mock('./tool-providers/index.js', () => ({
  createMemoryToolProvider: vi.fn(() => mockMemoryProvider),
  createGoalToolProvider: vi.fn(() => mockGoalProvider),
  createCustomDataToolProvider: vi.fn(() => mockCustomDataProvider),
  createPersonalDataToolProvider: vi.fn(() => mockPersonalDataProvider),
  createTriggerToolProvider: vi.fn(() => mockTriggerProvider),
  createPlanToolProvider: vi.fn(() => mockPlanProvider),
}));

import {
  getSharedToolRegistry,
  executeTool,
  hasTool,
  resetSharedToolRegistry,
} from './tool-executor.js';
import { ToolRegistry, registerAllTools, registerCoreTools } from '@ownpilot/core';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
} from './tool-providers/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedToolRegistry();
  });

  // ========================================================================
  // getSharedToolRegistry
  // ========================================================================

  describe('getSharedToolRegistry', () => {
    it('creates a new ToolRegistry on first call', () => {
      const registry = getSharedToolRegistry('user-1');

      expect(ToolRegistry).toHaveBeenCalledOnce();
      expect(registry).toBe(mockToolRegistry);
    });

    it('registers all tools and core tools', () => {
      getSharedToolRegistry('user-1');

      expect(registerAllTools).toHaveBeenCalledWith(mockToolRegistry);
      expect(registerCoreTools).toHaveBeenCalledWith(mockToolRegistry);
    });

    it('sets the API key center', () => {
      getSharedToolRegistry('user-1');

      expect(mockToolRegistry.setApiKeyCenter).toHaveBeenCalledWith({ mocked: true });
    });

    it('registers all 6 gateway tool providers', () => {
      getSharedToolRegistry('user-1');

      expect(createMemoryToolProvider).toHaveBeenCalledWith('user-1');
      expect(createGoalToolProvider).toHaveBeenCalledWith('user-1');
      expect(createCustomDataToolProvider).toHaveBeenCalled();
      expect(createPersonalDataToolProvider).toHaveBeenCalled();
      expect(createTriggerToolProvider).toHaveBeenCalled();
      expect(createPlanToolProvider).toHaveBeenCalled();

      expect(mockToolRegistry.registerProvider).toHaveBeenCalledTimes(6);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockMemoryProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockGoalProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockCustomDataProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockPersonalDataProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockTriggerProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockPlanProvider);
    });

    it('returns cached registry on subsequent calls', () => {
      const first = getSharedToolRegistry('user-1');
      const second = getSharedToolRegistry('user-2');

      expect(ToolRegistry).toHaveBeenCalledOnce();
      expect(first).toBe(second);
    });

    it('defaults userId to "default"', () => {
      getSharedToolRegistry();

      expect(createMemoryToolProvider).toHaveBeenCalledWith('default');
      expect(createGoalToolProvider).toHaveBeenCalledWith('default');
    });
  });

  // ========================================================================
  // resetSharedToolRegistry
  // ========================================================================

  describe('resetSharedToolRegistry', () => {
    it('clears the cached registry so next call creates a new one', () => {
      getSharedToolRegistry('user-1');
      expect(ToolRegistry).toHaveBeenCalledOnce();

      resetSharedToolRegistry();
      getSharedToolRegistry('user-2');

      expect(ToolRegistry).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // executeTool
  // ========================================================================

  describe('executeTool', () => {
    it('executes a tool from the shared registry when found', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'tool result', isError: false },
      });

      const result = await executeTool('some_tool', { arg1: 'val' }, 'user-1');

      expect(result).toEqual({
        success: true,
        result: 'tool result',
        error: undefined,
      });
      expect(mockToolRegistry.execute).toHaveBeenCalledWith('some_tool', { arg1: 'val' }, {
        conversationId: 'system-execution',
      });
    });

    it('returns error when registry tool execution returns isError', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'Something went wrong', isError: true },
      });

      const result = await executeTool('failing_tool', {});

      expect(result).toEqual({
        success: false,
        result: 'Something went wrong',
        error: 'Something went wrong',
      });
    });

    it('returns error when registry execute returns non-ok result', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: false,
        error: { message: 'Execution failed' },
      });

      const result = await executeTool('bad_tool', {});

      expect(result).toEqual({
        success: false,
        error: 'Execution failed',
      });
    });

    it('catches exceptions from registry execution', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockRejectedValue(new Error('Unexpected crash'));

      const result = await executeTool('crash_tool', {});

      expect(result).toEqual({
        success: false,
        error: 'Unexpected crash',
      });
    });

    it('catches non-Error exceptions from registry execution', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockRejectedValue('string error');

      const result = await executeTool('crash_tool', {});

      expect(result).toEqual({
        success: false,
        error: 'Tool execution failed',
      });
    });

    it('falls back to plugin tools when not found in registry', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockResolvedValue({
        content: 'plugin result',
        isError: false,
      });
      mockPluginRegistry.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('plugin_tool', { x: 1 });

      expect(result).toEqual({
        success: true,
        result: 'plugin result',
        error: undefined,
      });
      expect(mockPluginRegistry.getTool).toHaveBeenCalledWith('plugin_tool');
    });

    it('returns error when plugin tool execution returns isError', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockResolvedValue({
        content: 'plugin error',
        isError: true,
      });
      mockPluginRegistry.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('plugin_error_tool', {});

      expect(result).toEqual({
        success: false,
        result: 'plugin error',
        error: 'plugin error',
      });
    });

    it('returns not-found error when tool exists in neither registry nor plugins', async () => {
      mockToolRegistry.has.mockReturnValue(false);
      mockPluginRegistry.getTool.mockReturnValue(null);

      const result = await executeTool('nonexistent_tool', {});

      expect(result).toEqual({
        success: false,
        error: "Tool 'nonexistent_tool' not found in shared registry or plugins",
      });
    });

    it('handles plugin executor throwing an exception', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockRejectedValue(new Error('Plugin crashed'));
      mockPluginRegistry.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('crashing_plugin_tool', {});

      expect(result).toEqual({
        success: false,
        error: 'Plugin crashed',
      });
    });
  });

  // ========================================================================
  // hasTool
  // ========================================================================

  describe('hasTool', () => {
    it('returns true when tool is in shared registry', async () => {
      mockToolRegistry.has.mockReturnValue(true);

      const result = await hasTool('some_tool');

      expect(result).toBe(true);
      // Should not check plugins if found in registry
      expect(mockPluginRegistry.getTool).not.toHaveBeenCalled();
    });

    it('returns true when tool is in plugin registry', async () => {
      mockToolRegistry.has.mockReturnValue(false);
      mockPluginRegistry.getTool.mockReturnValue({ executor: vi.fn() });

      const result = await hasTool('plugin_tool');

      expect(result).toBe(true);
    });

    it('returns false when tool exists in neither registry', async () => {
      mockToolRegistry.has.mockReturnValue(false);
      mockPluginRegistry.getTool.mockReturnValue(null);

      const result = await hasTool('nonexistent_tool');

      expect(result).toBe(false);
    });

    it('returns false when plugin registry throws', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const { getDefaultPluginRegistry } = await import('../plugins/index.js');
      (getDefaultPluginRegistry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Plugin system down')
      );

      const result = await hasTool('any_tool');

      expect(result).toBe(false);
    });
  });
});

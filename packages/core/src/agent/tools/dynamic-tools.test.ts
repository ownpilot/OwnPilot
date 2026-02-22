import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const mockSandboxExecute = vi.hoisted(() => vi.fn());
const mockCreateSandbox = vi.hoisted(() => vi.fn(() => ({ execute: mockSandboxExecute })));

const mockDangerousPatterns = vi.hoisted(() => [
  { pattern: /\brequire\s*\(/i, message: 'require() is not allowed' },
  { pattern: /\beval\s*\(/i, message: 'eval() is not allowed' },
  { pattern: /\bprocess\b/, message: 'process object access is not allowed' },
]);

const mockUtilityTools = vi.hoisted(() => [
  {
    definition: { name: 'test_tool', description: 'A test tool', parameters: { type: 'object', properties: {} } },
    executor: vi.fn(),
  },
  {
    definition: { name: 'another_tool', description: 'Another tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    executor: vi.fn(),
  },
]);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../sandbox/executor.js', () => ({
  createSandbox: mockCreateSandbox,
}));

vi.mock('../../sandbox/code-validator.js', () => ({
  DANGEROUS_CODE_PATTERNS: mockDangerousPatterns,
  validateToolCodeWithPermissions: (code: string, _permissions?: string[]) => {
    const errors: string[] = [];
    for (const { pattern, message } of mockDangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(message);
      }
    }
    return { valid: errors.length === 0, errors };
  },
}));

vi.mock('./utility-tools.js', () => ({
  UTILITY_TOOLS: mockUtilityTools,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
  createDynamicToolRegistry,
  createToolDefinition,
  listToolsDefinition,
  deleteToolDefinition,
  toggleToolDefinition,
  searchToolsDefinition,
  getToolHelpDefinition,
  useToolDefinition,
  batchUseToolDefinition,
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
} from './dynamic-tools.js';
import type { DynamicToolDefinition } from './dynamic-tools.js';
import type { ToolContext } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<DynamicToolDefinition> = {}): DynamicToolDefinition {
  return {
    name: 'my_tool',
    description: 'A custom tool',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Some input' },
      },
    },
    code: 'return args.input;',
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

// =============================================================================
// createDynamicToolRegistry
// =============================================================================

describe('createDynamicToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // tools map
  // ---------------------------------------------------------------------------

  describe('tools map', () => {
    it('starts with an empty tools map', () => {
      const registry = createDynamicToolRegistry();
      expect(registry.tools.size).toBe(0);
    });

    it('tools map grows when tools are registered', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      expect(registry.tools.size).toBe(1);
    });

    it('tools map shrinks when tools are unregistered', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      registry.unregister('my_tool');
      expect(registry.tools.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // register
  // ---------------------------------------------------------------------------

  describe('register', () => {
    it('registers a valid tool', () => {
      const registry = createDynamicToolRegistry();
      const tool = makeTool();
      registry.register(tool);
      expect(registry.has('my_tool')).toBe(true);
    });

    it('overwrites a tool with the same name', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ description: 'First version' }));
      registry.register(makeTool({ description: 'Second version' }));
      expect(registry.tools.size).toBe(1);
      const def = registry.getDefinition('my_tool');
      expect(def?.description).toBe('Second version');
    });

    it('throws for a name starting with uppercase', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ name: 'MyTool' }))
      ).toThrow('Invalid tool name');
    });

    it('throws for a name starting with a number', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ name: '1tool' }))
      ).toThrow('Invalid tool name');
    });

    it('throws for a name with spaces', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ name: 'my tool' }))
      ).toThrow('Invalid tool name');
    });

    it('throws for a name with hyphens', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ name: 'my-tool' }))
      ).toThrow('Invalid tool name');
    });

    it('allows names with underscores', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'my_awesome_tool' }));
      expect(registry.has('my_awesome_tool')).toBe(true);
    });

    it('allows names with numbers after the first char', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'tool123' }));
      expect(registry.has('tool123')).toBe(true);
    });

    it('throws for an empty name', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ name: '' }))
      ).toThrow('Invalid tool name');
    });

    it('throws for code containing require()', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ code: 'const fs = require("fs")' }))
      ).toThrow('Tool code validation failed');
    });

    it('throws for code containing eval()', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ code: 'eval("alert(1)")' }))
      ).toThrow('Tool code validation failed');
    });

    it('throws for code containing process access', () => {
      const registry = createDynamicToolRegistry();
      expect(() =>
        registry.register(makeTool({ code: 'console.log(process.env)' }))
      ).toThrow('Tool code validation failed');
    });

    it('allows safe code', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ code: 'return args.x + args.y;' }));
      expect(registry.has('my_tool')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // unregister
  // ---------------------------------------------------------------------------

  describe('unregister', () => {
    it('returns true when removing an existing tool', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      expect(registry.unregister('my_tool')).toBe(true);
    });

    it('returns false when removing a non-existent tool', () => {
      const registry = createDynamicToolRegistry();
      expect(registry.unregister('nonexistent')).toBe(false);
    });

    it('tool is no longer accessible after unregister', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      registry.unregister('my_tool');
      expect(registry.has('my_tool')).toBe(false);
      expect(registry.getDefinition('my_tool')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // has
  // ---------------------------------------------------------------------------

  describe('has', () => {
    it('returns true for a registered tool', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      expect(registry.has('my_tool')).toBe(true);
    });

    it('returns false for a non-registered tool', () => {
      const registry = createDynamicToolRegistry();
      expect(registry.has('missing')).toBe(false);
    });

    it('returns false after the tool is unregistered', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      registry.unregister('my_tool');
      expect(registry.has('my_tool')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getDefinition
  // ---------------------------------------------------------------------------

  describe('getDefinition', () => {
    it('returns undefined for a non-existent tool', () => {
      const registry = createDynamicToolRegistry();
      expect(registry.getDefinition('nonexistent')).toBeUndefined();
    });

    it('returns a ToolDefinition with correct fields', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ category: 'Weather', requiresApproval: true }));
      const def = registry.getDefinition('my_tool');
      expect(def).toBeDefined();
      expect(def!.name).toBe('my_tool');
      expect(def!.description).toBe('A custom tool');
      expect(def!.category).toBe('Weather');
      expect(def!.requiresConfirmation).toBe(true);
    });

    it('defaults category to "Custom" when not specified', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const def = registry.getDefinition('my_tool');
      expect(def!.category).toBe('Custom');
    });

    it('includes parameters schema', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const def = registry.getDefinition('my_tool');
      expect(def!.parameters.type).toBe('object');
      expect(def!.parameters.properties).toHaveProperty('input');
    });

    it('does not include requiresConfirmation when requiresApproval is undefined', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const def = registry.getDefinition('my_tool');
      expect(def!.requiresConfirmation).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getAllDefinitions
  // ---------------------------------------------------------------------------

  describe('getAllDefinitions', () => {
    it('returns empty array when no tools registered', () => {
      const registry = createDynamicToolRegistry();
      expect(registry.getAllDefinitions()).toEqual([]);
    });

    it('returns all registered tools', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'tool_a' }));
      registry.register(makeTool({ name: 'tool_b' }));
      registry.register(makeTool({ name: 'tool_c' }));
      const defs = registry.getAllDefinitions();
      expect(defs).toHaveLength(3);
      const names = defs.map((d) => d.name);
      expect(names).toContain('tool_a');
      expect(names).toContain('tool_b');
      expect(names).toContain('tool_c');
    });

    it('each definition has correct structure', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'tool_a', category: 'Util' }));
      const defs = registry.getAllDefinitions();
      expect(defs[0]!.name).toBe('tool_a');
      expect(defs[0]!.category).toBe('Util');
      expect(defs[0]!.parameters).toBeDefined();
    });

    it('defaults category to Custom for each tool', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'tool_x' }));
      const defs = registry.getAllDefinitions();
      expect(defs[0]!.category).toBe('Custom');
    });

    it('reflects requiresApproval as requiresConfirmation', () => {
      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'tool_x', requiresApproval: true }));
      const defs = registry.getAllDefinitions();
      expect(defs[0]!.requiresConfirmation).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------

  describe('execute', () => {
    it('returns error when tool is not found', async () => {
      const registry = createDynamicToolRegistry();
      const result = await registry.execute('missing', {}, makeContext());
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Dynamic tool not found: missing');
    });

    it('calls createSandbox and sandbox.execute for a registered tool', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: {
          success: true,
          value: 'hello',
          executionTime: 42,
        },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const result = await registry.execute('my_tool', { input: 'test' }, makeContext());

      expect(mockCreateSandbox).toHaveBeenCalledTimes(1);
      expect(mockSandboxExecute).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(false);
      expect(result.content).toBe('hello');
    });

    it('returns metadata with executionTime and dynamicTool name on success', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: {
          success: true,
          value: 'result',
          executionTime: 100,
        },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const result = await registry.execute('my_tool', {}, makeContext());

      expect(result.metadata).toEqual({
        executionTime: 100,
        dynamicTool: 'my_tool',
      });
    });

    it('returns error result when sandbox execution fails (success=false)', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: {
          success: false,
          error: 'ReferenceError: x is not defined',
          executionTime: 10,
          stack: 'at line 1',
        },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const result = await registry.execute('my_tool', {}, makeContext());

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

    it('returns error result when sandbox returns Result.err', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: false,
        error: {
          message: 'Sandbox timeout',
          name: 'TimeoutError',
        },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      const result = await registry.execute('my_tool', {}, makeContext());

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool execution error');
      expect(result.content).toContain('Sandbox timeout');
      expect(result.metadata).toEqual({
        dynamicTool: 'my_tool',
        errorType: 'TimeoutError',
      });
    });

    it('passes permissions correctly to sandbox', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ permissions: ['network', 'filesystem', 'shell'] }));
      await registry.execute('my_tool', {}, makeContext());

      const config = mockCreateSandbox.mock.calls[0]![0];
      expect(config.permissions.network).toBe(true);
      expect(config.permissions.fsRead).toBe(true);
      expect(config.permissions.fsWrite).toBe(true);
      expect(config.permissions.spawn).toBe(true);
    });

    it('sets all permissions to false when no permissions are specified', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ permissions: [] }));
      await registry.execute('my_tool', {}, makeContext());

      const config = mockCreateSandbox.mock.calls[0]![0];
      expect(config.permissions.network).toBe(false);
      expect(config.permissions.fsRead).toBe(false);
      expect(config.permissions.fsWrite).toBe(false);
      expect(config.permissions.spawn).toBe(false);
      expect(config.permissions.env).toBe(false);
    });

    it('handles database, email, and scheduling permissions without setting raw permissions', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ permissions: ['database', 'email', 'scheduling'] }));
      await registry.execute('my_tool', {}, makeContext());

      const config = mockCreateSandbox.mock.calls[0]![0];
      expect(config.permissions.network).toBe(false);
      expect(config.permissions.fsRead).toBe(false);
      expect(config.permissions.fsWrite).toBe(false);
      expect(config.permissions.spawn).toBe(false);
    });

    it('passes pluginId as dynamic:<tool_name>', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool({ name: 'weather_fetch' }));
      await registry.execute('weather_fetch', {}, makeContext());

      const config = mockCreateSandbox.mock.calls[0]![0];
      expect(config.pluginId).toBe('dynamic:weather_fetch');
    });

    it('passes resource limits to sandbox', async () => {
      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: null, executionTime: 1 },
      });

      const registry = createDynamicToolRegistry();
      registry.register(makeTool());
      await registry.execute('my_tool', {}, makeContext());

      const config = mockCreateSandbox.mock.calls[0]![0];
      expect(config.limits.maxExecutionTime).toBe(30000);
      expect(config.limits.maxCpuTime).toBe(5000);
      expect(config.limits.maxMemory).toBe(50 * 1024 * 1024);
    });
  });

  // ---------------------------------------------------------------------------
  // execute with callableTools
  // ---------------------------------------------------------------------------

  describe('execute with callableTools', () => {
    it('passes callableTools to sandbox globals for callTool', async () => {
      const customTools = [
        {
          definition: { name: 'custom_a', description: 'Custom A', parameters: { type: 'object' as const, properties: {} } },
          executor: vi.fn(),
        },
      ];

      mockSandboxExecute.mockResolvedValue({
        ok: true,
        value: { success: true, value: 'ok', executionTime: 1 },
      });

      const registry = createDynamicToolRegistry(customTools);
      registry.register(makeTool());
      await registry.execute('my_tool', {}, makeContext());

      // Verify sandbox was created; the callableTools are used inside the callTool utility
      expect(mockCreateSandbox).toHaveBeenCalledTimes(1);
    });
  });
});

// =============================================================================
// createToolDefinition (meta-tool definition)
// =============================================================================

describe('createToolDefinition', () => {
  it('has name "create_tool"', () => {
    expect(createToolDefinition.name).toBe('create_tool');
  });

  it('has category "Meta"', () => {
    expect(createToolDefinition.category).toBe('Meta');
  });

  it('requires confirmation', () => {
    expect(createToolDefinition.requiresConfirmation).toBe(true);
  });

  it('has required parameters: name, description, parameters, code', () => {
    expect(createToolDefinition.parameters.required).toEqual(['name', 'description', 'parameters', 'code']);
  });

  it('defines all expected parameter properties', () => {
    const props = Object.keys(createToolDefinition.parameters.properties);
    expect(props).toContain('name');
    expect(props).toContain('description');
    expect(props).toContain('parameters');
    expect(props).toContain('code');
    expect(props).toContain('category');
    expect(props).toContain('permissions');
    expect(props).toContain('required_api_keys');
  });

  it('has a non-empty description', () => {
    expect(createToolDefinition.description.length).toBeGreaterThan(0);
  });

  it('permissions parameter is of type array', () => {
    expect(createToolDefinition.parameters.properties.permissions.type).toBe('array');
  });
});

// =============================================================================
// listToolsDefinition
// =============================================================================

describe('listToolsDefinition', () => {
  it('has name "list_custom_tools"', () => {
    expect(listToolsDefinition.name).toBe('list_custom_tools');
  });

  it('has category "Meta"', () => {
    expect(listToolsDefinition.category).toBe('Meta');
  });

  it('has parameters for category and status filters', () => {
    const props = Object.keys(listToolsDefinition.parameters.properties);
    expect(props).toContain('category');
    expect(props).toContain('status');
  });

  it('status has enum values', () => {
    const statusProp = listToolsDefinition.parameters.properties.status;
    expect(statusProp.enum).toEqual(['active', 'disabled', 'pending_approval']);
  });

  it('has no required parameters', () => {
    expect(listToolsDefinition.parameters.required).toBeUndefined();
  });
});

// =============================================================================
// deleteToolDefinition
// =============================================================================

describe('deleteToolDefinition', () => {
  it('has name "delete_custom_tool"', () => {
    expect(deleteToolDefinition.name).toBe('delete_custom_tool');
  });

  it('has category "Meta"', () => {
    expect(deleteToolDefinition.category).toBe('Meta');
  });

  it('requires confirmation', () => {
    expect(deleteToolDefinition.requiresConfirmation).toBe(true);
  });

  it('has required parameter "name"', () => {
    expect(deleteToolDefinition.parameters.required).toEqual(['name']);
  });

  it('has name and confirm properties', () => {
    const props = Object.keys(deleteToolDefinition.parameters.properties);
    expect(props).toContain('name');
    expect(props).toContain('confirm');
  });

  it('description mentions LLM-created tools', () => {
    expect(deleteToolDefinition.description).toContain('LLM-created');
  });
});

// =============================================================================
// toggleToolDefinition
// =============================================================================

describe('toggleToolDefinition', () => {
  it('has name "toggle_custom_tool"', () => {
    expect(toggleToolDefinition.name).toBe('toggle_custom_tool');
  });

  it('has category "Meta"', () => {
    expect(toggleToolDefinition.category).toBe('Meta');
  });

  it('has required parameters: name and enabled', () => {
    expect(toggleToolDefinition.parameters.required).toEqual(['name', 'enabled']);
  });

  it('has name and enabled properties', () => {
    const props = Object.keys(toggleToolDefinition.parameters.properties);
    expect(props).toContain('name');
    expect(props).toContain('enabled');
  });

  it('enabled property is of type boolean', () => {
    expect(toggleToolDefinition.parameters.properties.enabled.type).toBe('boolean');
  });
});

// =============================================================================
// searchToolsDefinition
// =============================================================================

describe('searchToolsDefinition', () => {
  it('has name "search_tools"', () => {
    expect(searchToolsDefinition.name).toBe('search_tools');
  });

  it('has category "System"', () => {
    expect(searchToolsDefinition.category).toBe('System');
  });

  it('has required parameter "query"', () => {
    expect(searchToolsDefinition.parameters.required).toEqual(['query']);
  });

  it('has query, category, and include_params properties', () => {
    const props = Object.keys(searchToolsDefinition.parameters.properties);
    expect(props).toContain('query');
    expect(props).toContain('category');
    expect(props).toContain('include_params');
  });

  it('include_params is of type boolean', () => {
    expect(searchToolsDefinition.parameters.properties.include_params.type).toBe('boolean');
  });

  it('description mentions word-by-word AND matching', () => {
    expect(searchToolsDefinition.description).toContain('AND');
  });
});

// =============================================================================
// getToolHelpDefinition
// =============================================================================

describe('getToolHelpDefinition', () => {
  it('has name "get_tool_help"', () => {
    expect(getToolHelpDefinition.name).toBe('get_tool_help');
  });

  it('has category "System"', () => {
    expect(getToolHelpDefinition.category).toBe('System');
  });

  it('has tool_name and tool_names properties', () => {
    const props = Object.keys(getToolHelpDefinition.parameters.properties);
    expect(props).toContain('tool_name');
    expect(props).toContain('tool_names');
  });

  it('tool_names is of type array', () => {
    expect(getToolHelpDefinition.parameters.properties.tool_names.type).toBe('array');
  });

  it('has no required parameters', () => {
    expect(getToolHelpDefinition.parameters.required).toBeUndefined();
  });
});

// =============================================================================
// useToolDefinition
// =============================================================================

describe('useToolDefinition', () => {
  it('has name "use_tool"', () => {
    expect(useToolDefinition.name).toBe('use_tool');
  });

  it('has category "System"', () => {
    expect(useToolDefinition.category).toBe('System');
  });

  it('has required parameters: tool_name and arguments', () => {
    expect(useToolDefinition.parameters.required).toEqual(['tool_name', 'arguments']);
  });

  it('has tool_name and arguments properties', () => {
    const props = Object.keys(useToolDefinition.parameters.properties);
    expect(props).toContain('tool_name');
    expect(props).toContain('arguments');
  });

  it('arguments is of type object', () => {
    expect(useToolDefinition.parameters.properties.arguments.type).toBe('object');
  });

  it('description mentions qualified name', () => {
    expect(useToolDefinition.description).toContain('qualified name');
  });
});

// =============================================================================
// batchUseToolDefinition
// =============================================================================

describe('batchUseToolDefinition', () => {
  it('has name "batch_use_tool"', () => {
    expect(batchUseToolDefinition.name).toBe('batch_use_tool');
  });

  it('has category "System"', () => {
    expect(batchUseToolDefinition.category).toBe('System');
  });

  it('has required parameter "calls"', () => {
    expect(batchUseToolDefinition.parameters.required).toEqual(['calls']);
  });

  it('calls is of type array', () => {
    expect(batchUseToolDefinition.parameters.properties.calls.type).toBe('array');
  });

  it('calls items have tool_name and arguments properties', () => {
    const itemProps = batchUseToolDefinition.parameters.properties.calls.items;
    expect(itemProps).toBeDefined();
    expect(itemProps!.properties).toHaveProperty('tool_name');
    expect(itemProps!.properties).toHaveProperty('arguments');
  });

  it('calls items require tool_name and arguments', () => {
    const itemProps = batchUseToolDefinition.parameters.properties.calls.items;
    expect(itemProps!.required).toEqual(['tool_name', 'arguments']);
  });
});

// =============================================================================
// DYNAMIC_TOOL_DEFINITIONS
// =============================================================================

describe('DYNAMIC_TOOL_DEFINITIONS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DYNAMIC_TOOL_DEFINITIONS)).toBe(true);
    expect(DYNAMIC_TOOL_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it('contains exactly 10 definitions', () => {
    expect(DYNAMIC_TOOL_DEFINITIONS).toHaveLength(10);
  });

  it('includes all expected tool names', () => {
    const names = DYNAMIC_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('search_tools');
    expect(names).toContain('get_tool_help');
    expect(names).toContain('use_tool');
    expect(names).toContain('batch_use_tool');
    expect(names).toContain('create_tool');
    expect(names).toContain('list_custom_tools');
    expect(names).toContain('delete_custom_tool');
    expect(names).toContain('toggle_custom_tool');
    expect(names).toContain('inspect_tool_source');
    expect(names).toContain('update_custom_tool');
  });

  it('each definition has name, description, parameters, and category', () => {
    for (const def of DYNAMIC_TOOL_DEFINITIONS) {
      expect(def.name).toBeTypeOf('string');
      expect(def.description).toBeTypeOf('string');
      expect(def.parameters).toBeDefined();
      expect(def.category).toBeTypeOf('string');
    }
  });

  it('each definition parameters has type "object"', () => {
    for (const def of DYNAMIC_TOOL_DEFINITIONS) {
      expect(def.parameters.type).toBe('object');
    }
  });
});

// =============================================================================
// DYNAMIC_TOOL_NAMES
// =============================================================================

describe('DYNAMIC_TOOL_NAMES', () => {
  it('is an array of strings', () => {
    expect(Array.isArray(DYNAMIC_TOOL_NAMES)).toBe(true);
    for (const name of DYNAMIC_TOOL_NAMES) {
      expect(typeof name).toBe('string');
    }
  });

  it('matches DYNAMIC_TOOL_DEFINITIONS names in order', () => {
    const expected = DYNAMIC_TOOL_DEFINITIONS.map((d) => d.name);
    expect(DYNAMIC_TOOL_NAMES).toEqual(expected);
  });

  it('has the same length as DYNAMIC_TOOL_DEFINITIONS', () => {
    expect(DYNAMIC_TOOL_NAMES.length).toBe(DYNAMIC_TOOL_DEFINITIONS.length);
  });

  it('contains known tool names', () => {
    expect(DYNAMIC_TOOL_NAMES).toContain('search_tools');
    expect(DYNAMIC_TOOL_NAMES).toContain('create_tool');
    expect(DYNAMIC_TOOL_NAMES).toContain('use_tool');
    expect(DYNAMIC_TOOL_NAMES).toContain('batch_use_tool');
  });

  it('contains no duplicates', () => {
    expect(new Set(DYNAMIC_TOOL_NAMES).size).toBe(DYNAMIC_TOOL_NAMES.length);
  });
});

// ==========================================================================
// workflowUsable flag
// ==========================================================================

describe('workflowUsable flag', () => {
  it('all dynamic tool definitions are marked workflowUsable: false', () => {
    for (const def of DYNAMIC_TOOL_DEFINITIONS) {
      expect(def.workflowUsable, `${def.name} should have workflowUsable: false`).toBe(false);
    }
  });
});

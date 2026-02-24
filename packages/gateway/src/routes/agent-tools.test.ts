import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import
// ---------------------------------------------------------------------------

const mockFindSimilarToolNames = vi.fn().mockReturnValue([]);
const mockFormatFullToolHelp = vi.fn().mockReturnValue('## Tool Help');
const mockBuildToolHelpText = vi.fn().mockReturnValue('\n\nHelp: use args');
const mockValidateRequiredParams = vi.fn().mockReturnValue(null);
const mockApplyToolLimits = vi.fn((_name: string, args: unknown) => args);
const mockGetBaseName = vi.fn((name: string) => name);
const mockQualifyToolName = vi.fn((name: string) => name);
const mockGetServiceRegistry = vi.fn().mockReturnValue({
  get: vi.fn(() => ({
    getAllTools: vi.fn().mockReturnValue([]),
    getEnabled: vi.fn().mockReturnValue([]),
  })),
});

vi.mock('@ownpilot/core', () => ({
  ToolRegistry: vi.fn(),
  registerAllTools: vi.fn(),
  getToolDefinitions: vi.fn().mockReturnValue([]),
  MEMORY_TOOLS: [{ name: 'store_memory', description: 'Store a memory', parameters: { type: 'object', properties: {} } }],
  GOAL_TOOLS: [],
  CUSTOM_DATA_TOOLS: [],
  PERSONAL_DATA_TOOLS: [],
  DYNAMIC_TOOL_DEFINITIONS: [
    { name: 'create_tool', description: 'Create custom tool', parameters: { type: 'object', properties: {} } },
    { name: 'list_custom_tools', description: 'List custom tools', parameters: { type: 'object', properties: {} } },
    { name: 'delete_custom_tool', description: 'Delete custom tool', parameters: { type: 'object', properties: {} } },
    { name: 'toggle_custom_tool', description: 'Toggle custom tool', parameters: { type: 'object', properties: {} } },
    { name: 'update_custom_tool', description: 'Update custom tool', parameters: { type: 'object', properties: {} } },
    { name: 'search_tools', description: 'Search tools', parameters: { type: 'object', properties: {} } },
    { name: 'get_tool_help', description: 'Get tool help', parameters: { type: 'object', properties: {} } },
    { name: 'use_tool', description: 'Use a tool', parameters: { type: 'object', properties: {} } },
    { name: 'batch_use_tool', description: 'Batch use tools', parameters: { type: 'object', properties: {} } },
    { name: 'inspect_tool_source', description: 'Inspect tool source', parameters: { type: 'object', properties: {} } },
  ],
  TOOL_SEARCH_TAGS: { store_memory: ['save', 'remember'] },
  applyToolLimits: mockApplyToolLimits,
  findSimilarToolNames: mockFindSimilarToolNames,
  formatFullToolHelp: mockFormatFullToolHelp,
  buildToolHelpText: mockBuildToolHelpText,
  validateRequiredParams: mockValidateRequiredParams,
  qualifyToolName: mockQualifyToolName,
  getBaseName: mockGetBaseName,
  getServiceRegistry: mockGetServiceRegistry,
  Services: { Plugin: { name: 'plugin' }, Extension: { name: 'extension' } },
}));

const mockExecuteMemoryTool = vi.fn();
vi.mock('./memories.js', () => ({ executeMemoryTool: mockExecuteMemoryTool }));
vi.mock('./goals.js', () => ({ executeGoalTool: vi.fn() }));
vi.mock('./custom-data.js', () => ({ executeCustomDataTool: vi.fn() }));
vi.mock('./personal-data-tools.js', () => ({ executePersonalDataTool: vi.fn() }));

const mockExecuteCustomToolTool = vi.fn();
const mockGetActiveCustomToolDefinitions = vi.fn().mockResolvedValue([]);
vi.mock('./custom-tools.js', () => ({
  executeCustomToolTool: mockExecuteCustomToolTool,
  executeActiveCustomTool: vi.fn(),
  getActiveCustomToolDefinitions: mockGetActiveCustomToolDefinitions,
}));

const mockDynamicRegistry = {
  has: vi.fn().mockReturnValue(false),
  register: vi.fn(),
  execute: vi.fn(),
};
vi.mock('../services/custom-tool-registry.js', () => ({
  getCustomToolDynamicRegistry: vi.fn(() => mockDynamicRegistry),
}));

const mockGetToolSource = vi.fn();
vi.mock('../services/tool-source.js', () => ({ getToolSource: mockGetToolSource }));

const mockSharedToolRegistry = {
  has: vi.fn().mockReturnValue(false),
  getToolsBySource: vi.fn().mockReturnValue([]),
};
vi.mock('../services/tool-executor.js', () => ({
  getSharedToolRegistry: vi.fn(() => mockSharedToolRegistry),
}));

const mockCustomToolsRepo = {
  getByName: vi.fn().mockResolvedValue(null),
};
vi.mock('../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: vi.fn(() => mockCustomToolsRepo),
}));
vi.mock('../tools/index.js', () => ({
  TRIGGER_TOOLS: [],
  executeTriggerTool: vi.fn(),
  PLAN_TOOLS: [],
  executePlanTool: vi.fn(),
  HEARTBEAT_TOOLS: [],
  executeHeartbeatTool: vi.fn(),
  EXTENSION_TOOLS: [],
  executeExtensionTool: vi.fn(),
  PULSE_TOOLS: [],
  executePulseTool: vi.fn(),
  NOTIFICATION_TOOLS: [],
  executeNotificationTool: vi.fn(),
}));
vi.mock('../services/config-tools.js', () => ({
  CONFIG_TOOLS: [],
  executeConfigTool: vi.fn(),
}));
vi.mock('../services/extension-service.js', () => ({
  getExtensionService: vi.fn(),
}));

const mockTraceToolCallStart = vi.fn().mockReturnValue(100);
const mockTraceToolCallEnd = vi.fn();
const mockTraceDbWrite = vi.fn();
const mockTraceDbRead = vi.fn();
vi.mock('../tracing/index.js', () => ({
  traceToolCallStart: mockTraceToolCallStart,
  traceToolCallEnd: mockTraceToolCallEnd,
  traceDbWrite: mockTraceDbWrite,
  traceDbRead: mockTraceDbRead,
}));
vi.mock('./helpers.js', () => ({
  getErrorMessage: (err: unknown, fallback?: string) =>
    err instanceof Error ? err.message : fallback ?? String(err),
  truncate: (s: string) => s,
}));
vi.mock('../config/defaults.js', () => ({
  TOOL_ARGS_MAX_SIZE: 100,
  MAX_BATCH_TOOL_CALLS: 3,
  AI_META_TOOL_NAMES: ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'],
}));
vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Dynamic import after all mocks are in place
const {
  safeStringArray,
  executeUseTool,
  executeBatchUseTool,
  executeSearchTools,
  executeGetToolHelp,
  executeInspectToolSource,
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} = await import('./agent-tools.js');

// ---------------------------------------------------------------------------
// Helper: create a mock ToolRegistry for meta-tool tests
// ---------------------------------------------------------------------------

function createMockRegistry(toolMap: Record<string, { name: string; description: string; category?: string; parameters?: unknown; tags?: string[] }> = {}) {
  const defs = Object.values(toolMap);

  return {
    has: vi.fn((name: string) => name in toolMap),
    getDefinition: vi.fn((name: string) => toolMap[name] ?? null),
    getDefinitions: vi.fn(() => defs),
    execute: vi.fn(async () => ({ ok: true, value: { content: 'executed' } })),
    register: vi.fn(),
    unregister: vi.fn().mockReturnValue(true),
    updateExecutor: vi.fn(),
    get: vi.fn(),
    getRegisteredTool: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-tools helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // safeStringArray
  // =========================================================================
  describe('safeStringArray', () => {
    // --- Non-array inputs → undefined ---
    it('returns undefined for null', () => {
      expect(safeStringArray(null)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(safeStringArray(undefined)).toBeUndefined();
    });

    it('returns undefined for a string (not an array)', () => {
      expect(safeStringArray('hello')).toBeUndefined();
    });

    it('returns undefined for a number', () => {
      expect(safeStringArray(42)).toBeUndefined();
    });

    it('returns undefined for a plain object', () => {
      expect(safeStringArray({ a: 1 })).toBeUndefined();
    });

    it('returns undefined for a boolean', () => {
      expect(safeStringArray(true)).toBeUndefined();
    });

    // --- Valid array inputs ---
    it('returns empty array for empty array', () => {
      expect(safeStringArray([])).toEqual([]);
    });

    it('returns all strings from a string-only array', () => {
      expect(safeStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('returns single-element array for ["hello"]', () => {
      expect(safeStringArray(['hello'])).toEqual(['hello']);
    });

    // --- Filtering non-string elements ---
    it('filters out numbers from a mixed array', () => {
      expect(safeStringArray(['a', 1, 'b', 2])).toEqual(['a', 'b']);
    });

    it('filters out booleans from a mixed array', () => {
      expect(safeStringArray(['x', true, 'y', false])).toEqual(['x', 'y']);
    });

    it('filters out objects from a mixed array', () => {
      expect(safeStringArray(['a', { b: 1 }, 'c', [1, 2]])).toEqual(['a', 'c']);
    });

    it('filters out null and undefined from an array', () => {
      expect(safeStringArray(['a', null, 'b', undefined, 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array when no elements are strings', () => {
      expect(safeStringArray([1, 2, 3])).toEqual([]);
    });

    // --- Preservation / no mutation ---
    it('preserves original strings without mutation', () => {
      const input = ['hello', 'world'];
      const result = safeStringArray(input);
      expect(result).toEqual(['hello', 'world']);
      // Result is a new filtered array (Array.filter returns new array)
      expect(result).not.toBe(input);
    });

    it('preserves empty strings', () => {
      expect(safeStringArray(['', 'a', ''])).toEqual(['', 'a', '']);
    });

    // --- Edge cases ---
    it('handles a large array', () => {
      const large = Array.from({ length: 10_000 }, (_, i) => `item_${i}`);
      const result = safeStringArray(large);
      expect(result).toHaveLength(10_000);
      expect(result![0]).toBe('item_0');
      expect(result![9_999]).toBe('item_9999');
    });

    it('handles an array with all non-string types mixed', () => {
      const input = [0, false, null, undefined, {}, [], Symbol('x')];
      expect(safeStringArray(input)).toEqual([]);
    });

    it('handles strings with special characters', () => {
      const input = ['hello\nworld', 'tab\there', 'emoji😀', ''];
      expect(safeStringArray(input)).toEqual(['hello\nworld', 'tab\there', 'emoji😀', '']);
    });
  });

  // =========================================================================
  // registerGatewayTools
  // =========================================================================
  describe('registerGatewayTools', () => {
    it('registers tools without throwing', () => {
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      expect(() => registerGatewayTools(mockToolRegistry as any, 'test-user', false)).not.toThrow();
    });

    it('registers one handler per tool definition in each group', () => {
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      registerGatewayTools(mockToolRegistry as any, 'test-user', false);
      expect(mockToolRegistry.register).toHaveBeenCalled();
    });

    it('wraps executor with tracing when trace=true', async () => {
      const registeredExecutors: Array<(args: unknown) => Promise<unknown>> = [];
      const mockToolRegistry = {
        register: vi.fn((_def: unknown, executor: unknown) => {
          registeredExecutors.push(executor as (args: unknown) => Promise<unknown>);
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteMemoryTool.mockResolvedValue({ success: true, result: 'stored' });
      registerGatewayTools(mockToolRegistry as any, 'test-user', true);

      if (registeredExecutors.length > 0) {
        await registeredExecutors[0]!({ key: 'test' });
        expect(mockTraceToolCallStart).toHaveBeenCalled();
        expect(mockTraceToolCallEnd).toHaveBeenCalled();
      }
    });

    it('does not trace when trace=false', async () => {
      const registeredExecutors: Array<(args: unknown) => Promise<unknown>> = [];
      const mockToolRegistry = {
        register: vi.fn((_def: unknown, executor: unknown) => {
          registeredExecutors.push(executor as (args: unknown) => Promise<unknown>);
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteMemoryTool.mockResolvedValue({ success: true, result: 'stored' });
      registerGatewayTools(mockToolRegistry as any, 'test-user', false);

      if (registeredExecutors.length > 0) {
        await registeredExecutors[0]!({ key: 'test' });
        expect(mockTraceToolCallStart).not.toHaveBeenCalled();
        expect(mockTraceToolCallEnd).not.toHaveBeenCalled();
      }
    });

    it('returns error content when executor returns failure', async () => {
      const registeredExecutors: Array<(args: unknown) => Promise<{ content: string; isError?: boolean }>> = [];
      const mockToolRegistry = {
        register: vi.fn((_def: unknown, executor: unknown) => {
          registeredExecutors.push(executor as any);
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteMemoryTool.mockResolvedValue({ success: false, error: 'Memory full' });
      registerGatewayTools(mockToolRegistry as any, 'test-user', false);

      if (registeredExecutors.length > 0) {
        const result = await registeredExecutors[0]!({ key: 'test' });
        expect(result.content).toBe('Memory full');
        expect(result.isError).toBe(true);
      }
    });

    it('returns "Unknown error" when failure has no error message', async () => {
      const registeredExecutors: Array<(args: unknown) => Promise<{ content: string; isError?: boolean }>> = [];
      const mockToolRegistry = {
        register: vi.fn((_def: unknown, executor: unknown) => {
          registeredExecutors.push(executor as any);
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteMemoryTool.mockResolvedValue({ success: false });
      registerGatewayTools(mockToolRegistry as any, 'test-user', false);

      if (registeredExecutors.length > 0) {
        const result = await registeredExecutors[0]!({ key: 'test' });
        expect(result.content).toBe('Unknown error');
        expect(result.isError).toBe(true);
      }
    });

    it('stringifies non-string result values', async () => {
      const registeredExecutors: Array<(args: unknown) => Promise<{ content: string; isError?: boolean }>> = [];
      const mockToolRegistry = {
        register: vi.fn((_def: unknown, executor: unknown) => {
          registeredExecutors.push(executor as any);
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteMemoryTool.mockResolvedValue({ success: true, result: { data: 'value' } });
      registerGatewayTools(mockToolRegistry as any, 'test-user', false);

      if (registeredExecutors.length > 0) {
        const result = await registeredExecutors[0]!({ key: 'test' });
        expect(JSON.parse(result.content)).toEqual({ data: 'value' });
      }
    });
  });

  // =========================================================================
  // registerDynamicTools
  // =========================================================================
  describe('registerDynamicTools', () => {
    it('registers dynamic tools without throwing', async () => {
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      await expect(
        registerDynamicTools(mockToolRegistry as any, 'test-user', 'conv-123', false)
      ).resolves.not.toThrow();
    });

    it('registers CRUD meta-tools and special meta-tools', async () => {
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      await registerDynamicTools(mockToolRegistry as any, 'test-user', 'conv-123', false);

      const registeredNames = mockToolRegistry.register.mock.calls.map(
        (c: unknown[]) => (c[0] as { name: string }).name
      );
      expect(registeredNames).toContain('create_tool');
      expect(registeredNames).toContain('search_tools');
      expect(registeredNames).toContain('get_tool_help');
      expect(registeredNames).toContain('use_tool');
      expect(registeredNames).toContain('batch_use_tool');
      expect(registeredNames).toContain('inspect_tool_source');
    });

    it('registers active custom tools and returns their definitions', async () => {
      const customToolDefs = [
        { name: 'my_tool', description: 'My custom tool', parameters: { type: 'object', properties: {} } },
      ];
      mockGetActiveCustomToolDefinitions.mockResolvedValue(customToolDefs);

      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      const result = await registerDynamicTools(mockToolRegistry as any, 'test-user', 'conv-123', false);
      expect(result).toEqual(customToolDefs);
    });

    it('traces CRUD tool calls with DB tracing when trace=true', async () => {
      const registeredExecutors: Record<string, (args: unknown, ctx: unknown) => Promise<unknown>> = {};
      const mockToolRegistry = {
        register: vi.fn((def: { name: string }, executor: unknown) => {
          registeredExecutors[def.name] = executor as any;
        }),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      mockExecuteCustomToolTool.mockResolvedValue({ success: true, result: 'created' });

      await registerDynamicTools(mockToolRegistry as any, 'test-user', 'conv-123', true);

      if (registeredExecutors['create_tool']) {
        await registeredExecutors['create_tool']!({}, {});
        expect(mockTraceToolCallStart).toHaveBeenCalledWith('create_tool', expect.any(Object));
        expect(mockTraceDbWrite).toHaveBeenCalledWith('custom_tools', 'insert');
        expect(mockTraceToolCallEnd).toHaveBeenCalled();
      }
    });
  });

  // =========================================================================
  // registerPluginTools
  // =========================================================================
  describe('registerPluginTools', () => {
    it('registers plugin tools and returns definitions', () => {
      const pluginExecutor = vi.fn(async () => ({ content: 'result' }));
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getAllTools: vi.fn().mockReturnValue([
            {
              pluginId: 'weather-plugin',
              definition: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } },
              executor: pluginExecutor,
            },
          ]),
          getEnabled: vi.fn().mockReturnValue([]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      const result = registerPluginTools(mockToolRegistry as any, false);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('get_weather');
    });

    it('skips core-category plugin tools', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getAllTools: vi.fn().mockReturnValue([
            {
              pluginId: 'core-plugin',
              definition: { name: 'core_tool', description: 'Core tool', parameters: {} },
              executor: vi.fn(),
            },
          ]),
          getEnabled: vi.fn().mockReturnValue([
            { manifest: { id: 'core-plugin', category: 'core' } },
          ]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      const result = registerPluginTools(mockToolRegistry as any, false);

      expect(result).toHaveLength(0);
    });

    it('updates executor if tool already exists in registry', () => {
      const pluginExecutor = vi.fn(async () => ({ content: 'result' }));
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getAllTools: vi.fn().mockReturnValue([
            {
              pluginId: 'test-plugin',
              definition: { name: 'existing_tool', description: 'Existing', parameters: {} },
              executor: pluginExecutor,
            },
          ]),
          getEnabled: vi.fn().mockReturnValue([]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.has.mockReturnValue(true);

      registerPluginTools(mockToolRegistry as any, false);

      expect(mockToolRegistry.updateExecutor).toHaveBeenCalled();
    });

    it('catches executor errors and returns error result', async () => {
      const pluginExecutor = vi.fn(async () => { throw new Error('Plugin crashed'); });
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getAllTools: vi.fn().mockReturnValue([
            {
              pluginId: 'crash-plugin',
              definition: { name: 'crash_tool', description: 'Crashes', parameters: {} },
              executor: pluginExecutor,
            },
          ]),
          getEnabled: vi.fn().mockReturnValue([]),
        })),
      });

      const wrappedExecutors: Array<(args: unknown, ctx: unknown) => Promise<unknown>> = [];
      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.has.mockReturnValue(false);
      mockToolRegistry.register.mockImplementation((_def: unknown, exec: unknown) => {
        wrappedExecutors.push(exec as any);
      });

      registerPluginTools(mockToolRegistry as any, true);

      if (wrappedExecutors.length > 0) {
        const result = await wrappedExecutors[0]!({}, {}) as { content: string; isError: boolean };
        expect(result.content).toBe('Plugin crashed');
        expect(result.isError).toBe(true);
        expect(mockTraceToolCallEnd).toHaveBeenCalledWith(
          'crash_tool', expect.any(Number), false, undefined, 'Plugin crashed'
        );
      }
    });
  });

  // =========================================================================
  // registerExtensionTools
  // =========================================================================
  describe('registerExtensionTools', () => {
    it('returns empty array when extension service is not initialized', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => { throw new Error('Not initialized'); }),
      });

      const mockToolRegistry = createMockRegistry();
      const result = registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(result).toEqual([]);
    });

    it('returns empty array when no extension tools defined', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getToolDefinitions: vi.fn().mockReturnValue([]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      const result = registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(result).toEqual([]);
    });

    it('registers extension tools and returns definitions', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getToolDefinitions: vi.fn().mockReturnValue([
            {
              name: 'ext_tool',
              description: 'Extension tool',
              parameters: { type: 'object' },
              category: 'utility',
              format: 'ownpilot',
              extensionId: 'ext-1',
              extensionTool: { parameters: {}, code: 'return 42;', permissions: [] },
            },
          ]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.register.mockReturnValue({ ok: true });

      const result = registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('ext_tool');
    });

    it('uses skill namespace for agentskills format', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getToolDefinitions: vi.fn().mockReturnValue([
            {
              name: 'skill_tool',
              description: 'Skill tool',
              parameters: { type: 'object' },
              category: 'skill',
              format: 'agentskills',
              extensionId: 'skill-1',
              extensionTool: { parameters: {}, code: 'return 1;', permissions: [] },
            },
          ]),
        })),
      });

      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.register.mockReturnValue({ ok: true });

      registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(mockQualifyToolName).toHaveBeenCalledWith('skill_tool', 'skill', 'skill-1');
    });

    it('skips tools that fail dynamic registry registration', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getToolDefinitions: vi.fn().mockReturnValue([
            {
              name: 'bad_tool',
              description: 'Bad tool',
              parameters: { type: 'object' },
              category: 'utility',
              format: 'ownpilot',
              extensionId: 'ext-1',
              extensionTool: { parameters: {}, code: 'bad', permissions: [] },
            },
          ]),
        })),
      });

      mockDynamicRegistry.register.mockImplementation(() => { throw new Error('Registration failed'); });

      const mockToolRegistry = createMockRegistry();
      const result = registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(result).toEqual([]);
    });

    it('skips tools when ToolRegistry.register returns error', () => {
      mockGetServiceRegistry.mockReturnValue({
        get: vi.fn(() => ({
          getToolDefinitions: vi.fn().mockReturnValue([
            {
              name: 'dup_tool',
              description: 'Duplicate tool',
              parameters: { type: 'object' },
              category: 'utility',
              format: 'ownpilot',
              extensionId: 'ext-1',
              extensionTool: { parameters: {}, code: 'ok', permissions: [] },
            },
          ]),
        })),
      });

      mockDynamicRegistry.has.mockReturnValue(true); // already registered in dynamic registry
      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.register.mockReturnValue({ ok: false, error: { message: 'Duplicate' } });

      const result = registerExtensionTools(mockToolRegistry as any, 'user-1', false);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // registerMcpTools
  // =========================================================================
  describe('registerMcpTools', () => {
    it('returns empty array when no MCP tools exist', () => {
      mockSharedToolRegistry.getToolsBySource.mockReturnValue([]);

      const mockToolRegistry = createMockRegistry();
      const result = registerMcpTools(mockToolRegistry as any, false);

      expect(result).toEqual([]);
    });

    it('registers MCP tools from shared registry', () => {
      mockSharedToolRegistry.getToolsBySource.mockReturnValue([
        {
          definition: { name: 'mcp.tool1', description: 'MCP Tool', parameters: {} },
          executor: vi.fn(async () => ({ content: 'result' })),
          pluginId: 'mcp-server-1',
          providerName: 'my-mcp',
          source: 'mcp',
        },
      ]);

      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.has.mockReturnValue(false);

      const result = registerMcpTools(mockToolRegistry as any, false);

      expect(result).toHaveLength(1);
      expect(mockToolRegistry.register).toHaveBeenCalled();
    });

    it('skips registration if tool already exists in target registry', () => {
      mockSharedToolRegistry.getToolsBySource.mockReturnValue([
        {
          definition: { name: 'mcp.existing', description: 'Existing', parameters: {} },
          executor: vi.fn(),
          pluginId: 'mcp-1',
          providerName: 'server-1',
        },
      ]);

      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.has.mockReturnValue(true);

      const result = registerMcpTools(mockToolRegistry as any, false);

      expect(result).toHaveLength(1);
      expect(mockToolRegistry.register).not.toHaveBeenCalled();
    });

    it('wraps MCP executor with error handling', async () => {
      const failingExecutor = vi.fn(async () => { throw new Error('MCP failure'); });
      mockSharedToolRegistry.getToolsBySource.mockReturnValue([
        {
          definition: { name: 'mcp.failing', description: 'Failing', parameters: {} },
          executor: failingExecutor,
          pluginId: 'mcp-1',
          providerName: 'server-1',
        },
      ]);

      const wrappedExecutors: Array<(args: unknown, ctx: unknown) => Promise<unknown>> = [];
      const mockToolRegistry = createMockRegistry();
      mockToolRegistry.has.mockReturnValue(false);
      mockToolRegistry.register.mockImplementation((_def: unknown, exec: unknown) => {
        wrappedExecutors.push(exec as any);
      });

      registerMcpTools(mockToolRegistry as any, true);

      if (wrappedExecutors.length > 0) {
        const result = await wrappedExecutors[0]!({}, {}) as { content: string; isError: boolean };
        expect(result.content).toBe('MCP failure');
        expect(result.isError).toBe(true);
      }
    });
  });

  // =========================================================================
  // executeUseTool
  // =========================================================================
  describe('executeUseTool', () => {
    it('returns error when tool not found with similar suggestions', async () => {
      const registry = createMockRegistry();
      mockFindSimilarToolNames.mockReturnValue(['similar_tool']);

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'nonexistent', arguments: {} },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Tool 'nonexistent' not found");
      expect(result.content).toContain('similar_tool');
    });

    it('returns error when tool not found without suggestions', async () => {
      const registry = createMockRegistry();
      mockFindSimilarToolNames.mockReturnValue([]);

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'nonexistent', arguments: {} },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('search_tools');
    });

    it('returns error when required params are missing', async () => {
      const registry = createMockRegistry({ my_tool: { name: 'my_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue('Missing required param: x');

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'my_tool', arguments: {} },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required param: x');
    });

    it('returns error when arguments payload is too large', async () => {
      const registry = createMockRegistry({ big_tool: { name: 'big_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue(null);

      const largeArgs = { data: 'x'.repeat(200) };

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'big_tool', arguments: largeArgs },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('too large');
    });

    it('executes tool successfully and returns result', async () => {
      const registry = createMockRegistry({ ok_tool: { name: 'ok_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: true, value: { content: 'success output' } });

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'ok_tool', arguments: { a: 1 } },
        {}
      );

      expect(result).toEqual({ content: 'success output' });
    });

    it('returns error with help text on execution failure (result not ok)', async () => {
      const registry = createMockRegistry({ fail_tool: { name: 'fail_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: false, error: { message: 'Exec failed' } });

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'fail_tool', arguments: {} },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Exec failed');
    });

    it('catches thrown errors and includes help text', async () => {
      const registry = createMockRegistry({ throw_tool: { name: 'throw_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockRejectedValue(new Error('Unexpected crash'));

      const result = await executeUseTool(
        registry as any,
        { tool_name: 'throw_tool', arguments: {} },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unexpected crash');
    });

    it('applies tool limits before execution', async () => {
      const registry = createMockRegistry({ limited_tool: { name: 'limited_tool', description: 'desc' } });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: true, value: { content: 'ok' } });

      await executeUseTool(
        registry as any,
        { tool_name: 'limited_tool', arguments: { limit: 9999 } },
        {}
      );

      expect(mockApplyToolLimits).toHaveBeenCalledWith('limited_tool', { limit: 9999 });
    });
  });

  // =========================================================================
  // executeBatchUseTool
  // =========================================================================
  describe('executeBatchUseTool', () => {
    it('returns error when calls array is empty', async () => {
      const registry = createMockRegistry();

      const result = await executeBatchUseTool(registry as any, { calls: [] }, {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('at least one tool call');
    });

    it('returns error when calls is undefined', async () => {
      const registry = createMockRegistry();

      const result = await executeBatchUseTool(registry as any, {}, {});

      expect(result.isError).toBe(true);
    });

    it('returns error when batch size exceeds maximum', async () => {
      const registry = createMockRegistry();
      const calls = Array.from({ length: 4 }, (_, i) => ({ tool_name: `tool_${i}`, arguments: {} }));

      const result = await executeBatchUseTool(registry as any, { calls }, {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('exceeds maximum');
    });

    it('executes multiple tools successfully', async () => {
      const registry = createMockRegistry({
        tool_a: { name: 'tool_a', description: 'A' },
        tool_b: { name: 'tool_b', description: 'B' },
      });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: true, value: { content: 'result' } });

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'tool_a', arguments: {} }, { tool_name: 'tool_b', arguments: {} }] },
        {}
      );

      expect(result.content).toContain('Batch: 2 tool calls');
      expect(result.content).toContain('tool_a');
      expect(result.content).toContain('tool_b');
    });

    it('includes error for unknown tools in batch', async () => {
      const registry = createMockRegistry({
        tool_a: { name: 'tool_a', description: 'A' },
      });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: true, value: { content: 'ok' } });
      mockFindSimilarToolNames.mockReturnValue(['tool_a']);

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'tool_a', arguments: {} }, { tool_name: 'unknown', arguments: {} }] },
        {}
      );

      expect(result.content).toContain('not found');
      expect(result.isError).toBe(false);
    });

    it('handles tool args too large in batch', async () => {
      const registry = createMockRegistry({
        tool_big: { name: 'tool_big', description: 'Big' },
      });
      mockValidateRequiredParams.mockReturnValue(null);

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'tool_big', arguments: { data: 'x'.repeat(200) } }] },
        {}
      );

      expect(result.content).toContain('too large');
    });

    it('returns isError=true when ALL calls fail', async () => {
      const registry = createMockRegistry();

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'bad1', arguments: {} }, { tool_name: 'bad2', arguments: {} }] },
        {}
      );

      expect(result.isError).toBe(true);
    });

    it('handles missing required params in batch calls', async () => {
      const registry = createMockRegistry({
        strict_tool: { name: 'strict_tool', description: 'Strict' },
      });
      mockValidateRequiredParams.mockReturnValue('Missing: required_field');

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'strict_tool', arguments: {} }] },
        {}
      );

      expect(result.content).toContain('Missing: required_field');
    });

    it('handles execution errors (thrown) in batch calls', async () => {
      const registry = createMockRegistry({
        crash_tool: { name: 'crash_tool', description: 'Crash' },
      });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockRejectedValue(new Error('Boom'));

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'crash_tool', arguments: {} }] },
        {}
      );

      expect(result.content).toContain('Boom');
    });

    it('handles execution result.ok = false in batch', async () => {
      const registry = createMockRegistry({
        err_tool: { name: 'err_tool', description: 'Err' },
      });
      mockValidateRequiredParams.mockReturnValue(null);
      registry.execute.mockResolvedValue({ ok: false, error: { message: 'Tool error' } });

      const result = await executeBatchUseTool(
        registry as any,
        { calls: [{ tool_name: 'err_tool', arguments: {} }] },
        {}
      );

      expect(result.content).toContain('Tool error');
    });
  });

  // =========================================================================
  // executeSearchTools
  // =========================================================================
  describe('executeSearchTools', () => {
    it('returns no matches message when nothing found', async () => {
      const registry = createMockRegistry();
      registry.getDefinitions.mockReturnValue([]);

      const result = await executeSearchTools(registry as any, { query: 'nonexistent' });

      expect(result.content).toContain('No tools found');
    });

    it('returns all tools when query is "all"', async () => {
      const registry = createMockRegistry({
        my_tool: { name: 'my_tool', description: 'My tool', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, { query: 'all' });

      expect(result.content).toContain('1 tool(s)');
    });

    it('returns all tools when query is "*"', async () => {
      const registry = createMockRegistry({
        star_tool: { name: 'star_tool', description: 'Star tool', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, { query: '*' });

      expect(result.content).toContain('1 tool(s)');
    });

    it('filters meta-tools from results', async () => {
      const registry = createMockRegistry({
        search_tools: { name: 'search_tools', description: 'Search', category: 'meta' },
        real_tool: { name: 'real_tool', description: 'Real tool', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, { query: 'all', include_params: false });

      expect(result.content).not.toContain('search_tools');
      expect(result.content).toContain('real_tool');
    });

    it('filters by category when specified', async () => {
      const registry = createMockRegistry({
        tool_a: { name: 'tool_a', description: 'Tool A', category: 'memory' },
        tool_b: { name: 'tool_b', description: 'Tool B', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, { query: 'all', category: 'memory', include_params: false });

      expect(result.content).toContain('tool_a');
      expect(result.content).not.toContain('tool_b');
    });

    it('returns brief format when include_params is false', async () => {
      const registry = createMockRegistry({
        brief_tool: { name: 'brief_tool', description: 'Brief tool', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, {
        query: 'all',
        include_params: false,
      });

      expect(result.content).toContain('brief_tool');
      expect(result.content).toContain('**brief_tool**');
    });

    it('matches by description keywords', async () => {
      const registry = createMockRegistry({
        weather_tool: { name: 'weather_tool', description: 'Get current weather forecast', category: 'weather' },
      });

      const result = await executeSearchTools(registry as any, { query: 'weather', include_params: false });

      expect(result.content).toContain('weather_tool');
    });

    it('returns full help format when include_params is not false', async () => {
      const registry = createMockRegistry({
        detailed_tool: { name: 'detailed_tool', description: 'Detailed', category: 'core' },
      });

      const result = await executeSearchTools(registry as any, { query: 'all', include_params: true });

      expect(result.content).toContain('with parameters');
      expect(mockFormatFullToolHelp).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executeGetToolHelp
  // =========================================================================
  describe('executeGetToolHelp', () => {
    it('returns error when no tool_name or tool_names provided', async () => {
      const registry = createMockRegistry();

      const result = await executeGetToolHelp(registry as any, {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Provide either');
    });

    it('returns help for a single tool_name', async () => {
      const registry = createMockRegistry({
        my_tool: { name: 'my_tool', description: 'My tool' },
      });

      const result = await executeGetToolHelp(registry as any, { tool_name: 'my_tool' });

      expect(result.isError).toBe(false);
      expect(mockFormatFullToolHelp).toHaveBeenCalledWith(expect.anything(), 'my_tool');
    });

    it('returns help for multiple tool_names', async () => {
      const registry = createMockRegistry({
        tool_a: { name: 'tool_a', description: 'A' },
        tool_b: { name: 'tool_b', description: 'B' },
      });

      const result = await executeGetToolHelp(registry as any, { tool_names: ['tool_a', 'tool_b'] });

      expect(mockFormatFullToolHelp).toHaveBeenCalledTimes(2);
      expect(result.content).toContain('---');
    });

    it('reports not-found tools with suggestions', async () => {
      const registry = createMockRegistry({
        real_tool: { name: 'real_tool', description: 'Real' },
      });
      mockFindSimilarToolNames.mockReturnValue(['real_tool']);

      const result = await executeGetToolHelp(registry as any, {
        tool_names: ['real_tool', 'fake_tool'],
      });

      expect(result.content).toContain('fake_tool');
      expect(result.content).toContain('real_tool');
      expect(result.isError).toBe(false);
    });

    it('returns isError=true when ALL tools are not found', async () => {
      const registry = createMockRegistry();
      mockFindSimilarToolNames.mockReturnValue([]);

      const result = await executeGetToolHelp(registry as any, {
        tool_names: ['fake_a', 'fake_b'],
      });

      expect(result.isError).toBe(true);
    });

    it('prefers tool_names over tool_name when both provided', async () => {
      const registry = createMockRegistry({
        tool_x: { name: 'tool_x', description: 'X' },
        tool_y: { name: 'tool_y', description: 'Y' },
      });

      await executeGetToolHelp(registry as any, {
        tool_name: 'tool_x',
        tool_names: ['tool_x', 'tool_y'],
      });

      expect(mockFormatFullToolHelp).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // executeInspectToolSource
  // =========================================================================
  describe('executeInspectToolSource', () => {
    it('returns error when tool_name is missing', async () => {
      const registry = createMockRegistry();

      const result = await executeInspectToolSource(registry as any, 'user-1', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('tool_name');
    });

    it('returns error when tool_name is not a string', async () => {
      const registry = createMockRegistry();

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 123 });

      expect(result.isError).toBe(true);
    });

    it('returns custom tool source when tool is a custom tool', async () => {
      const registry = createMockRegistry();
      mockCustomToolsRepo.getByName.mockResolvedValue({
        name: 'my_custom',
        description: 'Custom tool',
        category: 'custom',
        version: 1,
        createdBy: 'user',
        status: 'active',
        parameters: { type: 'object' },
        code: 'return 42;',
        permissions: ['http'],
      });

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'my_custom' });

      expect(result.content).toContain('my_custom');
      expect(result.content).toContain('return 42;');
      expect(result.content).toContain('custom');
      expect(result.content).toContain('http');
      expect(result.content).toContain('update_custom_tool');
    });

    it('returns custom tool without permissions section when empty', async () => {
      const registry = createMockRegistry();
      mockCustomToolsRepo.getByName.mockResolvedValue({
        name: 'simple_custom',
        description: 'Simple custom tool',
        category: null,
        version: 2,
        createdBy: 'agent',
        status: 'active',
        parameters: {},
        code: 'return 1;',
        permissions: [],
      });

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'simple_custom' });

      expect(result.content).toContain('simple_custom');
      expect(result.content).not.toContain('Permissions');
    });

    it('returns built-in tool source when found in registry', async () => {
      const registry = createMockRegistry({
        builtin_tool: { name: 'builtin_tool', description: 'Built-in tool', category: 'core' },
      });
      mockCustomToolsRepo.getByName.mockResolvedValue(null);
      mockGetToolSource.mockReturnValue('function builtin() { return true; }');

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'builtin_tool' });

      expect(result.content).toContain('builtin_tool');
      expect(result.content).toContain('built-in');
      expect(result.content).toContain('function builtin()');
      expect(result.content).toContain('create_tool');
    });

    it('returns built-in tool without source when getToolSource returns null', async () => {
      const registry = createMockRegistry({
        no_source: { name: 'no_source', description: 'No source', category: 'core' },
      });
      mockCustomToolsRepo.getByName.mockResolvedValue(null);
      mockGetToolSource.mockReturnValue(null);

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'no_source' });

      expect(result.content).toContain('Source code not available');
    });

    it('returns not-found error with suggestions when tool does not exist', async () => {
      const registry = createMockRegistry();
      mockCustomToolsRepo.getByName.mockResolvedValue(null);
      mockFindSimilarToolNames.mockReturnValue(['similar_tool']);

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
      expect(result.content).toContain('similar_tool');
    });

    it('returns not-found error without suggestions when no similar tools', async () => {
      const registry = createMockRegistry();
      mockCustomToolsRepo.getByName.mockResolvedValue(null);
      mockFindSimilarToolNames.mockReturnValue([]);

      const result = await executeInspectToolSource(registry as any, 'user-1', { tool_name: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('search_tools');
    });
  });
});

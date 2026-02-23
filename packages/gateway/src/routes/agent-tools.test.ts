import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', () => ({
  ToolRegistry: vi.fn(),
  registerAllTools: vi.fn(),
  getToolDefinitions: vi.fn().mockReturnValue([]),
  MEMORY_TOOLS: [],
  GOAL_TOOLS: [],
  CUSTOM_DATA_TOOLS: [],
  PERSONAL_DATA_TOOLS: [],
  DYNAMIC_TOOL_DEFINITIONS: [],
  TOOL_SEARCH_TAGS: {},
  applyToolLimits: vi.fn((_name: string, args: unknown) => args),
  findSimilarToolNames: vi.fn().mockReturnValue([]),
  formatFullToolHelp: vi.fn().mockReturnValue(''),
  buildToolHelpText: vi.fn().mockReturnValue(''),
  validateRequiredParams: vi.fn().mockReturnValue(null),
  qualifyToolName: vi.fn((name: string) => name),
  getBaseName: vi.fn((name: string) => name),
  getServiceRegistry: vi.fn().mockReturnValue({ get: vi.fn() }),
  Services: { Plugin: 'plugin' },
}));

vi.mock('./memories.js', () => ({ executeMemoryTool: vi.fn() }));
vi.mock('./goals.js', () => ({ executeGoalTool: vi.fn() }));
vi.mock('./custom-data.js', () => ({ executeCustomDataTool: vi.fn() }));
vi.mock('./personal-data-tools.js', () => ({ executePersonalDataTool: vi.fn() }));
vi.mock('./custom-tools.js', () => ({
  executeCustomToolTool: vi.fn(),
  executeActiveCustomTool: vi.fn(),
  getActiveCustomToolDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/custom-tool-registry.js', () => ({
  getCustomToolDynamicRegistry: vi.fn(),
}));
vi.mock('../services/tool-source.js', () => ({ getToolSource: vi.fn() }));
vi.mock('../services/tool-executor.js', () => ({ getSharedToolRegistry: vi.fn() }));
vi.mock('../db/repositories/custom-tools.js', () => ({ createCustomToolsRepo: vi.fn() }));
vi.mock('../tools/index.js', () => ({
  TRIGGER_TOOLS: [],
  executeTriggerTool: vi.fn(),
  PLAN_TOOLS: [],
  executePlanTool: vi.fn(),
  HEARTBEAT_TOOLS: [],
  executeHeartbeatTool: vi.fn(),
  EXTENSION_TOOLS: [],
  executeExtensionTool: vi.fn(),
}));
vi.mock('../services/config-tools.js', () => ({
  CONFIG_TOOLS: [],
  executeConfigTool: vi.fn(),
}));
vi.mock('../services/extension-service.js', () => ({
  getExtensionService: vi.fn(),
}));
vi.mock('../tracing/index.js', () => ({
  traceToolCallStart: vi.fn(),
  traceToolCallEnd: vi.fn(),
  traceDbWrite: vi.fn(),
  traceDbRead: vi.fn(),
}));
vi.mock('./helpers.js', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  truncate: (s: string) => s,
}));
vi.mock('../config/defaults.js', () => ({
  TOOL_ARGS_MAX_SIZE: 100_000,
  MAX_BATCH_TOOL_CALLS: 20,
  AI_META_TOOL_NAMES: ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'],
}));
vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Dynamic import after all mocks are in place
const { safeStringArray } = await import('./agent-tools.js');

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
    it('registers tools without throwing', async () => {
      const { registerGatewayTools } = await import('./agent-tools.js');
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      // Should not throw
      expect(() => registerGatewayTools(mockToolRegistry as any, 'test-user', false)).not.toThrow();
    });
  });

  // =========================================================================
  // registerDynamicTools
  // =========================================================================
  describe('registerDynamicTools', () => {
    it('registers dynamic tools without throwing', async () => {
      const { registerDynamicTools } = await import('./agent-tools.js');
      const mockToolRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        has: vi.fn(),
        execute: vi.fn(),
        list: vi.fn(),
      };

      // Should not throw
      await expect(
        registerDynamicTools(mockToolRegistry as any, 'test-user', 'conv-123', false)
      ).resolves.not.toThrow();
    });
  });
});

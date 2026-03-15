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
  setConfigCenter: vi.fn(),
  registerProvider: vi.fn(),
  setConfigRegistrationHandler: vi.fn(),
  use: vi.fn(),
  registerPluginTools: vi.fn(),
  unregisterPluginTools: vi.fn(),
  register: vi.fn(),
  registerCustomTool: vi.fn(),
  getAllTools: vi.fn(() => []),
};

const mockPluginService = {
  getTool: vi.fn(),
  getEnabled: vi.fn(() => [] as unknown[]),
  get: vi.fn(),
};

const mockEventSystem = {
  onAny: vi.fn(),
};

const mockExtensionService = {
  getToolDefinitions: vi.fn(() => [] as unknown[]),
};

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    ToolRegistry: vi.fn(function () {
      return mockToolRegistry;
    }),
    registerAllTools: vi.fn(),
    registerCoreTools: vi.fn(),
    hasServiceRegistry: vi.fn(() => true),
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        if (token.name === 'plugin') return mockPluginService;
        if (token.name === 'event') return mockEventSystem;
        if (token.name === 'extension') return mockExtensionService;
        return undefined;
      }),
      tryGet: vi.fn(() => undefined),
    })),
    createPluginId: vi.fn((id: string) => id),
    qualifyToolName: vi.fn((name: string, ns: string, extId: string) => `${ns}.${extId}.${name}`),
    Services: {
      ...(actual as Record<string, unknown>)['Services'],
      Plugin: { name: 'plugin' },
      Event: { name: 'event' },
      Audit: { name: 'audit' },
      Extension: { name: 'extension' },
    },
  };
});

const mockDynamicRegistry = {
  register: vi.fn(),
  execute: vi.fn(),
  has: vi.fn(() => false),
  setCallableTools: vi.fn(),
};

vi.mock('./custom-tool-registry.js', () => ({
  getCustomToolDynamicRegistry: vi.fn(() => mockDynamicRegistry),
  setSharedRegistryForCustomTools: vi.fn(),
}));

const mockCustomToolsRepo = {
  getActiveTools: vi.fn(async () => [] as unknown[]),
};

vi.mock('../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: vi.fn(() => mockCustomToolsRepo),
}));

vi.mock('./image-overrides.js', () => ({ registerImageOverrides: vi.fn(async () => {}) }));
vi.mock('./email-overrides.js', () => ({ registerEmailOverrides: vi.fn(async () => {}) }));
vi.mock('./audio-overrides.js', () => ({ registerAudioOverrides: vi.fn(async () => {}) }));

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: {
    getById: vi.fn(() => ({
      id: 'ext-default',
      manifest: {},
      grantedPermissions: [],
    })),
  },
}));

const mockSandbox = {
  execute: vi.fn(),
  setCallToolHandler: vi.fn(),
};

vi.mock('./extension-sandbox.js', () => ({
  getExtensionSandbox: vi.fn(() => mockSandbox),
}));

vi.mock('./tool-permission-service.js', () => ({
  checkToolPermission: vi.fn(async () => ({ allowed: true, reason: '' })),
}));

vi.mock('./config-center-impl.js', () => ({
  gatewayConfigCenter: { mocked: true },
}));

const mockMemoryProvider = { name: 'memory', getTools: vi.fn(() => []) };
const mockGoalProvider = { name: 'goal', getTools: vi.fn(() => []) };
const mockCustomDataProvider = { name: 'custom-data', getTools: vi.fn(() => []) };
const mockPersonalDataProvider = { name: 'personal-data', getTools: vi.fn(() => []) };
const mockTriggerProvider = { name: 'trigger', getTools: vi.fn(() => []) };
const mockPlanProvider = { name: 'plan', getTools: vi.fn(() => []) };
const mockConfigProvider = { name: 'config', getTools: vi.fn(() => []) };
const mockHeartbeatProvider = { name: 'heartbeat', getTools: vi.fn(() => []) };
const mockExtensionProvider = { name: 'extension', getTools: vi.fn(() => []) };
const mockCodingAgentProvider = { name: 'coding-agent', getTools: vi.fn(() => []) };
const mockCliToolProvider = { name: 'cli-tools', getTools: vi.fn(() => []) };
const mockBackgroundAgentProvider = { name: 'background-agent', getTools: vi.fn(() => []) };
const mockBrowserProvider = { name: 'browser', getTools: vi.fn(() => []) };
const mockEdgeProvider = { name: 'edge', getTools: vi.fn(() => []) };
const mockSkillProvider = { name: 'skill', getTools: vi.fn(() => []) };
const mockFleetProvider = { name: 'fleet', getTools: vi.fn(() => []) };

vi.mock('./tool-providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createMemoryToolProvider: vi.fn(() => mockMemoryProvider),
    createGoalToolProvider: vi.fn(() => mockGoalProvider),
    createCustomDataToolProvider: vi.fn(() => mockCustomDataProvider),
    createPersonalDataToolProvider: vi.fn(() => mockPersonalDataProvider),
    createTriggerToolProvider: vi.fn(() => mockTriggerProvider),
    createPlanToolProvider: vi.fn(() => mockPlanProvider),
    createConfigToolProvider: vi.fn(() => mockConfigProvider),
    createHeartbeatToolProvider: vi.fn(() => mockHeartbeatProvider),
    createExtensionToolProvider: vi.fn(() => mockExtensionProvider),
    createCodingAgentToolProvider: vi.fn(() => mockCodingAgentProvider),
    createCliToolProvider: vi.fn(() => mockCliToolProvider),
    createBackgroundAgentToolProvider: vi.fn(() => mockBackgroundAgentProvider),
    createBrowserToolProvider: vi.fn(() => mockBrowserProvider),
    createEdgeToolProvider: vi.fn(() => mockEdgeProvider),
    createSkillToolProvider: vi.fn(() => mockSkillProvider),
    createFleetToolProvider: vi.fn(() => mockFleetProvider),
  };
});

import {
  getSharedToolRegistry,
  executeTool,
  hasTool,
  resetSharedToolRegistry,
  waitForToolSync,
} from './tool-executor.js';
import { ToolRegistry, registerAllTools, registerCoreTools } from '@ownpilot/core';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
  createConfigToolProvider,
  createHeartbeatToolProvider,
  createExtensionToolProvider,
  createCodingAgentToolProvider,
  createBackgroundAgentToolProvider,
  createBrowserToolProvider,
  createEdgeToolProvider,
  createSkillToolProvider,
  createFleetToolProvider,
} from './tool-providers/index.js';
import { checkToolPermission } from './tool-permission-service.js';
import {
  getCustomToolDynamicRegistry,
  setSharedRegistryForCustomTools,
} from './custom-tool-registry.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import { getServiceRegistry, hasServiceRegistry } from '@ownpilot/core';
import { registerImageOverrides } from './image-overrides.js';
import { registerEmailOverrides } from './email-overrides.js';
import { registerAudioOverrides } from './audio-overrides.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedToolRegistry();
    // Restore default implementations — vi.clearAllMocks() clears call history but NOT mockReturnValue overrides
    mockCustomToolsRepo.getActiveTools.mockResolvedValue([]);
    mockExtensionService.getToolDefinitions.mockReturnValue([]);
    mockDynamicRegistry.has.mockReturnValue(false);
    mockPluginService.getEnabled.mockReturnValue([]);
    // Reset mockToolRegistry.has — vi.clearAllMocks() clears calls but not mockReturnValue overrides
    mockToolRegistry.has.mockReset();
    // Restore functions overridden by individual tests
    vi.mocked(hasServiceRegistry).mockReturnValue(true);
    // Restore getServiceRegistry to default mock (tests may override it via mockReturnValue)
    vi.mocked(getServiceRegistry).mockReturnValue({
      get: vi.fn((token: { name: string }) => {
        if (token.name === 'plugin') return mockPluginService;
        if (token.name === 'event') return mockEventSystem;
        if (token.name === 'extension') return mockExtensionService;
        return undefined;
      }),
      tryGet: vi.fn(() => undefined),
    } as unknown as ReturnType<typeof getServiceRegistry>);
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

    it('sets the config center', () => {
      getSharedToolRegistry('user-1');

      expect(mockToolRegistry.setConfigCenter).toHaveBeenCalledWith({ mocked: true });
    });

    it('registers all gateway tool providers', () => {
      getSharedToolRegistry('user-1');

      expect(createMemoryToolProvider).toHaveBeenCalledWith('user-1');
      expect(createGoalToolProvider).toHaveBeenCalledWith('user-1');
      expect(createCustomDataToolProvider).toHaveBeenCalled();
      expect(createPersonalDataToolProvider).toHaveBeenCalled();
      expect(createTriggerToolProvider).toHaveBeenCalled();
      expect(createPlanToolProvider).toHaveBeenCalled();
      expect(createConfigToolProvider).toHaveBeenCalled();
      expect(createHeartbeatToolProvider).toHaveBeenCalledWith('user-1');
      expect(createExtensionToolProvider).toHaveBeenCalledWith('user-1');
      expect(createCodingAgentToolProvider).toHaveBeenCalledWith('user-1');
      expect(createBackgroundAgentToolProvider).toHaveBeenCalledWith('user-1');
      expect(createBrowserToolProvider).toHaveBeenCalledWith('user-1');
      expect(createEdgeToolProvider).toHaveBeenCalledWith('user-1');
      expect(createSkillToolProvider).toHaveBeenCalledWith('user-1');
      expect(createFleetToolProvider).toHaveBeenCalledWith('user-1');

      expect(mockToolRegistry.registerProvider).toHaveBeenCalledTimes(16);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockMemoryProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockGoalProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockCustomDataProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockPersonalDataProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockTriggerProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockPlanProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockConfigProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockHeartbeatProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockExtensionProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockCodingAgentProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockCliToolProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockBackgroundAgentProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockBrowserProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockEdgeProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockSkillProvider);
      expect(mockToolRegistry.registerProvider).toHaveBeenCalledWith(mockFleetProvider);
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
      expect(mockToolRegistry.execute).toHaveBeenCalledWith(
        'some_tool',
        { arg1: 'val' },
        {
          conversationId: 'system-execution',
          userId: 'user-1',
          executionPermissions: undefined,
        }
      );
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
      mockPluginService.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('plugin_tool', { x: 1 });

      expect(result).toEqual({
        success: true,
        result: 'plugin result',
        error: undefined,
      });
      expect(mockPluginService.getTool).toHaveBeenCalledWith('plugin_tool');
    });

    it('returns error when plugin tool execution returns isError', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockResolvedValue({
        content: 'plugin error',
        isError: true,
      });
      mockPluginService.getTool.mockReturnValue({
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
      mockPluginService.getTool.mockReturnValue(null);

      const result = await executeTool('nonexistent_tool', {});

      expect(result).toEqual({
        success: false,
        error: "Tool 'nonexistent_tool' not found in shared registry or plugins",
      });
    });

    it('handles plugin executor throwing an exception', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockRejectedValue(new Error('Plugin crashed'));
      mockPluginService.getTool.mockReturnValue({
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
      expect(mockPluginService.getTool).not.toHaveBeenCalled();
    });

    it('returns true when tool is in plugin registry', async () => {
      mockToolRegistry.has.mockReturnValue(false);
      mockPluginService.getTool.mockReturnValue({ executor: vi.fn() });

      const result = await hasTool('plugin_tool');

      expect(result).toBe(true);
    });

    it('returns false when tool exists in neither registry', async () => {
      mockToolRegistry.has.mockReturnValue(false);
      mockPluginService.getTool.mockReturnValue(null);

      const result = await hasTool('nonexistent_tool');

      expect(result).toBe(false);
    });

    it('returns false when plugin service throws', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      mockPluginService.getTool.mockImplementation(() => {
        throw new Error('Plugin system down');
      });

      const result = await hasTool('any_tool');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // Additional coverage tests for uncovered lines
  // ========================================================================

  describe('getSharedToolRegistry - plugin registration', () => {
    it('registers plugin tools when plugin has tools and category is not core', () => {
      resetSharedToolRegistry();
      mockPluginService.getEnabled.mockReturnValue([
        {
          manifest: { id: 'test-plugin', category: 'integration' },
          tools: new Map([['tool1', { name: 'tool1' }]]),
        } as unknown,
      ]);

      getSharedToolRegistry('test-user');

      expect(mockToolRegistry.registerPluginTools).toHaveBeenCalledWith(
        'test-plugin',
        expect.any(Map)
      );
    });

    it('skips core category plugins during plugin tool registration', () => {
      resetSharedToolRegistry();
      mockPluginService.getEnabled.mockReturnValue([
        {
          manifest: { id: 'core-plugin', category: 'core' },
          tools: new Map([['tool1', { name: 'tool1' }]]),
        } as unknown,
      ]);

      getSharedToolRegistry('test-user');

      expect(mockToolRegistry.registerPluginTools).not.toHaveBeenCalled();
    });
  });

  describe('executeTool - audit error handling', () => {
    it('continues execution when audit service throws', async () => {
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'success', isError: false },
      });

      const { getServiceRegistry } = await import('@ownpilot/core');
      const mockAuditService = {
        log: vi.fn().mockRejectedValue(new Error('Audit system failure')),
      };
      vi.mocked(getServiceRegistry).mockReturnValue({
        get: vi.fn((token: { name: string }) => {
          if (token.name === 'plugin') return mockPluginService;
          if (token.name === 'event') return mockEventSystem;
          if (token.name === 'audit') return mockAuditService;
          return undefined;
        }),
        tryGet: vi.fn(() => undefined),
      } as unknown as ReturnType<typeof getServiceRegistry>);

      const result = await executeTool('test_tool', {});

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
    });
  });

  describe('executeTool - non-string plugin result content', () => {
    it('converts non-string plugin result content to string', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockResolvedValue({
        content: { key: 'value', number: 123 },
        isError: false,
      });
      mockPluginService.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('object_tool', {});

      expect(result.success).toBe(true);
      expect(result.result).toBe('[object Object]');
    });

    it('handles null content from plugin tool', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const mockPluginExecutor = vi.fn().mockResolvedValue({
        content: null,
        isError: false,
      });
      mockPluginService.getTool.mockReturnValue({
        executor: mockPluginExecutor,
        plugin: { manifest: { id: 'test-plugin' } },
      });

      const result = await executeTool('null_tool', {});

      expect(result.success).toBe(true);
      expect(result.result).toBe('null');
    });
  });

  describe('executeTool - plugin service lookup errors', () => {
    it('handles plugin service lookup errors during execution', async () => {
      mockToolRegistry.has.mockReturnValue(false);

      const { getServiceRegistry } = await import('@ownpilot/core');
      vi.mocked(getServiceRegistry).mockReturnValue({
        get: vi.fn((token: { name: string }) => {
          if (token.name === 'plugin') {
            throw new Error('Plugin service unavailable');
          }
          return undefined;
        }),
        tryGet: vi.fn(() => undefined),
      } as unknown as ReturnType<typeof getServiceRegistry>);

      const result = await executeTool('plugin_lookup_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ========================================================================
  // executeTool - execContext / permission checking
  // ========================================================================

  describe('executeTool - execContext permission checking', () => {
    it('allows execution when checkToolPermission returns allowed', async () => {
      vi.mocked(checkToolPermission).mockResolvedValue({ allowed: true, reason: '' });
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'result', isError: false },
      });

      const result = await executeTool('some_tool', {}, 'user-1', undefined, {
        source: 'trigger',
        triggerId: 'trig-1',
      });

      expect(checkToolPermission).toHaveBeenCalledWith(
        'user-1',
        'some_tool',
        expect.objectContaining({ source: 'trigger', triggerId: 'trig-1' })
      );
      expect(result.success).toBe(true);
    });

    it('blocks execution and returns error when checkToolPermission denies', async () => {
      vi.mocked(checkToolPermission).mockResolvedValue({
        allowed: false,
        reason: 'Tool disabled for this context',
      });

      const result = await executeTool('blocked_tool', {}, 'user-1', undefined, {
        source: 'plan',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'blocked_tool' blocked");
      expect(result.error).toContain('Tool disabled for this context');
      // Should not reach registry execution
      expect(mockToolRegistry.execute).not.toHaveBeenCalled();
    });

    it('merges executionPermissions from both params when execContext provided', async () => {
      vi.mocked(checkToolPermission).mockResolvedValue({ allowed: true, reason: '' });
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'ok', isError: false },
      });

      const execPerms = { allowFileSystem: true } as never;
      await executeTool('fs_tool', {}, 'user-1', execPerms, { source: 'workflow' });

      expect(checkToolPermission).toHaveBeenCalledWith(
        'user-1',
        'fs_tool',
        expect.objectContaining({ executionPermissions: execPerms })
      );
    });
  });

  // ========================================================================
  // waitForToolSync
  // ========================================================================

  describe('waitForToolSync', () => {
    it('resolves immediately when no sync promise is set', async () => {
      // After reset, toolSyncPromise is null — waitForToolSync should resolve quickly
      await expect(waitForToolSync()).resolves.toBeUndefined();
    });

    it('waits for the custom tool sync promise after registry creation', async () => {
      let resolveSync!: () => void;
      const syncPromise = new Promise<void>((res) => {
        resolveSync = res;
      });
      vi.mocked(mockCustomToolsRepo.getActiveTools).mockReturnValue(syncPromise.then(() => []));

      getSharedToolRegistry('user-1');

      // toolSyncPromise is now set but pending — waitForToolSync should wait
      const waitPromise = waitForToolSync();
      resolveSync();
      await expect(waitPromise).resolves.toBeUndefined();
    });
  });

  // ========================================================================
  // syncCustomToolsIntoRegistry — custom tools in the DB
  // ========================================================================

  describe('syncCustomToolsIntoRegistry', () => {
    it('registers custom tools from DB into the shared registry', async () => {
      const customTool = {
        id: 'ct-1',
        name: 'my_custom_tool',
        description: 'A custom tool',
        parameters: { type: 'object', properties: {}, required: [] },
        code: 'async function executor(args) { return args; }',
        category: 'Custom',
        requiredApiKeys: [],
        requiresApproval: false,
        permissions: [],
        metadata: {},
      };
      vi.mocked(mockCustomToolsRepo.getActiveTools).mockResolvedValue([customTool]);

      getSharedToolRegistry('user-1');
      await waitForToolSync();

      expect(mockDynamicRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_custom_tool' })
      );
      expect(mockToolRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_custom_tool' }),
        expect.any(Function),
        'ct-1'
      );
    });

    it('logs when custom tools are synced', async () => {
      const customTool = {
        id: 'ct-2',
        name: 'another_tool',
        description: 'Another tool',
        parameters: {},
        code: '',
        category: null,
        requiredApiKeys: [
          { name: 'API_KEY', displayName: 'API Key', description: '', category: '', docsUrl: '' },
        ],
        requiresApproval: true,
        permissions: null,
        metadata: { workflowUsable: true },
      };
      vi.mocked(mockCustomToolsRepo.getActiveTools).mockResolvedValue([customTool]);

      getSharedToolRegistry('user-1');
      await waitForToolSync();

      expect(mockToolRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'another_tool',
          workflowUsable: true,
        }),
        expect.any(Function),
        'ct-2'
      );
    });

    it('custom tool executor delegates to dynamic registry', async () => {
      const customTool = {
        id: 'ct-3',
        name: 'exec_tool',
        description: 'Exec tool',
        parameters: {},
        code: '',
        category: 'Custom',
        requiredApiKeys: [],
        requiresApproval: false,
        permissions: [],
        metadata: {},
      };
      vi.mocked(mockCustomToolsRepo.getActiveTools).mockResolvedValue([customTool]);
      mockDynamicRegistry.execute.mockResolvedValue({ content: 'dynamic result', isError: false });

      getSharedToolRegistry('user-1');
      await waitForToolSync();

      // Get the registered executor function
      const registerCall = vi.mocked(mockToolRegistry.registerCustomTool).mock.calls[0];
      const executor = registerCall[1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;

      const result = await executor({ foo: 'bar' }, { userId: 'u', conversationId: 'c' });
      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith(
        'exec_tool',
        { foo: 'bar' },
        expect.anything()
      );
    });

    it('handles getActiveTools failure gracefully', async () => {
      vi.mocked(mockCustomToolsRepo.getActiveTools).mockRejectedValue(new Error('DB error'));

      getSharedToolRegistry('user-1');
      // Should not throw — .catch() handles it
      await expect(waitForToolSync()).resolves.toBeUndefined();
    });
  });

  // ========================================================================
  // syncExtensionToolsIntoRegistry — extension / skill tools
  // ========================================================================

  describe('syncExtensionToolsIntoRegistry', () => {
    it('registers extension tools into shared and dynamic registries', async () => {
      const extToolDef = {
        name: 'my_ext_tool',
        description: 'Extension tool',
        parameters: { type: 'object', properties: {} },
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-123',
        extensionTool: { code: 'async function executor() {}', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(false);

      getSharedToolRegistry('user-1');

      expect(mockDynamicRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_ext_tool' })
      );
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('ext-123') }),
        expect.any(Function),
        expect.objectContaining({ source: 'dynamic' })
      );
    });

    it('skips dynamic registration when tool already exists in dynamic registry', async () => {
      const extToolDef = {
        name: 'already_registered',
        description: 'Already registered',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-456',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(true); // already registered

      getSharedToolRegistry('user-1');

      // Dynamic register should NOT be called (already exists)
      expect(mockDynamicRegistry.register).not.toHaveBeenCalled();
      // But registry.register should still be called for the qualified name
      expect(mockToolRegistry.register).toHaveBeenCalled();
    });

    it('uses "skill" namespace prefix for agentskills format extensions', async () => {
      const extToolDef = {
        name: 'skill_tool',
        description: 'Skill tool',
        parameters: {},
        category: 'Skill',
        format: 'agentskills',
        extensionId: 'skill-789',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(true);

      getSharedToolRegistry('user-1');

      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('skill.skill-789') }),
        expect.any(Function),
        expect.objectContaining({ source: 'dynamic', providerName: 'skill:skill-789' })
      );
    });

    it('extension tool executor uses dynamic registry when sandbox is not enabled', async () => {
      const extToolDef = {
        name: 'no_sandbox_tool',
        description: 'Tool without sandbox',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-ns',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(true);
      mockDynamicRegistry.execute.mockResolvedValue({ content: 'ext result', isError: false });

      getSharedToolRegistry('user-1');

      // Get the executor function registered
      const registerCall = vi.mocked(mockToolRegistry.register).mock.calls[0];
      const executor = registerCall[1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;
      const result = (await executor({ x: 1 }, {})) as { content: string; isError: boolean };

      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith('no_sandbox_tool', { x: 1 }, {});
      expect(result.content).toContain('ext result');
    });

    it('extension tool executor uses sandbox when sandbox="worker" is configured', async () => {
      const extToolDef = {
        name: 'sandboxed_tool',
        description: 'Sandboxed tool',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-sb',
        extensionTool: { code: 'code here', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(true);

      const { extensionsRepo } = await import('../db/repositories/extensions.js');
      vi.mocked(extensionsRepo.getById).mockReturnValue({
        manifest: { runtime: { sandbox: 'worker', maxMemory: 128, maxExecutionTime: 5000 } },
        settings: { grantedPermissions: ['fs.read'] },
      } as never);

      mockSandbox.execute.mockResolvedValue({ success: true, result: 'sandbox result' });

      getSharedToolRegistry('user-1');

      const registerCall = vi.mocked(mockToolRegistry.register).mock.calls[0];
      const executor = registerCall[1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;
      const result = (await executor({ x: 1 }, {})) as { content: string; isError: boolean };

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          extensionId: 'ext-sb',
          toolName: 'sandboxed_tool',
          code: 'code here',
        })
      );
      expect(result.isError).toBe(false);
      expect(result.content).toContain('sandbox result');
    });

    it('sandbox executor returns error when sandbox execution fails', async () => {
      const extToolDef = {
        name: 'fail_sandbox_tool',
        description: 'Fail sandbox tool',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-fail',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([extToolDef]);
      mockDynamicRegistry.has.mockReturnValue(true);

      const { extensionsRepo } = await import('../db/repositories/extensions.js');
      vi.mocked(extensionsRepo.getById).mockReturnValue({
        manifest: { runtime: { sandbox: 'worker' } },
        settings: {},
      } as never);

      mockSandbox.execute.mockResolvedValue({ success: false, error: 'Sandbox crashed' });

      getSharedToolRegistry('user-1');

      const registerCall = vi.mocked(mockToolRegistry.register).mock.calls[0];
      const executor = registerCall[1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;
      const result = (await executor({}, {})) as { content: string; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Sandbox crashed');
    });

    it('handles extension service not available (hasServiceRegistry false)', async () => {
      const { hasServiceRegistry } = await import('@ownpilot/core');
      vi.mocked(hasServiceRegistry).mockReturnValue(false);

      // Should not throw
      expect(() => getSharedToolRegistry('user-1')).not.toThrow();

      // Register should not be called for extension tools
      expect(mockToolRegistry.register).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // setupSandboxCallToolHandler
  // ========================================================================

  describe('setupSandboxCallToolHandler', () => {
    it('registers a callTool handler on the sandbox when registry is created', () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);

      getSharedToolRegistry('user-1');

      expect(mockSandbox.setCallToolHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    it('sandbox handler returns tool list for __list_tools__ command', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      mockToolRegistry.getAllTools.mockReturnValue([
        { definition: { name: 'tool_a', description: 'Tool A' } },
        { definition: { name: 'tool_b', description: 'Tool B' } },
      ]);

      getSharedToolRegistry('user-1');

      const handler = vi.mocked(mockSandbox.setCallToolHandler).mock.calls[0][0];
      const result = await handler('__list_tools__', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(2);
      expect(result.result[0]).toMatchObject({ name: 'tool_a', description: 'Tool A' });
    });

    it('sandbox handler executes tool via registry for normal tool calls', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'tool output', isError: false },
      });

      getSharedToolRegistry('user-1');

      const handler = vi.mocked(mockSandbox.setCallToolHandler).mock.calls[0][0];
      const result = await handler('regular_tool', { arg: 'value' });

      expect(result.success).toBe(true);
      expect(result.result).toBe('tool output');
      expect(mockToolRegistry.execute).toHaveBeenCalledWith(
        'regular_tool',
        { arg: 'value' },
        { userId: 'system', conversationId: 'sandbox' }
      );
    });

    it('sandbox handler returns failure when registry execute fails', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      mockToolRegistry.execute.mockResolvedValue({
        ok: false,
        error: { message: 'Registry error' },
      });

      getSharedToolRegistry('user-1');

      const handler = vi.mocked(mockSandbox.setCallToolHandler).mock.calls[0][0];
      const result = await handler('failing_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Registry error');
    });

    it('sandbox handler returns error when tool execution result has isError', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      mockToolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'tool error output', isError: true },
      });

      getSharedToolRegistry('user-1');

      const handler = vi.mocked(mockSandbox.setCallToolHandler).mock.calls[0][0];
      const result = await handler('error_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('tool error output');
    });
  });

  // ========================================================================
  // Plugin event handler — plugin.status events
  // ========================================================================

  describe('plugin event handler', () => {
    it('registers plugin tools when plugin.status enabled event fires', () => {
      const testPlugin = {
        manifest: { id: 'new-plugin', category: 'integration' },
        tools: new Map([['tool1', { name: 'tool1' }]]),
      };
      mockPluginService.getEnabled.mockReturnValue([]);
      mockPluginService.get = vi.fn().mockReturnValue(testPlugin);

      getSharedToolRegistry('user-1');

      // Capture the 'plugin.status' handler
      const onAnyCall = vi
        .mocked(mockEventSystem.onAny)
        .mock.calls.find((c) => c[0] === 'plugin.status');
      expect(onAnyCall).toBeDefined();
      const statusHandler = onAnyCall![1] as (e: { data: unknown }) => void;

      statusHandler({ data: { pluginId: 'new-plugin', newStatus: 'enabled' } });

      expect(mockToolRegistry.registerPluginTools).toHaveBeenCalledWith(
        'new-plugin',
        testPlugin.tools
      );
    });

    it('unregisters plugin tools when plugin.status disabled event fires', () => {
      mockPluginService.getEnabled.mockReturnValue([]);

      getSharedToolRegistry('user-1');

      const onAnyCall = vi
        .mocked(mockEventSystem.onAny)
        .mock.calls.find((c) => c[0] === 'plugin.status');
      const statusHandler = onAnyCall![1] as (e: { data: unknown }) => void;

      statusHandler({ data: { pluginId: 'old-plugin', newStatus: 'disabled' } });

      expect(mockToolRegistry.unregisterPluginTools).toHaveBeenCalledWith('old-plugin');
    });

    it('skips core-category plugins in enabled event', () => {
      const corePlugin = {
        manifest: { id: 'core-plugin', category: 'core' },
        tools: new Map([['core_tool', {}]]),
      };
      mockPluginService.get = vi.fn().mockReturnValue(corePlugin);
      mockPluginService.getEnabled.mockReturnValue([]);

      getSharedToolRegistry('user-1');

      const onAnyCall = vi
        .mocked(mockEventSystem.onAny)
        .mock.calls.find((c) => c[0] === 'plugin.status');
      const statusHandler = onAnyCall![1] as (e: { data: unknown }) => void;

      statusHandler({ data: { pluginId: 'core-plugin', newStatus: 'enabled' } });

      expect(mockToolRegistry.registerPluginTools).not.toHaveBeenCalled();
    });

    it('handles errors in plugin.status event handler gracefully', () => {
      mockPluginService.getEnabled.mockReturnValue([]);
      mockPluginService.get = vi.fn().mockImplementation(() => {
        throw new Error('Plugin lookup failed');
      });

      getSharedToolRegistry('user-1');

      const onAnyCall = vi
        .mocked(mockEventSystem.onAny)
        .mock.calls.find((c) => c[0] === 'plugin.status');
      const statusHandler = onAnyCall![1] as (e: { data: unknown }) => void;

      // Should not throw
      expect(() =>
        statusHandler({ data: { pluginId: 'plugin-x', newStatus: 'enabled' } })
      ).not.toThrow();
    });
  });

  // ========================================================================
  // Override .catch() handlers (lines 110 / 113 / 116)
  // ========================================================================

  describe('override .catch() handlers', () => {
    it('logs warning when registerImageOverrides rejects (line 110)', async () => {
      vi.mocked(registerImageOverrides).mockRejectedValueOnce(new Error('Image override failed'));
      getSharedToolRegistry();
      // Flush microtasks so the .catch() callback executes
      await Promise.resolve();
      await Promise.resolve();
      expect(registerImageOverrides).toHaveBeenCalled();
    });

    it('logs warning when registerEmailOverrides rejects (line 113)', async () => {
      vi.mocked(registerEmailOverrides).mockRejectedValueOnce(new Error('Email override failed'));
      getSharedToolRegistry();
      await Promise.resolve();
      await Promise.resolve();
      expect(registerEmailOverrides).toHaveBeenCalled();
    });

    it('logs warning when registerAudioOverrides rejects (line 116)', async () => {
      vi.mocked(registerAudioOverrides).mockRejectedValueOnce(new Error('Audio override failed'));
      getSharedToolRegistry();
      await Promise.resolve();
      await Promise.resolve();
      expect(registerAudioOverrides).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // syncExtensionToolsIntoRegistry — dynamicRegistry.register failure (line 304)
  // ========================================================================

  describe('syncExtensionToolsIntoRegistry — dynamicRegistry.register failure', () => {
    it('continues to next tool when dynamicRegistry.register throws (line 304)', () => {
      const failTool = {
        name: 'fail_tool',
        description: 'Tool that fails to register',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-fail',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      const okTool = {
        name: 'ok_tool',
        description: 'Tool that succeeds',
        parameters: {},
        category: 'Extension',
        format: 'ownpilot',
        extensionId: 'ext-ok',
        extensionTool: { code: '', parameters: {}, permissions: [] },
      };
      mockExtensionService.getToolDefinitions.mockReturnValue([failTool, okTool]);
      // has() returns false so register() is called for both; first call throws
      mockDynamicRegistry.register.mockImplementationOnce(() => {
        throw new Error('register failed');
      });

      getSharedToolRegistry();

      // failTool: register threw → continue → not registered in shared registry
      // okTool: register succeeded → registered
      expect(mockToolRegistry.register).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('ext-ok') }),
        expect.any(Function),
        expect.any(Object)
      );
    });
  });

  // ========================================================================
  // resyncExtensionTools callback (lines 382–456)
  // ========================================================================

  describe('resyncExtensionTools callback', () => {
    function getResyncCallback() {
      const call = vi
        .mocked(mockEventSystem.onAny)
        .mock.calls.find((c) => c[0] === 'extension.installed');
      return call![1] as () => void;
    }

    function makeToolDef(name: string, format = 'ownpilot') {
      return {
        name,
        description: `${name} tool`,
        parameters: { type: 'object', properties: {} },
        category: 'Extension',
        format,
        extensionId: `ext-${name}`,
        extensionTool: { code: `// ${name} code`, parameters: {}, permissions: [] },
      };
    }

    it('registers new tools on extension event (lines 382–392, 403–415, 436–454)', () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      const newTool = makeToolDef('resync_tool');
      mockExtensionService.getToolDefinitions.mockReturnValue([newTool]);
      mockDynamicRegistry.has.mockReturnValue(false);

      resync();

      expect(mockDynamicRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'resync_tool' })
      );
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('resync_tool') }),
        expect.any(Function),
        expect.objectContaining({ source: 'dynamic' })
      );
      expect(mockDynamicRegistry.setCallableTools).toHaveBeenCalled();
    });

    it('skips tools already in registry during resync (line 387)', () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      const tool = makeToolDef('existing_resync_tool');
      mockExtensionService.getToolDefinitions.mockReturnValue([tool]);
      mockToolRegistry.has.mockReturnValueOnce(true); // qualified name already registered (one-time)

      vi.mocked(mockToolRegistry.register).mockClear();
      resync();

      expect(mockToolRegistry.register).not.toHaveBeenCalled();
    });

    it('skips tool in resync when dynamicRegistry.register throws (line 399)', () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      const failTool = makeToolDef('fail_resync');
      const okTool = makeToolDef('ok_resync');
      mockExtensionService.getToolDefinitions.mockReturnValue([failTool, okTool]);
      mockDynamicRegistry.has.mockReturnValue(false);
      mockDynamicRegistry.register.mockImplementationOnce(() => {
        throw new Error('register failed in resync');
      });

      vi.mocked(mockToolRegistry.register).mockClear();
      resync();

      // failTool skipped, okTool registered
      expect(mockToolRegistry.register).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('ok_resync') }),
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('uses sandbox executor for resync tools with sandbox=worker (lines 417–433)', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      const sbxTool = makeToolDef('sandboxed_resync');
      mockExtensionService.getToolDefinitions.mockReturnValue([sbxTool]);
      mockDynamicRegistry.has.mockReturnValue(true); // skip dynamic register
      const { extensionsRepo } = await import('../db/repositories/extensions.js');
      vi.mocked(extensionsRepo.getById).mockReturnValue({
        manifest: { runtime: { sandbox: 'worker', maxMemory: 64, maxExecutionTime: 3000 } },
        settings: { grantedPermissions: ['net'] },
      } as never);
      mockSandbox.execute.mockResolvedValue({ success: true, result: 'sandboxed result' });

      vi.mocked(mockToolRegistry.register).mockClear();
      resync();

      const calls = vi.mocked(mockToolRegistry.register).mock.calls;
      const executor = calls[calls.length - 1][1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;
      const res = (await executor({ x: 1 }, {})) as { content: string; isError: boolean };

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          extensionId: 'ext-sandboxed_resync',
          toolName: 'sandboxed_resync',
        })
      );
      expect(res.isError).toBe(false);
      expect(res.content).toContain('sandboxed result');
    });

    it('uses dynamic executor for resync tools without sandbox (lines 436–444)', async () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      const dynTool = makeToolDef('dynamic_resync');
      mockExtensionService.getToolDefinitions.mockReturnValue([dynTool]);
      mockDynamicRegistry.has.mockReturnValue(true);
      mockDynamicRegistry.execute.mockResolvedValue({ content: 'dynamic output', isError: false });
      // Ensure no sandbox config — extension exists but has no sandbox setting
      const { extensionsRepo } = await import('../db/repositories/extensions.js');
      vi.mocked(extensionsRepo.getById).mockReturnValue({
        id: dynTool.extensionId,
        manifest: {},
        grantedPermissions: [],
      } as never);

      vi.mocked(mockToolRegistry.register).mockClear();
      resync();

      const calls = vi.mocked(mockToolRegistry.register).mock.calls;
      const executor = calls[calls.length - 1][1] as (
        args: Record<string, unknown>,
        ctx: unknown
      ) => Promise<unknown>;
      const res = (await executor({ y: 2 }, {})) as { content: string; isError: boolean };

      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith('dynamic_resync', { y: 2 }, {});
      expect(res.isError).toBe(false);
      expect(res.content).toContain('dynamic output');
    });

    it('catches errors thrown during resync (line 456)', () => {
      mockExtensionService.getToolDefinitions.mockReturnValue([]);
      getSharedToolRegistry();
      const resync = getResyncCallback();

      mockExtensionService.getToolDefinitions.mockImplementationOnce(() => {
        throw new Error('Service unavailable during resync');
      });

      expect(() => resync()).not.toThrow();
    });
  });
});

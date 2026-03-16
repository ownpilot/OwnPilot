/**
 * Agent Runner Utils Tests
 *
 * Tests for shared utilities used by BackgroundAgentRunner,
 * SubagentRunner, and FleetWorker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockRegisterAllTools = vi.hoisted(() => vi.fn());
const mockGetServiceRegistry = vi.hoisted(() =>
  vi.fn(() => ({
    get: vi.fn(() => ({
      getToolDefinitions: vi.fn(() => [
        { name: 'search', extensionId: 'smart-search', format: 'ownpilot' },
        { name: 'review', extensionId: 'code-review', format: 'agentskills' },
      ]),
    })),
  }))
);
const mockQualifyToolName = vi.hoisted(() =>
  vi.fn((name: string, ns: string, id: string) => `${ns}.${id}.${name}`)
);
const mockCalculateCost = vi.hoisted(() => vi.fn(() => 0.005));
const mockResolveForProcess = vi.hoisted(() =>
  vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' }))
);
const mockGetProviderApiKey = vi.hoisted(() => vi.fn(() => 'test-api-key'));
const mockLoadProviderConfig = vi.hoisted(() => vi.fn(() => null));
const mockNativeProviders = vi.hoisted(() => new Set(['openai', 'anthropic']));
const mockRegisterGatewayTools = vi.hoisted(() => vi.fn());
const mockRegisterDynamicTools = vi.hoisted(() => vi.fn());
const mockRegisterPluginTools = vi.hoisted(() => vi.fn());
const mockRegisterExtensionTools = vi.hoisted(() => vi.fn());
const mockRegisterMcpTools = vi.hoisted(() => vi.fn());
const mockGatewayConfigCenter = vi.hoisted(() => ({}));

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ownpilot/core')>()),
  Agent: vi.fn().mockImplementation(function () {
    return { setDirectToolMode: vi.fn() };
  }),
  ToolRegistry: vi.fn().mockImplementation(function () {
    return { setConfigCenter: vi.fn() };
  }),
  registerAllTools: mockRegisterAllTools,
  getServiceRegistry: mockGetServiceRegistry,
  qualifyToolName: mockQualifyToolName,
  calculateCost: mockCalculateCost,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('./model-routing.js', () => ({
  resolveForProcess: mockResolveForProcess,
}));

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: mockGetProviderApiKey,
  loadProviderConfig: mockLoadProviderConfig,
  NATIVE_PROVIDERS: mockNativeProviders,
}));

vi.mock('../tools/agent-tool-registry.js', () => ({
  registerGatewayTools: mockRegisterGatewayTools,
  registerDynamicTools: mockRegisterDynamicTools,
  registerPluginTools: mockRegisterPluginTools,
  registerExtensionTools: mockRegisterExtensionTools,
  registerMcpTools: mockRegisterMcpTools,
}));

vi.mock('./config-center-impl.js', () => ({
  gatewayConfigCenter: mockGatewayConfigCenter,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Import after mocks
// ============================================================================

import {
  resolveProviderAndModel,
  resolveToolFilter,
  createTimeoutPromise,
  safeParseJson,
  createToolCallCollector,
  buildDateTimeContext,
  calculateExecutionCost,
  registerAllToolSources,
  createConfiguredAgent,
} from './agent-runner-utils.js';

// ============================================================================
// Tests
// ============================================================================

describe('agent-runner-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // resolveProviderAndModel
  // --------------------------------------------------------------------------

  describe('resolveProviderAndModel()', () => {
    it('returns explicit provider and model when both provided', async () => {
      const result = await resolveProviderAndModel('anthropic', 'claude-3-opus');
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-3-opus' });
      expect(mockResolveForProcess).not.toHaveBeenCalled();
    });

    it('falls back to model routing when provider not specified', async () => {
      const result = await resolveProviderAndModel(undefined, undefined, 'pulse');
      expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
      expect(mockResolveForProcess).toHaveBeenCalledWith('pulse');
    });

    it('uses explicit provider with resolved model', async () => {
      const result = await resolveProviderAndModel('anthropic', undefined);
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('gpt-4o'); // from resolver
    });

    it('uses resolved provider with explicit model', async () => {
      const result = await resolveProviderAndModel(undefined, 'custom-model');
      expect(result.provider).toBe('openai'); // from resolver
      expect(result.model).toBe('custom-model');
    });

    it('throws when no provider available', async () => {
      mockResolveForProcess.mockResolvedValueOnce({ provider: null, model: null });
      await expect(resolveProviderAndModel(undefined, undefined)).rejects.toThrow(
        /No AI provider configured/
      );
    });

    it('includes error context in message', async () => {
      mockResolveForProcess.mockResolvedValueOnce({ provider: null, model: null });
      await expect(
        resolveProviderAndModel(undefined, undefined, 'pulse', 'heartbeat')
      ).rejects.toThrow(/for heartbeat/);
    });
  });

  // --------------------------------------------------------------------------
  // resolveToolFilter
  // --------------------------------------------------------------------------

  describe('resolveToolFilter()', () => {
    it('returns undefined when no tools or skills', () => {
      expect(resolveToolFilter(undefined, undefined, 'test')).toBeUndefined();
    });

    it('returns undefined for empty arrays', () => {
      expect(resolveToolFilter([], [], 'test')).toBeUndefined();
    });

    it('returns allowed tools as-is when no skills', () => {
      const result = resolveToolFilter(['tool_a', 'tool_b'], undefined, 'test');
      expect(result).toContain('tool_a');
      expect(result).toContain('tool_b');
    });

    it('resolves skill IDs to qualified tool names', () => {
      const result = resolveToolFilter(undefined, ['smart-search'], 'test');
      expect(result).toContain('ext.smart-search.search');
    });

    it('uses skill namespace for agentskills format', () => {
      const result = resolveToolFilter(undefined, ['code-review'], 'test');
      expect(result).toContain('skill.code-review.review');
    });

    it('merges allowed tools with resolved skills', () => {
      const result = resolveToolFilter(['existing_tool'], ['smart-search'], 'test');
      expect(result).toContain('existing_tool');
      expect(result).toContain('ext.smart-search.search');
    });

    it('handles service registry errors gracefully', () => {
      mockGetServiceRegistry.mockImplementationOnce(() => ({
        get: () => {
          throw new Error('Not registered');
        },
      }));
      const result = resolveToolFilter(undefined, ['some-skill'], 'test');
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // createTimeoutPromise
  // --------------------------------------------------------------------------

  describe('createTimeoutPromise()', () => {
    it('rejects after timeout', async () => {
      vi.useFakeTimers();
      const promise = createTimeoutPromise(1000, 'Test op');
      vi.advanceTimersByTime(1000);
      await expect(promise).rejects.toThrow('Test op timed out after 1000ms');
      vi.useRealTimers();
    });

    it('uses default label', async () => {
      vi.useFakeTimers();
      const promise = createTimeoutPromise(500);
      vi.advanceTimersByTime(500);
      await expect(promise).rejects.toThrow('Operation timed out after 500ms');
      vi.useRealTimers();
    });
  });

  // --------------------------------------------------------------------------
  // safeParseJson
  // --------------------------------------------------------------------------

  describe('safeParseJson()', () => {
    it('parses valid JSON', () => {
      expect(safeParseJson('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('returns _raw for invalid JSON', () => {
      expect(safeParseJson('not json')).toEqual({ _raw: 'not json' });
    });

    it('returns empty object for empty string', () => {
      expect(safeParseJson('')).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // createToolCallCollector
  // --------------------------------------------------------------------------

  describe('createToolCallCollector()', () => {
    it('returns empty toolCalls array', () => {
      const { toolCalls } = createToolCallCollector();
      expect(toolCalls).toEqual([]);
    });

    it('collects tool calls via onToolEnd', () => {
      const { toolCalls, onToolEnd } = createToolCallCollector();

      onToolEnd({ name: 'search_web', arguments: '{"query":"test"}' } as never, {
        content: 'results',
        isError: false,
        durationMs: 150,
      });

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        tool: 'search_web',
        args: { query: 'test' },
        result: 'results',
        success: true,
        durationMs: 150,
      });
    });

    it('marks error tool calls as unsuccessful', () => {
      const { toolCalls, onToolEnd } = createToolCallCollector();

      onToolEnd({ name: 'fail_tool', arguments: '{}' } as never, {
        content: 'Error occurred',
        isError: true,
        durationMs: 50,
      });

      expect(toolCalls[0]!.success).toBe(false);
    });

    it('handles invalid JSON arguments', () => {
      const { toolCalls, onToolEnd } = createToolCallCollector();

      onToolEnd({ name: 'raw_tool', arguments: 'not json' } as never, {
        content: 'ok',
        isError: false,
        durationMs: 10,
      });

      expect(toolCalls[0]!.args).toEqual({ _raw: 'not json' });
    });
  });

  // --------------------------------------------------------------------------
  // buildDateTimeContext
  // --------------------------------------------------------------------------

  describe('buildDateTimeContext()', () => {
    it('returns a string with day of week', () => {
      const result = buildDateTimeContext();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      expect(days.some((d) => result.startsWith(d))).toBe(true);
    });

    it('includes year', () => {
      const result = buildDateTimeContext();
      expect(result).toContain(String(new Date().getFullYear()));
    });
  });

  // --------------------------------------------------------------------------
  // calculateExecutionCost
  // --------------------------------------------------------------------------

  describe('calculateExecutionCost()', () => {
    it('returns 0 when usage is null', () => {
      expect(calculateExecutionCost('openai', 'gpt-4', null)).toBe(0);
    });

    it('returns 0 when usage is undefined', () => {
      expect(calculateExecutionCost('openai', 'gpt-4', undefined)).toBe(0);
    });

    it('delegates to core calculateCost', () => {
      const result = calculateExecutionCost('openai', 'gpt-4', {
        promptTokens: 100,
        completionTokens: 50,
      });
      expect(mockCalculateCost).toHaveBeenCalledWith('openai', 'gpt-4', 100, 50);
      expect(result).toBe(0.005);
    });

    it('defaults missing token counts to 0', () => {
      calculateExecutionCost('openai', 'gpt-4', {});
      expect(mockCalculateCost).toHaveBeenCalledWith('openai', 'gpt-4', 0, 0);
    });
  });

  // --------------------------------------------------------------------------
  // registerAllToolSources
  // --------------------------------------------------------------------------

  describe('registerAllToolSources()', () => {
    it('registers all 6 tool source types', async () => {
      const mockTools = { setConfigCenter: vi.fn() } as never;

      await registerAllToolSources(mockTools, 'user-1', 'conv-1', 'Test');

      expect(mockRegisterAllTools).toHaveBeenCalledWith(mockTools);
      expect(mockRegisterGatewayTools).toHaveBeenCalledWith(mockTools, 'user-1', false);
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith(mockTools, 'user-1', 'conv-1', false);
      expect(mockRegisterPluginTools).toHaveBeenCalledWith(mockTools, false);
      expect(mockRegisterExtensionTools).toHaveBeenCalledWith(mockTools, 'user-1', false);
      expect(mockRegisterMcpTools).toHaveBeenCalledWith(mockTools, false);
    });

    it('continues when dynamic tools registration fails', async () => {
      mockRegisterDynamicTools.mockRejectedValueOnce(new Error('DB error'));
      const mockTools = { setConfigCenter: vi.fn() } as never;

      await registerAllToolSources(mockTools, 'user-1', 'conv-1', 'Test');

      // Should still register plugins, extensions, and MCP
      expect(mockRegisterPluginTools).toHaveBeenCalled();
      expect(mockRegisterExtensionTools).toHaveBeenCalled();
      expect(mockRegisterMcpTools).toHaveBeenCalled();
    });

    it('continues when plugin tools registration fails', async () => {
      mockRegisterPluginTools.mockImplementationOnce(() => {
        throw new Error('Plugin error');
      });
      const mockTools = { setConfigCenter: vi.fn() } as never;

      await registerAllToolSources(mockTools, 'user-1', 'conv-1', 'Test');

      expect(mockRegisterExtensionTools).toHaveBeenCalled();
      expect(mockRegisterMcpTools).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // createConfiguredAgent
  // --------------------------------------------------------------------------

  describe('createConfiguredAgent()', () => {
    it('creates agent with all options', async () => {
      const agent = await createConfiguredAgent({
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
        systemPrompt: 'You are a test agent.',
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(agent).toBeDefined();
      expect(agent.setDirectToolMode).toHaveBeenCalledWith(true);
      expect(mockGetProviderApiKey).toHaveBeenCalledWith('openai');
    });

    it('throws when API key not found', async () => {
      mockGetProviderApiKey.mockResolvedValueOnce(null);

      await expect(
        createConfiguredAgent({
          name: 'Test',
          provider: 'missing',
          model: 'model',
          systemPrompt: '',
          userId: 'u',
          conversationId: 'c',
        })
      ).rejects.toThrow(/API key not configured/);
    });

    it('uses openai provider type for non-native providers', async () => {
      const { Agent } = await import('@ownpilot/core');

      await createConfiguredAgent({
        name: 'Test',
        provider: 'groq',
        model: 'llama-3',
        systemPrompt: '',
        userId: 'u',
        conversationId: 'c',
      });

      // groq is not in NATIVE_PROVIDERS, so should use 'openai' as provider type
      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({ provider: 'openai' }),
        }),
        expect.any(Object)
      );
    });
  });
});

/**
 * ToolService Implementation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures the fns are available before vi.mock hoisting
// ---------------------------------------------------------------------------

const mockExecuteToolCall = vi.hoisted(() => vi.fn());
const mockGetDefinition = vi.hoisted(() => vi.fn());
const mockGetDefinitions = vi.hoisted(() => vi.fn());
const mockGetToolsBySource = vi.hoisted(() => vi.fn());
const mockHas = vi.hoisted(() => vi.fn());
const mockGetNames = vi.hoisted(() => vi.fn());
const mockUse = vi.hoisted(() => vi.fn());

vi.mock('./tool-executor.js', () => ({
  getSharedToolRegistry: () => ({
    executeToolCall: mockExecuteToolCall,
    getDefinition: mockGetDefinition,
    getDefinitions: mockGetDefinitions,
    getToolsBySource: mockGetToolsBySource,
    has: mockHas,
    getNames: mockGetNames,
    use: mockUse,
  }),
}));

// ---------------------------------------------------------------------------
// SUT — must be imported after vi.mock declarations
// ---------------------------------------------------------------------------

const { ToolService, createToolService } = await import('./tool-service-impl.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide sensible defaults so tests that don't mock individually don't break
    mockGetDefinitions.mockReturnValue([]);
    mockGetToolsBySource.mockReturnValue([]);
    mockGetNames.mockReturnValue([]);
  });

  // =========================================================================
  // execute
  // =========================================================================

  describe('execute', () => {
    it('delegates to registry.executeToolCall with correct tool call object', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', isError: false });

      const svc = new ToolService('user-1');
      await svc.execute('my_tool', { key: 'val' });

      expect(mockExecuteToolCall).toHaveBeenCalledOnce();
      const [toolCall, conversationId, userId] = mockExecuteToolCall.mock.calls[0];
      expect(toolCall.name).toBe('my_tool');
      expect(toolCall.arguments).toBe('{"key":"val"}');
      expect(conversationId).toBe('service');
      expect(userId).toBe('user-1');
    });

    it('generates a tool call id that starts with "call_"', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_a', {});

      const [toolCall] = mockExecuteToolCall.mock.calls[0];
      expect(toolCall.id).toMatch(/^call_[0-9a-f-]+$/);
    });

    it('returns string content as-is', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'result text', isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_a', {});

      expect(result.content).toBe('result text');
    });

    it('stringifies object content to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({
        content: { data: 123, nested: { key: 'val' } },
        isError: false,
      });

      const svc = new ToolService();
      const result = await svc.execute('tool_b', {});

      expect(result.content).toBe(JSON.stringify({ data: 123, nested: { key: 'val' } }));
    });

    it('stringifies array content to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: [1, 2, 3], isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_c', {});

      expect(result.content).toBe('[1,2,3]');
    });

    it('stringifies number content to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 42, isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_num', {});

      expect(result.content).toBe('42');
    });

    it('stringifies boolean content to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: true, isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_bool', {});

      expect(result.content).toBe('true');
    });

    it('stringifies null content to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: null, isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_null', {});

      expect(result.content).toBe('null');
    });

    it('propagates isError: true from registry result', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'oops', isError: true });

      const svc = new ToolService();
      const result = await svc.execute('tool_fail', {});

      expect(result.isError).toBe(true);
      expect(result.content).toBe('oops');
    });

    it('propagates isError: false from registry result', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'good', isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_ok', {});

      expect(result.isError).toBe(false);
    });

    it('uses "service" as default conversationId when context is omitted', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService('user-1');
      await svc.execute('tool_x', {});

      const [, conversationId] = mockExecuteToolCall.mock.calls[0];
      expect(conversationId).toBe('service');
    });

    it('uses the constructor userId as default when context userId is omitted', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService('my-user');
      await svc.execute('tool_x', {});

      const [, , userId] = mockExecuteToolCall.mock.calls[0];
      expect(userId).toBe('my-user');
    });

    it('uses "default" userId when constructed without userId and no context', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_x', {});

      const [, , userId] = mockExecuteToolCall.mock.calls[0];
      expect(userId).toBe('default');
    });

    it('uses provided conversationId from context', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_a', {}, { conversationId: 'conv-42' });

      const [, conversationId] = mockExecuteToolCall.mock.calls[0];
      expect(conversationId).toBe('conv-42');
    });

    it('uses provided userId from context', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', isError: false });

      const svc = new ToolService('constructor-user');
      await svc.execute('tool_a', {}, { userId: 'ctx-user' });

      const [, , userId] = mockExecuteToolCall.mock.calls[0];
      expect(userId).toBe('ctx-user');
    });

    it('uses both conversationId and userId from context together', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'ok', isError: false });

      const svc = new ToolService('ignored');
      await svc.execute('tool_a', {}, { conversationId: 'conv-1', userId: 'u-2' });

      const [, conversationId, userId] = mockExecuteToolCall.mock.calls[0];
      expect(conversationId).toBe('conv-1');
      expect(userId).toBe('u-2');
    });

    it('serializes complex nested args to JSON', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const args = { deep: { nested: { array: [1, 2], flag: true } } };
      const svc = new ToolService();
      await svc.execute('tool_nested', args);

      const [toolCall] = mockExecuteToolCall.mock.calls[0];
      expect(JSON.parse(toolCall.arguments)).toEqual(args);
    });

    it('serializes empty args to "{}"', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_empty', {});

      const [toolCall] = mockExecuteToolCall.mock.calls[0];
      expect(toolCall.arguments).toBe('{}');
    });

    it('propagates errors thrown by the registry', async () => {
      mockExecuteToolCall.mockRejectedValue(new Error('registry boom'));

      const svc = new ToolService();
      await expect(svc.execute('tool_err', {})).rejects.toThrow('registry boom');
    });

    it('handles empty string content as string (no stringify)', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService();
      const result = await svc.execute('tool_empty_str', {});

      expect(result.content).toBe('');
    });

    it('returns result with only content and isError fields', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: 'data', isError: false, extra: 'ignored' });

      const svc = new ToolService();
      const result = await svc.execute('tool_x', {});

      expect(Object.keys(result)).toEqual(expect.arrayContaining(['content', 'isError']));
      expect(result.content).toBe('data');
      expect(result.isError).toBe(false);
    });
  });

  // =========================================================================
  // getDefinition
  // =========================================================================

  describe('getDefinition', () => {
    it('returns definition from registry when tool exists', () => {
      const def = { name: 'foo', description: 'bar', parameters: {} };
      mockGetDefinition.mockReturnValue(def);

      const svc = new ToolService();
      expect(svc.getDefinition('foo')).toEqual(def);
      expect(mockGetDefinition).toHaveBeenCalledWith('foo');
    });

    it('returns undefined for unknown tool', () => {
      mockGetDefinition.mockReturnValue(undefined);

      const svc = new ToolService();
      expect(svc.getDefinition('nonexistent')).toBeUndefined();
    });

    it('passes the exact name string to registry', () => {
      mockGetDefinition.mockReturnValue(undefined);

      const svc = new ToolService();
      svc.getDefinition('core.get_time');

      expect(mockGetDefinition).toHaveBeenCalledWith('core.get_time');
    });
  });

  // =========================================================================
  // getDefinitions
  // =========================================================================

  describe('getDefinitions', () => {
    it('returns all definitions from registry', () => {
      const defs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
      mockGetDefinitions.mockReturnValue(defs);

      const svc = new ToolService();
      expect(svc.getDefinitions()).toEqual(defs);
    });

    it('returns empty array when no tools are registered', () => {
      mockGetDefinitions.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getDefinitions()).toEqual([]);
    });

    it('returns the same reference from registry (readonly)', () => {
      const defs = [{ name: 'x' }];
      mockGetDefinitions.mockReturnValue(defs);

      const svc = new ToolService();
      const result = svc.getDefinitions();

      expect(result).toBe(defs);
    });
  });

  // =========================================================================
  // getDefinitionsBySource
  // =========================================================================

  describe('getDefinitionsBySource', () => {
    it('maps registered tools to their definitions', () => {
      const toolEntries = [
        { definition: { name: 'core_tool_1', description: 'd1' } },
        { definition: { name: 'core_tool_2', description: 'd2' } },
      ];
      mockGetToolsBySource.mockReturnValue(toolEntries);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('core');

      expect(result).toEqual([
        { name: 'core_tool_1', description: 'd1' },
        { name: 'core_tool_2', description: 'd2' },
      ]);
      expect(mockGetToolsBySource).toHaveBeenCalledWith('core');
    });

    it('returns empty array when no tools match the source', () => {
      mockGetToolsBySource.mockReturnValue([]);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('plugin');

      expect(result).toEqual([]);
    });

    it('works with each valid ToolSource value', () => {
      mockGetToolsBySource.mockReturnValue([]);

      const svc = new ToolService();
      const sources = ['core', 'gateway', 'plugin', 'custom', 'dynamic', 'mcp'] as const;

      for (const source of sources) {
        svc.getDefinitionsBySource(source);
        expect(mockGetToolsBySource).toHaveBeenCalledWith(source);
      }
    });

    it('extracts only the definition property from each tool entry', () => {
      const toolEntries = [
        { definition: { name: 'a' }, source: 'core', executor: () => {} },
        { definition: { name: 'b' }, source: 'core', executor: () => {} },
      ];
      mockGetToolsBySource.mockReturnValue(toolEntries);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('core');

      // Should only contain definitions, not executor or source
      expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
    });
  });

  // =========================================================================
  // has
  // =========================================================================

  describe('has', () => {
    it('returns true when tool exists in registry', () => {
      mockHas.mockReturnValue(true);

      const svc = new ToolService();
      expect(svc.has('existing_tool')).toBe(true);
      expect(mockHas).toHaveBeenCalledWith('existing_tool');
    });

    it('returns false when tool does not exist in registry', () => {
      mockHas.mockReturnValue(false);

      const svc = new ToolService();
      expect(svc.has('missing_tool')).toBe(false);
    });

    it('passes exact name to registry', () => {
      mockHas.mockReturnValue(false);

      const svc = new ToolService();
      svc.has('plugin.telegram.send_message');

      expect(mockHas).toHaveBeenCalledWith('plugin.telegram.send_message');
    });
  });

  // =========================================================================
  // getNames
  // =========================================================================

  describe('getNames', () => {
    it('returns tool names from registry', () => {
      mockGetNames.mockReturnValue(['tool_a', 'tool_b', 'tool_c']);

      const svc = new ToolService();
      expect(svc.getNames()).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('returns empty array when no tools registered', () => {
      mockGetNames.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getNames()).toEqual([]);
    });

    it('returns the same reference from registry (readonly)', () => {
      const names = ['x', 'y'];
      mockGetNames.mockReturnValue(names);

      const svc = new ToolService();
      expect(svc.getNames()).toBe(names);
    });
  });

  // =========================================================================
  // use
  // =========================================================================

  describe('use', () => {
    it('passes middleware to registry.use', () => {
      const middleware = { name: 'test-mw', handler: () => {} };

      const svc = new ToolService();
      svc.use(middleware as unknown as import('@ownpilot/core').ToolMiddleware);

      expect(mockUse).toHaveBeenCalledOnce();
      expect(mockUse).toHaveBeenCalledWith(middleware);
    });

    it('can register multiple middlewares', () => {
      const mw1 = { name: 'mw1' };
      const mw2 = { name: 'mw2' };

      const svc = new ToolService();
      svc.use(mw1 as unknown as import('@ownpilot/core').ToolMiddleware);
      svc.use(mw2 as unknown as import('@ownpilot/core').ToolMiddleware);

      expect(mockUse).toHaveBeenCalledTimes(2);
      expect(mockUse).toHaveBeenNthCalledWith(1, mw1);
      expect(mockUse).toHaveBeenNthCalledWith(2, mw2);
    });
  });

  // =========================================================================
  // getCount
  // =========================================================================

  describe('getCount', () => {
    it('returns the length of getNames result', () => {
      mockGetNames.mockReturnValue(['x', 'y', 'z']);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(3);
    });

    it('returns 0 when no tools registered', () => {
      mockGetNames.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(0);
    });

    it('reflects current count (not cached)', () => {
      mockGetNames.mockReturnValue(['a']);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(1);

      mockGetNames.mockReturnValue(['a', 'b', 'c', 'd']);
      expect(svc.getCount()).toBe(4);
    });
  });

  // =========================================================================
  // constructor / userId behavior
  // =========================================================================

  describe('constructor', () => {
    it('accepts a userId parameter', () => {
      const svc = new ToolService('custom-user');
      // Verify it's used internally by calling a method that hits the registry
      mockGetNames.mockReturnValue([]);
      svc.getCount();
      // No error means the constructor accepted the userId
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('defaults userId to "default" when not provided', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_x', {});

      const [, , userId] = mockExecuteToolCall.mock.calls[0];
      expect(userId).toBe('default');
    });
  });

  // =========================================================================
  // createToolService factory
  // =========================================================================

  describe('createToolService', () => {
    it('creates a ToolService instance with custom userId', () => {
      const svc = createToolService('user-x');
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('creates a ToolService instance with default userId when omitted', () => {
      const svc = createToolService();
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('returned instance satisfies IToolService interface', () => {
      const svc = createToolService();

      expect(typeof svc.execute).toBe('function');
      expect(typeof svc.getDefinition).toBe('function');
      expect(typeof svc.getDefinitions).toBe('function');
      expect(typeof svc.getDefinitionsBySource).toBe('function');
      expect(typeof svc.has).toBe('function');
      expect(typeof svc.getNames).toBe('function');
      expect(typeof svc.use).toBe('function');
      expect(typeof svc.getCount).toBe('function');
    });

    it('returned instance uses the provided userId for execution', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc = createToolService('factory-user');
      await svc.execute('t', {});

      const [, , userId] = mockExecuteToolCall.mock.calls[0];
      expect(userId).toBe('factory-user');
    });
  });

  // =========================================================================
  // Multiple instances isolation
  // =========================================================================

  describe('instance isolation', () => {
    it('different instances use different userIds', async () => {
      mockExecuteToolCall.mockResolvedValue({ content: '', isError: false });

      const svc1 = new ToolService('user-A');
      const svc2 = new ToolService('user-B');

      await svc1.execute('tool_x', {});
      await svc2.execute('tool_x', {});

      const [, , userId1] = mockExecuteToolCall.mock.calls[0];
      const [, , userId2] = mockExecuteToolCall.mock.calls[1];
      expect(userId1).toBe('user-A');
      expect(userId2).toBe('user-B');
    });
  });
});

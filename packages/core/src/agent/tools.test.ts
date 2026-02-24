import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry, createToolRegistry, registerCoreTools } from './tools.js';
import type { ToolDefinition, ToolExecutor, ToolProvider } from './types.js';
import type { PluginId } from '../types/branded.js';
import type { ConfigCenter } from '../services/config-center.js';
import { resetEventSystem } from '../events/event-system.js';

/** Helper: create a minimal tool definition */
function makeDef(name: string, overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object' as const, properties: {} },
    ...overrides,
  };
}

/** Helper: create a no-op executor */
const noop: ToolExecutor = async () => ({ content: 'ok' });

// Reset event system between all tests to prevent hook bus pollution
beforeEach(() => {
  resetEventSystem();
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('registration', () => {
    it('registers a tool', () => {
      const registry = new ToolRegistry();
      const definition: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input value' },
          },
          required: ['input'],
        },
      };
      const executor: ToolExecutor = async (args) => ({ content: args.input });

      const result = registry.register(definition, executor);

      expect(result.ok).toBe(true);
      expect(registry.has('test_tool')).toBe(true);
    });

    it('prevents duplicate registration', () => {
      const registry = new ToolRegistry();
      const definition: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      };
      const executor: ToolExecutor = async () => ({ content: {} });

      registry.register(definition, executor);

      const result = registry.register({ ...definition, description: 'Duplicate' }, executor);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('already registered');
      }
    });

    it('unregisters a tool', () => {
      const registry = new ToolRegistry();
      const definition: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      };
      registry.register(definition, async () => ({ content: {} }));

      expect(registry.unregister('test_tool')).toBe(true);
      expect(registry.has('test_tool')).toBe(false);
    });

    it('returns false when unregistering non-existent tool', () => {
      const registry = new ToolRegistry();
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('getDefinitions', () => {
    it('returns all tool definitions', () => {
      const registry = new ToolRegistry();
      registry.register(
        { name: 'tool1', description: 'Tool 1', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );
      registry.register(
        { name: 'tool2', description: 'Tool 2', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );

      const definitions = registry.getDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.name)).toContain('tool1');
      expect(definitions.map((d) => d.name)).toContain('tool2');
    });

    it('returns definitions by names', () => {
      const registry = new ToolRegistry();
      registry.register(
        { name: 'tool1', description: 'Tool 1', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );
      registry.register(
        { name: 'tool2', description: 'Tool 2', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );
      registry.register(
        { name: 'tool3', description: 'Tool 3', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );

      const definitions = registry.getDefinitionsByNames(['tool1', 'tool3']);
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.name)).toContain('tool1');
      expect(definitions.map((d) => d.name)).toContain('tool3');
      expect(definitions.map((d) => d.name)).not.toContain('tool2');
    });
  });

  describe('execution', () => {
    it('executes a tool', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'greet',
          description: 'Greet someone',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name to greet' },
            },
            required: ['name'],
          },
        },
        async (args) => ({ content: { message: `Hello, ${args.name}!` } })
      );

      const result = await registry.execute(
        'greet',
        { name: 'World' },
        { conversationId: 'conv-1' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toEqual({ message: 'Hello, World!' });
      }
    });

    it('returns error for non-existent tool', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute('nonexistent', {}, { conversationId: 'conv-1' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('catches handler errors', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'failing_tool',
          description: 'A tool that fails',
          parameters: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Tool execution failed');
        }
      );

      const result = await registry.execute('failing_tool', {}, { conversationId: 'conv-1' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Tool execution failed');
      }
    });

    it('executes tool calls in batch', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'add',
          description: 'Add numbers',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
        async (args) => ({ content: { sum: (args.a as number) + (args.b as number) } })
      );

      const results = await registry.executeToolCalls(
        [
          { id: 'call1', name: 'add', arguments: '{"a": 1, "b": 2}' },
          { id: 'call2', name: 'add', arguments: '{"a": 10, "b": 20}' },
        ],
        'conv-123'
      );

      expect(results).toHaveLength(2);
      expect(results[0].toolCallId).toBe('call1');
      expect(results[0].content).toContain('3');
      expect(results[1].toolCallId).toBe('call2');
      expect(results[1].content).toContain('30');
    });

    it('handles invalid JSON arguments', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'test',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: {} })
      );

      const results = await registry.executeToolCalls(
        [{ id: 'call1', name: 'test', arguments: 'invalid json' }],
        'conv-123'
      );

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain('Invalid JSON');
    });
  });
});

describe('registerCoreTools', () => {
  it('registers core tools', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    expect(registry.has('get_current_time')).toBe(true);
    expect(registry.has('calculate')).toBe(true);
    expect(registry.has('generate_uuid')).toBe(true);
  });

  it('get_current_time returns valid timestamp', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    const result = await registry.execute('get_current_time', {}, { conversationId: 'conv-1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Content is a string describing current time
      expect(typeof result.value.content).toBe('string');
      expect(result.value.content).toContain('Current time');
    }
  });

  it('calculate evaluates expressions', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    const result = await registry.execute(
      'calculate',
      { expression: '5 + 3' },
      { conversationId: 'conv-1' }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('8');
    }
  });

  it('calculate handles complex expressions', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    const result = await registry.execute(
      'calculate',
      { expression: '(10 - 4) * 7' },
      { conversationId: 'conv-1' }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('42');
    }
  });

  it('calculate rejects invalid characters', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    const result = await registry.execute(
      'calculate',
      { expression: 'eval("bad")' },
      { conversationId: 'conv-1' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isError).toBe(true);
      expect(result.value.content).toContain('Invalid');
    }
  });

  describe('ToolRegistry stats and providers', () => {
    it('getStats() returns tool statistics', () => {
      const registry = new ToolRegistry();

      // Register some tools
      registry.register(
        {
          name: 'core_tool',
          description: 'Core tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: {} }),
        { source: 'core' }
      );

      registry.register(
        {
          name: 'plugin_tool',
          description: 'Plugin tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: {} }),
        { source: 'plugin', pluginId: 'test-plugin' as import('../types/branded.js').PluginId }
      );

      const stats = registry.getStats();

      expect(stats.totalTools).toBe(2);
      expect(stats.coreTools).toBe(1);
      expect(stats.pluginTools).toBe(1);
    });

    it('getStats() returns zeros for empty registry', () => {
      const registry = new ToolRegistry();
      const stats = registry.getStats();

      expect(stats.totalTools).toBe(0);
      expect(stats.coreTools).toBe(0);
      expect(stats.pluginTools).toBe(0);
    });
  });

  it('generate_uuid returns valid UUIDs', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    const result = await registry.execute('generate_uuid', {}, { conversationId: 'conv-1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // UUID v4 format check
      expect(result.value.content).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    }
  });

  describe('ToolRegistry middleware', () => {
    it('use() adds global middleware that runs before execution', async () => {
      const registry = new ToolRegistry();
      let middlewareCalled = false;

      registry.use({
        name: 'test-middleware',
        before: async () => {
          middlewareCalled = true;
        },
      });

      registry.register(
        {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: 'success' })
      );

      await registry.execute('test_tool', {}, { conversationId: 'conv-1' });

      expect(middlewareCalled).toBe(true);
    });

    it('useFor() adds tool-specific middleware', async () => {
      const registry = new ToolRegistry();
      let specificMiddlewareCalled = false;

      registry.useFor('specific_tool', {
        name: 'specific-middleware',
        before: async () => {
          specificMiddlewareCalled = true;
        },
      });

      registry.register(
        {
          name: 'specific_tool',
          description: 'Specific tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: 'success' })
      );

      await registry.execute('specific_tool', {}, { conversationId: 'conv-1' });
      expect(specificMiddlewareCalled).toBe(true);
    });

    it('middleware after hook transforms result', async () => {
      const registry = new ToolRegistry();

      registry.use({
        name: 'transform-result',
        after: async (_ctx, result) => {
          return { ...result, content: `Modified: ${result.content}` };
        },
      });

      registry.register(
        {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: 'original' })
      );

      const result = await registry.execute('test_tool', {}, { conversationId: 'conv-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Modified: original');
      }
    });
  });

  describe('ToolRegistry clear', () => {
    it('clears all tools and middleware', () => {
      const registry = new ToolRegistry();

      registry.register(
        { name: 'tool1', description: 'Tool 1', parameters: { type: 'object', properties: {} } },
        async () => ({ content: {} })
      );

      registry.use({
        name: 'test-middleware',
        before: async () => {},
      });

      expect(registry.getAllTools().length).toBe(1);

      registry.clear();

      expect(registry.getAllTools().length).toBe(0);
      expect(registry.has('tool1')).toBe(false);
    });
  });

  describe('executeToolCall error handling', () => {
    it('handles JSON parse errors in tool call arguments', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: 'success' })
      );

      const result = await registry.executeToolCall(
        { id: 'call1', name: 'test_tool', arguments: 'invalid json' },
        'conv-1'
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid JSON');
    });

    it('handles tool not found error', async () => {
      const registry = new ToolRegistry();

      const result = await registry.executeToolCall(
        { id: 'call1', name: 'nonexistent_tool', arguments: '{}' },
        'conv-1'
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('handles tool execution errors', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'failing_tool',
          description: 'Failing tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Tool execution failed');
        }
      );

      const result = await registry.executeToolCall(
        { id: 'call1', name: 'failing_tool', arguments: '{}' },
        'conv-1'
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool execution failed');
    });
  });
});

// ===========================================================================
// NEW TESTS — Coverage for uncovered lines
// ===========================================================================

describe('ToolRegistry - name validation', () => {
  it('rejects empty tool name', () => {
    const registry = new ToolRegistry();
    const result = registry.register(makeDef(''), noop);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('1-100 characters');
    }
  });

  it('rejects tool name longer than 100 characters', () => {
    const registry = new ToolRegistry();
    const longName = 'a'.repeat(101);
    const result = registry.register(makeDef(longName), noop);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('1-100 characters');
    }
  });

  it('rejects tool name starting with a number', () => {
    const registry = new ToolRegistry();
    const result = registry.register(makeDef('1tool'), noop);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('start with a letter');
    }
  });

  it('rejects tool name with invalid characters', () => {
    const registry = new ToolRegistry();
    const result = registry.register(makeDef('tool-name'), noop);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('alphanumeric');
    }
  });

  it('accepts tool name with dots and underscores', () => {
    const registry = new ToolRegistry();
    const result = registry.register(makeDef('core.my_tool'), noop);
    expect(result.ok).toBe(true);
  });

  it('accepts tool name exactly 100 characters long', () => {
    const registry = new ToolRegistry();
    const name = 'a'.repeat(100);
    const result = registry.register(makeDef(name), noop);
    expect(result.ok).toBe(true);
  });
});

describe('ToolRegistry - backward-compat string pluginId', () => {
  it('treats string metadataOrPluginId as pluginId with plugin source and semi-trusted level', () => {
    const registry = new ToolRegistry();
    const pluginId = 'my-plugin' as PluginId;
    const result = registry.register(makeDef('plugin.tool1'), noop, pluginId);

    expect(result.ok).toBe(true);
    const tool = registry.get('plugin.tool1');
    expect(tool).toBeDefined();
    expect(tool!.source).toBe('plugin');
    expect(tool!.pluginId).toBe(pluginId);
    expect(tool!.trustLevel).toBe('semi-trusted');
  });
});

describe('ToolRegistry - source and trust level defaults', () => {
  it('defaults source to core when no pluginId and no source', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop);
    const tool = registry.get('tool1');
    expect(tool!.source).toBe('core');
    expect(tool!.trustLevel).toBe('trusted');
  });

  it('defaults source to plugin when pluginId is provided but no source', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, {
      pluginId: 'some-plugin' as PluginId,
    });
    const tool = registry.get('tool1');
    expect(tool!.source).toBe('plugin');
    expect(tool!.trustLevel).toBe('semi-trusted');
  });

  it('defaults trustLevel to sandboxed for custom source', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, { source: 'custom' });
    const tool = registry.get('tool1');
    expect(tool!.source).toBe('custom');
    expect(tool!.trustLevel).toBe('sandboxed');
  });

  it('allows explicit trustLevel override', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, {
      source: 'plugin',
      pluginId: 'p' as PluginId,
      trustLevel: 'trusted',
    });
    const tool = registry.get('tool1');
    expect(tool!.trustLevel).toBe('trusted');
  });

  it('stores customToolId in registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, {
      source: 'custom',
      customToolId: 'ct-123',
    });
    const tool = registry.get('tool1');
    expect(tool!.customToolId).toBe('ct-123');
  });

  it('stores providerName in registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, {
      providerName: 'memory-provider',
    });
    const tool = registry.get('tool1');
    expect(tool!.providerName).toBe('memory-provider');
  });
});

describe('ToolRegistry - config registration handler', () => {
  it('fires config registration handler when tool has configRequirements', () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.setConfigRegistrationHandler(handler);

    const def = makeDef('weather_tool', {
      configRequirements: [{ name: 'openweathermap', displayName: 'OpenWeatherMap' }],
    });
    registry.register(def, noop);

    expect(handler).toHaveBeenCalledWith(
      'weather_tool',
      expect.any(String),
      'core',
      def.configRequirements
    );
  });

  it('does not fire handler when no configRequirements', () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.setConfigRegistrationHandler(handler);

    registry.register(makeDef('plain_tool'), noop);
    expect(handler).not.toHaveBeenCalled();
  });

  it('catches and logs handler errors without failing registration', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockRejectedValue(new Error('config fail'));
    registry.setConfigRegistrationHandler(handler);

    const def = makeDef('weather_tool', {
      configRequirements: [{ name: 'openweathermap' }],
    });
    const result = registry.register(def, noop);
    expect(result.ok).toBe(true);

    // Let the rejected promise propagate
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('ToolRegistry - unregister with base name and plugin cleanup', () => {
  it('unregisters a tool by base name when only one qualified name exists', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.my_tool'), noop);

    // Unregister using base name
    expect(registry.unregister('my_tool')).toBe(true);
    expect(registry.has('core.my_tool')).toBe(false);
  });

  it('returns false when unregistering ambiguous base name', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.send'), noop);
    registry.register(makeDef('plugin.telegram.send'), noop);

    // Base name 'send' maps to two qualified names -> ambiguous -> false
    expect(registry.unregister('send')).toBe(false);
  });

  it('cleans up plugin tracking on unregister', () => {
    const registry = new ToolRegistry();
    const pluginId = 'test-plugin' as PluginId;
    registry.register(makeDef('plugin.tool1'), noop, {
      source: 'plugin',
      pluginId,
    });
    registry.register(makeDef('plugin.tool2'), noop, {
      source: 'plugin',
      pluginId,
    });

    registry.unregister('plugin.tool1');
    // Plugin still has tool2
    expect(registry.getPluginTools(pluginId)).toHaveLength(1);

    registry.unregister('plugin.tool2');
    // Plugin set should now be cleaned up entirely
    expect(registry.getPluginTools(pluginId)).toHaveLength(0);
  });

  it('cleans up base name index when last qualified name is removed', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.read_file'), noop);

    expect(registry.resolveBaseName('read_file')).toHaveLength(1);
    registry.unregister('core.read_file');
    expect(registry.resolveBaseName('read_file')).toHaveLength(0);
  });
});

describe('ToolRegistry - updateExecutor', () => {
  it('replaces executor for an existing tool', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('mytool'), async () => ({ content: 'old' }));

    const updated = registry.updateExecutor('mytool', async () => ({
      content: 'new',
    }));
    expect(updated).toBe(true);

    const result = await registry.execute('mytool', {}, { conversationId: 'c1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('new');
    }
  });

  it('returns false when updating non-existent tool', () => {
    const registry = new ToolRegistry();
    expect(registry.updateExecutor('nope', noop)).toBe(false);
  });
});

describe('ToolRegistry - namespace resolution', () => {
  it('resolveBaseName returns all qualified names with same base', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.send_message'), noop);
    registry.register(makeDef('plugin.telegram.send_message'), noop);

    const names = registry.resolveBaseName('send_message');
    expect(names).toHaveLength(2);
    expect(names).toContain('core.send_message');
    expect(names).toContain('plugin.telegram.send_message');
  });

  it('resolveBaseName returns empty array for unknown base name', () => {
    const registry = new ToolRegistry();
    expect(registry.resolveBaseName('nonexistent')).toEqual([]);
  });

  it('get() resolves unambiguous base name to the tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.read_file'), noop);

    const tool = registry.get('read_file');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('core.read_file');
  });

  it('get() returns undefined for ambiguous base name', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.send'), noop);
    registry.register(makeDef('plugin.t.send'), noop);

    expect(registry.get('send')).toBeUndefined();
  });

  it('has() returns true for unambiguous base name', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.tool1'), noop);
    expect(registry.has('tool1')).toBe(true);
  });

  it('has() returns false for ambiguous base name', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core.tool1'), noop);
    registry.register(makeDef('plugin.x.tool1'), noop);
    expect(registry.has('tool1')).toBe(false);
  });
});

describe('ToolRegistry - lookup methods', () => {
  it('getDefinition returns definition for a tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('myTool', { description: 'Hello' }), noop);
    const def = registry.getDefinition('myTool');
    expect(def).toBeDefined();
    expect(def!.description).toBe('Hello');
  });

  it('getDefinition returns undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.getDefinition('nope')).toBeUndefined();
  });

  it('getDefinitionsByNames filters out non-existent names', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop);
    const defs = registry.getDefinitionsByNames(['tool1', 'nonexistent']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('tool1');
  });

  it('getNames returns all registered tool names', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('alpha'), noop);
    registry.register(makeDef('beta'), noop);
    const names = registry.getNames();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toHaveLength(2);
  });

  it('getAllTools returns definition+executor pairs', () => {
    const registry = new ToolRegistry();
    const exec1: ToolExecutor = async () => ({ content: 'a' });
    const exec2: ToolExecutor = async () => ({ content: 'b' });
    registry.register(makeDef('t1'), exec1);
    registry.register(makeDef('t2'), exec2);

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toHaveProperty('definition');
    expect(tools[0]).toHaveProperty('executor');
  });

  it('getPluginTools returns tools for a specific plugin', () => {
    const registry = new ToolRegistry();
    const pid = 'my-plugin' as PluginId;
    registry.register(makeDef('tool1'), noop, { source: 'plugin', pluginId: pid });
    registry.register(makeDef('tool2'), noop, { source: 'plugin', pluginId: pid });
    registry.register(makeDef('tool3'), noop); // core, no plugin

    const pluginTools = registry.getPluginTools(pid);
    expect(pluginTools).toHaveLength(2);
  });

  it('getPluginTools returns empty for unknown plugin', () => {
    const registry = new ToolRegistry();
    expect(registry.getPluginTools('no-such' as PluginId)).toHaveLength(0);
  });

  it('getRegisteredTool returns full metadata', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('tool1'), noop, {
      source: 'plugin',
      pluginId: 'pid' as PluginId,
      trustLevel: 'semi-trusted',
      providerName: 'prov',
    });
    const tool = registry.getRegisteredTool('tool1');
    expect(tool).toBeDefined();
    expect(tool!.source).toBe('plugin');
    expect(tool!.providerName).toBe('prov');
  });

  it('getToolsBySource filters by source', () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('core1'), noop, { source: 'core' });
    registry.register(makeDef('custom1'), noop, { source: 'custom' });
    registry.register(makeDef('custom2'), noop, { source: 'custom' });

    const customs = registry.getToolsBySource('custom');
    expect(customs).toHaveLength(2);
    const cores = registry.getToolsBySource('core');
    expect(cores).toHaveLength(1);
  });

  it('getToolsRequiringService finds tools with matching config requirements', () => {
    const registry = new ToolRegistry();
    registry.register(
      makeDef('weather', {
        configRequirements: [{ name: 'openweathermap' }],
      }),
      noop
    );
    registry.register(
      makeDef('email', {
        configRequirements: [{ name: 'smtp' }],
      }),
      noop
    );
    registry.register(makeDef('plain'), noop);

    const weatherTools = registry.getToolsRequiringService('openweathermap');
    expect(weatherTools).toHaveLength(1);
    expect(weatherTools[0].definition.name).toBe('weather');

    const plainTools = registry.getToolsRequiringService('nonexistent');
    expect(plainTools).toHaveLength(0);
  });
});

describe('ToolRegistry - workspace and config center', () => {
  it('setWorkspaceDir and getWorkspaceDir round-trip', () => {
    const registry = new ToolRegistry();
    expect(registry.getWorkspaceDir()).toBeUndefined();

    registry.setWorkspaceDir('/home/user/project');
    expect(registry.getWorkspaceDir()).toBe('/home/user/project');

    registry.setWorkspaceDir(undefined);
    expect(registry.getWorkspaceDir()).toBeUndefined();
  });

  it('setConfigCenter and getConfigCenter round-trip', () => {
    const registry = new ToolRegistry();
    expect(registry.getConfigCenter()).toBeUndefined();

    const mockCenter = {
      getApiKey: vi.fn(),
      getServiceConfig: vi.fn(),
      getConfigEntry: vi.fn(),
      getConfigEntries: vi.fn(),
      getFieldValue: vi.fn(),
      isServiceAvailable: vi.fn(),
      listServices: vi.fn(),
      getServiceDefinition: vi.fn(),
    } as unknown as ConfigCenter;

    registry.setConfigCenter(mockCenter);
    expect(registry.getConfigCenter()).toBe(mockCenter);
  });
});

describe('ToolRegistry - execute with ConfigCenter', () => {
  function makeConfigCenter() {
    return {
      getApiKey: vi.fn().mockReturnValue('key-123'),
      getServiceConfig: vi.fn().mockReturnValue({ name: 'svc' }),
      getConfigEntry: vi.fn().mockReturnValue({ id: 'entry-1' }),
      getConfigEntries: vi.fn().mockReturnValue([{ id: 'entry-1' }]),
      getFieldValue: vi.fn().mockReturnValue('field-value'),
      isServiceAvailable: vi.fn(),
      listServices: vi.fn(),
      getServiceDefinition: vi.fn(),
    } as unknown as ConfigCenter;
  }

  it('provides config accessors to trusted tools without restriction', async () => {
    const registry = new ToolRegistry();
    const center = makeConfigCenter();
    registry.setConfigCenter(center);

    let capturedCtx: Record<string, unknown> = {};
    registry.register(makeDef('core_tool'), async (_args, ctx) => {
      capturedCtx = {
        apiKey: ctx.getApiKey?.('any-service'),
        svcConfig: ctx.getServiceConfig?.('any-service'),
        entry: ctx.getConfigEntry?.('any-service'),
        entries: ctx.getConfigEntries?.('any-service'),
        fieldVal: ctx.getFieldValue?.('any-service', 'field'),
      };
      return { content: 'done' };
    });

    await registry.execute('core_tool', {}, { conversationId: 'c1' });

    expect(capturedCtx.apiKey).toBe('key-123');
    expect(capturedCtx.svcConfig).toEqual({ name: 'svc' });
    expect(capturedCtx.entry).toEqual({ id: 'entry-1' });
    expect(capturedCtx.entries).toEqual([{ id: 'entry-1' }]);
    expect(capturedCtx.fieldVal).toBe('field-value');
  });

  it('scopes config access for semi-trusted tools', async () => {
    const registry = new ToolRegistry();
    const center = makeConfigCenter();
    registry.setConfigCenter(center);

    let capturedCtx: Record<string, unknown> = {};
    registry.register(
      makeDef('plugin_tool', {
        configRequirements: [{ name: 'allowed-svc' }],
      }),
      async (_args, ctx) => {
        capturedCtx = {
          allowedKey: ctx.getApiKey?.('allowed-svc'),
          blockedKey: ctx.getApiKey?.('forbidden-svc'),
          allowedConfig: ctx.getServiceConfig?.('allowed-svc'),
          blockedConfig: ctx.getServiceConfig?.('forbidden-svc'),
          allowedEntry: ctx.getConfigEntry?.('allowed-svc'),
          blockedEntry: ctx.getConfigEntry?.('forbidden-svc'),
          allowedEntries: ctx.getConfigEntries?.('allowed-svc'),
          blockedEntries: ctx.getConfigEntries?.('forbidden-svc'),
          allowedField: ctx.getFieldValue?.('allowed-svc', 'key'),
          blockedField: ctx.getFieldValue?.('forbidden-svc', 'key'),
        };
        return { content: 'done' };
      },
      { source: 'plugin', pluginId: 'p1' as PluginId, trustLevel: 'semi-trusted' }
    );

    await registry.execute('plugin_tool', {}, { conversationId: 'c1' });

    // Allowed service should proxy through
    expect(capturedCtx.allowedKey).toBe('key-123');
    expect(capturedCtx.allowedConfig).toEqual({ name: 'svc' });
    expect(capturedCtx.allowedEntry).toEqual({ id: 'entry-1' });
    expect(capturedCtx.allowedEntries).toEqual([{ id: 'entry-1' }]);
    expect(capturedCtx.allowedField).toBe('field-value');

    // Forbidden service should be blocked
    expect(capturedCtx.blockedKey).toBeUndefined();
    expect(capturedCtx.blockedConfig).toBeNull();
    expect(capturedCtx.blockedEntry).toBeNull();
    expect(capturedCtx.blockedEntries).toEqual([]);
    expect(capturedCtx.blockedField).toBeUndefined();
  });

  it('provides no config accessors when no ConfigCenter is set', async () => {
    const registry = new ToolRegistry();
    // DO NOT set config center

    let capturedCtx: Record<string, unknown> = {};
    registry.register(makeDef('tool1'), async (_args, ctx) => {
      capturedCtx = {
        getApiKey: ctx.getApiKey,
        getServiceConfig: ctx.getServiceConfig,
        getConfigEntry: ctx.getConfigEntry,
        getConfigEntries: ctx.getConfigEntries,
        getFieldValue: ctx.getFieldValue,
      };
      return { content: 'done' };
    });

    await registry.execute('tool1', {}, { conversationId: 'c1' });

    expect(capturedCtx.getApiKey).toBeUndefined();
    expect(capturedCtx.getServiceConfig).toBeUndefined();
    expect(capturedCtx.getConfigEntry).toBeUndefined();
    expect(capturedCtx.getConfigEntries).toBeUndefined();
    expect(capturedCtx.getFieldValue).toBeUndefined();
  });

  it('uses registry workspaceDir as fallback when context does not provide it', async () => {
    const registry = new ToolRegistry();
    registry.setWorkspaceDir('/workspace');

    let capturedDir: string | undefined;
    registry.register(makeDef('tool1'), async (_args, ctx) => {
      capturedDir = ctx.workspaceDir;
      return { content: 'ok' };
    });

    await registry.execute('tool1', {}, { conversationId: 'c1' });
    expect(capturedDir).toBe('/workspace');
  });

  it('context workspaceDir takes precedence over registry default', async () => {
    const registry = new ToolRegistry();
    registry.setWorkspaceDir('/default');

    let capturedDir: string | undefined;
    registry.register(makeDef('tool1'), async (_args, ctx) => {
      capturedDir = ctx.workspaceDir;
      return { content: 'ok' };
    });

    await registry.execute('tool1', {}, { conversationId: 'c1', workspaceDir: '/override' });
    expect(capturedDir).toBe('/override');
  });
});

describe('ToolRegistry - unregisterPlugin', () => {
  it('removes all tools for a plugin and returns count', () => {
    const registry = new ToolRegistry();
    const pid = 'test-plugin' as PluginId;
    registry.register(makeDef('t1'), noop, { source: 'plugin', pluginId: pid });
    registry.register(makeDef('t2'), noop, { source: 'plugin', pluginId: pid });
    registry.register(makeDef('t3'), noop); // not this plugin

    const removed = registry.unregisterPlugin(pid);
    expect(removed).toBe(2);
    expect(registry.has('t1')).toBe(false);
    expect(registry.has('t2')).toBe(false);
    expect(registry.has('t3')).toBe(true);
  });

  it('returns 0 for unknown plugin', () => {
    const registry = new ToolRegistry();
    expect(registry.unregisterPlugin('nope' as PluginId)).toBe(0);
  });

  it('cleans up base name index when plugin is removed', () => {
    const registry = new ToolRegistry();
    const pid = 'p' as PluginId;
    registry.register(makeDef('plugin.p.action'), noop, { source: 'plugin', pluginId: pid });

    expect(registry.resolveBaseName('action')).toHaveLength(1);
    registry.unregisterPlugin(pid);
    expect(registry.resolveBaseName('action')).toHaveLength(0);
  });
});

describe('ToolRegistry - registerPluginTools', () => {
  it('registers plugin tools with qualified names', () => {
    const registry = new ToolRegistry();
    const pid = 'telegram' as PluginId;
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('send', { definition: makeDef('send_message'), executor: noop });

    registry.registerPluginTools(pid, tools);

    expect(registry.has('plugin.telegram.send_message')).toBe(true);
    const tool = registry.get('plugin.telegram.send_message');
    expect(tool!.source).toBe('plugin');
    expect(tool!.trustLevel).toBe('semi-trusted');
  });

  it('unregisterPluginTools removes them', () => {
    const registry = new ToolRegistry();
    const pid = 'telegram' as PluginId;
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('send', { definition: makeDef('send_message'), executor: noop });
    registry.registerPluginTools(pid, tools);

    const count = registry.unregisterPluginTools(pid);
    expect(count).toBe(1);
    expect(registry.has('plugin.telegram.send_message')).toBe(false);
  });
});

describe('ToolRegistry - registerMcpTools', () => {
  it('registers MCP tools with mcp. prefix', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('query', { definition: makeDef('run_query'), executor: noop });

    registry.registerMcpTools('dbserver', tools);

    expect(registry.has('mcp.dbserver.run_query')).toBe(true);
    const tool = registry.get('mcp.dbserver.run_query');
    expect(tool!.source).toBe('mcp');
    expect(tool!.trustLevel).toBe('semi-trusted');
  });

  it('unregisterMcpTools removes them', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('q', { definition: makeDef('run_query'), executor: noop });
    registry.registerMcpTools('dbserver', tools);

    const count = registry.unregisterMcpTools('dbserver');
    expect(count).toBe(1);
  });
});

describe('ToolRegistry - registerExtTools', () => {
  it('registers extension tools with ext. prefix and sandboxed trust', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('action', { definition: makeDef('do_action'), executor: noop });

    registry.registerExtTools('my_ext', tools);

    expect(registry.has('ext.my_ext.do_action')).toBe(true);
    const tool = registry.get('ext.my_ext.do_action');
    expect(tool!.source).toBe('dynamic');
    expect(tool!.trustLevel).toBe('sandboxed');
  });

  it('unregisterExtTools removes them', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('a', { definition: makeDef('do_action'), executor: noop });
    registry.registerExtTools('my_ext', tools);

    const count = registry.unregisterExtTools('my_ext');
    expect(count).toBe(1);
    expect(registry.has('ext.my_ext.do_action')).toBe(false);
  });
});

describe('ToolRegistry - registerSkillTools', () => {
  it('registers skill tools with skill. prefix and sandboxed trust', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('analyze', { definition: makeDef('analyze_code'), executor: noop });

    registry.registerSkillTools('code_review', tools);

    expect(registry.has('skill.code_review.analyze_code')).toBe(true);
    const tool = registry.get('skill.code_review.analyze_code');
    expect(tool!.source).toBe('dynamic');
    expect(tool!.trustLevel).toBe('sandboxed');
  });

  it('unregisterSkillTools removes them', () => {
    const registry = new ToolRegistry();
    const tools = new Map<string, { definition: ToolDefinition; executor: ToolExecutor }>();
    tools.set('a', { definition: makeDef('analyze_code'), executor: noop });
    registry.registerSkillTools('code_review', tools);

    const count = registry.unregisterSkillTools('code_review');
    expect(count).toBe(1);
  });
});

describe('ToolRegistry - registerCustomTool', () => {
  it('registers custom tool with custom. prefix and sandboxed trust', () => {
    const registry = new ToolRegistry();
    const result = registry.registerCustomTool(makeDef('my_helper'), noop, 'ct-1');

    expect(result.ok).toBe(true);
    expect(registry.has('custom.my_helper')).toBe(true);
    const tool = registry.get('custom.my_helper');
    expect(tool!.source).toBe('custom');
    expect(tool!.trustLevel).toBe('sandboxed');
    expect(tool!.customToolId).toBe('ct-1');
    expect(tool!.providerName).toBe('custom-tools');
  });
});

describe('ToolRegistry - registerProvider', () => {
  it('registers core provider tools with core. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'memory',
      source: 'core',
      getTools: () => [{ definition: makeDef('save_memory'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('core.save_memory')).toBe(true);
    const tool = registry.get('core.save_memory');
    expect(tool!.source).toBe('core');
    expect(tool!.trustLevel).toBe('trusted');
    expect(tool!.providerName).toBe('memory');
  });

  it('registers gateway provider tools with core. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'gateway-tools',
      source: 'gateway',
      getTools: () => [{ definition: makeDef('list_items'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('core.list_items')).toBe(true);
  });

  it('registers plugin provider tools with plugin. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'telegram-plugin',
      source: 'plugin',
      pluginId: 'telegram' as PluginId,
      getTools: () => [{ definition: makeDef('send_msg'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('plugin.telegram.send_msg')).toBe(true);
  });

  it('registers dynamic ext provider tools with ext. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'ext-provider',
      source: 'dynamic',
      pluginId: 'ext:my_extension' as PluginId,
      getTools: () => [{ definition: makeDef('action'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('ext.my_extension.action')).toBe(true);
  });

  it('registers dynamic skill provider tools with skill. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'skill-provider',
      source: 'dynamic',
      pluginId: 'skill:analyzer' as PluginId,
      getTools: () => [{ definition: makeDef('analyze'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('skill.analyzer.analyze')).toBe(true);
  });

  it('registers custom provider tools with custom. prefix', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'custom-provider',
      source: 'custom',
      getTools: () => [{ definition: makeDef('my_func'), executor: noop }],
    };
    registry.registerProvider(provider);

    expect(registry.has('custom.my_func')).toBe(true);
  });

  it('uses trusted trust level by default when provider does not specify', () => {
    const registry = new ToolRegistry();
    const provider: ToolProvider = {
      name: 'no-trust-provider',
      getTools: () => [{ definition: makeDef('tool1'), executor: noop }],
    };
    registry.registerProvider(provider);

    // source defaults to 'gateway' (not plugin), gets core. prefix
    expect(registry.has('core.tool1')).toBe(true);
    const tool = registry.get('core.tool1');
    expect(tool!.trustLevel).toBe('trusted');
  });
});

describe('ToolRegistry - executeToolCall content conversion', () => {
  it('converts undefined content to empty string', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('undef_tool'), async () => ({ content: undefined }));

    const result = await registry.executeToolCall(
      { id: 'c1', name: 'undef_tool', arguments: '{}' },
      'conv-1'
    );
    expect(result.content).toBe('');
    expect(result.isError).toBeFalsy();
  });

  it('converts null content to empty string', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('null_tool'), async () => ({ content: null }));

    const result = await registry.executeToolCall(
      { id: 'c1', name: 'null_tool', arguments: '{}' },
      'conv-1'
    );
    expect(result.content).toBe('');
  });

  it('passes through string content as-is', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('str_tool'), async () => ({ content: 'hello world' }));

    const result = await registry.executeToolCall(
      { id: 'c1', name: 'str_tool', arguments: '{}' },
      'conv-1'
    );
    expect(result.content).toBe('hello world');
  });

  it('JSON.stringifies object content', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('obj_tool'), async () => ({ content: { key: 'value' } }));

    const result = await registry.executeToolCall(
      { id: 'c1', name: 'obj_tool', arguments: '{}' },
      'conv-1'
    );
    expect(result.content).toBe('{"key":"value"}');
  });

  it('returns isError flag from tool result', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('err_tool'), async () => ({
      content: 'Something went wrong',
      isError: true,
    }));

    const result = await registry.executeToolCall(
      { id: 'c1', name: 'err_tool', arguments: '{}' },
      'conv-1'
    );
    expect(result.isError).toBe(true);
    expect(result.content).toBe('Something went wrong');
  });

  it('passes extraContext (requestApproval, executionPermissions) through', async () => {
    const registry = new ToolRegistry();
    let capturedApproval: unknown;
    let capturedPerms: unknown;
    registry.register(makeDef('ctx_tool'), async (_args, ctx) => {
      capturedApproval = ctx.requestApproval;
      capturedPerms = ctx.executionPermissions;
      return { content: 'ok' };
    });

    const mockApproval = vi.fn().mockResolvedValue(true);
    const mockPerms = {
      enabled: true,
      mode: 'local' as const,
      execute_javascript: 'allowed' as const,
      execute_python: 'blocked' as const,
      execute_shell: 'blocked' as const,
      compile_code: 'blocked' as const,
      package_manager: 'blocked' as const,
    };

    await registry.executeToolCall(
      { id: 'c1', name: 'ctx_tool', arguments: '{}' },
      'conv-1',
      'user-1',
      { requestApproval: mockApproval, executionPermissions: mockPerms }
    );

    expect(capturedApproval).toBe(mockApproval);
    expect(capturedPerms).toEqual(mockPerms);
  });
});

describe('ToolRegistry - executeToolCalls rejected promise handling', () => {
  it('handles rejected promises in parallel execution', async () => {
    const registry = new ToolRegistry();
    // Register a tool that rejects (not just throws)
    registry.register(makeDef('reject_tool'), () => Promise.reject(new Error('rejection')));

    const results = await registry.executeToolCalls(
      [{ id: 'c1', name: 'reject_tool', arguments: '{}' }],
      'conv-1'
    );

    // The error path in execute() catches and returns err() Result,
    // which executeToolCall handles, so it should be a fulfilled-with-error result
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(true);
  });

  it('handles non-Error rejection reasons', async () => {
    const registry = new ToolRegistry();
    registry.register(makeDef('reject_tool'), () => Promise.reject('string reason'));

    const results = await registry.executeToolCalls(
      [{ id: 'c1', name: 'reject_tool', arguments: '{}' }],
      'conv-1'
    );

    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(true);
  });
});

describe('ToolRegistry - useFor with after middleware', () => {
  it('tool-specific after middleware only runs for that tool', async () => {
    const registry = new ToolRegistry();
    const afterCalls: string[] = [];

    registry.useFor('target_tool', {
      name: 'specific-after',
      after: async (_ctx, result) => {
        afterCalls.push('target');
        return { ...result, content: `[modified] ${result.content}` };
      },
    });

    registry.register(makeDef('target_tool'), async () => ({ content: 'original' }));
    registry.register(makeDef('other_tool'), async () => ({ content: 'other' }));

    const r1 = await registry.execute('target_tool', {}, { conversationId: 'c1' });
    const r2 = await registry.execute('other_tool', {}, { conversationId: 'c1' });

    expect(r1.ok && r1.value.content).toBe('[modified] original');
    expect(r2.ok && r2.value.content).toBe('other');
    expect(afterCalls).toEqual(['target']);
  });
});

describe('createToolRegistry', () => {
  it('returns a new ToolRegistry instance', () => {
    const registry = createToolRegistry();
    expect(registry).toBeInstanceOf(ToolRegistry);
    expect(registry.getNames()).toHaveLength(0);
  });
});

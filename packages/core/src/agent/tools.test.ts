import { describe, it, expect } from 'vitest';
import { ToolRegistry, registerCoreTools } from './tools.js';
import type { ToolDefinition, ToolExecutor } from './types.js';

describe('ToolRegistry', () => {
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

      const result = registry.register(
        { ...definition, description: 'Duplicate' },
        executor
      );

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

      const result = await registry.execute('greet', { name: 'World' }, { conversationId: 'conv-1' });

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
});

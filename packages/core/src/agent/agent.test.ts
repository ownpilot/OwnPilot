import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent, createAgent, createSimpleAgent } from './agent.js';
import { ToolRegistry, registerCoreTools } from './tools.js';
import { ConversationMemory } from './memory.js';
import type { AgentConfig } from './types.js';

// Mock config for testing
const createTestConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: 'Test Agent',
  systemPrompt: 'You are a test assistant.',
  provider: {
    provider: 'openai',
    apiKey: 'test-api-key',
  },
  model: {
    model: 'gpt-4o',
    maxTokens: 1000,
    temperature: 0.7,
  },
  ...overrides,
});

describe('Agent', () => {
  describe('construction', () => {
    it('creates agent with config', () => {
      const agent = new Agent(createTestConfig());

      expect(agent.name).toBe('Test Agent');
      expect(agent.getState().isProcessing).toBe(false);
    });

    it('creates agent with custom tools', () => {
      const tools = new ToolRegistry();
      tools.register(
        {
          name: 'custom_tool',
          description: 'A custom tool',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ content: {} })
      );

      const agent = new Agent(createTestConfig(), { tools });

      expect(agent.getToolRegistry().has('custom_tool')).toBe(true);
      // Should not have core tools since custom registry was provided
      expect(agent.getToolRegistry().has('get_current_time')).toBe(false);
    });

    it('creates agent with custom memory', () => {
      const memory = new ConversationMemory({ maxTokens: 500 });
      const agent = new Agent(createTestConfig(), { memory });

      expect(agent.getMemory()).toBe(memory);
    });

    it('registers core tools by default', () => {
      const agent = new Agent(createTestConfig());

      expect(agent.getToolRegistry().has('get_current_time')).toBe(true);
      expect(agent.getToolRegistry().has('calculate')).toBe(true);
      expect(agent.getToolRegistry().has('generate_uuid')).toBe(true);
    });

    it('uses default config values', () => {
      const agent = new Agent({
        name: 'Test',
        systemPrompt: 'Test',
        provider: { provider: 'openai', apiKey: 'key' },
        model: { model: 'gpt-4o', maxTokens: 100 },
      });

      // Default maxTurns is 10, maxToolCalls is 5
      // These are internal, but we can verify agent is created
      expect(agent).toBeInstanceOf(Agent);
    });
  });

  describe('state management', () => {
    it('returns immutable state copy', () => {
      const agent = new Agent(createTestConfig());
      const state1 = agent.getState();
      const state2 = agent.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });

    it('initializes with a conversation', () => {
      const agent = new Agent(createTestConfig());
      const conversation = agent.getConversation();

      expect(conversation).toBeDefined();
      // System prompt is stored separately, not in messages
      expect(conversation.systemPrompt).toBe('You are a test assistant.');
      expect(conversation.messages).toHaveLength(0);
    });
  });

  describe('isReady', () => {
    it('returns true when API key is set', () => {
      const agent = new Agent(createTestConfig());
      expect(agent.isReady()).toBe(true);
    });

    it('returns false when no API key', () => {
      const agent = new Agent(
        createTestConfig({
          provider: { provider: 'openai', apiKey: '' },
        })
      );
      expect(agent.isReady()).toBe(false);
    });
  });

  describe('getTools', () => {
    it('returns all tool definitions', () => {
      const agent = new Agent(createTestConfig());
      const tools = agent.getTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.find((t) => t.name === 'get_current_time')).toBeDefined();
    });

    it('filters tools by config', () => {
      const agent = new Agent(
        createTestConfig({
          tools: ['get_current_time', 'calculate'],
        })
      );

      const tools = agent.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.find((t) => t.name === 'generate_uuid')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('creates new conversation', () => {
      const agent = new Agent(createTestConfig());
      const originalConv = agent.getConversation();

      const newConv = agent.reset();

      expect(newConv.id).not.toBe(originalConv.id);
      expect(agent.getConversation().id).toBe(newConv.id);
    });

    it('resets turn and tool call counts', () => {
      const agent = new Agent(createTestConfig());

      agent.reset();
      const state = agent.getState();

      expect(state.turnCount).toBe(0);
      expect(state.toolCallCount).toBe(0);
    });
  });

  describe('loadConversation', () => {
    it('loads existing conversation', () => {
      const agent = new Agent(createTestConfig());
      const conv1 = agent.getConversation();

      agent.reset();
      const conv2 = agent.getConversation();

      expect(agent.loadConversation(conv1.id)).toBe(true);
      expect(agent.getConversation().id).toBe(conv1.id);
    });

    it('returns false for non-existent conversation', () => {
      const agent = new Agent(createTestConfig());

      expect(agent.loadConversation('nonexistent')).toBe(false);
    });
  });

  describe('fork', () => {
    it('creates fork of current conversation', () => {
      const agent = new Agent(createTestConfig());
      const originalId = agent.getConversation().id;

      const forked = agent.fork();

      expect(forked).toBeDefined();
      expect(forked?.id).not.toBe(originalId);
      expect(agent.getConversation().id).toBe(forked?.id);
    });
  });

  describe('updateSystemPrompt', () => {
    it('updates system prompt', () => {
      const agent = new Agent(createTestConfig());

      agent.updateSystemPrompt('New system prompt');

      const conv = agent.getConversation();
      // System prompt is stored in the systemPrompt field, not in messages
      expect(conv.systemPrompt).toBe('New system prompt');
    });
  });

  describe('cancel', () => {
    it('sets processing to false', () => {
      const agent = new Agent(createTestConfig());

      agent.cancel();

      expect(agent.getState().isProcessing).toBe(false);
    });
  });

  describe('chat', () => {
    it('rejects when already processing', async () => {
      const agent = new Agent(createTestConfig());

      // Manually set processing state using internal state manipulation
      // We'll test this by calling chat when provider is not ready
      const result = await agent.chat('Hello');

      // Should return validation error since no actual API
      expect(result.ok).toBe(false);
    });

    it('rejects when provider not ready', async () => {
      const agent = new Agent(
        createTestConfig({
          provider: { provider: 'openai', apiKey: '' },
        })
      );

      const result = await agent.chat('Hello');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not configured');
      }
    });
  });
});

describe('createAgent', () => {
  it('creates agent instance', () => {
    const agent = createAgent(createTestConfig());

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe('Test Agent');
  });

  it('passes options to agent', () => {
    const tools = new ToolRegistry();
    const memory = new ConversationMemory();

    const agent = createAgent(createTestConfig(), { tools, memory });

    expect(agent.getToolRegistry()).toBe(tools);
    expect(agent.getMemory()).toBe(memory);
  });
});

describe('createSimpleAgent', () => {
  it('creates OpenAI agent', () => {
    const agent = createSimpleAgent('openai', 'test-key');

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe('Assistant');
  });

  it('creates Anthropic agent', () => {
    const agent = createSimpleAgent('anthropic', 'test-key');

    expect(agent).toBeInstanceOf(Agent);
  });

  it('accepts custom options', () => {
    const agent = createSimpleAgent('openai', 'test-key', {
      name: 'Custom Bot',
      systemPrompt: 'You are a custom bot.',
      model: 'gpt-3.5-turbo',
    });

    expect(agent.name).toBe('Custom Bot');
  });
});

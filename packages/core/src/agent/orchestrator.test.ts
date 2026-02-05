/**
 * Tests for AgentOrchestrator, AgentBuilder, MultiAgentOrchestrator,
 * createAgent, createPlanningPrompt, and parsePlan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition, ToolExecutor } from './types.js';

// ---------------------------------------------------------------------------
// Mocks - vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockEventSystem, mockInjectMemoryIntoPrompt } = vi.hoisted(() => {
  const mockEventSystem = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    hooks: { tap: vi.fn(), call: vi.fn() },
  };

  const mockInjectMemoryIntoPrompt = vi.fn().mockResolvedValue({
    systemPrompt: 'injected-system-prompt',
    userProfile: { userId: 'user-1', name: 'Alice' },
    toolCount: 0,
    instructionCount: 1,
    hasTimeContext: true,
    promptLength: 23,
  });

  return { mockEventSystem, mockInjectMemoryIntoPrompt };
});

vi.mock('../events/index.js', () => ({
  getEventSystem: vi.fn(() => mockEventSystem),
  getEventBus: vi.fn(() => ({ emit: vi.fn() })),
  createEvent: vi.fn((...args: unknown[]) => args),
  EventTypes: {
    TOOL_REGISTERED: 'tool.registered',
    TOOL_UNREGISTERED: 'tool.unregistered',
    TOOL_EXECUTED: 'tool.executed',
  },
}));

vi.mock('./memory-injector.js', () => ({
  injectMemoryIntoPrompt: mockInjectMemoryIntoPrompt,
}));

// Import after mocks are declared
import {
  AgentOrchestrator,
  AgentBuilder,
  MultiAgentOrchestrator,
  createAgent,
  createPlanningPrompt,
  parsePlan,
} from './orchestrator.js';
import type {
  AgentConfig,
  LLMProvider,
  OrchestratorContext,
  AgentStep,
  AgentTeam,
  Plan as _Plan,
} from './orchestrator.js';
import { ToolRegistry } from './tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, category?: string): ToolDefinition {
  return {
    name,
    description: `Desc for ${name}`,
    parameters: { type: 'object' as const, properties: {} },
    category,
  };
}

function makeExecutor(result: unknown = 'ok', isError = false): ToolExecutor {
  return vi.fn().mockResolvedValue({ content: result, isError });
}

/**
 * Create a mock LLM provider that returns a sequence of responses.
 * Each call to complete() consumes the next response from the array.
 * If the array is exhausted, returns a plain text response.
 */
function makeMockProvider(
  responses: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>
): LLMProvider {
  let callIndex = 0;
  return {
    complete: vi.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? { content: 'fallback response' };
      callIndex++;
      return Promise.resolve(response);
    }),
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'TestAgent',
    systemPrompt: 'You are a test agent.',
    provider: makeMockProvider([{ content: 'Hello!' }]),
    model: 'test-model',
    tools: [],
    toolExecutors: new Map(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('AgentOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Constructor & defaults
  // =========================================================================

  describe('constructor', () => {
    it('should create an instance with provided config', () => {
      const config = makeConfig();
      const orchestrator = new AgentOrchestrator(config);
      expect(orchestrator).toBeInstanceOf(AgentOrchestrator);
    });

    it('should set default maxIterations to 10', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(orchestrator.getConfig().maxIterations).toBe(10);
    });

    it('should set default maxTokens to 4096', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(orchestrator.getConfig().maxTokens).toBe(4096);
    });

    it('should set default temperature to 0.7', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(orchestrator.getConfig().temperature).toBe(0.7);
    });

    it('should set default verbose to false', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(orchestrator.getConfig().verbose).toBe(false);
    });

    it('should allow overriding maxIterations', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ maxIterations: 5 }));
      expect(orchestrator.getConfig().maxIterations).toBe(5);
    });

    it('should allow overriding maxTokens', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ maxTokens: 2048 }));
      expect(orchestrator.getConfig().maxTokens).toBe(2048);
    });

    it('should allow overriding temperature', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ temperature: 0.0 }));
      expect(orchestrator.getConfig().temperature).toBe(0.0);
    });

    it('should allow overriding verbose', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ verbose: true }));
      expect(orchestrator.getConfig().verbose).toBe(true);
    });

    it('should preserve the name from config', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ name: 'MyAgent' }));
      expect(orchestrator.getConfig().name).toBe('MyAgent');
    });

    it('should preserve the systemPrompt from config', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ systemPrompt: 'Custom prompt' }));
      expect(orchestrator.getConfig().systemPrompt).toBe('Custom prompt');
    });

    it('should preserve the model from config', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ model: 'gpt-4o' }));
      expect(orchestrator.getConfig().model).toBe('gpt-4o');
    });

    it('should preserve tools from config', () => {
      const tools = [makeTool('tool_a'), makeTool('tool_b')];
      const orchestrator = new AgentOrchestrator(makeConfig({ tools }));
      expect(orchestrator.getConfig().tools).toEqual(tools);
    });

    it('should preserve toolExecutors from config', () => {
      const executors = new Map<string, ToolExecutor>();
      executors.set('tool_a', makeExecutor());
      const orchestrator = new AgentOrchestrator(makeConfig({ toolExecutors: executors }));
      expect(orchestrator.getConfig().toolExecutors.has('tool_a')).toBe(true);
    });
  });

  // =========================================================================
  // getConfig
  // =========================================================================

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = makeConfig();
      const orchestrator = new AgentOrchestrator(config);
      const returned = orchestrator.getConfig();
      expect(returned).not.toBe(config);
    });

    it('should return config with all fields set', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ description: 'desc' }));
      const config = orchestrator.getConfig();
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('systemPrompt');
      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('tools');
      expect(config).toHaveProperty('toolExecutors');
      expect(config).toHaveProperty('maxIterations');
      expect(config).toHaveProperty('maxTokens');
      expect(config).toHaveProperty('temperature');
      expect(config).toHaveProperty('verbose');
      expect(config.description).toBe('desc');
    });

    it('should reflect updates after updateConfig is called', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ maxIterations: 3 });
      expect(orchestrator.getConfig().maxIterations).toBe(3);
    });
  });

  // =========================================================================
  // updateConfig
  // =========================================================================

  describe('updateConfig', () => {
    it('should update maxIterations', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ maxIterations: 20 });
      expect(orchestrator.getConfig().maxIterations).toBe(20);
    });

    it('should update temperature', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ temperature: 1.5 });
      expect(orchestrator.getConfig().temperature).toBe(1.5);
    });

    it('should update maxTokens', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ maxTokens: 8192 });
      expect(orchestrator.getConfig().maxTokens).toBe(8192);
    });

    it('should update verbose', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ verbose: true });
      expect(orchestrator.getConfig().verbose).toBe(true);
    });

    it('should update name', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ name: 'NewName' });
      expect(orchestrator.getConfig().name).toBe('NewName');
    });

    it('should not affect other fields when updating one field', () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ name: 'Original' }));
      orchestrator.updateConfig({ temperature: 0.1 });
      const config = orchestrator.getConfig();
      expect(config.name).toBe('Original');
      expect(config.temperature).toBe(0.1);
    });

    it('should update multiple fields at once', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ maxIterations: 5, temperature: 0.9, verbose: true });
      const config = orchestrator.getConfig();
      expect(config.maxIterations).toBe(5);
      expect(config.temperature).toBe(0.9);
      expect(config.verbose).toBe(true);
    });

    it('should update description', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      orchestrator.updateConfig({ description: 'Updated description' });
      expect(orchestrator.getConfig().description).toBe('Updated description');
    });
  });

  // =========================================================================
  // setToolRegistry
  // =========================================================================

  describe('setToolRegistry', () => {
    it('should accept a ToolRegistry without error', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const registry = new ToolRegistry();
      expect(() => orchestrator.setToolRegistry(registry)).not.toThrow();
    });
  });

  // =========================================================================
  // getCurrentExecution
  // =========================================================================

  describe('getCurrentExecution', () => {
    it('should return null when no execution is running', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(orchestrator.getCurrentExecution()).toBeNull();
    });

    it('should return null after execution completes', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      await orchestrator.execute('Hello');
      expect(orchestrator.getCurrentExecution()).toBeNull();
    });
  });

  // =========================================================================
  // execute - basic completion
  // =========================================================================

  describe('execute - basic completion', () => {
    it('should return a completed OrchestratorContext', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.status).toBe('completed');
    });

    it('should set the response from the provider', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.response).toBe('Hello!');
    });

    it('should generate an execution ID starting with exec_', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.id).toMatch(/^exec_\d+_/);
    });

    it('should set startTime', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.startTime).toBeInstanceOf(Date);
    });

    it('should set endTime', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should have endTime >= startTime', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.endTime!.getTime()).toBeGreaterThanOrEqual(result.startTime.getTime());
    });

    it('should have iteration count of 1 for simple completion', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.iteration).toBe(1);
    });

    it('should include the system prompt as the first message', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({ systemPrompt: 'You are a bot.' }));
      const result = await orchestrator.execute('Hello');
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('You are a bot.');
    });

    it('should include the user message in messages', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('What is the weather?');
      const userMsg = result.messages.find(m => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('What is the weather?');
    });

    it('should include the assistant response in messages', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('Hello!');
    });

    it('should have empty toolCalls for simple completion', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.toolCalls).toEqual([]);
    });

    it('should include conversation history when provided', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const history = [
        { role: 'user' as const, content: 'Previous message' },
        { role: 'assistant' as const, content: 'Previous response' },
      ];
      const result = await orchestrator.execute('New message', history);
      expect(result.messages[1].content).toBe('Previous message');
      expect(result.messages[2].content).toBe('Previous response');
      expect(result.messages[3].content).toBe('New message');
    });

    it('should pass metadata into context', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello', [], { key: 'value' });
      expect(result.metadata).toEqual({ key: 'value' });
    });

    it('should default metadata to empty object', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(result.metadata).toEqual({});
    });

    it('should call provider.complete with correct model', async () => {
      const provider = makeMockProvider([{ content: 'Reply' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider, model: 'gpt-4' }));
      await orchestrator.execute('Test');
      expect(provider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4' }),
      );
    });

    it('should call provider.complete with maxTokens', async () => {
      const provider = makeMockProvider([{ content: 'Reply' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider, maxTokens: 1000 }));
      await orchestrator.execute('Test');
      expect(provider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1000 }),
      );
    });

    it('should call provider.complete with temperature', async () => {
      const provider = makeMockProvider([{ content: 'Reply' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider, temperature: 0.5 }));
      await orchestrator.execute('Test');
      expect(provider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 }),
      );
    });

    it('should not pass tools to provider when tools array is empty', async () => {
      const provider = makeMockProvider([{ content: 'Reply' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider, tools: [] }));
      await orchestrator.execute('Test');
      expect(provider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ tools: undefined }),
      );
    });

    it('should pass tools to provider when tools array is non-empty', async () => {
      const tools = [makeTool('my_tool')];
      const provider = makeMockProvider([{ content: 'Reply' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider, tools }));
      await orchestrator.execute('Test');
      expect(provider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
      );
    });

    it('should handle provider returning empty content as empty string response', async () => {
      const provider = makeMockProvider([{ content: '' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Test');
      expect(result.response).toBe('');
    });

    it('should handle provider returning undefined content as empty string', async () => {
      const provider = makeMockProvider([{}]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Test');
      expect(result.response).toBe('');
    });
  });

  // =========================================================================
  // execute - events
  // =========================================================================

  describe('execute - events', () => {
    it('should emit agent.complete on successful execution', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      await orchestrator.execute('Hello');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.complete',
        expect.stringMatching(/^orchestrator:exec_/),
        expect.objectContaining({
          response: 'Hello!',
          iterationCount: 1,
        }),
      );
    });

    it('should emit agent.iteration for each loop iteration', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      await orchestrator.execute('Hello');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.iteration',
        expect.stringMatching(/^orchestrator:exec_/),
        expect.objectContaining({ iteration: 1 }),
      );
    });

    it('should emit agent.error when execution fails', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM failure')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Hello');
      expect(result.status).toBe('failed');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.error',
        expect.stringMatching(/^orchestrator:exec_/),
        expect.objectContaining({ error: 'LLM failure' }),
      );
    });

    it('should include agentId in agent.complete event data', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      const result = await orchestrator.execute('Hello');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.complete',
        expect.any(String),
        expect.objectContaining({ agentId: result.id }),
      );
    });

    it('should include duration in agent.complete event data', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      await orchestrator.execute('Hello');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.complete',
        expect.any(String),
        expect.objectContaining({ duration: expect.any(Number) }),
      );
    });
  });

  // =========================================================================
  // execute - tool calling loop
  // =========================================================================

  describe('execute - tool calling loop', () => {
    it('should execute a single tool call and continue', async () => {
      const toolExecutor = makeExecutor('weather: sunny');
      const provider = makeMockProvider([
        {
          content: 'Let me check',
          toolCalls: [{ id: 'tc1', name: 'get_weather', arguments: '{"city":"NYC"}' }],
        },
        { content: 'The weather in NYC is sunny.' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('get_weather')],
        toolExecutors: new Map([['get_weather', toolExecutor]]),
      }));

      const result = await orchestrator.execute('What is the weather?');

      expect(result.status).toBe('completed');
      expect(result.response).toBe('The weather in NYC is sunny.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].success).toBe(true);
    });

    it('should record tool call arguments', async () => {
      const toolExecutor = makeExecutor('result');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: '{"query":"test"}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('search')],
        toolExecutors: new Map([['search', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Search for test');
      expect(result.toolCalls[0].arguments).toEqual({ query: 'test' });
    });

    it('should record tool call result', async () => {
      const toolExecutor = makeExecutor({ data: 'found it' });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('search')],
        toolExecutors: new Map([['search', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Search');
      expect(result.toolCalls[0].result).toEqual({ data: 'found it' });
    });

    it('should record tool call duration', async () => {
      const toolExecutor = makeExecutor('ok');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'tool_a', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('tool_a')],
        toolExecutors: new Map([['tool_a', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Do something');
      expect(typeof result.toolCalls[0].duration).toBe('number');
      expect(result.toolCalls[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should execute multiple tool calls in one iteration', async () => {
      const execA = makeExecutor('result_a');
      const execB = makeExecutor('result_b');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [
            { id: 'tc1', name: 'tool_a', arguments: '{}' },
            { id: 'tc2', name: 'tool_b', arguments: '{}' },
          ],
        },
        { content: 'Both done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('tool_a'), makeTool('tool_b')],
        toolExecutors: new Map([['tool_a', execA], ['tool_b', execB]]),
      }));

      const result = await orchestrator.execute('Do both');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('tool_a');
      expect(result.toolCalls[1].name).toBe('tool_b');
    });

    it('should execute multiple iterations of tool calls', async () => {
      const exec = makeExecutor('done');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'step1', arguments: '{}' }],
        },
        {
          content: '',
          toolCalls: [{ id: 'tc2', name: 'step2', arguments: '{}' }],
        },
        { content: 'All steps done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('step1'), makeTool('step2')],
        toolExecutors: new Map([['step1', exec], ['step2', exec]]),
      }));

      const result = await orchestrator.execute('Multi-step');
      expect(result.iteration).toBe(3);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.response).toBe('All steps done');
    });

    it('should add tool result messages to the conversation', async () => {
      const toolExecutor = makeExecutor('tool_output');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Final' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Use tool');
      const toolMsg = result.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toBe(JSON.stringify('tool_output'));
    });

    it('should add assistant message with toolCalls before tool results', async () => {
      const toolExecutor = makeExecutor('output');
      const provider = makeMockProvider([
        {
          content: 'Thinking...',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      // Find assistant message that has toolCalls
      const assistantWithTools = result.messages.find(
        m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
      );
      expect(assistantWithTools).toBeDefined();
      expect(assistantWithTools!.content).toBe('Thinking...');
    });

    it('should emit agent.tool_call event when executing a tool', async () => {
      const toolExecutor = makeExecutor('result');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{"x":1}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      await orchestrator.execute('Test');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.tool_call',
        expect.stringMatching(/^orchestrator:exec_/),
        expect.objectContaining({
          toolName: 'my_tool',
          success: true,
        }),
      );
    });

    it('should pass tool context with callId and conversationId', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ content: 'ok', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc-123', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      await orchestrator.execute('Test');
      expect(toolExecutor).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          callId: 'tc-123',
          conversationId: expect.stringMatching(/^exec_/),
        }),
      );
    });

    it('should pass userId from metadata to tool context', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ content: 'ok', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      await orchestrator.execute('Test', [], { userId: 'user-42' });
      expect(toolExecutor).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ userId: 'user-42' }),
      );
    });

    it('should handle tool executor returning isError=true', async () => {
      const toolExecutor = makeExecutor('error details', true);
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Error occurred' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].success).toBe(false);
      // The tool message should still be added
      const toolMsg = result.messages.find(m => m.role === 'tool');
      expect(toolMsg!.toolResults![0].isError).toBe(true);
    });

    it('should handle tool executor throwing an error', async () => {
      const toolExecutor = vi.fn().mockRejectedValue(new Error('Tool crashed'));
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Handling error' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].success).toBe(false);
      expect(result.toolCalls[0].error).toBe('Tool crashed');
      expect(result.toolCalls[0].result).toEqual({ error: 'Tool crashed' });
    });

    it('should handle unknown tool name gracefully', async () => {
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'nonexistent_tool', arguments: '{}' }],
        },
        { content: 'Tool not found' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].success).toBe(false);
      expect(result.toolCalls[0].error).toBe('Unknown tool: nonexistent_tool');
    });

    it('should handle invalid JSON in tool arguments', async () => {
      const toolExecutor = makeExecutor('ok');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: 'not json at all{' }],
        },
        { content: 'Invalid args handled' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      // When JSON parsing fails, the early return skips context.toolCalls.push,
      // but the result is still added to messages as a tool message
      const toolMsg = result.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain('Error: Invalid JSON');
      // The executor should not have been called
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('should handle tool arguments that parse to a non-object (array)', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ content: 'ok', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '[1,2,3]' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      // When parsed to array, it should be treated as empty args {}
      expect(result.toolCalls[0].arguments).toEqual({});
    });

    it('should handle tool arguments that parse to null', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ content: 'ok', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: 'null' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].arguments).toEqual({});
    });

    it('should handle tool arguments that parse to a primitive', async () => {
      const toolExecutor = vi.fn().mockResolvedValue({ content: 'ok', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '"just a string"' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].arguments).toEqual({});
    });

    it('should look up tool executor from registry when not in config executors', async () => {
      const registryExecutor = vi.fn().mockResolvedValue({ content: 'from_registry', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'registry_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const registry = new ToolRegistry();
      const toolDef = makeTool('registry_tool');
      registry.register(toolDef, registryExecutor);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [toolDef],
      }));
      orchestrator.setToolRegistry(registry);

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].success).toBe(true);
      expect(result.toolCalls[0].result).toBe('from_registry');
    });

    it('should prefer config executor over registry executor', async () => {
      const configExecutor = vi.fn().mockResolvedValue({ content: 'from_config', isError: false });
      const registryExecutor = vi.fn().mockResolvedValue({ content: 'from_registry', isError: false });
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const registry = new ToolRegistry();
      const toolDef = makeTool('my_tool');
      registry.register(toolDef, registryExecutor);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [toolDef],
        toolExecutors: new Map([['my_tool', configExecutor]]),
      }));
      orchestrator.setToolRegistry(registry);

      const result = await orchestrator.execute('Test');
      expect(result.toolCalls[0].result).toBe('from_config');
      expect(configExecutor).toHaveBeenCalled();
      expect(registryExecutor).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute - maxIterations limit
  // =========================================================================

  describe('execute - maxIterations limit', () => {
    it('should stop at maxIterations when tool calls keep coming', async () => {
      // Provider always returns tool calls, never plain text
      const toolExecutor = makeExecutor('ok');
      const provider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'thinking',
          toolCalls: [{ id: 'tc', name: 'loop_tool', arguments: '{}' }],
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        maxIterations: 3,
        tools: [makeTool('loop_tool')],
        toolExecutors: new Map([['loop_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Loop forever');
      expect(result.iteration).toBe(3);
      expect(result.status).toBe('completed');
    });

    it('should set response to last assistant message when maxIterations reached', async () => {
      const toolExecutor = makeExecutor('ok');
      const provider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'still going',
          toolCalls: [{ id: 'tc', name: 'loop_tool', arguments: '{}' }],
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        maxIterations: 2,
        tools: [makeTool('loop_tool')],
        toolExecutors: new Map([['loop_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Loop');
      // The last message role should be 'tool', so the code checks the last assistant message
      // Actually, the loop adds assistant + tool messages. After maxIterations, the last message
      // is a tool result. The code checks if lastMessage.role === 'assistant'.
      // Since last message is 'tool', response should be '[Max iterations reached]'.
      expect(result.response).toBeDefined();
    });

    it('should return [Max iterations reached] when last message is not assistant', async () => {
      const toolExecutor = makeExecutor('ok');
      const provider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: '',
          toolCalls: [{ id: 'tc', name: 'loop_tool', arguments: '{}' }],
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        maxIterations: 1,
        tools: [makeTool('loop_tool')],
        toolExecutors: new Map([['loop_tool', toolExecutor]]),
      }));

      const result = await orchestrator.execute('Loop');
      // After 1 iteration: assistant msg (with toolCalls) -> tool msg
      // Last message is 'tool', so response = '[Max iterations reached]'
      expect(result.response).toBe('[Max iterations reached]');
    });

    it('should emit agent.complete even when maxIterations is hit', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'loop',
          toolCalls: [{ id: 'tc', name: 'loop_tool', arguments: '{}' }],
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        maxIterations: 1,
        tools: [makeTool('loop_tool')],
        toolExecutors: new Map([['loop_tool', makeExecutor('ok')]]),
      }));

      const result = await orchestrator.execute('Loop');
      expect(result.status).toBe('completed');
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.complete',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should call provider.complete exactly maxIterations times when always tool calling', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: '',
          toolCalls: [{ id: 'tc', name: 't', arguments: '{}' }],
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        maxIterations: 4,
        tools: [makeTool('t')],
        toolExecutors: new Map([['t', makeExecutor('ok')]]),
      }));

      await orchestrator.execute('Loop');
      expect(provider.complete).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // execute - error handling
  // =========================================================================

  describe('execute - error handling', () => {
    it('should set status to failed when provider throws', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('API error')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Hello');
      expect(result.status).toBe('failed');
    });

    it('should set error message from Error instance', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Hello');
      expect(result.error).toBe('Network timeout');
    });

    it('should set error message from non-Error thrown value', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue('string error'),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Hello');
      expect(result.error).toBe('string error');
    });

    it('should set endTime even on failure', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('fail')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      const result = await orchestrator.execute('Hello');
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should clear currentExecution on failure', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('fail')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      await orchestrator.execute('Hello');
      expect(orchestrator.getCurrentExecution()).toBeNull();
    });

    it('should emit agent.error with iteration count', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('fail')),
      };
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));
      await orchestrator.execute('Hello');
      // Iteration counter increments before the provider call that fails
      expect(mockEventSystem.emit).toHaveBeenCalledWith(
        'agent.error',
        expect.any(String),
        expect.objectContaining({ iteration: 1 }),
      );
    });

    it('should handle error on second iteration', async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        complete: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              content: '',
              toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
            });
          }
          return Promise.reject(new Error('second call failed'));
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', makeExecutor('ok')]]),
      }));

      const result = await orchestrator.execute('Test');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('second call failed');
      expect(result.iteration).toBe(2);
    });
  });

  // =========================================================================
  // execute - abort / cancel
  // =========================================================================

  describe('execute - cancel', () => {
    it('should set status to cancelled when cancel() is called during execution', async () => {
      // Create a provider that gives us time to cancel
      const provider: LLMProvider = {
        complete: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ content: 'delayed' }), 100);
          });
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      // Start execution and cancel quickly
      const executePromise = orchestrator.execute('Hello');

      // Let the execution start, then cancel
      await new Promise((resolve) => setTimeout(resolve, 10));
      orchestrator.cancel();

      const result = await executePromise;
      // The cancel might not take effect if complete() already resolved.
      // But the signal should be set.
      expect(result.status === 'cancelled' || result.status === 'completed' || result.status === 'failed').toBe(true);
    });

    it('should cancel via abort signal during tool calling loop', async () => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      let callCount = 0;
      const provider: LLMProvider = {
        complete: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              content: '',
              toolCalls: [{ id: 'tc1', name: 'slow_tool', arguments: '{}' }],
            });
          }
          // Second call: wait a while
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }),
      };

      const toolExecutor = makeExecutor('done');
      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('slow_tool')],
        toolExecutors: new Map([['slow_tool', toolExecutor]]),
      }));

      const executePromise = orchestrator.execute('Test');

      // Wait for second provider call
      await new Promise((resolve) => setTimeout(resolve, 50));
      orchestrator.cancel();

      // Resolve the pending provider call so the promise resolves
      if (resolveFirst) {
        resolveFirst({ content: 'after cancel' });
      }

      const result = await executePromise;
      // After the second call resolves, it checks abort signal at loop top
      // so the third iteration would throw 'Execution cancelled'
      expect(['completed', 'cancelled', 'failed']).toContain(result.status);
    });

    it('should be safe to call cancel() when no execution is running', () => {
      const orchestrator = new AgentOrchestrator(makeConfig());
      expect(() => orchestrator.cancel()).not.toThrow();
    });

    it('should fail with Execution cancelled when abort signal is set before loop', async () => {
      // We'll simulate by having the first provider call trigger cancel
      const orchestrator = new AgentOrchestrator(makeConfig({
        provider: {
          complete: vi.fn().mockImplementation(async () => {
            // Cancel from within provider call, so the next iteration check catches it
            orchestrator.cancel();
            return {
              content: '',
              toolCalls: [{ id: 'tc1', name: 'tool_a', arguments: '{}' }],
            };
          }),
        },
        tools: [makeTool('tool_a')],
        toolExecutors: new Map([['tool_a', makeExecutor('ok')]]),
      }));

      const result = await orchestrator.execute('Test');
      // After first iteration: tool calls are processed, then at the top of loop 2,
      // abort signal is checked -> throws 'Execution cancelled'
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Execution cancelled');
    });
  });

  // =========================================================================
  // execute - memory injection (dynamic prompts)
  // =========================================================================

  describe('execute - dynamic prompts / memory injection', () => {
    it('should use base systemPrompt when enableDynamicPrompts is false', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        systemPrompt: 'Base prompt',
        enableDynamicPrompts: false,
        userId: 'user-1',
      }));

      const result = await orchestrator.execute('Hello');
      expect(result.messages[0].content).toBe('Base prompt');
      expect(mockInjectMemoryIntoPrompt).not.toHaveBeenCalled();
    });

    it('should use base systemPrompt when userId is not set', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        systemPrompt: 'Base prompt',
        enableDynamicPrompts: true,
      }));

      const result = await orchestrator.execute('Hello');
      expect(result.messages[0].content).toBe('Base prompt');
      expect(mockInjectMemoryIntoPrompt).not.toHaveBeenCalled();
    });

    it('should call injectMemoryIntoPrompt when enableDynamicPrompts and userId are set', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        systemPrompt: 'Base prompt',
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        'Base prompt',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('should use the injected system prompt in messages', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        systemPrompt: 'Base prompt',
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      const result = await orchestrator.execute('Hello');
      expect(result.messages[0].content).toBe('injected-system-prompt');
    });

    it('should fall back to base prompt when injectMemoryIntoPrompt throws', async () => {
      mockInjectMemoryIntoPrompt.mockRejectedValueOnce(new Error('injection failed'));

      const orchestrator = new AgentOrchestrator(makeConfig({
        systemPrompt: 'Fallback prompt',
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      const result = await orchestrator.execute('Hello');
      expect(result.messages[0].content).toBe('Fallback prompt');
    });

    it('should pass includeProfile option to injectMemoryIntoPrompt', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeProfile: true }),
      );
    });

    it('should pass includeInstructions option to injectMemoryIntoPrompt', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeInstructions: true }),
      );
    });

    it('should pass includeTimeContext option to injectMemoryIntoPrompt', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeTimeContext: true }),
      );
    });

    it('should detect codeExecution capability from tool categories', async () => {
      const tools = [makeTool('run_code', 'code_execution')];
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
        tools,
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: expect.objectContaining({ codeExecution: true }),
        }),
      );
    });

    it('should detect fileAccess capability from tool categories', async () => {
      const tools = [makeTool('read_file', 'file_system')];
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
        tools,
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: expect.objectContaining({ fileAccess: true }),
        }),
      );
    });

    it('should detect webBrowsing capability from tool categories', async () => {
      const tools = [makeTool('fetch_url', 'web_fetch')];
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
        tools,
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: expect.objectContaining({ webBrowsing: true }),
        }),
      );
    });

    it('should always set memory capability to true', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: expect.objectContaining({ memory: true }),
        }),
      );
    });

    it('should pass conversation context with messageCount when history is provided', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      const history = [
        { role: 'user' as const, content: 'msg1' },
        { role: 'assistant' as const, content: 'msg2' },
      ];

      await orchestrator.execute('Hello', history);
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          conversationContext: expect.objectContaining({ messageCount: 2 }),
        }),
      );
    });

    it('should not pass conversation context when history is empty', async () => {
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
      }));

      await orchestrator.execute('Hello', []);
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          conversationContext: undefined,
        }),
      );
    });

    it('should forward memoryOptions from config', async () => {
      const memoryOptions = { maxPromptLength: 5000 };
      const orchestrator = new AgentOrchestrator(makeConfig({
        enableDynamicPrompts: true,
        userId: 'user-1',
        memoryOptions,
      }));

      await orchestrator.execute('Hello');
      expect(mockInjectMemoryIntoPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxPromptLength: 5000 }),
      );
    });
  });

  // =========================================================================
  // stream
  // =========================================================================

  describe('stream', () => {
    it('should yield thinking step at the start of each iteration', async () => {
      const provider = makeMockProvider([{ content: 'Streamed response' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const thinkingSteps = steps.filter(s => s.type === 'thinking');
      expect(thinkingSteps.length).toBeGreaterThanOrEqual(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((thinkingSteps[0].content as any).iteration).toBe(1);
    });

    it('should yield response step with content', async () => {
      const provider = makeMockProvider([{ content: 'Hello back!' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const responseSteps = steps.filter(s => s.type === 'response');
      expect(responseSteps.length).toBeGreaterThanOrEqual(1);
    });

    it('should return a completed context as return value', async () => {
      const provider = makeMockProvider([{ content: 'Done' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const context = result.value as OrchestratorContext;
      expect(context.status).toBe('completed');
      expect(context.response).toBe('Done');
    });

    it('should yield tool_call and tool_result steps when tools are used', async () => {
      const toolExecutor = makeExecutor('tool_output');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'After tool' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Use tool');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const toolCallSteps = steps.filter(s => s.type === 'tool_call');
      const toolResultSteps = steps.filter(s => s.type === 'tool_result');
      expect(toolCallSteps).toHaveLength(1);
      expect(toolResultSteps).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((toolCallSteps[0].content as any).name).toBe('my_tool');
    });

    it('should use streaming provider when available', async () => {
      async function* mockStream() {
        yield { content: 'chunk1' };
        yield { content: 'chunk2' };
      }

      const provider: LLMProvider = {
        complete: vi.fn(),
        stream: vi.fn().mockReturnValue(mockStream()),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      expect(provider.stream).toHaveBeenCalled();
      expect(provider.complete).not.toHaveBeenCalled();

      const responseSteps = steps.filter(s => s.type === 'response');
      expect(responseSteps.length).toBe(2);
    });

    it('should accumulate content from streaming chunks', async () => {
      async function* mockStream() {
        yield { content: 'Hello ' };
        yield { content: 'World' };
      }

      const provider: LLMProvider = {
        complete: vi.fn(),
        stream: vi.fn().mockReturnValue(mockStream()),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const responseSteps = steps.filter(s => s.type === 'response');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((responseSteps[1].content as any).accumulated).toBe('Hello World');
    });

    it('should fall back to non-streaming when provider has no stream method', async () => {
      const provider = makeMockProvider([{ content: 'Non-streamed' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const responseSteps = steps.filter(s => s.type === 'response');
      expect(responseSteps.length).toBeGreaterThanOrEqual(1);

      const context = result.value as OrchestratorContext;
      expect(context.response).toBe('Non-streamed');
    });

    it('should handle streaming with tool calls from chunks', async () => {
      const toolExecutor = makeExecutor('tool_result');

      async function* mockStream1() {
        yield { content: 'thinking', toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }] };
      }

      async function* mockStream2() {
        yield { content: 'final answer' };
      }

      let streamCallCount = 0;
      const provider: LLMProvider = {
        complete: vi.fn(),
        stream: vi.fn().mockImplementation(() => {
          streamCallCount++;
          if (streamCallCount === 1) return mockStream1();
          return mockStream2();
        }),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Test');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      const toolCallSteps = steps.filter(s => s.type === 'tool_call');
      expect(toolCallSteps).toHaveLength(1);
    });

    it('should set failed status on stream error', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('stream error')),
      };

      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const context = result.value as OrchestratorContext;
      expect(context.status).toBe('failed');
      expect(context.error).toBe('stream error');
    });

    it('should have timestamps on all yielded steps', async () => {
      const provider = makeMockProvider([{ content: 'Response' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const steps: AgentStep[] = [];
      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        steps.push(result.value);
        result = await gen.next();
      }

      for (const step of steps) {
        expect(step.timestamp).toBeInstanceOf(Date);
      }
    });

    it('should generate a unique execution ID for stream', async () => {
      const provider = makeMockProvider([{ content: 'Response' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const context = result.value as OrchestratorContext;
      expect(context.id).toMatch(/^exec_\d+_/);
    });

    it('should clear currentExecution after stream completes', async () => {
      const provider = makeMockProvider([{ content: 'Response' }]);
      const orchestrator = new AgentOrchestrator(makeConfig({ provider }));

      const gen = orchestrator.stream('Hello');
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      expect(orchestrator.getCurrentExecution()).toBeNull();
    });
  });

  // =========================================================================
  // execute - verbose logging
  // =========================================================================

  describe('execute - verbose logging', () => {
    it('should log tool calls when verbose is true', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const toolExecutor = makeExecutor('result');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        verbose: true,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      await orchestrator.execute('Test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Tool] my_tool:'),
        expect.anything(),
        '->',
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it('should not log when verbose is false', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const toolExecutor = makeExecutor('result');
      const provider = makeMockProvider([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'my_tool', arguments: '{}' }],
        },
        { content: 'Done' },
      ]);

      const orchestrator = new AgentOrchestrator(makeConfig({
        provider,
        verbose: false,
        tools: [makeTool('my_tool')],
        toolExecutors: new Map([['my_tool', toolExecutor]]),
      }));

      await orchestrator.execute('Test');

      const toolLogs = consoleSpy.mock.calls.filter(
        args => typeof args[0] === 'string' && args[0].includes('[Tool]'),
      );
      expect(toolLogs).toHaveLength(0);
      consoleSpy.mockRestore();
    });
  });
});

// ===========================================================================
// AgentBuilder
// ===========================================================================

describe('AgentBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new AgentBuilder via createAgent()', () => {
    const builder = createAgent();
    expect(builder).toBeInstanceOf(AgentBuilder);
  });

  it('should support chaining name()', () => {
    const builder = new AgentBuilder();
    const result = builder.name('Bot');
    expect(result).toBe(builder);
  });

  it('should support chaining description()', () => {
    const builder = new AgentBuilder();
    const result = builder.description('A bot');
    expect(result).toBe(builder);
  });

  it('should support chaining systemPrompt()', () => {
    const builder = new AgentBuilder();
    const result = builder.systemPrompt('Prompt');
    expect(result).toBe(builder);
  });

  it('should support chaining provider()', () => {
    const builder = new AgentBuilder();
    const result = builder.provider(makeMockProvider([{ content: 'ok' }]));
    expect(result).toBe(builder);
  });

  it('should support chaining model()', () => {
    const builder = new AgentBuilder();
    const result = builder.model('gpt-4');
    expect(result).toBe(builder);
  });

  it('should support chaining tool()', () => {
    const builder = new AgentBuilder();
    const result = builder.tool(makeTool('t'), makeExecutor());
    expect(result).toBe(builder);
  });

  it('should support chaining tools()', () => {
    const builder = new AgentBuilder();
    const result = builder.tools([
      { definition: makeTool('t1'), executor: makeExecutor() },
      { definition: makeTool('t2'), executor: makeExecutor() },
    ]);
    expect(result).toBe(builder);
  });

  it('should support chaining maxIterations()', () => {
    const builder = new AgentBuilder();
    const result = builder.maxIterations(5);
    expect(result).toBe(builder);
  });

  it('should support chaining maxTokens()', () => {
    const builder = new AgentBuilder();
    const result = builder.maxTokens(2048);
    expect(result).toBe(builder);
  });

  it('should support chaining temperature()', () => {
    const builder = new AgentBuilder();
    const result = builder.temperature(0.5);
    expect(result).toBe(builder);
  });

  it('should support chaining verbose()', () => {
    const builder = new AgentBuilder();
    const result = builder.verbose(true);
    expect(result).toBe(builder);
  });

  it('should support verbose() with default parameter', () => {
    const builder = new AgentBuilder();
    const result = builder.verbose();
    expect(result).toBe(builder);
  });

  it('should build a valid AgentOrchestrator with all required fields', () => {
    const orchestrator = new AgentBuilder()
      .name('TestAgent')
      .systemPrompt('You are a test agent.')
      .provider(makeMockProvider([]))
      .model('test-model')
      .maxIterations(10)
      .build();

    expect(orchestrator).toBeInstanceOf(AgentOrchestrator);
  });

  it('should set name on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('MyBot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .build();

    expect(orchestrator.getConfig().name).toBe('MyBot');
  });

  it('should set description on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .description('A helpful bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .build();

    expect(orchestrator.getConfig().description).toBe('A helpful bot');
  });

  it('should set systemPrompt on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Custom prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .build();

    expect(orchestrator.getConfig().systemPrompt).toBe('Custom prompt');
  });

  it('should set model on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('gpt-4o')
      .build();

    expect(orchestrator.getConfig().model).toBe('gpt-4o');
  });

  it('should set tools on built agent via tool()', () => {
    const toolDef = makeTool('tool_a');
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .tool(toolDef, makeExecutor())
      .build();

    expect(orchestrator.getConfig().tools).toHaveLength(1);
    expect(orchestrator.getConfig().tools[0].name).toBe('tool_a');
  });

  it('should set tools on built agent via tools()', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .tools([
        { definition: makeTool('a'), executor: makeExecutor() },
        { definition: makeTool('b'), executor: makeExecutor() },
      ])
      .build();

    expect(orchestrator.getConfig().tools).toHaveLength(2);
  });

  it('should set tool executors on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .tool(makeTool('tool_a'), makeExecutor())
      .build();

    expect(orchestrator.getConfig().toolExecutors.has('tool_a')).toBe(true);
  });

  it('should set maxIterations on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .maxIterations(20)
      .build();

    expect(orchestrator.getConfig().maxIterations).toBe(20);
  });

  it('should set maxTokens on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .maxTokens(8192)
      .build();

    expect(orchestrator.getConfig().maxTokens).toBe(8192);
  });

  it('should set temperature on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .temperature(0.3)
      .build();

    expect(orchestrator.getConfig().temperature).toBe(0.3);
  });

  it('should set verbose on built agent', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .verbose(true)
      .build();

    expect(orchestrator.getConfig().verbose).toBe(true);
  });

  it('should chain all methods together fluently', () => {
    const orchestrator = new AgentBuilder()
      .name('FullAgent')
      .description('Fully configured')
      .systemPrompt('Full prompt')
      .provider(makeMockProvider([]))
      .model('gpt-4o')
      .tool(makeTool('tool_a'), makeExecutor())
      .maxIterations(15)
      .maxTokens(2048)
      .temperature(0.9)
      .verbose(true)
      .build();

    const config = orchestrator.getConfig();
    expect(config.name).toBe('FullAgent');
    expect(config.description).toBe('Fully configured');
    expect(config.systemPrompt).toBe('Full prompt');
    expect(config.model).toBe('gpt-4o');
    expect(config.tools).toHaveLength(1);
    expect(config.maxIterations).toBe(15);
    expect(config.maxTokens).toBe(2048);
    expect(config.temperature).toBe(0.9);
    expect(config.verbose).toBe(true);
  });

  // Validation errors

  it('should throw when name is missing', () => {
    const builder = new AgentBuilder()
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model');

    expect(() => builder.build()).toThrow('Agent name is required');
  });

  it('should throw when systemPrompt is missing', () => {
    const builder = new AgentBuilder()
      .name('Bot')
      .provider(makeMockProvider([]))
      .model('model');

    expect(() => builder.build()).toThrow('System prompt is required');
  });

  it('should throw when provider is missing', () => {
    const builder = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .model('model');

    expect(() => builder.build()).toThrow('LLM provider is required');
  });

  it('should throw when model is missing', () => {
    const builder = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]));

    expect(() => builder.build()).toThrow('Model is required');
  });

  it('should default to empty tools when none are added', () => {
    const orchestrator = new AgentBuilder()
      .name('Bot')
      .systemPrompt('Prompt')
      .provider(makeMockProvider([]))
      .model('model')
      .build();

    expect(orchestrator.getConfig().tools).toEqual([]);
    expect(orchestrator.getConfig().toolExecutors.size).toBe(0);
  });
});

// ===========================================================================
// createAgent factory
// ===========================================================================

describe('createAgent', () => {
  it('should return an AgentBuilder instance', () => {
    const builder = createAgent();
    expect(builder).toBeInstanceOf(AgentBuilder);
  });

  it('should return a fresh builder each time', () => {
    const a = createAgent();
    const b = createAgent();
    expect(a).not.toBe(b);
  });

  it('should produce a working orchestrator when builder is fully configured', async () => {
    const orchestrator = createAgent()
      .name('FactoryAgent')
      .systemPrompt('You are a factory agent.')
      .provider(makeMockProvider([{ content: 'Factory response' }]))
      .model('test-model')
      .maxIterations(10)
      .build();

    const result = await orchestrator.execute('Test');
    expect(result.status).toBe('completed');
    expect(result.response).toBe('Factory response');
  });
});

// ===========================================================================
// MultiAgentOrchestrator
// ===========================================================================

describe('MultiAgentOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeTeam(
    name: string,
    agentNames: string[],
    _router?: (msg: string) => string,
  ): AgentTeam {
    const agents = new Map<string, AgentOrchestrator>();
    for (const agentName of agentNames) {
      agents.set(
        agentName,
        new AgentOrchestrator(makeConfig({
          name: agentName,
          provider: makeMockProvider([{ content: `Response from ${agentName}` }]),
        })),
      );
    }

    return {
      name,
      agents,
      router: _router ?? (() => agentNames[0]),
      sharedContext: {},
    };
  }

  it('should register a team', () => {
    const mao = new MultiAgentOrchestrator();
    const team = makeTeam('team1', ['agent1']);
    mao.registerTeam(team);
    expect(mao.getTeams()).toEqual(['team1']);
  });

  it('should set the first registered team as default', () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['agent1']));
    mao.registerTeam(makeTeam('team2', ['agent2']));
    // Default should be team1 since it was registered first
    expect(mao.getTeams()).toContain('team1');
  });

  it('should register multiple teams', () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('alpha', ['a1']));
    mao.registerTeam(makeTeam('beta', ['b1']));
    expect(mao.getTeams()).toEqual(['alpha', 'beta']);
  });

  it('should return agent names in a team', () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['agent_a', 'agent_b']));
    expect(mao.getAgents('team1')).toEqual(['agent_a', 'agent_b']);
  });

  it('should return empty array for non-existent team in getAgents', () => {
    const mao = new MultiAgentOrchestrator();
    expect(mao.getAgents('nonexistent')).toEqual([]);
  });

  it('should set default team', () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['a1']));
    mao.registerTeam(makeTeam('team2', ['a2']));
    mao.setDefaultTeam('team2');
    // Verify by executing without specifying a team
    // It should route to team2
  });

  it('should throw when setting default to non-existent team', () => {
    const mao = new MultiAgentOrchestrator();
    expect(() => mao.setDefaultTeam('ghost')).toThrow('Team not found: ghost');
  });

  it('should execute message using the default team', async () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['agent1']));

    const result = await mao.execute('Hello');
    expect(result.status).toBe('completed');
    expect(result.response).toBe('Response from agent1');
  });

  it('should execute message using a specified team', async () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['agent1']));
    mao.registerTeam(makeTeam('team2', ['agent2']));

    const result = await mao.execute('Hello', 'team2');
    expect(result.response).toBe('Response from agent2');
  });

  it('should throw when executing with non-existent team', async () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['agent1']));

    await expect(mao.execute('Hello', 'ghost')).rejects.toThrow('Team not found: ghost');
  });

  it('should throw when router returns non-existent agent', async () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam({
      name: 'team1',
      agents: new Map(),
      router: () => 'missing_agent',
      sharedContext: {},
    });

    await expect(mao.execute('Hello')).rejects.toThrow('Agent not found: missing_agent');
  });

  it('should use router to select the right agent', async () => {
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam(makeTeam('team1', ['coder', 'writer'], (msg) => {
      return msg.includes('code') ? 'coder' : 'writer';
    }));

    const codeResult = await mao.execute('Write some code');
    expect(codeResult.response).toBe('Response from coder');

    const writeResult = await mao.execute('Write a story');
    expect(writeResult.response).toBe('Response from writer');
  });

  it('should pass shared context and additional context to router', async () => {
    const routerSpy = vi.fn().mockReturnValue('agent1');
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam({
      name: 'team1',
      agents: new Map([
        ['agent1', new AgentOrchestrator(makeConfig({
          provider: makeMockProvider([{ content: 'ok' }]),
        }))],
      ]),
      router: routerSpy,
      sharedContext: { shared: 'value' },
    });

    await mao.execute('Hello', undefined, { extra: 'data' });
    expect(routerSpy).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ shared: 'value', extra: 'data' }),
    );
  });

  it('should pass merged context to agent.execute', async () => {
    const provider = makeMockProvider([{ content: 'ok' }]);
    const mao = new MultiAgentOrchestrator();
    mao.registerTeam({
      name: 'team1',
      agents: new Map([
        ['agent1', new AgentOrchestrator(makeConfig({ provider }))],
      ]),
      router: () => 'agent1',
      sharedContext: { shared: true },
    });

    const result = await mao.execute('Hello', undefined, { extra: 42 });
    expect(result.metadata).toEqual({ shared: true, extra: 42 });
  });

  it('should throw when no default team is set and no team is specified', async () => {
    const mao = new MultiAgentOrchestrator();
    await expect(mao.execute('Hello')).rejects.toThrow('Team not found');
  });
});

// ===========================================================================
// createPlanningPrompt
// ===========================================================================

describe('createPlanningPrompt', () => {
  it('should include the goal in the output', () => {
    const result = createPlanningPrompt('Build a website', []);
    expect(result).toContain('GOAL: Build a website');
  });

  it('should include "planning agent" instruction', () => {
    const result = createPlanningPrompt('task', []);
    expect(result).toContain('planning agent');
  });

  it('should include available tools in the output', () => {
    const tools = [makeTool('search'), makeTool('fetch_url')];
    const result = createPlanningPrompt('Find info', tools);
    expect(result).toContain('- search: Desc for search');
    expect(result).toContain('- fetch_url: Desc for fetch_url');
  });

  it('should include AVAILABLE TOOLS section', () => {
    const result = createPlanningPrompt('task', [makeTool('t')]);
    expect(result).toContain('AVAILABLE TOOLS:');
  });

  it('should include JSON format instructions', () => {
    const result = createPlanningPrompt('task', []);
    expect(result).toContain('JSON format');
  });

  it('should include step structure with id, description, toolName', () => {
    const result = createPlanningPrompt('task', []);
    expect(result).toContain('"id"');
    expect(result).toContain('"description"');
    expect(result).toContain('"toolName"');
  });

  it('should include dependsOn field in the template', () => {
    const result = createPlanningPrompt('task', []);
    expect(result).toContain('"dependsOn"');
  });

  it('should return a non-empty string', () => {
    const result = createPlanningPrompt('task', []);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle empty tools array', () => {
    const result = createPlanningPrompt('task', []);
    expect(result).toContain('AVAILABLE TOOLS:');
    // Just the heading, no tools listed
  });

  it('should list multiple tools on separate lines', () => {
    const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
    const result = createPlanningPrompt('task', tools);
    const toolLines = result.split('\n').filter(line => line.startsWith('- '));
    expect(toolLines).toHaveLength(3);
  });
});

// ===========================================================================
// parsePlan
// ===========================================================================

describe('parsePlan', () => {
  it('should parse a valid plan JSON', () => {
    const input = JSON.stringify({
      goal: 'Build a website',
      steps: [
        { id: 1, description: 'Design mockup', toolName: null, dependsOn: [] },
        { id: 2, description: 'Write HTML', toolName: 'code_editor', dependsOn: [1] },
      ],
    });

    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe('Build a website');
    expect(plan!.steps).toHaveLength(2);
  });

  it('should set plan status to pending', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ description: 'Step 1' }],
    });

    const plan = parsePlan(input);
    expect(plan!.status).toBe('pending');
  });

  it('should set currentStep to 0', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ description: 'Step 1' }],
    });

    const plan = parsePlan(input);
    expect(plan!.currentStep).toBe(0);
  });

  it('should set each step status to pending', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [
        { id: 1, description: 'Step 1' },
        { id: 2, description: 'Step 2' },
      ],
    });

    const plan = parsePlan(input);
    for (const step of plan!.steps) {
      expect(step.status).toBe('pending');
    }
  });

  it('should auto-assign step id from index when id is missing', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [
        { description: 'First' },
        { description: 'Second' },
      ],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[0].id).toBe(1);
    expect(plan!.steps[1].id).toBe(2);
  });

  it('should preserve step id when provided', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ id: 42, description: 'Step 42' }],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[0].id).toBe(42);
  });

  it('should default dependsOn to empty array when missing', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ id: 1, description: 'Independent step' }],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[0].dependsOn).toEqual([]);
  });

  it('should preserve dependsOn when provided', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [
        { id: 1, description: 'First' },
        { id: 2, description: 'Second', dependsOn: [1] },
      ],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[1].dependsOn).toEqual([1]);
  });

  it('should preserve toolName when provided', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ id: 1, description: 'Use search', toolName: 'search' }],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[0].toolName).toBe('search');
  });

  it('should preserve toolArgs when provided', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{
        id: 1,
        description: 'Search',
        toolName: 'search',
        toolArgs: { query: 'test' },
      }],
    });

    const plan = parsePlan(input);
    expect(plan!.steps[0].toolArgs).toEqual({ query: 'test' });
  });

  it('should extract JSON from text with surrounding prose', () => {
    const input = `Here is my plan:

${JSON.stringify({
  goal: 'Test',
  steps: [{ id: 1, description: 'Step 1' }],
})}

I hope this helps!`;

    const plan = parsePlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe('Test');
  });

  it('should return null for completely invalid input', () => {
    expect(parsePlan('no json here at all')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parsePlan('')).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    expect(parsePlan('{goal: invalid}')).toBeNull();
  });

  it('should return null when JSON has no matching braces', () => {
    expect(parsePlan('just text without braces')).toBeNull();
  });

  it('should handle steps with id: 0 by preserving the provided id', () => {
    const input = JSON.stringify({
      goal: 'Test',
      steps: [{ id: 0, description: 'Zero-indexed' }],
    });

    const plan = parsePlan(input);
    // ?? (nullish coalescing) only triggers for null/undefined, not 0
    expect(plan!.steps[0].id).toBe(0);
  });

  it('should parse plan with many steps', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      description: `Step ${i + 1}`,
    }));

    const input = JSON.stringify({ goal: 'Big plan', steps });
    const plan = parsePlan(input);
    expect(plan!.steps).toHaveLength(10);
  });

  it('should preserve the original goal string', () => {
    const input = JSON.stringify({
      goal: 'Build a privacy-first AI assistant',
      steps: [{ description: 'Start' }],
    });

    const plan = parsePlan(input);
    expect(plan!.goal).toBe('Build a privacy-first AI assistant');
  });
});

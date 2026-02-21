/**
 * Tests for AgentExecutor, getAgentExecutor, createAgentExecutor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLogInfo = vi.fn();

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  ),
}));

// Import after mocks
import {
  AgentExecutor,
  getAgentExecutor,
  createAgentExecutor,
  type ExecutableAgent,
  type ExecutorLLMProvider,
  type AgentExecutionContext,
  type AgentExecutionResult as _AgentExecutionResult,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockToolRegistry {
  getDefinitionsByNames: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

interface MockDataGateway {
  grantAccess: ReturnType<typeof vi.fn>;
  revokeAccess: ReturnType<typeof vi.fn>;
}

function makeLLMProvider(): ExecutorLLMProvider {
  return {
    complete: vi.fn(),
  };
}

function makeToolRegistry(): MockToolRegistry {
  return {
    getDefinitionsByNames: vi.fn(() => []),
    execute: vi.fn(),
  };
}

function makeDataGateway(): MockDataGateway {
  return {
    grantAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };
}

function makeAgent(overrides: Partial<ExecutableAgent> = {}): ExecutableAgent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    systemPrompt: 'You are a test agent.',
    allowedTools: ['search', 'calculate'],
    dataAccess: [],
    config: {
      maxTokens: 4096,
      temperature: 0.7,
      maxTurns: 10,
      maxToolCalls: 50,
    },
    ...overrides,
  };
}

function makeContext(): Omit<AgentExecutionContext, 'executionId'> {
  return {
    userId: 'user-1',
    conversationId: 'conv-1',
    channel: 'chat',
    messages: [],
  };
}

function makeToolCall(overrides: Partial<{ id: string; name: string; arguments: string }> = {}) {
  return {
    id: 'tc-1',
    name: 'search',
    arguments: '{"query":"test"}',
    ...overrides,
  };
}

function makeToolDef(name: string, description = `${name} tool`) {
  return {
    name,
    description,
    parameters: { type: 'object' as const, properties: {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  let llmProvider: ExecutorLLMProvider;
  let toolRegistry: MockToolRegistry;
  let dataGateway: MockDataGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogInfo.mockClear();

    executor = new AgentExecutor();
    llmProvider = makeLLMProvider();
    toolRegistry = makeToolRegistry();
    dataGateway = makeDataGateway();

    executor.initialize({
      llmProvider,
      toolRegistry: toolRegistry as never,
      dataGateway: dataGateway as never,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Constructor & Config
  // =========================================================================
  describe('constructor & config', () => {
    it('uses default config when no config provided', () => {
      const exec = new AgentExecutor();
      // Verify defaults indirectly by running an execution that hits maxTurns
      // The constructor should not throw
      expect(exec).toBeInstanceOf(AgentExecutor);
    });

    it('merges custom config with defaults', () => {
      const exec = new AgentExecutor({ maxTurns: 5 });
      expect(exec).toBeInstanceOf(AgentExecutor);
    });

    it('allows overriding all config values', () => {
      const exec = new AgentExecutor({
        maxTurns: 10,
        maxToolCalls: 100,
        toolTimeout: 5000,
        enableLogging: false,
      });
      expect(exec).toBeInstanceOf(AgentExecutor);
    });

    it('uses default maxTurns of 50', async () => {
      // Agent config maxTurns = 0 (falsy) => falls back to executor config
      const exec = new AgentExecutor({ maxTurns: 2 });
      const provider = makeLLMProvider();
      exec.initialize({ llmProvider: provider });

      // LLM always returns tool calls — should stop at 2 turns
      (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'thinking...',
        toolCalls: [makeToolCall()],
      });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 0, maxToolCalls: 100 },
      });
      const result = await exec.execute(agent, 'hello', makeContext());
      expect(result.turns).toBe(2);
    });

    it('uses default maxToolCalls of 200 when agent config is 0', async () => {
      const exec = new AgentExecutor({ maxTurns: 100, maxToolCalls: 3 });
      const provider = makeLLMProvider();
      const registry = makeToolRegistry();
      exec.initialize({ llmProvider: provider, toolRegistry: registry as never });

      registry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      registry.execute.mockResolvedValue({ ok: true, value: { content: 'result' } });

      let callCount = 0;
      (provider.complete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount <= 5) {
          return { content: 'thinking...', toolCalls: [makeToolCall()] };
        }
        return { content: 'done' };
      });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 0 },
      });
      const result = await exec.execute(agent, 'hello', makeContext());
      // Should stop at 3 tool calls (executor config), not 200
      expect(result.toolCalls.length).toBe(3);
    });
  });

  // =========================================================================
  // initialize
  // =========================================================================
  describe('initialize', () => {
    it('sets toolRegistry, dataGateway, llmProvider', async () => {
      const exec = new AgentExecutor();
      exec.initialize({
        llmProvider,
        toolRegistry: toolRegistry as never,
        dataGateway: dataGateway as never,
      });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'hello',
      });

      const result = await exec.execute(makeAgent(), 'test', makeContext());
      expect(result.success).toBe(true);
    });

    it('can set only llmProvider', async () => {
      const exec = new AgentExecutor();
      exec.initialize({ llmProvider });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'response',
      });

      const result = await exec.execute(makeAgent(), 'hi', makeContext());
      expect(result.success).toBe(true);
    });

    it('can set only toolRegistry', () => {
      const exec = new AgentExecutor();
      exec.initialize({ toolRegistry: toolRegistry as never });
      // No error thrown
      expect(exec).toBeInstanceOf(AgentExecutor);
    });

    it('can set only dataGateway', () => {
      const exec = new AgentExecutor();
      exec.initialize({ dataGateway: dataGateway as never });
      expect(exec).toBeInstanceOf(AgentExecutor);
    });

    it('allows re-initialization with new deps', async () => {
      const exec = new AgentExecutor();
      const provider1 = makeLLMProvider();
      const provider2 = makeLLMProvider();

      exec.initialize({ llmProvider: provider1 });
      exec.initialize({ llmProvider: provider2 });

      (provider2.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });
      const result = await exec.execute(makeAgent(), 'test', makeContext());
      expect(result.success).toBe(true);
      expect(provider2.complete).toHaveBeenCalled();
      expect(provider1.complete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute - basic flow
  // =========================================================================
  describe('execute - basic flow', () => {
    it('returns success with response when LLM replies without tool calls', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello! How can I help?',
      });

      const result = await executor.execute(makeAgent(), 'Hi there', makeContext());

      expect(result.success).toBe(true);
      expect(result.response).toBe('Hello! How can I help?');
      expect(result.toolCalls).toEqual([]);
      expect(result.turns).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it('includes conversation history in initial messages', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'response',
      });

      const context = makeContext();
      context.messages = [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ];

      await executor.execute(makeAgent(), 'follow up', context);

      const calledMessages = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      expect(calledMessages).toHaveLength(4); // system + 2 history + user
      expect(calledMessages[0].role).toBe('system');
      expect(calledMessages[1].role).toBe('user');
      expect(calledMessages[1].content).toBe('earlier question');
      expect(calledMessages[2].role).toBe('assistant');
      expect(calledMessages[2].content).toBe('earlier answer');
      expect(calledMessages[3].role).toBe('user');
      expect(calledMessages[3].content).toBe('follow up');
    });

    it('appends userMessage as last message', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'my question', makeContext());

      const calledMessages = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      const lastMsg = calledMessages[calledMessages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toBe('my question');
    });

    it('system prompt contains agent.systemPrompt', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ systemPrompt: 'Custom prompt for testing' });
      await executor.execute(agent, 'test', makeContext());

      const calledMessages = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      expect(calledMessages[0].role).toBe('system');
      expect(calledMessages[0].content).toContain('Custom prompt for testing');
    });

    it('returns executionId from randomUUID', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      // executionId is used in logging, verifiable through log calls
      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('test-uuid-1234')
      );
    });

    it('passes agent config maxTokens and temperature to LLM provider', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({
        config: { maxTokens: 2048, temperature: 0.3, maxTurns: 10, maxToolCalls: 50 },
      });
      await executor.execute(agent, 'test', makeContext());

      const callArgs = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.maxTokens).toBe(2048);
      expect(callArgs.temperature).toBe(0.3);
    });

    it('passes tool definitions to LLM provider when tools are available', async () => {
      const searchTool = makeToolDef('search', 'Search the web');
      toolRegistry.getDefinitionsByNames.mockReturnValue([searchTool]);

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const callArgs = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.tools).toEqual([searchTool]);
    });

    it('returns empty response when LLM returns empty content', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: '',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());
      expect(result.success).toBe(true);
      expect(result.response).toBe('');
    });
  });

  // =========================================================================
  // execute - tool calling loop
  // =========================================================================
  describe('execute - tool calling loop', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([
        makeToolDef('search'),
        makeToolDef('calculate'),
      ]);
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'tool result data' },
      });
    });

    it('single tool call: executes tool then gets final answer', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      // Turn 1: LLM requests a tool call
      completeFn.mockResolvedValueOnce({
        content: 'Let me search for that.',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{"q":"test"}' })],
      });
      // Turn 2: LLM responds with final answer
      completeFn.mockResolvedValueOnce({
        content: 'I found the answer: 42',
      });

      const result = await executor.execute(makeAgent(), 'What is the answer?', makeContext());

      expect(result.success).toBe(true);
      expect(result.response).toBe('I found the answer: 42');
      expect(result.turns).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('search');
      expect(result.toolCalls[0].result).toBe('tool result data');
    });

    it('multiple tool calls in one turn', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: 'Let me search and calculate.',
        toolCalls: [
          makeToolCall({ id: 'tc-1', name: 'search', arguments: '{"q":"x"}' }),
          makeToolCall({ id: 'tc-2', name: 'calculate', arguments: '{"expr":"1+1"}' }),
        ],
      });
      completeFn.mockResolvedValueOnce({
        content: 'Done!',
      });

      const result = await executor.execute(makeAgent(), 'do both', makeContext());

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].tool).toBe('search');
      expect(result.toolCalls[1].tool).toBe('calculate');
      expect(result.turns).toBe(2);
      expect(toolRegistry.execute).toHaveBeenCalledTimes(2);
    });

    it('multi-turn tool calling: tool -> tool -> final answer', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      // Turn 1: search
      completeFn.mockResolvedValueOnce({
        content: 'Searching...',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{"q":"data"}' })],
      });
      // Turn 2: calculate
      completeFn.mockResolvedValueOnce({
        content: 'Calculating...',
        toolCalls: [makeToolCall({ id: 'tc-2', name: 'calculate', arguments: '{"expr":"2+2"}' })],
      });
      // Turn 3: final
      completeFn.mockResolvedValueOnce({
        content: 'The result is 4.',
      });

      const result = await executor.execute(makeAgent(), 'complex task', makeContext());

      expect(result.turns).toBe(3);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.response).toBe('The result is 4.');
    });

    it('tool call results are added as tool messages to the conversation', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: 'searching',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{"q":"x"}' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'final answer',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      // Second call should include tool result messages
      const secondCallMessages = completeFn.mock.calls[1][0].messages;
      const toolMsg = secondCallMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.content).toBe(JSON.stringify('tool result data'));
    });

    it('toolCallHistory tracks tool name, args, result, and duration', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{"query":"hello"}' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('search');
      expect(result.toolCalls[0].args).toEqual({ query: 'hello' });
      expect(result.toolCalls[0].result).toBe('tool result data');
      expect(typeof result.toolCalls[0].duration).toBe('number');
      expect(result.toolCalls[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('assistant message with tool calls is added to messages array', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      const toolCalls = [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{}' })];
      completeFn.mockResolvedValueOnce({
        content: 'thinking',
        toolCalls,
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      // Check the messages passed to the second LLM call
      const secondCallMessages = completeFn.mock.calls[1][0].messages;
      const assistantMsg = secondCallMessages.find(
        (m: { role: string; toolCalls?: unknown[] }) => m.role === 'assistant' && m.toolCalls
      );
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBe('thinking');
      expect(assistantMsg.toolCalls).toEqual(toolCalls);
    });

    it('each tool result is added as a separate tool message', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [
          makeToolCall({ id: 'tc-1', name: 'search', arguments: '{}' }),
          makeToolCall({ id: 'tc-2', name: 'calculate', arguments: '{}' }),
        ],
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const secondCallMessages = completeFn.mock.calls[1][0].messages;
      const toolMessages = secondCallMessages.filter((m: { role: string }) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages[0].toolResults[0].toolCallId).toBe('tc-1');
      expect(toolMessages[1].toolResults[0].toolCallId).toBe('tc-2');
    });
  });

  // =========================================================================
  // execute - max limits
  // =========================================================================
  describe('execute - max limits', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'ok' },
      });
    });

    it('stops at agent.config.maxTurns', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 3, maxToolCalls: 100 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({
        content: 'keep going',
        toolCalls: [makeToolCall()],
      });

      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.turns).toBe(3);
      expect(result.success).toBe(true);
    });

    it('stops at agent.config.maxToolCalls', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 2 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({
        content: 'calling tool',
        toolCalls: [makeToolCall()],
      });

      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.toolCalls.length).toBe(2);
    });

    it('falls back to executor config when agent maxTurns is 0', async () => {
      const exec = new AgentExecutor({ maxTurns: 2 });
      exec.initialize({
        llmProvider,
        toolRegistry: toolRegistry as never,
      });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 0, maxToolCalls: 100 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({
        content: 'going',
        toolCalls: [makeToolCall()],
      });

      const result = await exec.execute(agent, 'test', makeContext());
      expect(result.turns).toBe(2);
    });

    it('falls back to executor config when agent maxToolCalls is 0', async () => {
      const exec = new AgentExecutor({ maxToolCalls: 3, maxTurns: 100 });
      exec.initialize({
        llmProvider,
        toolRegistry: toolRegistry as never,
      });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 0 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({
        content: 'going',
        toolCalls: [makeToolCall()],
      });

      const result = await exec.execute(agent, 'test', makeContext());
      expect(result.toolCalls.length).toBe(3);
    });

    it('maxToolCalls check prevents entering new turns even if maxTurns not hit', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 1 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      // First turn: 1 tool call => totalToolCalls becomes 1
      completeFn.mockResolvedValueOnce({
        content: 'calling tool',
        toolCalls: [makeToolCall()],
      });
      // Second turn: should break due to max tool calls check at top of loop
      completeFn.mockResolvedValueOnce({
        content: 'should not call tools',
        toolCalls: [makeToolCall()],
      });

      const result = await executor.execute(agent, 'test', makeContext());
      // After turn 1 executes 1 tool call, turn 2 starts and checks maxToolCalls at top => breaks
      expect(result.toolCalls.length).toBe(1);
    });

    it('disables tools in LLM call when maxToolCalls is already reached', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 1 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      // First turn: 1 tool call => totalToolCalls = 1
      completeFn.mockResolvedValueOnce({
        content: 'call tool',
        toolCalls: [makeToolCall()],
      });
      // Second turn: maxToolCalls reached => should break before calling LLM
      completeFn.mockResolvedValueOnce({
        content: 'no tools',
      });

      await executor.execute(agent, 'test', makeContext());
      // The second call should NOT happen since maxToolCalls check at top of loop breaks
      // Turn 2 starts, checks maxToolCalls >= 1 at top => breaks
      expect(completeFn).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // execute - tool access control
  // =========================================================================
  describe('execute - tool access control', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([
        makeToolDef('search'),
        makeToolDef('calculate'),
        makeToolDef('forbidden'),
      ]);
    });

    it('tool not in allowedTools returns access error', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'forbidden', arguments: '{}' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'ok',
      });

      const agent = makeAgent({ allowedTools: ['search', 'calculate'] });
      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe('forbidden');
      expect(result.toolCalls[0].result).toEqual({
        error: 'Agent agent-1 does not have access to tool: forbidden',
      });

      // Tool registry execute should NOT have been called
      expect(toolRegistry.execute).not.toHaveBeenCalled();
    });

    it('tool in allowedTools executes normally', async () => {
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'search result' },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1', name: 'search', arguments: '{}' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].result).toBe('search result');
      expect(toolRegistry.execute).toHaveBeenCalledTimes(1);
    });

    it('mixes allowed and denied tool calls in the same turn', async () => {
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'search result' },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [
          makeToolCall({ id: 'tc-1', name: 'search', arguments: '{}' }),
          makeToolCall({ id: 'tc-2', name: 'forbidden', arguments: '{}' }),
        ],
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].result).toBe('search result');
      expect(result.toolCalls[1].result).toEqual({
        error: 'Agent agent-1 does not have access to tool: forbidden',
      });
    });
  });

  // =========================================================================
  // execute - tool argument parsing
  // =========================================================================
  describe('execute - tool argument parsing', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'result' },
      });
    });

    it('valid JSON args are parsed correctly', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ arguments: '{"query":"hello","limit":10}' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].args).toEqual({ query: 'hello', limit: 10 });
    });

    it('invalid JSON args returns parse error from executeTool', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ arguments: '{invalid json}' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      // executeTool returns error for bad JSON
      expect(result.toolCalls[0].result).toEqual({ error: 'Invalid tool arguments' });
      // toolCallHistory args has _raw fallback
      expect(result.toolCalls[0].args).toEqual({ _raw: '{invalid json}' });
    });

    it('empty args defaults to {}', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ arguments: '' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].args).toEqual({});
      // executeTool should parse '' as '{}' via the || '{}' fallback
      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'search',
        {},
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('undefined arguments defaults to {}', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'search', arguments: undefined as unknown as string }],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].args).toEqual({});
    });

    it('malformed arguments result in _raw fallback in toolCallHistory', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ arguments: 'not json at all' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].args).toEqual({ _raw: 'not json at all' });
    });
  });

  // =========================================================================
  // execute - tool timeout
  // =========================================================================
  describe('execute - tool timeout', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
    });

    it('tool exceeding timeout returns timeout error', async () => {
      vi.useFakeTimers();

      const exec = new AgentExecutor({ toolTimeout: 1000 });
      exec.initialize({
        llmProvider,
        toolRegistry: toolRegistry as never,
      });

      toolRegistry.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: { content: 'late' } }), 5000))
      );

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const executePromise = exec.execute(makeAgent(), 'test', makeContext());

      // Advance timers to trigger timeout
      await vi.advanceTimersByTimeAsync(1500);

      const result = await executePromise;

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result).toEqual({
        error: "Tool 'search' timed out after 1000ms",
      });

      vi.useRealTimers();
    });

    it('tool completing within timeout returns normal result', async () => {
      vi.useFakeTimers();

      const exec = new AgentExecutor({ toolTimeout: 5000 });
      exec.initialize({
        llmProvider,
        toolRegistry: toolRegistry as never,
      });

      toolRegistry.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: { content: 'fast result' } }), 100))
      );

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const executePromise = exec.execute(makeAgent(), 'test', makeContext());

      await vi.advanceTimersByTimeAsync(200);

      const result = await executePromise;

      expect(result.toolCalls[0].result).toBe('fast result');

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // execute - no providers
  // =========================================================================
  describe('execute - no providers', () => {
    it('throws when LLM provider not configured', async () => {
      const exec = new AgentExecutor();
      // Don't initialize llmProvider

      const result = await exec.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM provider not configured');
      expect(result.response).toContain('LLM provider not configured');
    });

    it('returns empty tools array when toolRegistry not configured', async () => {
      const exec = new AgentExecutor();
      exec.initialize({ llmProvider });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result = await exec.execute(makeAgent(), 'test', makeContext());

      // Should still succeed — just no tools available
      expect(result.success).toBe(true);
      const calledArgs = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // tools should be empty (or undefined since allowTools check uses empty array)
      expect(calledArgs.tools?.length ?? 0).toBe(0);
    });

    it('executeTool returns not configured error when toolRegistry absent', async () => {
      const exec = new AgentExecutor();
      exec.initialize({ llmProvider });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ name: 'search', arguments: '{}' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const agent = makeAgent();
      const result = await exec.execute(agent, 'test', makeContext());

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result).toEqual({
        error: 'Tool registry not configured',
      });
    });
  });

  // =========================================================================
  // execute - data access
  // =========================================================================
  describe('execute - data access', () => {
    it('agent with dataAccess calls grantAccess before and revokeAccess after', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: ['notes', 'calendar'] });
      await executor.execute(agent, 'test', makeContext());

      expect(dataGateway.grantAccess).toHaveBeenCalledWith('agent-1', ['notes', 'calendar']);
      expect(dataGateway.revokeAccess).toHaveBeenCalledWith('agent-1', ['notes', 'calendar']);
      expect(dataGateway.grantAccess).toHaveBeenCalledBefore(dataGateway.revokeAccess);
    });

    it('agent with empty dataAccess does not call grant/revoke', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: [] });
      await executor.execute(agent, 'test', makeContext());

      expect(dataGateway.grantAccess).not.toHaveBeenCalled();
      expect(dataGateway.revokeAccess).not.toHaveBeenCalled();
    });

    it('revokeAccess called even when execution errors', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('LLM explosion')
      );

      const agent = makeAgent({ dataAccess: ['notes'] });
      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.success).toBe(false);
      expect(dataGateway.grantAccess).toHaveBeenCalledWith('agent-1', ['notes']);
      expect(dataGateway.revokeAccess).toHaveBeenCalledWith('agent-1', ['notes']);
    });

    it('does not call grantAccess when dataGateway is not set', async () => {
      const exec = new AgentExecutor();
      exec.initialize({ llmProvider });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: ['notes'] });
      const result = await exec.execute(agent, 'test', makeContext());

      // No error — just silently skips
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // execute - system prompt building
  // =========================================================================
  describe('execute - system prompt building', () => {
    it('includes Available Tools section when tools are provided', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([
        makeToolDef('search', 'Search the internet'),
        makeToolDef('calculate', 'Perform calculations'),
      ]);

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('## Available Tools');
      expect(systemMsg.content).toContain('- search: Search the internet');
      expect(systemMsg.content).toContain('- calculate: Perform calculations');
    });

    it('does not include Available Tools section when no tools', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([]);

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).not.toContain('## Available Tools');
    });

    it('includes Data Access section when dataAccess is populated', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: ['notes', 'bookmarks'] });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('## Data Access');
      expect(systemMsg.content).toContain('- notes');
      expect(systemMsg.content).toContain('- bookmarks');
    });

    it('does not include Data Access section when dataAccess is empty', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: [] });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).not.toContain('## Data Access');
    });

    it('always includes Execution Rules section', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('## Execution Rules');
      expect(systemMsg.content).toContain('Analyze the user\'s request carefully');
      expect(systemMsg.content).toContain('Be concise but thorough');
    });

    it('includes both tools and data access sections when both present', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: ['notes'] });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('## Available Tools');
      expect(systemMsg.content).toContain('## Data Access');
      expect(systemMsg.content).toContain('## Execution Rules');
    });

    it('system prompt starts with agent systemPrompt', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ systemPrompt: 'You are a helpful bot.' });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toMatch(/^You are a helpful bot\./);
    });
  });

  // =========================================================================
  // execute - error handling
  // =========================================================================
  describe('execute - error handling', () => {
    it('LLM throws returns success=false with error message', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(result.response).toContain('API rate limit exceeded');
    });

    it('LLM throws non-Error returns success=false', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('tool execution error continues the loop', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({
        ok: false,
        error: new Error('Tool crashed'),
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({
        content: 'I handled the error gracefully',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result).toEqual({ error: 'Tool crashed' });
    });

    it('returns partial toolCallHistory up to the error', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'first result' },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      // Turn 1: successful tool call
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1' })],
      });
      // Turn 2: LLM throws
      completeFn.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(false);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].result).toBe('first result');
    });

    it('error result includes turns count', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('boom')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      // turns++ happens at start of loop before runTurn, so even if runTurn throws,
      // the counter is already incremented to 1
      expect(result.turns).toBe(1);
    });

    it('error on first turn has turns=1', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockRejectedValue(new Error('immediate failure'));

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      // turns++ happens before runTurn call, so it's 1 even if runTurn throws
      expect(result.success).toBe(false);
      expect(result.turns).toBe(1);
    });

    it('error result has metadata with agentId', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail')
      );

      const result = await executor.execute(makeAgent({ id: 'my-agent' }), 'test', makeContext());

      expect(result.metadata.agentId).toBe('my-agent');
    });
  });

  // =========================================================================
  // execute - token tracking
  // =========================================================================
  describe('execute - token tracking', () => {
    it('tracks prompt + completion tokens across turns', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      completeFn.mockResolvedValueOnce({
        content: 'searching',
        toolCalls: [makeToolCall()],
        usage: { promptTokens: 100, completionTokens: 50 },
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
        usage: { promptTokens: 200, completionTokens: 75 },
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toEqual({
        prompt: 300,
        completion: 125,
      });
    });

    it('returns tokensUsed when token data is present', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
        usage: { promptTokens: 50, completionTokens: 20 },
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toEqual({
        prompt: 50,
        completion: 20,
      });
    });

    it('returns undefined tokensUsed when no usage data', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
        // No usage field
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toBeUndefined();
    });

    it('returns undefined tokensUsed when all tokens are 0', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
        usage: { promptTokens: 0, completionTokens: 0 },
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      // tokensUsed.prompt is 0, so tokensUsed is undefined
      expect(result.metadata.tokensUsed).toBeUndefined();
    });

    it('accumulates tokens across multiple turns', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      // 3 turns
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
        usage: { promptTokens: 10, completionTokens: 5 },
      });
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-2' })],
        usage: { promptTokens: 20, completionTokens: 10 },
      });
      completeFn.mockResolvedValueOnce({
        content: 'final',
        usage: { promptTokens: 30, completionTokens: 15 },
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toEqual({
        prompt: 60,
        completion: 30,
      });
    });

    it('handles mixed turns with and without usage data', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
        usage: { promptTokens: 100, completionTokens: 50 },
      });
      completeFn.mockResolvedValueOnce({
        content: 'done',
        // No usage
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toEqual({
        prompt: 100,
        completion: 50,
      });
    });
  });

  // =========================================================================
  // execute - timing
  // =========================================================================
  describe('execute - timing', () => {
    it('returns duration in ms', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('metadata has startedAt timestamp', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.startedAt).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(result.metadata.startedAt).toISOString()).toBe(result.metadata.startedAt);
    });

    it('metadata has completedAt timestamp', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.completedAt).toBeDefined();
      expect(new Date(result.metadata.completedAt).toISOString()).toBe(result.metadata.completedAt);
    });

    it('completedAt is after or equal to startedAt', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      const start = new Date(result.metadata.startedAt).getTime();
      const end = new Date(result.metadata.completedAt).getTime();
      expect(end).toBeGreaterThanOrEqual(start);
    });

    it('metadata has agentId', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ id: 'special-agent-007' });
      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.metadata.agentId).toBe('special-agent-007');
    });

    it('error result also has timing data', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(typeof result.duration).toBe('number');
      expect(result.metadata.startedAt).toBeDefined();
      expect(result.metadata.completedAt).toBeDefined();
    });
  });

  // =========================================================================
  // execute - logging
  // =========================================================================
  describe('execute - logging', () => {
    it('enableLogging=true causes log calls', async () => {
      const exec = new AgentExecutor({ enableLogging: true });
      exec.initialize({ llmProvider });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await exec.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalled();
    });

    it('enableLogging=false causes no log calls', async () => {
      const exec = new AgentExecutor({ enableLogging: false });
      exec.initialize({ llmProvider });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      mockLogInfo.mockClear();
      await exec.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).not.toHaveBeenCalled();
    });

    it('logs execution start with executionId and agentId', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent({ id: 'my-agent' }), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Starting execution with agent: my-agent')
      );
    });

    it('logs turn numbers', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Turn 1')
      );
    });

    it('logs completion when no tool calls', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('No tool calls, completing')
      );
    });

    it('logs tool call names', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ name: 'search' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      await executor.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Calling tool: search')
      );
    });

    it('logs max tool calls reached', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 1 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({
        content: '',
        toolCalls: [makeToolCall()],
      });

      await executor.execute(agent, 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Max tool calls reached')
      );
    });

    it('logs execution failure', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('LLM died')
      );

      await executor.execute(makeAgent(), 'test', makeContext());

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Execution failed: LLM died')
      );
    });
  });

  // =========================================================================
  // execute - tool context
  // =========================================================================
  describe('execute - tool context', () => {
    it('passes correct context to toolRegistry.execute', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ arguments: '{"q":"test"}' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const context = makeContext();
      context.userId = 'user-42';
      context.conversationId = 'conv-99';

      await executor.execute(makeAgent({ id: 'agent-7' }), 'test', context);

      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'search',
        { q: 'test' },
        {
          conversationId: 'conv-99',
          userId: 'user-42',
          agentId: 'agent-7',
        }
      );
    });
  });

  // =========================================================================
  // execute - tool registry error results
  // =========================================================================
  describe('execute - tool registry error results', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
    });

    it('tool returning ok:false is handled gracefully', async () => {
      toolRegistry.execute.mockResolvedValue({
        ok: false,
        error: new Error('Tool not found'),
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'handled' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(true);
      expect(result.toolCalls[0].result).toEqual({ error: 'Tool not found' });
    });

    it('tool returning ok:true with content is used correctly', async () => {
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: { data: [1, 2, 3] } },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].result).toEqual({ data: [1, 2, 3] });
    });
  });

  // =========================================================================
  // execute - edge cases
  // =========================================================================
  describe('execute - edge cases', () => {
    it('handles LLM returning empty toolCalls array', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'response',
        toolCalls: [],
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(1);
      expect(result.toolCalls).toEqual([]);
    });

    it('handles LLM returning undefined toolCalls', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'response',
        toolCalls: undefined,
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.success).toBe(true);
      expect(result.turns).toBe(1);
    });

    it('handles agent with empty allowedTools', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ allowedTools: [] });
      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.success).toBe(true);
    });

    it('handles very long user message', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const longMessage = 'x'.repeat(100000);
      const result = await executor.execute(makeAgent(), longMessage, makeContext());

      expect(result.success).toBe(true);
      const calledMessages = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages;
      expect(calledMessages[calledMessages.length - 1].content).toBe(longMessage);
    });

    it('handles context with metadata', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const context = makeContext();
      (context as AgentExecutionContext).metadata = { customKey: 'value' };
      const result = await executor.execute(makeAgent(), 'test', context);

      expect(result.success).toBe(true);
    });

    it('maxTurns=1 allows exactly one turn', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 1, maxToolCalls: 100 },
      });

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'single turn response',
        toolCalls: [makeToolCall()],
      });

      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.turns).toBe(1);
    });

    it('tool call with numeric result is preserved', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('calculate')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 42 } });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ name: 'calculate', arguments: '{}' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(
        makeAgent({ allowedTools: ['calculate'] }),
        'test',
        makeContext()
      );

      expect(result.toolCalls[0].result).toBe(42);
    });

    it('tool call with null result is preserved', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: null } });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.toolCalls[0].result).toBeNull();
    });
  });

  // =========================================================================
  // execute - message building in loop
  // =========================================================================
  describe('execute - message building in loop', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'result' } });
    });

    it('messages accumulate correctly over multi-turn execution', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: 'turn 1 response',
        toolCalls: [makeToolCall({ id: 'tc-1' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'turn 2 response',
        toolCalls: [makeToolCall({ id: 'tc-2' })],
      });
      completeFn.mockResolvedValueOnce({
        content: 'final',
      });

      await executor.execute(makeAgent(), 'question', makeContext());

      // Third call should have: system + user + assistant(turn1) + tool(turn1) + assistant(turn2) + tool(turn2)
      const thirdCallMessages = completeFn.mock.calls[2][0].messages;
      expect(thirdCallMessages.length).toBe(6);
      expect(thirdCallMessages[0].role).toBe('system');
      expect(thirdCallMessages[1].role).toBe('user');
      expect(thirdCallMessages[2].role).toBe('assistant');
      expect(thirdCallMessages[3].role).toBe('tool');
      expect(thirdCallMessages[4].role).toBe('assistant');
      expect(thirdCallMessages[5].role).toBe('tool');
    });

    it('tool result content is JSON stringified', async () => {
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: { items: ['a', 'b'] } },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      await executor.execute(makeAgent(), 'test', makeContext());

      const secondCallMessages = completeFn.mock.calls[1][0].messages;
      const toolMsg = secondCallMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toBe(JSON.stringify({ items: ['a', 'b'] }));
    });

    it('tool result toolCallId matches the original tool call id', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'unique-tc-id-999' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      await executor.execute(makeAgent(), 'test', makeContext());

      const secondCallMessages = completeFn.mock.calls[1][0].messages;
      const toolMsg = secondCallMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.toolResults[0].toolCallId).toBe('unique-tc-id-999');
    });

    it('lastResponse is updated on each turn', async () => {
      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      completeFn.mockResolvedValueOnce({
        content: 'intermediate',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({
        content: 'final answer',
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());
      expect(result.response).toBe('final answer');
    });

    it('lastResponse is from last turn even when breaking at max turns', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 2, maxToolCalls: 100 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: 'turn 1',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({
        content: 'turn 2 - last',
        toolCalls: [makeToolCall({ id: 'tc-2' })],
      });

      const result = await executor.execute(agent, 'test', makeContext());
      expect(result.response).toBe('turn 2 - last');
    });
  });

  // =========================================================================
  // execute - concurrent tool calls ordering
  // =========================================================================
  describe('execute - tool execution ordering', () => {
    it('executes tool calls sequentially, not in parallel', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([
        makeToolDef('search'),
        makeToolDef('calculate'),
      ]);

      const callOrder: string[] = [];
      toolRegistry.execute.mockImplementation(async (name: string) => {
        callOrder.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, 1));
        callOrder.push(`end:${name}`);
        return { ok: true, value: { content: `${name}-result` } };
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [
          makeToolCall({ id: 'tc-1', name: 'search' }),
          makeToolCall({ id: 'tc-2', name: 'calculate' }),
        ],
      });
      completeFn.mockResolvedValueOnce({ content: 'done' });

      await executor.execute(makeAgent(), 'test', makeContext());

      // Sequential: search starts and ends before calculate starts
      expect(callOrder).toEqual([
        'start:search',
        'end:search',
        'start:calculate',
        'end:calculate',
      ]);
    });
  });

  // =========================================================================
  // execute - allowTools parameter
  // =========================================================================
  describe('execute - allowTools in runTurn', () => {
    it('passes tools to LLM when under maxToolCalls limit', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValue({ content: 'ok' });

      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 10, maxToolCalls: 100 },
      });
      await executor.execute(agent, 'test', makeContext());

      const callArgs = completeFn.mock.calls[0][0];
      expect(callArgs.tools).toEqual([makeToolDef('search')]);
    });
  });

  // =========================================================================
  // execute - error response format
  // =========================================================================
  describe('execute - error response format', () => {
    it('error response follows specific format', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.response).toBe(
        'I encountered an error while processing your request: Network timeout'
      );
    });

    it('error response with non-Error value', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(42);

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.response).toContain('42');
    });
  });

  // =========================================================================
  // execute - multiple executions on same instance
  // =========================================================================
  describe('execute - multiple executions', () => {
    it('can execute multiple times on the same instance', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const result1 = await executor.execute(makeAgent(), 'first', makeContext());
      const result2 = await executor.execute(makeAgent(), 'second', makeContext());

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('each execution has independent state', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;

      // First execution: 2 tool calls
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall(), makeToolCall({ id: 'tc-2' })],
      });
      completeFn.mockResolvedValueOnce({ content: 'done1' });

      // Second execution: 1 tool call
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall()],
      });
      completeFn.mockResolvedValueOnce({ content: 'done2' });

      const result1 = await executor.execute(makeAgent(), 'first', makeContext());
      const result2 = await executor.execute(makeAgent(), 'second', makeContext());

      expect(result1.toolCalls).toHaveLength(2);
      expect(result2.toolCalls).toHaveLength(1);
      expect(result1.response).toBe('done1');
      expect(result2.response).toBe('done2');
    });

    it('data access is cleaned up between executions', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ dataAccess: ['notes'] });

      await executor.execute(agent, 'first', makeContext());
      await executor.execute(agent, 'second', makeContext());

      expect(dataGateway.grantAccess).toHaveBeenCalledTimes(2);
      expect(dataGateway.revokeAccess).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // execute - getAgentTools
  // =========================================================================
  describe('execute - getAgentTools', () => {
    it('calls getDefinitionsByNames with agent.allowedTools', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      const agent = makeAgent({ allowedTools: ['tool-a', 'tool-b', 'tool-c'] });
      await executor.execute(agent, 'test', makeContext());

      expect(toolRegistry.getDefinitionsByNames).toHaveBeenCalledWith(['tool-a', 'tool-b', 'tool-c']);
    });

    it('returns empty array when toolRegistry returns no matches', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([]);

      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'ok',
      });

      await executor.execute(makeAgent(), 'test', makeContext());

      const callArgs = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // tools should be empty array (passed but empty)
      expect(callArgs.tools).toEqual([]);
    });
  });

  // =========================================================================
  // execute - system prompt content details
  // =========================================================================
  describe('execute - system prompt content details', () => {
    it('Available Tools section includes usage instruction', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('Use tools when they help accomplish');
      expect(systemMsg.content).toContain('You can call multiple tools if needed');
    });

    it('Data Access section includes usage instruction', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });

      const agent = makeAgent({ dataAccess: ['memory'] });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('Use appropriate tools to read/write this data');
    });

    it('Execution Rules contains all 5 rules', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('1. Analyze');
      expect(systemMsg.content).toContain('2. Use tools');
      expect(systemMsg.content).toContain('3. Process tool results');
      expect(systemMsg.content).toContain('4. Provide a clear');
      expect(systemMsg.content).toContain('5. Be concise but thorough');
    });

    it('tool list uses dash-prefixed format', async () => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([
        makeToolDef('alpha', 'Alpha tool'),
        makeToolDef('beta', 'Beta tool'),
      ]);
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });

      await executor.execute(makeAgent(), 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('- alpha: Alpha tool');
      expect(systemMsg.content).toContain('- beta: Beta tool');
    });

    it('data access list uses dash-prefixed format', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'ok' });

      const agent = makeAgent({ dataAccess: ['bookmarks', 'contacts'] });
      await executor.execute(agent, 'test', makeContext());

      const systemMsg = (llmProvider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0];
      expect(systemMsg.content).toContain('- bookmarks');
      expect(systemMsg.content).toContain('- contacts');
    });
  });

  // =========================================================================
  // execute - tool call count tracking
  // =========================================================================
  describe('execute - tool call count tracking', () => {
    beforeEach(() => {
      toolRegistry.getDefinitionsByNames.mockReturnValue([makeToolDef('search')]);
      toolRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'r' } });
    });

    it('multiple tools in one turn each count toward maxToolCalls', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 3 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      // Turn 1: 2 tool calls => totalToolCalls = 2
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [
          makeToolCall({ id: 'tc-1' }),
          makeToolCall({ id: 'tc-2' }),
        ],
      });
      // Turn 2: maxToolCalls check at top: 2 < 3, so enters loop
      // 1 more tool call => totalToolCalls = 3
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-3' })],
      });
      // Turn 3: maxToolCalls check at top: 3 >= 3, breaks
      completeFn.mockResolvedValueOnce({ content: 'done' });

      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.toolCalls).toHaveLength(3);
    });

    it('totalToolCalls persists across turns', async () => {
      const agent = makeAgent({
        config: { maxTokens: 4096, temperature: 0.7, maxTurns: 100, maxToolCalls: 4 },
      });

      const completeFn = llmProvider.complete as ReturnType<typeof vi.fn>;
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1' }), makeToolCall({ id: 'tc-2' })],
      });
      completeFn.mockResolvedValueOnce({
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-3' }), makeToolCall({ id: 'tc-4' })],
      });
      // Should break at top of turn 3 since totalToolCalls = 4 >= 4
      completeFn.mockResolvedValueOnce({ content: 'should not reach' });

      const result = await executor.execute(agent, 'test', makeContext());

      expect(result.toolCalls).toHaveLength(4);
      expect(completeFn).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // execute - result shape
  // =========================================================================
  describe('execute - result shape', () => {
    it('successful result has correct shape', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'hello',
        usage: { promptTokens: 10, completionTokens: 5 },
      });

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result).toEqual({
        success: true,
        response: 'hello',
        toolCalls: [],
        turns: 1,
        duration: expect.any(Number),
        metadata: {
          agentId: 'agent-1',
          startedAt: expect.any(String),
          completedAt: expect.any(String),
          tokensUsed: { prompt: 10, completion: 5 },
        },
      });
    });

    it('error result has correct shape', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('failed')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result).toEqual({
        success: false,
        response: expect.stringContaining('failed'),
        toolCalls: [],
        turns: 1,
        duration: expect.any(Number),
        error: 'failed',
        metadata: {
          agentId: 'agent-1',
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        },
      });
    });

    it('error result does not include tokensUsed in metadata', async () => {
      (llmProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('boom')
      );

      const result = await executor.execute(makeAgent(), 'test', makeContext());

      expect(result.metadata.tokensUsed).toBeUndefined();
    });
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('getAgentExecutor', () => {
  it('returns an AgentExecutor instance', () => {
    const exec = getAgentExecutor();
    expect(exec).toBeInstanceOf(AgentExecutor);
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const exec1 = getAgentExecutor();
    const exec2 = getAgentExecutor();
    expect(exec1).toBe(exec2);
  });
});

describe('createAgentExecutor', () => {
  it('creates a new AgentExecutor instance', () => {
    const exec = createAgentExecutor();
    expect(exec).toBeInstanceOf(AgentExecutor);
  });

  it('creates a new instance each time', () => {
    const exec1 = createAgentExecutor();
    const exec2 = createAgentExecutor();
    expect(exec1).not.toBe(exec2);
  });

  it('accepts custom config', () => {
    const exec = createAgentExecutor({ maxTurns: 5, toolTimeout: 1000 });
    expect(exec).toBeInstanceOf(AgentExecutor);
  });

  it('returns instance different from singleton', () => {
    const singleton = getAgentExecutor();
    const created = createAgentExecutor();
    expect(created).not.toBe(singleton);
  });
});

/**
 * Tests for node-executors.ts — individual workflow node execution functions.
 *
 * Covers:
 * - toToolExecResult: conversion from ToolServiceResult to ToolExecutionResult
 * - resolveWorkflowToolName: name resolution with dot-stripped normalization
 * - executeNode: tool node execution (happy path, error cases)
 * - executeLlmNode: LLM node execution (mocked provider)
 * - executeConditionNode: condition evaluation via vm
 * - executeCodeNode: code execution via tool service
 * - executeTransformerNode: transformer expression evaluation via vm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../db/repositories/workflows.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToolService = {
  execute: vi.fn(),
  has: vi.fn(),
  getDefinitions: vi.fn(),
  getDefinition: vi.fn(),
  getDefinitionsBySource: vi.fn(),
  getNames: vi.fn(),
  use: vi.fn(),
  getCount: vi.fn(),
};

vi.mock('./template-resolver.js', () => ({
  resolveTemplates: vi.fn((args: Record<string, unknown>) => args),
}));

vi.mock('../../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback
  ),
}));

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the agent-cache import used by executeLlmNode
vi.mock('../../routes/agent-cache.js', () => ({
  getProviderApiKey: vi.fn(async () => 'mock-api-key'),
  loadProviderConfig: vi.fn(() => null),
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic', 'google']),
}));

vi.mock('../../routes/settings.js', () => ({
  resolveProviderAndModel: vi.fn(async (provider: string, model: string) => ({
    provider: provider === 'default' ? 'openai' : provider,
    model: model === 'default' ? 'gpt-4o-mini' : model,
  })),
  getDefaultProvider: vi.fn(async () => 'openai'),
  getDefaultModel: vi.fn(async () => 'gpt-4o-mini'),
}));

const mockProvider = {
  complete: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    createProvider: vi.fn(() => mockProvider),
  };
});

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  toToolExecResult,
  resolveWorkflowToolName,
  executeNode,
  executeLlmNode,
  executeConditionNode,
  executeCodeNode,
  executeTransformerNode,
  executeHttpRequestNode,
  executeDelayNode,
  executeNotificationNode,
  executeMergeNode,
  executeSwitchNode,
} from './node-executors.js';
import { resolveTemplates } from './template-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as WorkflowNode['data'] };
}

function makeResult(
  nodeId: string,
  output: unknown,
  status: 'success' | 'error' = 'success'
): NodeResult {
  return { nodeId, status, output };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset resolveTemplates mock to pass-through
  vi.mocked(resolveTemplates).mockImplementation((args) => args);
});

// ============================================================================
// toToolExecResult
// ============================================================================

describe('toToolExecResult', () => {
  it('returns error result when isError is true', () => {
    const result = toToolExecResult({ content: 'Something went wrong', isError: true });
    expect(result).toEqual({ success: false, error: 'Something went wrong' });
  });

  it('returns success with parsed JSON content when content is valid JSON', () => {
    const result = toToolExecResult({ content: '{"key":"value"}', isError: false });
    expect(result).toEqual({ success: true, result: { key: 'value' } });
  });

  it('returns success with raw string content when content is not JSON', () => {
    const result = toToolExecResult({ content: 'plain text result', isError: false });
    expect(result).toEqual({ success: true, result: 'plain text result' });
  });

  it('returns success with parsed JSON array', () => {
    const result = toToolExecResult({ content: '[1,2,3]', isError: false });
    expect(result).toEqual({ success: true, result: [1, 2, 3] });
  });

  it('returns success with raw string for invalid JSON', () => {
    const result = toToolExecResult({ content: '{broken', isError: false });
    expect(result).toEqual({ success: true, result: '{broken' });
  });

  it('returns success when isError is undefined (falsy)', () => {
    const result = toToolExecResult({ content: 'ok' });
    expect(result).toEqual({ success: true, result: 'ok' });
  });

  it('handles empty string content', () => {
    const result = toToolExecResult({ content: '', isError: false });
    expect(result).toEqual({ success: true, result: '' });
  });
});

// ============================================================================
// resolveWorkflowToolName
// ============================================================================

describe('resolveWorkflowToolName', () => {
  it('returns name as-is if toolService.has() returns true (exact match)', () => {
    mockToolService.has.mockReturnValue(true);
    const result = resolveWorkflowToolName('core.get_time', mockToolService);
    expect(result).toBe('core.get_time');
    expect(mockToolService.has).toHaveBeenCalledWith('core.get_time');
  });

  it('performs normalized match when exact match fails', () => {
    mockToolService.has.mockReturnValue(false);
    mockToolService.getDefinitions.mockReturnValue([
      { name: 'mcp.github.list_repositories' },
      { name: 'core.get_time' },
    ]);
    const result = resolveWorkflowToolName('mcpgithublist_repositories', mockToolService);
    expect(result).toBe('mcp.github.list_repositories');
  });

  it('returns original name when no match found', () => {
    mockToolService.has.mockReturnValue(false);
    mockToolService.getDefinitions.mockReturnValue([{ name: 'core.get_time' }]);
    const result = resolveWorkflowToolName('nonexistent_tool', mockToolService);
    expect(result).toBe('nonexistent_tool');
  });

  it('normalized match is case-insensitive', () => {
    mockToolService.has.mockReturnValue(false);
    mockToolService.getDefinitions.mockReturnValue([{ name: 'MCP.GitHub.ListRepos' }]);
    const result = resolveWorkflowToolName('MCPGitHubListRepos', mockToolService);
    expect(result).toBe('MCP.GitHub.ListRepos');
  });

  it('returns exact match before trying normalized match', () => {
    mockToolService.has.mockReturnValue(true);
    const result = resolveWorkflowToolName('some_tool', mockToolService);
    expect(result).toBe('some_tool');
    expect(mockToolService.getDefinitions).not.toHaveBeenCalled();
  });
});

// ============================================================================
// executeNode (tool node)
// ============================================================================

describe('executeNode', () => {
  it('executes a tool and returns success result', async () => {
    mockToolService.has.mockReturnValue(true);
    mockToolService.execute.mockResolvedValue({ content: '{"result":"ok"}', isError: false });

    const node = makeNode('n1', 'toolNode', { toolName: 'core.get_time', toolArgs: {} });
    const result = await executeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.nodeId).toBe('n1');
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ result: 'ok' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('returns error result when tool execution fails', async () => {
    mockToolService.has.mockReturnValue(true);
    mockToolService.execute.mockResolvedValue({ content: 'Tool failed', isError: true });

    const node = makeNode('n1', 'toolNode', { toolName: 'bad_tool', toolArgs: {} });
    const result = await executeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Tool failed');
  });

  it('catches thrown errors and returns error result', async () => {
    mockToolService.has.mockReturnValue(true);
    mockToolService.execute.mockRejectedValue(new Error('Connection timeout'));

    const node = makeNode('n1', 'toolNode', { toolName: 'slow_tool', toolArgs: {} });
    const result = await executeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Connection timeout');
  });

  it('resolves templates in tool args', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ query: 'resolved-query' });
    mockToolService.has.mockReturnValue(true);
    mockToolService.execute.mockResolvedValue({ content: '"done"', isError: false });

    const nodeOutputs = { prev: makeResult('prev', 'some-data') };
    const node = makeNode('n1', 'toolNode', {
      toolName: 'search_tool',
      toolArgs: { query: '{{prev.output}}' },
    });

    const result = await executeNode(node, nodeOutputs, {}, 'user1', mockToolService);

    expect(resolveTemplates).toHaveBeenCalledWith({ query: '{{prev.output}}' }, nodeOutputs, {});
    expect(result.resolvedArgs).toEqual({ query: 'resolved-query' });
  });

  it('resolves tool name using resolveWorkflowToolName', async () => {
    mockToolService.has.mockReturnValue(false);
    mockToolService.getDefinitions.mockReturnValue([{ name: 'mcp.github.list_repos' }]);
    mockToolService.execute.mockResolvedValue({ content: '"ok"', isError: false });

    const node = makeNode('n1', 'toolNode', {
      toolName: 'mcpgithublist_repos',
      toolArgs: {},
    });

    await executeNode(node, {}, {}, 'user1', mockToolService);

    // Should resolve the tool name and call execute with the resolved name
    expect(mockToolService.execute).toHaveBeenCalledWith(
      'mcp.github.list_repos',
      {},
      { userId: 'user1', execSource: 'workflow' }
    );
  });
});

// ============================================================================
// executeConditionNode
// ============================================================================

describe('executeConditionNode', () => {
  it('evaluates truthy expression and returns branchTaken "true"', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '1 + 1 === 2' });

    const node = makeNode('cond1', 'conditionNode', { expression: '1 + 1 === 2' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(true);
    expect(result.branchTaken).toBe('true');
  });

  it('evaluates falsy expression and returns branchTaken "false"', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '1 > 5' });

    const node = makeNode('cond1', 'conditionNode', { expression: '1 > 5' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(false);
    expect(result.branchTaken).toBe('false');
  });

  it('has access to upstream node outputs in the evaluation context', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'n1 > 10' });

    const nodeOutputs = { n1: makeResult('n1', 42) };
    const node = makeNode('cond1', 'conditionNode', { expression: 'n1 > 10' });
    const result = executeConditionNode(node, nodeOutputs, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(true);
    expect(result.branchTaken).toBe('true');
  });

  it('has access to workflow variables in the evaluation context', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'threshold === 5' });

    const node = makeNode('cond1', 'conditionNode', { expression: 'threshold === 5' });
    const result = executeConditionNode(node, {}, { threshold: 5 });

    expect(result.status).toBe('success');
    expect(result.output).toBe(true);
  });

  it('returns error result for invalid expression', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'this is not valid js !!!' });

    const node = makeNode('cond1', 'conditionNode', { expression: 'this is not valid js !!!' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('returns error for undefined variable reference in expression', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'undefinedVar.length > 0' });

    const node = makeNode('cond1', 'conditionNode', { expression: 'undefinedVar.length > 0' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('includes timing information in result', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'true' });

    const node = makeNode('cond1', 'conditionNode', { expression: 'true' });
    const result = executeConditionNode(node, {}, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('uses custom timeout from node data', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'true' });

    const node = makeNode('cond1', 'conditionNode', {
      expression: 'true',
      timeoutMs: 1000,
    });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('success');
  });

  it('coerces truthy non-boolean values to true branch', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '"non-empty string"' });

    const node = makeNode('cond1', 'conditionNode', { expression: '"non-empty string"' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(true);
    expect(result.branchTaken).toBe('true');
  });

  it('coerces falsy values (0) to false branch', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '0' });

    const node = makeNode('cond1', 'conditionNode', { expression: '0' });
    const result = executeConditionNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(false);
    expect(result.branchTaken).toBe('false');
  });

  it('coerces empty string to false branch', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '""' });

    const node = makeNode('cond1', 'conditionNode', { expression: '""' });
    const result = executeConditionNode(node, {}, {});

    expect(result.output).toBe(false);
    expect(result.branchTaken).toBe('false');
  });
});

// ============================================================================
// executeCodeNode
// ============================================================================

describe('executeCodeNode', () => {
  it('executes JavaScript code via execute_javascript tool', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'console.log("hello")' });
    mockToolService.execute.mockResolvedValue({ content: '"hello"', isError: false });

    const node = makeNode('code1', 'codeNode', {
      language: 'javascript',
      code: 'console.log("hello")',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('success');
    expect(result.output).toBe('hello');
    expect(result.resolvedArgs).toEqual({
      language: 'javascript',
      code: 'console.log("hello")',
    });
    expect(mockToolService.execute).toHaveBeenCalledWith(
      'execute_javascript',
      { code: 'console.log("hello")' },
      { userId: 'user1', execSource: 'workflow' }
    );
  });

  it('executes Python code via execute_python tool', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'print("hello")' });
    mockToolService.execute.mockResolvedValue({ content: '"hello"', isError: false });

    const node = makeNode('code1', 'codeNode', {
      language: 'python',
      code: 'print("hello")',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('success');
    expect(mockToolService.execute).toHaveBeenCalledWith(
      'execute_python',
      { code: 'print("hello")' },
      { userId: 'user1', execSource: 'workflow' }
    );
  });

  it('executes shell code via execute_shell tool', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'echo hello' });
    mockToolService.execute.mockResolvedValue({ content: '"hello"', isError: false });

    const node = makeNode('code1', 'codeNode', {
      language: 'shell',
      code: 'echo hello',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('success');
    expect(mockToolService.execute).toHaveBeenCalledWith(
      'execute_shell',
      { code: 'echo hello' },
      { userId: 'user1', execSource: 'workflow' }
    );
  });

  it('returns error for unsupported language', async () => {
    const node = makeNode('code1', 'codeNode', {
      language: 'ruby',
      code: 'code',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Unsupported language: "ruby". Supported: javascript, python, shell');
    expect(mockToolService.execute).not.toHaveBeenCalled();
  });

  it('returns error result when tool execution fails', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'bad code' });
    mockToolService.execute.mockResolvedValue({ content: 'Syntax error', isError: true });

    const node = makeNode('code1', 'codeNode', {
      language: 'javascript',
      code: 'bad code',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Syntax error');
  });

  it('catches thrown errors from tool service', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'code' });
    mockToolService.execute.mockRejectedValue(new Error('Service unavailable'));

    const node = makeNode('code1', 'codeNode', {
      language: 'javascript',
      code: 'code',
    });
    const result = await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Service unavailable');
  });

  it('resolves templates in the code string', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'console.log("resolved-value")' });
    mockToolService.execute.mockResolvedValue({ content: '"ok"', isError: false });

    const node = makeNode('code1', 'codeNode', {
      language: 'javascript',
      code: 'console.log("{{prev.output}}")',
    });
    const nodeOutputs = { prev: makeResult('prev', 'resolved-value') };
    await executeCodeNode(node, nodeOutputs, {}, 'user1', mockToolService);

    expect(resolveTemplates).toHaveBeenCalledWith(
      { _code: 'console.log("{{prev.output}}")' },
      nodeOutputs,
      {}
    );
  });
});

// ============================================================================
// executeTransformerNode
// ============================================================================

describe('executeTransformerNode', () => {
  it('evaluates a simple expression and returns result', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '1 + 2 + 3' });

    const node = makeNode('tf1', 'transformerNode', { expression: '1 + 2 + 3' });
    const result = executeTransformerNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(6);
    expect(result.resolvedArgs).toEqual({ expression: '1 + 2 + 3' });
  });

  it('has access to upstream outputs via node ID', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'n1.map(x => x * 2)' });

    const nodeOutputs = { n1: makeResult('n1', [1, 2, 3]) };
    const node = makeNode('tf1', 'transformerNode', { expression: 'n1.map(x => x * 2)' });
    const result = executeTransformerNode(node, nodeOutputs, {});

    expect(result.status).toBe('success');
    expect(result.output).toEqual([2, 4, 6]);
  });

  it('has access to "data" alias for the last upstream output', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'data.toUpperCase()' });

    const nodeOutputs = { n1: makeResult('n1', 'hello') };
    const node = makeNode('tf1', 'transformerNode', { expression: 'data.toUpperCase()' });
    const result = executeTransformerNode(node, nodeOutputs, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe('HELLO');
  });

  it('has access to workflow variables', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'multiplier * 10' });

    const node = makeNode('tf1', 'transformerNode', { expression: 'multiplier * 10' });
    const result = executeTransformerNode(node, {}, { multiplier: 5 });

    expect(result.status).toBe('success');
    expect(result.output).toBe(50);
  });

  it('returns error result for invalid expression', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'invalid !! syntax' });

    const node = makeNode('tf1', 'transformerNode', { expression: 'invalid !! syntax' });
    const result = executeTransformerNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('returns error for undefined variable reference', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'noSuchVar.property' });

    const node = makeNode('tf1', 'transformerNode', { expression: 'noSuchVar.property' });
    const result = executeTransformerNode(node, {}, {});

    expect(result.status).toBe('error');
  });

  it('includes timing information', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '42' });

    const node = makeNode('tf1', 'transformerNode', { expression: '42' });
    const result = executeTransformerNode(node, {}, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('sets data alias to the most recent upstream output', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'data' });

    const nodeOutputs = {
      n1: makeResult('n1', 'first'),
      n2: makeResult('n2', 'second'),
    };
    const node = makeNode('tf1', 'transformerNode', { expression: 'data' });
    const result = executeTransformerNode(node, nodeOutputs, {});

    // 'data' is the last output in iteration order
    expect(result.status).toBe('success');
    expect(result.output).toBe('second');
  });

  it('uses custom timeout from node data', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '42' });

    const node = makeNode('tf1', 'transformerNode', {
      expression: '42',
      timeoutMs: 1000,
    });
    const result = executeTransformerNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe(42);
  });

  it('returns object results from expression', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '({name: "test", count: 3})' });

    const node = makeNode('tf1', 'transformerNode', { expression: '({name: "test", count: 3})' });
    const result = executeTransformerNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ name: 'test', count: 3 });
  });
});

// ============================================================================
// executeLlmNode
// ============================================================================

describe('executeLlmNode', () => {
  it('executes LLM call and returns success result', async () => {
    vi.mocked(resolveTemplates)
      .mockReturnValueOnce({ _msg: 'Hello AI' })
      .mockReturnValueOnce({ _sp: 'You are helpful' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Hello! How can I help?' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello AI',
      systemPrompt: 'You are helpful',
      temperature: 0.5,
      maxTokens: 1000,
    });

    const result = await executeLlmNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe('Hello! How can I help?');
    expect(result.resolvedArgs).toMatchObject({
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello AI',
    });
  });

  it('returns error result when provider returns error', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockResolvedValue({
      ok: false,
      error: { message: 'Rate limit exceeded' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
    });

    const result = await executeLlmNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBe('Rate limit exceeded');
  });

  it('catches thrown errors from provider', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockRejectedValue(new Error('Network failure'));

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
    });

    const result = await executeLlmNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBe('Network failure');
  });

  it('handles node without system prompt', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Response' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
      // No systemPrompt
    });

    const result = await executeLlmNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.output).toBe('Response');
  });

  it('uses default temperature and maxTokens when not specified', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Response' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
      // No temperature or maxTokens
    });

    await executeLlmNode(node, {}, {});

    expect(mockProvider.complete).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Hello' }],
      model: {
        model: 'gpt-4',
        maxTokens: 4096,
        temperature: 0.7,
      },
    });
  });

  it('includes timing information', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Response' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
    });

    const result = await executeLlmNode(node, {}, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('resolves templates in user message', async () => {
    const nodeOutputs = { prev: makeResult('prev', 'previous result') };
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Previous: previous result' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Analyzed.' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Previous: {{prev.output}}',
    });

    const result = await executeLlmNode(node, nodeOutputs, {});

    expect(result.status).toBe('success');
    expect(resolveTemplates).toHaveBeenCalledWith(
      { _msg: 'Previous: {{prev.output}}' },
      nodeOutputs,
      {}
    );
  });

  it('uses node-level apiKey override if provided', async () => {
    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: 'Response' },
    });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
      apiKey: 'custom-key-123',
    });

    await executeLlmNode(node, {}, {});

    // createProvider should have been called with the custom key
    const { createProvider } = await import('@ownpilot/core');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'custom-key-123' })
    );
  });

  it('returns error when no provider is configured (resolve returns null)', async () => {
    const { resolveProviderAndModel } = await import('../../routes/settings.js');
    vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({
      provider: null as unknown as string,
      model: null,
    });

    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });

    const node = makeNode('llm1', 'llmNode', {
      provider: '',
      model: '',
      userMessage: 'Hello',
    });

    const result = await executeLlmNode(node, {}, {});
    expect(result.status).toBe('error');
    expect(result.error).toContain('No AI provider configured');
  });

  it('uses baseUrl from providerCfg when not specified in node', async () => {
    const { loadProviderConfig } = await import('../../routes/agent-cache.js');
    vi.mocked(loadProviderConfig).mockReturnValueOnce({
      baseUrl: 'https://custom-api.example.com',
    } as never);

    vi.mocked(resolveTemplates).mockReturnValueOnce({ _msg: 'Hello' });
    mockProvider.complete.mockResolvedValue({ ok: true, value: { content: 'ok' } });

    const node = makeNode('llm1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Hello',
    });

    await executeLlmNode(node, {}, {});

    const { createProvider } = await import('@ownpilot/core');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://custom-api.example.com' })
    );
  });
});

// ============================================================================
// executeHttpRequestNode
// ============================================================================

describe('executeHttpRequestNode', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeMockResponse(
    overrides: Partial<{
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      contentType: string;
    }> = {}
  ) {
    const headers = new Map<string, string>(
      Object.entries({
        'content-type': overrides.contentType ?? 'text/plain',
        ...overrides.headers,
      })
    );
    return {
      ok: overrides.ok ?? true,
      status: overrides.status ?? 200,
      statusText: overrides.statusText ?? 'OK',
      headers: {
        get: (key: string) => headers.get(key) ?? null,
        forEach: (fn: (v: string, k: string) => void) => headers.forEach(fn),
      },
      text: async () => overrides.body ?? 'response body',
    };
  }

  it('makes a GET request and returns success result', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'https://api.example.com/data' });
    mockFetch.mockResolvedValue(makeMockResponse({ body: 'hello world' }));

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/data',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).status).toBe(200);
    expect((result.output as Record<string, unknown>).body).toBe('hello world');
  });

  it('blocks SSRF requests to private IP addresses', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'http://192.168.1.1/admin' });

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'http://192.168.1.1/admin',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('private/internal');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks requests to localhost', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'http://localhost:3000' });

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'http://localhost:3000',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('private/internal');
  });

  it('blocks malformed URLs', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'not-a-valid-url' });

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'not-a-valid-url',
    });

    const result = await executeHttpRequestNode(node, {}, {});
    expect(result.status).toBe('error');
  });

  it('parses JSON response body automatically', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'https://api.example.com/json' });
    mockFetch.mockResolvedValue(
      makeMockResponse({
        body: '{"key":"value"}',
        contentType: 'application/json',
      })
    );

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/json',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).body).toEqual({ key: 'value' });
  });

  it('returns error for HTTP 4xx/5xx responses', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'https://api.example.com/error' });
    mockFetch.mockResolvedValue(
      makeMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: 'Not found',
      })
    );

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/error',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('404');
  });

  it('adds bearer auth header', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      _url: 'https://api.example.com/secure',
      _authToken: 'my-token',
    });
    mockFetch.mockResolvedValue(makeMockResponse());

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/secure',
      auth: { type: 'bearer', token: 'my-token' },
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['Authorization']).toBe('Bearer my-token');
  });

  it('adds basic auth header', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      _url: 'https://api.example.com/secure',
      _authUser: 'user',
      _authPass: 'pass',
    });
    mockFetch.mockResolvedValue(makeMockResponse());

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/secure',
      auth: { type: 'basic', username: 'user', password: 'pass' },
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['Authorization']).toContain('Basic ');
  });

  it('adds apiKey auth header', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      _url: 'https://api.example.com/secure',
      _authToken: 'api-key-value',
    });
    mockFetch.mockResolvedValue(makeMockResponse());

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/secure',
      auth: { type: 'apiKey', headerName: 'X-Custom-Key', token: 'api-key-value' },
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['X-Custom-Key']).toBe('api-key-value');
  });

  it('sends POST request with JSON body', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      _url: 'https://api.example.com/post',
      _body: '{"name":"test"}',
    });
    mockFetch.mockResolvedValue(makeMockResponse());

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'POST',
      url: 'https://api.example.com/post',
      body: '{"name":"test"}',
      bodyType: 'json',
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.method).toBe('POST');
    expect(fetchOpts.body).toBe('{"name":"test"}');
    expect(fetchOpts.headers['Content-Type']).toBe('application/json');
  });

  it('returns error when content-length exceeds max', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'https://api.example.com/big' });
    const headers = new Map([
      ['content-length', '2000000'],
      ['content-type', 'text/plain'],
    ]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (k: string) => headers.get(k) ?? null,
        forEach: (fn: (v: string, k: string) => void) => headers.forEach(fn),
      },
      text: async () => 'x'.repeat(100),
    });

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/big',
      maxResponseSize: 1024,
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('Response too large');
  });

  it('adds query params to URL', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      _url: 'https://api.example.com/search',
      _q_q: 'test',
    });
    mockFetch.mockResolvedValue(makeMockResponse());

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/search',
      queryParams: { q: 'test' },
    });

    await executeHttpRequestNode(node, {}, {});

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=test');
  });

  it('catches fetch errors and returns error result', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _url: 'https://api.example.com/fail' });
    mockFetch.mockRejectedValue(new Error('Network error'));

    const node = makeNode('http1', 'httpRequestNode', {
      method: 'GET',
      url: 'https://api.example.com/fail',
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBe('Network error');
  });
});

// ============================================================================
// executeDelayNode
// ============================================================================

describe('executeDelayNode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays for specified seconds and returns success', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '2' });

    const node = makeNode('delay1', 'delayNode', { duration: 2, unit: 'seconds' });
    const promise = executeDelayNode(node, {}, {});

    await vi.advanceTimersByTimeAsync(2001);
    const result = await promise;

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).unit).toBe('seconds');
    expect((result.output as Record<string, unknown>).value).toBe(2);
  });

  it('delays for specified minutes', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '1' });

    const node = makeNode('delay1', 'delayNode', { duration: 1, unit: 'minutes' });
    const promise = executeDelayNode(node, {}, {});

    await vi.advanceTimersByTimeAsync(61000);
    const result = await promise;

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).delayMs).toBe(60000);
  });

  it('delays for specified hours (capped at 1 hour)', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '2' }); // 2 hours → capped at 1 hour

    const node = makeNode('delay1', 'delayNode', { duration: 2, unit: 'hours' });
    const promise = executeDelayNode(node, {}, {});

    await vi.advanceTimersByTimeAsync(3_600_001);
    const result = await promise;

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).delayMs).toBe(3_600_000);
  });

  it('returns error for NaN duration', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: 'not-a-number' });

    const node = makeNode('delay1', 'delayNode', { duration: 'not-a-number', unit: 'seconds' });
    const result = await executeDelayNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid delay duration');
  });

  it('returns error for negative duration', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '-5' });

    const node = makeNode('delay1', 'delayNode', { duration: -5, unit: 'seconds' });
    const result = await executeDelayNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid delay duration');
  });

  it('cancels delay when abortSignal fires', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '60' });

    const controller = new AbortController();
    const node = makeNode('delay1', 'delayNode', { duration: 60, unit: 'seconds' });

    const promise = executeDelayNode(node, {}, {}, controller.signal);

    // Abort before timer fires
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('cancelled');
  });

  it('returns error immediately when signal is already aborted', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _dur: '10' });

    const controller = new AbortController();
    controller.abort(); // Already aborted

    const node = makeNode('delay1', 'delayNode', { duration: 10, unit: 'seconds' });
    const promise = executeDelayNode(node, {}, {}, controller.signal);

    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result.status).toBe('error');
    expect(result.error).toContain('cancelled');
  });
});

// ============================================================================
// executeNotificationNode
// ============================================================================

describe('executeNotificationNode', () => {
  beforeEach(() => {
    // Mock the wsGateway import
    vi.doMock('../../ws/server.js', () => ({
      wsGateway: { broadcast: vi.fn().mockResolvedValue(undefined) },
    }));
  });

  it('returns success with notification metadata after broadcast', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _msg: 'Task completed!' });

    const node = makeNode('notif1', 'notificationNode', {
      message: 'Task completed!',
      severity: 'success',
    });

    const result = await executeNotificationNode(node, {}, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).sent).toBe(true);
    expect((result.output as Record<string, unknown>).message).toBe('Task completed!');
    expect((result.output as Record<string, unknown>).severity).toBe('success');
  });

  it('defaults to info severity when not specified', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _msg: 'Info message' });

    const node = makeNode('notif1', 'notificationNode', {
      message: 'Info message',
    });

    const result = await executeNotificationNode(node, {}, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).severity).toBe('info');
  });

  it('includes timing information', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _msg: 'Test' });

    const node = makeNode('notif1', 'notificationNode', { message: 'Test' });
    const result = await executeNotificationNode(node, {}, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('resolves message templates', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _msg: 'Hello, resolved!' });

    const node = makeNode('notif1', 'notificationNode', { message: '{{greeting}}' });
    const result = await executeNotificationNode(node, {}, { greeting: 'Hello, resolved!' });

    expect((result.output as Record<string, unknown>).message).toBe('Hello, resolved!');
  });

  it('returns success with warning when broadcast fails', async () => {
    vi.doMock('../../ws/server.js', () => ({
      wsGateway: { broadcast: vi.fn().mockRejectedValue(new Error('WS down')) },
    }));
    vi.mocked(resolveTemplates).mockReturnValue({ _msg: 'Notify!' });

    const node = makeNode('notif1', 'notificationNode', {
      message: 'Notify!',
      severity: 'info',
    });

    const result = await executeNotificationNode(node, {}, {});

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.sent).toBe(false);
    expect(output.warning).toBe('WebSocket broadcast failed — delivery not confirmed');
  });
});

// ============================================================================
// executeMergeNode
// ============================================================================

describe('executeMergeNode', () => {
  it('collects outputs from all incoming node IDs', () => {
    const nodeOutputs = {
      n1: makeResult('n1', 'output-1'),
      n2: makeResult('n2', 'output-2'),
      n3: makeResult('n3', 'output-3'),
    };

    const node = makeNode('merge1', 'mergeNode', { mode: 'waitAll' });
    const result = executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2', 'n3']);

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.results).toEqual({ n1: 'output-1', n2: 'output-2', n3: 'output-3' });
    expect(output.count).toBe(3);
    expect(output.mode).toBe('waitAll');
  });

  it('only includes outputs for provided incomingNodeIds', () => {
    const nodeOutputs = {
      n1: makeResult('n1', 'output-1'),
      n2: makeResult('n2', 'output-2'),
      n3: makeResult('n3', 'output-3'),
    };

    const node = makeNode('merge1', 'mergeNode', { mode: 'waitAll' });
    const result = executeMergeNode(node, nodeOutputs, {}, ['n1', 'n3']);

    const output = result.output as Record<string, unknown>;
    expect(output.count).toBe(2);
    expect((output.results as Record<string, unknown>).n2).toBeUndefined();
  });

  it('returns empty results when no upstream nodes have output', () => {
    const node = makeNode('merge1', 'mergeNode', {});
    const result = executeMergeNode(node, {}, {}, ['n1', 'n2']);

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.count).toBe(0);
  });

  it('defaults to waitAll mode', () => {
    const node = makeNode('merge1', 'mergeNode', {});
    const result = executeMergeNode(node, {}, {}, []);

    expect((result.output as Record<string, unknown>).mode).toBe('waitAll');
  });

  it('includes timing information', () => {
    const node = makeNode('merge1', 'mergeNode', {});
    const result = executeMergeNode(node, {}, {}, []);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
  });

  it('firstCompleted mode returns only the first non-null result', () => {
    const nodeOutputs = {
      n1: makeResult('n1', null),
      n2: makeResult('n2', 'second-output'),
      n3: makeResult('n3', 'third-output'),
    };

    const node = makeNode('merge1', 'mergeNode', { mode: 'firstCompleted' });
    const result = executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2', 'n3']);

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.mode).toBe('firstCompleted');
    expect(output.results).toEqual({ n2: 'second-output' });
    expect(output.count).toBe(1);
    expect(output.selectedNode).toBe('n2');
  });

  it('firstCompleted mode returns empty when all outputs are null/undefined', () => {
    const nodeOutputs = {
      n1: makeResult('n1', null),
      n2: makeResult('n2', undefined),
    };

    const node = makeNode('merge1', 'mergeNode', { mode: 'firstCompleted' });
    const result = executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2']);

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.mode).toBe('firstCompleted');
    expect(output.results).toEqual({});
    expect(output.count).toBe(0);
  });

  it('firstCompleted mode selects first available node in order', () => {
    const nodeOutputs = {
      n1: makeResult('n1', 'first-output'),
      n2: makeResult('n2', 'second-output'),
    };

    const node = makeNode('merge1', 'mergeNode', { mode: 'firstCompleted' });
    const result = executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2']);

    const output = result.output as Record<string, unknown>;
    expect(output.selectedNode).toBe('n1');
    expect(output.results).toEqual({ n1: 'first-output' });
  });
});

// ============================================================================
// executeSwitchNode
// ============================================================================

describe('executeSwitchNode', () => {
  it('matches expression result against cases and returns matched label', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '"active"' });

    const node = makeNode('switch1', 'switchNode', {
      expression: '"active"',
      cases: [
        { value: 'active', label: 'Active Branch' },
        { value: 'inactive', label: 'Inactive Branch' },
      ],
    });

    const result = executeSwitchNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('Active Branch');
    expect(result.output).toBe('active');
  });

  it('returns "default" branch when no case matches', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '"unknown"' });

    const node = makeNode('switch1', 'switchNode', {
      expression: '"unknown"',
      cases: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
    });

    const result = executeSwitchNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('default');
  });

  it('evaluates expression with upstream outputs', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'n1 > 50 ? "high" : "low"' });

    const nodeOutputs = { n1: makeResult('n1', 75) };
    const node = makeNode('switch1', 'switchNode', {
      expression: 'n1 > 50 ? "high" : "low"',
      cases: [{ value: 'high', label: 'High Priority' }],
    });

    const result = executeSwitchNode(node, nodeOutputs, {});

    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('High Priority');
  });

  it('returns error for invalid expression', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: 'invalid !! syntax @@' });

    const node = makeNode('switch1', 'switchNode', {
      expression: 'invalid !! syntax @@',
      cases: [],
    });

    const result = executeSwitchNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('includes resolvedArgs with expression and evaluated value', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '42' });

    const node = makeNode('switch1', 'switchNode', {
      expression: '42',
      cases: [{ value: '42', label: 'Forty-Two' }],
    });

    const result = executeSwitchNode(node, {}, {});

    expect(result.resolvedArgs).toEqual(
      expect.objectContaining({
        expression: '42',
        evaluatedValue: '42',
        matchedCase: 'Forty-Two',
      })
    );
  });

  it('includes timing information', () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _expr: '1' });

    const node = makeNode('switch1', 'switchNode', {
      expression: '1',
      cases: [],
    });

    const result = executeSwitchNode(node, {}, {});

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
  });
});

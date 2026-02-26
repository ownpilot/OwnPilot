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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('falls back to execute_javascript for unknown language', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({ _code: 'code' });
    mockToolService.execute.mockResolvedValue({ content: '"ok"', isError: false });

    const node = makeNode('code1', 'codeNode', {
      language: 'ruby',
      code: 'code',
    });
    await executeCodeNode(node, {}, {}, 'user1', mockToolService);

    expect(mockToolService.execute).toHaveBeenCalledWith(
      'execute_javascript',
      { code: 'code' },
      { userId: 'user1', execSource: 'workflow' }
    );
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
    expect(result.resolvedArgs).toEqual({
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
});

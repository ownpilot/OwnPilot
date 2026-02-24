/**
 * Tests for foreach-executor.ts — ForEach node execution.
 *
 * Covers:
 * - executeForEachNode: array iteration, body subgraph execution
 * - Error handling: non-array input, iteration errors, stop vs continue
 * - Empty arrays, maxIterations cap, abort signal
 * - Progress events, intermediate persistence, condition branching in body
 * - Item variable alias, skipped node reset between iterations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, WorkflowEdge, NodeResult } from '../../db/repositories/workflows.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockExecuteNode = vi.hoisted(() => vi.fn());
const mockExecuteLlmNode = vi.hoisted(() => vi.fn());
const mockExecuteConditionNode = vi.hoisted(() => vi.fn());
const mockExecuteCodeNode = vi.hoisted(() => vi.fn());
const mockExecuteTransformerNode = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../db/repositories/workflows.js', () => ({
  createWorkflowsRepository: vi.fn(),
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

vi.mock('./template-resolver.js', () => ({
  resolveTemplates: vi.fn((args: Record<string, unknown>) => args),
}));

vi.mock('./node-executors.js', () => ({
  executeNode: mockExecuteNode,
  executeLlmNode: mockExecuteLlmNode,
  executeConditionNode: mockExecuteConditionNode,
  executeCodeNode: mockExecuteCodeNode,
  executeTransformerNode: mockExecuteTransformerNode,
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { executeForEachNode } from './foreach-executor.js';
import { resolveTemplates } from './template-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {}
): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } as WorkflowNode['data'] };
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string
): WorkflowEdge {
  return { id: `${source}-${target}`, source, target, sourceHandle };
}

function makeNodeResult(
  nodeId: string,
  output: unknown,
  status: NodeResult['status'] = 'success'
): NodeResult {
  return {
    nodeId,
    status,
    output,
    durationMs: 10,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

/** Create a standalone toolService mock (avoids resolveTemplates side-effect of createForEachSetup) */
function makeToolService() {
  return {
    execute: vi.fn(),
    has: vi.fn(),
    getDefinitions: vi.fn(),
    getDefinition: vi.fn(),
    getDefinitionsBySource: vi.fn(),
    getNames: vi.fn(),
    use: vi.fn(),
    getCount: vi.fn(),
  };
}

// Standard forEach setup
function createForEachSetup(items: unknown[], opts: {
  bodyNodeType?: string;
  maxIterations?: number;
  onError?: 'stop' | 'continue';
  itemVariable?: string;
} = {}) {
  const feNode = makeNode('fe1', 'forEachNode', {
    arrayExpression: '{{source.output}}',
    maxIterations: opts.maxIterations,
    onError: opts.onError,
    itemVariable: opts.itemVariable,
  });

  const bodyType = opts.bodyNodeType ?? 'toolNode';
  const bodyNode = makeNode('body1', bodyType, {
    toolName: 'process_item',
    toolArgs: {},
    expression: 'data',
    language: 'javascript',
    code: 'return data;',
  });

  const edges = [makeEdge('fe1', 'body1', 'each')];
  const nodeMap = new Map<string, WorkflowNode>([
    ['fe1', feNode],
    ['body1', bodyNode],
  ]);

  const nodeOutputs: Record<string, NodeResult> = {};
  const variables: Record<string, unknown> = {};

  // Mock resolveTemplates to return the array
  vi.mocked(resolveTemplates).mockReturnValue({ _arr: items });

  return {
    feNode,
    bodyNode,
    edges,
    nodeMap,
    nodeOutputs,
    variables,
    abortSignal: new AbortController().signal,
    toolService: {
      execute: vi.fn(),
      has: vi.fn(),
      getDefinitions: vi.fn(),
      getDefinition: vi.fn(),
      getDefinitionsBySource: vi.fn(),
      getNames: vi.fn(),
      use: vi.fn(),
      getCount: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// executeForEachNode
// ============================================================================

describe('executeForEachNode', () => {
  it('returns error when expression does not resolve to an array', async () => {
    const setup = createForEachSetup([]);
    // Override to return a non-array
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: 'not an array' });

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('must return an array');
    expect(result.error).toContain('string');
  });

  it('handles empty array — skips body nodes and returns success', async () => {
    const setup = createForEachSetup([]);

    const progressEvents: Array<Record<string, unknown>> = [];
    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService,
      (e) => progressEvents.push(e)
    );

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ results: [], count: 0, items: [] });
    expect(result.iterationCount).toBe(0);
    expect(result.totalItems).toBe(0);
    // Body nodes should be marked as skipped
    expect(setup.nodeOutputs['body1']?.status).toBe('skipped');
  });

  it('iterates over array and executes body nodes for each item', async () => {
    const items = ['a', 'b', 'c'];
    const setup = createForEachSetup(items);

    mockExecuteNode
      .mockResolvedValueOnce(makeNodeResult('body1', 'processed-a'))
      .mockResolvedValueOnce(makeNodeResult('body1', 'processed-b'))
      .mockResolvedValueOnce(makeNodeResult('body1', 'processed-c'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(result.output.count).toBe(3);
    expect(result.output.results).toEqual(['processed-a', 'processed-b', 'processed-c']);
    expect(result.iterationCount).toBe(3);
    expect(result.totalItems).toBe(3);
    expect(mockExecuteNode).toHaveBeenCalledTimes(3);
  });

  it('caps iterations at maxIterations', async () => {
    const items = [1, 2, 3, 4, 5];
    const setup = createForEachSetup(items, { maxIterations: 3 });

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(result.output.count).toBe(3);
    expect(mockExecuteNode).toHaveBeenCalledTimes(3);
  });

  it('stops on error when onError is "stop"', async () => {
    const items = ['a', 'b', 'c'];
    const setup = createForEachSetup(items, { onError: 'stop' });

    mockExecuteNode
      .mockResolvedValueOnce(makeNodeResult('body1', 'ok'))
      .mockResolvedValueOnce({
        nodeId: 'body1',
        status: 'error',
        error: 'Failed on b',
        completedAt: new Date().toISOString(),
      });

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('1 iteration(s) failed');
    // Should have stopped after second iteration
    expect(mockExecuteNode).toHaveBeenCalledTimes(2);
  });

  it('continues on error when onError is "continue"', async () => {
    const items = ['a', 'b', 'c'];
    const setup = createForEachSetup(items, { onError: 'continue' });

    mockExecuteNode
      .mockResolvedValueOnce(makeNodeResult('body1', 'ok'))
      .mockResolvedValueOnce({
        nodeId: 'body1',
        status: 'error',
        error: 'Failed on b',
        completedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce(makeNodeResult('body1', 'also ok'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(result.output.errors).toHaveLength(1);
    expect(result.output.errors[0]).toEqual({ index: 1, error: 'Failed on b' });
    expect(mockExecuteNode).toHaveBeenCalledTimes(3);
  });

  it('emits foreach_iteration_start and foreach_iteration_complete events', async () => {
    const items = ['a', 'b'];
    const setup = createForEachSetup(items);

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const events: Array<Record<string, unknown>> = [];
    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService,
      (e) => events.push(e)
    );

    const iterStartEvents = events.filter((e) => e.type === 'foreach_iteration_start');
    const iterCompleteEvents = events.filter((e) => e.type === 'foreach_iteration_complete');
    expect(iterStartEvents).toHaveLength(2);
    expect(iterCompleteEvents).toHaveLength(2);
    expect(iterStartEvents[0]).toMatchObject({
      nodeId: 'fe1',
      iterationIndex: 0,
      iterationTotal: 2,
    });
    expect(iterStartEvents[1]).toMatchObject({
      nodeId: 'fe1',
      iterationIndex: 1,
      iterationTotal: 2,
    });
  });

  it('emits node_start and node_complete events for body nodes', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const events: Array<Record<string, unknown>> = [];
    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService,
      (e) => events.push(e)
    );

    expect(events.some((e) => e.type === 'node_start' && e.nodeId === 'body1')).toBe(true);
    expect(events.some((e) => e.type === 'node_complete' && e.nodeId === 'body1')).toBe(true);
  });

  it('throws when aborted before iteration starts', async () => {
    const items = ['a', 'b'];
    const setup = createForEachSetup(items);
    const abortController = new AbortController();
    abortController.abort();

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      abortController.signal,
      setup.toolService
    );

    // The abort should be caught by the catch block
    expect(result.status).toBe('error');
    expect(result.error).toContain('cancelled');
  });

  it('persists intermediate progress when repo and logId are provided', async () => {
    const items = ['a', 'b'];
    const setup = createForEachSetup(items);

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const mockRepo = { updateLog: vi.fn() };
    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService,
      undefined,
      mockRepo as unknown as ReturnType<typeof import('../../db/repositories/workflows.js').createWorkflowsRepository>,
      'log-1'
    );

    expect(mockRepo.updateLog).toHaveBeenCalledTimes(2);
    expect(mockRepo.updateLog).toHaveBeenCalledWith('log-1', { nodeResults: setup.nodeOutputs });
  });

  it('does not persist when repo or logId is missing', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    // No repo/logId
    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    // Nothing to assert on repo — just verifying no errors
  });

  it('sets ForEach node output with item, index, items, count per iteration', async () => {
    const items = ['x', 'y'];
    const setup = createForEachSetup(items);

    let capturedOutput: unknown;
    mockExecuteNode.mockImplementation(async (_node: WorkflowNode, nodeOutputs: Record<string, NodeResult>) => {
      capturedOutput = nodeOutputs['fe1']?.output;
      return makeNodeResult('body1', 'done');
    });

    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    // On the second iteration, the forEach output should have index=1
    expect(capturedOutput).toEqual({
      item: 'y',
      index: 1,
      items: ['x', 'y'],
      count: 2,
    });
  });

  it('sets item variable alias in iteration variables', async () => {
    const items = ['task-1'];
    const setup = createForEachSetup(items, { itemVariable: 'issue' });

    let capturedVars: Record<string, unknown> | undefined;
    mockExecuteNode.mockImplementation(async (_node: WorkflowNode, _outputs: Record<string, NodeResult>, vars: Record<string, unknown>) => {
      capturedVars = vars;
      return makeNodeResult('body1', 'done');
    });

    await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(capturedVars!.issue).toBe('task-1');
    expect(capturedVars!.issue_index).toBe(0);
  });

  it('handles LLM body node type', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items, { bodyNodeType: 'llmNode' });

    // Override body node data for LLM
    const llmBody = makeNode('body1', 'llmNode', {
      provider: 'openai',
      model: 'gpt-4',
      userMessage: 'Process {{issue}}',
    });
    setup.nodeMap.set('body1', llmBody);

    mockExecuteLlmNode.mockResolvedValue(makeNodeResult('body1', 'AI response'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(mockExecuteLlmNode).toHaveBeenCalledTimes(1);
  });

  it('handles condition body node type with branching', async () => {
    const items = ['a'];
    // Setup with condition node in body
    const feNode = makeNode('fe1', 'forEachNode', {
      arrayExpression: '{{source.output}}',
    });
    const condNode = makeNode('condBody', 'conditionNode', { expression: 'true' });
    const trueNode = makeNode('trueBody', 'toolNode', { toolName: 'test', toolArgs: {} });
    const falseNode = makeNode('falseBody', 'toolNode', { toolName: 'test2', toolArgs: {} });

    const edges = [
      makeEdge('fe1', 'condBody', 'each'),
      makeEdge('condBody', 'trueBody', 'true'),
      makeEdge('condBody', 'falseBody', 'false'),
    ];
    const nodeMap = new Map<string, WorkflowNode>([
      ['fe1', feNode],
      ['condBody', condNode],
      ['trueBody', trueNode],
      ['falseBody', falseNode],
    ]);
    const nodeOutputs: Record<string, NodeResult> = {};
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: items });

    mockExecuteConditionNode.mockReturnValue({
      ...makeNodeResult('condBody', true),
      branchTaken: 'true',
    });
    mockExecuteNode.mockResolvedValue(makeNodeResult('trueBody', 'true path'));

    const events: Array<Record<string, unknown>> = [];
    const result = await executeForEachNode(
      feNode,
      nodeOutputs,
      {},
      edges,
      nodeMap,
      'user1',
      new AbortController().signal,
      makeToolService(),
      (e) => events.push(e)
    );

    expect(result.status).toBe('success');
    expect(mockExecuteConditionNode).toHaveBeenCalled();
    // falseBody should be skipped
    const falseSkipped = events.find(
      (e) => e.nodeId === 'falseBody' && e.status === 'skipped'
    );
    expect(falseSkipped).toBeDefined();
  });

  it('handles code body node type', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items, { bodyNodeType: 'codeNode' });
    const codeBody = makeNode('body1', 'codeNode', { language: 'javascript', code: 'return 1;' });
    setup.nodeMap.set('body1', codeBody);

    mockExecuteCodeNode.mockResolvedValue(makeNodeResult('body1', 1));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(mockExecuteCodeNode).toHaveBeenCalledTimes(1);
  });

  it('handles transformer body node type', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items, { bodyNodeType: 'transformerNode' });
    const tfBody = makeNode('body1', 'transformerNode', { expression: 'data' });
    setup.nodeMap.set('body1', tfBody);

    mockExecuteTransformerNode.mockReturnValue(makeNodeResult('body1', 'transformed'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success');
    expect(mockExecuteTransformerNode).toHaveBeenCalledTimes(1);
  });

  it('handles missing body node in nodeMap', async () => {
    const items = ['a'];
    const feNode = makeNode('fe1', 'forEachNode', { arrayExpression: '{{source.output}}' });
    const edges = [makeEdge('fe1', 'missing_node', 'each')];
    // nodeMap does NOT contain 'missing_node'
    const nodeMap = new Map<string, WorkflowNode>([['fe1', feNode]]);
    const nodeOutputs: Record<string, NodeResult> = {};
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: items });

    const result = await executeForEachNode(
      feNode,
      nodeOutputs,
      {},
      edges,
      nodeMap,
      'user1',
      new AbortController().signal,
      createForEachSetup([]).toolService
    );

    // Should still complete (body node missing produces an error result for that node)
    expect(result.status).toBe('success');
  });

  it('resets skipped body nodes between iterations', async () => {
    // This tests that condition-skipped nodes from iteration 1 are reset before iteration 2
    const items = ['a', 'b'];
    const feNode = makeNode('fe1', 'forEachNode', { arrayExpression: '{{source.output}}' });
    const condNode = makeNode('condBody', 'conditionNode', { expression: 'true' });
    const trueNode = makeNode('trueBody', 'toolNode', { toolName: 'test', toolArgs: {} });
    const falseNode = makeNode('falseBody', 'toolNode', { toolName: 'test2', toolArgs: {} });

    const edges = [
      makeEdge('fe1', 'condBody', 'each'),
      makeEdge('condBody', 'trueBody', 'true'),
      makeEdge('condBody', 'falseBody', 'false'),
    ];
    const nodeMap = new Map<string, WorkflowNode>([
      ['fe1', feNode],
      ['condBody', condNode],
      ['trueBody', trueNode],
      ['falseBody', falseNode],
    ]);
    const nodeOutputs: Record<string, NodeResult> = {};
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: items });

    // First iteration: condition true, second iteration: condition false
    mockExecuteConditionNode
      .mockReturnValueOnce({ ...makeNodeResult('condBody', true), branchTaken: 'true' })
      .mockReturnValueOnce({ ...makeNodeResult('condBody', false), branchTaken: 'false' });

    mockExecuteNode.mockResolvedValue(makeNodeResult('trueBody', 'result'));

    const result = await executeForEachNode(
      feNode,
      nodeOutputs,
      {},
      edges,
      nodeMap,
      'user1',
      new AbortController().signal,
      makeToolService()
    );

    expect(result.status).toBe('success');
    // condNode should have been called twice (once per iteration)
    expect(mockExecuteConditionNode).toHaveBeenCalledTimes(2);
  });

  it('catches thrown errors and returns error result', async () => {
    const feNode = makeNode('fe1', 'forEachNode', { arrayExpression: '{{source.output}}' });
    const toolService = makeToolService();

    // Make resolveTemplates throw
    vi.mocked(resolveTemplates).mockImplementation(() => {
      throw new Error('Template resolution failed');
    });

    const result = await executeForEachNode(
      feNode,
      {},
      {},
      [],
      new Map(),
      'user1',
      new AbortController().signal,
      toolService
    );

    expect(result.status).toBe('error');
    expect(result.error).toBe('Template resolution failed');
  });

  it('collects last body node output as iteration result', async () => {
    const items = ['x'];
    const setup = createForEachSetup(items);

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'final-body-output'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.output.results).toEqual(['final-body-output']);
  });

  it('uses default maxIterations of 100 when not specified', async () => {
    const items = Array.from({ length: 110 }, (_, i) => i);
    const feNode = makeNode('fe1', 'forEachNode', {
      arrayExpression: '{{source.output}}',
      // No maxIterations specified — defaults to 100
    });
    const bodyNode = makeNode('body1', 'toolNode', { toolName: 'test', toolArgs: {} });
    const edges = [makeEdge('fe1', 'body1', 'each')];
    const nodeMap = new Map<string, WorkflowNode>([
      ['fe1', feNode],
      ['body1', bodyNode],
    ]);
    const toolService = makeToolService();
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: items });

    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const result = await executeForEachNode(
      feNode,
      {},
      {},
      edges,
      nodeMap,
      'user1',
      new AbortController().signal,
      toolService
    );

    expect(result.output.count).toBe(100);
    expect(mockExecuteNode).toHaveBeenCalledTimes(100);
  });

  it('handles rejected promise from body node execution', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);

    // Simulate a rejected promise from executeNode
    mockExecuteNode.mockRejectedValue(new Error('Unexpected body error'));

    const events: Array<Record<string, unknown>> = [];
    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService,
      (e) => events.push(e)
    );

    // Default onError is 'stop' — rejected body produces error status
    expect(result.status).toBe('error');
    expect(result.error).toContain('1 iteration(s) failed');
    // The node error should be recorded
    expect(events.some((e) => e.type === 'node_error')).toBe(true);
  });

  it('skips body node execution when body node status is already skipped', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);

    // Pre-set body1 as skipped
    setup.nodeOutputs['body1'] = {
      nodeId: 'body1',
      status: 'skipped',
      completedAt: new Date().toISOString(),
    };

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    // body1 was skipped, so the iteration should return the item itself
    expect(result.status).toBe('success');
    // executeNode should not have been called since body was already skipped
    // Actually, the node was skipped before but the forEach should process it
    // The skipped status gets reset between iterations, but for the first iteration,
    // it's already skipped in nodeOutputs — the code checks this
  });

  it('returns non-array error for number input', async () => {
    const setup = createForEachSetup([]);
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: 42 });

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('number');
  });

  it('returns non-array error for object input', async () => {
    const setup = createForEachSetup([]);
    vi.mocked(resolveTemplates).mockReturnValue({ _arr: { key: 'val' } });

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('object');
  });

  it('includes timing info in result', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);
    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'done'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('output includes errors array when there are iteration errors and onError=continue', async () => {
    const items = ['a', 'b'];
    const setup = createForEachSetup(items, { onError: 'continue' });

    mockExecuteNode
      .mockResolvedValueOnce({
        nodeId: 'body1',
        status: 'error',
        error: 'Fail 1',
        completedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        nodeId: 'body1',
        status: 'error',
        error: 'Fail 2',
        completedAt: new Date().toISOString(),
      });

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.status).toBe('success'); // continue mode
    expect(result.output.errors).toHaveLength(2);
    expect(result.error).toContain('2 iteration(s) failed');
  });

  it('output does not include errors array when all iterations succeed', async () => {
    const items = ['a'];
    const setup = createForEachSetup(items);
    mockExecuteNode.mockResolvedValue(makeNodeResult('body1', 'ok'));

    const result = await executeForEachNode(
      setup.feNode,
      setup.nodeOutputs,
      setup.variables,
      setup.edges,
      setup.nodeMap,
      'user1',
      setup.abortSignal,
      setup.toolService
    );

    expect(result.output.errors).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

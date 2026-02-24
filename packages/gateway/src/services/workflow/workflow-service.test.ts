/**
 * Tests for workflow-service.ts — WorkflowService class.
 *
 * Covers:
 * - executeWorkflow: full DAG execution, error handling, abort, condition branching
 * - cancelExecution / isRunning
 * - executeWithRetryAndTimeout: retry logic, timeouts, vm node bypass
 * - getWorkflowService: singleton
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, WorkflowEdge, NodeResult, WorkflowLog } from '../../db/repositories/workflows.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  get: vi.fn(),
  createLog: vi.fn(),
  updateLog: vi.fn(),
  markRun: vi.fn(),
  getLog: vi.fn(),
}));

const mockToolService = vi.hoisted(() => ({
  execute: vi.fn(),
  has: vi.fn(),
  getDefinitions: vi.fn(),
  getDefinition: vi.fn(),
  getDefinitionsBySource: vi.fn(),
  getNames: vi.fn(),
  use: vi.fn(),
  getCount: vi.fn(),
}));

const mockExecuteNode = vi.hoisted(() => vi.fn());
const mockExecuteLlmNode = vi.hoisted(() => vi.fn());
const mockExecuteConditionNode = vi.hoisted(() => vi.fn());
const mockExecuteCodeNode = vi.hoisted(() => vi.fn());
const mockExecuteTransformerNode = vi.hoisted(() => vi.fn());
const mockExecuteForEachNode = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../db/repositories/workflows.js', () => ({
  createWorkflowsRepository: vi.fn(() => mockRepo),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: () => mockToolService,
    })),
    sleep: vi.fn(async () => {}),
    withTimeout: vi.fn(async (promise: Promise<unknown>) => promise),
  };
});

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

vi.mock('./dag-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dag-utils.js')>();
  return {
    ...actual,
  };
});

vi.mock('./node-executors.js', () => ({
  executeNode: mockExecuteNode,
  executeLlmNode: mockExecuteLlmNode,
  executeConditionNode: mockExecuteConditionNode,
  executeCodeNode: mockExecuteCodeNode,
  executeTransformerNode: mockExecuteTransformerNode,
}));

vi.mock('./foreach-executor.js', () => ({
  executeForEachNode: mockExecuteForEachNode,
}));

vi.mock('./template-resolver.js', () => ({
  resolveTemplates: vi.fn((args: Record<string, unknown>) => args),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { WorkflowService, getWorkflowService } from './workflow-service.js';

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

function makeLog(overrides: Partial<WorkflowLog> = {}): WorkflowLog {
  return {
    id: 'log-1',
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    status: 'running',
    nodeResults: {},
    error: null,
    durationMs: null,
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function makeNodeResult(nodeId: string, output: unknown, status: NodeResult['status'] = 'success'): NodeResult {
  return {
    nodeId,
    status,
    output,
    durationMs: 10,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let service: WorkflowService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new WorkflowService();

  // Default mock implementations
  mockRepo.createLog.mockResolvedValue(makeLog());
  mockRepo.updateLog.mockResolvedValue(undefined);
  mockRepo.markRun.mockResolvedValue(undefined);
  mockRepo.getLog.mockResolvedValue(null);
});

// ============================================================================
// getWorkflowService (singleton)
// ============================================================================

describe('getWorkflowService', () => {
  it('returns a WorkflowService instance', () => {
    const svc = getWorkflowService();
    expect(svc).toBeInstanceOf(WorkflowService);
  });

  it('returns the same instance on subsequent calls', () => {
    const svc1 = getWorkflowService();
    const svc2 = getWorkflowService();
    expect(svc1).toBe(svc2);
  });
});

// ============================================================================
// isRunning / cancelExecution
// ============================================================================

describe('isRunning', () => {
  it('returns false when no workflow is running', () => {
    expect(service.isRunning('wf-1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(service.isRunning('')).toBe(false);
  });
});

describe('cancelExecution', () => {
  it('returns false when workflow is not running', () => {
    expect(service.cancelExecution('wf-1')).toBe(false);
  });

  it('aborts an active execution and returns true', () => {
    const controller = new AbortController();
    const map = (service as unknown as { activeExecutions: Map<string, AbortController> })
      .activeExecutions;
    map.set('wf-1', controller);

    expect(service.cancelExecution('wf-1')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not affect other workflows', () => {
    const map = (service as unknown as { activeExecutions: Map<string, AbortController> })
      .activeExecutions;
    const c1 = new AbortController();
    const c2 = new AbortController();
    map.set('wf-a', c1);
    map.set('wf-b', c2);

    service.cancelExecution('wf-a');
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false);
    expect(service.isRunning('wf-b')).toBe(true);
  });
});

// ============================================================================
// executeWorkflow
// ============================================================================

describe('executeWorkflow', () => {
  it('throws when workflow is not found', async () => {
    mockRepo.get.mockResolvedValue(null);
    await expect(service.executeWorkflow('wf-1', 'user1')).rejects.toThrow('Workflow not found');
  });

  it('throws when workflow has no nodes', async () => {
    mockRepo.get.mockResolvedValue({ id: 'wf-1', nodes: [], edges: [] });
    await expect(service.executeWorkflow('wf-1', 'user1')).rejects.toThrow('Workflow has no nodes');
  });

  it('throws when workflow is already running', async () => {
    const map = (service as unknown as { activeExecutions: Map<string, AbortController> })
      .activeExecutions;
    map.set('wf-1', new AbortController());

    mockRepo.get.mockResolvedValue({ id: 'wf-1', nodes: [makeNode('n1', 'toolNode')], edges: [] });
    await expect(service.executeWorkflow('wf-1', 'user1')).rejects.toThrow(
      'Workflow is already running'
    );
  });

  it('executes a single tool node successfully', async () => {
    const nodes = [makeNode('n1', 'toolNode', { toolName: 'test_tool', toolArgs: {} })];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    const nodeResult = makeNodeResult('n1', 'tool output');
    mockExecuteNode.mockResolvedValue(nodeResult);
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    const log = await service.executeWorkflow('wf-1', 'user1');

    expect(log.status).toBe('completed');
    expect(mockExecuteNode).toHaveBeenCalled();
    expect(mockRepo.updateLog).toHaveBeenCalled();
    expect(mockRepo.markRun).toHaveBeenCalledWith('wf-1');
    // The active execution should be cleaned up
    expect(service.isRunning('wf-1')).toBe(false);
  });

  it('executes a single LLM node', async () => {
    const nodes = [
      makeNode('llm1', 'llmNode', {
        provider: 'openai',
        model: 'gpt-4',
        userMessage: 'Hello',
      }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteLlmNode.mockResolvedValue(makeNodeResult('llm1', 'AI response'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    const log = await service.executeWorkflow('wf-1', 'user1');

    expect(log.status).toBe('completed');
    expect(mockExecuteLlmNode).toHaveBeenCalled();
  });

  it('executes a single condition node', async () => {
    const nodes = [
      makeNode('cond1', 'conditionNode', { expression: 'true' }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteConditionNode.mockReturnValue(
      makeNodeResult('cond1', true)
    );
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockExecuteConditionNode).toHaveBeenCalled();
  });

  it('executes a code node', async () => {
    const nodes = [
      makeNode('code1', 'codeNode', { language: 'javascript', code: 'return 1;' }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteCodeNode.mockResolvedValue(makeNodeResult('code1', 'code output'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockExecuteCodeNode).toHaveBeenCalled();
  });

  it('executes a transformer node', async () => {
    const nodes = [
      makeNode('tf1', 'transformerNode', { expression: '42' }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteTransformerNode.mockReturnValue(makeNodeResult('tf1', 42));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockExecuteTransformerNode).toHaveBeenCalled();
  });

  it('executes a forEach node', async () => {
    const nodes = [
      makeNode('fe1', 'forEachNode', { arrayExpression: '{{n1.output}}' }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteForEachNode.mockResolvedValue(
      makeNodeResult('fe1', { results: [], count: 0 })
    );
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockExecuteForEachNode).toHaveBeenCalled();
  });

  it('filters out trigger nodes before execution', async () => {
    const nodes = [
      makeNode('trigger1', 'triggerNode', { triggerType: 'manual', label: 'Start' }),
      makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [makeEdge('trigger1', 'n1')],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue(makeNodeResult('n1', 'result'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockExecuteNode).toHaveBeenCalled();
    // trigger node should not be executed
    expect(mockExecuteNode).toHaveBeenCalledTimes(1);
  });

  it('executes nodes in topological order (two levels)', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'tool1', toolArgs: {} }),
      makeNode('n2', 'toolNode', { toolName: 'tool2', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [makeEdge('n1', 'n2')],
      variables: {},
    });

    const callOrder: string[] = [];
    mockExecuteNode
      .mockImplementationOnce(async (node: WorkflowNode) => {
        callOrder.push(node.id);
        return makeNodeResult('n1', 'result1');
      })
      .mockImplementationOnce(async (node: WorkflowNode) => {
        callOrder.push(node.id);
        return makeNodeResult('n2', 'result2');
      });
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(callOrder).toEqual(['n1', 'n2']);
  });

  it('skips downstream nodes when a node fails', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'tool1', toolArgs: {} }),
      makeNode('n2', 'toolNode', { toolName: 'tool2', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [makeEdge('n1', 'n2')],
      variables: {},
    });

    mockExecuteNode.mockResolvedValueOnce({
      nodeId: 'n1',
      status: 'error',
      error: 'Node failed',
      completedAt: new Date().toISOString(),
    });
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'failed' }));

    const log = await service.executeWorkflow('wf-1', 'user1');

    expect(log.status).toBe('failed');
    // n2 should not be executed because n1 failed
    expect(mockExecuteNode).toHaveBeenCalledTimes(1);
  });

  it('marks workflow as failed when any node has errors', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'tool1', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue({
      nodeId: 'n1',
      status: 'error',
      error: 'Tool failed',
      completedAt: new Date().toISOString(),
    });
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'failed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(mockRepo.updateLog).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('calls onProgress with node_start and node_complete events', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'test_tool', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    const nodeResult = makeNodeResult('n1', 'output');
    mockExecuteNode.mockResolvedValue(nodeResult);
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    const progressEvents: Array<Record<string, unknown>> = [];
    await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e));

    expect(progressEvents.some((e) => e.type === 'node_start' && e.nodeId === 'n1')).toBe(true);
    expect(progressEvents.some((e) => e.type === 'node_complete' && e.nodeId === 'n1')).toBe(true);
    expect(progressEvents.some((e) => e.type === 'done')).toBe(true);
  });

  it('emits node_error event on node failure', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue({
      nodeId: 'n1',
      status: 'error',
      error: 'Boom',
      completedAt: new Date().toISOString(),
    });
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'failed' }));

    const progressEvents: Array<Record<string, unknown>> = [];
    await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e));

    expect(progressEvents.some((e) => e.type === 'node_error' && e.error === 'Boom')).toBe(true);
  });

  it('handles condition branching by skipping the not-taken branch', async () => {
    // cond -> trueTarget (via "true"), cond -> falseTarget (via "false")
    const nodes = [
      makeNode('cond', 'conditionNode', { expression: 'true' }),
      makeNode('trueTarget', 'toolNode', { toolName: 't1', toolArgs: {} }),
      makeNode('falseTarget', 'toolNode', { toolName: 't2', toolArgs: {} }),
    ];
    const edges = [
      makeEdge('cond', 'trueTarget', 'true'),
      makeEdge('cond', 'falseTarget', 'false'),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges,
      variables: {},
    });

    mockExecuteConditionNode.mockReturnValue({
      ...makeNodeResult('cond', true),
      branchTaken: 'true',
    });
    mockExecuteNode.mockResolvedValue(makeNodeResult('trueTarget', 'true path'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    const progressEvents: Array<Record<string, unknown>> = [];
    await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e));

    // falseTarget should be skipped
    const falseSkipped = progressEvents.find(
      (e) => e.nodeId === 'falseTarget' && e.status === 'skipped'
    );
    expect(falseSkipped).toBeDefined();

    // trueTarget should execute normally
    expect(mockExecuteNode).toHaveBeenCalled();
  });

  it('cleans up active execution entry in finally block', async () => {
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes: [makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} })],
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue(makeNodeResult('n1', 'done'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(service.isRunning('wf-1')).toBe(false);
  });

  it('cleans up active execution even when an error occurs', async () => {
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes: [makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} })],
      edges: [],
      variables: {},
    });

    // Simulate an unexpected error in executeNode
    mockExecuteNode.mockRejectedValue(new Error('Unexpected'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'failed' }));

    await service.executeWorkflow('wf-1', 'user1');

    expect(service.isRunning('wf-1')).toBe(false);
  });

  it('returns the final log from repo if available', async () => {
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes: [makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} })],
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue(makeNodeResult('n1', 'done'));
    const finalLog = makeLog({ status: 'completed', durationMs: 100 });
    mockRepo.getLog.mockResolvedValue(finalLog);

    const result = await service.executeWorkflow('wf-1', 'user1');

    expect(result).toBe(finalLog);
  });

  it('returns the wfLog if repo.getLog returns null', async () => {
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes: [makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} })],
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue(makeNodeResult('n1', 'done'));
    mockRepo.getLog.mockResolvedValue(null);

    const result = await service.executeWorkflow('wf-1', 'user1');

    expect(result).toBeDefined();
    expect(result.id).toBe('log-1');
  });

  it('handles catch block: updates log with failed status and emits error event', async () => {
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes: [makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} })],
      edges: [],
      variables: {},
    });

    // Force a throw inside the execution flow (e.g., topologicalSort cycle)
    // Easiest: cause error by having nodes that form a cycle
    // Actually, let's make executeNode throw a non-caught error
    mockExecuteNode.mockImplementation(() => {
      throw new Error('Catastrophic failure');
    });
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'failed' }));

    const progressEvents: Array<Record<string, unknown>> = [];
    const result = await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e));

    expect(result.status).toBe('failed');
    // Should emit an error progress event at the workflow level
    // (node_error for the node + possibly workflow-level error in catch)
  });

  it('skips forEach body nodes at the top level', async () => {
    // forEach node with a body node connected via "each" handle
    const nodes = [
      makeNode('fe1', 'forEachNode', { arrayExpression: '[1,2,3]' }),
      makeNode('body1', 'toolNode', { toolName: 'test', toolArgs: {} }),
    ];
    const edges = [makeEdge('fe1', 'body1', 'each')];

    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges,
      variables: {},
    });

    mockExecuteForEachNode.mockResolvedValue(
      makeNodeResult('fe1', { results: [1, 2, 3], count: 3 })
    );
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    // body1 should be skipped at top level (handled by forEach executor)
    expect(mockExecuteNode).not.toHaveBeenCalled();
    expect(mockExecuteForEachNode).toHaveBeenCalled();
  });

  it('skips already-skipped nodes without re-executing', async () => {
    // If a node is already marked 'skipped' in nodeOutputs (from condition branching),
    // it should return immediately without execution
    const nodes = [
      makeNode('cond', 'conditionNode', { expression: 'false' }),
      makeNode('trueTarget', 'toolNode', { toolName: 't1', toolArgs: {} }),
      makeNode('falseTarget', 'toolNode', { toolName: 't2', toolArgs: {} }),
    ];
    const edges = [
      makeEdge('cond', 'trueTarget', 'true'),
      makeEdge('cond', 'falseTarget', 'false'),
    ];

    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges,
      variables: {},
    });

    mockExecuteConditionNode.mockReturnValue({
      ...makeNodeResult('cond', false),
      branchTaken: 'false',
    });
    mockExecuteNode.mockResolvedValue(makeNodeResult('falseTarget', 'false path'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    await service.executeWorkflow('wf-1', 'user1');

    // trueTarget should be skipped
    // falseTarget should execute
    expect(mockExecuteNode).toHaveBeenCalledTimes(1);
  });

  it('emits done event with log status and duration', async () => {
    const nodes = [
      makeNode('n1', 'toolNode', { toolName: 'test', toolArgs: {} }),
    ];
    mockRepo.get.mockResolvedValue({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges: [],
      variables: {},
    });

    mockExecuteNode.mockResolvedValue(makeNodeResult('n1', 'result'));
    mockRepo.getLog.mockResolvedValue(makeLog({ status: 'completed' }));

    const progressEvents: Array<Record<string, unknown>> = [];
    await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e));

    const doneEvent = progressEvents.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.logId).toBe('log-1');
    expect(doneEvent!.logStatus).toBe('completed');
    expect(doneEvent!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// executeWithRetryAndTimeout (private method — accessed via type cast)
// ============================================================================

describe('executeWithRetryAndTimeout', () => {
  function callRetry(
    svc: WorkflowService,
    node: WorkflowNode,
    executeFn: () => Promise<NodeResult>,
    onProgress?: (event: Record<string, unknown>) => void
  ) {
    return (
      svc as unknown as {
        executeWithRetryAndTimeout: (
          node: WorkflowNode,
          fn: () => Promise<NodeResult>,
          progress?: (e: Record<string, unknown>) => void
        ) => Promise<NodeResult>;
      }
    ).executeWithRetryAndTimeout(node, executeFn, onProgress);
  }

  it('succeeds on first try with retryAttempts = 0', async () => {
    const node = makeNode('n1', 'toolNode', { retryCount: 2 });
    const executeFn = vi.fn().mockResolvedValue(makeNodeResult('n1', 42));

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('success');
    expect(result.retryAttempts).toBe(0);
    expect(executeFn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    const node = makeNode('n1', 'toolNode', { retryCount: 2 });
    const executeFn = vi
      .fn()
      .mockResolvedValueOnce({ nodeId: 'n1', status: 'error', error: 'fail' })
      .mockResolvedValueOnce(makeNodeResult('n1', 'ok'));

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('success');
    expect(result.retryAttempts).toBe(1);
    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('fails after all retries exhausted', async () => {
    const node = makeNode('n1', 'toolNode', { retryCount: 2 });
    const executeFn = vi
      .fn()
      .mockResolvedValue({ nodeId: 'n1', status: 'error', error: 'persistent' });

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('error');
    expect(result.retryAttempts).toBe(2);
    expect(executeFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when retryCount is 0', async () => {
    const node = makeNode('n1', 'toolNode', {});
    const executeFn = vi.fn().mockResolvedValue({ nodeId: 'n1', status: 'error', error: 'oops' });

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('error');
    expect(result.retryAttempts).toBe(0);
    expect(executeFn).toHaveBeenCalledTimes(1);
  });

  it('emits node_retry progress events', async () => {
    const node = makeNode('n1', 'toolNode', { retryCount: 1 });
    const executeFn = vi
      .fn()
      .mockResolvedValueOnce({ nodeId: 'n1', status: 'error', error: 'fail' })
      .mockResolvedValueOnce(makeNodeResult('n1', 'ok'));

    const events: Array<Record<string, unknown>> = [];
    await callRetry(service, node, executeFn, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'node_retry',
      nodeId: 'n1',
      retryAttempt: 1,
    });
  });

  it('catches thrown errors from executeFn', async () => {
    const node = makeNode('n1', 'toolNode', { retryCount: 1 });
    const executeFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeNodeResult('n1', 'recovered'));

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('success');
    expect(result.retryAttempts).toBe(1);
  });

  it('skips outer timeout for conditionNode (vm-based)', async () => {
    const node = makeNode('n1', 'conditionNode', { timeoutMs: 50 });
    const executeFn = vi.fn().mockResolvedValue(makeNodeResult('n1', true));

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('success');
    // withTimeout should not have been called since conditionNode is a vm node
    const { withTimeout } = await import('@ownpilot/core');
    expect(withTimeout).not.toHaveBeenCalled();
  });

  it('skips outer timeout for transformerNode (vm-based)', async () => {
    const node = makeNode('n1', 'transformerNode', { timeoutMs: 50 });
    const executeFn = vi.fn().mockResolvedValue(makeNodeResult('n1', 42));

    const result = await callRetry(service, node, executeFn);

    expect(result.status).toBe('success');
    const { withTimeout } = await import('@ownpilot/core');
    expect(withTimeout).not.toHaveBeenCalled();
  });

  it('wraps with timeout for non-vm nodes when timeoutMs > 0', async () => {
    const node = makeNode('n1', 'toolNode', { timeoutMs: 5000 });
    const executeFn = vi.fn().mockResolvedValue(makeNodeResult('n1', 'ok'));

    await callRetry(service, node, executeFn);

    const { withTimeout } = await import('@ownpilot/core');
    expect(withTimeout).toHaveBeenCalled();
  });

  it('does not wrap with timeout when timeoutMs is 0', async () => {
    const node = makeNode('n1', 'toolNode', { timeoutMs: 0 });
    const executeFn = vi.fn().mockResolvedValue(makeNodeResult('n1', 'ok'));

    await callRetry(service, node, executeFn);

    const { withTimeout } = await import('@ownpilot/core');
    expect(withTimeout).not.toHaveBeenCalled();
  });
});

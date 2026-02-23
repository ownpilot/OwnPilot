/**
 * Tests for workflow-service.ts — pure functions and simple class methods.
 *
 * Covers:
 * - topologicalSort: Kahn's algorithm, parallel levels, cycle detection
 * - resolveTemplates: template interpolation, type preservation, nested access
 * - WorkflowService: cancelExecution, isRunning (lightweight map operations)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must come before dynamic import
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/workflows.js', () => ({
  createWorkflowsRepository: vi.fn(),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: () => ({
        execute: vi.fn(async () => ({ content: '{}', isError: false })),
        has: vi.fn().mockReturnValue(false),
        getDefinitions: vi.fn().mockReturnValue([]),
        getDefinition: vi.fn(),
      }),
    })),
  };
});

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback
  ),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import under test (dynamic to respect mocks)
// ---------------------------------------------------------------------------

const { topologicalSort, resolveTemplates, WorkflowService } =
  await import('./workflow-service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type = 'toolNode',
  data: Record<string, unknown> = {}
): { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> } {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string
): { id: string; source: string; target: string; sourceHandle?: string } {
  return { id: `${source}-${target}`, source, target, sourceHandle };
}

// ============================================================================
// topologicalSort
// ============================================================================

describe('topologicalSort', () => {
  it('returns single level for a single node with no edges', () => {
    const levels = topologicalSort([makeNode('A')], []);
    expect(levels).toEqual([['A']]);
  });

  it('returns empty array for empty nodes', () => {
    const levels = topologicalSort([], []);
    expect(levels).toEqual([]);
  });

  it('sorts a linear chain A→B→C into sequential levels', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toEqual([['A'], ['B'], ['C']]);
  });

  it('places parallel independent nodes on the same level', () => {
    // A→C, B→C
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'C'), makeEdge('B', 'C')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toHaveLength(2);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('B');
    expect(levels[1]).toEqual(['C']);
  });

  it('handles diamond shape: A→B, A→C, B→D, C→D', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('B', 'D'), makeEdge('C', 'D')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toHaveLength(2);
    expect(levels[1]).toContain('B');
    expect(levels[1]).toContain('C');
    expect(levels[2]).toEqual(['D']);
  });

  it('handles disconnected components: A→B, C→D', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [makeEdge('A', 'B'), makeEdge('C', 'D')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toHaveLength(2);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('C');
    expect(levels[1]).toHaveLength(2);
    expect(levels[1]).toContain('B');
    expect(levels[1]).toContain('D');
  });

  it('throws on cycle: A→B→C→A', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('throws on self-loop: A→A', () => {
    const nodes = [makeNode('A')];
    const edges = [makeEdge('A', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('ignores edges referencing non-existent nodes', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('X', 'Y')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toEqual([['A'], ['B']]);
  });

  it('ignores edges where only source exists', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'Z')];
    const levels = topologicalSort(nodes, edges);

    // A and B both have in-degree 0 (edge to Z is ignored)
    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(2);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('B');
  });

  it('ignores edges where only target exists', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('Z', 'A')];
    const levels = topologicalSort(nodes, edges);

    // Both A and B have in-degree 0 (edge from Z is ignored)
    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(2);
  });

  it('handles a wider DAG: multiple roots feeding multiple sinks', () => {
    // A→D, B→D, B→E, C→E
    const nodes = 'ABCDE'.split('').map((id) => makeNode(id));
    const edges = [makeEdge('A', 'D'), makeEdge('B', 'D'), makeEdge('B', 'E'), makeEdge('C', 'E')];
    const levels = topologicalSort(nodes, edges);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toHaveLength(3);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('B');
    expect(levels[0]).toContain('C');
    expect(levels[1]).toHaveLength(2);
    expect(levels[1]).toContain('D');
    expect(levels[1]).toContain('E');
  });

  it('throws on two-node cycle: A↔B', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('handles long linear chain', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const nodes = ids.map((id) => makeNode(id));
    const edges = ids.slice(0, -1).map((id, i) => makeEdge(id, ids[i + 1]!));
    const levels = topologicalSort(nodes, edges);

    expect(levels).toHaveLength(10);
    levels.forEach((level, i) => {
      expect(level).toEqual([ids[i]]);
    });
  });

  it('handles duplicate edges gracefully', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'B')];
    // Duplicate edge increments in-degree to 2, but both decrements happen in same pass
    // Result: A in first level, B in second level
    const levels = topologicalSort(nodes, edges);
    expect(levels).toEqual([['A'], ['B']]);
  });
});

// ============================================================================
// resolveTemplates
// ============================================================================

describe('resolveTemplates', () => {
  const makeResult = (output: unknown): { nodeId: string; status: 'success'; output: unknown } => ({
    nodeId: 'test',
    status: 'success',
    output,
  });

  describe('simple string replacement', () => {
    it('replaces {{nodeId.output}} with the node output', () => {
      const nodeOutputs = { node1: makeResult('hello') };
      const result = resolveTemplates({ msg: '{{node1.output}}' }, nodeOutputs, {});
      expect(result.msg).toBe('hello');
    });

    it('replaces {{nodeId}} shorthand (no .output) with node output', () => {
      const nodeOutputs = { node1: makeResult('world') };
      const result = resolveTemplates({ msg: '{{node1}}' }, nodeOutputs, {});
      // Full match → resolveTemplatePath → parts.length === 1 → nodeResult.output
      expect(result.msg).toBe('world');
    });
  });

  describe('nested field access', () => {
    it('accesses nested object fields: {{node1.output.name}}', () => {
      const nodeOutputs = { node1: makeResult({ name: 'John', age: 30 }) };
      const result = resolveTemplates({ val: '{{node1.output.name}}' }, nodeOutputs, {});
      expect(result.val).toBe('John');
    });

    it('accesses deeply nested fields: {{node1.output.user.address.city}}', () => {
      const nodeOutputs = {
        node1: makeResult({ user: { address: { city: 'NYC' } } }),
      };
      const result = resolveTemplates(
        { val: '{{node1.output.user.address.city}}' },
        nodeOutputs,
        {}
      );
      expect(result.val).toBe('NYC');
    });

    it('supports shorthand nested access: {{node1.name}} (without .output)', () => {
      const nodeOutputs = { node1: makeResult({ name: 'Alice' }) };
      const result = resolveTemplates({ val: '{{node1.name}}' }, nodeOutputs, {});
      expect(result.val).toBe('Alice');
    });
  });

  describe('variable access', () => {
    it('resolves {{variables.key}}', () => {
      const result = resolveTemplates({ env: '{{variables.env}}' }, {}, { env: 'production' });
      expect(result.env).toBe('production');
    });

    it('resolves nested variables: {{variables.config.region}}', () => {
      const result = resolveTemplates(
        { r: '{{variables.config.region}}' },
        {},
        { config: { region: 'us-east-1' } }
      );
      expect(result.r).toBe('us-east-1');
    });

    it('resolves direct variable fallback: {{env}}', () => {
      const result = resolveTemplates({ val: '{{env}}' }, {}, { env: 'staging' });
      expect(result.val).toBe('staging');
    });

    it('resolves direct variable with nested access: {{config.region}}', () => {
      const result = resolveTemplates(
        { r: '{{config.region}}' },
        {},
        { config: { region: 'eu-west-1' } }
      );
      expect(result.r).toBe('eu-west-1');
    });

    it('resolves item variable alias (ForEach pattern)', () => {
      const result = resolveTemplates({ val: '{{item}}' }, {}, { item: 'task-42' });
      expect(result.val).toBe('task-42');
    });
  });

  describe('type preservation', () => {
    it('preserves object type when entire template is a single reference', () => {
      const obj = { a: 1, b: 2 };
      const nodeOutputs = { node1: makeResult(obj) };
      const result = resolveTemplates({ data: '{{node1.output}}' }, nodeOutputs, {});
      expect(result.data).toEqual(obj);
      expect(typeof result.data).toBe('object');
    });

    it('preserves number type from full template', () => {
      const nodeOutputs = { node1: makeResult(42) };
      const result = resolveTemplates({ count: '{{node1.output}}' }, nodeOutputs, {});
      expect(result.count).toBe(42);
    });

    it('preserves boolean type from full template', () => {
      const nodeOutputs = { node1: makeResult(true) };
      const result = resolveTemplates({ flag: '{{node1.output}}' }, nodeOutputs, {});
      expect(result.flag).toBe(true);
    });

    it('preserves array type from full template', () => {
      const arr = [1, 2, 3];
      const nodeOutputs = { node1: makeResult(arr) };
      const result = resolveTemplates({ list: '{{node1.output}}' }, nodeOutputs, {});
      expect(result.list).toEqual(arr);
    });

    it('preserves null type from full template', () => {
      const nodeOutputs = { node1: makeResult(null) };
      const result = resolveTemplates({ val: '{{node1.output}}' }, nodeOutputs, {});
      // Full template with parts.length === 2 returns nodeResult.output directly → null
      expect(result.val).toBeNull();
    });
  });

  describe('inline interpolation (returns string)', () => {
    it('interpolates into surrounding text', () => {
      const nodeOutputs = { node1: makeResult('world') };
      const result = resolveTemplates({ greeting: 'Hello {{node1.output}}!' }, nodeOutputs, {});
      expect(result.greeting).toBe('Hello world!');
    });

    it('stringifies objects in inline interpolation', () => {
      const nodeOutputs = { node1: makeResult({ key: 'val' }) };
      const result = resolveTemplates({ msg: 'Data: {{node1.output}}' }, nodeOutputs, {});
      expect(result.msg).toBe('Data: {"key":"val"}');
    });

    it('handles multiple templates in one string', () => {
      const nodeOutputs = {
        a: makeResult('Hello'),
        b: makeResult('World'),
      };
      const result = resolveTemplates({ msg: '{{a.output}} {{b.output}}!' }, nodeOutputs, {});
      expect(result.msg).toBe('Hello World!');
    });

    it('replaces missing node reference with empty string in inline', () => {
      const result = resolveTemplates({ msg: 'Result: {{missing.output}} done' }, {}, {});
      expect(result.msg).toBe('Result:  done');
    });
  });

  describe('missing references', () => {
    it('returns undefined for full template referencing missing node', () => {
      const result = resolveTemplates({ val: '{{nonexistent.output}}' }, {}, {});
      expect(result.val).toBeUndefined();
    });

    it('returns undefined for full template referencing missing field', () => {
      const nodeOutputs = { node1: makeResult({ name: 'John' }) };
      const result = resolveTemplates({ val: '{{node1.output.email}}' }, nodeOutputs, {});
      expect(result.val).toBeUndefined();
    });

    it('returns undefined for full template referencing missing variable', () => {
      const result = resolveTemplates({ val: '{{variables.missing}}' }, {}, {});
      expect(result.val).toBeUndefined();
    });
  });

  describe('auto-parse JSON strings', () => {
    it('auto-parses JSON string output for nested field access', () => {
      const nodeOutputs = { node1: makeResult('{"name":"John","age":30}') };
      const result = resolveTemplates({ val: '{{node1.output.name}}' }, nodeOutputs, {});
      expect(result.val).toBe('John');
    });

    it('auto-parses JSON array string for nested access', () => {
      const nodeOutputs = { node1: makeResult('[1,2,3]') };
      const result = resolveTemplates({ val: '{{node1.output.1}}' }, nodeOutputs, {});
      expect(result.val).toBe(2);
    });

    it('returns undefined for non-JSON string with nested access', () => {
      const nodeOutputs = { node1: makeResult('plain text') };
      const result = resolveTemplates({ val: '{{node1.output.field}}' }, nodeOutputs, {});
      expect(result.val).toBeUndefined();
    });

    it('auto-parses final JSON string value as object', () => {
      // When the final resolved value is a JSON string, getNestedValue parses it
      const nodeOutputs = {
        node1: makeResult({ data: '{"inner":"value"}' }),
      };
      const result = resolveTemplates({ val: '{{node1.output.data}}' }, nodeOutputs, {});
      expect(result.val).toEqual({ inner: 'value' });
    });
  });

  describe('recursive resolution (arrays and nested objects)', () => {
    it('resolves templates in array items', () => {
      const nodeOutputs = { n1: makeResult('alpha'), n2: makeResult('beta') };
      const result = resolveTemplates(
        { items: ['{{n1.output}}', '{{n2.output}}', 'static'] as unknown },
        nodeOutputs,
        {}
      );
      expect(result.items).toEqual(['alpha', 'beta', 'static']);
    });

    it('resolves templates in nested object values', () => {
      const nodeOutputs = { n1: makeResult('deep-value') };
      const result = resolveTemplates({ outer: { inner: '{{n1.output}}' } }, nodeOutputs, {});
      expect(result.outer).toEqual({ inner: 'deep-value' });
    });

    it('resolves templates in deeply nested structure', () => {
      const nodeOutputs = { n1: makeResult(42) };
      const result = resolveTemplates({ a: { b: { c: '{{n1.output}}' } } }, nodeOutputs, {});
      expect(result.a as Record<string, unknown>).toEqual({ b: { c: 42 } });
    });
  });

  describe('non-string non-object passthrough', () => {
    it('passes through numbers unchanged', () => {
      const result = resolveTemplates({ count: 42 as unknown }, {}, {});
      expect(result.count).toBe(42);
    });

    it('passes through booleans unchanged', () => {
      const result = resolveTemplates({ flag: true as unknown }, {}, {});
      expect(result.flag).toBe(true);
    });

    it('passes through null unchanged', () => {
      const result = resolveTemplates({ val: null as unknown }, {}, {});
      expect(result.val).toBeNull();
    });

    it('passes through undefined unchanged', () => {
      const result = resolveTemplates({ val: undefined as unknown }, {}, {});
      expect(result.val).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty args object', () => {
      const result = resolveTemplates({}, {}, {});
      expect(result).toEqual({});
    });

    it('handles string with no templates', () => {
      const result = resolveTemplates({ msg: 'no templates here' }, {}, {});
      expect(result.msg).toBe('no templates here');
    });

    it('handles template with whitespace: {{ node1.output }}', () => {
      const nodeOutputs = { node1: makeResult('trimmed') };
      const result = resolveTemplates({ val: '{{ node1.output }}' }, nodeOutputs, {});
      expect(result.val).toBe('trimmed');
    });

    it('node output takes priority over variable fallback', () => {
      const nodeOutputs = { env: makeResult('from-node') };
      const result = resolveTemplates({ val: '{{env}}' }, nodeOutputs, { env: 'from-variable' });
      // resolveTemplatePath is tried first — parts.length === 1 → nodeResult.output
      expect(result.val).toBe('from-node');
    });

    it('numbers stringified with JSON.stringify in inline interpolation', () => {
      const nodeOutputs = { node1: makeResult(42) };
      const result = resolveTemplates({ msg: 'Count: {{node1.output}} items' }, nodeOutputs, {});
      expect(result.msg).toBe('Count: 42 items');
    });
  });
});

// ============================================================================
// WorkflowService — cancelExecution & isRunning
// ============================================================================

describe('WorkflowService', () => {
  let service: InstanceType<typeof WorkflowService>;

  beforeEach(() => {
    service = new WorkflowService();
  });

  describe('isRunning', () => {
    it('returns false for a workflow that is not running', () => {
      expect(service.isRunning('wf-1')).toBe(false);
    });

    it('returns false for empty string id', () => {
      expect(service.isRunning('')).toBe(false);
    });
  });

  describe('cancelExecution', () => {
    it('returns false when no execution exists for the workflow', () => {
      expect(service.cancelExecution('wf-nonexistent')).toBe(false);
    });

    it('returns false for empty string id', () => {
      expect(service.cancelExecution('')).toBe(false);
    });
  });

  describe('isRunning + cancelExecution integration via activeExecutions', () => {
    it('reflects state after manual map manipulation', () => {
      // Access private map to simulate an active execution
      const controller = new AbortController();
      (
        service as unknown as { activeExecutions: Map<string, AbortController> }
      ).activeExecutions.set('wf-test', controller);

      expect(service.isRunning('wf-test')).toBe(true);
      expect(service.isRunning('wf-other')).toBe(false);

      // Cancel it
      const cancelled = service.cancelExecution('wf-test');
      expect(cancelled).toBe(true);
      expect(controller.signal.aborted).toBe(true);

      // After cancel, the map still has the entry (only executeWorkflow's finally block deletes it)
      expect(service.isRunning('wf-test')).toBe(true);
    });

    it('cancelling a second time still returns true (controller is still in map)', () => {
      const controller = new AbortController();
      (
        service as unknown as { activeExecutions: Map<string, AbortController> }
      ).activeExecutions.set('wf-x', controller);

      expect(service.cancelExecution('wf-x')).toBe(true);
      expect(service.cancelExecution('wf-x')).toBe(true);
    });

    it('does not affect other workflows when cancelling one', () => {
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

  // ========================================================================
  // executeWithRetryAndTimeout
  // ========================================================================

  describe('executeWithRetryAndTimeout', () => {
    function callRetry(
      svc: InstanceType<typeof WorkflowService>,
      node: ReturnType<typeof makeNode>,
      executeFn: () => Promise<{
        nodeId: string;
        status: string;
        error?: string;
        [k: string]: unknown;
      }>,
      onProgress?: (e: { type: string; nodeId?: string; retryAttempt?: number }) => void
    ) {
      return (
        svc as unknown as {
          executeWithRetryAndTimeout: (
            node: unknown,
            fn: () => Promise<unknown>,
            progress?: (e: unknown) => void
          ) => Promise<{ nodeId: string; status: string; error?: string; retryAttempts?: number }>;
        }
      ).executeWithRetryAndTimeout(node, executeFn, onProgress);
    }

    it('succeeds on first try with retryAttempts = 0', async () => {
      const node = makeNode('n1', 'toolNode', { retryCount: 2 });
      const executeFn = vi.fn().mockResolvedValue({ nodeId: 'n1', status: 'success', output: 42 });

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
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'success', output: 'ok' });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('success');
      expect(result.retryAttempts).toBe(1);
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('fails after all retry attempts exhausted', async () => {
      const node = makeNode('n1', 'toolNode', { retryCount: 2 });
      const executeFn = vi
        .fn()
        .mockResolvedValue({ nodeId: 'n1', status: 'error', error: 'persistent failure' });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('error');
      expect(result.retryAttempts).toBe(2);
      expect(result.error).toBe('persistent failure');
      expect(executeFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('does not retry when retryCount is 0 (default)', async () => {
      const node = makeNode('n1', 'toolNode', {});
      const executeFn = vi.fn().mockResolvedValue({ nodeId: 'n1', status: 'error', error: 'oops' });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('error');
      expect(result.retryAttempts).toBe(0);
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('emits node_retry progress events on retries', async () => {
      const node = makeNode('n1', 'toolNode', { retryCount: 2 });
      const executeFn = vi
        .fn()
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'error', error: 'fail1' })
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'error', error: 'fail2' })
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'success', output: 'ok' });

      const progressEvents: Array<{ type: string; nodeId?: string; retryAttempt?: number }> = [];
      await callRetry(service, node, executeFn, (e) => progressEvents.push(e));

      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0]).toEqual({ type: 'node_retry', nodeId: 'n1', retryAttempt: 1 });
      expect(progressEvents[1]).toEqual({ type: 'node_retry', nodeId: 'n1', retryAttempt: 2 });
    });

    it('handles thrown errors from executeFn', async () => {
      const node = makeNode('n1', 'toolNode', { retryCount: 1 });
      const executeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'success', output: 'recovered' });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('success');
      expect(result.retryAttempts).toBe(1);
    });

    it('handles timeout wrapping for async nodes', async () => {
      const node = makeNode('n1', 'toolNode', { timeoutMs: 50 });
      const executeFn = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ nodeId: 'n1', status: 'success' }), 200)
            )
        );

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Timeout');
    });

    it('skips outer timeout for conditionNode (vm-based)', async () => {
      const node = makeNode('n1', 'conditionNode', { timeoutMs: 50 });
      const executeFn = vi
        .fn()
        .mockResolvedValue({ nodeId: 'n1', status: 'success', output: true });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('success');
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('combines retry + timeout: retries after timeout', async () => {
      const node = makeNode('n1', 'toolNode', { retryCount: 1, timeoutMs: 50 });
      const executeFn = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ nodeId: 'n1', status: 'success' }), 200)
            )
        )
        .mockResolvedValueOnce({ nodeId: 'n1', status: 'success', output: 'fast' });

      const result = await callRetry(service, node, executeFn);

      expect(result.status).toBe('success');
      expect(result.retryAttempts).toBe(1);
    });
  });
});

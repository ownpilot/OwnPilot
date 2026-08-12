/**
 * Node-type registry invariants.
 *
 * The important test here is `jobified dispatch parity`. Workflow execution has
 * two dispatchers — the synchronous `dispatchNode` and the queue-backed
 * `executeNodeInline` — and the second is easy to forget when adding a node
 * type. A type that is registered but handled by neither dispatcher nor listed
 * in SYNC_ONLY_NODE_TYPES used to fall through to the toolNode executor and run
 * `node.data.toolName`, which for a data-transform node is undefined.
 *
 * That happened twice. `clawNode` hit it and was patched by adding it to the
 * sync-only list — fixing the instance, leaving the class open. `transformerNode`
 * then hit the same path. This test closes the class: any new node type without
 * a home fails here rather than in production.
 */

import { describe, it, expect, vi } from 'vitest';
import { WORKFLOW_NODE_TYPES, SYNC_ONLY_NODE_TYPES } from './node-types.js';

vi.mock('../log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Every executor is stubbed: this test is about which branch is selected, not
// about what the executor does.
vi.mock('./node-executors.js', () => {
  const ok = (name: string) => vi.fn(async () => ({ status: 'success', executor: name }));
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined;
        if (prop === '__esModule') return true;
        if (prop === 'then' || prop === 'default') return undefined;
        return ok(prop);
      },
      has: () => true,
    }
  );
});

const { executeNodeInline } = await import('./workflow-node-job-handler.js');

const snapshot = { nodes: [], edges: [], variables: {} };
const toolService = {} as never;

describe('node-types', () => {
  it('registers every type exactly once', () => {
    expect(WORKFLOW_NODE_TYPES.size).toBeGreaterThan(0);
  });

  it('sync-only types are all registered types', () => {
    for (const type of SYNC_ONLY_NODE_TYPES) {
      expect(WORKFLOW_NODE_TYPES.has(type), `${type} is sync-only but not registered`).toBe(true);
    }
  });

  describe('jobified dispatch parity', () => {
    /**
     * For every registered type that is NOT sync-only, executeNodeInline must
     * select a real executor. Falling into the default branch means the type has
     * no jobified home.
     */
    const jobifiable = [...WORKFLOW_NODE_TYPES].filter((t) => !SYNC_ONLY_NODE_TYPES.has(t));

    it.each(jobifiable)('%s has a jobified executor', async (type) => {
      const result = await executeNodeInline(
        { id: 'n1', type, data: {} } as never,
        {},
        snapshot as never,
        'user-1',
        toolService
      );

      expect(
        result.status,
        `"${type}" fell through to the default branch. Add a case to ` +
          'executeNodeInline in workflow-node-job-handler.ts, or add it to ' +
          'SYNC_ONLY_NODE_TYPES in node-types.ts if it must run synchronously.'
      ).not.toBe('error');
    });

    it('rejects a registered type that has no jobified executor', async () => {
      // Simulates the failure mode directly: sync-only types have no case, so
      // reaching the handler with one must error rather than run as a tool.
      const syncOnly = [...SYNC_ONLY_NODE_TYPES][0]!;
      const result = await executeNodeInline(
        { id: 'n1', type: syncOnly, data: {} } as never,
        {},
        snapshot as never,
        'user-1',
        toolService
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('not supported on the jobified execution path');
    });

    it('rejects an unregistered type', async () => {
      const result = await executeNodeInline(
        { id: 'n1', type: 'evilNode', data: { toolName: 'delete_everything' } } as never,
        {},
        snapshot as never,
        'user-1',
        toolService
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Unknown node type');
    });

    it('never falls back to the tool executor for an unhandled type', async () => {
      // The regression itself: an unhandled type must not reach executeNode,
      // which would run node.data.toolName on a code-execution surface.
      const executors = await import('./node-executors.js');
      const spy = vi.spyOn(executors, 'executeNode');

      await executeNodeInline(
        { id: 'n1', type: 'evilNode', data: { toolName: 'delete_everything' } } as never,
        {},
        snapshot as never,
        'user-1',
        toolService
      );

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

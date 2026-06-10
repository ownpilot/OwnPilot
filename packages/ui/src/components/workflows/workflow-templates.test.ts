/**
 * Template catalog consistency tests.
 *
 * Every shipped template must convert cleanly through
 * convertDefinitionToReactFlow into node types that are registered in the
 * canvas nodeTypes registry — no skipped nodes, no dangling edges. This
 * guards against drift between the template catalog, the converter, and
 * the ReactFlow registry.
 */

import { describe, expect, it } from 'vitest';

import { TEMPLATES } from './workflow-templates';
import { convertDefinitionToReactFlow } from './WorkflowCopilotPanel';
import type { WorkflowDefinition } from './workflowDefinition';
import { nodeTypes } from '../../pages/workflows/shared';

const REGISTERED_TYPES = new Set(Object.keys(nodeTypes));

describe('workflow template catalog', () => {
  it('has unique template ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    'template "%s" converts cleanly to registered canvas nodes',
    (_id, template) => {
      const { nodes, edges, skippedNodes } = convertDefinitionToReactFlow(
        template.definition as unknown as WorkflowDefinition
      );

      // No node may be dropped as unknown
      expect(skippedNodes).toEqual([]);
      expect(nodes.length).toBe(template.definition.nodes.length);

      // Every converted node type must be registered in the canvas registry
      for (const node of nodes) {
        expect(REGISTERED_TYPES.has(node.type as string)).toBe(true);
      }

      // Every edge must reference existing nodes
      const ids = new Set(nodes.map((n) => n.id));
      expect(edges.length).toBe(template.definition.edges.length);
      for (const edge of edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      }
    }
  );

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    'template "%s" nodeCount matches its definition',
    (_id, template) => {
      expect(template.nodeCount).toBe(template.definition.nodes.length);
    }
  );
});

describe('convertDefinitionToReactFlow', () => {
  it('converts claw definitions to clawNode canvas nodes', () => {
    const { nodes, skippedNodes } = convertDefinitionToReactFlow({
      name: 'Claw Test',
      nodes: [
        {
          id: 'node_1',
          type: 'claw',
          label: 'Research Agent',
          name: 'Market Research',
          mission: 'Research {{node_0.output.topic}}',
          mode: 'single-shot',
          sandbox: 'auto',
          waitForCompletion: true,
          timeoutMs: 600000,
        },
      ],
      edges: [],
    } as unknown as WorkflowDefinition);

    expect(skippedNodes).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe('clawNode');
    expect(nodes[0]!.data).toMatchObject({
      label: 'Research Agent',
      name: 'Market Research',
      mission: 'Research {{node_0.output.topic}}',
      mode: 'single-shot',
      sandbox: 'auto',
      waitForCompletion: true,
      timeoutMs: 600000,
    });
  });

  it('skips unknown node types instead of converting them to broken tool nodes', () => {
    const { nodes, edges, skippedNodes } = convertDefinitionToReactFlow({
      name: 'Mixed',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Start' },
        { id: 'node_2', type: 'quantum', label: 'Bogus' },
        { id: 'node_3', type: 'notification', label: 'Notify', message: 'hi' },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_1', target: 'node_3' },
      ],
    } as unknown as WorkflowDefinition);

    expect(skippedNodes).toEqual(['node_2 (quantum)']);
    expect(nodes.map((n) => n.id)).toEqual(['node_1', 'node_3']);
    // Edges touching the skipped node are dropped too
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'node_1', target: 'node_3' });
  });

  it('still treats nodes with a tool field (and no type) as tool nodes', () => {
    const { nodes, skippedNodes } = convertDefinitionToReactFlow({
      name: 'Tools',
      nodes: [{ id: 'node_1', tool: 'core.list_goals', label: 'List Goals' }],
      edges: [],
    } as unknown as WorkflowDefinition);

    expect(skippedNodes).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe('toolNode');
    expect(nodes[0]!.data.toolName).toBe('core.list_goals');
  });
});

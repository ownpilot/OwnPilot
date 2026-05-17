import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { reconcileSwitchCaseEdges } from './useWorkflowCanvas';

function edge(id: string, sourceHandle: string, source = 'switch'): Edge {
  return {
    id,
    source,
    target: `${id}-target`,
    sourceHandle,
  };
}

describe('reconcileSwitchCaseEdges', () => {
  it('renames switch case edges when a case label changes in place', () => {
    const edges = [edge('a', 'case_a'), edge('b', 'case_b')];

    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }, { label: 'case_b' }],
      [{ label: 'case_alpha' }, { label: 'case_b' }]
    );

    expect(result.map((e) => e.sourceHandle)).toEqual(['case_alpha', 'case_b']);
  });

  it('does not retarget shifted edges when a switch case is deleted', () => {
    const edges = [edge('a', 'case_a'), edge('b', 'case_b'), edge('c', 'case_c')];

    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }, { label: 'case_b' }, { label: 'case_c' }],
      [{ label: 'case_b' }, { label: 'case_c' }]
    );

    expect(result.map((e) => e.sourceHandle)).toEqual(['case_b', 'case_c']);
  });

  it('keeps default and unrelated edges when cases change', () => {
    const edges = [edge('default-edge', 'default'), edge('other', 'case_a', 'other-node')];

    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }],
      [{ label: 'case_b' }]
    );

    expect(result).toEqual(edges);
  });
});

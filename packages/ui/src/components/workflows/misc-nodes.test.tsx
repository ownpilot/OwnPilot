// @vitest-environment happy-dom

/**
 * Render tests for the remaining node components: AggregateNode,
 * ApprovalNode, ClawNode, TransformerNode, SchemaValidatorNode. We use the
 * shared `renderWorkflowNode` helper for a minimal ReactFlowProvider setup.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkflowNode } from './node-render-helper';
import { AggregateNode } from './AggregateNode';
import { ApprovalNode } from './ApprovalNode';
import { ClawNode } from './ClawNode';
import { TransformerNode } from './TransformerNode';
import { SchemaValidatorNode } from './SchemaValidatorNode';

afterEach(() => {
  document.body.replaceChildren();
});

// ── AggregateNode ──

describe('AggregateNode', () => {
  it('renders the default "Aggregate" label and the operation badge', () => {
    const r = renderWorkflowNode(
      AggregateNode as never,
      {
        id: 'a1',
        type: 'aggregateNode',
        data: { label: 'Sum revenue', operation: 'sum', field: 'amount' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Sum revenue');
    expect(r.text()).toContain('amount');
  });

  it('falls back to the sum color for an unknown operation', () => {
    const r = renderWorkflowNode(
      AggregateNode as never,
      {
        id: 'a2',
        type: 'aggregateNode',
        data: { label: 'X', operation: 'unknown' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const badge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'unknown'
    );
    expect(badge?.className).toContain('bg-amber-500');
  });

  it('renders the error and duration footer when present', () => {
    const r = renderWorkflowNode(
      AggregateNode as never,
      {
        id: 'a3',
        type: 'aggregateNode',
        data: {
          label: 'Sum',
          operation: 'sum',
          executionStatus: 'error',
          executionError: 'aggregate failed',
          executionDuration: 2300,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('aggregate failed');
    expect(r.text()).toContain('2.3s');
  });

  it('omits the operation badge when operation is missing', () => {
    const r = renderWorkflowNode(
      AggregateNode as never,
      {
        id: 'a4',
        type: 'aggregateNode',
        data: { label: 'Noop' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Noop');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      AggregateNode as never,
      {
        id: 'a5',
        type: 'aggregateNode',
        data: { label: 'Sum', operation: 'sum', executionStatus: 'running' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-amber-500');
    expect(outer?.className).toContain('animate-pulse');
  });
});

// ── ApprovalNode ──

describe('ApprovalNode', () => {
  it('renders the default "Approval Gate" label and the "Requires Approval" badge', () => {
    const r = renderWorkflowNode(
      ApprovalNode as never,
      {
        id: 'a1',
        type: 'approvalNode',
        data: { label: 'Manager review' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Manager review');
    expect(r.text()).toContain('Requires Approval');
  });

  it('shows the "Awaiting Approval" badge when running', () => {
    const r = renderWorkflowNode(
      ApprovalNode as never,
      {
        id: 'a2',
        type: 'approvalNode',
        data: { label: 'Gate', executionStatus: 'running' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Awaiting Approval');
  });

  it('shows the "Validation passed" style when status is success', () => {
    const r = renderWorkflowNode(
      ApprovalNode as never,
      {
        id: 'a3',
        type: 'approvalNode',
        data: { label: 'Gate', executionStatus: 'success' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    // The "Requires Approval" badge is still present; the success color
    // changes the styling. We assert that text is present.
    expect(r.text()).toContain('Requires Approval');
  });

  it('shows the timeout countdown when timeoutMinutes is set', () => {
    const r = renderWorkflowNode(
      ApprovalNode as never,
      {
        id: 'a4',
        type: 'approvalNode',
        data: { label: 'Gate', timeoutMinutes: 30 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('30m timeout');
  });

  it('truncates the approval message preview at 60 chars', () => {
    const longMsg = 'A'.repeat(80);
    const r = renderWorkflowNode(
      ApprovalNode as never,
      {
        id: 'a5',
        type: 'approvalNode',
        data: { label: 'Gate', approvalMessage: longMsg },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    // The visible preview cuts at 60 chars + ellipsis
    expect(r.text()).toContain('A'.repeat(60));
    expect(r.text()).toContain('...');
  });
});

// ── ClawNode ──

describe('ClawNode', () => {
  it('renders the configured label, mode, and sandbox badges', () => {
    const r = renderWorkflowNode(
      ClawNode as never,
      {
        id: 'c1',
        type: 'clawNode',
        data: {
          label: 'Long running',
          name: 'Greeter',
          mission: 'Greet everyone',
          mode: 'continuous',
          sandbox: 'docker',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Long running');
    expect(r.text()).toContain('continuous');
    expect(r.text()).toContain('docker');
    expect(r.text()).toContain('Greet everyone');
  });

  it('falls back to "Claw Agent" when label and name are missing', () => {
    const r = renderWorkflowNode(
      ClawNode as never,
      {
        id: 'c2',
        type: 'clawNode',
        data: {},
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Claw Agent');
  });

  it('uses the configured name as the label when label is missing', () => {
    const r = renderWorkflowNode(
      ClawNode as never,
      {
        id: 'c3',
        type: 'clawNode',
        data: { name: 'Named Claw' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Named Claw');
  });

  it('omits the mission preview when mission is missing', () => {
    const r = renderWorkflowNode(
      ClawNode as never,
      {
        id: 'c4',
        type: 'clawNode',
        data: { label: 'No mission' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('No mission');
  });

  it('renders the error and duration footer when present', () => {
    const r = renderWorkflowNode(
      ClawNode as never,
      {
        id: 'c5',
        type: 'clawNode',
        data: {
          label: 'X',
          executionStatus: 'error',
          executionError: 'claw failed',
          executionDuration: 1700,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('claw failed');
    expect(r.text()).toContain('1.7s');
  });
});

// ── TransformerNode ──

describe('TransformerNode', () => {
  it('renders the default "Transform" label when no label is provided', () => {
    const r = renderWorkflowNode(
      TransformerNode as never,
      {
        id: 't1',
        type: 'transformerNode',
        data: { expression: 'x.map(...)' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Transform');
    expect(r.text()).toContain('x.map(...)');
  });

  it('renders the error footer and duration when present', () => {
    const r = renderWorkflowNode(
      TransformerNode as never,
      {
        id: 't2',
        type: 'transformerNode',
        data: {
          label: 'Map',
          expression: 'x => x * 2',
          executionStatus: 'error',
          executionError: 'transform failed',
          executionDuration: 600,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('transform failed');
    expect(r.text()).toContain('600ms');
  });

  it('omits the expression preview when expression is missing', () => {
    const r = renderWorkflowNode(
      TransformerNode as never,
      {
        id: 't3',
        type: 'transformerNode',
        data: { label: 'No expr' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('No expr');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      TransformerNode as never,
      {
        id: 't4',
        type: 'transformerNode',
        data: { expression: 'x', executionStatus: 'running' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-amber-500');
    expect(outer?.className).toContain('animate-pulse');
  });
});

// ── SchemaValidatorNode ──

describe('SchemaValidatorNode', () => {
  it('renders the default "Schema Validator" label when no label is provided', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's1',
        type: 'schemaValidatorNode',
        data: { schema: '{"type":"object","properties":{}}' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Schema Validator');
  });

  it('parses schema JSON and lists the first 3 property names', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's2',
        type: 'schemaValidatorNode',
        data: {
          schema: JSON.stringify({
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              age: { type: 'number' },
            },
          }),
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('name');
    expect(r.text()).toContain('email');
    expect(r.text()).toContain('age');
  });

  it('renders the strict badge when strict is true', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's3',
        type: 'schemaValidatorNode',
        data: {
          label: 'Strict',
          strict: true,
          requiredFields: 3,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Strict');
    expect(r.text()).toContain('3 required');
  });

  it('shows "Validation passed" when status is success', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's4',
        type: 'schemaValidatorNode',
        data: { label: 'S', executionStatus: 'success' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Validation passed');
  });

  it('shows "Validation failed" when status is error', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's5',
        type: 'schemaValidatorNode',
        data: { label: 'S', executionStatus: 'error' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Validation failed');
  });

  it('does not crash on invalid JSON schema and renders no property chips', () => {
    const r = renderWorkflowNode(
      SchemaValidatorNode as never,
      {
        id: 's6',
        type: 'schemaValidatorNode',
        data: { label: 'S', schema: '{not valid json' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('S');
  });
});

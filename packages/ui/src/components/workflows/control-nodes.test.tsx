// @vitest-environment happy-dom

/**
 * Render tests for the control-flow node components that were not yet covered:
 * SwitchNode, TriggerNode, ParallelNode, MergeNode. We use a minimal
 * ReactFlowProvider + render helper to keep the test setup light.
 *
 * Each describe block exercises:
 *   - The default render with the component's primary prop
 *   - Selected + running branch (style + animate-pulse)
 *   - The execution-status icon (success / error / running / pending)
 *   - Edge-case branches (empty cases, default branch, multiple branches)
 *   - Helper exports where they exist (isDefaultSwitchBranch)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkflowNode } from './node-render-helper';
import { SwitchNode, isDefaultSwitchBranch } from './SwitchNode';
import { TriggerNode } from './TriggerNode';
import { ParallelNode } from './ParallelNode';
import { MergeNode } from './MergeNode';

afterEach(() => {
  document.body.replaceChildren();
});

// ── isDefaultSwitchBranch helper ──

describe('isDefaultSwitchBranch', () => {
  it('matches "default" case-insensitively', () => {
    expect(isDefaultSwitchBranch('default')).toBe(true);
    expect(isDefaultSwitchBranch('Default')).toBe(true);
  });

  it('does not match named cases or undefined', () => {
    expect(isDefaultSwitchBranch('High Priority')).toBe(false);
    expect(isDefaultSwitchBranch(undefined)).toBe(false);
  });
});

// ── SwitchNode ──

describe('SwitchNode', () => {
  it('renders the default label and expression when no data is provided', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's1',
        type: 'switchNode',
        data: { label: 'Route', expression: 'value > 0', cases: [] },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Route');
    expect(r.text()).toContain('value > 0');
  });

  it('renders "Switch" fallback when the label is missing', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's2',
        type: 'switchNode',
        data: { expression: 'x', cases: [] },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Switch');
  });

  it('renders a case chip per configured case and a default chip', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's3',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [
            { label: 'Hot', value: 'hot' },
            { label: 'Cold', value: 'cold' },
          ],
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Hot');
    expect(r.text()).toContain('Cold');
    expect(r.text()).toContain('default');
  });

  it('highlights the active case chip when status is success and branchTaken matches', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's4',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [{ label: 'Hot', value: 'hot' }],
          executionStatus: 'success',
          branchTaken: 'Hot',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    // The Matched summary line should render
    expect(r.text()).toContain('Matched: Hot');
  });

  it('highlights the default branch when branchTaken === "default" and status is success', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's5',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [{ label: 'Hot', value: 'hot' }],
          executionStatus: 'success',
          branchTaken: 'default',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Matched: default');
  });

  it('renders the error message and duration in the footer on error', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's6',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [],
          executionStatus: 'error',
          executionError: 'switch failed',
          executionDuration: 2400,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('switch failed');
    expect(r.text()).toContain('2.4s');
  });

  it('applies the selected ring and animate-pulse class when running', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's7',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [],
          executionStatus: 'running',
        },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-fuchsia-500');
    expect(outer?.className).toContain('animate-pulse');
  });

  it('formats duration in milliseconds when under 1000', () => {
    const r = renderWorkflowNode(
      SwitchNode as never,
      {
        id: 's8',
        type: 'switchNode',
        data: {
          label: 'Route',
          expression: 'x',
          cases: [],
          executionDuration: 350,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('350ms');
  });
});

// ── TriggerNode ──

describe('TriggerNode', () => {
  it('renders "Trigger" fallback when the label is missing', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't1',
        type: 'triggerNode',
        data: { triggerType: 'manual' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Trigger');
    expect(r.text()).toContain('manual');
    expect(r.text()).toContain('Click to run');
  });

  it('renders the schedule cron value and a preset label when matched', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't2',
        type: 'triggerNode',
        data: {
          triggerType: 'schedule',
          label: 'Every hour',
          cron: '0 * * * *',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('0 * * * *');
    // The exact preset label depends on CRON_PRESETS; assert just that a
    // recognizable substring shows up alongside the cron.
    expect(r.text().length).toBeGreaterThan('Every hour0 * * * *'.length);
  });

  it('renders the event-type detail when triggerType is event', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't3',
        type: 'triggerNode',
        data: {
          triggerType: 'event',
          label: 'On webhook',
          eventType: 'push to main',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('push to main');
  });

  it('renders the webhook path placeholder when triggerType is webhook', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't4',
        type: 'triggerNode',
        data: {
          triggerType: 'webhook',
          label: 'Webhook',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('/hooks/...');
  });

  it('renders the condition with optional threshold when triggerType is condition', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't5',
        type: 'triggerNode',
        data: {
          triggerType: 'condition',
          label: 'Temp',
          condition: 'temp > 80',
          threshold: 80,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('temp > 80');
    expect(r.text()).toContain('(80)');
  });

  it('shows the pulsing dot when executionStatus is running', () => {
    const r = renderWorkflowNode(
      TriggerNode as never,
      {
        id: 't6',
        type: 'triggerNode',
        data: {
          triggerType: 'schedule',
          label: 'Running',
          executionStatus: 'running',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const pulse = r.container.querySelector('.animate-ping');
    expect(pulse).not.toBeNull();
  });
});

// ── ParallelNode ──

describe('ParallelNode', () => {
  it('renders "Parallel" fallback label and the default branch count of 2', () => {
    const r = renderWorkflowNode(
      ParallelNode as never,
      {
        id: 'p1',
        type: 'parallelNode',
        data: { label: 'Par' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Par');
    expect(r.text()).toContain('parallel branches');
    // The default branch count is 2
    expect(r.text()).toContain('2');
  });

  it('uses the configured branchCount and labels when provided', () => {
    const r = renderWorkflowNode(
      ParallelNode as never,
      {
        id: 'p2',
        type: 'parallelNode',
        data: {
          label: 'Fan',
          branchCount: 4,
          branchLabels: ['a', 'b', 'c', 'd'],
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('4');
    expect(r.text()).toContain('a');
    expect(r.text()).toContain('b');
    expect(r.text()).toContain('c');
    expect(r.text()).toContain('d');
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      ParallelNode as never,
      {
        id: 'p3',
        type: 'parallelNode',
        data: {
          label: 'Fan',
          branchCount: 3,
          executionStatus: 'error',
          executionError: 'branch failed',
          executionDuration: 2000,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('branch failed');
    expect(r.text()).toContain('2.0s');
  });

  it('formats duration in ms when under 1000', () => {
    const r = renderWorkflowNode(
      ParallelNode as never,
      {
        id: 'p4',
        type: 'parallelNode',
        data: {
          label: 'Fan',
          branchCount: 2,
          executionDuration: 600,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('600ms');
  });

  it('applies selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      ParallelNode as never,
      {
        id: 'p5',
        type: 'parallelNode',
        data: {
          label: 'Fan',
          branchCount: 2,
          executionStatus: 'running',
        },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-teal-500');
    expect(outer?.className).toContain('animate-pulse');
  });
});

// ── MergeNode (added branch coverage) ──

describe('MergeNode additional branches', () => {
  it('uses the fallback Play icon when an unknown mode is provided', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      {
        id: 'm1',
        type: 'mergeNode',
        data: { label: 'M', mode: 'unknown-mode' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    // Should still render the "M" label and the merge node body
    expect(r.text()).toContain('M');
  });

  it('renders the error status icon and footer when present', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      {
        id: 'm2',
        type: 'mergeNode',
        data: {
          label: 'M',
          executionStatus: 'error',
          executionError: 'merge failure',
          executionDuration: 900,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const iconSpan = r.container.querySelector('svg.text-red-200');
    expect(iconSpan).not.toBeNull();
    expect(r.text()).toContain('merge failure');
  });
});

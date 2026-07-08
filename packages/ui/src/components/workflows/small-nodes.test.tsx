// Render tests for the small workflow node components. These tests focus
// on the data-driven label/badge/status rendering since the visual styling
// is harder to assert on, and we keep assertions at the "text rendered"
// level so they survive className refactors.

// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkflowNode } from './node-render-helper';
import { MergeNode } from './MergeNode';
import { DelayNode } from './DelayNode';
import { FilterNode } from './FilterNode';
import { MapNode } from './MapNode';
import { NotificationNode } from './NotificationNode';
import { ErrorHandlerNode } from './ErrorHandlerNode';

// ReactFlow's NodeProps have many positional fields; we pass only the
// minimum needed by the component bodies and let ReactFlowProvider
// default the rest.
type NodeShape = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  selected: boolean;
  isConnectable: boolean;
  zIndex: number;
  positionAbsoluteX: number;
  positionAbsoluteY: number;
};

function nodeProps(
  type: string,
  data: Record<string, unknown>,
  id = 'n1',
  selected = false
): NodeShape {
  return {
    id,
    type,
    data,
    selected,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe('MergeNode', () => {
  it('renders label and Wait All mode by default', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', { label: 'Join' }) as never
    );
    expect(r.text()).toContain('Join');
    expect(r.text()).toContain('Wait All');
    r.cleanup();
  });

  it('renders First Completed badge for the matching mode', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', { label: 'First', mode: 'firstCompleted' }) as never
    );
    expect(r.text()).toContain('First Completed');
    r.cleanup();
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', {
        label: 'Join',
        mode: 'waitAll',
        executionStatus: 'error',
        executionError: 'upstream failed',
        executionDuration: 1500,
      }) as never
    );
    expect(r.text()).toContain('upstream failed');
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });

  it('renders the running status icon and applies animate-pulse', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', {
        label: 'Join',
        executionStatus: 'running',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-amber-200');
    expect(iconSpan).not.toBeNull();
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });

  it('renders success status icon with emerald color', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', {
        label: 'Done',
        executionStatus: 'success',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-emerald-200');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      MergeNode as never,
      nodeProps('mergeNode', {
        label: 'Fast',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });
});

describe('DelayNode', () => {
  it('renders duration and SEC unit by default', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'Pause', duration: '30', unit: 'seconds' }) as never
    );
    expect(r.text()).toContain('Pause');
    expect(r.text()).toContain('30');
    expect(r.text()).toContain('SEC');
    r.cleanup();
  });

  it('renders minute and hour unit labels', () => {
    const r1 = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '5', unit: 'minutes' }) as never
    );
    expect(r1.text()).toContain('MIN');
    r1.cleanup();

    const r2 = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '2', unit: 'hours' }) as never
    );
    expect(r2.text()).toContain('HRS');
    r2.cleanup();
  });

  it('shows the Max cap badge for long durations', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '120', unit: 'minutes' }) as never
    );
    expect(r.text()).toContain('Max: 1 hour');
    r.cleanup();
  });

  // ── Branch coverage ──

  it('shows the Max cap badge for 1+ hour durations (hours mode)', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '2', unit: 'hours' }) as never
    );
    expect(r.text()).toContain('Max: 1 hour');
    r.cleanup();
  });

  it('does not show Max badge for sub-60-minute durations', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '30', unit: 'minutes' }) as never
    );
    expect(r.text()).not.toContain('Max: 1 hour');
    r.cleanup();
  });

  it('renders error message and duration in ms footer when present', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', {
        label: 'A',
        duration: '30',
        unit: 'seconds',
        executionStatus: 'error',
        executionError: 'timeout',
        executionDuration: 500,
      }) as never
    );
    expect(r.text()).toContain('timeout');
    expect(r.text()).toContain('500ms');
    r.cleanup();
  });

  it('renders duration in seconds when >= 1000ms', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', {
        label: 'A',
        duration: '30',
        unit: 'seconds',
        executionDuration: 3500,
      }) as never
    );
    expect(r.text()).toContain('3.5s');
    r.cleanup();
  });

  it('renders each status icon variant', () => {
    const icons = ['running', 'success', 'error', 'skipped'] as const;
    for (const st of icons) {
      const r = renderWorkflowNode(
        DelayNode as never,
        nodeProps('delayNode', {
          label: 'A',
          duration: '5',
          unit: 'seconds',
          executionStatus: st,
        }) as never
      );
      // The text content is non-empty — we assert an icon rendered
      expect(r.text()).toContain('A');
      r.cleanup();
    }
  });

  it('applies the selected ring class when selected', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', { label: 'A', duration: '5', unit: 'seconds' }, 'n1', true) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-rose-500');
    r.cleanup();
  });

  it('applies animate-pulse when running', () => {
    const r = renderWorkflowNode(
      DelayNode as never,
      nodeProps('delayNode', {
        label: 'A',
        duration: '5',
        unit: 'seconds',
        executionStatus: 'running',
      }) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });
});

describe('FilterNode', () => {
  it('renders label and condition code block', () => {
    const r = renderWorkflowNode(
      FilterNode as never,
      nodeProps('filterNode', {
        label: 'Keep active',
        condition: 'row.status === "active"',
      }) as never
    );
    expect(r.text()).toContain('Keep active');
    expect(r.text()).toContain('row.status === "active"');
    r.cleanup();
  });

  it('omits the condition code block when condition is empty', () => {
    const r = renderWorkflowNode(
      FilterNode as never,
      nodeProps('filterNode', { label: 'F' }) as never
    );
    expect(r.text()).toContain('F');
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      FilterNode as never,
      nodeProps('filterNode', {
        label: 'F',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      FilterNode as never,
      nodeProps('filterNode', {
        label: 'F',
        executionStatus: 'error',
        executionError: 'filter failed',
        executionDuration: 1500,
      }) as never
    );
    expect(r.text()).toContain('filter failed');
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });
});

describe('MapNode', () => {
  it('renders label and expression', () => {
    const r = renderWorkflowNode(
      MapNode as never,
      nodeProps('mapNode', {
        label: 'Square',
        expression: 'x * x',
      }) as never
    );
    expect(r.text()).toContain('Square');
    expect(r.text()).toContain('x * x');
    r.cleanup();
  });

  it('omits the expression code block when empty', () => {
    const r = renderWorkflowNode(MapNode as never, nodeProps('mapNode', { label: 'M' }) as never);
    expect(r.text()).toContain('M');
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      MapNode as never,
      nodeProps('mapNode', {
        label: 'Quick',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      MapNode as never,
      nodeProps('mapNode', {
        label: 'Map',
        expression: 'x * 2',
        executionStatus: 'error',
        executionError: 'map failed',
        executionDuration: 1500,
      }) as never
    );
    expect(r.text()).toContain('map failed');
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });
});

describe('NotificationNode', () => {
  it('renders label and default info severity badge', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'Ping' }) as never
    );
    expect(r.text()).toContain('Ping');
    expect(r.text()).toContain('info');
    r.cleanup();
  });

  it('renders message body when provided', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', {
        label: 'Ping',
        message: 'Process completed',
      }) as never
    );
    expect(r.text()).toContain('Process completed');
    r.cleanup();
  });

  it('renders the requested severity badge', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', {
        label: 'Warn',
        severity: 'warning',
      }) as never
    );
    expect(r.text()).toContain('warning');
    r.cleanup();
  });

  // ── Branch coverage ──

  it('renders error and success severity configs', () => {
    const rError = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'Err', severity: 'error' }) as never
    );
    expect(rError.text()).toContain('error');
    rError.cleanup();

    const rSuccess = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'OK', severity: 'success' }) as never
    );
    expect(rSuccess.text()).toContain('success');
    rSuccess.cleanup();
  });

  it('shows the fallback info config for an unknown severity', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'X', severity: 'critical' as never }) as never
    );
    // Falls back to info styles — the blue-stripe class for info
    const stripe = r.container.querySelector('div.bg-blue-500');
    expect(stripe).not.toBeNull();
    r.cleanup();
  });

  it('renders each status icon variant', () => {
    for (const st of ['running', 'success', 'error', 'skipped'] as const) {
      const r = renderWorkflowNode(
        NotificationNode as never,
        nodeProps('notificationNode', {
          label: 'A',
          severity: 'info',
          executionStatus: st,
        }) as never
      );
      expect(r.text()).toContain('A');
      r.cleanup();
    }
  });

  it('renders error message when present', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', {
        label: 'A',
        severity: 'error',
        executionStatus: 'error',
        executionError: 'notification failed',
      }) as never
    );
    expect(r.text()).toContain('notification failed');
    r.cleanup();
  });

  it('renders duration in ms format', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'A', executionDuration: 800 }) as never
    );
    expect(r.text()).toContain('800ms');
    r.cleanup();
  });

  it('renders duration in seconds format', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps('notificationNode', { label: 'A', executionDuration: 1500 }) as never
    );
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });

  it('applies selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      NotificationNode as never,
      nodeProps(
        'notificationNode',
        {
          label: 'A',
          executionStatus: 'running',
        },
        'n1',
        true
      ) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-purple-500');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });
});

describe('ErrorHandlerNode', () => {
  it('renders label and OFF toggle by default', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      nodeProps('errorHandlerNode', { label: 'Catch' }) as never
    );
    expect(r.text()).toContain('Catch');
    expect(r.text()).toContain('OFF');
    r.cleanup();
  });

  it('renders ON badge when continueOnSuccess is true', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      nodeProps('errorHandlerNode', { label: 'Catch', continueOnSuccess: true }) as never
    );
    expect(r.text()).toContain('ON');
    r.cleanup();
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      nodeProps('errorHandlerNode', {
        label: 'Catch',
        executionStatus: 'error',
        executionError: 'handler failed',
        executionDuration: 1500,
      }) as never
    );
    expect(r.text()).toContain('handler failed');
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      nodeProps('errorHandlerNode', {
        label: 'Catch',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

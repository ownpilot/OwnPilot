// @vitest-environment happy-dom

/**
 * Render tests for the medium-sized workflow node components. We use the
 * shared `renderWorkflowNode` helper for a minimal ReactFlowProvider setup.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkflowNode } from './node-render-helper';
import { SubWorkflowNode } from './SubWorkflowNode';
import { StickyNoteNode } from './StickyNoteNode';
import { ToolNode } from './ToolNode';
import { WebhookResponseNode } from './WebhookResponseNode';
import { ErrorHandlerNode } from './ErrorHandlerNode';

afterEach(() => {
  document.body.replaceChildren();
});

// ── SubWorkflowNode ──

describe('SubWorkflowNode', () => {
  it('renders the default label and sub-workflow name', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's1',
        type: 'subWorkflowNode',
        data: { label: 'Run sub', subWorkflowName: 'Child flow' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Run sub');
    expect(r.text()).toContain('Child flow');
  });

  it('falls back to "Sub-Workflow" when no label is provided', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's2',
        type: 'subWorkflowNode',
        data: {},
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Sub-Workflow');
  });

  it('shows the default Depth: 5 badge and a 2x retry badge when retries are set', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's3',
        type: 'subWorkflowNode',
        data: { label: 'Run sub', subWorkflowName: 'Child', retryCount: 2 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Depth: 5');
    expect(r.text()).toContain('2x retry');
  });

  it('shows the description fallback when no sub-workflow name is set', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's4',
        type: 'subWorkflowNode',
        data: { label: 'Run sub', description: 'Helper workflow' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Helper workflow');
  });

  it('renders the input mapping preview with a +N more indicator when there are 4+ entries', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's5',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          inputMapping: {
            a: '{{a}}',
            b: '{{b}}',
            c: '{{c}}',
            d: '{{d}}',
            e: '{{e}}',
          },
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('+2 more');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's6',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
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
    expect(outer?.className).toContain('ring-indigo-500');
    expect(outer?.className).toContain('animate-pulse');
  });

  it('formats duration in milliseconds when under 1000', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's7',
        type: 'subWorkflowNode',
        data: { label: 'Run sub', subWorkflowName: 'Child', executionDuration: 200 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('200ms');
  });

  // ── Branch coverage ──

  it('renders error message and duration in seconds when present', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's8',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          executionStatus: 'error',
          executionError: 'sub workflow threw',
          executionDuration: 2500,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('sub workflow threw');
    expect(r.text()).toContain('2.5s');
  });

  it('does not show description fallback when subWorkflowName is present', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's9',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          description: 'Should not appear',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).not.toContain('Should not appear');
  });

  it('does not show retry badge when retryCount is 0', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's10',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          retryCount: 0,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).not.toContain('retry');
  });

  it('does not show input mapping when inputMapping is empty', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's11',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          inputMapping: {},
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).not.toContain('→');
  });

  it('renders the skipped status icon variant', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's12',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          executionStatus: 'skipped',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Run sub');
  });

  it('renders duration in seconds format when >= 1000', () => {
    const r = renderWorkflowNode(
      SubWorkflowNode as never,
      {
        id: 's13',
        type: 'subWorkflowNode',
        data: {
          label: 'Run sub',
          subWorkflowName: 'Child',
          executionDuration: 4200,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('4.2s');
  });
});

// ── StickyNoteNode ──

describe('StickyNoteNode', () => {
  it('renders the default "Note" label and text when no data is provided', () => {
    const r = renderWorkflowNode(
      StickyNoteNode as never,
      {
        id: 'n1',
        type: 'stickyNoteNode',
        data: {},
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Note');
  });

  it('renders the configured label and text body', () => {
    const r = renderWorkflowNode(
      StickyNoteNode as never,
      {
        id: 'n2',
        type: 'stickyNoteNode',
        data: { label: 'Caveat', text: 'Make sure to test this branch' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Caveat');
    expect(r.text()).toContain('Make sure to test this branch');
  });

  it('renders a non-default color (blue) and applies the selected ring', () => {
    const r = renderWorkflowNode(
      StickyNoteNode as never,
      {
        id: 'n3',
        type: 'stickyNoteNode',
        data: { label: 'Tip', text: 'blue note', color: 'blue' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div');
    expect(outer?.className).toContain('bg-blue-100');
    expect(outer?.className).toContain('ring-primary');
  });
});

// ── ToolNode ──

describe('ToolNode', () => {
  it('renders the base tool name in monospace and the default Core badge', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't1',
        type: 'toolNode',
        data: { toolName: 'core.search', label: 'Search' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Search');
    expect(r.text()).toContain('Core');
    expect(r.text()).toContain('search');
  });

  it('detects MCP namespace and shows the MCP source badge + server name', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't2',
        type: 'toolNode',
        data: { toolName: 'mcp.github.list_issues', label: 'List Issues' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('MCP');
    expect(r.text()).toContain('github');
  });

  it('detects plugin/skill/custom source badges and server names', () => {
    const rPlugin = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't3',
        type: 'toolNode',
        data: { toolName: 'plugin.foo.bar' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(rPlugin.text()).toContain('Plugin');
    rPlugin.cleanup();

    const rSkill = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't4',
        type: 'toolNode',
        data: { toolName: 'skill.search.docs' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(rSkill.text()).toContain('Skill');
    rSkill.cleanup();

    const rCustom = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't5',
        type: 'toolNode',
        data: { toolName: 'custom.thing' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(rCustom.text()).toContain('Custom');
  });

  it('renders args count badge with pluralization and the description', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't6',
        type: 'toolNode',
        data: {
          toolName: 'core.fetch',
          label: 'Fetch',
          toolArgs: { url: 'x', method: 'GET' },
          description: 'HTTP fetch',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('2 args');
    expect(r.text()).toContain('HTTP fetch');
  });

  it('omits args badge when toolArgs is missing', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't7',
        type: 'toolNode',
        data: { toolName: 'core.lone' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).not.toContain('arg');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't8',
        type: 'toolNode',
        data: { toolName: 'core.x', executionStatus: 'running' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-blue-500');
    expect(outer?.className).toContain('animate-pulse');
  });

  it('formats duration in seconds when >= 1000', () => {
    const r = renderWorkflowNode(
      ToolNode as never,
      {
        id: 't9',
        type: 'toolNode',
        data: { toolName: 'core.x', executionDuration: 2300 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('2.3s');
  });
});

// ── WebhookResponseNode ──

describe('WebhookResponseNode', () => {
  it('renders the default 200 status code and reply visual', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w1',
        type: 'webhookResponseNode',
        data: { label: 'Reply' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('200');
    expect(r.text()).toContain('Reply to caller');
  });

  it('applies the 5xx color when statusCode >= 500', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w2',
        type: 'webhookResponseNode',
        data: { label: 'Err', statusCode: 500 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const codeBadge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === '500'
    );
    expect(codeBadge?.className).toContain('bg-red-100');
  });

  it('applies the 4xx color when statusCode in [400,500)', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w3',
        type: 'webhookResponseNode',
        data: { label: 'NotFound', statusCode: 404 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const codeBadge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === '404'
    );
    expect(codeBadge?.className).toContain('bg-amber-100');
  });

  it('applies the 3xx color when statusCode in [300,400)', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w4',
        type: 'webhookResponseNode',
        data: { label: 'Redirect', statusCode: 302 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const codeBadge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === '302'
    );
    expect(codeBadge?.className).toContain('bg-blue-100');
  });

  it('renders the content-type chip when contentType is set', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w5',
        type: 'webhookResponseNode',
        data: { label: 'JSON', statusCode: 200, contentType: 'application/json' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('application/json');
  });

  it('renders the error and duration footer when present', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w6',
        type: 'webhookResponseNode',
        data: {
          label: 'Err',
          statusCode: 500,
          executionStatus: 'error',
          executionError: 'webhook failed',
          executionDuration: 1800,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('webhook failed');
    expect(r.text()).toContain('1.8s');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      WebhookResponseNode as never,
      {
        id: 'w7',
        type: 'webhookResponseNode',
        data: { label: 'Live', executionStatus: 'running' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-rose-500');
    expect(outer?.className).toContain('animate-pulse');
  });
});

// ── ErrorHandlerNode extras ──

describe('ErrorHandlerNode extras', () => {
  it('renders the "Global Error Handler" subtitle and the description', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      {
        id: 'e1',
        type: 'errorHandlerNode',
        data: { label: 'Catch', description: 'Fallback path' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Catch');
    expect(r.text()).toContain('Global Error Handler');
    expect(r.text()).toContain('Fallback path');
  });

  it('applies the selected ring and animate-pulse when running', () => {
    const r = renderWorkflowNode(
      ErrorHandlerNode as never,
      {
        id: 'e2',
        type: 'errorHandlerNode',
        data: { label: 'Catch', executionStatus: 'running' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-red-500');
    expect(outer?.className).toContain('animate-pulse');
  });
});

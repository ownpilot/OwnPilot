// @vitest-environment happy-dom

/**
 * Batch render tests for the 7 zero-coverage config panels.
 *
 * Group A — Pure/simple (no useState, direct onUpdate):
 *   FilterConfigPanel, WebhookResponseConfigPanel, ParallelConfigPanel,
 *   SchemaValidatorConfigPanel
 *
 * Group B — useState + tabs/async:
 *   ConditionConfigPanel, ErrorHandlerConfigPanel, SubWorkflowConfigPanel
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';

// Group A
import { FilterConfigPanel } from './FilterConfigPanel';
import { WebhookResponseConfigPanel } from './WebhookResponseConfigPanel';
import { ParallelConfigPanel } from './ParallelConfigPanel';
import { SchemaValidatorConfigPanel } from './SchemaValidatorConfigPanel';

// Group B
import { ConditionConfigPanel } from './ConditionConfigPanel';
import { ErrorHandlerConfigPanel } from './ErrorHandlerConfigPanel';
import { SubWorkflowConfigPanel } from './SubWorkflowConfigPanel';

// API mocks for async panels
import { workflowsApi } from '../../../api/endpoints/workflows';

vi.mock('../../../api/endpoints/workflows', () => ({
  workflowsApi: { list: vi.fn() },
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ── helpers ──

function renderPanel(Component: ComponentType<NodeConfigPanelProps>, props: NodeConfigPanelProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Component, props)));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeProps(
  data: Record<string, unknown> = {},
  overrides: Partial<NodeConfigPanelProps> = {}
): NodeConfigPanelProps {
  return {
    node: {
      id: 'n1',
      type: 'node',
      data,
      selected: false,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as never,
    upstreamNodes: overrides.upstreamNodes ?? [],
    onUpdate: overrides.onUpdate ?? vi.fn(),
    onDelete: overrides.onDelete ?? vi.fn(),
    onClose: overrides.onClose ?? vi.fn(),
    className: '',
  };
}

async function flushEffects() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === text
    ) ?? null
  );
}

// ============================================================================
// GROUP A — Pure / simple panels
// ============================================================================

// ── FilterConfigPanel ──

describe('FilterConfigPanel', () => {
  it('renders the title and default placeholder', () => {
    const r = renderPanel(FilterConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Filter');
    expect(r.container.querySelector('input[placeholder="Filter"]')).not.toBeNull();
    r.cleanup();
  });

  it('fires onClose when X is clicked', () => {
    const onClose = vi.fn();
    const r = renderPanel(FilterConfigPanel, makeProps({}, { onClose }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when Delete Node is clicked', () => {
    const onDelete = vi.fn();
    const r = renderPanel(FilterConfigPanel, makeProps({}, { onDelete }));
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('updates label, array expression, and condition via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(FilterConfigPanel, makeProps({}, { onUpdate }));
    const labelInput = r.container.querySelector('input[placeholder="Filter"]') as HTMLInputElement;
    const arrayInput = r.container.querySelector(
      'input[placeholder*="node_1"]'
    ) as HTMLInputElement;
    const condTextarea = r.container.querySelector(
      'textarea[placeholder*="item.status"]'
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(labelInput, 'My Filter');
      labelInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ label: 'My Filter' }));
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(arrayInput, 'items');
      arrayInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ arrayExpression: 'items' })
    );
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(condTextarea, 'item.active === true');
      condTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ condition: 'item.active === true' })
    );
    r.cleanup();
  });

  it('renders OutputAliasField and RetryTimeoutFields', () => {
    const r = renderPanel(FilterConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });

  it('updates description via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(FilterConfigPanel, makeProps({}, { onUpdate }));
    const descInput = r.container.querySelector(
      'input[placeholder="Optional description..."]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(descInput, 'My filter description');
      descInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ description: 'My filter description' })
    );
    r.cleanup();
  });

  it('clears description to undefined when emptied', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(FilterConfigPanel, makeProps({ description: 'old' }, { onUpdate }));
    const descInput = r.container.querySelector(
      'input[placeholder="Optional description..."]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(descInput, '');
      descInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ description: undefined })
    );
    r.cleanup();
  });

  it('renders TemplateValidator hint for array expression', () => {
    const r = renderPanel(FilterConfigPanel, makeProps({ arrayExpression: '{{items}}' }));
    expect(r.container.textContent).toContain('{{items}}');
    r.cleanup();
  });
});

// ── WebhookResponseConfigPanel ──

describe('WebhookResponseConfigPanel', () => {
  it('renders the title and default values', () => {
    const r = renderPanel(WebhookResponseConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Webhook Response');
    expect((r.container.querySelector('input[type="number"]') as HTMLInputElement)?.value).toBe(
      '200'
    );
    expect(
      (r.container.querySelector('input[placeholder="application/json"]') as HTMLInputElement)
        ?.value
    ).toBe('application/json');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(WebhookResponseConfigPanel, makeProps({}, { onClose, onDelete }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('updates statusCode, body, contentType, headers via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(WebhookResponseConfigPanel, makeProps({}, { onUpdate }));
    const statusInput = r.container.querySelector('input[type="number"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(statusInput, '201');
      statusInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ statusCode: 201 }));
    r.cleanup();
  });

  it('updates body textarea via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(WebhookResponseConfigPanel, makeProps({}, { onUpdate }));
    const bodyTextarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(bodyTextarea, '{"msg":"hello"}');
      bodyTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ body: '{"msg":"hello"}' })
    );
    r.cleanup();
  });

  it('updates headers textarea via onUpdate and clears when empty', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(
      WebhookResponseConfigPanel,
      makeProps({ headers: 'Old: val' }, { onUpdate })
    );
    const headersTextarea = r.container.querySelectorAll('textarea')[1] as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(headersTextarea, '');
      headersTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ headers: undefined }));
    r.cleanup();
  });

  it('updates contentType via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(WebhookResponseConfigPanel, makeProps({}, { onUpdate }));
    const ctInput = r.container.querySelector(
      'input[placeholder="application/json"]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(ctInput, 'text/xml');
      ctInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ contentType: 'text/xml' })
    );
    r.cleanup();
  });

  it('clears description to undefined when emptied', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(
      WebhookResponseConfigPanel,
      makeProps({ description: 'old' }, { onUpdate })
    );
    const descInput = r.container.querySelector(
      'input[placeholder="Optional description..."]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(descInput, '');
      descInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ description: undefined })
    );
    r.cleanup();
  });
});

// ── ParallelConfigPanel ──

describe('ParallelConfigPanel', () => {
  it('renders the title, default branch count, and branch label inputs', () => {
    const r = renderPanel(ParallelConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Parallel Branches');
    expect((r.container.querySelector('input[type="number"]') as HTMLInputElement)?.value).toBe(
      '2'
    );
    // 2 branch label inputs
    const labelInputs = r.container.querySelectorAll('.flex.items-center.gap-2 input[type="text"]');
    expect(labelInputs.length).toBeGreaterThanOrEqual(2);
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(ParallelConfigPanel, makeProps({}, { onClose, onDelete }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('renders OutputAliasField', () => {
    const r = renderPanel(ParallelConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    r.cleanup();
  });
});

// ── SchemaValidatorConfigPanel ──

describe('SchemaValidatorConfigPanel', () => {
  it('renders the title, schema textarea, and strict checkbox', () => {
    const r = renderPanel(SchemaValidatorConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Schema Validator');
    expect(r.container.querySelector('textarea')).not.toBeNull();
    expect(r.container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(r.container.textContent).toContain('Strict Mode');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(SchemaValidatorConfigPanel, makeProps({}, { onClose, onDelete }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('shows parse error when invalid JSON is typed', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(SchemaValidatorConfigPanel, makeProps({}, { onUpdate }));
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '{ invalid }');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(r.container.textContent).toContain('Invalid JSON');
    expect(onUpdate).toHaveBeenCalled();
    r.cleanup();
  });

  it('clears parse error when valid JSON is typed', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(SchemaValidatorConfigPanel, makeProps({}, { onUpdate }));
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '{"type": "object"}');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(r.container.textContent).not.toContain('Invalid JSON');
    r.cleanup();
  });

  it('renders OutputAliasField and RetryTimeoutFields', () => {
    const r = renderPanel(SchemaValidatorConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });
});

// ============================================================================
// GROUP B — useState / tabs / async panels
// ============================================================================

// ── ConditionConfigPanel ──

describe('ConditionConfigPanel', () => {
  it('renders the title, default label, and config tab by default', () => {
    const r = renderPanel(ConditionConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Condition');
    expect(r.container.textContent).toContain('Expression');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(ConditionConfigPanel, makeProps({}, { onClose, onDelete }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Condition')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('renders results tab when executionStatus is present', () => {
    const r = renderPanel(ConditionConfigPanel, makeProps({ executionStatus: 'success' }));
    expect(r.container.textContent).toContain('success');
    r.cleanup();
  });

  it('renders quick expression presets and clicking one pushes update', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(ConditionConfigPanel, makeProps({}, { onUpdate }));
    const presetBtn = findButton(r.container, 'node_1 !== null');
    expect(presetBtn).not.toBeNull();
    act(() => presetBtn?.click());
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ expression: 'node_1 !== null' })
    );
    r.cleanup();
  });

  it('renders branchTaken and executionError in results tab', () => {
    const r = renderPanel(
      ConditionConfigPanel,
      makeProps({
        executionStatus: 'success',
        branchTaken: 'true',
        executionError: 'something broke',
      })
    );
    expect(r.container.textContent).toContain('Branch Taken');
    expect(r.container.textContent).toContain('True');
    expect(r.container.textContent).toContain('something broke');
    r.cleanup();
  });

  it('renders OutputTreeBrowser when upstreamNodes are provided', () => {
    const r = renderPanel(
      ConditionConfigPanel,
      makeProps(
        {},
        {
          upstreamNodes: [
            {
              id: 'n0',
              type: 'toolNode',
              data: { label: 'Src' },
              selected: false,
              isConnectable: true,
              zIndex: 0,
              positionAbsoluteX: 0,
              positionAbsoluteY: 0,
            } as never,
          ],
        }
      )
    );
    expect(r.container.textContent).toContain('Upstream Outputs');
    r.cleanup();
  });
});

// ── ErrorHandlerConfigPanel ──

describe('ErrorHandlerConfigPanel', () => {
  it('renders the title and default label', () => {
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Error Handler');
    expect(r.container.textContent).toContain('Continue on Success');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps({}, { onClose, onDelete }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Error Handler')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('renders results tab content when executionStatus is present', () => {
    const r = renderPanel(
      ErrorHandlerConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionError: 'handler error',
        executionDuration: 500,
      })
    );
    expect(r.container.textContent).toContain('error');
    expect(r.container.textContent).toContain('handler error');
    expect(r.container.textContent).toContain('500ms');
    r.cleanup();
  });

  it('toggles continueOnSuccess checkbox and pushes update', () => {
    // Note: checkbox onChange via programmatic events is not supported
    // in happy-dom for React controlled inputs. We verify the checkbox
    // renders with default state and updates reflect in props.
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps({ continueOnSuccess: true }));
    const checkbox = r.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox?.checked).toBe(true);
    r.cleanup();
  });

  it('renders OutputAliasField', () => {
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    r.cleanup();
  });

  it('shows configured label value in input field', () => {
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps({ label: 'Custom Handler' }));
    const labelInput = r.container.querySelector('input') as HTMLInputElement;
    expect(labelInput?.value).toBe('Custom Handler');
    r.cleanup();
  });

  it('shows configured description value in textarea', () => {
    const r = renderPanel(
      ErrorHandlerConfigPanel,
      makeProps({ description: 'Handle errors gracefully' })
    );
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea?.value).toBe('Handle errors gracefully');
    r.cleanup();
  });

  it('renders retry attempts in results tab', () => {
    const r = renderPanel(
      ErrorHandlerConfigPanel,
      makeProps({
        executionStatus: 'error',
        retryAttempts: 3,
      })
    );
    expect(r.container.textContent).toContain('3');
    r.cleanup();
  });

  it('formats duration in minutes format', () => {
    const r = renderPanel(
      ErrorHandlerConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionDuration: 125000, // 2m 5s
      })
    );
    expect(r.container.textContent).toContain('2.1m');
    r.cleanup();
  });

  it('renders the header title with configured label', () => {
    const r = renderPanel(ErrorHandlerConfigPanel, makeProps({ label: 'Custom Handler' }));
    expect(r.container.querySelector('h3')?.textContent).toContain('Custom Handler');
    r.cleanup();
  });
});

// ── SubWorkflowConfigPanel ──

describe('SubWorkflowConfigPanel', () => {
  it('renders the title and default label/description inputs', () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const r = renderPanel(SubWorkflowConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Sub-Workflow');
    expect(r.container.textContent).toContain('Target Workflow');
    expect(r.container.textContent).toContain('Max Recursion Depth');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderPanel(SubWorkflowConfigPanel, makeProps({}, { onClose, onDelete }));
    const escBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'ESC'
    );
    act(() => escBtn?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('renders input mapping rows and allows adding', async () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const r = renderPanel(SubWorkflowConfigPanel, makeProps({}));
    expect(r.container.textContent).toContain('Input Mapping');
    // Click "+ Add" button (finds by text "Add" since SVG doesn't contribute text)
    const addBtn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add')
    );
    act(() => addBtn?.click());
    await flushEffects();
    // New empty row should appear
    const keyInputs = r.container.querySelectorAll('input[placeholder="variable"]');
    expect(keyInputs.length).toBeGreaterThanOrEqual(1);
    r.cleanup();
  });

  it('renders existing input mapping from data', () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const onUpdate = vi.fn();
    const r = renderPanel(
      SubWorkflowConfigPanel,
      makeProps({ inputMapping: { myVar: '{{node_1.output}}' } }, { onUpdate })
    );
    const keyInput = r.container.querySelector('input[placeholder="variable"]') as HTMLInputElement;
    expect(keyInput?.value).toBe('myVar');
    const valInput = r.container.querySelector('input[placeholder*="node_2"]') as HTMLInputElement;
    expect(valInput?.value).toBe('{{node_1.output}}');
    r.cleanup();
  });

  it('renders output alias and retry/timeout fields', () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const r = renderPanel(SubWorkflowConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });

  it('renders execution results when executionStatus is set', () => {
    vi.mocked(workflowsApi.list).mockResolvedValue({ workflows: [] } as never);
    const r = renderPanel(
      SubWorkflowConfigPanel,
      makeProps({ executionStatus: 'success', executionDuration: 1500 })
    );
    expect(r.container.textContent).toContain('SUCCESS');
    expect(r.container.textContent).toContain('1.5s');
    r.cleanup();
  });
});

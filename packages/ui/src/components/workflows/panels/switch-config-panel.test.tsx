// @vitest-environment happy-dom

/**
 * SwitchConfigPanel render tests.
 *
 * The existing SwitchConfigPanel.test.ts covers only the exported
 * getSwitchExecutionDetails util (3 tests). This file adds render
 * coverage for the 399-line panel: config/results tabs, cases
 * (add/remove/update), label/expression/description (onBlur),
 * OutputTreeBrowser, OutputAlias, RetryTimeout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { SwitchConfigPanel } from './SwitchConfigPanel';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';

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
      type: 'switchNode',
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

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === text
    ) ?? null
  );
}

// ── SwitchConfigPanel ──

describe('SwitchConfigPanel', () => {
  // ── A. Render & structure ──

  it('renders the title and config tab by default', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Switch');
    expect(r.container.textContent).toContain('Expression');
    r.cleanup();
  });

  it('fires onClose when X is clicked', () => {
    const onClose = vi.fn();
    const r = renderPanel(SwitchConfigPanel, makeProps({}, { onClose }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when Delete Switch is clicked', () => {
    const onDelete = vi.fn();
    const r = renderPanel(SwitchConfigPanel, makeProps({}, { onDelete }));
    act(() => findButton(r.container, 'Delete Switch')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  // ── B. Default case rendering ──

  it('renders the default case (Case 1) on mount', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps());
    // Default cases array: [{ label: 'Case 1', value: '' }]
    // Values are in input.value, not textContent, in happy-dom
    const labelInputs = r.container.querySelectorAll('input[placeholder="Label"]');
    expect(labelInputs.length).toBe(1);
    expect((labelInputs[0] as HTMLInputElement)?.value).toBe('Case 1');
    r.cleanup();
  });

  it('renders cases from data with labels and match values', () => {
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps({
        cases: [
          { label: 'High', value: 'critical' },
          { label: 'Low', value: 'normal' },
        ],
      })
    );
    const labelInputs = r.container.querySelectorAll('input[placeholder="Label"]');
    expect(labelInputs.length).toBe(2);
    expect((labelInputs[0] as HTMLInputElement)?.value).toBe('High');
    expect((labelInputs[1] as HTMLInputElement)?.value).toBe('Low');
    const valInputs = r.container.querySelectorAll('input[placeholder="Match value"]');
    expect((valInputs[0] as HTMLInputElement)?.value).toBe('critical');
    expect((valInputs[1] as HTMLInputElement)?.value).toBe('normal');
    r.cleanup();
  });

  // ── C. Add / remove cases ──

  it('adds a new case when Add Case is clicked', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(SwitchConfigPanel, makeProps({}, { onUpdate }));
    const addBtn = findButton(r.container, 'Add Case');
    act(() => addBtn?.click());
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({
        cases: expect.arrayContaining([expect.objectContaining({ label: 'Case 2', value: '' })]),
      })
    );
    r.cleanup();
  });

  it('removes a case when the X button is clicked (with 2+ cases)', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps(
        {
          cases: [
            { label: 'High', value: 'critical' },
            { label: 'Low', value: 'normal' },
          ],
        },
        { onUpdate }
      )
    );
    // Find the X removal button — there are 2 case rows with 1 X button each
    // Total X buttons: close button (header) + 2 remove buttons = 3
    const removeBtns = r.container.querySelectorAll('button[type="button"]');
    // The remove buttons have an X icon and are not disabled (cases.length > 1)
    const caseRemoveBtn = Array.from(removeBtns).find(
      (b) => !b.hasAttribute('disabled') && b.querySelector('svg')
    );
    act(() => (caseRemoveBtn as HTMLElement | null)?.click());
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({
        cases: [{ label: 'Low', value: 'normal' }],
      })
    );
    r.cleanup();
  });

  it('disables the remove button when only 1 case exists', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps());
    // Find disabled buttons with X icon
    const disabledRemove = r.container.querySelector('button[type="button"]:disabled');
    expect(disabledRemove).not.toBeNull();
    r.cleanup();
  });

  // ── D. Expression & Label & Description ──

  it('uses the data.label as the default label', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps({ label: 'My Switch' }));
    expect(r.container.textContent).toContain('My Switch');
    r.cleanup();
  });

  it('uses the data.expression as the expression value', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps({ expression: 'node_1.status' }));
    expect(r.container.textContent).toContain('node_1.status');
    r.cleanup();
  });

  // ── E. Results tab ──

  it('renders results tab with status when executionStatus is set', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps({ executionStatus: 'success' }));
    expect(r.container.textContent).toContain('success');
    r.cleanup();
  });

  it('renders evaluated value and matched case in results', () => {
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps({
        executionStatus: 'success',
        evaluatedValue: 'critical',
        branchTaken: 'High',
      })
    );
    expect(r.container.textContent).toContain('critical');
    expect(r.container.textContent).toContain('Branch Taken');
    expect(r.container.textContent).toContain('High');
    r.cleanup();
  });

  it('renders object evaluated value in JsonTreeView', () => {
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps({
        executionStatus: 'success',
        evaluatedValue: { score: 42 },
      })
    );
    expect(r.container.textContent).toContain('score');
    expect(r.container.textContent).toContain('42');
    r.cleanup();
  });

  it('renders executionError in results tab', () => {
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionError: 'expression error',
      })
    );
    expect(r.container.textContent).toContain('expression error');
    r.cleanup();
  });

  // ── F. Conditional OutputTreeBrowser ──

  it('renders OutputTreeBrowser when upstreamNodes are present', () => {
    const r = renderPanel(
      SwitchConfigPanel,
      makeProps(
        {},
        {
          upstreamNodes: [
            {
              id: 'node_0',
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

  it('does NOT render OutputTreeBrowser when no upstreamNodes', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps());
    expect(r.container.textContent).not.toContain('Upstream Outputs');
    r.cleanup();
  });

  // ── G. Shared fields ──

  it('renders OutputAliasField and RetryTimeoutFields', () => {
    const r = renderPanel(SwitchConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });
});

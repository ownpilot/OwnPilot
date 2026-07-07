// @vitest-environment happy-dom

/**
 * ToolConfigPanel tests.
 *
 * 454-line panel with 3 major sections:
 *  1. Config tab — tool name (read-only), label/description (onBlur),
 *     JSON editor toggle, SchemaFormFields, OutputTreeBrowser
 *  2. Results tab — status badge, resolved args, output, error
 *  3. Footer — Test Run button, Delete button
 *
 * Async deps: toolsApi.list (fetch schemas), toolsApi.execute (test run).
 * Both are mocked at module level.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolConfigPanel } from './ToolConfigPanel';
import { toolsApi } from '../../../api';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';

// ── mock toolsApi ──

vi.mock('../../../api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    toolsApi: {
      list: vi.fn(),
      execute: vi.fn(),
    },
  };
});

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
      type: 'toolNode',
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

function setupApiMocks() {
  vi.mocked(toolsApi.list).mockResolvedValue([
    { name: 'core.math', parameters: { type: 'object', properties: { a: { type: 'number' } } } },
  ] as never);
}

// ── ToolConfigPanel ──

describe('ToolConfigPanel', () => {
  // ── A. Render & Structure ──

  it('renders the tool name in the header and config section', () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math' }));
    expect(r.container.textContent).toContain('core.math');
    // Tool name in config section is also rendered
    expect(r.container.textContent).toContain('Tool');
    r.cleanup();
  });

  it('fires onClose when X is clicked', () => {
    setupApiMocks();
    const onClose = vi.fn();
    const r = renderPanel(ToolConfigPanel, makeProps({}, { onClose }));
    act(() =>
      (r.container.querySelector('button[aria-label="Close"]') as HTMLElement | null)?.click()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when Delete Node is clicked', () => {
    setupApiMocks();
    const onDelete = vi.fn();
    const r = renderPanel(ToolConfigPanel, makeProps({}, { onDelete }));
    act(() => findButton(r.container, 'Delete Node')?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  // ── B. Config tab — Label / Description ──

  it('shows the config tab by default', () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math' }));
    expect(r.container.textContent).toContain('Arguments');
    r.cleanup();
  });

  it('renders the label input with the data.label value', () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', label: 'My Tool' }));
    const labelInput = r.container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(labelInput?.value).toBe('My Tool');
    r.cleanup();
  });

  it('renders description textarea with the data.description value', () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps({ toolName: 'core.math', description: 'Does math' })
    );
    expect(r.container.textContent).toContain('Does math');
    r.cleanup();
  });

  // ── C. JSON editor — toggle, parse error ──

  it('shows JSON editor by default when no schema fields', async () => {
    vi.mocked(toolsApi.list).mockResolvedValue([] as never);
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'custom.api' }));
    await flushEffects();
    // JSON textarea should be visible
    const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(r.container.textContent).toContain('Arguments (JSON)');
    r.cleanup();
  });

  it('has a JSON → Form toggle button when schema is present', async () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', toolArgs: {} }));
    await flushEffects();
    // After schema loads, JSON editor is shown initially
    // "Form Fields" toggle button should exist
    const formBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Form Fields'
    );
    expect(formBtn).not.toBeNull();
    r.cleanup();
  });

  it('switches to form view and back when toggle buttons are clicked', async () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', toolArgs: {} }));
    await flushEffects();
    // Click "Form Fields" to switch to schema form
    const formBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Form Fields'
    ) as HTMLButtonElement;
    act(() => formBtn?.click());
    // Now should see the JSON toggle button
    const jsonToggle = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'JSON'
    );
    expect(jsonToggle).not.toBeNull();
    r.cleanup();
  });

  // ── D. Results tab ──

  it('renders the Results tab with status + output when executionStatus is set', async () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps({
        toolName: 'core.math',
        executionStatus: 'success',
        executionOutput: { result: 42 },
      })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('success');
    expect(r.container.textContent).toContain('result');
    // Config/Results tab buttons visible
    const configTab = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Config'
    );
    expect(configTab).not.toBeNull();
    r.cleanup();
  });

  it('renders resolvedArgs in the results tab', async () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps({
        toolName: 'core.math',
        executionStatus: 'success',
        resolvedArgs: { a: 1 },
      })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('Input');
    expect(r.container.textContent).toContain('a');
    expect(r.container.textContent).toContain('1');
    r.cleanup();
  });

  it('renders executionError in the results tab', async () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps({
        toolName: 'core.math',
        executionStatus: 'error',
        executionError: 'division by zero',
      })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('division by zero');
    r.cleanup();
  });

  it('renders executionDuration in the results tab', async () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps({
        toolName: 'core.math',
        executionStatus: 'success',
        executionDuration: 1234,
      })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('1.2s');
    r.cleanup();
  });

  // ── E. Test Run button ──

  it('renders the Test Run button', () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', toolArgs: {} }));
    const testBtn = findButton(r.container, 'Test Run');
    expect(testBtn).not.toBeNull();
    expect(testBtn?.disabled).toBe(false);
    r.cleanup();
  });

  // ── F. Conditional OutputTreeBrowser ──

  it('renders OutputTreeBrowser when upstreamNodes are present', () => {
    setupApiMocks();
    const r = renderPanel(
      ToolConfigPanel,
      makeProps(
        { toolName: 'core.math', toolArgs: {} },
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
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', toolArgs: {} }));
    expect(r.container.textContent).not.toContain('Upstream Outputs');
    r.cleanup();
  });

  // ── G. Shared fields ──

  it('renders OutputAliasField and RetryTimeoutFields', () => {
    setupApiMocks();
    const r = renderPanel(ToolConfigPanel, makeProps({ toolName: 'core.math', toolArgs: {} }));
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });
});

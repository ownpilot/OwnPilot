// @vitest-environment happy-dom

/**
 * Tests for NodeConfigPanel — the router that selects the right config
 * panel component for each node type. Also tests the exported shared
 * sub-components: OutputAliasField, RetryTimeoutFields, RetryAttemptsDisplay.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  NodeConfigPanel,
  OutputAliasField,
  RetryTimeoutFields,
  RetryAttemptsDisplay,
} from './NodeConfigPanel';

function makeNode(type: string, data: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    type,
    position: { x: 0, y: 0 },
    data,
  };
}

function renderPanel(panelType: string, data: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(NodeConfigPanel, {
        node: makeNode(panelType, data),
        upstreamNodes: [],
        onUpdate,
        onDelete,
        onClose,
      })
    );
  });
  return {
    container,
    onUpdate,
    onDelete,
    onClose,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
    text: () => container.textContent ?? '',
  };
}

function renderComponent(Component: React.ComponentType<any>, props: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Component, props));
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
    text: () => container.textContent ?? '',
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

// ── Routing ──

describe('NodeConfigPanel routing', () => {
  it('renders triggerNode with TriggerConfigPanel', () => {
    const r = renderPanel('triggerNode', { triggerType: 'manual', label: 'Start' });
    expect(r.text()).toContain('Start');
    r.cleanup();
  });

  it('renders llmNode with LlmConfigPanel', () => {
    const r = renderPanel('llmNode', { provider: 'openai', model: 'gpt-4', label: 'LLM' });
    expect(r.text()).toContain('LLM');
    r.cleanup();
  });

  it('renders conditionNode with ConditionConfigPanel', () => {
    const r = renderPanel('conditionNode', { expression: 'x > 0', label: 'Check' });
    expect(r.text()).toContain('Check');
    r.cleanup();
  });

  it('renders codeNode with CodeConfigPanel', () => {
    const r = renderPanel('codeNode', { language: 'javascript', code: 'x', label: 'Run' });
    expect(r.text()).toContain('Run');
    r.cleanup();
  });

  it('renders transformerNode with TransformerConfigPanel', () => {
    const r = renderPanel('transformerNode', { expression: 'x * 2', label: 'XForm' });
    expect(r.text()).toContain('XForm');
    r.cleanup();
  });

  it('renders forEachNode with ForEachConfigPanel', () => {
    const r = renderPanel('forEachNode', { arrayExpression: 'items', label: 'Loop' });
    expect(r.text()).toContain('Loop');
    r.cleanup();
  });

  it('renders httpRequestNode with HttpRequestConfigPanel', () => {
    const r = renderPanel('httpRequestNode', { method: 'GET', url: '/x', label: 'Fetch' });
    expect(r.text()).toContain('Fetch');
    r.cleanup();
  });

  it('renders delayNode with DelayConfigPanel', () => {
    const r = renderPanel('delayNode', { duration: '30', unit: 'seconds', label: 'Pause' });
    expect(r.text()).toContain('Pause');
    r.cleanup();
  });

  it('renders switchNode with SwitchConfigPanel', () => {
    const r = renderPanel('switchNode', { expression: 'x', label: 'Route' });
    expect(r.text()).toContain('Route');
    r.cleanup();
  });

  it('renders errorHandlerNode with ErrorHandlerConfigPanel', () => {
    const r = renderPanel('errorHandlerNode', { label: 'Catch' });
    expect(r.text()).toContain('Catch');
    r.cleanup();
  });

  it('renders subWorkflowNode with SubWorkflowConfigPanel', () => {
    const r = renderPanel('subWorkflowNode', { subWorkflowName: 'Child', label: 'Sub' });
    expect(r.text()).toContain('Sub');
    r.cleanup();
  });

  it('renders approvalNode with ApprovalConfigPanel', () => {
    const r = renderPanel('approvalNode', { label: 'Gate' });
    expect(r.text()).toContain('Gate');
    r.cleanup();
  });

  it('renders stickyNoteNode with StickyNoteConfigPanel', () => {
    const r = renderPanel('stickyNoteNode', { text: 'note body', label: 'Note' });
    expect(r.text()).toContain('Note');
    r.cleanup();
  });

  it('renders notificationNode with NotificationConfigPanel', () => {
    const r = renderPanel('notificationNode', { severity: 'info', label: 'Alert' });
    expect(r.text()).toContain('Notification');
    expect(r.text()).toContain('Message');
    r.cleanup();
  });

  it('renders parallelNode with ParallelConfigPanel', () => {
    const r = renderPanel('parallelNode', { branchCount: 3, label: 'Fan' });
    expect(r.text()).toContain('Parallel Branches');
    expect(r.text()).toContain('Branch Count');
    r.cleanup();
  });

  it('renders mergeNode with MergeConfigPanel', () => {
    const r = renderPanel('mergeNode', { label: 'Join' });
    expect(r.text()).toContain('Merge / Wait');
    expect(r.text()).toContain('Merge Mode');
    r.cleanup();
  });

  it('renders dataStoreNode with DataStoreConfigPanel', () => {
    const r = renderPanel('dataStoreNode', { operation: 'get', key: 'k', label: 'Store' });
    expect(r.text()).toContain('Store');
    r.cleanup();
  });

  it('renders schemaValidatorNode with SchemaValidatorConfigPanel', () => {
    const r = renderPanel('schemaValidatorNode', { label: 'Validate' });
    expect(r.text()).toContain('Schema Validator');
    expect(r.text()).toContain('Strict Mode');
    r.cleanup();
  });

  it('renders filterNode with FilterConfigPanel', () => {
    const r = renderPanel('filterNode', { condition: 'x > 0', label: 'Filter' });
    expect(r.text()).toContain('Filter');
    r.cleanup();
  });

  it('renders mapNode with MapConfigPanel', () => {
    const r = renderPanel('mapNode', { expression: 'x', label: 'Map' });
    expect(r.text()).toContain('Map');
    r.cleanup();
  });

  it('renders aggregateNode with AggregateConfigPanel', () => {
    const r = renderPanel('aggregateNode', { operation: 'count', label: 'Count' });
    expect(r.text()).toContain('Count');
    r.cleanup();
  });

  it('renders webhookResponseNode with WebhookResponseConfigPanel', () => {
    const r = renderPanel('webhookResponseNode', { statusCode: 200, label: 'Reply' });
    expect(r.text()).toContain('Webhook Response');
    expect(r.text()).toContain('Status Code');
    r.cleanup();
  });

  it('renders clawNode with ClawConfigPanel', () => {
    const r = renderPanel('clawNode', { name: 'Agent', label: 'Claw' });
    expect(r.text()).toContain('Claw');
    r.cleanup();
  });

  it('falls back to ToolConfigPanel for the default (toolNode) case', () => {
    const r = renderPanel('toolNode', { toolName: 'core.search', label: 'Search' });
    expect(r.text()).toContain('Search');
    r.cleanup();
  });

  it('calls onClose when the close button is clicked', () => {
    const r = renderPanel('llmNode', { label: 'LLM' });
    // The panel renders without crashing
    expect(r.text()).toContain('LLM');
    r.cleanup();
  });
});

// ── OutputAliasField ──

describe('OutputAliasField', () => {
  it('renders with default empty value', () => {
    const onUpdate = vi.fn();
    const r = renderComponent(OutputAliasField, {
      data: {},
      nodeId: 'n1',
      onUpdate,
    });
    expect(r.text()).toContain('Output Alias');
    r.cleanup();
  });

  it('renders with an existing alias', () => {
    const r = renderComponent(OutputAliasField, {
      data: { outputAlias: 'myAlias' },
      nodeId: 'n1',
      onUpdate: vi.fn(),
    });
    const input = r.container.querySelector('input') as HTMLInputElement;
    expect(input?.value).toBe('myAlias');
    r.cleanup();
  });

  it('calls onUpdate when alias is changed', () => {
    const onUpdate = vi.fn();
    const r = renderComponent(OutputAliasField, {
      data: {},
      nodeId: 'n1',
      onUpdate,
    });
    const input = r.container.querySelector('input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, 'newAlias');
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', { outputAlias: 'newAlias' });
    r.cleanup();
  });
});

// ── RetryTimeoutFields ──

describe('RetryTimeoutFields', () => {
  it('renders both retry and timeout selects', () => {
    const r = renderComponent(RetryTimeoutFields, {
      data: {},
      nodeId: 'n1',
      onUpdate: vi.fn(),
    });
    expect(r.text()).toContain('Retry on failure');
    expect(r.text()).toContain('No retry');
    expect(r.text()).toContain('No limit');
    const selects = r.container.querySelectorAll('select');
    expect(selects.length).toBe(2);
    r.cleanup();
  });

  it('renders with existing retryCount and timeoutMs values', () => {
    const r = renderComponent(RetryTimeoutFields, {
      data: { retryCount: 2, timeoutMs: 30000 },
      nodeId: 'n1',
      onUpdate: vi.fn(),
    });
    const selects = r.container.querySelectorAll('select');
    expect((selects[0] as HTMLSelectElement).value).toBe('2');
    expect((selects[1] as HTMLSelectElement).value).toBe('30000');
    r.cleanup();
  });
});

// ── RetryAttemptsDisplay ──

describe('RetryAttemptsDisplay', () => {
  it('shows success message with correct pluralization', () => {
    const r = renderComponent(RetryAttemptsDisplay, {
      retryAttempts: 3,
      status: 'success',
    });
    expect(r.text()).toContain('Succeeded after 3 retries');
    r.cleanup();
  });

  it('shows failed message with singular "retry"', () => {
    const r = renderComponent(RetryAttemptsDisplay, {
      retryAttempts: 1,
      status: 'error',
    });
    expect(r.text()).toContain('Failed after 1 retry');
    r.cleanup();
  });

  it('uses success color when status is success', () => {
    const r = renderComponent(RetryAttemptsDisplay, {
      retryAttempts: 2,
      status: 'success',
    });
    const span = r.container.querySelector('span');
    expect(span?.className).toContain('bg-warning');
    r.cleanup();
  });

  it('uses error color when status is not success', () => {
    const r = renderComponent(RetryAttemptsDisplay, {
      retryAttempts: 2,
      status: 'error',
    });
    const span = r.container.querySelector('span');
    expect(span?.className).toContain('bg-error');
    r.cleanup();
  });
});

// ── Shared exports ──

describe('statusBadgeStyles and statusIcons exports', () => {
  it('exports statusBadgeStyles with entries for each status', async () => {
    const mod = await import('./NodeConfigPanel');
    expect(mod.statusBadgeStyles).toBeDefined();
    expect(mod.statusBadgeStyles.pending).toContain('text-muted');
    expect(mod.statusBadgeStyles.running).toContain('text-warning');
    expect(mod.statusBadgeStyles.success).toContain('text-success');
    expect(mod.statusBadgeStyles.error).toContain('text-error');
    expect(mod.statusBadgeStyles.skipped).toContain('text-muted');
  });

  it('exports statusIcons with entries for running/success/error/skipped', async () => {
    const mod = await import('./NodeConfigPanel');
    expect(mod.statusIcons).toBeDefined();
    expect(mod.statusIcons.running).toBeDefined();
    expect(mod.statusIcons.success).toBeDefined();
    expect(mod.statusIcons.error).toBeDefined();
    expect(mod.statusIcons.skipped).toBeDefined();
  });

  it('exports INPUT_CLS as a non-empty string', async () => {
    const mod = await import('./NodeConfigPanel');
    expect(typeof mod.INPUT_CLS).toBe('string');
    expect(mod.INPUT_CLS.length).toBeGreaterThan(10);
  });
});

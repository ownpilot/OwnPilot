// @vitest-environment happy-dom

/**
 * LlmConfigPanel tests.
 *
 * This is the largest config panel (~675 lines) with 3 major sections:
 *  1. Header with config/results tab bar
 *  2. Results tab — status badge, output (string/JSON), error, retry
 *  3. Config tab — provider quick-select, label, provider/model selects,
 *     system prompt, user message, temperature/max tokens, response format,
 *     conversation context, advanced (API key/Base URL), OutputTreeBrowser
 *
 * The component fetches providers and models asynchronously via
 * providersApi, so all renders mock these endpoints.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { LlmConfigPanel } from './LlmConfigPanel';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { providersApi } from '../../../api';

// ── mock providersApi ──

vi.mock('../../../api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    providersApi: {
      list: vi.fn(),
      models: vi.fn(),
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
  data: Record<string, unknown>,
  overrides: Partial<NodeConfigPanelProps> = {}
): NodeConfigPanelProps {
  return {
    node: {
      id: 'n1',
      type: 'llmNode',
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

/** Wait for pending microtasks (async useEffect callbacks) */
async function flushEffects() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Set up default API mocks for a standard render */
function setupApiMocks() {
  vi.mocked(providersApi.list).mockResolvedValue({
    providers: [
      { id: 'openai', name: 'OpenAI', isConfigured: true },
      { id: 'anthropic', name: 'Anthropic', isConfigured: true },
      { id: 'google', name: 'Google', isConfigured: false },
    ],
  } as never);
  vi.mocked(providersApi.models).mockResolvedValue({
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
  } as never);
}

// ── LlmConfigPanel ──

describe('LlmConfigPanel', () => {
  // ── A. Render & Structure ──

  it('renders the header title with the data.label', () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({ label: 'My LLM' }));
    expect(r.container.textContent).toContain('My LLM');
    r.cleanup();
  });

  it('fires onClose when the X button is clicked', () => {
    setupApiMocks();
    const onClose = vi.fn();
    const r = renderPanel(LlmConfigPanel, makeProps({}, { onClose }));
    const closeBtn = r.container.querySelector(
      'button[aria-label="Close"]'
    ) as HTMLButtonElement | null;
    act(() => closeBtn?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete with n1 when Delete LLM Node is clicked', () => {
    setupApiMocks();
    const onDelete = vi.fn();
    const r = renderPanel(LlmConfigPanel, makeProps({}, { onDelete }));
    const delBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete LLM Node'
    ) as HTMLButtonElement | null;
    act(() => delBtn?.click());
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  // ── B. Config Tab — Provider Quick Select ──

  it('renders configured provider buttons after API resolves', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    expect(r.container.textContent).toContain('OpenAI');
    expect(r.container.textContent).toContain('Anthropic');
    // Google is not configured → no quick-select button
    const buttons = Array.from(r.container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Google'
    );
    // Google appears in the dropdown, not as quick-select button
    expect(buttons.length).toBe(0);
    r.cleanup();
  });

  it('shows no-providers message when all providers are unconfigured', async () => {
    vi.mocked(providersApi.list).mockResolvedValue({
      providers: [{ id: 'custom', name: 'Custom API', isConfigured: false }],
    } as never);
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    expect(r.container.textContent).toContain('No AI providers configured');
    r.cleanup();
  });

  it('calls pushUpdate when a configured provider button is clicked', async () => {
    setupApiMocks();
    const onUpdate = vi.fn();
    const r = renderPanel(LlmConfigPanel, makeProps({}, { onUpdate }));
    await flushEffects();
    const openaiBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'OpenAI'
    ) as HTMLButtonElement | null;
    act(() => openaiBtn?.click());
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ provider: 'openai', model: '' })
    );
    r.cleanup();
  });

  // ── C. Config Tab — Provider & Model Selects ──

  it('renders the provider <select> with optgroups when providers are loaded', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    const select = r.container.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const options = Array.from(select?.querySelectorAll('option') ?? []).map((o) =>
      o.textContent?.trim()
    );
    expect(options).toContain('OpenAI');
    expect(options).toContain('Anthropic');
    expect(options).toContain('Google (no key)');
    r.cleanup();
  });

  it('renders the model <select> when models are loaded', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({ provider: 'openai' }));
    await flushEffects();
    // Two <select> elements: provider select and model select
    const selects = r.container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    const modelSelect = selects[1] as HTMLSelectElement | null;
    expect(modelSelect).not.toBeNull();
    expect(
      Array.from(modelSelect?.querySelectorAll('option') ?? []).map((o) => o.textContent?.trim())
    ).toContain('GPT-4o');
    r.cleanup();
  });

  it('falls back to text inputs when providers/models lists are empty', async () => {
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [] } as never);
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    // No <select> should exist for provider — fallback to text input
    expect(r.container.textContent).not.toContain('openai, anthropic');
    // Instead, verify the text input fallback is present by placeholder
    const providerInput = r.container.querySelector('input[placeholder*="openai"]');
    expect(providerInput).not.toBeNull();
    r.cleanup();
  });

  // ── D. Unconfigured Provider Warning ──

  it('shows the unconfigured provider warning when selected provider lacks API key', async () => {
    vi.mocked(providersApi.list).mockResolvedValue({
      providers: [{ id: 'custom', name: 'Custom', isConfigured: false }],
    } as never);
    const r = renderPanel(LlmConfigPanel, makeProps({ provider: 'custom' }));
    await flushEffects();
    expect(r.container.textContent).toContain('No API key for');
    r.cleanup();
  });

  it('shows no warning when the selected provider is configured', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({ provider: 'openai' }));
    await flushEffects();
    expect(r.container.textContent).not.toContain('No API key for');
    r.cleanup();
  });

  // ── E. Results Tab ──

  it('renders the Config tab by default and switches to Results when executionStatus is present', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ executionStatus: 'success', executionOutput: 'Hello' })
    );
    await flushEffects();
    // Defaults to results tab when executionStatus is set
    expect(r.container.textContent).toContain('success');
    expect(r.container.textContent).toContain('Hello');
    r.cleanup();
  });

  it('renders string execution output in a <pre> tag', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ executionStatus: 'success', executionOutput: 'Test output' })
    );
    await flushEffects();
    const pre = r.container.querySelector('pre');
    expect(pre?.textContent).toContain('Test output');
    r.cleanup();
  });

  it('renders JSON execution output in JsonTreeView', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({
        executionStatus: 'success',
        executionOutput: { result: 'ok', score: 42 },
      })
    );
    await flushEffects();
    // JsonTreeView renders keys without quotes (tree format)
    expect(r.container.textContent).toContain('result');
    expect(r.container.textContent).toContain('score');
    expect(r.container.textContent).toContain('ok');
    expect(r.container.textContent).toContain('42');
    r.cleanup();
  });

  it('renders executionError when present', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionError: 'rate limit exceeded',
      })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('rate limit exceeded');
    r.cleanup();
  });

  it('switches between Config and Results tabs via buttons', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({ executionStatus: 'success' }));
    await flushEffects();
    expect(r.container.textContent).toContain('success');
    // Click the Config tab button
    const configTabBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Config'
    ) as HTMLButtonElement | null;
    act(() => configTabBtn?.click());
    expect(r.container.textContent).toContain('OpenAI');
    r.cleanup();
  });

  it('displays retryAttempts in the results tab when > 0', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ executionStatus: 'success', retryAttempts: 2 })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('2');
    r.cleanup();
  });

  it('displays executionDuration in the results tab', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ executionStatus: 'success', executionDuration: 1234 })
    );
    await flushEffects();
    expect(r.container.textContent).toContain('1.2s');
    r.cleanup();
  });

  // ── F. Config Tab — Static fields ──

  it('renders the label, system prompt, user message, temperature, and max tokens with defaults', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    expect(r.container.textContent).toContain('System Prompt');
    expect(r.container.textContent).toContain('User Message');
    expect(r.container.textContent).toContain('Temperature');
    expect(r.container.textContent).toContain('Max Tokens');
    // Default values
    expect(
      (r.container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement)?.value
    ).toBe('0.7');
    expect(
      (r.container.querySelectorAll('input[type="number"]')[1] as HTMLInputElement)?.value
    ).toBe('4096');
    r.cleanup();
  });

  // ── G. Response Format ──

  it('renders the response format select with text/json options', async () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    await flushEffects();
    // Find the select with the "text" option
    expect(r.container.textContent).toContain('Text (default)');
    expect(r.container.textContent).toContain('JSON (auto-parsed)');
    r.cleanup();
  });

  it('pushes onUpdate when response format is changed to json', async () => {
    setupApiMocks();
    const onUpdate = vi.fn();
    const r = renderPanel(LlmConfigPanel, makeProps({}, { onUpdate }));
    await flushEffects();
    // Find the response format select by looking for the "json" option
    const allSelects = r.container.querySelectorAll('select');
    const responseFormatSelect = Array.from(allSelects).find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'json')
    );
    expect(responseFormatSelect).not.toBeNull();
    act(() => {
      responseFormatSelect!.value = 'json';
      responseFormatSelect?.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ responseFormat: 'json' })
    );
    r.cleanup();
  });

  // ── H. Conversation Context ──

  it('renders existing conversation messages with role/content', async () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({
        conversationMessages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      })
    );
    await flushEffects();
    // Message content is in input values (not textContent in happy-dom)
    const msgInputs = r.container.querySelectorAll('input[placeholder="Message content..."]');
    expect(msgInputs.length).toBe(2);
    expect((msgInputs[0] as HTMLInputElement)?.value).toBe('Hello');
    expect((msgInputs[1] as HTMLInputElement)?.value).toBe('Hi there');
    r.cleanup();
  });

  it('pushes onUpdate when a conversation message is removed', async () => {
    // Use empty providers to avoid cascading auto-select effects
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [] } as never);
    const onUpdate = vi.fn();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ conversationMessages: [{ role: 'user', content: 'test message' }] }, { onUpdate })
    );
    await flushEffects();
    const msgInput = r.container.querySelector('input[placeholder="Message content..."]');
    const msgRow = msgInput?.parentElement;
    const removeBtn = msgRow?.querySelector('button:last-child');
    expect(removeBtn).not.toBeNull();
    act(() => {
      removeBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.any(Object));
    const callArg = onUpdate.mock.calls[0]![1] as Record<string, unknown>;
    expect(callArg.conversationMessages).toBeUndefined();
    r.cleanup();
  });

  // ── I. Advanced (API Key / Base URL) ──

  it('toggles the advanced section when clicked', () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    // By default, advanced section is hidden
    expect(r.container.textContent).toContain('Show Advanced');
    expect(r.container.querySelector('input[placeholder="sk-..."]')).toBeNull();
    const toggleBtn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Advanced')
    ) as HTMLButtonElement | null;
    act(() => toggleBtn?.click());
    expect(r.container.querySelector('input[placeholder="sk-..."]')).not.toBeNull();
    expect(r.container.textContent).toContain('Hide Advanced');
    r.cleanup();
  });

  it('shows advanced section initially when apiKey or baseUrl is set', () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps({ apiKey: 'sk-test', baseUrl: 'https://custom.api' })
    );
    expect(r.container.textContent).toContain('Hide Advanced');
    expect(r.container.querySelector('input[placeholder="sk-..."]')).not.toBeNull();
    r.cleanup();
  });

  // ── J. Conditional OutputTreeBrowser ──

  it('renders OutputTreeBrowser when upstreamNodes are provided', () => {
    setupApiMocks();
    const r = renderPanel(
      LlmConfigPanel,
      makeProps(
        {},
        {
          upstreamNodes: [
            {
              id: 'node_1',
              type: 'toolNode',
              data: { label: 'Upstream' },
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
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    expect(r.container.textContent).not.toContain('Upstream Outputs');
    r.cleanup();
  });

  // ── K. OutputAliasField & RetryTimeoutFields ──

  it('renders OutputAliasField and RetryTimeoutFields', () => {
    setupApiMocks();
    const r = renderPanel(LlmConfigPanel, makeProps({}));
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    expect(r.container.textContent).toContain('Timeout');
    r.cleanup();
  });
});

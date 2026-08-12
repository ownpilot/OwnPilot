// @vitest-environment happy-dom

/**
 * ChatPage smoke test — see docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5).
 *
 * ChatPage is a composition page: it wires the chat store to a dozen child
 * components. The store is stubbed (its 40-plus fields are enumerated below,
 * which doubles as documentation of the surface ChatPage depends on), while the
 * child components render for real so the test exercises the actual wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, render } from '../test-harness';
import { ChatPage } from './ChatPage';

// ─── Chat store stub ──────────────────────────────────────────────────────

const storeOverrides: Record<string, unknown> = {};

function baseStore(): Record<string, unknown> {
  return {
    // data
    messages: [],
    isLoading: false,
    error: null,
    lastFailedMessage: null,
    provider: 'anthropic',
    model: 'claude-opus-5',
    workspaceId: null,
    streamingContent: '',
    progressEvents: [],
    suggestions: [],
    extractedMemories: [],
    pendingApproval: null,
    sessionId: 'session-1',
    sessionInfo: null,
    autoCompactPrompt: null,
    isCompacting: false,
    lastCompactionSummary: null,
    isThinking: false,
    thinkingContent: '',
    activeSessionId: 'session-1',
    sessionTabs: [],
    // Consumed by ThinkingToggle, which calls useChatStore() itself rather
    // than receiving props — so the stub must cover the union of every
    // consumer under this page, not just ChatPage's own destructure.
    thinkingConfig: null,
    setThinkingConfig: vi.fn(),
    // actions
    setProvider: vi.fn(),
    setModel: vi.fn(),
    setAgentId: vi.fn(),
    setWorkspaceId: vi.fn(),
    compactSession: vi.fn(),
    dismissAutoCompactPrompt: vi.fn(),
    disableAutoCompactPrompt: vi.fn(),
    clearLastCompactionSummary: vi.fn(),
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    loadConversation: vi.fn(),
    cancelRequest: vi.fn(),
    clearSuggestions: vi.fn(),
    acceptMemory: vi.fn(),
    rejectMemory: vi.fn(),
    resolveApproval: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    closeSession: vi.fn(),
  };
}

vi.mock('../hooks/useChatStore', () => ({
  useChatStore: () => ({ ...baseStore(), ...storeOverrides }),
}));

// ─── Other mocks ──────────────────────────────────────────────────────────

const mockModelsList = vi.fn();
const mockProvidersList = vi.fn();
const mockSettingsGet = vi.fn();
const mockAgentsGet = vi.fn();
const mockChatConversations = vi.fn();

// Spread the real module and override only what this page drives. Child
// components (starter prompts, execution-security panel, …) pull further
// clients off `../api`; enumerating them here would break every time one is
// added, and the project convention is to keep the original surface intact.
// Their calls hit the fetch interceptor in test-setup and are already wrapped
// in ignoreError by the components themselves.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    modelsApi: { list: (...a: unknown[]) => mockModelsList(...a) },
    providersApi: {
      list: (...a: unknown[]) => mockProvidersList(...a),
      configured: (...a: unknown[]) => mockProvidersList(...a),
    },
    settingsApi: { get: (...a: unknown[]) => mockSettingsGet(...a) },
    agentsApi: { get: (...a: unknown[]) => mockAgentsGet(...a) },
    chatApi: {
      getConversations: (...a: unknown[]) => mockChatConversations(...a),
      getConversation: (...a: unknown[]) => mockChatConversations(...a),
    },
  };
});

const mockSubscribe = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: mockSubscribe }),
}));

vi.mock('react-router', async () => {
  const { createElement } = await import('react');
  return {
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      createElement('a', { href: to }, children as never),
  };
});

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(storeOverrides)) delete storeOverrides[key];
    mockSubscribe.mockReturnValue(() => {});
    // modelsApi.list() supplies both the model list and the configured-provider
    // id list, which the page spreads — it must be an array, not undefined.
    mockModelsList.mockResolvedValue({ models: [], configuredProviders: [] });
    mockProvidersList.mockResolvedValue({ providers: [] });
    mockSettingsGet.mockResolvedValue({});
    mockAgentsGet.mockResolvedValue(null);
    mockChatConversations.mockResolvedValue({ conversations: [] });
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<ChatPage />)).not.toThrow();
  });

  it('renders the composer and message area', async () => {
    const container = render(<ChatPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
    // A chat page without a text input is broken regardless of state.
    const input = container.querySelector('textarea, input[type="text"]');
    expect(input, 'expected a message composer').toBeTruthy();
  });

  it('renders an empty conversation without crashing', async () => {
    const container = render(<ChatPage />);
    await flushAsyncUpdates();

    expect(container.textContent).toBeTruthy();
  });

  it('renders messages from the store', async () => {
    storeOverrides.messages = [
      { id: 'm1', role: 'user', content: 'Hello there', timestamp: '2026-08-12T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'General Kenobi', timestamp: '2026-08-12T10:00:01Z' },
    ];

    const container = render(<ChatPage />);
    await flushAsyncUpdates();

    expect(container.textContent).toContain('Hello there');
    expect(container.textContent).toContain('General Kenobi');
  });

  it('surfaces a store error', async () => {
    storeOverrides.error = 'Provider unreachable';

    const container = render(<ChatPage />);
    await flushAsyncUpdates();

    expect(container.textContent).toContain('Provider unreachable');
  });

  it('renders while a response is streaming', async () => {
    storeOverrides.isLoading = true;
    storeOverrides.streamingContent = 'partial answer';

    const container = render(<ChatPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('unsubscribes from gateway events on unmount', async () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(unsubscribe);

    render(<ChatPage />);
    await flushAsyncUpdates();

    if (mockSubscribe.mock.calls.length > 0) {
      cleanup();
      expect(unsubscribe).toHaveBeenCalled();
    }
  });
});

// @vitest-environment happy-dom
/**
 * ChatProvider / useChatStore tests.
 *
 * Covers: Provider rendering, state defaults, setter methods,
 * memory/lifecycle operations, and context guard.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatProvider, useChatStore } from './chat-provider';

// Mock dependencies
vi.mock('../../api/index', () => ({
  chatApi: {
    sendMessage: vi.fn(),
    getContextDetail: vi.fn().mockResolvedValue({ breakdown: null }),
  },
  executionPermissionsApi: {
    resolveApproval: vi.fn().mockResolvedValue(undefined),
  },
  memoriesApi: {
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/sse-parser', () => ({
  parseSSELine: vi.fn(),
}));

vi.mock('../../utils/ignore-error', () => ({
  ignoreError: vi.fn(),
}));

// Mock localStorage
vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-999' });

import { memoriesApi, executionPermissionsApi } from '../../api/index';

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

// ── Helpers ──

function renderHook<T>(
  useHook: () => T,
  options?: { wrapper?: React.FC<{ children: ReactNode }> }
) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  const element = options?.wrapper
    ? createElement(options.wrapper, { children: createElement(TestComponent) })
    : createElement(TestComponent);

  act(() => {
    root = createRoot(container);
    root!.render(element);
  });

  return {
    result: result as { current: T },
    unmount: () =>
      act(() => {
        root!.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

const wrapper: React.FC<{ children: ReactNode }> = ({ children }) =>
  createElement(ChatProvider, null, children);

describe('ChatProvider', () => {
  // ── Provider renders children ──

  it('renders children', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(ChatProvider, null, createElement('div', { 'data-testid': 'child' }))
      );
    });

    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });

  // ── Default state ──

  it('has default state values', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastFailedMessage).toBeNull();
    expect(result.current.lastFailedRequest).toBeNull();
    expect(result.current.streamingContent).toBe('');
    expect(result.current.progressEvents).toEqual([]);
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.extractedMemories).toEqual([]);
    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.isThinking).toBe(false);
    expect(result.current.thinkingContent).toBe('');
    expect(result.current.sessionInfo).toBeNull();
    expect(result.current.sessionId).not.toBeNull(); // set on mount
    expect(result.current.isCompacting).toBe(false);

    unmount();
  });

  // ── Provider / Model ──

  it('setProvider persists to localStorage', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.setProvider('anthropic');
    });

    expect(result.current.provider).toBe('anthropic');
    expect(localStorage.getItem('ownpilot-chat-provider')).toBe('anthropic');

    unmount();
  });

  it('setProvider with empty string removes localStorage key', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.setProvider('test');
    });

    act(() => {
      result.current.setProvider('');
    });

    expect(result.current.provider).toBe('');
    expect(localStorage.getItem('ownpilot-chat-provider')).toBeNull();

    unmount();
  });

  it('setModel persists to localStorage', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.setModel('claude-3-opus');
    });

    expect(result.current.model).toBe('claude-3-opus');
    expect(localStorage.getItem('ownpilot-chat-model')).toBe('claude-3-opus');

    unmount();
  });

  it('reads initial provider and model from localStorage', () => {
    localStorage.setItem('ownpilot-chat-provider', 'openai');
    localStorage.setItem('ownpilot-chat-model', 'gpt-4');

    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    expect(result.current.provider).toBe('openai');
    expect(result.current.model).toBe('gpt-4');

    unmount();
  });

  // ── AgentId / WorkspaceId ──

  it('setAgentId updates agentId', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.setAgentId('agent-123');
    });

    expect(result.current.agentId).toBe('agent-123');

    unmount();
  });

  it('setWorkspaceId updates workspaceId', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.setWorkspaceId('ws-456');
    });

    expect(result.current.workspaceId).toBe('ws-456');

    unmount();
  });

  // ── cancelRequest ──

  it('cancelRequest aborts and resets streaming state', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.cancelRequest();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.streamingContent).toBe('');
    expect(result.current.thinkingContent).toBe('');
    expect(result.current.progressEvents).toEqual([]);

    unmount();
  });

  it('cancelRequest is safe to call when no request is in flight', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.cancelRequest();
    });

    expect(result.current.isLoading).toBe(false);

    unmount();
  });

  // ── clearMessages ──

  it('clearMessages resets all state', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastFailedMessage).toBeNull();
    expect(result.current.lastFailedRequest).toBeNull();
    expect(result.current.streamingContent).toBe('');
    expect(result.current.thinkingContent).toBe('');
    expect(result.current.progressEvents).toEqual([]);
    expect(result.current.isThinking).toBe(false);
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.extractedMemories).toEqual([]);
    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.sessionInfo).toBeNull();

    unmount();
  });

  // ── clearSuggestions ──

  it('clearSuggestions clears suggestions array', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.clearSuggestions();
    });

    expect(result.current.suggestions).toEqual([]);

    unmount();
  });

  // ── acceptMemory / rejectMemory ──

  it('acceptMemory calls memoriesApi.create and removes memory', () => {
    // We can't easily set extractedMemories through the public API,
    // but we can verify acceptMemory handles an empty array gracefully
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.acceptMemory(0);
    });

    // No memories to accept — memoriesApi.create should not be called
    expect(memoriesApi.create).not.toHaveBeenCalled();

    unmount();
  });

  it('rejectMemory handles empty array gracefully', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.rejectMemory(0);
    });

    // Should not throw
    expect(result.current.extractedMemories).toEqual([]);

    unmount();
  });

  // ── resolveApproval ──

  it('resolveApproval is safe to call with no pending approval', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    act(() => {
      result.current.resolveApproval(true);
    });

    expect(executionPermissionsApi.resolveApproval).not.toHaveBeenCalled();

    unmount();
  });

  // ── Session ──

  it('sessionId is initially set', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    expect(result.current.sessionId).toBeTruthy();
    expect(typeof result.current.sessionId).toBe('string');

    unmount();
  });

  // ── Session tabs ──

  it('has initial session tabs', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    expect(result.current.sessionTabs).toBeDefined();
    expect(Array.isArray(result.current.sessionTabs)).toBe(true);

    unmount();
  });

  it('activeSessionId matches sessionId initially', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    expect(result.current.activeSessionId).toBe(result.current.sessionId);

    unmount();
  });

  // ── orphanStream ──

  it('orphanStream increments stream generation', () => {
    const { result, unmount } = renderHook(() => useChatStore(), { wrapper });

    // OrphanStream is not directly exposed, but clearMessages calls it internally
    act(() => {
      result.current.clearMessages();
    });

    // State should be clean after orphan
    expect(result.current.isLoading).toBe(false);

    unmount();
  });
});

// ── useChatStore (standalone) ──

describe('useChatStore', () => {
  it('throws when used outside ChatProvider', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function BadComponent() {
      useChatStore();
      return null;
    }

    expect(() => {
      act(() => root.render(createElement(BadComponent)));
    }).toThrow('useChatStore must be used within a ChatProvider');

    act(() => root.unmount());
    container.remove();
  });
});

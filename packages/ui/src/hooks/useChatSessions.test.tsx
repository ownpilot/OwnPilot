// @vitest-environment happy-dom
/**
 * useChatSessions tests — tab lifecycle (create/switch/close), snapshot
 * save/restore orchestration, and oldest-session eviction. The hook was
 * extracted from useChatStore; these are its first direct tests (previously
 * only reachable through the full ChatProvider).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useChatSessions, type ChatSessionController } from './useChatSessions';

interface TestSnap {
  messages: Array<{ role: string; content: string }>;
}

function renderHook<T>(useHook: () => T) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null as unknown as ReactNode;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(TestComponent));
  });

  return {
    result,
    unmount: () =>
      act(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

function makeController(overrides: Partial<ChatSessionController<TestSnap>> = {}) {
  let current: TestSnap = { messages: [] };
  const controller: ChatSessionController<TestSnap> = {
    capture: vi.fn(() => current),
    restore: vi.fn((snap: TestSnap) => {
      current = snap;
    }),
    clear: vi.fn(() => {
      current = { messages: [] };
    }),
    orphanStream: vi.fn(),
    setSessionId: vi.fn(),
    rejectPendingApproval: vi.fn(),
    ...overrides,
  };
  return {
    controller,
    setCurrent: (snap: TestSnap) => {
      current = snap;
    },
    getCurrent: () => current,
  };
}

const flush = () => act(async () => {});

afterEach(() => {
  document.body.replaceChildren();
});

describe('useChatSessions', () => {
  it('createSession with no messages clears state without adding a tab', () => {
    const { controller } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));

    let newId = '';
    act(() => {
      newId = result.current.createSession();
    });

    expect(result.current.sessionTabs).toHaveLength(0);
    expect(result.current.activeSessionId).toBe(newId);
    expect(controller.clear).toHaveBeenCalled();
    expect(controller.setSessionId).toHaveBeenCalledWith(newId);
    expect(controller.rejectPendingApproval).toHaveBeenCalled();
  });

  it('createSession with messages saves the old session as a tab titled by first user message', () => {
    const { controller, setCurrent } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));
    const oldId = result.current.activeSessionId;

    setCurrent({ messages: [{ role: 'user', content: 'hello world' }] });
    act(() => {
      result.current.createSession();
    });

    expect(result.current.sessionTabs).toHaveLength(1);
    expect(result.current.sessionTabs[0]).toMatchObject({ id: oldId, title: 'hello world' });
    expect(result.current.activeSessionId).not.toBe(oldId);
  });

  it('switchSession restores a cached snapshot and orphans the current stream', () => {
    const { controller, setCurrent } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));
    const firstId = result.current.activeSessionId;

    // Build up a first session, then create a new one (caches the first)
    setCurrent({ messages: [{ role: 'user', content: 'first session' }] });
    act(() => {
      result.current.createSession();
    });
    setCurrent({ messages: [{ role: 'user', content: 'second session' }] });

    act(() => {
      result.current.switchSession(firstId);
    });

    expect(controller.orphanStream).toHaveBeenCalled();
    expect(controller.restore).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'first session' }] })
    );
    expect(result.current.activeSessionId).toBe(firstId);
    // The second session became a tab
    expect(result.current.sessionTabs.map((t) => t.title)).toContain('second session');
  });

  it('switchSession to an uncached id clears state and sets the session id for DB load', () => {
    const { controller } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));

    act(() => {
      result.current.switchSession('db-session-id');
    });

    expect(controller.clear).toHaveBeenCalled();
    expect(controller.setSessionId).toHaveBeenCalledWith('db-session-id');
    expect(result.current.activeSessionId).toBe('db-session-id');
  });

  it('switchSession to the active session is a no-op', () => {
    const { controller } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));

    act(() => {
      result.current.switchSession(result.current.activeSessionId);
    });

    expect(controller.capture).not.toHaveBeenCalled();
    expect(controller.orphanStream).not.toHaveBeenCalled();
  });

  it('closing the active tab switches to the nearest remaining tab', async () => {
    const { controller, setCurrent } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));

    setCurrent({ messages: [{ role: 'user', content: 'tab one' }] });
    act(() => {
      result.current.createSession();
    });
    const secondId = result.current.activeSessionId;
    setCurrent({ messages: [{ role: 'user', content: 'tab two' }] });
    act(() => {
      result.current.createSession();
    });
    // Tabs: [tab one, tab two]; active is a third (fresh) session.
    expect(result.current.sessionTabs).toHaveLength(2);

    act(() => {
      result.current.switchSession(secondId);
    });
    act(() => {
      result.current.closeSession(secondId);
    });
    await flush(); // queueMicrotask switch

    // Closed the active tab — should have switched to the remaining one.
    expect(result.current.sessionTabs.find((t) => t.id === secondId)).toBeUndefined();
    expect(result.current.activeSessionId).not.toBe(secondId);
  });

  it('closing an inactive tab leaves the active session untouched', () => {
    const { controller, setCurrent } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));
    const firstId = result.current.activeSessionId;

    setCurrent({ messages: [{ role: 'user', content: 'background tab' }] });
    act(() => {
      result.current.createSession();
    });
    const activeId = result.current.activeSessionId;

    act(() => {
      result.current.closeSession(firstId);
    });

    expect(result.current.sessionTabs).toHaveLength(0);
    expect(result.current.activeSessionId).toBe(activeId);
  });

  it('evicts the oldest cached session beyond the max', () => {
    const { controller, setCurrent } = makeController();
    const { result } = renderHook(() => useChatSessions<TestSnap>(controller));
    const firstId = result.current.activeSessionId;

    // Create 11 sessions with messages — the first should be evicted (max 10).
    for (let i = 0; i < 11; i++) {
      setCurrent({ messages: [{ role: 'user', content: `session ${i}` }] });
      act(() => {
        result.current.createSession();
      });
    }

    expect(result.current.sessionTabs.length).toBe(10);
    expect(result.current.sessionTabs.find((t) => t.id === firstId)).toBeUndefined();
  });
});

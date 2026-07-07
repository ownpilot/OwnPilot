// @vitest-environment happy-dom

/**
 * useAutoCompact tests.
 *
 * Pure function: computeAutoCompactPrompt — threshold/hysteresis logic
 * Hook: useAutoCompact — state management, localStorage, API calls
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AUTO_COMPACT_CLEAR_BELOW,
  AUTO_COMPACT_MIN_MESSAGES,
  AUTO_COMPACT_THRESHOLD,
  computeAutoCompactPrompt,
  useAutoCompact,
} from './useAutoCompact';
import { chatApi } from '../api';
import { STORAGE_KEYS } from '../constants/storage-keys';

vi.mock('../api', () => ({
  chatApi: { compactContext: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'sess_1',
  contextFillPercent: AUTO_COMPACT_THRESHOLD,
  messageCount: AUTO_COMPACT_MIN_MESSAGES + 2,
  estimatedTokens: 50_000,
  maxContextTokens: 100_000,
  ...overrides,
});

// ── computeAutoCompactPrompt ──

describe('computeAutoCompactPrompt', () => {
  it('returns a prompt when over threshold with enough messages', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession(),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess_1');
    expect(result!.fillPercent).toBe(AUTO_COMPACT_THRESHOLD);
  });

  it('returns null when fill is below threshold', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_THRESHOLD - 10 }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('returns null when message count is below minimum', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ messageCount: AUTO_COMPACT_MIN_MESSAGES - 1 }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('returns null when declined for this session', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession(),
      prev: null,
      declined: true,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('returns null when currently compacting', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession(),
      prev: null,
      declined: false,
      isCompacting: true,
    });
    expect(result).toBeNull();
  });

  it('reuses prev when fill has not moved meaningfully (< 1%)', () => {
    const prev = {
      sessionId: 'sess_1',
      fillPercent: AUTO_COMPACT_THRESHOLD,
      estimatedTokens: 50_000,
      maxContextTokens: 100_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_THRESHOLD + 0.5 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBe(prev); // same object reference
  });

  it('creates a new prompt when fill moves meaningfully (>= 1%)', () => {
    const prev = {
      sessionId: 'sess_1',
      fillPercent: AUTO_COMPACT_THRESHOLD,
      estimatedTokens: 50_000,
      maxContextTokens: 100_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_THRESHOLD + 2 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBe(prev);
    expect(result!.fillPercent).toBe(AUTO_COMPACT_THRESHOLD + 2);
  });

  it('returns null when fill drops below clear point', () => {
    const prev = {
      sessionId: 'sess_1',
      fillPercent: AUTO_COMPACT_THRESHOLD,
      estimatedTokens: 50_000,
      maxContextTokens: 100_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_CLEAR_BELOW - 1 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('keeps prev in hysteresis band (between threshold and clear point)', () => {
    const prev = {
      sessionId: 'sess_1',
      fillPercent: AUTO_COMPACT_THRESHOLD,
      estimatedTokens: 50_000,
      maxContextTokens: 100_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({
        contextFillPercent: AUTO_COMPACT_CLEAR_BELOW,
        messageCount: AUTO_COMPACT_MIN_MESSAGES + 2,
      }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBe(prev);
  });
});

// ── useAutoCompact ──

/** Manual renderHook equivalent using createRoot */
function mountAutoCompact(provider: string, model: string) {
  const setSessionInfo = vi.fn();
  const resultRef: { current: ReturnType<typeof useAutoCompact> | null } = { current: null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function TestComponent() {
    const result = useAutoCompact({ provider, model, setSessionInfo });
    resultRef.current = result;
    return null;
  }

  act(() => root.render(createElement(TestComponent)));
  return {
    resultRef,
    setSessionInfo,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useAutoCompact', () => {
  it('returns default state', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    expect(t.resultRef.current!.isCompacting).toBe(false);
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();
    expect(t.resultRef.current!.autoCompactDisabled).toBe(false);
    expect(t.resultRef.current!.lastCompactionSummary).toBeNull();
    t.cleanup();
  });

  it('reads autoCompactDisabled from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED, '1');
    const t = mountAutoCompact('openai', 'gpt-4');
    expect(t.resultRef.current!.autoCompactDisabled).toBe(true);
    t.cleanup();
  });

  it('disableAutoCompactPrompt sets the flag and clears prompt', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    act(() => t.resultRef.current!.disableAutoCompactPrompt());
    expect(t.resultRef.current!.autoCompactDisabled).toBe(true);
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED)).toBe('1');
    t.cleanup();
  });

  it('dismissAutoCompactPrompt suppresses future prompts for the session', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    // Apply session info that would trigger a prompt
    act(() => t.resultRef.current!.applySessionInfo(makeSession()));
    expect(t.resultRef.current!.autoCompactPrompt).not.toBeNull();

    // Dismiss
    act(() => t.resultRef.current!.dismissAutoCompactPrompt());
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();

    // Apply again — should NOT re-prompt (declined for this session)
    act(() => t.resultRef.current!.applySessionInfo(makeSession({ estimatedTokens: 51_000 })));
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();
    t.cleanup();
  });

  it('applySessionInfo with null clears the prompt', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    act(() => t.resultRef.current!.applySessionInfo(makeSession()));
    expect(t.resultRef.current!.autoCompactPrompt).not.toBeNull();

    act(() => t.resultRef.current!.applySessionInfo(null));
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();
    t.cleanup();
  });

  it('resetAutoCompactPrompt clears prompt without recording decline', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    act(() => t.resultRef.current!.applySessionInfo(makeSession()));
    expect(t.resultRef.current!.autoCompactPrompt).not.toBeNull();

    act(() => t.resultRef.current!.resetAutoCompactPrompt());
    expect(t.resultRef.current!.autoCompactPrompt).toBeNull();

    // Re-apply — should re-prompt because we didn't decline
    act(() => t.resultRef.current!.applySessionInfo(makeSession({ estimatedTokens: 51_000 })));
    expect(t.resultRef.current!.autoCompactPrompt).not.toBeNull();
    t.cleanup();
  });

  it('clearLastCompactionSummary sets summary to null', () => {
    const t = mountAutoCompact('openai', 'gpt-4');
    const hook = t.resultRef.current!;
    expect(hook.lastCompactionSummary).toBeNull();
    act(() => hook.clearLastCompactionSummary());
    expect(hook.lastCompactionSummary).toBeNull();
    t.cleanup();
  });

  it('compactSession returns early when provider or model is empty', async () => {
    const t = mountAutoCompact('', '');
    const hook = t.resultRef.current!;
    const res = await act(async () => hook.compactSession());
    expect(res.compacted).toBe(false);
    expect(res.reason).toBeUndefined();
    t.cleanup();
  });

  it('compactSession calls chatApi.compactContext', async () => {
    vi.mocked(chatApi.compactContext).mockResolvedValue({
      compacted: true,
      removedMessages: 5,
      previousTokenEstimate: 100_000,
      newTokenEstimate: 30_000,
      summary: 'Compacted summary',
    } as never);
    const t = mountAutoCompact('openai', 'gpt-4');
    const res = await act(async () => t.resultRef.current!.compactSession(6));
    expect(chatApi.compactContext).toHaveBeenCalledWith('openai', 'gpt-4', 6);
    expect(res.compacted).toBe(true);
    expect(res.removedMessages).toBe(5);
    expect(res.savedTokens).toBe(70_000);
    expect(t.resultRef.current!.lastCompactionSummary).toBe('Compacted summary');
    t.cleanup();
  });

  it('compactSession handles API error', async () => {
    vi.mocked(chatApi.compactContext).mockRejectedValue(new Error('API down'));
    const t = mountAutoCompact('openai', 'gpt-4');
    const hook = t.resultRef.current!;
    const res = await act(async () => hook.compactSession());
    expect(res.compacted).toBe(false);
    expect(res.reason).toBe('exception');
    expect(hook.isCompacting).toBe(false);
    t.cleanup();
  });
});

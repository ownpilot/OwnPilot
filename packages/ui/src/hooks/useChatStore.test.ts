// @vitest-environment happy-dom
/**
 * Unit tests for the pure helpers and types exported from useChatStore.
 *
 * Focuses on `computeAutoCompactPrompt` — the threshold + hysteresis logic
 * that decides whether to surface the auto-compact suggestion banner.
 * Also tests `parseProgressEvent` from the underlying chat/types module,
 * and verifies that ChatProvider / useChatStore are wired correctly.
 *
 * The full ChatProvider tree is intentionally NOT mounted in the
 * computeAutoCompactPrompt block; rendering/error-throw tests are
 * in the ChatProvider/useChatStore blocks below.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AUTO_COMPACT_CLEAR_BELOW,
  AUTO_COMPACT_MIN_MESSAGES,
  AUTO_COMPACT_THRESHOLD,
  computeAutoCompactPrompt,
  ChatProvider,
  useChatStore,
  type AutoCompactPromptState,
} from './useChatStore';
import type { SessionInfo } from '../types';
import { parseProgressEvent } from './chat/types';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'sess-1',
    messageCount: 12,
    estimatedTokens: 100_000,
    maxContextTokens: 128_000,
    contextFillPercent: AUTO_COMPACT_THRESHOLD,
    ...overrides,
  };
}

describe('computeAutoCompactPrompt', () => {
  it('returns null when fill is below the threshold', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: 50 }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('raises a prompt when fill crosses the threshold', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_THRESHOLD }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe('sess-1');
    expect(result?.fillPercent).toBe(AUTO_COMPACT_THRESHOLD);
  });

  it('does not raise a prompt when the user has declined for this session', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: 95 }),
      prev: null,
      declined: true,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('does not raise a prompt while a compaction is already running', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: 95 }),
      prev: null,
      declined: false,
      isCompacting: true,
    });
    expect(result).toBeNull();
  });

  it('does not raise a prompt when messageCount is below the server compact floor', () => {
    // Server-side compactContext requires `messages.length > keepRecent + 2`
    // (default 6+2 = 8). The UI threshold (AUTO_COMPACT_MIN_MESSAGES = 9)
    // matches so the user can't accept a banner that the server would reject.
    const result = computeAutoCompactPrompt({
      next: makeSession({
        contextFillPercent: 95,
        messageCount: AUTO_COMPACT_MIN_MESSAGES - 1,
      }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('raises a prompt at exactly the message floor', () => {
    const result = computeAutoCompactPrompt({
      next: makeSession({
        contextFillPercent: 95,
        messageCount: AUTO_COMPACT_MIN_MESSAGES,
      }),
      prev: null,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBeNull();
  });

  it('reuses the previous prompt object when fill barely moved (stability)', () => {
    const prev: AutoCompactPromptState = {
      sessionId: 'sess-1',
      fillPercent: 86,
      estimatedTokens: 100_000,
      maxContextTokens: 128_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: 86 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    // Same object identity — avoids spurious re-renders on every stream chunk.
    expect(result).toBe(prev);
  });

  it('emits a new prompt object when fill moves by ≥1 point', () => {
    const prev: AutoCompactPromptState = {
      sessionId: 'sess-1',
      fillPercent: 86,
      estimatedTokens: 100_000,
      maxContextTokens: 128_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: 90, estimatedTokens: 115_000 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBe(prev);
    expect(result?.fillPercent).toBe(90);
    expect(result?.estimatedTokens).toBe(115_000);
  });

  it('clears the prompt when fill drops below the hysteresis band', () => {
    const prev: AutoCompactPromptState = {
      sessionId: 'sess-1',
      fillPercent: 90,
      estimatedTokens: 115_000,
      maxContextTokens: 128_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_CLEAR_BELOW - 1 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBeNull();
  });

  it('keeps an existing prompt inside the hysteresis band (between clear & threshold)', () => {
    const prev: AutoCompactPromptState = {
      sessionId: 'sess-1',
      fillPercent: 86,
      estimatedTokens: 110_000,
      maxContextTokens: 128_000,
    };
    // Fill dipped just below the threshold but is still inside the band — we
    // should NOT re-raise (overThreshold is false) and NOT clear (above
    // CLEAR_BELOW). Behavior: keep showing whatever was there.
    const result = computeAutoCompactPrompt({
      next: makeSession({ contextFillPercent: AUTO_COMPACT_THRESHOLD - 1 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).toBe(prev);
  });

  it('replaces the prompt when the sessionId changes (new conversation)', () => {
    const prev: AutoCompactPromptState = {
      sessionId: 'sess-1',
      fillPercent: 90,
      estimatedTokens: 115_000,
      maxContextTokens: 128_000,
    };
    const result = computeAutoCompactPrompt({
      next: makeSession({ sessionId: 'sess-2', contextFillPercent: 90 }),
      prev,
      declined: false,
      isCompacting: false,
    });
    expect(result).not.toBe(prev);
    expect(result?.sessionId).toBe('sess-2');
  });
});

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

describe('auto-compact constants', () => {
  it('exports AUTO_COMPACT_THRESHOLD as a number >= 75', () => {
    expect(AUTO_COMPACT_THRESHOLD).toBeGreaterThanOrEqual(75);
  });

  it('exports AUTO_COMPACT_CLEAR_BELOW as a number less than the threshold', () => {
    expect(AUTO_COMPACT_CLEAR_BELOW).toBeLessThan(AUTO_COMPACT_THRESHOLD);
    expect(AUTO_COMPACT_CLEAR_BELOW).toBeGreaterThanOrEqual(0);
  });

  it('exports AUTO_COMPACT_MIN_MESSAGES as a number >= 1', () => {
    expect(AUTO_COMPACT_MIN_MESSAGES).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────
// ChatProvider / useChatStore — basic wiring
// ─────────────────────────────────────────────

afterEach(() => {
  document.body.replaceChildren();
});

describe('ChatProvider', () => {
  it('renders children', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(
        createElement(ChatProvider, null, createElement('div', { 'data-testid': 'child' }, 'Hello'))
      );
    });

    const child = container.querySelector('[data-testid="child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe('Hello');
  });

  it('provides useChatStore context', () => {
    const result: { current: unknown } = { current: null };
    const container = document.createElement('div');
    document.body.appendChild(container);

    function Reader() {
      result.current = useChatStore();
      return null;
    }

    act(() => {
      createRoot(container).render(createElement(ChatProvider, null, createElement(Reader)));
    });

    const store = result.current as Record<string, unknown>;
    expect(store).not.toBeNull();
    expect(typeof store.sendMessage).toBe('function');
    expect(typeof store.clearMessages).toBe('function');
    expect(typeof store.setProvider).toBe('function');
    expect(Array.isArray(store.messages)).toBe(true);
    expect(typeof store.isLoading).toBe('boolean');
  });
});

describe('useChatStore', () => {
  it('throws when used outside ChatProvider', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    expect(() => {
      function BadComponent() {
        useChatStore();
        return null;
      }
      act(() => {
        createRoot(container).render(createElement(BadComponent));
      });
    }).toThrow('useChatStore must be used within a ChatProvider');

    document.body.removeChild(container);
  });
});

// ─────────────────────────────────────────────
// parseProgressEvent (from chat/types)
// ─────────────────────────────────────────────

describe('parseProgressEvent', () => {
  it('returns null for unknown event type', () => {
    const result = parseProgressEvent({ type: 'unknown', timestamp: '2024-01-01T00:00:00Z' });
    expect(result).toBeNull();
  });

  it('returns null for empty object', () => {
    const result = parseProgressEvent({} as { type: string; [key: string]: unknown });
    expect(result).toBeNull();
  });

  it('parses a status progress event', () => {
    const result = parseProgressEvent({
      type: 'status',
      message: 'Processing...',
      timestamp: '2024-06-15T10:30:00Z',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('status');
    expect(result?.message).toBe('Processing...');
    expect(result?.timestamp).toBe('2024-06-15T10:30:00Z');
  });

  it('parses a tool_start progress event', () => {
    const result = parseProgressEvent({
      type: 'tool_start',
      tool: { id: 'tool-1', name: 'search', arguments: { query: 'test' } },
      timestamp: '2024-06-15T10:30:01Z',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_start');
    expect(result?.tool?.id).toBe('tool-1');
    expect(result?.tool?.name).toBe('search');
    expect(result?.tool?.arguments).toEqual({ query: 'test' });
  });

  it('parses a tool_end progress event with result', () => {
    const result = parseProgressEvent({
      type: 'tool_end',
      toolCall: { id: 'tc-1', name: 'readFile' },
      result: { success: true, preview: 'file content', durationMs: 150 },
      timestamp: '2024-06-15T10:30:02Z',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_end');
    expect(result?.toolCall?.id).toBe('tc-1');
    expect(result?.result?.success).toBe(true);
    expect(result?.result?.preview).toBe('file content');
    expect(result?.result?.durationMs).toBe(150);
  });

  it('parses a tool_blocked progress event with reason', () => {
    const result = parseProgressEvent({
      type: 'tool_blocked',
      tool: { id: 't-2', name: 'writeFile', reason: 'requires approval' },
      reason: 'Permission required',
      timestamp: '2024-06-15T10:30:03Z',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_blocked');
    expect(result?.tool?.id).toBe('t-2');
    expect(result?.reason).toBe('Permission required');
  });

  it('rejects invalid tool data (missing id)', () => {
    const result = parseProgressEvent({
      type: 'tool_start',
      tool: { name: 'search' }, // missing id
      timestamp: '2024-06-15T10:30:04Z',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_start');
    expect(result?.tool).toBeUndefined();
  });

  it('rejects invalid result data (missing fields)', () => {
    const result = parseProgressEvent({
      type: 'tool_end',
      result: { success: true }, // missing preview and durationMs
      timestamp: '2024-06-15T10:30:05Z',
    });
    expect(result).not.toBeNull();
    expect(result?.result).toBeUndefined();
  });

  it('includes data field when present', () => {
    const result = parseProgressEvent({
      type: 'status',
      data: { key: 'value', nested: { a: 1 } },
      timestamp: '2024-06-15T10:30:06Z',
    });
    expect(result).not.toBeNull();
    expect(result?.data).toEqual({ key: 'value', nested: { a: 1 } });
  });

  it('uses current timestamp when timestamp is missing or invalid', () => {
    const before = new Date();
    const result = parseProgressEvent({ type: 'status' });
    const after = new Date();
    expect(result).not.toBeNull();
    expect(result?.type).toBe('status');
    const parsedTime = new Date(result!.timestamp).getTime();
    expect(parsedTime).toBeGreaterThanOrEqual(before.getTime());
    expect(parsedTime).toBeLessThanOrEqual(after.getTime());
  });

  it('includes sandboxed and executionMode in result when present', () => {
    const result = parseProgressEvent({
      type: 'tool_end',
      result: {
        success: true,
        preview: 'ok',
        durationMs: 200,
        sandboxed: true,
        executionMode: 'docker',
      },
      timestamp: '2024-06-15T10:30:07Z',
    });
    expect(result?.result?.sandboxed).toBe(true);
    expect(result?.result?.executionMode).toBe('docker');
  });

  it('skips executionMode when it is not a valid enum value', () => {
    const result = parseProgressEvent({
      type: 'tool_end',
      result: { success: true, preview: 'ok', durationMs: 200, executionMode: 'invalid' },
      timestamp: '2024-06-15T10:30:08Z',
    });
    expect(result?.result?.executionMode).toBeUndefined();
  });
});

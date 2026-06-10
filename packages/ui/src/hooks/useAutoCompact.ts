/**
 * Auto-compact concern of the chat store.
 *
 * Owns the threshold/hysteresis prompt state, the per-session decline set,
 * the persistent opt-out, the compact-in-progress flag, and the manual/auto
 * compactSession call. Extracted from useChatStore so the compaction logic
 * is reviewable on its own; the ChatProvider wires it in and keeps the
 * public ChatStore API unchanged.
 *
 * The provider still owns `sessionInfo` — this hook receives the setter and
 * writes through it in applySessionInfo, so every code path (stream done,
 * non-stream done, refresh, compact result) gets identical treatment.
 */

import { useState, useRef, useCallback } from 'react';
import type { SessionInfo } from '../types';
import { chatApi } from '../api';
import { STORAGE_KEYS } from '../constants/storage-keys';

/**
 * Auto-compact threshold. Crossing this fill percent raises a one-time
 * suggestion to compact older messages into a summary. Kept at module scope
 * so tests can import and reason about it directly.
 */
export const AUTO_COMPACT_THRESHOLD = 85;

/** Hysteresis below the threshold — clear the prompt once we drop this far. */
export const AUTO_COMPACT_CLEAR_BELOW = AUTO_COMPACT_THRESHOLD - 5;

/**
 * Minimum messages required before the banner appears. The server requires
 * `messages.length > keepRecentMessages + 2` (default keepRecent = 6, so >8)
 * to actually compact — without this guard the user could accept the banner
 * and silently get `compacted: false`.
 */
export const AUTO_COMPACT_MIN_MESSAGES = 9;

export interface AutoCompactPromptState {
  sessionId: string;
  fillPercent: number;
  estimatedTokens: number;
  maxContextTokens: number;
}

/**
 * Pure decision function: given the new sessionInfo, the previous prompt
 * state, and whether the user has declined for this session, return the
 * prompt that should be shown (or null).
 *
 * Extracted as a standalone export so the threshold + hysteresis logic can be
 * tested without rendering the full ChatProvider tree.
 */
export function computeAutoCompactPrompt(input: {
  next: SessionInfo;
  prev: AutoCompactPromptState | null;
  declined: boolean;
  isCompacting: boolean;
}): AutoCompactPromptState | null {
  const { next, prev, declined, isCompacting } = input;
  const fill = next.contextFillPercent ?? 0;
  const overThreshold =
    fill >= AUTO_COMPACT_THRESHOLD &&
    next.messageCount >= AUTO_COMPACT_MIN_MESSAGES &&
    !declined &&
    !isCompacting;

  if (overThreshold) {
    // Reuse the existing prompt when the fill percent hasn't moved
    // meaningfully — prevents spurious re-renders on every stream chunk.
    if (prev && prev.sessionId === next.sessionId && Math.abs(prev.fillPercent - fill) < 1) {
      return prev;
    }
    return {
      sessionId: next.sessionId,
      fillPercent: fill,
      estimatedTokens: next.estimatedTokens,
      maxContextTokens: next.maxContextTokens,
    };
  }
  // Below the clear point — drop the prompt entirely. Between threshold and
  // clear point (hysteresis band), keep whatever was there.
  if (fill < AUTO_COMPACT_CLEAR_BELOW) return null;
  return prev;
}

export interface CompactSessionResult {
  compacted: boolean;
  removedMessages: number;
  savedTokens: number;
  /** Server-provided reason when `compacted` is false (e.g. `too_few_messages`). */
  reason?: string;
  /** Structured summary text the server generated (only on success). */
  summary?: string;
}

export interface UseAutoCompactResult {
  isCompacting: boolean;
  autoCompactPrompt: AutoCompactPromptState | null;
  /** True when the user has opted out of the auto-compact banner. */
  autoCompactDisabled: boolean;
  /** Most recent compaction summary text (null until a compaction succeeds). */
  lastCompactionSummary: string | null;
  /**
   * Apply a new sessionInfo (writes through the injected setter) and raise or
   * clear the auto-compact prompt according to threshold + hysteresis.
   */
  applySessionInfo: (next: SessionInfo | null) => void;
  /** Dismiss the suggestion until the next session change. */
  dismissAutoCompactPrompt: () => void;
  /** Permanently disable the banner (persisted to localStorage). */
  disableAutoCompactPrompt: () => void;
  clearLastCompactionSummary: () => void;
  /** Drop the prompt without recording a decline (e.g. on loadConversation). */
  resetAutoCompactPrompt: () => void;
  /** Manually compact the current chat context. Updates sessionInfo from the server response. */
  compactSession: (keepRecentMessages?: number) => Promise<CompactSessionResult>;
}

export function useAutoCompact(opts: {
  provider: string;
  model: string;
  /** The ChatProvider's sessionInfo setter — applySessionInfo writes through it. */
  setSessionInfo: (info: SessionInfo | null) => void;
}): UseAutoCompactResult {
  const { provider, model, setSessionInfo } = opts;

  const [isCompacting, setIsCompacting] = useState(false);
  const [autoCompactPrompt, setAutoCompactPrompt] = useState<AutoCompactPromptState | null>(null);
  // Track which sessionIds the user has already declined an auto-compact for,
  // so we don't re-prompt on every chunk after they say "not now".
  const autoCompactSuppressedRef = useRef<Set<string>>(new Set());
  // Persistent opt-out — survives page reloads. Read once at mount.
  const [autoCompactDisabled, setAutoCompactDisabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED) === '1';
    } catch {
      return false;
    }
  });
  const [lastCompactionSummary, setLastCompactionSummary] = useState<string | null>(null);

  const applySessionInfo = useCallback(
    (next: SessionInfo | null) => {
      setSessionInfo(next);
      if (!next) {
        setAutoCompactPrompt(null);
        return;
      }
      if (autoCompactDisabled) {
        setAutoCompactPrompt(null);
        return;
      }
      setAutoCompactPrompt((prev) =>
        computeAutoCompactPrompt({
          next,
          prev,
          declined: autoCompactSuppressedRef.current.has(next.sessionId),
          isCompacting,
        })
      );
    },
    [isCompacting, autoCompactDisabled, setSessionInfo]
  );

  const dismissAutoCompactPrompt = useCallback(() => {
    setAutoCompactPrompt((prev) => {
      if (prev) autoCompactSuppressedRef.current.add(prev.sessionId);
      return null;
    });
  }, []);

  const disableAutoCompactPrompt = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED, '1');
    } catch {
      /* localStorage might be blocked — in-memory toggle still applies */
    }
    setAutoCompactDisabled(true);
    setAutoCompactPrompt(null);
  }, []);

  const clearLastCompactionSummary = useCallback(() => {
    setLastCompactionSummary(null);
  }, []);

  const resetAutoCompactPrompt = useCallback(() => {
    setAutoCompactPrompt(null);
  }, []);

  const compactSession = useCallback(
    async (keepRecentMessages?: number): Promise<CompactSessionResult> => {
      if (!provider || !model) {
        return { compacted: false, removedMessages: 0, savedTokens: 0 };
      }
      setIsCompacting(true);
      setAutoCompactPrompt(null);
      try {
        const d = await chatApi.compactContext(provider, model, keepRecentMessages);
        if (d?.session) {
          // Server returns post-compact SessionInfo — apply it directly so
          // the bar reflects the new state without waiting for the next msg.
          applySessionInfo(d.session);
        }
        if (d?.compacted && d.summary) {
          setLastCompactionSummary(d.summary);
        }
        const saved = Math.max(0, (d?.previousTokenEstimate ?? 0) - (d?.newTokenEstimate ?? 0));
        return {
          compacted: !!d?.compacted,
          removedMessages: d?.removedMessages ?? 0,
          savedTokens: saved,
          ...(d?.reason && { reason: d.reason }),
          ...(d?.summary && { summary: d.summary }),
        };
      } catch {
        return {
          compacted: false,
          removedMessages: 0,
          savedTokens: 0,
          reason: 'exception',
        };
      } finally {
        setIsCompacting(false);
      }
    },
    [provider, model, applySessionInfo]
  );

  return {
    isCompacting,
    autoCompactPrompt,
    autoCompactDisabled,
    lastCompactionSummary,
    applySessionInfo,
    dismissAutoCompactPrompt,
    disableAutoCompactPrompt,
    clearLastCompactionSummary,
    resetAutoCompactPrompt,
    compactSession,
  };
}

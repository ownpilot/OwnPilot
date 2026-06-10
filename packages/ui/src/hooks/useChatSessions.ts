/**
 * Multi-session (tab) concern of the chat store.
 *
 * Owns the snapshot map, active session id, and tab list; orchestrates
 * create/switch/close. Extracted from useChatStore — the ChatProvider keeps
 * owning the per-conversation state and hands this hook a small controller
 * (capture/restore/clear/orphan/reject) so the tab lifecycle logic is
 * separated from the streaming machinery.
 *
 * Generic over the snapshot type: this hook only needs `messages` (for tab
 * titles); everything else in a snapshot is opaque to it, which also avoids
 * a circular type dependency on useChatStore.
 */

import { useState, useRef, useCallback } from 'react';

/** Tab entry for the session tab bar */
export interface SessionTab {
  id: string;
  title: string;
  createdAt: number;
}

const MAX_SESSIONS = 10;

export interface ChatSessionController<TSnap> {
  /** Capture the current per-conversation state. */
  capture: () => TSnap;
  /** Restore a previously captured snapshot. */
  restore: (snap: TSnap) => void;
  /** Clear all per-conversation state for a fresh session (also orphans streams). */
  clear: () => void;
  /**
   * Orphan any running stream WITHOUT clearing state — the stream keeps
   * draining in the background so the backend persists, but UI updates are
   * suppressed (generation check in sendMessage).
   */
  orphanStream: () => void;
  /** Set the backend conversation id (client-pre-generated UUID pattern). */
  setSessionId: (id: string | null) => void;
  /** Reject any pending execution approval so the backend doesn't hang. */
  rejectPendingApproval: () => void;
}

export interface UseChatSessionsResult {
  activeSessionId: string;
  sessionTabs: SessionTab[];
  createSession: () => string;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
}

export function useChatSessions<
  TSnap extends { messages: Array<{ role: string; content: string }> },
>(controller: ChatSessionController<TSnap>): UseChatSessionsResult {
  const { capture, restore, clear, orphanStream, setSessionId, rejectPendingApproval } = controller;

  const sessionsRef = useRef(new Map<string, TSnap>());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  // Set when closeSession closes the ACTIVE tab: the queued switchSession must
  // NOT re-save the departing (closed) session, or its tab reappears in the
  // bar right after the user closed it.
  const skipNextSaveRef = useRef(false);

  /** Create a new session — saves current to map, clears UI */
  const createSession = useCallback((): string => {
    const currentId = activeSessionId;
    const snap = capture();
    // Only save if there are actual messages (sessionId is always set now via pre-generation)
    if (snap.messages.length > 0) {
      sessionsRef.current.set(currentId, snap);
      const title =
        snap.messages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'New Chat';
      setSessionTabs((prev) => {
        if (prev.find((t) => t.id === currentId)) return prev;
        return [...prev, { id: currentId, title, createdAt: Date.now() }];
      });
    }
    // Reject pending approval before switching
    rejectPendingApproval();
    const newId = crypto.randomUUID();
    setActiveSessionId(newId);
    clear();
    // Pre-set sessionId so the first message includes conversationId in the request.
    // This follows the client-generated ID pattern (NextChat, LobeChat, big-AGI).
    // The backend accepts unknown IDs and auto-creates the conversation (FIX-1).
    setSessionId(newId);
    // Enforce max sessions — evict oldest
    if (sessionsRef.current.size > MAX_SESSIONS) {
      const entries = [...sessionsRef.current.entries()];
      const oldestKey = entries[0]?.[0];
      if (oldestKey) {
        sessionsRef.current.delete(oldestKey);
        setSessionTabs((prev) => prev.filter((t) => t.id !== oldestKey));
      }
    }
    return newId;
  }, [activeSessionId, capture, clear, setSessionId, rejectPendingApproval]);

  /** Switch to an existing session (from tab or sidebar) */
  const switchSession = useCallback(
    (targetId: string) => {
      if (targetId === activeSessionId) return;
      // Save current active session — unless it was just closed (closeSession
      // sets the skip flag before queueing this switch).
      const skipSave = skipNextSaveRef.current;
      skipNextSaveRef.current = false;
      if (!skipSave) {
        const currentId = activeSessionId;
        const snap = capture();
        sessionsRef.current.set(currentId, snap);
        setSessionTabs((prev) => {
          if (prev.find((t) => t.id === currentId)) return prev;
          const title =
            snap.messages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'New Chat';
          return [...prev, { id: currentId, title, createdAt: Date.now() }];
        });
      }
      // Orphan current stream
      orphanStream();
      // Restore target from map (if cached) or set sessionId for DB load
      const target = sessionsRef.current.get(targetId);
      if (target) {
        restore(target);
        sessionsRef.current.delete(targetId);
      } else {
        clear();
        setSessionId(targetId);
      }
      setActiveSessionId(targetId);
    },
    [activeSessionId, capture, restore, clear, orphanStream, setSessionId]
  );

  /** Close a session tab */
  const closeSession = useCallback(
    (targetId: string) => {
      sessionsRef.current.delete(targetId);
      setSessionTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== targetId);
        if (targetId === activeSessionId) {
          if (remaining.length > 0) {
            const nearest = remaining[remaining.length - 1]!;
            // The departing session was closed — don't let the switch re-save
            // it (that would put the closed tab right back in the bar).
            skipNextSaveRef.current = true;
            queueMicrotask(() => switchSession(nearest.id));
          } else {
            queueMicrotask(() => {
              setActiveSessionId(crypto.randomUUID());
              clear();
            });
          }
        }
        return remaining;
      });
    },
    [activeSessionId, switchSession, clear]
  );

  return { activeSessionId, sessionTabs, createSession, switchSession, closeSession };
}

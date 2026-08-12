/**
 * useWizardDraftSync — auto-save wizard state to localStorage and restore on
 * mount, working alongside a wizard's existing `useState` calls.
 *
 * Usage:
 *   const { clear, restored } = useWizardDraftSync('ai-provider', {
 *     getSnapshot: () => ({ apiKey, model }),
 *     applySnapshot: (s) => { if (s.apiKey) setApiKey(s.apiKey); },
 *   });
 *   clear();      // call on successful complete
 *   restored      // true if a saved draft was applied at mount
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'ownpilot-wizard-draft:';
const DEBOUNCE_MS = 400;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Stored<T> {
  state: T;
  savedAt: number;
}

/**
 * Lightweight draft sync — works with existing `useState` calls.
 * On mount, applies any saved snapshot via `applySnapshot`. While the wizard
 * is open, snapshots from `getSnapshot()` are saved (debounced).
 */
export function useWizardDraftSync<T extends object>(
  wizardId: string,
  opts: {
    getSnapshot: () => T;
    applySnapshot: (s: Partial<T>) => void;
    /** Disable auto-save while in this state — e.g. final completion step. */
    paused?: boolean;
  }
): { clear: () => void; restored: boolean } {
  const key = STORAGE_PREFIX + wizardId;
  const { getSnapshot, applySnapshot, paused = false } = opts;
  const appliedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restored, setRestored] = useState(false);

  // Apply saved snapshot once on mount
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored<T>;
      if (!parsed || typeof parsed !== 'object') return;
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
        return;
      }
      applySnapshot(parsed.state);
      setRestored(true);
    } catch {
      /* noop */
    }
  }, [key]);

  // Debounced auto-save
  const snapshot = getSnapshot();
  useEffect(() => {
    if (paused) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const stored: Stored<T> = { state: snapshot, savedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(stored));
      } catch {
        /* noop */
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [JSON.stringify(snapshot), paused, key]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }, [key]);

  return { clear, restored };
}

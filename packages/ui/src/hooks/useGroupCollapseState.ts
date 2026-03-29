/**
 * useGroupCollapseState — manages open/closed state for collapsible groups.
 *
 * Persists to localStorage[STORAGE_KEYS.GROUP_COLLAPSE] as Record<string, boolean>.
 * Groups default to open (true) unless explicitly collapsed.
 */
import { useState, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

type CollapseState = Record<string, boolean>;

function readState(): CollapseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GROUP_COLLAPSE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CollapseState;
      }
    }
  } catch {
    // Malformed JSON — fall through to empty
  }
  return {};
}

export function useGroupCollapseState() {
  const [state, setState] = useState<CollapseState>(() => readState());

  const isOpen = useCallback(
    (groupId: string): boolean => state[groupId] !== false,
    [state],
  );

  const toggle = useCallback((groupId: string) => {
    setState((prev) => {
      const wasOpen = prev[groupId] !== false; // default open
      const next = { ...prev, [groupId]: !wasOpen };
      try {
        localStorage.setItem(STORAGE_KEYS.GROUP_COLLAPSE, JSON.stringify(next));
      } catch {
        // Storage full or unavailable
      }
      return next;
    });
  }, []);

  return { isOpen, toggle };
}

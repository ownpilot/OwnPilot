/**
 * usePinnedItems — manages the user's pinned sidebar navigation items.
 *
 * Uses React Context so that all consumers (Sidebar, CustomizePage, etc.)
 * share the same state instance. PinnedItemsProvider must wrap the tree.
 *
 * Persists to localStorage[STORAGE_KEYS.SIDEBAR_PINNED] as a string[].
 * Runs one-time migration from legacy 'ownpilot_nav_groups' key.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

export const MAX_PINNED_ITEMS = 15;

const DEFAULT_PINNED: string[] = ['/', '/dashboard'];

function runMigration(): void {
  try {
    const hasOldKey = localStorage.getItem(STORAGE_KEYS.NAV_GROUPS) !== null;
    const hasNewKey = localStorage.getItem(STORAGE_KEYS.SIDEBAR_PINNED) !== null;
    if (hasOldKey && !hasNewKey) {
      // Old key held group collapse state (not pin state) — apply defaults for new key
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_PINNED, JSON.stringify(DEFAULT_PINNED));
      localStorage.removeItem(STORAGE_KEYS.NAV_GROUPS);
    }
  } catch {
    // localStorage may be unavailable (private browsing, storage full)
  }
}

function readPinnedItems(): string[] {
  runMigration();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SIDEBAR_PINNED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed;
      }
    }
  } catch {
    // Malformed JSON — fall through to defaults
  }
  return DEFAULT_PINNED;
}

interface PinnedItemsValue {
  pinnedItems: string[];
  setPinnedItems: (updater: string[] | ((prev: string[]) => string[])) => void;
  MAX_PINNED_ITEMS: number;
}

const PinnedItemsContext = createContext<PinnedItemsValue | null>(null);

export function PinnedItemsProvider({ children }: { children: ReactNode }) {
  const [pinnedItems, setPinnedItemsRaw] = useState<string[]>(() => readPinnedItems());

  const setPinnedItems = (updater: string[] | ((prev: string[]) => string[])) => {
    setPinnedItemsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(STORAGE_KEYS.SIDEBAR_PINNED, JSON.stringify(next));
      } catch {
        // Storage full or unavailable
      }
      return next;
    });
  };

  return (
    <PinnedItemsContext.Provider value={{ pinnedItems, setPinnedItems, MAX_PINNED_ITEMS }}>
      {children}
    </PinnedItemsContext.Provider>
  );
}

export function usePinnedItems() {
  const ctx = useContext(PinnedItemsContext);
  if (!ctx) {
    throw new Error('usePinnedItems must be used within a PinnedItemsProvider');
  }
  return ctx;
}

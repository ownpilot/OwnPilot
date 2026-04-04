/**
 * useHeaderItems — manages items pinned to the global header bar.
 *
 * Separate from usePinnedItems (sidebar pins). Uses Context so all
 * consumers share state. HeaderItemsProvider must wrap the tree.
 *
 * Storage: localStorage[STORAGE_KEYS.HEADER_ITEMS] as HeaderItemConfig[].
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

// --- Types ---

export type HeaderItemConfig =
  | { type: 'item'; path: string }
  | { type: 'group'; id: string; label: string; items: string[] };

export const MAX_HEADER_ITEMS = 8;

// --- Storage helpers ---

function isValidConfig(v: unknown): v is HeaderItemConfig {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.type === 'item') return typeof obj.path === 'string';
  if (obj.type === 'group') {
    return (
      typeof obj.id === 'string' &&
      typeof obj.label === 'string' &&
      Array.isArray(obj.items) &&
      obj.items.every((x: unknown) => typeof x === 'string')
    );
  }
  return false;
}

function readHeaderItems(): HeaderItemConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HEADER_ITEMS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isValidConfig)) {
        return parsed;
      }
    }
  } catch {
    // Malformed JSON — fall through to default
  }
  return [];
}

function persistHeaderItems(items: HeaderItemConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.HEADER_ITEMS, JSON.stringify(items));
  } catch {
    // Storage full or unavailable
  }
}

// --- Context ---

interface HeaderItemsValue {
  headerItems: HeaderItemConfig[];
  setHeaderItems: (updater: HeaderItemConfig[] | ((prev: HeaderItemConfig[]) => HeaderItemConfig[])) => void;
  addItem: (path: string) => void;
  addGroup: (id: string, label: string, items: string[]) => void;
  removeByIndex: (index: number) => void;
  MAX_HEADER_ITEMS: number;
}

const HeaderItemsContext = createContext<HeaderItemsValue | null>(null);

export function HeaderItemsProvider({ children }: { children: ReactNode }) {
  const [headerItems, setHeaderItemsRaw] = useState<HeaderItemConfig[]>(() => readHeaderItems());

  const setHeaderItems = useCallback(
    (updater: HeaderItemConfig[] | ((prev: HeaderItemConfig[]) => HeaderItemConfig[])) => {
      setHeaderItemsRaw((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        persistHeaderItems(next);
        return next;
      });
    },
    []
  );

  const addItem = useCallback(
    (path: string) => {
      setHeaderItems((prev) => {
        if (prev.length >= MAX_HEADER_ITEMS) return prev;
        if (prev.some((c) => c.type === 'item' && c.path === path)) return prev;
        return [...prev, { type: 'item', path }];
      });
    },
    [setHeaderItems]
  );

  const addGroup = useCallback(
    (id: string, label: string, items: string[]) => {
      setHeaderItems((prev) => {
        if (prev.length >= MAX_HEADER_ITEMS) return prev;
        if (prev.some((c) => c.type === 'group' && c.id === id)) return prev;
        return [...prev, { type: 'group', id, label, items }];
      });
    },
    [setHeaderItems]
  );

  const removeByIndex = useCallback(
    (index: number) => {
      setHeaderItems((prev) => prev.filter((_, i) => i !== index));
    },
    [setHeaderItems]
  );

  return (
    <HeaderItemsContext.Provider
      value={{ headerItems, setHeaderItems, addItem, addGroup, removeByIndex, MAX_HEADER_ITEMS }}
    >
      {children}
    </HeaderItemsContext.Provider>
  );
}

export function useHeaderItems() {
  const ctx = useContext(HeaderItemsContext);
  if (!ctx) {
    throw new Error('useHeaderItems must be used within a HeaderItemsProvider');
  }
  return ctx;
}

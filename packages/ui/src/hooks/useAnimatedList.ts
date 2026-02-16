/**
 * useAnimatedList Hook
 *
 * Tracks new and removed items in a list to apply entry/exit CSS animations.
 * New items get 'animate-list-in', exiting items get 'animate-list-out'.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface AnimatedItem<T> {
  item: T;
  animClass: string;
}

export function useAnimatedList<T extends { id: string }>(
  items: T[],
  { animateInitial = false }: { animateInitial?: boolean } = {}
): {
  animatedItems: AnimatedItem<T>[];
  handleDelete: (id: string, deleteFn: () => Promise<void>) => Promise<void>;
} {
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const isInitialRef = useRef(true);

  const animatedItems: AnimatedItem<T>[] = items.map((item) => {
    if (exitingIds.has(item.id)) {
      return { item, animClass: 'animate-list-out' };
    }
    if (!isInitialRef.current && !prevIdsRef.current.has(item.id)) {
      return { item, animClass: 'animate-list-in' };
    }
    if (isInitialRef.current && animateInitial) {
      return { item, animClass: 'animate-list-in' };
    }
    return { item, animClass: '' };
  });

  useEffect(() => {
    prevIdsRef.current = new Set(items.map((i) => i.id));
    isInitialRef.current = false;
  }, [items]);

  const handleDelete = useCallback(async (id: string, deleteFn: () => Promise<void>) => {
    setExitingIds((prev) => new Set([...prev, id]));
    // Wait for exit animation
    await new Promise((r) => setTimeout(r, 280));
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await deleteFn();
  }, []);

  return { animatedItems, handleDelete };
}

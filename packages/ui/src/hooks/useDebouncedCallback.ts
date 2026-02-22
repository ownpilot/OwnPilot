import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a debounced version of `callback` that delays invocation by `delay` ms.
 * The latest callback reference is always used (via ref), so the returned function
 * is stable and safe to use as a dependency in useEffect/useCallback.
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(...args), delay);
    },
    [delay]
  ) as T;
}

import { useState, useEffect } from 'react';

/**
 * Hook that tracks a CSS media query match state.
 * Updates reactively when the viewport changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Returns true when viewport is below the md breakpoint (768px). */
export function useIsMobile(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}

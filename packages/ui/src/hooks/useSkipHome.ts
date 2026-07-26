/**
 * useSkipHome - Skip home tab on first mount if user previously opted in
 *
 * Reusable hook for pages with a PageHomeTab that have a "skip home" preference.
 * Eliminates duplicate skipHome/localStorage logic across ~20 pages.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

type SkipHomeNavigate = (tab: string) => void;

interface UseSkipHomeOptions {
  /** Unique page name for localStorage key, e.g. 'profile', 'system', 'agents' */
  pageName: string;
  /** Tab to navigate to when skip is active, e.g. 'overview', 'agents' */
  defaultTab?: string;
  /** Custom navigation function (for pages that use setState instead of URL) */
  onNavigate?: SkipHomeNavigate;
}

interface UseSkipHomeResult {
  /** Current skipHome state */
  skipHome: boolean;
  /** Callback to update skipHome preference */
  onSkipHomeChange: (checked: boolean) => void;
}

/**
 * Hook for managing skip home preference on pages with PageHomeTab.
 *
 * @example URL-based navigation (most pages):
 * const { skipHome, onSkipHomeChange } = useSkipHome({
 *   pageName: 'agents',
 *   defaultTab: 'agents',
 * });
 *
 * @example State-based navigation (ProfilePage):
 * const { skipHome, onSkipHomeChange } = useSkipHome({
 *   pageName: 'profile',
 *   defaultTab: 'overview',
 *   onNavigate: (tab) => setActiveTab(tab as TabId),
 * });
 *
 * // In JSX:
 * <PageHomeTab
 *   skipHomeChecked={skipHome}
 *   onSkipHomeChange={onSkipHomeChange}
 *   skipHomeLabel="Skip this screen and go directly to Overview"
 * />
 */
export function useSkipHome({
  pageName,
  defaultTab,
  onNavigate,
}: UseSkipHomeOptions): UseSkipHomeResult {
  const SKIP_HOME_KEY = `ownpilot:${pageName}:skipHome`;
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const didSkipHomeRef = useRef(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const handleSkipHomeChange = useCallback(
    (checked: boolean) => {
      setSkipHome(checked);
      try {
        localStorage.setItem(SKIP_HOME_KEY, String(checked));
      } catch {
        // Ignore storage errors
      }
    },
    [SKIP_HOME_KEY]
  );

  useEffect(() => {
    if (skipHome && !didSkipHomeRef.current) {
      didSkipHomeRef.current = true;
      if (onNavigate && defaultTab) {
        onNavigate(defaultTab);
      } else if (defaultTab) {
        const params = new URLSearchParams(searchParams);
        params.set('tab', defaultTab);
        navigate({ search: params.toString() }, { replace: true });
      }
    }
  }, [skipHome, defaultTab, searchParams, navigate, onNavigate]);

  return { skipHome, onSkipHomeChange: handleSkipHomeChange };
}

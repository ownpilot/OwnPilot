/**
 * usePageCopilotContext — resolves the active page's copilot configuration and context data.
 *
 * Watches the current URL, looks up the section in PAGE_COPILOT_REGISTRY,
 * and optionally fetches entity-specific context data when an entity ID is present.
 *
 * Features:
 * - Route-based section + entity extraction
 * - Async resolveContext with AbortController for rapid navigation cancellation
 * - Per-route+entityId cache to avoid redundant API calls
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { PAGE_COPILOT_REGISTRY } from '../constants/page-copilot-registry';
import type { PageCopilotConfig, PageContextData } from '../types/page-copilot';

export interface UsePageCopilotContextResult {
  config: PageCopilotConfig | null;
  contextData: PageContextData | null;
  isLoading: boolean;
}

/** Build a stable cache key from section + entity */
function buildCacheKey(sectionId: string, entityId: string | undefined): string {
  return entityId ? `${sectionId}/${entityId}` : sectionId;
}

/** Parse route pathname into sectionId and optional entityId.
 * Exported for testing. */
export function parseRoute(pathname: string): { sectionId: string; entityId: string | undefined } {
  const segments = pathname.split('/').filter(Boolean);

  // /settings/mcp-servers → sectionId='mcp-servers', no entityId
  const sectionId =
    segments.length >= 2 && segments[0] === 'settings' ? segments[1] : segments[0];

  // /workspaces/abc123 → entityId='abc123'
  // /settings/mcp-servers → entityId=undefined (settings sub-page, no entity)
  const entityId =
    segments.length >= 2 && segments[0] !== 'settings' ? segments[1] : undefined;

  return { sectionId: sectionId ?? '', entityId };
}

export function usePageCopilotContext(): UsePageCopilotContextResult {
  const location = useLocation();
  const [config, setConfig] = useState<PageCopilotConfig | null>(null);
  const [contextData, setContextData] = useState<PageContextData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /** Cache: cacheKey → resolved PageContextData */
  const cacheRef = useRef<Map<string, PageContextData>>(new Map());
  /** Track the current abort controller to cancel previous resolves */
  const abortRef = useRef<AbortController | null>(null);

  const resolve = useCallback(async (pathname: string) => {
    // Cancel any in-flight resolve from a previous route
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const { sectionId, entityId } = parseRoute(pathname);

    if (!sectionId) {
      setConfig(null);
      setContextData(null);
      setIsLoading(false);
      return;
    }

    const registryEntry = PAGE_COPILOT_REGISTRY[sectionId] ?? null;
    setConfig(registryEntry);

    if (!registryEntry) {
      setContextData(null);
      setIsLoading(false);
      return;
    }

    // No resolveContext → return empty context immediately
    if (!registryEntry.resolveContext) {
      setContextData(null);
      setIsLoading(false);
      return;
    }

    // resolveContext exists but no entityId → skip async fetch
    if (!entityId) {
      setContextData(null);
      setIsLoading(false);
      return;
    }

    const cacheKey = buildCacheKey(sectionId, entityId);
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setContextData(cached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await registryEntry.resolveContext({ id: entityId });

      // If this resolve was superseded by a newer navigation, discard the result
      if (controller.signal.aborted) return;

      cacheRef.current.set(cacheKey, data);
      setContextData(data);
    } catch {
      if (controller.signal.aborted) return;
      setContextData(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    resolve(location.pathname);
  }, [location.pathname, resolve]);

  return { config, contextData, isLoading };
}

/**
 * usePageContext — route-based context detection hook
 *
 * Watches the current URL and resolves the active entity context:
 * - /workspaces/:id  -> workspace name & path
 * - /coding-agents/:id -> coding agent session name & cwd
 * - /claws/:id -> claw name & workspace
 * - other routes -> null context
 *
 * Caches fetched context per route to avoid redundant requests.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { fileWorkspacesApi, codingAgentsApi, clawsApi } from '../api';

export interface PageContext {
  type: 'workspace' | 'coding-agent' | 'claw' | null;
  name?: string;
  path?: string;
  entityId?: string;
}

interface UsePageContextResult {
  context: PageContext;
  isLoading: boolean;
}

const NULL_CONTEXT: PageContext = { type: null };

/** Route patterns that carry entity context */
const ROUTE_PATTERNS: Array<{
  pattern: RegExp;
  type: 'workspace' | 'coding-agent' | 'claw';
}> = [
  { pattern: /^\/workspaces\/([^/]+)/, type: 'workspace' },
  { pattern: /^\/coding-agents\/([^/]+)/, type: 'coding-agent' },
  { pattern: /^\/claws\/([^/]+)/, type: 'claw' },
];

/** Routes that indicate a category even without an entity id */
const CATEGORY_ROUTES: Record<string, PageContext['type']> = {
  '/workspaces': 'workspace',
  '/coding-agents': 'coding-agent',
  '/claws': 'claw',
};

async function fetchContext(
  type: 'workspace' | 'coding-agent' | 'claw',
  id: string,
): Promise<PageContext> {
  switch (type) {
    case 'workspace': {
      const res = await fileWorkspacesApi.list();
      const ws = res.workspaces.find((w) => w.id === id);
      return ws
        ? { type: 'workspace', name: ws.name, path: ws.path, entityId: id }
        : { type: 'workspace', entityId: id };
    }
    case 'coding-agent': {
      const session = await codingAgentsApi.getSession(id);
      return {
        type: 'coding-agent',
        name: session.displayName || session.provider,
        path: session.cwd,
        entityId: id,
      };
    }
    case 'claw': {
      const claw = await clawsApi.get(id);
      return {
        type: 'claw',
        name: claw.name,
        path: claw.workspaceId,
        entityId: id,
      };
    }
  }
}

export function usePageContext(): UsePageContextResult {
  const location = useLocation();
  const [context, setContext] = useState<PageContext>(NULL_CONTEXT);
  const [isLoading, setIsLoading] = useState(false);
  const cacheRef = useRef<Map<string, PageContext>>(new Map());

  const resolveContext = useCallback(async (pathname: string) => {
    // Check cache first
    const cached = cacheRef.current.get(pathname);
    if (cached) {
      setContext(cached);
      return;
    }

    // Try entity-specific routes (/type/:id)
    for (const { pattern, type } of ROUTE_PATTERNS) {
      const match = pathname.match(pattern);
      if (match) {
        const id = match[1];
        // skip if no id captured or id looks like a sub-action
        if (!id || id === 'new' || id === 'settings') continue;

        setIsLoading(true);
        try {
          const ctx = await fetchContext(type, id);
          cacheRef.current.set(pathname, ctx);
          setContext(ctx);
        } catch {
          // Entity not found or API error — set type-only context
          const fallback: PageContext = { type, entityId: id };
          cacheRef.current.set(pathname, fallback);
          setContext(fallback);
        } finally {
          setIsLoading(false);
        }
        return;
      }
    }

    // Try category-only routes (/type without :id)
    for (const [route, type] of Object.entries(CATEGORY_ROUTES)) {
      if (pathname === route || pathname === route + '/') {
        const ctx: PageContext = { type };
        cacheRef.current.set(pathname, ctx);
        setContext(ctx);
        return;
      }
    }

    // No context
    setContext(NULL_CONTEXT);
  }, []);

  useEffect(() => {
    resolveContext(location.pathname);
  }, [location.pathname, resolveContext]);

  return { context, isLoading };
}

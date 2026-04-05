/**
 * useSidebarRecents — full conversation management for the Sidebar Recent section.
 *
 * Ported from ConversationSidebar's mechanism:
 * - Date grouping (Today / Yesterday / This Week / Older)
 * - Search with debounce
 * - Source filter (all / web / whatsapp / telegram)
 * - Delete / rename API wrappers
 * - WS auto-refresh on channel:message
 * - Reload on route change (to catch new conversations)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api';
import type { Conversation } from '../api/types';
import { useGateway } from './useWebSocket';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getConvTitle(conv: Conversation): string {
  if (conv.title?.trim()) return conv.title.trim();
  if (conv.source === 'channel' && conv.channelSenderName) return conv.channelSenderName;
  if (conv.agentName) return conv.agentName;
  return 'New Conversation';
}

export interface DateGroup {
  label: string;
  items: Conversation[];
}

function groupByDate(convs: Conversation[]): DateGroup[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const buckets: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Older: [],
  };

  for (const conv of convs) {
    const d = new Date(conv.updatedAt);
    d.setHours(0, 0, 0, 0);
    if (d >= todayStart) buckets['Today']!.push(conv);
    else if (d >= yesterdayStart) buckets['Yesterday']!.push(conv);
    else if (d >= weekStart) buckets['This Week']!.push(conv);
    else buckets['Older']!.push(conv);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// ── Types ────────────────────────────────────────────────────────────────────

export type SourceFilter = 'all' | 'web' | 'whatsapp' | 'telegram';

export interface SidebarRecentsState {
  conversations: Conversation[];
  groups: DateGroup[];
  total: number;
  isLoading: boolean;
  search: string;
  sourceFilter: SourceFilter;
  availablePlatforms: Set<string>;
  editingId: string | null;
  editTitle: string;
  setSearch: (q: string) => void;
  setSourceFilter: (f: SourceFilter) => void;
  handleDelete: (id: string) => Promise<void>;
  startEdit: (conv: Conversation) => void;
  commitEdit: (id: string) => Promise<void>;
  cancelEdit: () => void;
  setEditTitle: (v: string) => void;
  reload: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSidebarRecents(): SidebarRecentsState {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearchState] = useState('');
  const [sourceFilter, setSourceFilterState] = useState<SourceFilter>('all');
  const [availablePlatforms, setAvailablePlatforms] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const location = useLocation();
  const { subscribe } = useGateway();
  const searchRef = useRef(search);
  const filterRef = useRef(sourceFilter);
  searchRef.current = search;
  filterRef.current = sourceFilter;

  const buildQueryParams = useCallback((q: string, filter: SourceFilter) => {
    if (filter === 'web')
      return { limit: 50, offset: 0, search: q || undefined, source: 'web' as const };
    if (filter === 'whatsapp')
      return { limit: 50, offset: 0, search: q || undefined, source: 'channel' as const, channelPlatform: 'whatsapp' };
    if (filter === 'telegram')
      return { limit: 50, offset: 0, search: q || undefined, source: 'channel' as const, channelPlatform: 'telegram' };
    return { limit: 50, offset: 0, search: q || undefined };
  }, []);

  const load = useCallback(
    async (q = '', filter: SourceFilter = 'all') => {
      setIsLoading(true);
      try {
        const res = await chatApi.listHistory(buildQueryParams(q, filter));
        setConversations(res.conversations);
        setTotal(res.total);
        if (filter === 'all') {
          const platforms = new Set<string>();
          for (const conv of res.conversations) {
            if (conv.source === 'channel' && conv.channelPlatform) {
              platforms.add(conv.channelPlatform);
            }
          }
          setAvailablePlatforms(platforms);
        }
      } catch {
        /* silently ignore */
      } finally {
        setIsLoading(false);
      }
    },
    [buildQueryParams]
  );

  // Initial load + reload on route change
  useEffect(() => {
    load(searchRef.current, filterRef.current);
  }, [load, location.pathname, location.search]);

  // Auto-refresh when channel message arrives
  useEffect(() => {
    return subscribe('channel:message', () => {
      load(searchRef.current, filterRef.current);
    });
  }, [subscribe, load]);

  // Auto-refresh when backend confirms DB persistence (authoritative signal)
  useEffect(() => {
    return subscribe('chat:history:updated', () => {
      load(searchRef.current, filterRef.current);
    });
  }, [subscribe, load]);

  const setSearch = useCallback(
    (q: string) => {
      setSearchState(q);
      load(q, filterRef.current);
    },
    [load]
  );

  const setSourceFilter = useCallback(
    (filter: SourceFilter) => {
      setSourceFilterState(filter);
      load(searchRef.current, filter);
    },
    [load]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await chatApi.deleteHistory(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setTotal((t) => t - 1);
      } catch {
        // Error handling done by caller
        throw new Error('Failed to delete conversation');
      }
    },
    []
  );

  const startEdit = useCallback((conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(getConvTitle(conv));
  }, []);

  const commitEdit = useCallback(
    async (id: string) => {
      const trimmed = editTitle.trim();
      setEditingId(null);
      if (!trimmed) return;
      try {
        await chatApi.renameConversation(id, trimmed);
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
      } catch {
        throw new Error('Failed to rename conversation');
      }
    },
    [editTitle]
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const reload = useCallback(() => {
    load(searchRef.current, filterRef.current);
  }, [load]);

  const groups = groupByDate(conversations);

  return {
    conversations,
    groups,
    total,
    isLoading,
    search,
    sourceFilter,
    availablePlatforms,
    editingId,
    editTitle,
    setSearch,
    setSourceFilter,
    handleDelete,
    startEdit,
    commitEdit,
    cancelEdit,
    setEditTitle,
    reload,
  };
}

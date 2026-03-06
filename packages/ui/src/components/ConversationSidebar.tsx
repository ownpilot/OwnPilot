/**
 * Conversation Sidebar
 *
 * Left panel showing recent chat conversations.
 * Supports search, rename, delete, and grouping by date.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatApi } from '../api';
import type { Conversation } from '../api';
import { Plus, MessageSquare, Trash2, Edit2, Telegram, Globe, WhatsApp } from './icons';
import { useToast } from './ToastProvider';
import { useDialog } from './ConfirmDialog';
import { useGateway } from '../hooks/useWebSocket';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getConvTitle(conv: Conversation): string {
  if (conv.title?.trim()) return conv.title.trim();
  if (conv.source === 'channel' && conv.channelSenderName) return conv.channelSenderName;
  if (conv.agentName) return conv.agentName;
  return 'New Conversation';
}

function groupByDate(convs: Conversation[]): Array<{ label: string; items: Conversation[] }> {
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

// ── Sub-component: single conversation row ────────────────────────────────────

function ConvItem({
  conv,
  isActive,
  isEditing,
  editTitle,
  editInputRef,
  onSelect,
  onDelete,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  onCancelEdit,
}: {
  conv: Conversation;
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onStartEdit: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
}) {
  const title = getConvTitle(conv);
  const isChannel = conv.source === 'channel';
  const isTelegram = conv.channelPlatform === 'telegram';

  return (
    <div
      onClick={isEditing ? undefined : onSelect}
      className={`group relative flex items-center gap-1.5 px-2 py-1.5 mx-1 my-0.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
      }`}
    >
      {/* Platform icon */}
      {isChannel && isTelegram ? (
        <Telegram className="w-3 h-3 shrink-0 opacity-60" />
      ) : isChannel && conv.channelPlatform === 'whatsapp' ? (
        <WhatsApp className="w-3 h-3 shrink-0 opacity-60" />
      ) : isChannel ? (
        <MessageSquare className="w-3 h-3 shrink-0 opacity-60" />
      ) : (
        <Globe className="w-3 h-3 shrink-0 opacity-30" />
      )}

      {/* Title or edit input */}
      {isEditing ? (
        <input
          ref={editInputRef}
          value={editTitle}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-primary rounded px-1 py-0.5 outline-none"
          autoFocus
        />
      ) : (
        <span className="flex-1 min-w-0 text-xs truncate leading-snug">{title}</span>
      )}

      {/* Hover actions */}
      {!isEditing && (
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={onStartEdit}
            title="Rename"
            className={`p-0.5 rounded transition-colors ${
              isActive
                ? 'hover:text-primary-dark'
                : 'hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            <Edit2 className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-0.5 rounded hover:text-error transition-colors"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Filter tab type ───────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'web' | 'whatsapp' | 'telegram';

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
}

export function ConversationSidebar({ activeId, onNew, onSelect }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [availablePlatforms, setAvailablePlatforms] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);
  const prevActiveIdRef = useRef<string | null>(null);
  const toast = useToast();
  const dialog = useDialog();
  const { subscribe } = useGateway();

  const buildQueryParams = useCallback((q: string, filter: SourceFilter) => {
    if (filter === 'web')
      return { limit: 50, offset: 0, search: q || undefined, source: 'web' as const };
    if (filter === 'whatsapp')
      return {
        limit: 50,
        offset: 0,
        search: q || undefined,
        source: 'channel' as const,
        channelPlatform: 'whatsapp',
      };
    if (filter === 'telegram')
      return {
        limit: 50,
        offset: 0,
        search: q || undefined,
        source: 'channel' as const,
        channelPlatform: 'telegram',
      };
    return { limit: 50, offset: 0, search: q || undefined };
  }, []);

  const load = useCallback(
    async (q = '', filter: SourceFilter = 'all') => {
      setIsLoading(true);
      try {
        const res = await chatApi.listHistory(buildQueryParams(q, filter));
        setConversations(res.conversations);
        setTotal(res.total);
        // Update available platforms from unfiltered data
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

  // Initial load
  useEffect(() => {
    load('', 'all');
  }, [load]);

  // Reload when a new conversation is started (activeId changes to a new value)
  useEffect(() => {
    if (activeId && activeId !== prevActiveIdRef.current) {
      prevActiveIdRef.current = activeId;
      load(search, sourceFilter);
    }
    if (!activeId) {
      prevActiveIdRef.current = null;
    }
  }, [activeId, load, search, sourceFilter]);

  // Auto-refresh when a channel message arrives (WhatsApp, Telegram, etc.)
  useEffect(() => {
    return subscribe('channel:message', () => {
      load(search, sourceFilter);
    });
  }, [subscribe, load, search, sourceFilter]);

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      load(q, sourceFilter);
    },
    [load, sourceFilter]
  );

  const handleFilterChange = useCallback(
    (filter: SourceFilter) => {
      setSourceFilter(filter);
      load(search, filter);
    },
    [load, search]
  );

  const handleClearAll = async () => {
    const ok = await dialog.confirm({
      title: 'Clear All History',
      message: 'Delete all conversations? This cannot be undone.',
      confirmText: 'Delete All',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await chatApi.deleteAllHistory();
      setConversations([]);
      setTotal(0);
      onNew();
      toast.success('All conversations deleted');
    } catch {
      toast.error('Failed to clear history');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await dialog.confirm({
      title: 'Delete Conversation',
      message: 'Delete this conversation? This cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await chatApi.deleteHistory(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setTotal((t) => t - 1);
      if (activeId === id) onNew();
    } catch {
      toast.error('Failed to delete conversation');
    }
  };

  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(getConvTitle(conv));
  };

  const commitEdit = async (id: string) => {
    const trimmed = editTitle.trim();
    setEditingId(null);
    if (!trimmed) return;
    try {
      await chatApi.renameConversation(id, trimmed);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
    } catch {
      toast.error('Failed to rename conversation');
    }
  };

  const groups = groupByDate(conversations);

  // ── Collapsed state ─────────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-r border-border dark:border-dark-border flex flex-col items-center py-2 gap-1 bg-bg-secondary dark:bg-dark-bg-secondary">
        <button
          onClick={() => setCollapsed(false)}
          title="Show conversations"
          className="p-2 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <button
          onClick={onNew}
          title="New Chat"
          className="p-2 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ── Expanded state ──────────────────────────────────────────────────────────

  return (
    <div className="w-56 shrink-0 border-r border-border dark:border-dark-border flex flex-col bg-bg-secondary dark:bg-dark-bg-secondary">
      {/* Header row */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-border dark:border-dark-border">
        <button
          onClick={onNew}
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors text-xs leading-none"
        >
          ←
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pt-1.5 pb-1 border-b border-border dark:border-dark-border">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search…"
          className="w-full px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
        />
      </div>

      {/* Source filter tabs */}
      {availablePlatforms.size > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border dark:border-dark-border overflow-x-auto">
          {(
            [
              'all',
              'web',
              ...(availablePlatforms.has('whatsapp') ? ['whatsapp'] : []),
              ...(availablePlatforms.has('telegram') ? ['telegram'] : []),
            ] as SourceFilter[]
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => handleFilterChange(tab)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                sourceFilter === tab
                  ? 'bg-primary text-white'
                  : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {tab === 'all' && 'All'}
              {tab === 'web' && (
                <>
                  <Globe className="w-2.5 h-2.5" />
                  Web
                </>
              )}
              {tab === 'whatsapp' && (
                <>
                  <WhatsApp className="w-2.5 h-2.5" />
                  WA
                </>
              )}
              {tab === 'telegram' && (
                <>
                  <Telegram className="w-2.5 h-2.5" />
                  TG
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && conversations.length === 0 ? (
          <div className="space-y-1 px-2 py-1">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-7 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary animate-pulse"
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="p-4 text-xs text-text-muted dark:text-dark-text-muted text-center italic">
            {search ? 'No results' : 'No conversations yet'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-dark-text-muted">
                {group.label}
              </p>
              {group.items.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === activeId}
                  isEditing={editingId === conv.id}
                  editTitle={editTitle}
                  editInputRef={editInputRef as React.RefObject<HTMLInputElement>}
                  onSelect={() => onSelect(conv.id)}
                  onDelete={(e) => handleDelete(conv.id, e)}
                  onStartEdit={(e) => startEdit(conv, e)}
                  onEditChange={setEditTitle}
                  onCommitEdit={() => commitEdit(conv.id)}
                  onCancelEdit={() => setEditingId(null)}
                />
              ))}
            </div>
          ))
        )}

        {total > conversations.length && (
          <p className="px-3 py-2 text-[10px] text-text-muted dark:text-dark-text-muted text-center">
            +{total - conversations.length} older
          </p>
        )}
      </div>

      {/* Footer — bulk cleanup */}
      {conversations.length > 0 && (
        <div className="border-t border-border dark:border-dark-border px-2 py-1.5 shrink-0">
          <button
            onClick={handleClearAll}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-error hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear all history
          </button>
        </div>
      )}
    </div>
  );
}

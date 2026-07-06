/**
 * RecentsList — Sidebar recent conversations list with search, filters, edit, and delete.
 *
 * Extracted from Sidebar.tsx to reduce its ~480-line render method.
 * Renders search input, source filter tabs, conversation groups, optimistic entries,
 * and the "All conversations" link at the bottom.
 */

import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ChevronRight,
  Edit2,
  Trash2,
  Globe,
  MessageSquare,
  Telegram,
  WhatsApp,
} from '../icons';
import { getConvTitle, type SourceFilter } from '../../hooks/useSidebarRecents';
import type { Conversation } from '../../api/types';

interface RecentsGroup {
  label: string;
  items: Conversation[];
}

interface OptimisticEntry {
  id: string;
  title: string;
}

interface RecentsListProps {
  // Recents data
  groups: RecentsGroup[];
  optimisticEntries: OptimisticEntry[];
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  isEmpty: boolean;
  total: number;
  hasNoResults: boolean;
  availablePlatforms: Set<string>;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  // Editing
  editingId: string | null;
  editTitle: string;
  onEditTitleChange: (value: string) => void;
  onStartEdit: (conv: Conversation, e: React.MouseEvent) => void;
  onCommitEdit: (id: string) => Promise<void>;
  onCancelEdit: () => void;
  // Navigation
  activeConversationId: string | null;
  onRecentClick: (id: string) => void;
  onDeleteConv: (id: string, e: React.MouseEvent) => Promise<void>;
  onAllConversationsClick: () => void;
  // Collapse
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function RecentsList({
  groups,
  optimisticEntries,
  search,
  onSearchChange,
  isLoading,
  isEmpty,
  total,
  hasNoResults,
  availablePlatforms,
  sourceFilter,
  onSourceFilterChange,
  editingId,
  editTitle,
  onEditTitleChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  activeConversationId,
  onRecentClick,
  onDeleteConv,
  onAllConversationsClick,
  collapsed,
  onToggleCollapse,
}: RecentsListProps) {
  const editInputRef = useRef<HTMLInputElement>(null);

  return (
    <div data-testid="sidebar-recents">
      {/* Header with collapse toggle */}
      <div className="flex items-center px-3 py-1 gap-1.5">
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
          aria-label={collapsed ? 'Expand recents' : 'Collapse recents'}
        >
          <ChevronRight
            className={`w-[17px] h-[17px] shrink-0 transition-transform duration-150 ${!collapsed ? 'rotate-90' : ''}`}
          />
        </button>
        <button
          onClick={onAllConversationsClick}
          className="flex-1 text-left text-[15px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
        >
          Recent
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Search input */}
          <div className="px-2 pb-1">
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search\u2026"
              data-testid="sidebar-recents-search"
              className="w-full px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
            />
          </div>

          {/* Source filter tabs */}
          {availablePlatforms.size > 0 && (
            <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto">
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
                  onClick={() => onSourceFilterChange(tab)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                    sourceFilter === tab
                      ? 'bg-primary text-white'
                      : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  {tab === 'all' && 'All'}
                  {tab === 'web' && (
                    <>
                      <Globe className="w-2.5 h-2.5" /> Web
                    </>
                  )}
                  {tab === 'whatsapp' && (
                    <>
                      <WhatsApp className="w-2.5 h-2.5" /> WA
                    </>
                  )}
                  {tab === 'telegram' && (
                    <>
                      <Telegram className="w-2.5 h-2.5" /> TG
                    </>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading ? (
            <div className="space-y-1 px-2 py-1">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-6 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary animate-pulse"
                />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted italic">
              {hasNoResults ? 'No results' : 'No conversations yet'}
            </div>
          ) : (
            <>
              {/* Optimistic entries */}
              {optimisticEntries.map((entry) => {
                const isActive = activeConversationId === entry.id;
                return (
                  <div key={entry.id}>
                    <div
                      onClick={() => onRecentClick(entry.id)}
                      className={`group relative flex items-center gap-1.5 px-2 py-1.5 mx-1 my-0.5 rounded-md cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
                      }`}
                    >
                      <MessageSquare className="w-3 h-3 shrink-0 opacity-50" />
                      <span className="truncate text-xs flex-1">{entry.title}</span>
                    </div>
                  </div>
                );
              })}

              {/* Grouped conversations */}
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-dark-text-muted">
                    {group.label}
                  </p>
                  {group.items.map((conv) => {
                    const isActiveConv = activeConversationId === conv.id;
                    const isEditing = editingId === conv.id;
                    const title = getConvTitle(conv);
                    const isChannel = conv.source === 'channel';
                    const isTelegram = conv.channelPlatform === 'telegram';
                    return (
                      <div
                        key={conv.id}
                        data-testid={`recent-item-${conv.id}`}
                        onClick={isEditing ? undefined : () => onRecentClick(conv.id)}
                        className={`group relative flex items-center gap-1.5 px-2 py-1.5 mx-1 my-0.5 rounded-md cursor-pointer transition-colors ${
                          isActiveConv
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
                        }`}
                      >
                        {isChannel && isTelegram ? (
                          <Telegram className="w-3 h-3 shrink-0 opacity-60" />
                        ) : isChannel && conv.channelPlatform === 'whatsapp' ? (
                          <WhatsApp className="w-3 h-3 shrink-0 opacity-60" />
                        ) : isChannel ? (
                          <MessageSquare className="w-3 h-3 shrink-0 opacity-60" />
                        ) : (
                          <Globe className="w-3 h-3 shrink-0 opacity-30" />
                        )}
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            value={editTitle}
                            onChange={(e) => onEditTitleChange(e.target.value)}
                            onBlur={() => onCommitEdit(conv.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onCommitEdit(conv.id);
                              if (e.key === 'Escape') onCancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-primary rounded px-1 py-0.5 outline-none"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="flex-1 min-w-0 text-xs truncate leading-snug"
                            title={title}
                          >
                            {title}
                          </span>
                        )}
                        {!isEditing && (
                          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={(e) => onStartEdit(conv, e)}
                              title="Rename"
                              className="p-0.5 rounded transition-colors hover:text-text-primary dark:hover:text-dark-text-primary"
                            >
                              <Edit2 className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={(e) => onDeleteConv(conv.id, e)}
                              title="Delete"
                              className="p-0.5 rounded hover:text-error transition-colors"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {/* Older conversations indicator */}
          {total > groups.reduce((sum, g) => sum + g.items.length, 0) && (
            <p className="px-3 py-1 text-[10px] text-text-muted dark:text-dark-text-muted text-center">
              +{total - groups.reduce((sum, g) => sum + g.items.length, 0)} older
            </p>
          )}

          {/* All conversations link */}
          <NavLink
            to="/history"
            end
            onClick={onAllConversationsClick}
            className="flex items-center px-3 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
          >
            All conversations &rarr;
          </NavLink>
        </>
      )}
    </div>
  );
}

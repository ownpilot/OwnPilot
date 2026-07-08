/**
 * Sidebar — replaces Layout.tsx <aside> block.
 *
 * MOBILE CONTRACT: <aside> is the sole CSS transform target.
 * Do NOT add position:fixed or overflow:hidden wrappers around <aside>.
 * Mobile slide: translate-x-0 (open) / -translate-x-full (closed).
 */
import { useRef, useState, useMemo } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import { useChatStore } from '../hooks/useChatStore';
import { useSidebarRecents } from '../hooks/useSidebarRecents';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import { SIDEBAR_WIDTH_VALUES, DEFAULT_SIDEBAR_SECTIONS } from '../types/layout-config';
import {
  SIDEBAR_DATA_SECTIONS,
  getSectionGroup,
  isNavItemSection,
} from '../constants/sidebar-sections';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarDataSection } from './sidebar/SidebarDataSection';
import { PinnedNavLink } from './sidebar/PinnedNavLink';
import { RecentsList } from './sidebar/RecentsList';
import { useToast } from './ToastProvider';
import { useDialog } from './ConfirmDialog';
import {
  X,
  ChevronRight,
  Search,
  Calendar,
  MessageSquare,
} from './icons';
import type { Conversation } from '../api/types';

/** Data sections get a divider before them (if not first visible section) */
const DATA_GROUPS = new Set(['data', 'ai', 'tools', 'personal', 'system']);

interface SidebarProps {
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSearchOpen: () => void;
  onCustomizeToggle: () => void;
  isCustomizeOpen: boolean;
  onCloseCustomize: () => void;
  wsStatus: ConnectionStatus;
  badgeCounts: { inbox: number; tasks: number };
}

// NAV_ITEM_MAP imported from '../constants/nav-items' (shared with HeaderItemsBar)

export function Sidebar({
  isMobile,
  isOpen,
  onClose,
  onSearchOpen,
  onCustomizeToggle,
  isCustomizeOpen,
  onCloseCustomize,
  wsStatus,
  badgeCounts,
}: SidebarProps) {
  const recents = useSidebarRecents();
  const { config: layoutConfig } = useLayoutConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessionId: chatStoreSessionId, messages: chatMessages, sessionTabs } = useChatStore();
  // Active conversation: prefer URL param (sidebar click), fallback to chat store (new chat)
  const activeConversationId = searchParams.get('conversationId') || chatStoreSessionId;

  // Multi-session optimistic entries: each session gets its own sticky entry in sidebar.
  // Map persists entries across createSession/clearMessages until DB row arrives.
  const stickyOptimisticMapRef = useRef(new Map<string, import('../api/types').Conversation>());

  const optimisticEntries = useMemo(() => {
    const map = stickyOptimisticMapRef.current;

    // Add/update entry for the ACTIVE session's current messages
    const firstUserMsg = chatMessages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      const convId = chatStoreSessionId || '__optimistic__';
      if (!recents.conversations.some((c) => c.id === convId)) {
        map.set(convId, {
          id: convId,
          title: firstUserMsg.content.slice(0, 80),
          updatedAt: firstUserMsg.timestamp || new Date().toISOString(),
          createdAt: firstUserMsg.timestamp || new Date().toISOString(),
          source: 'web' as const,
        } as import('../api/types').Conversation);
      } else {
        map.delete(convId);
      }
    }

    // Add entries from session tabs (snapshots of switched-away sessions)
    for (const tab of sessionTabs) {
      if (!recents.conversations.some((c) => c.id === tab.id) && !map.has(tab.id)) {
        map.set(tab.id, {
          id: tab.id,
          title: tab.title,
          updatedAt: new Date(tab.createdAt).toISOString(),
          createdAt: new Date(tab.createdAt).toISOString(),
          source: 'web' as const,
        } as import('../api/types').Conversation);
      }
    }

    // Prune entries that DB now has
    for (const [id] of map) {
      if (recents.conversations.some((c) => c.id === id)) {
        map.delete(id);
      }
    }

    return [...map.values()];
  }, [chatMessages, chatStoreSessionId, recents.conversations, sessionTabs]);
  const toast = useToast();
  const dialog = useDialog();

  // Config-driven section order: sections in array are shown, sorted by order
  const sidebarSections = layoutConfig.sidebar.sections;
  const visibleSections = useMemo(
    () => [...(sidebarSections ?? DEFAULT_SIDEBAR_SECTIONS)].sort((a, b) => a.order - b.order),
    [sidebarSections]
  );

  // Desktop sidebar width from config (mobile stays fixed w-64)
  const desktopWidthClass = SIDEBAR_WIDTH_VALUES[layoutConfig.sidebar.width]?.class ?? 'w-60';

  // Accordion collapse state for data sections (default: all expanded)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleRecentClick = (conversationId: string) => {
    onCloseCustomize();
    navigate(`/?conversationId=${conversationId}`);
  };

  const handleDeleteConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await dialog.confirm({
      title: 'Delete Conversation',
      message: 'Delete this conversation? This cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await recents.handleDelete(id);
      if (activeConversationId === id) navigate('/');
    } catch {
      toast.error('Failed to delete conversation');
    }
  };

  const handleStartEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    recents.startEdit(conv);
  };

  const handleCommitEdit = async (id: string) => {
    try {
      await recents.commitEdit(id);
    } catch {
      toast.error('Failed to rename conversation');
    }
  };

  return (
    <aside
      data-testid="sidebar"
      className={
        isMobile
          ? `fixed inset-y-0 left-0 z-40 w-64 bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col transform transition-transform duration-200 ease-out ${
              isOpen ? 'translate-x-0' : '-translate-x-full'
            }`
          : `${desktopWidthClass} border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col`
      }
    >
      {/* Mobile close button */}
      {isMobile && (
        <div className="p-3 border-b border-border dark:border-dark-border flex items-center justify-end">
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Navigation — config-driven section rendering */}
      <nav className="flex-1 p-2 overflow-y-auto" data-testid="sidebar-nav">
        {visibleSections.map((section, sectionIdx) => {
          // Show divider when entering a data group (not if first section)
          const currentGroup = getSectionGroup(section.id);
          const prevGroup =
            sectionIdx > 0 ? getSectionGroup(visibleSections[sectionIdx - 1]!.id) : currentGroup;
          const divider =
            sectionIdx > 0 && currentGroup !== prevGroup && DATA_GROUPS.has(currentGroup) ? (
              <div
                key={`div-${section.id}`}
                className="border-t border-border dark:border-dark-border my-2"
              />
            ) : null;

          // Registry-driven data sections (workspaces, workflows, and all future data sections)
          const dataDef = SIDEBAR_DATA_SECTIONS[section.id];
          if (dataDef) {
            return (
              <div key={section.id}>
                {divider}
                <SidebarDataSection
                  def={dataDef}
                  config={section}
                  collapsed={!!collapsed[section.id]}
                  onToggleCollapse={() =>
                    setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))
                  }
                  onCloseCustomize={onCloseCustomize}
                />
              </div>
            );
          }

          // Nav item sections — route paths like '/', '/dashboard'
          if (isNavItemSection(section.id)) {
            const navItem = NAV_ITEM_MAP.get(section.id);
            if (!navItem) return null;
            return (
              <PinnedNavLink
                key={section.id}
                item={navItem}
                onCloseCustomize={onCloseCustomize}
                isCustomizeOpen={isCustomizeOpen}
                badge={
                  section.id === '/history'
                    ? badgeCounts.inbox
                    : section.id === '/tasks'
                      ? badgeCounts.tasks
                      : undefined
                }
              />
            );
          }

          switch (section.id) {
            case 'search':
              return (
                <button
                  key="search"
                  onClick={onSearchOpen}
                  data-testid="sidebar-search-btn"
                  className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                >
                  <Search className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">Search</span>
                </button>
              );

            case 'scheduled':
              return (
                <NavLink
                  key="scheduled"
                  to="/calendar"
                  end
                  onClick={onCloseCustomize}
                  data-testid="sidebar-scheduled-link"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
                      isActive && !isCustomizeOpen
                        ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
                        : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
                    }`
                  }
                >
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">Calendar</span>
                </NavLink>
              );

            case 'customize':
              return (
                <div key="customize" data-testid="sidebar-customize-link">
                  <button
                    onClick={onCustomizeToggle}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-left ${
                      isCustomizeOpen
                        ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
                        : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1">Customize</span>
                  </button>
                </div>
              );

            case 'recents':
              if (section.style === 'flat') {
                return (
                  <div key="recents">
                    {divider}
                    <button
                      onClick={() => {
                        onCloseCustomize();
                        navigate('/history');
                      }}
                      data-testid="sidebar-recents"
                      className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span className="truncate flex-1">Recent</span>
                    </button>
                  </div>
                );
              }
              return (
                <div key="recents">
                  {divider}
                  <RecentsList
                    groups={recents.groups}
                    optimisticEntries={optimisticEntries}
                    search={recents.search}
                    onSearchChange={recents.setSearch}
                    isLoading={recents.isLoading && recents.conversations.length === 0}
                    isEmpty={recents.conversations.length === 0}
                    total={recents.total}
                    hasNoResults={!!recents.search}
                    availablePlatforms={recents.availablePlatforms}
                    sourceFilter={recents.sourceFilter}
                    onSourceFilterChange={recents.setSourceFilter}
                    editingId={recents.editingId}
                    editTitle={recents.editTitle}
                    onEditTitleChange={recents.setEditTitle}
                    onStartEdit={handleStartEdit}
                    onCommitEdit={handleCommitEdit}
                    onCancelEdit={recents.cancelEdit}
                    activeConversationId={activeConversationId}
                    onRecentClick={handleRecentClick}
                    onDeleteConv={handleDeleteConv}
                    onAllConversationsClick={() => {
                      onCloseCustomize();
                      navigate('/history');
                    }}
                    collapsed={!!collapsed.recents}
                    onToggleCollapse={() =>
                      setCollapsed((prev) => ({ ...prev, recents: !prev.recents }))
                    }
                  />
                </div>
              );

            default:
              return null;
          }
        })}
      </nav>

      {/* Footer */}
      <SidebarFooter wsStatus={wsStatus} />
    </aside>
  );
}

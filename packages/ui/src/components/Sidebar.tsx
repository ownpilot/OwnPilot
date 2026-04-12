/**
 * Sidebar — replaces Layout.tsx <aside> block.
 *
 * MOBILE CONTRACT: <aside> is the sole CSS transform target.
 * Do NOT add position:fixed or overflow:hidden wrappers around <aside>.
 * Mobile slide: translate-x-0 (open) / -translate-x-full (closed).
 */
import { useRef, useState, useMemo } from 'react';
import { NavLink, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import { useChatStore } from '../hooks/useChatStore';
import { useSidebarRecents, getConvTitle } from '../hooks/useSidebarRecents';
import type { SourceFilter } from '../hooks/useSidebarRecents';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import { SIDEBAR_WIDTH_VALUES, DEFAULT_SIDEBAR_SECTIONS } from '../types/layout-config';
import { SIDEBAR_DATA_SECTIONS, getSectionGroup, isNavItemSection } from '../constants/sidebar-sections';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarDataSection } from './sidebar/SidebarDataSection';
import { useToast } from './ToastProvider';
import { useDialog } from './ConfirmDialog';
import { X, ChevronRight, Search, Calendar, Edit2, Trash2, Globe, MessageSquare, Telegram, WhatsApp } from './icons';
import type { NavItem } from '../constants/nav-items';
import type { Conversation } from '../api/types';
import { chatApi } from '../api/endpoints/chat';

/** Data sections get a divider before them (if not first visible section) */
const DATA_GROUPS = new Set(['data', 'ai', 'tools', 'personal', 'system']);

export interface SidebarProps {
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

function PinnedNavLink({ item, badge, onCloseCustomize, isCustomizeOpen }: { item: NavItem; badge?: number; onCloseCustomize?: () => void; isCustomizeOpen?: boolean }) {
  const Icon = item.icon;
  const location = useLocation();
  const { clearMessages, provider, model, sessionId, messages } = useChatStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleClick = (e: React.MouseEvent) => {
    onCloseCustomize?.();
    // Chat item: if already on "/" start a new chat instead of no-op navigation
    if (item.to === '/' && location.pathname === '/') {
      e.preventDefault();
      clearMessages();
      navigate('/', { replace: true });
      // Reset backend context (best-effort)
      chatApi.resetContext(provider, model).catch(() => {});
    }
  };

  // Chat link: de-highlight when a conversation is active
  // Active = has sessionId, has URL param, OR has messages (user sent a message, waiting for AI)
  const hasActiveConversation = item.to === '/' && (
    sessionId || searchParams.get('conversationId') || messages.length > 0
  );

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={handleClick}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
          isActive && !isCustomizeOpen && !hasActiveConversation
            ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
        }`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar({ isMobile, isOpen, onClose, onSearchOpen, onCustomizeToggle, isCustomizeOpen, onCloseCustomize, wsStatus, badgeCounts }: SidebarProps) {
  const recents = useSidebarRecents();
  const { config: layoutConfig } = useLayoutConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessionId: chatStoreSessionId, messages: chatMessages } = useChatStore();
  // Active conversation: prefer URL param (sidebar click), fallback to chat store (new chat)
  const activeConversationId = searchParams.get('conversationId') || chatStoreSessionId;

  // Sticky optimistic sidebar entry: persists across clearMessages() until DB entry arrives.
  // Without sticky, clicking "New Chat" before response arrives wipes chatMessages=[],
  // which kills the optimistic entry, and the conversation vanishes from sidebar.
  // The ref keeps the entry alive; it only clears when recents has the real DB row.
  const stickyOptimisticRef = useRef<import('../api/types').Conversation | null>(null);

  const optimisticEntry = useMemo(() => {
    // Build candidate from current chat messages (if any)
    const firstUserMsg = chatMessages.find(m => m.role === 'user');
    if (firstUserMsg) {
      const convId = chatStoreSessionId || '__optimistic__';
      const alreadyInRecents = recents.conversations.some(c => c.id === convId);
      if (!alreadyInRecents) {
        const entry = {
          id: convId,
          title: firstUserMsg.content.slice(0, 80),
          updatedAt: firstUserMsg.timestamp || new Date().toISOString(),
          createdAt: firstUserMsg.timestamp || new Date().toISOString(),
          source: 'web' as const,
        } as import('../api/types').Conversation;
        stickyOptimisticRef.current = entry;
        return entry;
      }
      // DB has it now — clear sticky
      stickyOptimisticRef.current = null;
      return null;
    }

    // Chat was cleared (New Chat) — use sticky ref if DB hasn't caught up yet
    const sticky = stickyOptimisticRef.current;
    if (sticky) {
      const alreadyInRecents = recents.conversations.some(c => c.id === sticky.id);
      if (alreadyInRecents) {
        stickyOptimisticRef.current = null;
        return null;
      }
      return sticky;
    }
    return null;
  }, [chatMessages, chatStoreSessionId, recents.conversations]);
  const toast = useToast();
  const dialog = useDialog();
  const editInputRef = useRef<HTMLInputElement>(null);

  // Config-driven section order: sections in array are shown, sorted by order
  const sidebarSections = layoutConfig.sidebar.sections;
  const visibleSections = useMemo(() =>
    [...(sidebarSections ?? DEFAULT_SIDEBAR_SECTIONS)]
      .sort((a, b) => a.order - b.order),
    [sidebarSections],
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
          const prevGroup = sectionIdx > 0 ? getSectionGroup(visibleSections[sectionIdx - 1]!.id) : currentGroup;
          const divider = sectionIdx > 0 && currentGroup !== prevGroup && DATA_GROUPS.has(currentGroup) ? (
            <div key={`div-${section.id}`} className="border-t border-border dark:border-dark-border my-2" />
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
                  onToggleCollapse={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
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
                  section.id === '/inbox'
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
                  <span className="truncate flex-1">Scheduled</span>
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
                      onClick={() => { onCloseCustomize(); navigate('/history'); }}
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
                  <div data-testid="sidebar-recents">
                    <div className="flex items-center px-3 py-1 gap-1.5">
                      <button
                        onClick={() => setCollapsed((prev) => ({ ...prev, recents: !prev.recents }))}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                        aria-label={collapsed.recents ? 'Expand recents' : 'Collapse recents'}
                      >
                        <ChevronRight className={`w-[17px] h-[17px] shrink-0 transition-transform duration-150 ${!collapsed.recents ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/history'); }}
                        className="flex-1 text-left text-[15px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                      >
                        Recent
                      </button>
                    </div>
                    {!collapsed.recents && <><div className="px-2 pb-1">
                      <input
                        type="text"
                        value={recents.search}
                        onChange={(e) => recents.setSearch(e.target.value)}
                        placeholder="Search\u2026"
                        data-testid="sidebar-recents-search"
                        className="w-full px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
                      />
                    </div>
                    {recents.availablePlatforms.size > 0 && (
                      <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto">
                        {(['all', 'web', ...(recents.availablePlatforms.has('whatsapp') ? ['whatsapp'] : []), ...(recents.availablePlatforms.has('telegram') ? ['telegram'] : [])] as SourceFilter[]).map((tab) => (
                          <button
                            key={tab}
                            onClick={() => recents.setSourceFilter(tab)}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                              recents.sourceFilter === tab
                                ? 'bg-primary text-white'
                                : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                            }`}
                          >
                            {tab === 'all' && 'All'}
                            {tab === 'web' && <><Globe className="w-2.5 h-2.5" /> Web</>}
                            {tab === 'whatsapp' && <><WhatsApp className="w-2.5 h-2.5" /> WA</>}
                            {tab === 'telegram' && <><Telegram className="w-2.5 h-2.5" /> TG</>}
                          </button>
                        ))}
                      </div>
                    )}
                    {recents.isLoading && recents.conversations.length === 0 ? (
                      <div className="space-y-1 px-2 py-1">
                        {[...Array(4)].map((_, i) => (
                          <div key={i} className="h-6 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary animate-pulse" />
                        ))}
                      </div>
                    ) : recents.conversations.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted italic">
                        {recents.search ? 'No results' : 'No conversations yet'}
                      </div>
                    ) : (
                      <>
                      {/* Optimistic entry: shows immediately when user sends a message */}
                      {optimisticEntry && (
                        <div>
                          <div
                            className="group relative flex items-center gap-1.5 px-2 py-1.5 mx-1 my-0.5 rounded-md cursor-pointer transition-colors bg-primary/10 text-primary"
                          >
                            <MessageSquare className="w-3 h-3 shrink-0 opacity-50" />
                            <span className="truncate text-xs flex-1">{optimisticEntry.title}</span>
                          </div>
                        </div>
                      )}
                      {recents.groups.map((group) => (
                        <div key={group.label}>
                          <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-dark-text-muted">{group.label}</p>
                          {group.items.map((conv) => {
                            const isActiveConv = activeConversationId === conv.id;
                            const isEditing = recents.editingId === conv.id;
                            const title = getConvTitle(conv);
                            const isChannel = conv.source === 'channel';
                            const isTelegram = conv.channelPlatform === 'telegram';
                            return (
                              <div
                                key={conv.id}
                                data-testid={`recent-item-${conv.id}`}
                                onClick={isEditing ? undefined : () => handleRecentClick(conv.id)}
                                className={`group relative flex items-center gap-1.5 px-2 py-1.5 mx-1 my-0.5 rounded-md cursor-pointer transition-colors ${
                                  isActiveConv ? 'bg-primary/10 text-primary' : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
                                }`}
                              >
                                {isChannel && isTelegram ? <Telegram className="w-3 h-3 shrink-0 opacity-60" /> : isChannel && conv.channelPlatform === 'whatsapp' ? <WhatsApp className="w-3 h-3 shrink-0 opacity-60" /> : isChannel ? <MessageSquare className="w-3 h-3 shrink-0 opacity-60" /> : <Globe className="w-3 h-3 shrink-0 opacity-30" />}
                                {isEditing ? (
                                  <input
                                    ref={editInputRef}
                                    value={recents.editTitle}
                                    onChange={(e) => recents.setEditTitle(e.target.value)}
                                    onBlur={() => handleCommitEdit(conv.id)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleCommitEdit(conv.id); if (e.key === 'Escape') recents.cancelEdit(); }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 min-w-0 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-primary rounded px-1 py-0.5 outline-none"
                                    autoFocus
                                  />
                                ) : (
                                  <span className="flex-1 min-w-0 text-xs truncate leading-snug" title={title}>{title}</span>
                                )}
                                {!isEditing && (
                                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                    <button onClick={(e) => handleStartEdit(conv, e)} title="Rename" className="p-0.5 rounded transition-colors hover:text-text-primary dark:hover:text-dark-text-primary"><Edit2 className="w-2.5 h-2.5" /></button>
                                    <button onClick={(e) => handleDeleteConv(conv.id, e)} title="Delete" className="p-0.5 rounded hover:text-error transition-colors"><Trash2 className="w-2.5 h-2.5" /></button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      </>
                    )}
                    {recents.total > recents.conversations.length && (
                      <p className="px-3 py-1 text-[10px] text-text-muted dark:text-dark-text-muted text-center">+{recents.total - recents.conversations.length} older</p>
                    )}
                    <NavLink to="/history" end onClick={onCloseCustomize} className="flex items-center px-3 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors">
                      All conversations &rarr;
                    </NavLink>
                    </>}
                  </div>
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

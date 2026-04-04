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
import { usePinnedItems, type SidebarPinnedConfig } from '../hooks/usePinnedItems';
import { useChatStore } from '../hooks/useChatStore';
import { useSidebarRecents, getConvTitle } from '../hooks/useSidebarRecents';
import type { SourceFilter } from '../hooks/useSidebarRecents';
import { useSidebarProjects } from '../hooks/useSidebarProjects';
import { useSidebarWorkflows } from '../hooks/useSidebarWorkflows';
import { useLayoutConfig } from '../hooks/useLayoutConfig';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import { SIDEBAR_WIDTH_VALUES, DEFAULT_SIDEBAR_SECTIONS } from '../types/layout-config';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { useToast } from './ToastProvider';
import { useDialog } from './ConfirmDialog';
import { X, ChevronRight, Search, Calendar, FolderOpen, GitBranch, Plus, Edit2, Trash2, Globe, MessageSquare, Telegram, WhatsApp } from './icons';
import type { NavItem } from '../constants/nav-items';
import type { Conversation } from '../api/types';
import { chatApi } from '../api/endpoints/chat';

/** Section IDs that get a divider rendered before them */
const DIVIDER_BEFORE = new Set(['workspaces', 'workflows', 'recents']);

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
  const { clearMessages, provider, model } = useChatStore();
  const navigate = useNavigate();

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

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={handleClick}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
          isActive && !isCustomizeOpen
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

function PinnedNavGroup({ config, onCloseCustomize, isCustomizeOpen }: { config: Extract<SidebarPinnedConfig, { type: 'group' }>; onCloseCustomize?: () => void; isCustomizeOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const hasActiveChild = config.items.some((path) => location.pathname === path);

  return (
    <div>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
          (hasActiveChild && !isCustomizeOpen) || isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
        }`}
      >
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} />
        <span className="truncate flex-1 text-left">{config.label}</span>
        <span className="text-[10px] opacity-50">{config.items.length}</span>
      </button>
      {isOpen && (
        <div className="ml-3 pl-2 border-l border-border dark:border-dark-border space-y-0.5 mt-0.5">
          {config.items.map((path) => {
            const navItem = NAV_ITEM_MAP.get(path);
            if (!navItem) return null;
            const Icon = navItem.icon;
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => { onCloseCustomize?.(); navigate(path); }}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded-md transition-colors text-sm ${
                  isActive && !isCustomizeOpen
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{navItem.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ isMobile, isOpen, onClose, onSearchOpen, onCustomizeToggle, isCustomizeOpen, onCloseCustomize, wsStatus, badgeCounts }: SidebarProps) {
  const { pinnedConfigs } = usePinnedItems();
  const recents = useSidebarRecents();
  const { projects, isLoading: projectsLoading } = useSidebarProjects();
  const { workflows, isLoading: workflowsLoading } = useSidebarWorkflows();
  const { config: layoutConfig } = useLayoutConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeConversationId = searchParams.get('conversationId');
  const toast = useToast();
  const dialog = useDialog();
  const editInputRef = useRef<HTMLInputElement>(null);

  // Config-driven section order: visible sections sorted by order
  // Depends on sidebar.sections specifically (not entire config) to avoid unnecessary re-renders
  const sidebarSections = layoutConfig.sidebar.sections;
  const visibleSections = useMemo(() =>
    (sidebarSections ?? DEFAULT_SIDEBAR_SECTIONS)
      .filter((s) => s.visible)
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
          // Show divider before data sections, but not if it's the first visible section
          const divider = DIVIDER_BEFORE.has(section.id) && sectionIdx > 0 ? (
            <div key={`div-${section.id}`} className="border-t border-border dark:border-dark-border my-2" />
          ) : null;

          switch (section.id) {
            case 'pinned':
              return (
                <div key="pinned" className="space-y-0.5 mb-2" data-testid="sidebar-pinned-items">
                  {pinnedConfigs.map((cfg) => {
                    if (cfg.type === 'item') {
                      const item = NAV_ITEM_MAP.get(cfg.path);
                      if (!item) return null;
                      return (
                        <PinnedNavLink
                          key={cfg.path}
                          item={item}
                          onCloseCustomize={onCloseCustomize}
                          isCustomizeOpen={isCustomizeOpen}
                          badge={
                            cfg.path === '/inbox'
                              ? badgeCounts.inbox
                              : cfg.path === '/tasks'
                                ? badgeCounts.tasks
                                : undefined
                          }
                        />
                      );
                    }
                    if (cfg.type === 'group') {
                      return (
                        <PinnedNavGroup
                          key={cfg.id}
                          config={cfg}
                          onCloseCustomize={onCloseCustomize}
                          isCustomizeOpen={isCustomizeOpen}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              );

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
                <div key="customize" className="mb-3" data-testid="sidebar-customize-link">
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

            case 'workspaces':
              return (
                <div key="workspaces">
                  {divider}
                  <div className="mb-2" data-testid="sidebar-projects">
                    <div className="flex items-center px-3 py-1 gap-1">
                      <button
                        onClick={() => setCollapsed((prev) => ({ ...prev, workspaces: !prev.workspaces }))}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                        aria-label={collapsed.workspaces ? 'Expand workspaces' : 'Collapse workspaces'}
                      >
                        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-150 ${!collapsed.workspaces ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/workspaces'); }}
                        className="flex-1 text-left text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                      >
                        Workspaces
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/workspaces'); }}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                        aria-label="New project"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {!collapsed.workspaces && (projectsLoading ? (
                      <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">Loading...</div>
                    ) : projects.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">No projects</div>
                    ) : (
                      <div className="space-y-0.5">
                        {projects.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => { onCloseCustomize(); navigate(`/workspaces?id=${project.id}`); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                            title={project.name}
                          >
                            <FolderOpen className="w-4 h-4 shrink-0 opacity-60" />
                            <span className="truncate flex-1">{project.name.length > 25 ? project.name.slice(0, 25) + '\u2026' : project.name}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );

            case 'workflows':
              return (
                <div key="workflows">
                  {divider}
                  <div className="mb-2" data-testid="sidebar-workflows">
                    <div className="flex items-center px-3 py-1 gap-1">
                      <button
                        onClick={() => setCollapsed((prev) => ({ ...prev, workflows: !prev.workflows }))}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                        aria-label={collapsed.workflows ? 'Expand workflows' : 'Collapse workflows'}
                      >
                        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-150 ${!collapsed.workflows ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/workflows'); }}
                        className="flex-1 text-left text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                      >
                        Workflows
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/workflows'); }}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                        aria-label="New workflow"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {!collapsed.workflows && (workflowsLoading ? (
                      <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">Loading...</div>
                    ) : workflows.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">No workflows</div>
                    ) : (
                      <div className="space-y-0.5">
                        {workflows.map((wf) => (
                          <button
                            key={wf.id}
                            onClick={() => { onCloseCustomize(); navigate(`/workflows/${wf.id}`); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                            title={wf.name}
                          >
                            <GitBranch className="w-4 h-4 shrink-0 opacity-60" />
                            <span className="truncate flex-1">{wf.name.length > 25 ? wf.name.slice(0, 25) + '\u2026' : wf.name}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );

            case 'recents':
              return (
                <div key="recents">
                  {divider}
                  <div className="mb-2" data-testid="sidebar-recents">
                    <div className="flex items-center px-3 py-1 gap-1">
                      <button
                        onClick={() => setCollapsed((prev) => ({ ...prev, recents: !prev.recents }))}
                        className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                        aria-label={collapsed.recents ? 'Expand recents' : 'Collapse recents'}
                      >
                        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-150 ${!collapsed.recents ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        onClick={() => { onCloseCustomize(); navigate('/history'); }}
                        className="flex-1 text-left text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
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
                      recents.groups.map((group) => (
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
                      ))
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

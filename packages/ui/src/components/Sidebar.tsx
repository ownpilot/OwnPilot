/**
 * Sidebar — replaces Layout.tsx <aside> block.
 *
 * MOBILE CONTRACT: <aside> is the sole CSS transform target.
 * Do NOT add position:fixed or overflow:hidden wrappers around <aside>.
 * Mobile slide: translate-x-0 (open) / -translate-x-full (closed).
 */
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useSidebarRecents } from '../hooks/useSidebarRecents';
import { useSidebarProjects } from '../hooks/useSidebarProjects';
import { useSidebarWorkflows } from '../hooks/useSidebarWorkflows';
import { ALL_NAV_ITEMS } from '../constants/nav-items';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { X, ChevronRight, Search, Calendar, FolderOpen, GitBranch, Plus } from './icons';
import type { NavItem } from '../constants/nav-items';

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

// Build a lookup map: route path → NavItem (for icon + label resolution)
const NAV_ITEM_MAP = new Map<string, NavItem>(ALL_NAV_ITEMS.map((item) => [item.to, item]));

function PinnedNavLink({ item, badge, onCloseCustomize, isCustomizeOpen }: { item: NavItem; badge?: number; onCloseCustomize?: () => void; isCustomizeOpen?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onCloseCustomize}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
          isActive && !isCustomizeOpen
            ? 'bg-primary text-white shadow-sm border-l-[3px] border-white/50'
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
  const { pinnedItems } = usePinnedItems();
  const { conversations, isLoading: recentsLoading } = useSidebarRecents();
  const { projects, isLoading: projectsLoading } = useSidebarProjects();
  const { workflows, isLoading: workflowsLoading } = useSidebarWorkflows();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeConversationId = searchParams.get('conversationId');

  // Resolve NavItem objects from pinned route paths.
  const pinnedNavItems = pinnedItems
    .map((path) => NAV_ITEM_MAP.get(path))
    .filter((item): item is NavItem => item !== undefined);

  const handleRecentClick = (conversationId: string) => {
    onCloseCustomize();
    navigate(`/?conversationId=${conversationId}`);
  };

  return (
    <aside
      data-testid="sidebar"
      className={
        isMobile
          ? `fixed inset-y-0 left-0 z-40 w-64 bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col transform transition-transform duration-200 ease-out ${
              isOpen ? 'translate-x-0' : '-translate-x-full'
            }`
          : 'w-60 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col'
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

      {/* Navigation */}
      <nav className="flex-1 p-2 overflow-y-auto" data-testid="sidebar-nav">

        {/* Pinned items */}
        <div className="space-y-0.5 mb-2" data-testid="sidebar-pinned-items">
          {pinnedNavItems.map((item) => (
            <PinnedNavLink
              key={item.to}
              item={item}
              onCloseCustomize={onCloseCustomize}
              isCustomizeOpen={isCustomizeOpen}
              badge={
                item.to === '/inbox'
                  ? badgeCounts.inbox
                  : item.to === '/tasks'
                    ? badgeCounts.tasks
                    : undefined
              }
            />
          ))}
        </div>

        {/* Search button */}
        <button
          onClick={onSearchOpen}
          data-testid="sidebar-search-btn"
          className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
        >
          <Search className="w-4 h-4 shrink-0" />
          <span className="truncate flex-1">Search</span>
        </button>

        {/* Scheduled */}
        <NavLink
          to="/calendar"
          end
          onClick={onCloseCustomize}
          data-testid="sidebar-scheduled-link"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
              isActive && !isCustomizeOpen
                ? 'bg-primary text-white shadow-sm border-l-[3px] border-white/50'
                : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
            }`
          }
        >
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="truncate flex-1">Scheduled</span>
        </NavLink>

        {/* Customize toggle — always visible (SB-02) */}
        <div className="mb-3" data-testid="sidebar-customize-link">
          <button
            onClick={onCustomizeToggle}
            className={`w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-left ${
              isCustomizeOpen
                ? 'bg-primary text-white shadow-sm border-l-[3px] border-white/50'
                : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
            }`}
          >
            <ChevronRight className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1">Customize</span>
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-border dark:border-dark-border my-2" />

        {/* Projects section */}
        <div className="mb-2" data-testid="sidebar-projects">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
              Projects
            </span>
            <button
              onClick={() => { onCloseCustomize(); navigate('/workspaces'); }}
              className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
              aria-label="New project"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {projectsLoading ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              Loading...
            </div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              No projects
            </div>
          ) : (
            <div className="space-y-0.5">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => { onCloseCustomize(); navigate(`/workspaces`); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                  title={project.name}
                >
                  <FolderOpen className="w-4 h-4 shrink-0 opacity-60" />
                  <span className="truncate flex-1">
                    {project.name.length > 25
                      ? project.name.slice(0, 25) + '\u2026'
                      : project.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border dark:border-dark-border my-2" />

        {/* Workflows section */}
        <div className="mb-2" data-testid="sidebar-workflows">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
              Workflows
            </span>
            <button
              onClick={() => { onCloseCustomize(); navigate('/workflows'); }}
              className="p-0.5 rounded text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
              aria-label="New workflow"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {workflowsLoading ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              Loading...
            </div>
          ) : workflows.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              No workflows
            </div>
          ) : (
            <div className="space-y-0.5">
              {workflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => { onCloseCustomize(); navigate(`/workflows`); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
                  title={wf.name}
                >
                  <GitBranch className="w-4 h-4 shrink-0 opacity-60" />
                  <span className="truncate flex-1">
                    {wf.name.length > 25
                      ? wf.name.slice(0, 25) + '\u2026'
                      : wf.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border dark:border-dark-border my-2" />

        {/* Recents section (SB-03, SB-04) */}
        <div className="mb-2" data-testid="sidebar-recents">
          <div className="px-3 py-1 text-sm font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
            Recent
          </div>
          {recentsLoading ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
              No recent conversations
            </div>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conv) => {
                const isActiveConv = activeConversationId === conv.id;
                return (
                <button
                  key={conv.id}
                  data-testid={`recent-item-${conv.id}`}
                  onClick={() => handleRecentClick(conv.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base text-left ${
                    isActiveConv
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
                  }`}
                  title={conv.title || conv.id}
                >
                  <span className="truncate flex-1">
                    {conv.title
                      ? conv.title.length > 30
                        ? conv.title.slice(0, 30) + '\u2026'
                        : conv.title
                      : conv.id.slice(0, 8)}
                  </span>
                </button>
                );
              })}
            </div>
          )}
          {/* See all conversations link */}
          <NavLink
            to="/history"
            end
            onClick={onCloseCustomize}
            className="flex items-center px-3 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
          >
            All conversations →
          </NavLink>
        </div>
      </nav>

      {/* Footer */}
      <SidebarFooter wsStatus={wsStatus} />
    </aside>
  );
}

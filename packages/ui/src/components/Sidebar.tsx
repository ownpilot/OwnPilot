/**
 * Sidebar — replaces Layout.tsx <aside> block.
 *
 * MOBILE CONTRACT: <aside> is the sole CSS transform target.
 * Do NOT add position:fixed or overflow:hidden wrappers around <aside>.
 * Mobile slide: translate-x-0 (open) / -translate-x-full (closed).
 */
import { NavLink, useNavigate } from 'react-router-dom';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useSidebarRecents } from '../hooks/useSidebarRecents';
import { ALL_NAV_ITEMS } from '../constants/nav-items';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { X, ChevronRight } from './icons';
import type { NavItem } from '../constants/nav-items';

export interface SidebarProps {
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  wsStatus: ConnectionStatus;
  badgeCounts: { inbox: number; tasks: number };
}

// Build a lookup map: route path → NavItem (for icon + label resolution)
const NAV_ITEM_MAP = new Map<string, NavItem>(ALL_NAV_ITEMS.map((item) => [item.to, item]));

function PinnedNavLink({ item, badge }: { item: NavItem; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-sm ${
          isActive
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

export function Sidebar({ isMobile, isOpen, onClose, wsStatus, badgeCounts }: SidebarProps) {
  const { pinnedItems } = usePinnedItems();
  const { conversations, isLoading: recentsLoading } = useSidebarRecents();
  const navigate = useNavigate();

  // Resolve NavItem objects from pinned route paths.
  // /customize is excluded from pinnedItems render (shown separately as Customize link).
  const pinnedNavItems = pinnedItems
    .filter((path) => path !== '/customize')
    .map((path) => NAV_ITEM_MAP.get(path))
    .filter((item): item is NavItem => item !== undefined);

  const handleRecentClick = (conversationId: string) => {
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
          : 'w-56 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col'
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

        {/* Pinned items (excluding /customize) */}
        <div className="space-y-0.5 mb-2" data-testid="sidebar-pinned-items">
          {pinnedNavItems.map((item) => (
            <PinnedNavLink
              key={item.to}
              item={item}
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

        {/* Customize link — always visible (SB-02) */}
        <div className="mb-3" data-testid="sidebar-customize-link">
          <NavLink
            to="/customize"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-sm ${
                isActive
                  ? 'bg-primary text-white shadow-sm border-l-[3px] border-white/50'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
              }`
            }
          >
            <ChevronRight className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1">Customize</span>
          </NavLink>
        </div>

        {/* Divider */}
        <div className="border-t border-border dark:border-dark-border my-2" />

        {/* Recents section (SB-03, SB-04) */}
        <div className="mb-2" data-testid="sidebar-recents">
          <div className="px-3 py-1 text-xs font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
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
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  data-testid={`recent-item-${conv.id}`}
                  onClick={() => handleRecentClick(conv.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5 text-left"
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
              ))}
            </div>
          )}
          {/* See all conversations link */}
          <NavLink
            to="/history"
            end
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

/**
 * HeaderItem — single pinned nav item rendered in the header bar.
 *
 * Display mode controls rendering: icon-only, icon+text, or text-only.
 * Navigates on click. Shows active state when on the matching route.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import type { NavItem } from '../constants/nav-items';
import type { HeaderItemDisplayMode } from '../types/layout-config';

export function HeaderItem({ item, displayMode = 'icon' }: { item: NavItem; displayMode?: HeaderItemDisplayMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const Icon = item.icon;
  const isActive = location.pathname === item.to;

  return (
    <button
      onClick={() => navigate(item.to)}
      title={item.label}
      className={`h-8 flex items-center justify-center rounded-md transition-colors ${
        displayMode === 'icon' ? 'w-8' : 'px-2 gap-1.5'
      } ${
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
      }`}
    >
      {displayMode !== 'text' && <Icon className="w-4 h-4 shrink-0" />}
      {displayMode !== 'icon' && (
        <span className="text-xs font-medium truncate max-w-[80px]">{item.label}</span>
      )}
    </button>
  );
}

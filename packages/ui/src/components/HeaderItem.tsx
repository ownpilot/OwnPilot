/**
 * HeaderItem — single pinned nav item rendered as an icon-only button in the header bar.
 *
 * Navigates on click. Shows active state when on the matching route.
 * Uses native title attribute for tooltip (consistent with codebase).
 */
import { useNavigate, useLocation } from 'react-router-dom';
import type { NavItem } from '../constants/nav-items';

export function HeaderItem({ item }: { item: NavItem }) {
  const navigate = useNavigate();
  const location = useLocation();
  const Icon = item.icon;
  const isActive = location.pathname === item.to;

  return (
    <button
      onClick={() => navigate(item.to)}
      title={item.label}
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/**
 * HeaderGroup — accordion-style dropdown button for a group of nav items in the header.
 *
 * Shows a truncated label + chevron. Click toggles a positioned dropdown
 * listing the group's child items with icon + label. Click-outside and
 * Escape close the dropdown.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown } from './icons';
import { NAV_ITEM_MAP } from '../constants/nav-items';
import type { HeaderItemConfig } from '../hooks/useHeaderItems';
import type { HeaderItemDisplayMode } from '../types/layout-config';

type GroupConfig = Extract<HeaderItemConfig, { type: 'group' }>;

export function HeaderGroup({ config, displayMode = 'icon' }: { config: GroupConfig; displayMode?: HeaderItemDisplayMode }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const hasActiveChild = config.items.some((path) => location.pathname === path);

  const close = useCallback(() => setIsOpen(false), []);

  // Close on click-outside
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-8 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors max-w-[120px] ${
          hasActiveChild || isOpen
            ? 'bg-primary/15 text-primary'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
        }`}
        title={config.label}
      >
        {displayMode !== 'text' && (() => {
          const firstItem = NAV_ITEM_MAP.get(config.items[0] ?? '');
          if (!firstItem) return null;
          const GroupIcon = firstItem.icon;
          return <GroupIcon className="w-3.5 h-3.5 shrink-0" />;
        })()}
        {displayMode !== 'icon' && <span className="truncate">{config.label}</span>}
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] py-1 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shadow-lg z-50">
          {config.items.map((path) => {
            const navItem = NAV_ITEM_MAP.get(path);
            if (!navItem) return null;
            const Icon = navItem.icon;
            const isActive = location.pathname === path;

            return (
              <button
                key={path}
                onClick={() => {
                  navigate(path);
                  close();
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{navItem.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

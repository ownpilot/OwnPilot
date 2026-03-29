/**
 * CustomizeDetailPanel — right sidebar detail view for /customize route.
 *
 * Replaces StatsPanel when on /customize. Shows selected nav item details
 * with pin/unpin, open page, and show-in-files actions.
 */
import { useNavigate } from 'react-router-dom';
import { ALL_NAV_ITEMS } from '../constants/nav-items';
import { NAV_DESCRIPTIONS } from '../constants/nav-descriptions';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useToast } from './ToastProvider';
import { Pin, ExternalLink, FolderOpen, ChevronRight } from './icons';

interface CustomizeDetailPanelProps {
  selectedItemPath: string | null;
}

export function CustomizeDetailPanel({ selectedItemPath }: CustomizeDetailPanelProps) {
  const navigate = useNavigate();
  const { pinnedItems, setPinnedItems, MAX_PINNED_ITEMS } = usePinnedItems();
  const toast = useToast();

  const item = selectedItemPath
    ? ALL_NAV_ITEMS.find((i) => i.to === selectedItemPath)
    : undefined;

  const isPinned = selectedItemPath ? pinnedItems.includes(selectedItemPath) : false;
  const description = selectedItemPath ? (NAV_DESCRIPTIONS[selectedItemPath] ?? '') : '';

  const handleTogglePin = () => {
    if (!selectedItemPath) return;
    if (!isPinned && pinnedItems.length >= MAX_PINNED_ITEMS) {
      toast.warning(`Pin limit reached \u2014 max ${MAX_PINNED_ITEMS} items`);
      return;
    }
    setPinnedItems((prev) =>
      isPinned ? prev.filter((p) => p !== selectedItemPath) : [...prev, selectedItemPath],
    );
  };

  const handleOpenPage = () => {
    if (selectedItemPath) navigate(selectedItemPath);
  };

  // Empty state — no item selected
  if (!item || !selectedItemPath) {
    return (
      <aside
        className="w-64 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col items-center justify-center"
        data-testid="customize-detail-empty"
      >
        <div className="text-center px-6 text-text-muted dark:text-dark-text-muted">
          <ChevronRight className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an item to see details</p>
        </div>
      </aside>
    );
  }

  const Icon = item.icon;

  return (
    <aside
      className="w-64 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col overflow-hidden"
      data-testid="customize-detail-panel"
    >
      {/* Header: icon + title */}
      <div className="p-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center shrink-0">
            <Icon className="w-[18px] h-[18px] text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary truncate">
            {item.label}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Description */}
        {description && (
          <p className="text-base text-text-secondary dark:text-dark-text-secondary leading-relaxed">
            {description}
          </p>
        )}

        {/* Route */}
        <div>
          <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-2">
            Route
          </h4>
          <code className="inline-block px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-secondary dark:text-dark-text-secondary font-mono">
            {selectedItemPath}
          </code>
        </div>

        {/* Pin status */}
        <div>
          <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-2">
            Status
          </h4>
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary flex items-center gap-1.5">
            <Pin
              className={`w-3.5 h-3.5 shrink-0 ${isPinned ? 'text-primary' : ''}`}
              style={isPinned ? { fill: 'currentColor' } : undefined}
            />
            {isPinned ? 'Pinned to sidebar' : 'Not pinned'}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-border dark:border-dark-border space-y-2">
        <button
          onClick={handleTogglePin}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            isPinned
              ? 'text-error border border-error/30 hover:bg-error/10'
              : 'text-primary bg-primary/10 border border-primary/30 hover:bg-primary/20'
          }`}
          data-testid="customize-detail-pin"
        >
          <Pin
            className="w-3.5 h-3.5"
            style={!isPinned ? { fill: 'currentColor' } : undefined}
          />
          {isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar'}
        </button>

        <button
          onClick={handleOpenPage}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md hover:bg-bg-primary dark:hover:bg-dark-bg-primary transition-colors"
          data-testid="customize-detail-open"
        >
          Open Page
          <ExternalLink className="w-3.5 h-3.5" />
        </button>

        <button
          disabled
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-text-muted dark:text-dark-text-muted border border-border dark:border-dark-border rounded-md opacity-50 cursor-not-allowed"
          title="Coming in Phase 9"
          data-testid="customize-detail-files"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Show in Files
        </button>
      </div>
    </aside>
  );
}

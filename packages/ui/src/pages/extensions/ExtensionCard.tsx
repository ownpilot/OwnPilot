import { Sparkles, Power, Wrench, Zap } from '../../components/icons';
import type { ExtensionInfo } from '../../api/types';
import { STATUS_COLORS, CATEGORY_COLORS } from './constants';

interface ExtensionCardProps {
  pkg: ExtensionInfo;
  onToggle: () => void;
  onClick: () => void;
}

export function ExtensionCard({ pkg, onToggle, onClick }: ExtensionCardProps) {
  const isEnabled = pkg.status === 'enabled';
  const categoryColor = pkg.category
    ? CATEGORY_COLORS[pkg.category] || CATEGORY_COLORS.other
    : null;

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-start justify-between mb-3">
        <button onClick={onClick} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {pkg.icon ? (
              <span className="text-lg">{pkg.icon}</span>
            ) : (
              <Sparkles className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {pkg.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">v{pkg.version}</p>
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`p-2 rounded-lg transition-colors shrink-0 ${
            isEnabled
              ? 'bg-success/10 text-success hover:bg-success/20'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:bg-bg-primary dark:hover:bg-dark-bg-primary'
          }`}
          title={isEnabled ? 'Disable extension' : 'Enable extension'}
        >
          <Power className="w-4 h-4" />
        </button>
      </div>

      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
        {pkg.description || pkg.manifest.description}
      </p>

      {/* Category & Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {categoryColor && pkg.category && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
            {pkg.category.charAt(0).toUpperCase() + pkg.category.slice(1)}
          </span>
        )}
        {pkg.manifest.tags?.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-600 dark:text-gray-400"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Status & Stats */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[pkg.status] || STATUS_COLORS.disabled}`}
        >
          {pkg.status}
        </span>
        <div className="flex items-center gap-3 text-text-muted dark:text-dark-text-muted">
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {pkg.toolCount}
          </span>
          {pkg.triggerCount > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {pkg.triggerCount}
            </span>
          )}
        </div>
      </div>

      {/* Error indicator */}
      {pkg.status === 'error' && pkg.errorMessage && (
        <div className="mt-2 text-xs text-error truncate" title={pkg.errorMessage}>
          {pkg.errorMessage}
        </div>
      )}
    </div>
  );
}

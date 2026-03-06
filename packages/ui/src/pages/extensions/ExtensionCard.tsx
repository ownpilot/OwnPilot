import type { ReactNode } from 'react';
import { Sparkles, Power, Wrench, Zap, Shield } from '../../components/icons';
import type { ExtensionInfo } from '../../api/types';
import { STATUS_COLORS, CATEGORY_COLORS } from './constants';

interface ExtensionCardProps {
  pkg: ExtensionInfo;
  onToggle: () => void;
  onClick: () => void;
  /** Optional badge shown next to the status pill (e.g. format badge from Skills Hub) */
  formatBadge?: ReactNode;
  /** Shows spinner on toggle button while toggling */
  isToggling?: boolean;
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-error',
  critical: 'text-error',
};

export function ExtensionCard({
  pkg,
  onToggle,
  onClick,
  formatBadge,
  isToggling = false,
}: ExtensionCardProps) {
  const isEnabled = pkg.status === 'enabled';
  const security = pkg.manifest._security;
  const categoryColor = pkg.category
    ? CATEGORY_COLORS[pkg.category] || CATEGORY_COLORS.other
    : null;
  const description = pkg.description || pkg.manifest.description;

  return (
    <div
      className={`p-4 bg-bg-secondary dark:bg-dark-bg-secondary border rounded-xl transition-colors ${
        pkg.status === 'error'
          ? 'border-error/30'
          : 'border-border dark:border-dark-border hover:border-primary/30'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <button onClick={onClick} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {pkg.icon ? (
              <span className="text-lg leading-none">{pkg.icon}</span>
            ) : (
              <Sparkles className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
              {pkg.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              v{pkg.version}
              {pkg.authorName && <span className="ml-1.5 opacity-70">by {pkg.authorName}</span>}
            </p>
          </div>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isToggling) onToggle();
          }}
          disabled={isToggling}
          className={`p-2 rounded-lg transition-colors shrink-0 ${
            isToggling
              ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted cursor-wait'
              : isEnabled
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:bg-bg-primary dark:hover:bg-dark-bg-primary'
          }`}
          title={isToggling ? 'Please wait...' : isEnabled ? 'Disable' : 'Enable'}
        >
          {isToggling ? (
            <div className="w-4 h-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
          ) : (
            <Power className="w-4 h-4" />
          )}
        </button>
      </div>

      {description && (
        <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
          {description}
        </p>
      )}

      {/* Category & Tags */}
      {(categoryColor || (pkg.manifest.tags?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {categoryColor && pkg.category && (
            <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
              {pkg.category.charAt(0).toUpperCase() + pkg.category.slice(1)}
            </span>
          )}
          {pkg.manifest.tags?.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-600 dark:text-gray-400"
            >
              {tag}
            </span>
          ))}
          {(pkg.manifest.tags?.length ?? 0) > 4 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-500/10 text-gray-500 dark:text-gray-500">
              +{(pkg.manifest.tags?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}

      {/* Status & Stats */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[pkg.status] || STATUS_COLORS.disabled}`}
          >
            {pkg.status}
          </span>
          {formatBadge}
          {security && security.riskLevel !== 'low' && (
            <span
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-current/10 ${RISK_COLORS[security.riskLevel] || ''}`}
              title={`Security: ${security.riskLevel} risk — ${security.warnings?.join(', ') || 'no details'}`}
            >
              <Shield className="w-3 h-3" />
              {security.riskLevel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-text-muted dark:text-dark-text-muted">
          {pkg.toolCount > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {pkg.toolCount}
            </span>
          )}
          {pkg.triggerCount > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {pkg.triggerCount}
            </span>
          )}
        </div>
      </div>

      {/* Error message */}
      {pkg.status === 'error' && pkg.errorMessage && (
        <div
          className="mt-2 text-xs text-error bg-error/5 rounded px-2 py-1 line-clamp-2"
          title={pkg.errorMessage}
        >
          {pkg.errorMessage}
        </div>
      )}

      {/* Installed date */}
      {pkg.installedAt && (
        <div className="mt-2 text-xs text-text-muted dark:text-dark-text-muted opacity-60">
          Installed {new Date(pkg.installedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

import { CheckCircle2, Download, ExternalLink } from '../../components/icons';
import type { NpmSearchPackage } from '../../api/endpoints/skills';

interface DiscoverCardProps {
  pkg: NpmSearchPackage;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
  onKeywordClick?: (kw: string) => void;
}

export function DiscoverCard({
  pkg,
  isInstalled,
  isInstalling,
  onInstall,
  onKeywordClick,
}: DiscoverCardProps) {
  const publishedDate = pkg.date ? new Date(pkg.date).toLocaleDateString() : null;

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl flex flex-col gap-3 hover:border-primary/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
            {pkg.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              v{pkg.version}
            </span>
            {pkg.author && (
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                · by {pkg.author}
              </span>
            )}
            {publishedDate && (
              <span className="text-xs text-text-muted/70 dark:text-dark-text-muted/70">
                · {publishedDate}
              </span>
            )}
          </div>
        </div>

        {pkg.links?.npm && (
          <a
            href={pkg.links.npm}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary rounded transition-colors shrink-0"
            title="View on npm"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {pkg.description && (
        <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 flex-1">
          {pkg.description}
        </p>
      )}

      {pkg.keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pkg.keywords.slice(0, 5).map((kw) => (
            <button
              key={kw}
              onClick={() => onKeywordClick?.(kw)}
              className={`px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors ${
                onKeywordClick
                  ? 'hover:bg-primary/10 hover:text-primary cursor-pointer'
                  : 'cursor-default'
              }`}
              title={onKeywordClick ? `Search for "${kw}"` : undefined}
            >
              {kw}
            </button>
          ))}
          {pkg.keywords.length > 5 && (
            <span className="px-1.5 py-0.5 text-xs text-text-muted/60 dark:text-dark-text-muted/60">
              +{pkg.keywords.length - 5}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto">
        <button
          onClick={onInstall}
          disabled={isInstalled || isInstalling}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            isInstalled
              ? 'bg-success/15 text-success cursor-default'
              : isInstalling
                ? 'bg-primary/20 text-primary cursor-wait'
                : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {isInstalled ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Installed
            </>
          ) : isInstalling ? (
            <>
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Installing…
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Install
            </>
          )}
        </button>
      </div>
    </div>
  );
}

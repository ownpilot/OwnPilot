/**
 * Skills & Extensions Widget - Shows installed skills and extensions
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Puzzle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
} from '../icons';
import { extensionsApi, type ExtensionInfo } from '../../api';
import { Skeleton } from '../Skeleton';

function getStatusBadge(enabled: boolean) {
  return enabled ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-success/10 text-success">
      <CheckCircle2 className="w-3 h-3" />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-text-muted/10 text-text-muted dark:bg-dark-text-muted/10 dark:text-dark-text-muted">
      <XCircle className="w-3 h-3" />
      Disabled
    </span>
  );
}

interface SkillsWidgetProps {
  limit?: number;
}

export function SkillsWidget({ limit = 6 }: SkillsWidgetProps) {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await extensionsApi.list();
        setExtensions(result);
      } catch {
        setError('Failed to load extensions');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const displayExtensions = extensions.slice(0, limit);
  const enabledCount = extensions.filter((e) => e.status === 'enabled').length;

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Extensions
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Extensions
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displayExtensions.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Extensions
          </h3>
        </div>
        <div className="text-center py-6">
          <Puzzle className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No extensions installed
          </p>
          <Link
            to="/skills"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            Browse skills
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Puzzle className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Extensions
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({extensions.length})
          </span>
        </div>
        <span className="text-xs text-success">
          {enabledCount} enabled
        </span>
      </div>

      <div className="space-y-2">
        {displayExtensions.map((ext) => (
          <Link
            key={ext.id}
            to={`/extensions/${ext.id}`}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                  {ext.name}
                </span>
                {getStatusBadge(ext.status === 'enabled')}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                <span>v{ext.version || '1.0.0'}</span>
                {ext.category && (
                  <>
                    <span>•</span>
                    <span>{ext.category}</span>
                  </>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {extensions.length > limit && (
        <Link
          to="/extensions"
          className="block text-center text-xs text-primary hover:underline mt-3 pt-3 border-t border-border dark:border-dark-border"
        >
          View all ({extensions.length})
        </Link>
      )}
    </div>
  );
}
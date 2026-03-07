import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  RefreshCw,
  Plus,
  Search,
  ChevronDown,
  AlertTriangle,
  RefreshCw as UpdateIcon,
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi } from '../../api/endpoints/extensions';
import { skillsApi } from '../../api/endpoints/skills';
import type { ExtensionInfo } from '../../api/types';
import { ExtensionCard } from '../extensions/ExtensionCard';
import { ExtensionDetailModal } from '../extensions/ExtensionDetailModal';
import { QuickInstallModal } from './QuickInstallModal';
import { FORMAT_BADGE_COLORS, FORMAT_LABELS } from './constants';

interface InstalledTabProps {
  initialFormat?: string;
  /** Notify parent of total installed count */
  onCountChange?: (count: number) => void;
}

type SortKey = 'name' | 'date' | 'status';

function getFormat(pkg: ExtensionInfo): string {
  return ((pkg.manifest as Record<string, unknown>).format as string | undefined) ?? 'ownpilot';
}

function FormatBadge({ fmt }: { fmt: string }) {
  const color = FORMAT_BADGE_COLORS[fmt] ?? FORMAT_BADGE_COLORS.ownpilot;
  const label = FORMAT_LABELS[fmt] ?? fmt;
  return <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${color}`}>{label}</span>;
}

/** Simple confirmation dialog */
function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary dark:text-dark-text-primary">{message}</p>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-error text-white rounded-lg hover:bg-error/90 transition-colors"
          >
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstalledTab({ initialFormat, onCountChange }: InstalledTabProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<ExtensionInfo | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | 'agentskills' | 'ownpilot'>(
    initialFormat === 'ownpilot'
      ? 'ownpilot'
      : initialFormat === 'agentskills'
        ? 'agentskills'
        : 'all'
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [confirmUninstall, setConfirmUninstall] = useState<ExtensionInfo | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);

  const fetchPackages = useCallback(async () => {
    try {
      const data = await extensionsApi.list();
      const list = Array.isArray(data) ? data : [];
      setPackages(list);
      onCountChange?.(list.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  }, [toast, onCountChange]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const togglePackage = async (pkg: ExtensionInfo) => {
    setTogglingIds((prev) => new Set([...prev, pkg.id]));
    try {
      if (pkg.status === 'enabled') {
        await extensionsApi.disable(pkg.id);
        toast.success(`Disabled "${pkg.name}"`);
      } else {
        await extensionsApi.enable(pkg.id);
        toast.success(`Enabled "${pkg.name}"`);
      }
      await fetchPackages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle skill');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(pkg.id);
        return next;
      });
    }
  };

  const uninstallPackage = async (pkg: ExtensionInfo) => {
    try {
      await extensionsApi.uninstall(pkg.id);
      toast.success(`Uninstalled "${pkg.name}"`);
      setSelectedPackage(null);
      await fetchPackages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Uninstall failed');
    }
  };

  /** Enable or disable all packages in the current filtered list */
  const bulkToggle = async (enable: boolean) => {
    const targets = filteredPackages.filter((p) =>
      enable ? p.status !== 'enabled' : p.status === 'enabled'
    );
    if (!targets.length) return;
    const ids = targets.map((p) => p.id);
    setTogglingIds((prev) => new Set([...prev, ...ids]));
    try {
      await Promise.all(
        targets.map((p) => (enable ? extensionsApi.enable(p.id) : extensionsApi.disable(p.id)))
      );
      toast.success(
        `${enable ? 'Enabled' : 'Disabled'} ${targets.length} skill${targets.length !== 1 ? 's' : ''}`
      );
      await fetchPackages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk toggle failed');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const checkUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      const res = await skillsApi.checkUpdates();
      const count = res.updates?.length ?? 0;
      setUpdateCount(count);
      if (count === 0) {
        toast.info('All skills are up to date');
      } else {
        toast.success(`${count} update${count !== 1 ? 's' : ''} available`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update check failed');
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const filteredPackages = useMemo(() => {
    let list = packages;

    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (formatFilter !== 'all') list = list.filter((p) => getFormat(p) === formatFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          ((p.manifest as Record<string, unknown>).tags as string[] | undefined)?.some((t) =>
            t.toLowerCase().includes(q)
          )
      );
    }

    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'date') return b.installedAt.localeCompare(a.installedAt);
      if (sort === 'status') return a.status.localeCompare(b.status);
      return 0;
    });

    return list;
  }, [packages, statusFilter, formatFilter, search, sort]);

  const stats = useMemo(
    () => ({
      total: packages.length,
      enabled: packages.filter((p) => p.status === 'enabled').length,
      agentskills: packages.filter((p) => getFormat(p) === 'agentskills').length,
      ownpilot: packages.filter((p) => getFormat(p) === 'ownpilot').length,
    }),
    [packages]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border dark:border-dark-border">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, description, tags..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Status filter */}
        <div className="flex gap-1">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                statusFilter === f
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Format filter */}
        <div className="relative">
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as 'all' | 'agentskills' | 'ownpilot')}
            className="appearance-none pl-3 pr-7 py-1.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-secondary dark:text-dark-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="all">All Formats</option>
            <option value="agentskills">SKILL.md</option>
            <option value="ownpilot">Extension</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="appearance-none pl-3 pr-7 py-1.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-secondary dark:text-dark-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="name">Sort: Name</option>
            <option value="date">Sort: Newest</option>
            <option value="status">Sort: Status</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Bulk actions — shown when filtered list has multiple packages */}
          {filteredPackages.length > 1 && (
            <div className="flex items-center gap-1 border border-border dark:border-dark-border rounded-lg overflow-hidden">
              <button
                onClick={() => bulkToggle(true)}
                disabled={
                  togglingIds.size > 0 || filteredPackages.every((p) => p.status === 'enabled')
                }
                className="px-2.5 py-1.5 text-xs text-success hover:bg-success/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Enable all shown"
              >
                Enable all
              </button>
              <div className="w-px h-4 bg-border dark:bg-dark-border" />
              <button
                onClick={() => bulkToggle(false)}
                disabled={
                  togglingIds.size > 0 || filteredPackages.every((p) => p.status !== 'enabled')
                }
                className="px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Disable all shown"
              >
                Disable all
              </button>
            </div>
          )}

          {/* Check for updates */}
          <button
            onClick={checkUpdates}
            disabled={isCheckingUpdates}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors disabled:opacity-50 relative"
            title="Check for updates"
          >
            <UpdateIcon className={`w-3.5 h-3.5 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
            Updates
            {updateCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 bg-warning text-white text-[10px] font-bold rounded-full leading-none">
                {updateCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowInstallModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Install
          </button>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchPackages();
            }}
            disabled={isLoading}
            className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats.total > 0 && (
        <div className="px-6 py-2 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex items-center gap-5 text-xs text-text-muted dark:text-dark-text-muted flex-wrap">
          <span>
            <span className="font-medium text-text-primary dark:text-dark-text-primary">
              {stats.total}
            </span>{' '}
            installed
            {search.trim() && filteredPackages.length !== stats.total && (
              <span className="ml-1 text-primary">({filteredPackages.length} shown)</span>
            )}
          </span>
          <span>
            <span className="font-medium text-success">{stats.enabled}</span> enabled
          </span>
          <span>
            <span className="font-medium text-blue-500">{stats.agentskills}</span> SKILL.md
          </span>
          <span>
            <span className="font-medium text-purple-500">{stats.ownpilot}</span> Extension
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingSpinner message="Loading installed skills..." />
        ) : filteredPackages.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={search.trim() ? `No results for "${search}"` : 'No skills installed'}
            description={
              search.trim()
                ? 'Try different keywords, or clear the search.'
                : statusFilter !== 'all' || formatFilter !== 'all'
                  ? 'No skills match the current filters.'
                  : 'Click "Install" to add a skill or extension.'
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPackages.map((pkg) => (
              <ExtensionCard
                key={pkg.id}
                pkg={pkg}
                onToggle={() => togglePackage(pkg)}
                onClick={() => setSelectedPackage(pkg)}
                formatBadge={<FormatBadge fmt={getFormat(pkg)} />}
                isToggling={togglingIds.has(pkg.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedPackage && (
        <ExtensionDetailModal
          pkg={selectedPackage}
          onClose={() => setSelectedPackage(null)}
          onToggle={() => togglePackage(selectedPackage)}
          onUninstall={() => setConfirmUninstall(selectedPackage)}
          onEditFiles={
            selectedPackage.sourcePath
              ? () => navigate(`/skills/${selectedPackage.id}/edit`)
              : undefined
          }
          onUpdated={(updated) => {
            setSelectedPackage(updated);
            setPackages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          }}
        />
      )}

      {/* Uninstall Confirmation */}
      {confirmUninstall && (
        <ConfirmDialog
          message={`Uninstall "${confirmUninstall.name}"? This cannot be undone.`}
          onConfirm={() => {
            uninstallPackage(confirmUninstall);
            setConfirmUninstall(null);
          }}
          onCancel={() => setConfirmUninstall(null)}
        />
      )}

      {/* Install Modal */}
      {showInstallModal && (
        <QuickInstallModal
          onClose={() => setShowInstallModal(false)}
          onInstalled={() => {
            setShowInstallModal(false);
            fetchPackages();
          }}
        />
      )}
    </div>
  );
}

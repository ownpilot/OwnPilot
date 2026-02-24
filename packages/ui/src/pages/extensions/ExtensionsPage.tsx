import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Wrench,
  Zap,
  RefreshCw,
  FolderOpen,
  Plus,
  Code,
  Upload,
} from '../../components/icons';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi } from '../../api/endpoints/extensions';
import type { ExtensionInfo } from '../../api/types';
import { ExtensionCard } from './ExtensionCard';
import { InstallModal } from './InstallModal';
import { ExtensionDetailModal } from './ExtensionDetailModal';
import { CreatorModal } from './CreatorModal';

export function ExtensionsPage() {
  const toast = useToast();
  const [packages, setPackages] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<ExtensionInfo | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);

  const fetchPackages = useCallback(async () => {
    try {
      const data = await extensionsApi.list({ format: 'ownpilot' });
      setPackages(Array.isArray(data) ? data : []);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const togglePackage = async (pkg: ExtensionInfo) => {
    const action = pkg.status === 'enabled' ? 'disable' : 'enable';
    try {
      if (action === 'enable') {
        await extensionsApi.enable(pkg.id);
      } else {
        await extensionsApi.disable(pkg.id);
      }
      toast.success(action === 'enable' ? 'Extension enabled' : 'Extension disabled');
      fetchPackages();
    } catch {
      // API client handles error reporting
    }
  };

  const uninstallPackage = async (pkg: ExtensionInfo) => {
    try {
      await extensionsApi.uninstall(pkg.id);
      toast.success(`Uninstalled "${pkg.name}"`);
      setSelectedPackage(null);
      fetchPackages();
    } catch {
      // API client handles error reporting
    }
  };

  const scanDirectory = async () => {
    try {
      const result = await extensionsApi.scan();
      if (result.installed > 0) {
        toast.success(`Scan complete: ${result.installed} package(s) installed`);
      } else {
        toast.info('Scan complete: no new extensions found');
      }
      if (result.errors?.length) {
        toast.warning(`${result.errors.length} error(s) during scan`);
      }
      fetchPackages();
    } catch {
      // API client handles error reporting
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';

    setIsUploading(true);
    try {
      const result = await extensionsApi.upload(file);
      toast.success(result.message || `Uploaded "${file.name}"`);
      fetchPackages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const filteredPackages = packages.filter((p) => {
    if (filter === 'enabled') return p.status === 'enabled';
    if (filter === 'disabled') return p.status === 'disabled';
    return true;
  });

  const stats = {
    total: packages.length,
    enabled: packages.filter((p) => p.status === 'enabled').length,
    disabled: packages.filter((p) => p.status === 'disabled').length,
    totalTools: packages.reduce((sum, p) => sum + p.toolCount, 0),
    totalTriggers: packages.reduce((sum, p) => sum + p.triggerCount, 0),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            User Extensions
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Shareable bundles of tools, prompts, and triggers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scanDirectory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            title="Scan extensions directory for new packages"
          >
            <FolderOpen className="w-4 h-4" />
            Scan
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.json,.zip"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors disabled:opacity-50"
            title="Upload extension file (.md, .json, or .zip)"
          >
            <Upload className="w-4 h-4" />
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
          <button
            onClick={() => setShowCreatorModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors"
          >
            <Code className="w-4 h-4" />
            Create
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
            className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      {stats.total > 0 && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-text-muted dark:text-dark-text-muted">Total:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {stats.total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text-muted dark:text-dark-text-muted">Enabled:</span>
              <span className="font-medium text-success">{stats.enabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted dark:text-dark-text-muted">Disabled:</span>
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                {stats.disabled}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              <span className="text-text-muted dark:text-dark-text-muted">Tools:</span>
              <span className="font-medium text-primary">{stats.totalTools}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              <span className="text-text-muted dark:text-dark-text-muted">Triggers:</span>
              <span className="font-medium text-warning">{stats.totalTriggers}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border">
        <div className="flex gap-2">
          {(['all', 'enabled', 'disabled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingSpinner message="Loading extensions..." />
        ) : filteredPackages.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={`No extensions ${filter !== 'all' ? filter : 'installed'}`}
            description={
              filter === 'all'
                ? 'Click "Install" to add an extension from a JSON manifest, or "Scan" to discover packages from the extensions directory.'
                : `No ${filter} extensions found.`
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
          onUninstall={() => uninstallPackage(selectedPackage)}
        />
      )}

      {/* Install Modal */}
      {showInstallModal && (
        <InstallModal
          onClose={() => setShowInstallModal(false)}
          onInstalled={() => {
            setShowInstallModal(false);
            fetchPackages();
          }}
        />
      )}

      {/* Creator Modal */}
      {showCreatorModal && (
        <CreatorModal
          onClose={() => setShowCreatorModal(false)}
          onCreated={() => {
            setShowCreatorModal(false);
            fetchPackages();
          }}
        />
      )}
    </div>
  );
}

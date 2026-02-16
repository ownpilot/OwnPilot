import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Power, Wrench, Zap, RefreshCw, Globe, Clock, AlertTriangle, Shield, X, Plus, FolderOpen, Trash2, ChevronDown, ChevronRight, Copy, Code, Check } from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { skillPackagesApi } from '../api/endpoints/skill-packages';
import type { SkillPackageInfo } from '../api/types';

const STATUS_COLORS: Record<string, string> = {
  enabled: 'bg-success/20 text-success',
  disabled: 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted',
  error: 'bg-error/20 text-error',
};

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  communication: 'bg-green-500/20 text-green-600 dark:text-green-400',
  utilities: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
  data: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  integrations: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  media: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
  developer: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  lifestyle: 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
  other: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
};

export function SkillPackagesPage() {
  const toast = useToast();
  const [packages, setPackages] = useState<SkillPackageInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<SkillPackageInfo | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);

  const fetchPackages = useCallback(async () => {
    try {
      const data = await skillPackagesApi.list();
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

  const togglePackage = async (pkg: SkillPackageInfo) => {
    const action = pkg.status === 'enabled' ? 'disable' : 'enable';
    try {
      if (action === 'enable') {
        await skillPackagesApi.enable(pkg.id);
      } else {
        await skillPackagesApi.disable(pkg.id);
      }
      toast.success(action === 'enable' ? 'Skill package enabled' : 'Skill package disabled');
      fetchPackages();
    } catch {
      // API client handles error reporting
    }
  };

  const uninstallPackage = async (pkg: SkillPackageInfo) => {
    try {
      await skillPackagesApi.uninstall(pkg.id);
      toast.success(`Uninstalled "${pkg.name}"`);
      setSelectedPackage(null);
      fetchPackages();
    } catch {
      // API client handles error reporting
    }
  };

  const scanDirectory = async () => {
    try {
      const result = await skillPackagesApi.scan();
      if (result.installed > 0) {
        toast.success(`Scan complete: ${result.installed} package(s) installed`);
      } else {
        toast.info('Scan complete: no new packages found');
      }
      if (result.errors?.length) {
        toast.warning(`${result.errors.length} error(s) during scan`);
      }
      fetchPackages();
    } catch {
      // API client handles error reporting
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
            Skill Packages
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Shareable bundles of tools, prompts, and triggers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scanDirectory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            title="Scan skill-packages directory for new packages"
          >
            <FolderOpen className="w-4 h-4" />
            Scan
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
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text-muted dark:text-dark-text-muted">Enabled:</span>
              <span className="font-medium text-success">{stats.enabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span className="text-text-muted dark:text-dark-text-muted">Disabled:</span>
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">{stats.disabled}</span>
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
          <LoadingSpinner message="Loading skill packages..." />
        ) : filteredPackages.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={`No skill packages ${filter !== 'all' ? filter : 'installed'}`}
            description={filter === 'all'
              ? 'Click "Install" to add a skill from JSON manifest, or "Scan" to discover packages from the skill-packages directory.'
              : `No ${filter} skill packages found.`}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPackages.map((pkg) => (
              <SkillPackageCard
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
        <SkillPackageDetailModal
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
        <SkillCreatorModal
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

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface SkillPackageCardProps {
  pkg: SkillPackageInfo;
  onToggle: () => void;
  onClick: () => void;
}

function SkillPackageCard({ pkg, onToggle, onClick }: SkillPackageCardProps) {
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
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              v{pkg.version}
            </p>
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
          title={isEnabled ? 'Disable skill package' : 'Enable skill package'}
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
        <span className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[pkg.status] || STATUS_COLORS.disabled}`}>
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

// ---------------------------------------------------------------------------
// Install Modal
// ---------------------------------------------------------------------------

function InstallModal({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'json' | 'path'>('json');
  const [jsonText, setJsonText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setError(null);
    setIsInstalling(true);

    try {
      if (mode === 'json') {
        if (!jsonText.trim()) {
          setError('Please paste the skill.json manifest content.');
          setIsInstalling(false);
          return;
        }
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(jsonText);
        } catch {
          setError('Invalid JSON. Please check the manifest content.');
          setIsInstalling(false);
          return;
        }
        await skillPackagesApi.install(manifest);
      } else {
        if (!filePath.trim()) {
          setError('Please enter the path to the skill.json file.');
          setIsInstalling(false);
          return;
        }
        await skillPackagesApi.installFromPath(filePath.trim());
      }
      toast.success('Skill package installed successfully');
      onInstalled();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Installation failed';
      setError(msg);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Install Skill Package
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            Install a skill package from a JSON manifest or file path.
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-border dark:border-dark-border">
          <button
            onClick={() => setMode('json')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'json'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            JSON Manifest
          </button>
          <button
            onClick={() => setMode('path')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'path'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            File Path
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {mode === 'json' ? (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Paste skill.json content
              </label>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={'{\n  "id": "my-skill",\n  "name": "My Skill",\n  "version": "1.0.0",\n  "description": "...",\n  "tools": [...]\n}'}
                className="w-full h-64 px-3 py-2 text-sm font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Path to skill.json file
              </label>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="/path/to/skill-packages/my-skill/skill.json"
                className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                Enter the absolute path to the skill.json manifest file on the server.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isInstalling ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Install
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Modal
// ---------------------------------------------------------------------------

interface SkillPackageDetailModalProps {
  pkg: SkillPackageInfo;
  onClose: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}

function SkillPackageDetailModal({ pkg, onClose, onToggle, onUninstall }: SkillPackageDetailModalProps) {
  const isEnabled = pkg.status === 'enabled';
  const manifest = pkg.manifest;
  const showServicesTab = (manifest.required_services?.length ?? 0) > 0;
  const [activeTab, setActiveTab] = useState<'overview' | 'services'>('overview');
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  useEffect(() => {
    if (activeTab === 'services' && !showServicesTab) {
      setActiveTab('overview');
    }
  }, [activeTab, showServicesTab]);

  const categoryColor = pkg.category
    ? CATEGORY_COLORS[pkg.category] || CATEGORY_COLORS.other
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {pkg.icon ? (
                  <span className="text-2xl">{pkg.icon}</span>
                ) : (
                  <Sparkles className="w-6 h-6 text-primary" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                    {pkg.name}
                  </h3>
                  {categoryColor && pkg.category && (
                    <span className={`px-2 py-0.5 text-xs rounded-full ${categoryColor}`}>
                      {pkg.category.charAt(0).toUpperCase() + pkg.category.slice(1)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  v{pkg.version}
                  {(manifest.author?.name || pkg.authorName) && ` by ${manifest.author?.name || pkg.authorName}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-sm ${STATUS_COLORS[pkg.status] || STATUS_COLORS.disabled}`}>
                {pkg.status}
              </span>
            </div>
          </div>
          <p className="mt-4 text-text-secondary dark:text-dark-text-secondary">
            {pkg.description || manifest.description}
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border dark:border-dark-border">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            Overview
          </button>
          {showServicesTab && (
            <button
              onClick={() => setActiveTab('services')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'services'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Services
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="p-6 space-y-6">
              {/* Tools */}
              {manifest.tools.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Wrench className="w-4 h-4" />
                    Tools ({manifest.tools.length})
                  </h4>
                  <div className="space-y-2">
                    {manifest.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary font-mono">
                            {tool.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {tool.requires_approval && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-warning/20 text-warning">
                                Approval
                              </span>
                            )}
                            {tool.permissions?.map((perm) => (
                              <span
                                key={perm}
                                className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400"
                              >
                                {perm}
                              </span>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                          {tool.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Triggers */}
              {manifest.triggers && manifest.triggers.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Triggers ({manifest.triggers.length})
                  </h4>
                  <div className="space-y-2">
                    {manifest.triggers.map((trigger) => (
                      <div
                        key={trigger.name}
                        className="flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                            {trigger.name}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-text-muted dark:text-dark-text-muted flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {trigger.type}
                            </span>
                            {typeof trigger.config.cron === 'string' && (
                              <span className="text-xs text-text-muted dark:text-dark-text-muted font-mono">
                                {trigger.config.cron}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          trigger.enabled !== false
                            ? 'bg-success/20 text-success'
                            : 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted'
                        }`}>
                          {trigger.enabled !== false ? 'On' : 'Off'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* System Prompt */}
              {manifest.system_prompt && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    System Prompt
                  </h4>
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <p className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap">
                      {manifest.system_prompt}
                    </p>
                  </div>
                </div>
              )}

              {/* Tags & Keywords */}
              {((manifest.tags?.length ?? 0) > 0 || (manifest.keywords?.length ?? 0) > 0) && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                    Tags & Keywords
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {manifest.tags?.map((tag) => (
                      <span
                        key={`tag-${tag}`}
                        className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                    {manifest.keywords?.map((kw) => (
                      <span
                        key={`kw-${kw}`}
                        className="px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-600 dark:text-gray-400"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Details
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <span className="text-text-muted dark:text-dark-text-muted">Installed</span>
                    <p className="text-text-primary dark:text-dark-text-primary">
                      {new Date(pkg.installedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                    <span className="text-text-muted dark:text-dark-text-muted">Updated</span>
                    <p className="text-text-primary dark:text-dark-text-primary">
                      {new Date(pkg.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {pkg.sourcePath && (
                    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg col-span-2">
                      <span className="text-text-muted dark:text-dark-text-muted">Source Path</span>
                      <p className="text-text-primary dark:text-dark-text-primary truncate font-mono text-xs mt-1">
                        {pkg.sourcePath}
                      </p>
                    </div>
                  )}
                  {manifest.docs && (
                    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <span className="text-text-muted dark:text-dark-text-muted">Documentation</span>
                      <a
                        href={manifest.docs}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block"
                      >
                        View Docs
                      </a>
                    </div>
                  )}
                  {manifest.author?.email && (
                    <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
                      <span className="text-text-muted dark:text-dark-text-muted">Author Email</span>
                      <p className="text-text-primary dark:text-dark-text-primary truncate">
                        {manifest.author.email}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Error */}
              {pkg.status === 'error' && pkg.errorMessage && (
                <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-error" />
                    <span className="text-sm font-medium text-error">Error</span>
                  </div>
                  <p className="text-sm text-error/80">{pkg.errorMessage}</p>
                </div>
              )}
            </div>
          )}

          {/* Services Tab */}
          {activeTab === 'services' && manifest.required_services && (
            <div className="p-4 space-y-3">
              {manifest.required_services.length === 0 ? (
                <p className="text-text-muted dark:text-dark-text-muted text-sm">
                  This skill package has no external service requirements.
                </p>
              ) : (
                manifest.required_services.map((svc) => (
                  <div
                    key={svc.name}
                    className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
                  >
                    <div>
                      <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                        {svc.display_name}
                      </p>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted">
                        {svc.name}
                        {svc.description && ` — ${svc.description}`}
                      </p>
                    </div>
                    <a
                      href="/settings/config-center"
                      className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      Configure
                    </a>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                isEnabled
                  ? 'bg-error/10 text-error hover:bg-error/20'
                  : 'bg-success/10 text-success hover:bg-success/20'
              }`}
            >
              <Power className="w-4 h-4" />
              {isEnabled ? 'Disable' : 'Enable'}
            </button>
            {!confirmUninstall ? (
              <button
                onClick={() => setConfirmUninstall(true)}
                className="px-4 py-2 rounded-lg flex items-center gap-2 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                title="Uninstall this skill package"
              >
                <Trash2 className="w-4 h-4" />
                Uninstall
              </button>
            ) : (
              <button
                onClick={onUninstall}
                className="px-4 py-2 rounded-lg flex items-center gap-2 bg-error text-white hover:bg-error/90 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Confirm Uninstall
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Creator Modal
// ---------------------------------------------------------------------------

const SKILL_CATEGORIES = [
  'developer', 'productivity', 'communication', 'data',
  'utilities', 'integrations', 'media', 'lifestyle', 'other',
] as const;

const TOOL_PERMISSIONS = ['network', 'filesystem', 'database', 'system'] as const;

const DEFAULT_PARAMS = '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}';
const DEFAULT_CODE = '// Access arguments via `args` object\n// Use `config.get(service, field)` for service config\n// Return { content: { ... } }\nreturn { content: { result: "ok" } };';

interface ToolDraft {
  name: string;
  description: string;
  parameters: string;
  code: string;
  permissions: string[];
  requiresApproval: boolean;
  expanded: boolean;
}

function SkillCreatorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();

  // Step
  const [step, setStep] = useState<'metadata' | 'tools' | 'extras' | 'preview'>('metadata');

  // Metadata
  const [skillId, setSkillId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('utilities');
  const [icon, setIcon] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [tags, setTags] = useState('');

  // Tools
  const [tools, setTools] = useState<ToolDraft[]>([]);

  // Extras
  const [systemPrompt, setSystemPrompt] = useState('');
  const [keywords, setKeywords] = useState('');
  const [docsUrl, setDocsUrl] = useState('');

  // UI
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-derive ID from name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!idManuallyEdited) {
      setSkillId(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  const handleIdChange = (val: string) => {
    setIdManuallyEdited(true);
    setSkillId(val.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  // Tool helpers
  const addTool = () => {
    setTools((prev) => [
      ...prev.map((t) => ({ ...t, expanded: false })),
      { name: '', description: '', parameters: DEFAULT_PARAMS, code: DEFAULT_CODE, permissions: [], requiresApproval: false, expanded: true },
    ]);
  };

  const updateTool = (index: number, updates: Partial<ToolDraft>) => {
    setTools((prev) => prev.map((t, i) => (i === index ? { ...t, ...updates } : t)));
  };

  const removeTool = (index: number) => {
    setTools((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleToolExpanded = (index: number) => {
    setTools((prev) => prev.map((t, i) => (i === index ? { ...t, expanded: !t.expanded } : t)));
  };

  const toggleToolPermission = (index: number, perm: string) => {
    setTools((prev) =>
      prev.map((t, i) =>
        i === index
          ? { ...t, permissions: t.permissions.includes(perm) ? t.permissions.filter((p) => p !== perm) : [...t.permissions, perm] }
          : t,
      ),
    );
  };

  // Validation
  const metadataValid = skillId.length > 0 && /^[a-z0-9][a-z0-9-]*$/.test(skillId) && name.trim().length > 0 && version.trim().length > 0 && description.trim().length > 0;

  const toolsValid = tools.length > 0 && tools.every((t) => {
    if (!t.name || !/^[a-z0-9_]+$/.test(t.name)) return false;
    if (!t.description.trim()) return false;
    if (!t.code.trim()) return false;
    try { JSON.parse(t.parameters); } catch { return false; }
    return true;
  });

  // Build manifest
  const buildManifest = () => {
    const manifest: Record<string, unknown> = {
      id: skillId,
      name,
      version,
      description,
      category,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: JSON.parse(t.parameters),
        code: t.code,
        ...(t.permissions.length > 0 && { permissions: t.permissions }),
        ...(t.requiresApproval && { requires_approval: true }),
      })),
    };
    if (icon) manifest.icon = icon;
    if (authorName) manifest.author = { name: authorName };
    if (tags.trim()) manifest.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (systemPrompt.trim()) manifest.system_prompt = systemPrompt;
    if (keywords.trim()) manifest.keywords = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    if (docsUrl.trim()) manifest.docs = docsUrl;
    return manifest;
  };

  const manifestJson = step === 'preview' ? JSON.stringify(buildManifest(), null, 2) : '';

  const handleInstall = async () => {
    setError(null);
    setIsInstalling(true);
    try {
      const manifest = buildManifest();
      await skillPackagesApi.install(manifest);
      toast.success(`Skill "${name}" installed successfully`);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Installation failed');
    } finally {
      setIsInstalling(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(manifestJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleNext = () => {
    setError(null);
    if (step === 'metadata') {
      if (!metadataValid) { setError('Please fill in all required fields (ID, Name, Version, Description).'); return; }
      setStep('tools');
    } else if (step === 'tools') {
      if (!toolsValid) { setError('Add at least one tool with valid name, description, parameters JSON, and code.'); return; }
      setStep('extras');
    } else if (step === 'extras') {
      setStep('preview');
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 'tools') setStep('metadata');
    else if (step === 'extras') setStep('tools');
    else if (step === 'preview') setStep('extras');
  };

  const steps = ['metadata', 'tools', 'extras', 'preview'] as const;
  const stepLabels = { metadata: 'Metadata', tools: 'Tools', extras: 'Extras', preview: 'Preview' };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Code className="w-5 h-5 text-primary" />
              Create Skill Package
            </h3>
            <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Step tabs */}
          <div className="flex gap-4 mt-3">
            {steps.map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  const currentIdx = steps.indexOf(step);
                  if (i <= currentIdx) { setError(null); setStep(s); }
                }}
                className={`text-sm font-medium ${
                  step === s
                    ? 'text-primary border-b-2 border-primary pb-1'
                    : steps.indexOf(step) > i
                      ? 'text-text-secondary dark:text-dark-text-secondary cursor-pointer'
                      : 'text-text-muted dark:text-dark-text-muted cursor-default'
                }`}
              >
                {i + 1}. {stepLabels[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Metadata */}
          {step === 'metadata' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My Awesome Skill"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  ID *
                </label>
                <input
                  type="text"
                  value={skillId}
                  onChange={(e) => handleIdChange(e.target.value)}
                  placeholder="my-awesome-skill"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Lowercase letters, numbers, and hyphens only. Auto-derived from name.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Version *
                  </label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {SKILL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Description *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="What does this skill package do?"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Icon
                  </label>
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="e.g. \uD83D\uDD27"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Author Name
                  </label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Your Name"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Tags
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. search, web, api"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">Comma-separated</p>
              </div>
            </div>
          )}

          {/* Step 2: Tools */}
          {step === 'tools' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Tools ({tools.length})
                </h4>
                <button
                  onClick={addTool}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Tool
                </button>
              </div>

              {tools.length === 0 && (
                <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No tools yet. Add at least one tool to continue.</p>
                </div>
              )}

              {tools.map((tool, index) => (
                <ToolDraftCard
                  key={index}
                  tool={tool}
                  index={index}
                  onUpdate={(updates) => updateTool(index, updates)}
                  onRemove={() => removeTool(index)}
                  onToggleExpanded={() => toggleToolExpanded(index)}
                  onTogglePermission={(perm) => toggleToolPermission(index, perm)}
                />
              ))}
            </div>
          )}

          {/* Step 3: Extras */}
          {step === 'extras' && (
            <div className="space-y-4">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                All fields below are optional. Skip if not needed.
              </p>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  placeholder="Additional instructions injected when this skill is active..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Guides the AI on when and how to use this skill's tools
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Keywords
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. search, browse, news, google"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Hint words for tool selection prioritization (comma-separated)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Documentation URL
                </label>
                <input
                  type="url"
                  value={docsUrl}
                  onChange={(e) => setDocsUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          {/* Step 4: Preview & Install */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  skill.json Preview
                </h4>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm font-mono text-text-primary dark:text-dark-text-primary overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                {manifestJson}
              </pre>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step !== 'metadata' && (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {step === 'preview' ? (
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {isInstalling ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Install Skill
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Draft Card (used inside SkillCreatorModal)
// ---------------------------------------------------------------------------

interface ToolDraftCardProps {
  tool: ToolDraft;
  index: number;
  onUpdate: (updates: Partial<ToolDraft>) => void;
  onRemove: () => void;
  onToggleExpanded: () => void;
  onTogglePermission: (perm: string) => void;
}

function ToolDraftCard({ tool, index, onUpdate, onRemove, onToggleExpanded, onTogglePermission }: ToolDraftCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!tool.expanded) {
    return (
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-left hover:border-primary/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-medium font-mono text-text-primary dark:text-dark-text-primary">
            {tool.name || `tool_${index + 1}`}
          </span>
          <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">
            {tool.description || 'No description'}
          </span>
        </div>
        {tool.permissions.length > 0 && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0 ml-2">
            {tool.permissions.length} perm
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onToggleExpanded} className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
          <ChevronDown className="w-4 h-4 text-text-muted" />
          Tool {index + 1}
        </button>
        {!confirmRemove ? (
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-xs text-text-muted hover:text-error transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        ) : (
          <button
            onClick={() => { onRemove(); setConfirmRemove(false); }}
            className="text-xs text-error font-medium flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Click again to confirm
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Tool Name *
        </label>
        <input
          type="text"
          value={tool.name}
          onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          placeholder="my_tool_name"
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Description *
        </label>
        <textarea
          value={tool.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          rows={2}
          placeholder="What does this tool do?"
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Parameters (JSON Schema) *
        </label>
        <textarea
          value={tool.parameters}
          onChange={(e) => onUpdate({ parameters: e.target.value })}
          rows={6}
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Implementation (JavaScript) *
        </label>
        <textarea
          value={tool.code}
          onChange={(e) => onUpdate({ code: e.target.value })}
          rows={8}
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
          Access arguments via <code className="px-1 bg-bg-secondary dark:bg-dark-bg-secondary rounded">args</code> object.
          Return <code className="px-1 bg-bg-secondary dark:bg-dark-bg-secondary rounded">{'{ content: { ... } }'}</code>.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
          Permissions
        </label>
        <div className="flex flex-wrap gap-2">
          {TOOL_PERMISSIONS.map((perm) => (
            <button
              key={perm}
              type="button"
              onClick={() => onTogglePermission(perm)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                tool.permissions.includes(perm)
                  ? 'bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400'
                  : 'border-border dark:border-dark-border text-text-muted hover:border-primary/50'
              }`}
            >
              {perm}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`approval-${index}`}
          checked={tool.requiresApproval}
          onChange={(e) => onUpdate({ requiresApproval: e.target.checked })}
          className="w-4 h-4 rounded border-border dark:border-dark-border text-primary focus:ring-primary"
        />
        <label htmlFor={`approval-${index}`} className="text-xs text-text-secondary dark:text-dark-text-secondary">
          Require user approval before each execution
        </label>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  Sparkles,
  Power,
  Wrench,
  Zap,
  Globe,
  Clock,
  AlertTriangle,
  Shield,
  X,
  Trash2,
} from '../../components/icons';
import type { ExtensionInfo } from '../../api/types';
import { STATUS_COLORS, CATEGORY_COLORS } from './constants';

interface ExtensionDetailModalProps {
  pkg: ExtensionInfo;
  onClose: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}

export function ExtensionDetailModal({
  pkg,
  onClose,
  onToggle,
  onUninstall,
}: ExtensionDetailModalProps) {
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
                  {(manifest.author?.name || pkg.authorName) &&
                    ` by ${manifest.author?.name || pkg.authorName}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-sm ${STATUS_COLORS[pkg.status] || STATUS_COLORS.disabled}`}
              >
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
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            trigger.enabled !== false
                              ? 'bg-success/20 text-success'
                              : 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted'
                          }`}
                        >
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
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Documentation
                      </span>
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
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Author Email
                      </span>
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
                  This extension has no external service requirements.
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
                title="Uninstall this extension"
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

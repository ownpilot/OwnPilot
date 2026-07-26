/**
 * Plugin Activation Wizard
 *
 * Steps: Browse → Choose → Configure Services → Enable → Complete
 *
 * Activates an installed built-in plugin, optionally configuring its required
 * services along the way.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  useWizardKeyboard,
  WizardAIButton,
} from '../../components/wizard';
import { pluginsApi, apiClient } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import { safeHref } from '../../utils/safe-url';
import type { PluginInfo } from '../../api/types/plugins';
import { Check, Search, AlertTriangle, Settings } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'review', label: 'Review' },
  { id: 'services', label: 'Services' },
  { id: 'enable', label: 'Enable' },
  { id: 'done', label: 'Complete' },
];

export function PluginInstallWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'disabled' | 'enabled'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [aiExplain, setAiExplain] = useState<string>('');

  useEffect(() => {
    pluginsApi.list().then(setPlugins).catch(silentCatch('plugins.list'));
  }, []);

  const filtered = useMemo(() => {
    let list = plugins;
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [plugins, statusFilter, searchQuery]);

  const selected = useMemo(() => plugins.find((p) => p.id === selectedId), [plugins, selectedId]);

  const unconfiguredServices = useMemo(
    () => selected?.requiredServices?.filter((s) => !s.isConfigured) ?? [],
    [selected]
  );

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return !!selectedId;
      case 1:
        return true;
      case 2:
        return true; // user acknowledges service status
      case 3:
        return result?.ok === true;
      default:
        return false;
    }
  }, [step, selectedId, result]);

  const handleNext = async () => {
    if (step === 2) {
      // Move to enable step
      setStep(3);
      // Enable in background
      setIsProcessing(true);
      setResult(null);
      try {
        if (selected?.status === 'enabled') {
          setResult({ ok: true });
        } else {
          await apiClient.post(`/plugins/${selectedId}/enable`);
          setResult({ ok: true });
        }
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed to enable' });
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  useWizardKeyboard({ canGoNext, onNext: handleNext, onCancel, isProcessing });

  return (
    <WizardShell
      title="Activate a Plugin"
      description="Browse installed plugins and enable the ones you need"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 3) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Browse */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Browse Plugins
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            OwnPilot ships with many built-in plugins. Pick one to enable or reconfigure.
          </p>

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search plugins..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm"
            >
              <option value="all">All</option>
              <option value="disabled">Disabled</option>
              <option value="enabled">Enabled</option>
            </select>
          </div>

          <p className="text-xs text-text-muted mb-2">
            {filtered.length} of {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
          </p>

          <div className="max-h-96 overflow-y-auto space-y-1 border border-border dark:border-dark-border rounded-lg p-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  selectedId === p.id
                    ? 'bg-primary/10 border border-primary'
                    : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.icon && <span className="text-lg">{p.icon}</span>}
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                      {p.name}
                    </span>
                    {p.hasUnconfiguredServices && (
                      <span className="text-[9px] uppercase font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                        Needs config
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] uppercase font-semibold flex-shrink-0 px-1.5 py-0.5 rounded ${
                      p.status === 'enabled'
                        ? 'bg-success/10 text-success'
                        : p.status === 'error'
                          ? 'bg-error/10 text-error'
                          : 'bg-text-muted/10 text-text-muted'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-text-muted line-clamp-2 mt-0.5">{p.description}</p>
                )}
                {p.toolCount !== undefined && p.toolCount > 0 && (
                  <p className="text-[10px] text-text-muted mt-1">
                    {p.toolCount} tool{p.toolCount === 1 ? '' : 's'} ·{' '}
                    {(p.category || 'general').toLowerCase()}
                  </p>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-text-muted text-center py-4">
                {plugins.length === 0 ? 'Loading plugins...' : 'No matches'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Review */}
      {step === 1 && selected && (
        <div>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {selected.name}
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                v{selected.version} · {selected.category || 'general'}
              </p>
            </div>
            <WizardAIButton
              label="Explain"
              buildPrompt={() => {
                const toolList = selected.tools.slice(0, 20).join(', ') || 'none';
                return `Explain in 2–3 short sentences what this OwnPilot plugin does and when a user would benefit from enabling it.\n\nName: ${selected.name}\nDescription: ${selected.description || '(none)'}\nTools: ${toolList}\nCapabilities: ${selected.capabilities.join(', ') || 'none'}\nPermissions: ${selected.permissions.join(', ') || 'none'}\n\nOutput plain text only.`;
              }}
              onResult={(text) => setAiExplain(text.trim())}
            />
          </div>

          {selected.description && (
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-3 mb-4">
              {selected.description}
            </p>
          )}

          {aiExplain && (
            <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/30">
              <p className="text-xs font-medium text-primary mb-1">AI explanation</p>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{aiExplain}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg border border-border dark:border-dark-border">
              <p className="text-[10px] uppercase text-text-muted font-semibold">Tools</p>
              <p className="text-lg font-semibold text-text-primary">{selected.toolCount ?? 0}</p>
            </div>
            <div className="p-3 rounded-lg border border-border dark:border-dark-border">
              <p className="text-[10px] uppercase text-text-muted font-semibold">Handlers</p>
              <p className="text-lg font-semibold text-text-primary">{selected.handlers.length}</p>
            </div>
          </div>

          {selected.permissions && selected.permissions.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-text-muted font-semibold mb-1">Permissions</p>
              <div className="flex flex-wrap gap-1.5">
                {selected.permissions.map((p) => (
                  <span
                    key={p}
                    className="text-[10px] font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary px-2 py-0.5 rounded"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(() => {
            // Plugin docs URL comes from the plugin manifest (third-party).
            // Filter `javascript:` etc. before rendering the link.
            const docsHref = safeHref(selected.docs);
            if (!docsHref) return null;
            return (
              <a
                href={docsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                Documentation →
              </a>
            );
          })()}
        </div>
      )}

      {/* Step 2: Services */}
      {step === 2 && selected && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Required Services
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Some plugins depend on external services (API keys, credentials, etc.).
          </p>

          {(!selected.requiredServices || selected.requiredServices.length === 0) && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-success/5 border border-success/30">
              <Check className="w-5 h-5 text-success mt-0.5" />
              <p className="text-sm text-text-primary">
                This plugin has no required services. You can enable it directly.
              </p>
            </div>
          )}

          {selected.requiredServices && selected.requiredServices.length > 0 && (
            <div className="space-y-2">
              {selected.requiredServices.map((s) => (
                <div
                  key={s.name}
                  className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${
                    s.isConfigured
                      ? 'border-success/30 bg-success/5'
                      : 'border-warning/30 bg-warning/5'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{s.displayName}</p>
                    <p className="text-[11px] text-text-muted mt-0.5 font-mono">{s.name}</p>
                  </div>
                  {s.isConfigured ? (
                    <span className="text-xs text-success flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Configured
                    </span>
                  ) : (
                    <button
                      onClick={() => navigate('/settings/config-center')}
                      className="text-xs text-primary hover:underline"
                    >
                      Configure →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {unconfiguredServices.length > 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/30">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
              <p className="text-xs text-text-secondary">
                You can still enable this plugin now; it will run with reduced functionality until
                its services are configured.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Enable */}
      {step === 3 && (
        <>
          {isProcessing && <WizardLoadingView label="Enabling plugin..." />}
          {result?.ok && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-3">
                <Settings className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Plugin Active!</h3>
              <p className="text-sm text-text-muted mt-1">
                {selected?.name} is now enabled and its tools are available to your AI.
              </p>
            </div>
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Activation Failed"
              message={result.error}
              onRetry={() => {
                setStep(2);
                setResult(null);
              }}
            />
          )}
        </>
      )}

      {/* Step 4: Done */}
      {step === 4 && selected && (
        <WizardCompleteView
          icon={Settings}
          title="All Set!"
          subtitle={
            <>
              <strong>{selected.name}</strong> is ready. Configure or disable it later from the
              plugin settings.
            </>
          }
          facts={[
            { label: 'Tools', value: String(selected.toolCount ?? 0) },
            { label: 'Handlers', value: String(selected.handlers.length) },
            { label: 'Category', value: selected.category || 'general' },
            { label: 'Version', value: selected.version },
          ]}
          actions={[
            { label: 'Plugin Settings', onClick: () => navigate('/settings/plugins') },
            { label: 'Go to Chat', onClick: () => navigate('/') },
          ]}
        />
      )}
    </WizardShell>
  );
}

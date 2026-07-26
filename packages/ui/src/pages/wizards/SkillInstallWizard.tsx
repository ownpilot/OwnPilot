/**
 * Skill Install Wizard
 *
 * Steps: Source → Search/Choose → Confirm → Install → Permissions → Complete
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
import { skillsApi } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import { safeHref } from '../../utils/safe-url';
import type { NpmSearchPackage, SkillPermissionInfo } from '../../api/endpoints/skills';
import { Check, Search, ExternalLink, Sparkles } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'source', label: 'Source' },
  { id: 'search', label: 'Search' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'install', label: 'Install' },
  { id: 'perms', label: 'Perms' },
  { id: 'done', label: 'Complete' },
];

type Source = 'search' | 'manual';

export function SkillInstallWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<Source>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [packages, setPackages] = useState<NpmSearchPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<NpmSearchPackage | null>(null);
  const [manualName, setManualName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [installResult, setInstallResult] = useState<{
    ok: boolean;
    extensionId?: string;
    error?: string;
  } | null>(null);
  const [allPermissions, setAllPermissions] = useState<SkillPermissionInfo[]>([]);
  const [declared, setDeclared] = useState<{ required: string[]; optional: string[] }>({
    required: [],
    optional: [],
  });
  const [granted, setGranted] = useState<Set<string>>(new Set());

  useEffect(() => {
    skillsApi
      .listPermissions()
      .then((res) => setAllPermissions(res.permissions))
      .catch(silentCatch('skills.perms.list'));
  }, []);

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setPackages([]);
      return;
    }
    setSearching(true);
    try {
      const res = await skillsApi.search(q.trim(), 20, 0);
      setPackages(res.packages);
    } catch {
      setPackages([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(() => runSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, step]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return true;
      case 1:
        return source === 'search' ? !!selectedPkg : manualName.trim().length > 0;
      case 2:
        return true;
      case 3:
        return installResult?.ok === true;
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, source, selectedPkg, manualName, installResult]);

  const packageToInstall = useMemo(() => {
    if (source === 'manual') return manualName.trim();
    return selectedPkg?.name ?? '';
  }, [source, manualName, selectedPkg]);

  const handleNext = async () => {
    if (step === 2) {
      setIsProcessing(true);
      setInstallResult(null);
      try {
        const res = await skillsApi.installNpm(packageToInstall);
        if (res.success && res.extensionId) {
          setInstallResult({ ok: true, extensionId: res.extensionId });
          try {
            const perms = await skillsApi.getPermissions(res.extensionId);
            setDeclared(perms.declared);
            setGranted(new Set([...(perms.granted || []), ...(perms.declared.required || [])]));
          } catch {
            // optional
          }
        } else {
          setInstallResult({
            ok: false,
            error: res.error || 'Install failed',
          });
        }
        setStep(3);
      } catch (err) {
        setInstallResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Install failed',
        });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (step === 4) {
      // Save granted permissions
      if (installResult?.extensionId) {
        setIsProcessing(true);
        try {
          await skillsApi.updatePermissions(installResult.extensionId, Array.from(granted));
        } catch {
          // non-critical
        } finally {
          setIsProcessing(false);
        }
      }
      setStep(5);
      return;
    }

    setStep(step + 1);
  };

  useWizardKeyboard({ canGoNext, onNext: handleNext, onCancel, isProcessing });

  const togglePerm = (name: string) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <WizardShell
      title="Install a Skill"
      description="Add a Skill from npm to extend your AI"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 5}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 3) setInstallResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Source */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            How do you want to find this Skill?
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Skills are published as npm packages on the public registry.
          </p>

          <div className="space-y-3">
            <button
              onClick={() => setSource('search')}
              className={`w-full text-left p-4 rounded-lg border flex items-start gap-3 transition-all ${
                source === 'search'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                  : 'border-border dark:border-dark-border hover:border-primary/40'
              }`}
            >
              <Search className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Search the marketplace
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  Browse OwnPilot-tagged packages on npm.
                </p>
              </div>
            </button>

            <button
              onClick={() => setSource('manual')}
              className={`w-full text-left p-4 rounded-lg border flex items-start gap-3 transition-all ${
                source === 'manual'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                  : 'border-border dark:border-dark-border hover:border-primary/40'
              }`}
            >
              <Sparkles className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Install by package name
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  Already know the npm package name? Enter it directly.
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Search or Manual */}
      {step === 1 && source === 'search' && (
        <div>
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Search for a Skill
            </h2>
            <WizardAIButton
              label="Suggest keywords"
              buildPrompt={() => {
                const seed = searchQuery.trim();
                if (!seed) return null;
                return `Convert the user's free-text need into one concise npm search keyword (1–3 words, lowercase). Output ONLY the keyword, nothing else.\n\nNeed: ${seed}`;
              }}
              onResult={(text) => setSearchQuery(text.trim().split(/\s+/).slice(0, 3).join(' '))}
            />
          </div>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Try keywords like "weather", "calendar", "summarizer".
          </p>

          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search npm — or describe what you need + click Suggest keywords"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-1 border border-border dark:border-dark-border rounded-lg p-2">
            {searching && <p className="text-sm text-text-muted text-center py-4">Searching...</p>}
            {!searching && packages.length === 0 && (
              <p className="text-sm text-text-muted text-center py-4">
                {searchQuery ? 'No results' : 'Type to search'}
              </p>
            )}
            {packages.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelectedPkg(p)}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  selectedPkg?.name === p.name
                    ? 'bg-primary/10 border border-primary'
                    : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-text-muted ml-2 flex-shrink-0">
                    v{p.version}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-text-muted line-clamp-2 mt-0.5">{p.description}</p>
                )}
                {p.author && <p className="text-[10px] text-text-muted mt-1">by {p.author}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && source === 'manual' && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Package Name
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Enter the exact npm package name to install.
          </p>

          <label className="block text-sm font-medium text-text-primary mb-2">npm Package</label>
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="@ownpilot/skill-example or example-skill"
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            autoFocus
          />
          <a
            href={`https://www.npmjs.com/search?q=keywords%3Aownpilot-skill`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
          >
            Browse npm for ownpilot-skill keyword
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Step 2: Confirm */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Confirm Install
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Installing a skill runs untrusted code on your machine. Only install from sources you
            trust.
          </p>

          <div className="p-4 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary">
            <p className="text-xs text-text-muted">Package</p>
            <p className="text-sm font-mono text-text-primary dark:text-dark-text-primary break-all">
              {packageToInstall}
            </p>
            {selectedPkg?.description && (
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-3">
                {selectedPkg.description}
              </p>
            )}
            {(() => {
              // `selectedPkg.links.repository` comes straight from the npm
              // registry — an attacker who controls the package can set this
              // to `javascript:fetch('/api/v1/...')` and a single click runs
              // attacker JS with the user's session cookies.
              const repoHref = safeHref(selectedPkg?.links?.repository);
              if (!repoHref) return null;
              return (
                <a
                  href={repoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                >
                  Source repository
                  <ExternalLink className="w-3 h-3" />
                </a>
              );
            })()}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-warning/5 border border-warning/30">
            <p className="text-xs text-text-secondary">
              <strong>Heads up:</strong> Skills can read/write files, make network calls, and call
              other tools — within the permissions you grant. Review the package before installing.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: Install */}
      {step === 3 && (
        <>
          {isProcessing && <WizardLoadingView label="Installing from npm..." />}
          {installResult?.ok && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-3">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Installed!
              </h3>
              <p className="text-sm text-text-muted mt-1">Continue to grant permissions.</p>
            </div>
          )}
          {installResult && !installResult.ok && (
            <WizardErrorView
              title="Install Failed"
              message={installResult.error}
              onRetry={() => {
                setStep(2);
                setInstallResult(null);
              }}
            />
          )}
        </>
      )}

      {/* Step 4: Permissions */}
      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Permissions
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            This skill is requesting the following permissions. Required ones are always granted.
          </p>

          {declared.required.length === 0 && declared.optional.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">
              This skill declares no permissions.
            </p>
          ) : (
            <div className="space-y-2">
              {[
                ...declared.required.map((n) => ({ n, required: true })),
                ...declared.optional.map((n) => ({ n, required: false })),
              ].map(({ n, required }) => {
                const info = allPermissions.find((p) => p.name === n);
                const checked = required || granted.has(n);
                return (
                  <label
                    key={n}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      required ? 'opacity-90' : 'cursor-pointer hover:border-primary/40'
                    } ${
                      checked
                        ? 'border-primary bg-primary/5 dark:bg-primary/10'
                        : 'border-border dark:border-dark-border'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={required}
                      onChange={() => !required && togglePerm(n)}
                      className="text-primary mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-text-primary dark:text-dark-text-primary">
                          {n}
                        </span>
                        {required && (
                          <span className="text-[10px] uppercase font-semibold text-primary">
                            required
                          </span>
                        )}
                        {info?.sensitivity === 'high' && (
                          <span className="text-[10px] uppercase font-semibold text-error">
                            high risk
                          </span>
                        )}
                      </div>
                      {info?.description && (
                        <p className="text-xs text-text-muted mt-0.5">{info.description}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 5: Done */}
      {step === 5 && (
        <WizardCompleteView
          icon={Sparkles}
          title="Skill Ready!"
          subtitle={
            <>
              <span className="font-mono">{packageToInstall}</span> is installed and your AI can use
              it.
            </>
          }
          facts={[
            { label: 'Granted', value: `${granted.size} perms` },
            { label: 'Required', value: String(declared.required.length) },
            { label: 'Optional', value: String(declared.optional.length) },
          ]}
          actions={[{ label: 'Open Skills Hub', onClick: () => navigate('/skills') }]}
        />
      )}
    </WizardShell>
  );
}

/**
 * Backup & Restore Wizard
 *
 * Steps: Choose Action → Configure → Execute → Complete
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  WizardPasswordInput,
  useWizardKeyboard,
} from '../../components/wizard';
import { systemApi } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import { safeDownloadHref } from '../../utils/safe-url';
import type { BackupInfo } from '../../api/types/system';
import { Check, AlertTriangle, Download, Settings } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'action', label: 'Action' },
  { id: 'config', label: 'Configure' },
  { id: 'run', label: 'Run' },
  { id: 'done', label: 'Complete' },
];

type Action = 'backup' | 'export-json' | 'restore-json' | 'download';

const ACTIONS: { id: Action; label: string; desc: string }[] = [
  {
    id: 'backup',
    label: 'Create database backup',
    desc: 'Snapshot the database as SQL/dump file on the server.',
  },
  {
    id: 'export-json',
    label: 'Export to JSON',
    desc: 'Download portable JSON of selected tables.',
  },
  {
    id: 'restore-json',
    label: 'Restore from JSON',
    desc: 'Import a previously-exported JSON file.',
  },
  {
    id: 'download',
    label: 'Download existing backup',
    desc: 'Browse server-side backups and download one.',
  },
];

const TABLES_PRESETS: { id: string; label: string; tables: string[] }[] = [
  { id: 'all', label: 'All tables', tables: [] },
  {
    id: 'personal',
    label: 'Personal data',
    tables: ['notes', 'bookmarks', 'contacts', 'goals', 'habits', 'memories', 'plans'],
  },
  {
    id: 'agents',
    label: 'Agents & tools',
    tables: ['agents', 'custom_tools', 'claws'],
  },
  { id: 'workflows', label: 'Workflows', tables: ['workflows', 'triggers'] },
];

export function BackupWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [action, setAction] = useState<Action>('backup');
  const [adminKey, setAdminKey] = useState('');
  const [tablesPresetId, setTablesPresetId] = useState('all');
  const [customTables, setCustomTables] = useState('');
  const [backupsList, setBackupsList] = useState<BackupInfo[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTruncate, setImportTruncate] = useState(false);
  const [importSkipExisting, setImportSkipExisting] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    info?: string;
    downloadUrl?: string;
    filename?: string;
    error?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultDownloadHref = safeDownloadHref(result?.downloadUrl);

  useEffect(() => {
    if (action === 'download' && backupsList.length === 0) {
      systemApi
        .listBackups()
        .then((res) => setBackupsList(res.backups || []))
        .catch(silentCatch('backup.list'));
    }
  }, [action, backupsList.length]);

  const tables = useMemo(() => {
    if (customTables.trim()) {
      return customTables
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    const preset = TABLES_PRESETS.find((p) => p.id === tablesPresetId);
    return preset?.tables ?? [];
  }, [customTables, tablesPresetId]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return true;
      case 1:
        if (action === 'download') return !!selectedBackup;
        if (action === 'restore-json') return !!importFile;
        return true;
      case 2:
        return result?.ok === true;
      default:
        return false;
    }
  }, [step, action, selectedBackup, importFile, result]);

  const handleNext = async () => {
    if (step === 1) {
      setIsProcessing(true);
      setResult(null);
      try {
        if (action === 'backup') {
          const res = await systemApi.databaseOperation('backup', undefined, adminKey || undefined);
          setResult({
            ok: true,
            info: `Backup created: ${(res as { filename?: string }).filename ?? 'ok'}`,
            filename: (res as { filename?: string }).filename,
          });
        } else if (action === 'export-json') {
          const data = await systemApi.exportJson(
            tables.length ? tables : undefined,
            adminKey || undefined
          );
          // Trigger download in browser
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          a.href = url;
          a.download = `ownpilot-export-${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setResult({
            ok: true,
            info: `Exported ${tables.length || 'all'} table${tables.length === 1 ? '' : 's'}.`,
          });
        } else if (action === 'restore-json' && importFile) {
          const text = await importFile.text();
          const parsed = JSON.parse(text);
          const res = await systemApi.importJson(
            parsed,
            { truncate: importTruncate, skipExisting: importSkipExisting },
            adminKey || undefined
          );
          setResult({
            ok: true,
            info: `Imported ${res.tables.length} table${res.tables.length === 1 ? '' : 's'}. ${res.message}`,
          });
        } else if (action === 'download' && selectedBackup) {
          setResult({
            ok: true,
            downloadUrl: systemApi.downloadBackup(selectedBackup),
            filename: selectedBackup,
            info: `Ready to download ${selectedBackup}`,
          });
        }
        setStep(2);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Operation failed',
        });
        setStep(2);
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
      title="Backup & Restore"
      description="Back up your data or restore from a previous snapshot"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 3}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 2) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Choose action */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            What do you want to do?
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Choose one. You can run more backup operations later from Settings.
          </p>

          <div className="space-y-2">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAction(a.id)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  action === a.id
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary block">
                  {a.label}
                </span>
                <p className="text-xs text-text-muted mt-0.5">{a.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Configure */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Configure
          </h2>

          {(action === 'backup' || action === 'export-json' || action === 'restore-json') && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Admin Key (optional)
              </label>
              <WizardPasswordInput
                value={adminKey}
                onChange={setAdminKey}
                placeholder="Enter only if the server requires it"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Sent as the X-Admin-Key header. Leave blank if disabled.
              </p>
            </div>
          )}

          {action === 'export-json' && (
            <>
              <p className="text-sm font-medium text-text-primary mb-2 mt-4">Tables to export</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {TABLES_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setTablesPresetId(p.id);
                      setCustomTables('');
                    }}
                    className={`text-left p-3 rounded-lg border text-xs transition-all ${
                      tablesPresetId === p.id && !customTables.trim()
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <span className="text-sm font-medium text-text-primary block">{p.label}</span>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {p.tables.length ? `${p.tables.length} tables` : 'Every table'}
                    </p>
                  </button>
                ))}
              </div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Custom table list (overrides preset)
              </label>
              <input
                type="text"
                value={customTables}
                onChange={(e) => setCustomTables(e.target.value)}
                placeholder="e.g., notes, bookmarks, goals"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </>
          )}

          {action === 'restore-json' && (
            <>
              <p className="text-sm font-medium text-text-primary mt-4 mb-2">JSON file to import</p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-primary file:text-white hover:file:bg-primary/90"
              />
              {importFile && (
                <p className="text-[11px] text-text-muted mt-1">
                  {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={importSkipExisting}
                    onChange={(e) => setImportSkipExisting(e.target.checked)}
                  />
                  Skip rows that already exist (recommended)
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={importTruncate}
                    onChange={(e) => setImportTruncate(e.target.checked)}
                  />
                  <span>
                    Truncate tables before import{' '}
                    <span className="text-error">(destroys existing rows)</span>
                  </span>
                </label>
              </div>
              {importTruncate && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-error/5 border border-error/30">
                  <AlertTriangle className="w-4 h-4 text-error mt-0.5" />
                  <p className="text-xs text-text-secondary">
                    Truncate is destructive. Make a backup first.
                  </p>
                </div>
              )}
            </>
          )}

          {action === 'download' && (
            <>
              <p className="text-sm font-medium text-text-primary mt-4 mb-2">Server-side backups</p>
              {backupsList.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">
                  No backups found on disk. Create one first.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1 border border-border dark:border-dark-border rounded-lg p-2">
                  {backupsList.map((b) => (
                    <button
                      key={b.filename}
                      onClick={() => setSelectedBackup(b.filename)}
                      className={`w-full text-left p-2 rounded transition-all ${
                        selectedBackup === b.filename
                          ? 'bg-primary/10 border border-primary'
                          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                      }`}
                    >
                      <span className="text-xs font-mono text-text-primary block truncate">
                        {b.filename}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {(b.size / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 2: Run */}
      {step === 2 && (
        <>
          {isProcessing && (
            <WizardLoadingView
              label={
                action === 'backup'
                  ? 'Creating backup...'
                  : action === 'restore-json'
                    ? 'Importing data...'
                    : 'Working...'
              }
            />
          )}
          {result?.ok && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Done!</h3>
              <p className="text-sm text-text-muted mt-1 max-w-md mx-auto">{result.info}</p>
              {resultDownloadHref && (
                <a
                  href={resultDownloadHref}
                  className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
                >
                  <Download className="w-4 h-4" />
                  Download {result.filename}
                </a>
              )}
            </div>
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Operation Failed"
              message={result.error}
              onRetry={() => {
                setStep(1);
                setResult(null);
              }}
            />
          )}
        </>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <WizardCompleteView
          icon={Settings}
          title="All Done!"
          subtitle="Visit the database settings to manage more backups, schedule regular snapshots, or import additional data."
          actions={[
            {
              label: 'Database Settings',
              onClick: () => navigate('/settings/database'),
            },
          ]}
        />
      )}
    </WizardShell>
  );
}

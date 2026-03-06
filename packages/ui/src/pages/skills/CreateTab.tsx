import { useState, useEffect } from 'react';
import { useToast } from '../../components/ToastProvider';
import type { SkillFormat } from './wizard/FormatStep';
import { FormatStep } from './wizard/FormatStep';
import { DraftStep } from './wizard/DraftStep';
import { EditStep } from './wizard/EditStep';
import { TestStep } from './wizard/TestStep';
import { OptimizeStep } from './wizard/OptimizeStep';
import { PackageStep } from './wizard/PackageStep';
import type { ExtensionInfo } from '../../api/types';

type WizardStep = 'format' | 'draft' | 'edit' | 'test' | 'optimize' | 'package';

const STEPS: { id: WizardStep; label: string; optional?: boolean }[] = [
  { id: 'format', label: 'Format' },
  { id: 'draft', label: 'Draft' },
  { id: 'edit', label: 'Edit' },
  { id: 'test', label: 'Test', optional: true },
  { id: 'optimize', label: 'Optimize', optional: true },
  { id: 'package', label: 'Package' },
];

const DRAFT_STORAGE_KEY = 'skills-hub-wizard-draft';

interface WizardDraft {
  format: SkillFormat | null;
  draftContent: string;
  draftName: string;
}

function loadDraft(): WizardDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as WizardDraft;
  } catch {
    // ignore
  }
  return { format: null, draftContent: '', draftName: '' };
}

function saveDraft(draft: WizardDraft) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function CreateTab() {
  const toast = useToast();

  const [step, setStep] = useState<WizardStep>('format');
  const [format, setFormat] = useState<SkillFormat | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftName, setDraftName] = useState('');
  const [installedPkg, setInstalledPkg] = useState<ExtensionInfo | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  // Load draft on mount
  useEffect(() => {
    const saved = loadDraft();
    if (saved.format && (saved.draftContent || saved.draftName)) {
      setHasDraft(true);
    }
  }, []);

  const restoreDraft = () => {
    const saved = loadDraft();
    setFormat(saved.format);
    setDraftContent(saved.draftContent);
    setDraftName(saved.draftName);
    setHasDraft(false);
    // Jump to edit if we have content, otherwise draft
    if (saved.draftContent) {
      setStep('edit');
    } else if (saved.format) {
      setStep('draft');
    }
  };

  const dismissDraft = () => {
    clearDraft();
    setHasDraft(false);
  };

  const reset = () => {
    clearDraft();
    setStep('format');
    setFormat(null);
    setDraftContent('');
    setDraftName('');
    setInstalledPkg(null);
    setHasDraft(false);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const handleFormatNext = () => {
    setStep('draft');
  };

  const handleDrafted = (content: string, name: string) => {
    setDraftContent(content);
    setDraftName(name);
    saveDraft({ format, draftContent: content, draftName: name });
    setStep('edit');
  };

  const handleInstalled = (pkg: ExtensionInfo) => {
    setInstalledPkg(pkg);
    clearDraft();
    setStep('test');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Progress */}
      <div className="px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-1">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-colors ${
                    idx < stepIndex
                      ? 'bg-success text-white'
                      : idx === stepIndex
                        ? 'bg-primary text-white'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
                  }`}
                >
                  {idx < stepIndex ? '✓' : idx + 1}
                </div>
                <div className="flex flex-col items-center hidden sm:flex">
                  <span
                    className={`text-xs leading-tight ${
                      idx === stepIndex
                        ? 'text-text-primary dark:text-dark-text-primary font-medium'
                        : 'text-text-muted dark:text-dark-text-muted'
                    }`}
                  >
                    {s.label}
                  </span>
                  {s.optional && (
                    <span className="text-[9px] text-text-muted/60 dark:text-dark-text-muted/60 leading-tight">
                      optional
                    </span>
                  )}
                </div>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-px w-6 sm:w-10 mt-[-10px] ${
                    idx < stepIndex ? 'bg-success' : 'bg-border dark:border-dark-border'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Saved draft banner */}
        {hasDraft && step === 'format' && (
          <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-xs">
            <span className="text-text-secondary dark:text-dark-text-secondary">
              You have an unsaved draft from a previous session.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={restoreDraft} className="text-primary hover:underline font-medium">
                Restore
              </button>
              <span className="text-text-muted">·</span>
              <button onClick={dismissDraft} className="text-text-muted hover:text-text-secondary">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
        {step === 'format' && (
          <FormatStep
            selected={format}
            onSelect={setFormat}
            onNext={() => {
              saveDraft({ format, draftContent: '', draftName: '' });
              handleFormatNext();
            }}
          />
        )}

        {step === 'draft' && format && (
          <DraftStep format={format} onDrafted={handleDrafted} onBack={() => setStep('format')} />
        )}

        {step === 'edit' && format && (
          <EditStep
            format={format}
            content={draftContent}
            name={draftName}
            onInstalled={handleInstalled}
            onBack={() => setStep('draft')}
          />
        )}

        {step === 'test' && installedPkg && (
          <TestStep
            pkg={installedPkg}
            onNext={() => setStep('optimize')}
            onSkip={() => setStep('optimize')}
            onBack={() => setStep('edit')}
          />
        )}

        {step === 'optimize' && installedPkg && (
          <OptimizeStep
            pkg={installedPkg}
            onNext={(updatedDesc) => {
              // Keep updated pkg description in memory if it changed
              if (updatedDesc !== installedPkg.description) {
                setInstalledPkg({ ...installedPkg, description: updatedDesc });
              }
              setStep('package');
            }}
            onSkip={() => setStep('package')}
            onBack={() => setStep('test')}
          />
        )}

        {step === 'package' && installedPkg && (
          <PackageStep
            pkg={installedPkg}
            onFinish={() => {
              toast.success(`"${installedPkg.name}" is ready!`);
              reset();
            }}
            onBack={() => setStep('optimize')}
          />
        )}
      </div>
    </div>
  );
}

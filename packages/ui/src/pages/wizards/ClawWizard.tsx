/**
 * Claw Autonomous Agent Setup Wizard
 *
 * Steps: Preset → Mission → Mode & Limits → Stop Conditions → Review → Create → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { useToast } from '../../components/ToastProvider';
import {
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  useWizardKeyboard,
  useWizardDraftSync,
  WizardAIButton,
} from '../../components/wizard';
import { clawsApi } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import type { ClawMode, ClawPreset, ClawSandboxMode } from '../../api/endpoints/claws';
import { Sparkles, Clock, Zap, Target } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'preset', label: 'Preset' },
  { id: 'mission', label: 'Mission' },
  { id: 'mode', label: 'Mode' },
  { id: 'stop', label: 'Stop' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Complete' },
];

const MODES: { id: ClawMode; label: string; desc: string; icon: typeof Clock }[] = [
  {
    id: 'continuous',
    label: 'Continuous',
    desc: 'Run cycle after cycle until stopped.',
    icon: Zap,
  },
  { id: 'interval', label: 'Interval', desc: 'Run once every N minutes/hours.', icon: Clock },
  { id: 'event', label: 'Event-driven', desc: 'Run when an event matches.', icon: Target },
  { id: 'single-shot', label: 'Single-shot', desc: 'Run once and stop.', icon: Sparkles },
];

const SANDBOXES: { id: ClawSandboxMode; label: string; desc: string }[] = [
  { id: 'auto', label: 'Auto', desc: 'Pick Docker if available, otherwise local.' },
  { id: 'docker', label: 'Docker', desc: 'Run all tools inside a container (safest).' },
  { id: 'local', label: 'Local', desc: 'Run directly on host (fastest).' },
];

const STOP_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'No automatic stop' },
  { value: 'max_cycles:10', label: 'Stop after 10 cycles' },
  { value: 'max_cycles:50', label: 'Stop after 50 cycles' },
  { value: 'on_report', label: 'Stop when a report is produced' },
  { value: 'idle:3', label: 'Stop if idle for 3 cycles' },
];

export function ClawWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [presets, setPresets] = useState<ClawPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [mode, setMode] = useState<ClawMode>('single-shot');
  const [intervalMin, setIntervalMin] = useState(15);
  const [sandbox, setSandbox] = useState<ClawSandboxMode>('auto');
  const [maxCyclesPerHour, setMaxCyclesPerHour] = useState(10);
  const [totalBudgetUsd, setTotalBudgetUsd] = useState(5);
  const [stopCondition, setStopCondition] = useState('max_cycles:10');
  const [autoStart, setAutoStart] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    id?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    clawsApi
      .presets()
      .then((res) => setPresets(res.presets))
      .catch(silentCatch('claws.presets'));
  }, []);

  const draft = useWizardDraftSync('claw', {
    getSnapshot: () => ({
      selectedPresetId,
      name,
      mission,
      mode,
      intervalMin,
      sandbox,
      maxCyclesPerHour,
      totalBudgetUsd,
      stopCondition,
      autoStart,
    }),
    applySnapshot: (s) => {
      if (s.selectedPresetId !== undefined) setSelectedPresetId(s.selectedPresetId);
      if (s.name !== undefined) setName(s.name);
      if (s.mission !== undefined) setMission(s.mission);
      if (s.mode !== undefined) setMode(s.mode);
      if (s.intervalMin !== undefined) setIntervalMin(s.intervalMin);
      if (s.sandbox !== undefined) setSandbox(s.sandbox);
      if (s.maxCyclesPerHour !== undefined) setMaxCyclesPerHour(s.maxCyclesPerHour);
      if (s.totalBudgetUsd !== undefined) setTotalBudgetUsd(s.totalBudgetUsd);
      if (s.stopCondition !== undefined) setStopCondition(s.stopCondition);
      if (s.autoStart !== undefined) setAutoStart(s.autoStart);
    },
    paused: step >= 5,
  });

  useEffect(() => {
    if (draft.restored) {
      toast.info('Draft restored — continuing where you left off.');
    }
  }, [draft.restored]);

  const applyPreset = (preset: ClawPreset | null) => {
    setSelectedPresetId(preset?.id ?? null);
    if (preset) {
      setName(preset.name);
      setMission(preset.mission);
      setMode(preset.mode);
      setSandbox(preset.sandbox);
    }
  };

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return true; // preset is optional
      case 1:
        return name.trim().length >= 2 && mission.trim().length >= 8;
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, name, mission]);

  const handleNext = async () => {
    if (step === 4) {
      setIsProcessing(true);
      setResult(null);
      try {
        const claw = await clawsApi.create({
          name: name.trim(),
          mission: mission.trim(),
          mode,
          sandbox,
          ...(mode === 'interval' ? { interval_ms: intervalMin * 60_000 } : {}),
          limits: {
            maxCyclesPerHour,
            ...(totalBudgetUsd > 0 ? { totalBudgetUsd } : {}),
          },
          ...(stopCondition ? { stop_condition: stopCondition } : {}),
          auto_start: autoStart,
          ...(selectedPresetId ? { preset: selectedPresetId } : {}),
        });
        setResult({ ok: true, id: claw.id });
        draft.clear();
        setStep(5);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create Claw',
        });
        setStep(5);
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
      title="Create a Claw"
      description="Configure an autonomous agent that runs on its own"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 5}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 5) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Preset */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Start from a Preset (optional)
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Pick a preset to autofill mission + defaults, or skip to build from scratch.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
            <button
              onClick={() => applyPreset(null)}
              className={`text-left p-4 rounded-lg border transition-all ${
                selectedPresetId === null
                  ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                  : 'border-border dark:border-dark-border hover:border-primary/40'
              }`}
            >
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                ✨ Custom Claw
              </span>
              <p className="text-xs text-text-muted mt-1">Build from scratch.</p>
            </button>

            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={`text-left p-4 rounded-lg border transition-all ${
                  selectedPresetId === p.id
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{p.icon}</span>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {p.name}
                  </span>
                </div>
                <p className="text-xs text-text-muted line-clamp-2">{p.description}</p>
                <p className="text-[10px] text-text-muted mt-1">
                  Mode: {p.mode} · Sandbox: {p.sandbox}
                </p>
              </button>
            ))}
            {presets.length === 0 && (
              <p className="col-span-full text-sm text-text-muted text-center py-4">
                Loading presets...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Mission */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Name & Mission
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            What should this Claw do? Be specific — it works autonomously.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily Email Triage"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Mission <span className="text-error">*</span>
                </label>
                <WizardAIButton
                  label={mission.trim() ? 'Refine with AI' : 'Draft with AI'}
                  buildPrompt={() => {
                    const seed = mission.trim() || name.trim();
                    if (!seed) return null;
                    return `Rewrite the following Claw mission into a clear, actionable directive an autonomous AI agent can follow. Be specific about goals, success criteria, tools to prefer, and what to deliver. Stay under 600 words. Output only the rewritten mission text — no preamble.\n\nMission seed:\n${seed}`;
                  }}
                  onResult={(text) => setMission(text.slice(0, 10_000))}
                />
              </div>
              <textarea
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                placeholder="e.g., Every morning at 8am, scan my inbox, summarize urgent emails, draft replies for review, and post a summary to my Telegram."
                rows={5}
                maxLength={10_000}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
              <p className="text-[11px] text-text-muted mt-1">
                {mission.length} / 10,000 chars · Detail matters — the Claw uses this as its
                directive.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Mode & Limits */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Execution Mode
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            How often should this Claw run?
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`text-left p-3 rounded-lg border transition-all flex items-start gap-2 ${
                    mode === m.id
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                      : 'border-border dark:border-dark-border hover:border-primary/40'
                  }`}
                >
                  <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary block">
                      {m.label}
                    </span>
                    <p className="text-xs text-text-muted mt-0.5">{m.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {mode === 'interval' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Interval (minutes)
              </label>
              <input
                type="number"
                value={intervalMin}
                onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 1))}
                min={1}
                max={1440}
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              />
            </div>
          )}

          <div className="border-t border-border dark:border-dark-border pt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Sandbox</label>
              <div className="grid grid-cols-3 gap-2">
                {SANDBOXES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSandbox(s.id)}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      sandbox === s.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <span className="font-medium text-text-primary block">{s.label}</span>
                    <p className="text-[10px] text-text-muted mt-0.5">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Max cycles / hour
                </label>
                <input
                  type="number"
                  value={maxCyclesPerHour}
                  onChange={(e) => setMaxCyclesPerHour(Math.max(1, Number(e.target.value) || 10))}
                  min={1}
                  max={1000}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Total budget (USD)
                </label>
                <input
                  type="number"
                  value={totalBudgetUsd}
                  onChange={(e) => setTotalBudgetUsd(Math.max(0, Number(e.target.value) || 0))}
                  min={0}
                  step={0.5}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[10px] text-text-muted mt-1">0 = unlimited</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Stop conditions */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Stop Conditions
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            When should this Claw stop on its own?
          </p>

          <div className="space-y-2 mb-4">
            {STOP_PRESETS.map((p) => (
              <label
                key={p.label}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  stopCondition === p.value
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <input
                  type="radio"
                  name="stopCondition"
                  checked={stopCondition === p.value}
                  onChange={() => setStopCondition(p.value)}
                  className="text-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {p.label}
                  </span>
                  {p.value && (
                    <code className="ml-2 text-[10px] text-text-muted font-mono">{p.value}</code>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Custom (advanced)
            </label>
            <input
              type="text"
              value={stopCondition}
              onChange={(e) => setStopCondition(e.target.value)}
              placeholder="e.g., max_cycles:25, on_error, idle:5"
              className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            />
          </div>

          <label className="flex items-center gap-3 mt-6 p-3 rounded-lg border border-border dark:border-dark-border cursor-pointer">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="text-primary"
            />
            <div>
              <span className="text-sm font-medium text-text-primary block">
                Start immediately after creation
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                If off, you must start it manually from the Claws page.
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Review
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Confirm the Claw configuration before creating.
          </p>

          <div className="space-y-3 text-sm">
            <Row label="Name" value={name} />
            <Row
              label="Mode"
              value={mode + (mode === 'interval' ? ` (every ${intervalMin} min)` : '')}
            />
            <Row label="Sandbox" value={sandbox} />
            <Row label="Max cycles/hour" value={String(maxCyclesPerHour)} />
            <Row label="Budget" value={totalBudgetUsd > 0 ? `$${totalBudgetUsd}` : 'unlimited'} />
            <Row label="Stop condition" value={stopCondition || 'none'} />
            <Row label="Auto-start" value={autoStart ? 'yes' : 'no'} />
            <div>
              <p className="text-xs text-text-muted mb-1">Mission</p>
              <p className="text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg whitespace-pre-wrap text-xs">
                {mission}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Result */}
      {step === 5 && (
        <>
          {isProcessing && <WizardLoadingView label="Creating Claw..." />}
          {result?.ok && (
            <WizardCompleteView
              icon={Sparkles}
              title="Claw Created!"
              subtitle={
                <>
                  <strong>{name}</strong>{' '}
                  {autoStart
                    ? 'is configured and starting now.'
                    : 'is configured — start it from the Claws page when you are ready.'}
                </>
              }
              facts={[
                { label: 'Mode', value: mode },
                { label: 'Sandbox', value: sandbox },
                { label: 'Stop', value: stopCondition || 'manual' },
                { label: 'Auto-start', value: autoStart ? 'on' : 'off' },
              ]}
              actions={[
                { label: 'Open Claws', onClick: () => navigate('/claws') },
                ...(result.id
                  ? [{ label: 'View this Claw', onClick: () => navigate(`/claws?id=${result.id}`) }]
                  : []),
              ]}
            />
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Creation Failed"
              message={result.error}
              onRetry={() => {
                setStep(4);
                setResult(null);
              }}
            />
          )}
        </>
      )}
    </WizardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/40 dark:border-dark-border/40 pb-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate ml-3">
        {value}
      </span>
    </div>
  );
}

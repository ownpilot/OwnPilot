/**
 * Habit Tracking Wizard
 *
 * Steps: Name & Category → Frequency → Target & Reminder → Review → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  useWizardKeyboard,
  useWizardDraftSync,
  WizardAIButton,
} from '../../components/wizard';
import { useToast } from '../../components/ToastProvider';
import { habitsApi } from '../../api';
import { silentCatch } from '../../utils/ignore-error';
import { ListChecks } from '../../components/icons';
import { extractJsonArray } from './ai-helper';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'frequency', label: 'Frequency' },
  { id: 'target', label: 'Target' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Complete' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRESET_HABITS: Array<{
  name: string;
  category: string;
  targetCount: number;
  unit: string;
  description: string;
}> = [
  {
    name: 'Drink water',
    category: 'health',
    targetCount: 8,
    unit: 'glasses',
    description: 'Stay hydrated',
  },
  {
    name: 'Walk 10k steps',
    category: 'fitness',
    targetCount: 10000,
    unit: 'steps',
    description: 'Daily movement',
  },
  {
    name: 'Read',
    category: 'learning',
    targetCount: 30,
    unit: 'minutes',
    description: 'Reading time',
  },
  {
    name: 'Meditate',
    category: 'mindfulness',
    targetCount: 10,
    unit: 'minutes',
    description: 'Daily meditation',
  },
  {
    name: 'Journal',
    category: 'mindfulness',
    targetCount: 1,
    unit: 'entry',
    description: 'Reflect on the day',
  },
  {
    name: 'No social media before noon',
    category: 'focus',
    targetCount: 1,
    unit: 'day',
    description: 'Deep work in mornings',
  },
];

const FREQUENCIES = [
  { id: 'daily', label: 'Every day', desc: 'Mon–Sun', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weekdays', label: 'Weekdays', desc: 'Mon–Fri', days: [0, 1, 2, 3, 4] },
  { id: 'weekends', label: 'Weekends', desc: 'Sat–Sun', days: [5, 6] },
  { id: 'custom', label: 'Custom', desc: 'Pick specific days', days: [] as number[] },
];

function getCreatedHabitId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as { habit?: { id?: unknown }; id?: unknown };
  if (typeof response.habit?.id === 'string') return response.habit.id;
  return typeof response.id === 'string' ? response.id : undefined;
}

export function HabitWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [frequencyId, setFrequencyId] = useState<'daily' | 'weekdays' | 'weekends' | 'custom'>(
    'daily'
  );
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [targetCount, setTargetCount] = useState(1);
  const [unit, setUnit] = useState('time');
  const [reminderTime, setReminderTime] = useState('');
  const [goalHint, setGoalHint] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<
    Array<{
      name: string;
      category?: string;
      targetCount?: number;
      unit?: string;
      description?: string;
    }>
  >([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; id?: string; error?: string } | null>(null);

  useEffect(() => {
    habitsApi
      .categories()
      .then((res) => setKnownCategories(res.categories || []))
      .catch(silentCatch('habits.categories'));
  }, []);

  const draft = useWizardDraftSync('habit', {
    getSnapshot: () => ({
      name,
      description,
      category,
      frequencyId,
      customDays,
      targetCount,
      unit,
      reminderTime,
      goalHint,
    }),
    applySnapshot: (s) => {
      if (s.name !== undefined) setName(s.name);
      if (s.description !== undefined) setDescription(s.description);
      if (s.category !== undefined) setCategory(s.category);
      if (s.frequencyId !== undefined) setFrequencyId(s.frequencyId);
      if (s.customDays !== undefined) setCustomDays(s.customDays);
      if (s.targetCount !== undefined) setTargetCount(s.targetCount);
      if (s.unit !== undefined) setUnit(s.unit);
      if (s.reminderTime !== undefined) setReminderTime(s.reminderTime);
      if (s.goalHint !== undefined) setGoalHint(s.goalHint);
    },
    paused: step >= 4,
  });

  useEffect(() => {
    if (draft.restored) toast.info('Draft restored — continuing where you left off.');
  }, [draft.restored]);

  const targetDays = useMemo(() => {
    if (frequencyId === 'custom') return customDays;
    const f = FREQUENCIES.find((f) => f.id === frequencyId);
    return f?.days ?? [];
  }, [frequencyId, customDays]);

  const applyPreset = (p: (typeof PRESET_HABITS)[number]) => {
    setName(p.name);
    setCategory(p.category);
    setTargetCount(p.targetCount);
    setUnit(p.unit);
    setDescription(p.description);
  };

  const toggleCustomDay = (d: number) => {
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return name.trim().length >= 2;
      case 1:
        return targetDays.length > 0;
      case 2:
        return targetCount > 0 && unit.trim().length > 0;
      case 3:
        return true;
      default:
        return false;
    }
  }, [step, name, targetDays, targetCount, unit]);

  const handleNext = async () => {
    if (step === 3) {
      setIsProcessing(true);
      setResult(null);
      try {
        // Backend accepts: daily | weekly | weekdays | custom — map 'weekends' to custom
        const backendFrequency = frequencyId === 'weekends' ? 'custom' : frequencyId;
        const created = await habitsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          frequency: backendFrequency,
          targetDays,
          targetCount,
          unit: unit.trim(),
          category: category.trim() || undefined,
          reminderTime: reminderTime || undefined,
        });
        // Response is wrapped: { habit, message }
        const habitId = getCreatedHabitId(created);
        setResult({ ok: true, id: habitId });
        draft.clear();
        setStep(4);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create habit',
        });
        setStep(4);
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
      title="Track a Habit"
      description="Build a habit with streaks, targets, and reminders"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 4) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: Basics */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            What habit do you want to build?
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Start from a preset, ask AI for ideas, or write your own.
          </p>

          {/* AI ideation */}
          <div className="mb-4 p-3 rounded-lg border border-dashed border-border dark:border-dark-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-text-primary">
                Tell AI your goal — get 3 habit ideas
              </p>
              <WizardAIButton
                label="Suggest ideas"
                buildPrompt={() => {
                  const seed = goalHint.trim();
                  if (!seed) return null;
                  return `The user wants to build habits to support this goal:\n"${seed}"\n\nReturn exactly 3 habit suggestions as a JSON array. Each item: { "name": string, "category": string (one word), "targetCount": number, "unit": string, "description": string (under 80 chars) }. Output ONLY the JSON array.`;
                }}
                onResult={(text) => {
                  const arr = extractJsonArray<{
                    name: string;
                    category?: string;
                    targetCount?: number;
                    unit?: string;
                    description?: string;
                  }>(text);
                  setAiSuggestions(arr.slice(0, 3));
                }}
              />
            </div>
            <input
              type="text"
              value={goalHint}
              onChange={(e) => setGoalHint(e.target.value)}
              placeholder="e.g., Sleep better, lose 5kg, learn Spanish"
              className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {aiSuggestions.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {aiSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setName(s.name);
                      setDescription(s.description || '');
                      if (s.category) setCategory(s.category);
                      if (s.targetCount) setTargetCount(s.targetCount);
                      if (s.unit) setUnit(s.unit);
                    }}
                    className="text-left p-2 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <span className="text-xs font-medium text-text-primary block">{s.name}</span>
                    {s.description && (
                      <p className="text-[10px] text-text-muted line-clamp-2 mt-0.5">
                        {s.description}
                      </p>
                    )}
                    {(s.targetCount || s.unit) && (
                      <p className="text-[10px] text-primary mt-1 font-mono">
                        {s.targetCount} {s.unit}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5">
            {PRESET_HABITS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className={`text-left p-3 rounded-lg border text-xs transition-all ${
                  name === p.name
                    ? 'border-primary bg-primary/5'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary block">
                  {p.name}
                </span>
                <p className="text-[10px] text-text-muted mt-0.5">{p.description}</p>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Habit name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Morning run"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Why does this habit matter to you?"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., health, learning, focus"
                list="known-categories"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <datalist id="known-categories">
                {knownCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Frequency */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            How often?
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Pick the days this habit should be tracked on.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {FREQUENCIES.map((f) => (
              <button
                key={f.id}
                onClick={() => setFrequencyId(f.id as typeof frequencyId)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  frequencyId === f.id
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <span className="text-sm font-medium text-text-primary block">{f.label}</span>
                <p className="text-[11px] text-text-muted mt-0.5">{f.desc}</p>
              </button>
            ))}
          </div>

          {frequencyId === 'custom' && (
            <div>
              <p className="text-sm font-medium text-text-primary mb-2">Pick days</p>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d, i) => {
                  const selected = customDays.includes(i);
                  return (
                    <button
                      key={d}
                      onClick={() => toggleCustomDay(i)}
                      className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                        selected
                          ? 'border-primary bg-primary text-white'
                          : 'border-border dark:border-dark-border hover:border-primary/40 text-text-primary'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Target & Reminder */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Daily Target
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            How much counts as a successful day?
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Count</label>
              <input
                type="number"
                value={targetCount}
                onChange={(e) => setTargetCount(Math.max(1, Number(e.target.value) || 1))}
                min={1}
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Unit</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g., glasses, minutes, pages"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Reminder time (optional)
            </label>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Your AI will remind you at this time on tracked days.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Review
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Confirm and create.
          </p>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-border/40 pb-1.5">
              <span className="text-text-muted">Name</span>
              <span className="font-medium text-text-primary">{name}</span>
            </div>
            <div className="flex justify-between border-b border-border/40 pb-1.5">
              <span className="text-text-muted">Category</span>
              <span className="font-medium text-text-primary">{category || '—'}</span>
            </div>
            <div className="flex justify-between border-b border-border/40 pb-1.5">
              <span className="text-text-muted">Frequency</span>
              <span className="font-medium text-text-primary">
                {targetDays.map((d) => DAYS[d]).join(', ')}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/40 pb-1.5">
              <span className="text-text-muted">Target</span>
              <span className="font-medium text-text-primary">
                {targetCount} {unit}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/40 pb-1.5">
              <span className="text-text-muted">Reminder</span>
              <span className="font-medium text-text-primary">{reminderTime || '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 4 && (
        <>
          {isProcessing && <WizardLoadingView label="Creating habit..." />}
          {result?.ok && (
            <WizardCompleteView
              icon={ListChecks}
              title="Habit Started!"
              subtitle={
                <>
                  <strong>{name}</strong> is now being tracked. Build your streak!
                </>
              }
              facts={[
                { label: 'Target', value: `${targetCount} ${unit}` },
                { label: 'Days', value: `${targetDays.length}/week` },
                ...(category ? [{ label: 'Category', value: category }] : []),
                ...(reminderTime ? [{ label: 'Reminder', value: reminderTime }] : []),
              ]}
              actions={[{ label: 'Open Habits', onClick: () => navigate('/habits') }]}
            />
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Creation Failed"
              message={result.error}
              onRetry={() => {
                setStep(3);
                setResult(null);
              }}
            />
          )}
        </>
      )}
    </WizardShell>
  );
}

/**
 * Goal Setup Wizard
 *
 * Steps: Define Goal → Set Target → Add Steps → Review → Complete
 */

import { useState, useMemo, useRef } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { goalsApi } from '../../api';
import { AlertTriangle, Target, Plus, Trash, Sparkles } from '../../components/icons';
import { aiGenerate, extractJsonArray } from './ai-helper';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'define', label: 'Define' },
  { id: 'target', label: 'Target' },
  { id: 'steps', label: 'Steps' },
  { id: 'create', label: 'Create' },
  { id: 'done', label: 'Complete' },
];

const GOAL_CATEGORIES = [
  'Health & Fitness',
  'Career & Professional',
  'Learning & Education',
  'Financial',
  'Personal Development',
  'Creative Projects',
  'Relationships',
  'Other',
];

interface GoalStepDraft {
  title: string;
  description: string;
}

export function GoalWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(5);
  const [goalSteps, setGoalSteps] = useState<GoalStepDraft[]>([
    { title: '', description: '' },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ ok: boolean; goalId?: string; error?: string } | null>(null);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0: return title.trim().length >= 3;
      case 1: return true; // due date and priority have defaults
      case 2: return true; // steps are optional
      case 3: return result?.ok === true;
      default: return false;
    }
  }, [step, title, result]);

  const addGoalStep = () => {
    setGoalSteps([...goalSteps, { title: '', description: '' }]);
  };

  const removeGoalStep = (idx: number) => {
    setGoalSteps(goalSteps.filter((_, i) => i !== idx));
  };

  const updateGoalStep = (idx: number, field: keyof GoalStepDraft, value: string) => {
    setGoalSteps(goalSteps.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const suggestSteps = async () => {
    if (!title.trim()) return;
    setAiGenerating(true);
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    try {
      const desc = description.trim() ? `Description: "${description.trim()}".` : '';
      const cat = category ? `Category: ${category}.` : '';
      const due = dueDate ? `Target date: ${dueDate}.` : '';
      const prompt = `Suggest 4-6 actionable milestones/steps for the following goal:
Goal: "${title.trim()}"
${desc} ${cat} ${due}

Return a JSON array of objects with "title" field (short, actionable step title).
Example: [{"title":"Research available courses"},{"title":"Enroll in a beginner program"}]

Return ONLY the JSON array, nothing else.`;

      const text = await aiGenerate(prompt, ctrl.signal);
      const steps = extractJsonArray<{ title: string }>(text);
      if (steps.length > 0) {
        setGoalSteps(steps.map((s) => ({ title: s.title || '', description: '' })));
      }
    } catch {
      // Aborted or failed
    } finally {
      setAiGenerating(false);
    }
  };

  const handleNext = async () => {
    if (step === 2) {
      // Create goal
      setIsProcessing(true);
      setResult(null);
      try {
        const goal = await goalsApi.create({
          title: title.trim(),
          description: description.trim() || undefined,
          category: category || undefined,
          dueDate: dueDate || undefined,
          priority,
          status: 'active',
        });

        // Add steps if any
        const validSteps = goalSteps.filter((s) => s.title.trim());
        for (const gs of validSteps) {
          await goalsApi.update(goal.id, {
            steps: [...(goal.steps ?? []), { title: gs.title.trim(), description: gs.description.trim(), completed: false }],
          }).catch(() => {});
        }

        setResult({ ok: true, goalId: goal.id });
        setStep(3);
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed to create goal' });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <WizardShell
      title="Create a Goal"
      description="Define a goal and break it down into actionable steps"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => setStep(Math.max(0, step - 1))}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Define Goal */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            What's Your Goal?
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Define a clear, specific goal you want to achieve.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Goal Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Learn TypeScript, Run a marathon"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Description <span className="text-text-muted dark:text-dark-text-muted font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your goal in more detail — why is it important?"
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Category <span className="text-text-muted dark:text-dark-text-muted font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {GOAL_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(category === c ? '' : c)}
                    className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                      category === c
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:border-primary/40'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Target & Deadline */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Set Target & Priority
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            When do you want to achieve this? How important is it?
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Due Date <span className="text-text-muted dark:text-dark-text-muted font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Priority
                </label>
                <span className="text-sm font-mono text-text-muted dark:text-dark-text-muted">{priority}/10</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Break Down Steps */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Break It Down
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Add milestones or let AI suggest steps based on your goal.
          </p>

          <button
            onClick={suggestSteps}
            disabled={aiGenerating || !title.trim()}
            className="flex items-center gap-2 mb-4 px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-purple-500 to-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {aiGenerating ? 'Suggesting...' : 'Suggest Steps with AI'}
          </button>

          <div className="space-y-3 mb-4">
            {goalSteps.map((gs, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium mt-2">
                  {i + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={gs.title}
                    onChange={(e) => updateGoalStep(i, 'title', e.target.value)}
                    placeholder={`Step ${i + 1} title`}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                {goalSteps.length > 1 && (
                  <button
                    onClick={() => removeGoalStep(i)}
                    className="mt-2 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {goalSteps.length < 10 && (
            <button
              onClick={addGoalStep}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Plus className="w-4 h-4" />
              Add Step
            </button>
          )}
        </div>
      )}

      {/* Step 3: Create */}
      {step === 3 && (
        <div className="text-center py-8">
          {!result && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Creating goal...</p>
            </div>
          )}

          {result?.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Target className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Goal Created!
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                <strong>{title}</strong> is now being tracked.
              </p>
            </>
          )}

          {result && !result.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Creation Failed
              </h3>
              <p className="text-sm text-error max-w-md mx-auto">{result.error}</p>
              <button
                onClick={() => { setStep(2); setResult(null); }}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <Target className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            Goal Set!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{title}</strong> has been created with {goalSteps.filter((s) => s.title.trim()).length} step(s).
            {dueDate && ` Target date: ${new Date(dueDate).toLocaleDateString()}.`}
          </p>
          <div className="flex justify-center gap-3">
            <a
              href="/goals"
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              View Goals
            </a>
          </div>
        </div>
      )}
    </WizardShell>
  );
}

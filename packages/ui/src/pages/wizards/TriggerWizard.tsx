/**
 * Trigger Setup Wizard
 *
 * Steps: Choose Type → Configure Schedule/Event → Configure Action → Create → Complete
 */

import { useState, useMemo } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { apiClient } from '../../api';
import { AlertTriangle, Zap, Clock, Globe } from '../../components/icons';
import { CRON_PRESETS, validateCron } from '../../components/TriggerModal';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'type', label: 'Type' },
  { id: 'config', label: 'Config' },
  { id: 'action', label: 'Action' },
  { id: 'create', label: 'Create' },
  { id: 'done', label: 'Complete' },
];

type TriggerType = 'schedule' | 'event' | 'condition' | 'webhook';
type ActionType = 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary' | 'workflow';

const TRIGGER_TYPES: Array<{ id: TriggerType; label: string; desc: string; icon: typeof Clock }> = [
  {
    id: 'schedule',
    label: 'Schedule',
    desc: 'Run on a cron schedule (e.g., every morning)',
    icon: Clock,
  },
  { id: 'event', label: 'Event', desc: 'Fire when a specific event occurs', icon: Zap },
  { id: 'webhook', label: 'Webhook', desc: 'Fire from an external HTTP request', icon: Globe },
];

const ACTION_TYPES: Array<{ id: ActionType; label: string; desc: string }> = [
  { id: 'chat', label: 'Send Chat Message', desc: 'Send a message to the AI and get a response' },
  { id: 'notification', label: 'Send Notification', desc: 'Show a notification in the UI' },
  { id: 'goal_check', label: 'Goal Check', desc: 'Review and update goal progress' },
  { id: 'memory_summary', label: 'Memory Summary', desc: 'Summarize and consolidate memories' },
];

export function TriggerWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType | null>(null);
  const [cronExpression, setCronExpression] = useState('0 8 * * *');
  const [eventType, setEventType] = useState('');
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionPayload, setActionPayload] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; triggerId?: string; error?: string } | null>(
    null
  );

  const cronValid = useMemo(() => validateCron(cronExpression), [cronExpression]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return !!triggerType && name.trim().length >= 2;
      case 1: {
        if (triggerType === 'schedule') return cronValid.valid;
        if (triggerType === 'event') return eventType.trim().length > 0;
        if (triggerType === 'webhook') return true; // path is auto-generated
        return false;
      }
      case 2:
        return !!actionType;
      case 3:
        return result?.ok === true;
      default:
        return false;
    }
  }, [step, triggerType, name, cronValid, eventType, actionType, result]);

  const handleNext = async () => {
    if (step === 2) {
      // Create trigger
      setIsProcessing(true);
      setResult(null);
      try {
        const config: Record<string, unknown> = {};
        if (triggerType === 'schedule') config.cron = cronExpression;
        if (triggerType === 'event') config.eventType = eventType;

        const action: Record<string, unknown> = {
          type: actionType,
          payload: actionPayload.trim() ? { message: actionPayload.trim() } : {},
        };

        const res = await apiClient.post<{ trigger: { id: string } }>('/triggers', {
          name: name.trim(),
          type: triggerType,
          config,
          action,
          enabled: true,
        });

        setResult({ ok: true, triggerId: res.trigger.id });
        setStep(3);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create trigger',
        });
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
      title="Create a Trigger"
      description="Set up automated actions on a schedule or event"
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
      {/* Step 0: Choose Type */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Trigger Type & Name
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Choose what fires this trigger and give it a name.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Trigger Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Morning Briefing, Weekly Review"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              {TRIGGER_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTriggerType(t.id)}
                    className={`w-full text-left p-4 rounded-lg border transition-all flex items-center gap-4 ${
                      triggerType === t.id
                        ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                        {t.label}
                      </span>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                        {t.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Configure */}
      {step === 1 && (
        <div>
          {triggerType === 'schedule' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Set Schedule
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Choose a preset or write a custom cron expression.
              </p>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    onClick={() => setCronExpression(p.cron)}
                    className={`text-left p-3 rounded-lg border text-sm transition-all ${
                      cronExpression === p.cron
                        ? 'border-primary bg-primary/5 dark:bg-primary/10'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {p.label}
                    </span>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                      {p.desc}
                    </p>
                  </button>
                ))}
              </div>

              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Cron Expression
              </label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              />
              {cronExpression && !cronValid.valid && (
                <p className="text-xs text-warning mt-1">{cronValid.error}</p>
              )}
              <p className="text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                Format: minute hour day month weekday (e.g., 0 9 * * 1-5 = weekdays at 9am)
              </p>
            </>
          )}

          {triggerType === 'event' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Event Configuration
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
                Specify which event should fire this trigger.
              </p>

              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Event Type
              </label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g., message:received, task:completed"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              />
            </>
          )}

          {triggerType === 'webhook' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Webhook Configuration
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
                A unique webhook URL will be generated when the trigger is created. Send a POST
                request to it to fire the trigger.
              </p>
              <div className="p-4 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <p className="text-xs text-text-muted dark:text-dark-text-muted">
                  The webhook path will be available after creation. You can find it in the Triggers
                  page.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 2: Action */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose Action
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            What should happen when this trigger fires?
          </p>

          <div className="space-y-2 mb-4">
            {ACTION_TYPES.map((a) => (
              <button
                key={a.id}
                onClick={() => setActionType(a.id)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  actionType === a.id
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border dark:border-dark-border hover:border-primary/40'
                }`}
              >
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {a.label}
                </span>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">{a.desc}</p>
              </button>
            ))}
          </div>

          {actionType === 'chat' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Message to Send
              </label>
              <textarea
                value={actionPayload}
                onChange={(e) => setActionPayload(e.target.value)}
                placeholder="e.g., Give me a summary of today's tasks and any pending deadlines."
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
            </div>
          )}

          {actionType === 'notification' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Notification Message
              </label>
              <input
                type="text"
                value={actionPayload}
                onChange={(e) => setActionPayload(e.target.value)}
                placeholder="e.g., Time for your daily review!"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 3: Create */}
      {step === 3 && (
        <div className="text-center py-8">
          {!result && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Creating trigger...</p>
            </div>
          )}

          {result?.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Zap className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Trigger Created!
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                <strong>{name}</strong> is now active.
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
                onClick={() => {
                  setStep(2);
                  setResult(null);
                }}
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
            <Zap className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            Trigger Active!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{name}</strong> ({triggerType}) will fire automatically.
            {triggerType === 'schedule' && ` Schedule: ${cronExpression}`}
          </p>
          <a
            href="/triggers"
            className="inline-flex px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            View Triggers
          </a>
        </div>
      )}
    </WizardShell>
  );
}

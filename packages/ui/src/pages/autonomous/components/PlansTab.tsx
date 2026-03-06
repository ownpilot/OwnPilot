/**
 * PlansTab — Autonomous Hub
 *
 * Lists all plans, shows step progress, and exposes
 * execute / pause / cancel actions inline.
 */

import { useState, useEffect, useCallback } from 'react';
import { plansApi } from '../../../api/endpoints/personal-data';
import type { Plan, PlanStep } from '../../../api/types';
import {
  Plus,
  Play,
  Pause,
  X,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
} from '../../../components/icons';

// =============================================================================
// Helpers
// =============================================================================

const STATUS_STYLES: Record<Plan['status'], string> = {
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
  running: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400',
  paused: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  completed: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-400',
};

const STEP_STATUS_ICON: Record<PlanStep['status'], typeof CheckCircle2> = {
  pending: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  skipped: Clock,
  blocked: AlertCircle,
  waiting: Clock,
};

const STEP_STATUS_COLOR: Record<PlanStep['status'], string> = {
  pending: 'text-gray-400',
  running: 'text-blue-500 animate-spin',
  completed: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-gray-400',
  blocked: 'text-amber-500',
  waiting: 'text-amber-400',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// =============================================================================
// StepRow
// =============================================================================

function StepRow({ step }: { step: PlanStep }) {
  const Icon = STEP_STATUS_ICON[step.status] ?? Clock;
  const color = STEP_STATUS_COLOR[step.status] ?? 'text-gray-400';

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
            {step.name}
          </span>
          <span className="text-[10px] text-text-muted shrink-0">
            {step.type.replace('_', ' ')}
          </span>
        </div>
        {step.description && (
          <p className="text-[10px] text-text-muted mt-0.5 truncate">{step.description}</p>
        )}
        {step.error && <p className="text-[10px] text-red-500 mt-0.5 truncate">{step.error}</p>}
      </div>
    </div>
  );
}

// =============================================================================
// PlanCard
// =============================================================================

interface PlanCardProps {
  plan: Plan;
  onAction: (id: string, action: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function PlanCard({ plan, onAction, onDelete }: PlanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [isLoadingSteps, setIsLoadingSteps] = useState(false);
  const [isActing, setIsActing] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && steps.length === 0) {
      setIsLoadingSteps(true);
      try {
        const data = await plansApi.steps(plan.id);
        setSteps(data?.steps ?? []);
      } finally {
        setIsLoadingSteps(false);
      }
    }
    setExpanded((v) => !v);
  };

  const doAction = async (action: string) => {
    setIsActing(true);
    try {
      await onAction(plan.id, action);
    } finally {
      setIsActing(false);
    }
  };

  const progress = plan.totalSteps > 0 ? Math.round((plan.progress / plan.totalSteps) * 100) : 0;

  return (
    <div className="border border-border dark:border-dark-border rounded-xl overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
        onClick={toggleExpand}
      >
        <button
          className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand();
          }}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
              {plan.name}
            </span>
            <span
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${STATUS_STYLES[plan.status]}`}
            >
              {plan.status}
            </span>
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted truncate mt-0.5">
            {plan.goal}
          </p>
        </div>

        {/* Progress */}
        {plan.totalSteps > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-20 h-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${plan.status === 'failed' ? 'bg-red-500' : plan.status === 'completed' ? 'bg-green-500' : 'bg-primary'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-text-muted w-8 text-right">{progress}%</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {plan.status === 'pending' && (
            <button
              onClick={() => doAction('execute')}
              disabled={isActing}
              title="Execute plan"
              className="p-1.5 rounded-lg text-text-muted hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {plan.status === 'running' && (
            <button
              onClick={() => doAction('pause')}
              disabled={isActing}
              title="Pause plan"
              className="p-1.5 rounded-lg text-text-muted hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-50"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {plan.status === 'paused' && (
            <button
              onClick={() => doAction('resume')}
              disabled={isActing}
              title="Resume plan"
              className="p-1.5 rounded-lg text-text-muted hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {(plan.status === 'running' || plan.status === 'paused') && (
            <button
              onClick={() => doAction('cancel')}
              disabled={isActing}
              title="Cancel plan"
              className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {(plan.status === 'completed' ||
            plan.status === 'failed' ||
            plan.status === 'cancelled') && (
            <button
              onClick={() => onDelete(plan.id)}
              title="Delete plan"
              className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <span className="text-[10px] text-text-muted flex-shrink-0">{timeAgo(plan.updatedAt)}</span>
      </div>

      {/* Steps */}
      {expanded && (
        <div className="border-t border-border dark:border-dark-border px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary">
          {isLoadingSteps ? (
            <p className="text-xs text-text-muted py-2">Loading steps…</p>
          ) : steps.length === 0 ? (
            <p className="text-xs text-text-muted py-2">No steps defined.</p>
          ) : (
            <div className="divide-y divide-border dark:divide-dark-border">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          )}
          {plan.error && <p className="text-xs text-red-500 mt-2 pb-1">{plan.error}</p>}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CreatePlanModal (minimal — name + goal)
// =============================================================================

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !goal.trim()) {
      setError('Name and goal are required.');
      return;
    }
    setError('');
    setIsSaving(true);
    try {
      await plansApi.create({ name: name.trim(), goal: goal.trim() });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
            New Plan
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Plan Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly Report Automation"
              className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Goal *
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              placeholder="Describe what this plan should accomplish…"
              className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Add steps after creating the plan, or ask the AI assistant to build the plan for you.
          </p>
        </form>
        <div className="px-5 py-3 border-t border-border dark:border-dark-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? 'Creating…' : 'Create Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PlansTab
// =============================================================================

const STATUS_FILTERS = ['all', 'pending', 'running', 'paused', 'completed', 'failed'] as const;

export function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = statusFilter !== 'all' ? { status: statusFilter } : undefined;
      const data = await plansApi.list(params);
      setPlans(data?.plans ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = useCallback(
    async (id: string, action: string) => {
      await plansApi.action(id, action);
      await load();
    },
    [load]
  );

  const handleDelete = useCallback(async (id: string) => {
    await plansApi.delete(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const running = plans.filter((p) => p.status === 'running').length;
  const pending = plans.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Plans
          </h3>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {running > 0 && <span className="text-blue-500 mr-2">{running} running</span>}
            {pending > 0 && <span className="text-amber-500 mr-2">{pending} pending</span>}
            {plans.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Plan
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 text-xs rounded-lg capitalize transition-colors ${
              statusFilter === s
                ? 'bg-primary text-white'
                : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-bg-secondary dark:bg-dark-bg-secondary animate-pulse"
            />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            No {statusFilter !== 'all' ? statusFilter : ''} plans
          </p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Create a plan or ask the AI: <em>"Create a plan to generate weekly reports"</em>
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Plan
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onAction={handleAction} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

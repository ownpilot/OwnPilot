import { useState, useEffect, useCallback } from 'react';
import {
  ListChecks,
  Plus,
  Trash2,
  Play,
  Pause,
  StopCircle,
  RotateCcw,
  ChevronRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';

interface PlanStep {
  id: string;
  planId: string;
  type: 'tool_call' | 'llm_decision' | 'user_input' | 'condition' | 'parallel' | 'loop' | 'sub_plan';
  name: string;
  description?: string;
  config: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  orderNum: number;
  dependencies?: string[];
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface Plan {
  id: string;
  title: string;
  description?: string;
  status: 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  goalId?: string;
  triggerId?: string;
  progress: number;
  currentStep?: string;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  steps?: PlanStep[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

const statusColors = {
  draft: 'bg-text-muted/10 text-text-muted',
  pending: 'bg-warning/10 text-warning',
  running: 'bg-primary/10 text-primary',
  paused: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  aborted: 'bg-text-muted/10 text-text-muted',
};

const stepTypeLabels = {
  tool_call: 'Tool Call',
  llm_decision: 'AI Decision',
  user_input: 'User Input',
  condition: 'Condition',
  parallel: 'Parallel',
  loop: 'Loop',
  sub_plan: 'Sub-plan',
};

const stepStatusIcons = {
  pending: Circle,
  in_progress: Clock,
  completed: CheckCircle2,
  failed: AlertTriangle,
  skipped: Circle,
};

export function PlansPage() {
  const { confirm } = useDialog();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Plan['status'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }

      const response = await fetch(`/api/v1/plans?${params}`);
      const data: ApiResponse<{ plans: Plan[] }> = await response.json();
      if (data.success && data.data) {
        setPlans(data.data.plans);
      }
    } catch (err) {
      console.error('Failed to fetch plans:', err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchPlans();
    // Auto-refresh every 5 seconds for running plans
    const interval = setInterval(() => {
      if (plans.some((p) => p.status === 'running')) {
        fetchPlans();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchPlans, plans]);

  const handleDelete = async (planId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this plan?', variant: 'danger' })) return;

    try {
      const response = await fetch(`/api/v1/plans/${planId}`, {
        method: 'DELETE',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchPlans();
      }
    } catch (err) {
      console.error('Failed to delete plan:', err);
    }
  };

  const handleAction = async (planId: string, action: 'start' | 'pause' | 'resume' | 'abort') => {
    try {
      const response = await fetch(`/api/v1/plans/${planId}/${action}`, {
        method: 'POST',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchPlans();
      }
    } catch (err) {
      console.error(`Failed to ${action} plan:`, err);
    }
  };

  const handleRollback = async (planId: string) => {
    if (!await confirm({ message: 'Are you sure you want to rollback to the last checkpoint?', variant: 'danger' })) return;

    try {
      const response = await fetch(`/api/v1/plans/${planId}/rollback`, {
        method: 'POST',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchPlans();
      }
    } catch (err) {
      console.error('Failed to rollback plan:', err);
    }
  };

  const runningCount = plans.filter((p) => p.status === 'running').length;
  const completedCount = plans.filter((p) => p.status === 'completed').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Plans
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {runningCount} running, {completedCount} completed
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Plan
        </button>
      </header>

      {/* Filters */}
      <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border overflow-x-auto">
        {(['all', 'draft', 'pending', 'running', 'paused', 'completed', 'failed', 'aborted'] as const).map(
          (status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
                statusFilter === status
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          )
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <ListChecks className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No plans yet
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted mb-4 text-center max-w-md">
              Plans let the AI execute multi-step workflows autonomously.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Plan
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <PlanItem
                key={plan.id}
                plan={plan}
                isExpanded={expandedPlan === plan.id}
                onToggle={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                onEdit={() => setEditingPlan(plan)}
                onDelete={() => handleDelete(plan.id)}
                onStart={() => handleAction(plan.id, 'start')}
                onPause={() => handleAction(plan.id, 'pause')}
                onResume={() => handleAction(plan.id, 'resume')}
                onAbort={() => handleAction(plan.id, 'abort')}
                onRollback={() => handleRollback(plan.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingPlan) && (
        <PlanModal
          plan={editingPlan}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
            fetchPlans();
          }}
        />
      )}
    </div>
  );
}

interface PlanItemProps {
  plan: Plan;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onRollback: () => void;
}

function PlanItem({
  plan,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onStart,
  onPause,
  onResume,
  onAbort,
  onRollback,
}: PlanItemProps) {
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);

  useEffect(() => {
    if (isExpanded && steps.length === 0) {
      setLoadingSteps(true);
      fetch(`/api/v1/plans/${plan.id}/steps`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            setSteps(data.data.steps);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingSteps(false));
    }
  }, [isExpanded, plan.id, steps.length]);

  // Refresh steps when plan is running
  useEffect(() => {
    if (plan.status === 'running' && isExpanded) {
      const interval = setInterval(() => {
        fetch(`/api/v1/plans/${plan.id}/steps`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.data) {
              setSteps(data.data.steps);
            }
          })
          .catch(console.error);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [plan.status, plan.id, isExpanded]);

  return (
    <div className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <button
          onClick={onToggle}
          className="mt-1 flex-shrink-0 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
        >
          <ChevronRight
            className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-text-primary dark:text-dark-text-primary">
              {plan.title}
            </span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[plan.status]}`}>
              {plan.status}
            </span>
          </div>

          {plan.description && (
            <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2">
              {plan.description}
            </p>
          )}

          <div className="mt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    plan.status === 'failed' ? 'bg-error' : 'bg-primary'
                  }`}
                  style={{ width: `${plan.progress}%` }}
                />
              </div>
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                {Math.round(plan.progress)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
            {plan.startedAt && (
              <span>Started: {new Date(plan.startedAt).toLocaleString()}</span>
            )}
            {plan.completedAt && (
              <span>Completed: {new Date(plan.completedAt).toLocaleString()}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {(plan.status === 'draft' || plan.status === 'pending') && (
            <button
              onClick={onStart}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {plan.status === 'running' && (
            <button
              onClick={onPause}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-warning transition-colors"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {plan.status === 'paused' && (
            <button
              onClick={onResume}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {(plan.status === 'running' || plan.status === 'paused') && (
            <button
              onClick={onAbort}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
              title="Abort"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          )}
          {plan.checkpoint && (
            <button
              onClick={onRollback}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-warning transition-colors"
              title="Rollback to checkpoint"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Steps */}
      {isExpanded && (
        <div className="border-t border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 p-4">
          {loadingSteps ? (
            <p className="text-sm text-text-muted dark:text-dark-text-muted">Loading steps...</p>
          ) : steps.length === 0 ? (
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              No steps defined yet. Edit the plan to add steps.
            </p>
          ) : (
            <div className="space-y-2">
              {steps
                .sort((a, b) => a.orderNum - b.orderNum)
                .map((step) => {
                  const StatusIcon = stepStatusIcons[step.status];
                  const isActive = plan.currentStep === step.id;
                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-2 p-2 rounded ${
                        isActive ? 'bg-primary/10' : ''
                      }`}
                    >
                      <StatusIcon
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          step.status === 'completed'
                            ? 'text-success'
                            : step.status === 'failed'
                            ? 'text-error'
                            : step.status === 'in_progress'
                            ? 'text-primary animate-pulse'
                            : 'text-text-muted dark:text-dark-text-muted'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm ${
                              step.status === 'completed'
                                ? 'text-text-muted dark:text-dark-text-muted'
                                : 'text-text-primary dark:text-dark-text-primary'
                            }`}
                          >
                            {step.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
                            {stepTypeLabels[step.type]}
                          </span>
                        </div>
                        {step.description && (
                          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                            {step.description}
                          </p>
                        )}
                        {step.error && (
                          <p className="text-xs text-error mt-0.5">{step.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PlanModalProps {
  plan: Plan | null;
  onClose: () => void;
  onSave: () => void;
}

function PlanModal({ plan, onClose, onSave }: PlanModalProps) {
  const [title, setTitle] = useState(plan?.title ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
      };

      const url = plan ? `/api/v1/plans/${plan.id}` : '/api/v1/plans';
      const method = plan ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.success) {
        onSave();
      }
    } catch (err) {
      console.error('Failed to save plan:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {plan ? 'Edit Plan' : 'Create Plan'}
            </h3>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Plan title"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What should this plan accomplish?"
                rows={4}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              After creating the plan, you can add steps or ask the AI to decompose it automatically.
            </p>
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : plan ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

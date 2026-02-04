import { useState, useEffect, useCallback } from 'react';
import { plansApi, apiClient } from '../api';
import type { Plan, PlanStep, PlanEventType, PlanHistoryEntry } from '../api';
import {
  ListChecks,
  Plus,
  Trash2,
  Play,
  Pause,
  StopCircle,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  History,
  Copy,
  Code,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { useModalClose } from '../hooks';

const statusColors: Record<Plan['status'], string> = {
  pending: 'bg-warning/10 text-warning',
  running: 'bg-primary/10 text-primary',
  paused: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  cancelled: 'bg-text-muted/10 text-text-muted',
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

const stepStatusIcons: Record<PlanStep['status'], typeof Circle> = {
  pending: Circle,
  running: Clock,
  completed: CheckCircle2,
  failed: AlertTriangle,
  skipped: Circle,
  blocked: AlertTriangle,
  waiting: Clock,
};

export function PlansPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Plan['status'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [historyPlanId, setHistoryPlanId] = useState<string | null>(null);
  const [planHistory, setPlanHistory] = useState<PlanHistoryEntry[]>([]);

  const fetchPlanHistory = async (planId: string) => {
    try {
      const data = await plansApi.history(planId);
      setPlanHistory(data.history);
      setHistoryPlanId(planId);
    } catch {
      // API client handles error reporting
    }
  };

  const fetchPlans = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const data = await plansApi.list(params);
      setPlans(data.plans as Plan[]);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  const hasRunningPlans = plans.some((p) => p.status === 'running');

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // Auto-refresh every 5 seconds while plans are running
  useEffect(() => {
    if (!hasRunningPlans) return;
    const interval = setInterval(fetchPlans, 5000);
    return () => clearInterval(interval);
  }, [hasRunningPlans, fetchPlans]);

  const handleDelete = async (planId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this plan?', variant: 'danger' })) return;

    try {
      await plansApi.delete(planId);
      toast.success('Plan deleted');
      fetchPlans();
    } catch {
      // API client handles error reporting
    }
  };

  const handleAction = async (planId: string, action: 'start' | 'pause' | 'resume' | 'abort') => {
    const actionLabels = { start: 'Plan started', pause: 'Plan paused', resume: 'Plan resumed', abort: 'Plan aborted' };
    try {
      // Backend uses /execute endpoint instead of /start
      const endpoint = action === 'start' ? 'execute' : action;
      await plansApi.action(planId, endpoint);
      toast.success(actionLabels[action]);
      fetchPlans();
    } catch {
      // API client handles error reporting
    }
  };

  const handleRollback = async (planId: string) => {
    if (!await confirm({ message: 'Are you sure you want to rollback to the last checkpoint?', variant: 'danger' })) return;

    try {
      await plansApi.rollback(planId);
      toast.success('Rolled back to checkpoint');
      fetchPlans();
    } catch {
      // API client handles error reporting
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
        {(['all', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const).map(
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
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading plans..." />
        ) : plans.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No plans yet"
            description="Plans let the AI execute multi-step workflows autonomously."
            action={{ label: 'Create Plan', onClick: () => setShowCreateModal(true), icon: Plus }}
          />
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
                onViewHistory={() => fetchPlanHistory(plan.id)}
                onStepAdded={() => {
                  // Refresh the expanded steps
                  setExpandedPlan(null);
                  setTimeout(() => setExpandedPlan(plan.id), 100);
                  fetchPlans();
                }}
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

      {/* History Modal */}
      {historyPlanId && (
        <PlanHistoryModal
          history={planHistory}
          onClose={() => setHistoryPlanId(null)}
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
  onViewHistory: () => void;
  onStepAdded: () => void;
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
  onViewHistory,
  onStepAdded,
}: PlanItemProps) {
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isExpanded && steps.length === 0) {
      setLoadingSteps(true);
      plansApi.steps(plan.id)
        .then((data) => {
          if (!cancelled) setSteps(data.steps as PlanStep[]);
        })
        .catch(() => { /* API client handles error */ })
        .finally(() => { if (!cancelled) setLoadingSteps(false); });
    }
    return () => { cancelled = true; };
  }, [isExpanded, plan.id, steps.length]);

  // Refresh steps when plan is running
  useEffect(() => {
    if (plan.status === 'running' && isExpanded) {
      let cancelled = false;
      const interval = setInterval(() => {
        plansApi.steps(plan.id)
          .then((data) => {
            if (!cancelled) setSteps(data.steps as PlanStep[]);
          })
          .catch(() => { /* API client handles error */ });
      }, 2000);
      return () => { cancelled = true; clearInterval(interval); };
    }
  }, [plan.status, plan.id, isExpanded]);

  return (
    <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <button
          onClick={onToggle}
          className="mt-1 flex-shrink-0 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          aria-label={isExpanded ? 'Collapse plan steps' : 'Expand plan steps'}
        >
          <ChevronRight
            className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-text-primary dark:text-dark-text-primary">
              {plan.name}
            </span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[plan.status]}`}>
              {plan.status}
            </span>
          </div>

          {plan.goal && (
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
              {plan.goal}
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
                {plan.totalSteps > 0 && ` (${plan.totalSteps} steps)`}
              </span>
            </div>
          </div>

          {plan.status === 'failed' && plan.error && (
            <p className="mt-1 text-xs text-error">{plan.error}</p>
          )}

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
          <button
            onClick={onViewHistory}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            title="View history"
            aria-label="View plan history"
          >
            <History className="w-4 h-4" />
          </button>
          {plan.status === 'pending' && (
            <button
              onClick={onStart}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
              title="Start"
              aria-label="Start plan"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {plan.status === 'running' && (
            <button
              onClick={onPause}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-warning transition-colors"
              title="Pause"
              aria-label="Pause plan"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {plan.status === 'paused' && (
            <button
              onClick={onResume}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
              title="Resume"
              aria-label="Resume plan"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {(plan.status === 'running' || plan.status === 'paused') && (
            <button
              onClick={onAbort}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
              title="Abort"
              aria-label="Abort plan"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          )}
          {plan.checkpoint && (
            <button
              onClick={onRollback}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-warning transition-colors"
              title="Rollback to checkpoint"
              aria-label="Rollback to checkpoint"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
            aria-label="Delete plan"
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
              No steps defined yet.
            </p>
          ) : (
            <div className="space-y-2">
              {steps
                .sort((a, b) => a.orderNum - b.orderNum)
                .map((step) => (
                  <StepDebugItem key={step.id} step={step} isActive={plan.currentStep === step.orderNum || step.status === 'running'} />
                ))}
            </div>
          )}

          {/* Add Step */}
          {(plan.status === 'pending' || plan.status === 'paused') && (
            <div className="mt-3">
              {showAddStep ? (
                <AddStepForm
                  planId={plan.id}
                  nextOrder={steps.length}
                  onAdded={() => {
                    setShowAddStep(false);
                    setSteps([]);
                    onStepAdded();
                  }}
                  onCancel={() => setShowAddStep(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddStep(true)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Step
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step Debug Item (expandable per-step debug view)
// ============================================================================

interface StepDebugItemProps {
  step: PlanStep;
  isActive: boolean;
}

function StepDebugItem({ step, isActive }: StepDebugItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const StatusIcon = stepStatusIcons[step.status] || Circle;

  const statusColor =
    step.status === 'completed' ? 'text-success' :
    step.status === 'failed' ? 'text-error' :
    step.status === 'running' ? 'text-primary' :
    step.status === 'skipped' ? 'text-text-muted dark:text-dark-text-muted' :
    step.status === 'blocked' ? 'text-warning' :
    step.status === 'waiting' ? 'text-warning' :
    'text-text-muted dark:text-dark-text-muted';

  const borderColor =
    isActive ? 'border-primary/50' :
    step.status === 'failed' ? 'border-error/30' :
    step.status === 'completed' ? 'border-success/30' :
    'border-border dark:border-dark-border';

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatJson = (data: unknown): string => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const hasConfig = step.config && Object.keys(step.config).length > 0;
  const hasResult = step.result !== undefined && step.result !== null;
  const hasError = !!step.error;

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden bg-bg-secondary dark:bg-dark-bg-secondary`}>
      {/* Step Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50 transition-colors"
      >
        {/* Step number */}
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center text-xs font-mono text-text-muted dark:text-dark-text-muted">
          {step.orderNum + 1}
        </span>

        {/* Status icon */}
        <div className={`flex-shrink-0 ${statusColor}`}>
          <StatusIcon className={`w-4 h-4 ${step.status === 'running' ? 'animate-pulse' : ''}`} />
        </div>

        {/* Step info */}
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
              {step.name}
            </span>
            <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted rounded">
              {stepTypeLabels[step.type] || step.type}
            </span>
            {step.retryCount > 0 && (
              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-warning/10 text-warning rounded">
                retry {step.retryCount}/{step.maxRetries}
              </span>
            )}
          </div>
          {step.description && (
            <p className="text-xs text-text-muted dark:text-dark-text-muted truncate mt-0.5">
              {step.description}
            </p>
          )}
        </div>

        {/* Duration */}
        {step.durationMs !== undefined && (
          <span className="flex-shrink-0 text-xs text-text-muted dark:text-dark-text-muted font-mono">
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Expand arrow */}
        <div className="flex-shrink-0 text-text-muted dark:text-dark-text-muted">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded Debug Content */}
      {isExpanded && (
        <div className="border-t border-border dark:border-dark-border">
          {/* Timestamps */}
          <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted dark:text-dark-text-muted border-b border-border dark:border-dark-border bg-bg-tertiary/30 dark:bg-dark-bg-tertiary/30">
            <span>Status: <span className={`font-medium ${statusColor}`}>{step.status}</span></span>
            <span>Type: <span className="font-medium">{stepTypeLabels[step.type] || step.type}</span></span>
            {step.startedAt && <span>Started: {new Date(step.startedAt).toLocaleString()}</span>}
            {step.completedAt && <span>Completed: {new Date(step.completedAt).toLocaleString()}</span>}
            {step.durationMs !== undefined && <span>Duration: {step.durationMs}ms</span>}
            <span>Retries: {step.retryCount}/{step.maxRetries}</span>
            {step.dependencies.length > 0 && <span>Deps: {step.dependencies.join(', ')}</span>}
          </div>

          {/* Config */}
          {hasConfig && (
            <div className="px-3 py-2 border-b border-border dark:border-dark-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5" />
                  Configuration
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(formatJson(step.config), 'config'); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted dark:text-dark-text-muted hover:text-primary rounded transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {copiedField === 'config' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-text-primary dark:text-dark-text-primary">
                {formatJson(step.config)}
              </pre>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div className="px-3 py-2 border-b border-border dark:border-dark-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-error flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Error
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(step.error!, 'error'); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted dark:text-dark-text-muted hover:text-primary rounded transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {copiedField === 'error' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs font-mono bg-error/5 border border-error/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-error">
                {step.error}
              </pre>
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  Result
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(formatJson(step.result), 'result'); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted dark:text-dark-text-muted hover:text-primary rounded transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {copiedField === 'result' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-text-primary dark:text-dark-text-primary">
                {typeof step.result === 'string' ? step.result : formatJson(step.result)}
              </pre>
            </div>
          )}

          {/* No data message */}
          {!hasConfig && !hasResult && !hasError && step.status === 'pending' && (
            <div className="px-3 py-3 text-xs text-text-muted dark:text-dark-text-muted text-center">
              Step has not been executed yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Plan Modal (Create / Edit)
// ============================================================================

interface PlanModalProps {
  plan: Plan | null;
  onClose: () => void;
  onSave: () => void;
}

function PlanModal({ plan, onClose, onSave }: PlanModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const toast = useToast();
  const [name, setName] = useState(plan?.name ?? '');
  const [goal, setGoal] = useState(plan?.goal ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !goal.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        name: name.trim(),
        goal: goal.trim(),
        description: description.trim() || undefined,
      };

if (plan) {
        await apiClient.patch(`/plans/${plan.id}`, body);
        toast.success('Plan updated');
      } else {
        await apiClient.post('/plans', body);
        toast.success('Plan created');
      }
      onSave();
    } catch {
      // API client handles error reporting
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
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
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Plan name"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Goal
              </label>
              <input
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What should this plan achieve?"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional details about the plan"
                rows={3}
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
              disabled={!name.trim() || !goal.trim() || isSaving}
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

// ============================================================================
// Add Step Form (inline within expanded plan)
// ============================================================================

interface AddStepFormProps {
  planId: string;
  nextOrder: number;
  onAdded: () => void;
  onCancel: () => void;
}

function AddStepForm({ planId, nextOrder, onAdded, onCancel }: AddStepFormProps) {
  const toast = useToast();
  const [stepName, setStepName] = useState('');
  const [stepType, setStepType] = useState<PlanStep['type']>('tool_call');
  const [stepDescription, setStepDescription] = useState('');
  const [toolName, setToolName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAdd = async () => {
    if (!stepName.trim()) return;

    setIsSaving(true);
    try {
      const config: Record<string, unknown> = {};
      if (stepType === 'tool_call' && toolName.trim()) {
        config.toolName = toolName.trim();
      }
      if (stepType === 'llm_decision' && prompt.trim()) {
        config.prompt = prompt.trim();
      }
      if (stepType === 'user_input' && prompt.trim()) {
        config.question = prompt.trim();
      }

await plansApi.addStep(planId, {
          type: stepType,
          name: stepName.trim(),
          description: stepDescription.trim() || undefined,
          orderNum: nextOrder,
          config,
        });
      toast.success('Step added');
      onAdded();
    } catch {
      // API client handles error reporting
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={stepName}
          onChange={(e) => setStepName(e.target.value)}
          placeholder="Step name"
          className="flex-1 px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
          autoFocus
        />
        <select
          value={stepType}
          onChange={(e) => setStepType(e.target.value as PlanStep['type'])}
          className="px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="tool_call">Tool Call</option>
          <option value="llm_decision">AI Decision</option>
          <option value="user_input">User Input</option>
          <option value="condition">Condition</option>
          <option value="parallel">Parallel</option>
          <option value="loop">Loop</option>
        </select>
      </div>

      <input
        type="text"
        value={stepDescription}
        onChange={(e) => setStepDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
      />

      {stepType === 'tool_call' && (
        <input
          type="text"
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          placeholder="Tool name (e.g., search_memories)"
          className="w-full px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      )}

      {(stepType === 'llm_decision' || stepType === 'user_input') && (
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={stepType === 'llm_decision' ? 'AI prompt' : 'Question for user'}
          className="w-full px-2 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-xs text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!stepName.trim() || isSaving}
          className="px-3 py-1 text-xs bg-primary hover:bg-primary-dark text-white rounded disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Adding...' : 'Add Step'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Plan History Modal
// ============================================================================

const eventTypeColors: Record<PlanEventType, string> = {
  started: 'text-primary',
  step_started: 'text-primary',
  step_completed: 'text-success',
  step_failed: 'text-error',
  paused: 'text-warning',
  resumed: 'text-primary',
  completed: 'text-success',
  failed: 'text-error',
  cancelled: 'text-text-muted',
  checkpoint: 'text-warning',
  rollback: 'text-warning',
};

const eventTypeLabels: Record<PlanEventType, string> = {
  started: 'Started',
  step_started: 'Step Started',
  step_completed: 'Step Completed',
  step_failed: 'Step Failed',
  paused: 'Paused',
  resumed: 'Resumed',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  checkpoint: 'Checkpoint',
  rollback: 'Rollback',
};

interface PlanHistoryModalProps {
  history: PlanHistoryEntry[];
  onClose: () => void;
}

function PlanHistoryModal({ history, onClose }: PlanHistoryModalProps) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Plan History
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <p className="text-text-muted dark:text-dark-text-muted text-center">
              No history yet
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${eventTypeColors[entry.eventType]}`}>
                        {eventTypeLabels[entry.eventType]}
                      </span>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <pre className="mt-1 text-xs text-text-muted dark:text-dark-text-muted overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

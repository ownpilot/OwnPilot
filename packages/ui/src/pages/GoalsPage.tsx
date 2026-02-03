import { useState, useEffect, useCallback } from 'react';
import { goalsApi, apiClient } from '../api';
import { Target, Plus, Trash2, ChevronRight, CheckCircle2, Circle, AlertTriangle, Pause } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';

interface GoalStep {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  orderNum: number;
  dependencies?: string[];
  result?: string;
  createdAt: string;
  completedAt?: string;
}

interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  priority: number;
  parentId?: string;
  dueDate?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps?: GoalStep[];
}

const statusColors = {
  active: 'bg-primary/10 text-primary',
  paused: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  abandoned: 'bg-text-muted/10 text-text-muted',
};

const priorityLabels: Record<number, string> = {
  1: 'Very Low',
  2: 'Low',
  3: 'Low',
  4: 'Normal',
  5: 'Normal',
  6: 'Normal',
  7: 'High',
  8: 'High',
  9: 'Critical',
  10: 'Critical',
};

export function GoalsPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Goal['status'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const data = await goalsApi.list(params);
      setGoals(data.goals as Goal[]);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const handleDelete = async (goalId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this goal?', variant: 'danger' })) return;

    try {
      await goalsApi.delete(goalId);
      toast.success('Goal deleted');
      fetchGoals();
    } catch {
      // API client handles error reporting
    }
  };

  const handleStatusChange = async (goalId: string, status: Goal['status']) => {
    try {
      await goalsApi.update(goalId, { status });
      toast.success(`Goal ${status}`);
      fetchGoals();
    } catch {
      // API client handles error reporting
    }
  };

  const activeCount = goals.filter((g) => g.status === 'active').length;
  const completedCount = goals.filter((g) => g.status === 'completed').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Goals
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {activeCount} active, {completedCount} completed
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Goal
        </button>
      </header>

      {/* Filters */}
      <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border">
        {(['all', 'active', 'paused', 'completed', 'abandoned'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              statusFilter === status
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading goals..." />
        ) : goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Create goals to track what you want to achieve."
            action={{ label: 'Create Goal', onClick: () => setShowCreateModal(true), icon: Plus }}
          />
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => (
              <GoalItem
                key={goal.id}
                goal={goal}
                isExpanded={expandedGoal === goal.id}
                onToggle={() => setExpandedGoal(expandedGoal === goal.id ? null : goal.id)}
                onEdit={() => setEditingGoal(goal)}
                onDelete={() => handleDelete(goal.id)}
                onStatusChange={(status) => handleStatusChange(goal.id, status)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingGoal) && (
        <GoalModal
          goal={editingGoal}
          onClose={() => {
            setShowCreateModal(false);
            setEditingGoal(null);
          }}
          onSave={() => {
            toast.success(editingGoal ? 'Goal updated' : 'Goal created');
            setShowCreateModal(false);
            setEditingGoal(null);
            fetchGoals();
          }}
        />
      )}
    </div>
  );
}

interface GoalItemProps {
  goal: Goal;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: Goal['status']) => void;
}

function GoalItem({ goal, isExpanded, onToggle, onEdit, onDelete, onStatusChange }: GoalItemProps) {
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);

  useEffect(() => {
    if (isExpanded && steps.length === 0) {
      setLoadingSteps(true);
      goalsApi.steps(goal.id)
        .then((data) => {
          setSteps(data.steps as GoalStep[]);
        })
        .catch(() => { /* API client handles error */ })
        .finally(() => setLoadingSteps(false));
    }
  }, [isExpanded, goal.id, steps.length]);

  const handleStepStatusChange = async (stepId: string, status: GoalStep['status']) => {
    try {
      await goalsApi.updateStep(goal.id, stepId, { status });
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status } : s))
      );
    } catch {
      // API client handles error reporting
    }
  };

  return (
    <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg overflow-hidden">
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
              {goal.title}
            </span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[goal.status]}`}>
              {goal.status}
            </span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
              P{goal.priority}
            </span>
          </div>

          {goal.description && (
            <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2">
              {goal.description}
            </p>
          )}

          <div className="mt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                {Math.round(goal.progress)}%
              </span>
            </div>
          </div>

          {goal.dueDate && (
            <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted">
              Due: {new Date(goal.dueDate).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {goal.status === 'active' && (
            <button
              onClick={() => onStatusChange('completed')}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-success transition-colors"
              title="Mark complete"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          {goal.status === 'active' && (
            <button
              onClick={() => onStatusChange('paused')}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-warning transition-colors"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {goal.status === 'paused' && (
            <button
              onClick={() => onStatusChange('active')}
              className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
              title="Resume"
            >
              <Target className="w-4 h-4" />
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
              No steps defined. Ask the AI to decompose this goal.
            </p>
          ) : (
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      handleStepStatusChange(
                        step.id,
                        step.status === 'completed' ? 'pending' : 'completed'
                      )
                    }
                    className="flex-shrink-0"
                  >
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : step.status === 'blocked' ? (
                      <AlertTriangle className="w-4 h-4 text-warning" />
                    ) : (
                      <Circle className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                    )}
                  </button>
                  <span
                    className={`text-sm ${
                      step.status === 'completed'
                        ? 'text-text-muted dark:text-dark-text-muted line-through'
                        : 'text-text-primary dark:text-dark-text-primary'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface GoalModalProps {
  goal: Goal | null;
  onClose: () => void;
  onSave: () => void;
}

function GoalModal({ goal, onClose, onSave }: GoalModalProps) {
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [priority, setPriority] = useState(goal?.priority ?? 5);
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
      };

      if (goal) {
        await goalsApi.update(goal.id, body);
      } else {
        await apiClient.post('/goals', body);
      }
      onSave();
    } catch {
      // API client handles error reporting
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
              {goal ? 'Edit Goal' : 'Create Goal'}
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
                placeholder="What do you want to achieve?"
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
                placeholder="Add more details..."
                rows={3}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Priority ({priorityLabels[priority] || 'Normal'})
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
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
              {isSaving ? 'Saving...' : goal ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Plus, Trash2, Calendar } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { tasksApi } from '../api';
import type { Task } from '../types';

const priorityColors = {
  low: 'text-text-muted dark:text-dark-text-muted',
  normal: 'text-primary',
  high: 'text-warning',
  urgent: 'text-error',
};

const priorityBg = {
  low: 'bg-text-muted/10',
  normal: 'bg-primary/10',
  high: 'bg-warning/10',
  urgent: 'bg-error/10',
};

export function TasksPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await tasksApi.list(filter === 'pending' ? { status: ['pending', 'in_progress'] } : filter === 'completed' ? { status: ['completed'] } : undefined);
      setTasks(data);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleComplete = async (taskId: string) => {
    try {
      await tasksApi.complete(taskId);
      toast.success('Task completed');
      fetchTasks();
    } catch {
      // API client handles error reporting
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this task?', variant: 'danger' })) return;

    try {
      await tasksApi.delete(taskId);
      toast.success('Task deleted');
      fetchTasks();
    } catch {
      // API client handles error reporting
    }
  };

  const pendingCount = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Tasks
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {pendingCount} pending, {completedCount} completed
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Task
        </button>
      </header>

      {/* Filters */}
      <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border">
        {(['all', 'pending', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              filter === f
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading tasks..." />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={filter === 'all' ? 'No tasks yet' : `No ${filter} tasks`}
            description={filter === 'all' ? 'Create your first task to get started.' : filter === 'pending' ? "You're all caught up!" : 'Complete some tasks to see them here.'}
            action={filter === 'all' ? { label: 'Create Task', onClick: () => setShowCreateModal(true), icon: Plus } : undefined}
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onComplete={() => handleComplete(task.id)}
                onEdit={() => setEditingTask(task)}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingTask) && (
        <TaskModal
          task={editingTask}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTask(null);
          }}
          onSave={() => {
            toast.success(editingTask ? 'Task updated' : 'Task created');
            setShowCreateModal(false);
            setEditingTask(null);
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskItem({ task, onComplete, onEdit, onDelete }: TaskItemProps) {
  const isCompleted = task.status === 'completed';
  const isOverdue =
    task.dueDate &&
    !isCompleted &&
    new Date(task.dueDate) < new Date(new Date().toISOString().split('T')[0]!);

  return (
    <div
      className={`card-elevated card-hover flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg ${
        isCompleted ? 'opacity-60' : ''
      }`}
    >
      <button
        onClick={onComplete}
        className="mt-0.5 flex-shrink-0"
        disabled={isCompleted}
      >
        {isCompleted ? (
          <CheckCircle2 className="w-5 h-5 text-success" />
        ) : (
          <Circle className="w-5 h-5 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors" />
        )}
      </button>

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2">
          <span
            className={`font-medium text-text-primary dark:text-dark-text-primary ${
              isCompleted ? 'line-through' : ''
            }`}
          >
            {task.title}
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${priorityBg[task.priority]} ${priorityColors[task.priority]}`}
          >
            {task.priority}
          </span>
        </div>

        {task.description && (
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 line-clamp-2">
            {task.description}
          </p>
        )}

        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
          {task.dueDate && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-error' : ''}`}>
              {isOverdue ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <Calendar className="w-3 h-3" />
              )}
              {task.dueDate}
              {task.dueTime && ` ${task.dueTime}`}
            </span>
          )}
          {task.category && (
            <span className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded">
              {task.category}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  onSave: () => void;
}

function TaskModal({ task, onClose, onSave }: TaskModalProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'normal');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [category, setCategory] = useState(task?.category ?? '');
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
        dueTime: dueTime || undefined,
        category: category.trim() || undefined,
      };

      if (task) {
        await tasksApi.update(task.id, body);
      } else {
        await tasksApi.create(body);
      }
      onSave();
    } catch {
      // Task save failed — handled silently
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
              {task ? 'Edit Task' : 'Create Task'}
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
                placeholder="What needs to be done?"
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
                placeholder="Add details..."
                rows={3}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Task['priority'])}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g., Work, Personal"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Due Time
                </label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
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
              {isSaving ? 'Saving...' : task ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * CrewTaskQueue — displays the crew task queue with status filtering
 */

import { useState, useEffect, useCallback } from 'react';
import { crewsApi } from '../../../api/endpoints/souls';
import type { CrewTask } from '../../../api/endpoints/souls';
import { ListChecks, Clock, ChevronDown, ChevronRight, User, RefreshCw } from '../../../components/icons';
import { formatTimeAgo } from '../helpers';

interface Props {
  crewId: string;
}

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'failed';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

const STATUS_BADGE_COLORS: Record<CrewTask['status'], string> = {
  pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-500/10 text-green-600 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

const STATUS_LABELS: Record<CrewTask['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
};

const PRIORITY_BADGE_COLORS: Record<CrewTask['priority'], string> = {
  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  normal: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  low: 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
};

export function CrewTaskQueue({ crewId }: Props) {
  const [tasks, setTasks] = useState<CrewTask[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = filter === 'all' ? undefined : filter;
      const data = await crewsApi.getTasks(crewId, statusParam);
      setTasks(data.tasks);
      setTotal(data.total);
    } catch {
      setTasks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [crewId, filter]);

  // Fetch all tasks once to compute status counts
  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const data = await crewsApi.getTasks(crewId, undefined, 200, 0);
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const task of data.tasks) {
          counts[task.status] = (counts[task.status] || 0) + 1;
        }
        counts['all'] = data.total;
        setStatusCounts(counts);
      } catch {
        // ignore
      }
    }
    fetchCounts();
    return () => {
      cancelled = true;
    };
  }, [crewId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Task Queue
          </h4>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({total})
          </span>
        </div>
        <button
          onClick={fetchTasks}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
          title="Refresh tasks"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {STATUS_FILTERS.map(({ key, label }) => {
          const count = statusCounts[key] ?? 0;
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {label}
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-primary/20 text-primary'
                    : 'bg-bg-secondary dark:bg-dark-bg-secondary'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border dark:border-dark-border p-3 animate-pulse"
            >
              <div className="flex items-center gap-2">
                <div className="h-4 w-32 bg-bg-secondary dark:bg-dark-bg-secondary rounded" />
                <div className="h-4 w-16 bg-bg-secondary dark:bg-dark-bg-secondary rounded-full" />
                <div className="h-4 w-16 bg-bg-secondary dark:bg-dark-bg-secondary rounded-full" />
              </div>
              <div className="mt-2 h-3 w-48 bg-bg-secondary dark:bg-dark-bg-secondary rounded" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-text-muted dark:text-dark-text-muted">
          <ListChecks className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm">No tasks in queue</p>
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="mt-1 text-xs text-primary hover:text-primary-dark transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const isExpanded = expandedTaskId === task.id;
            return (
              <div
                key={task.id}
                className="rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary overflow-hidden"
              >
                {/* Task row */}
                <button
                  onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                  className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-bg-secondary/50 dark:hover:bg-dark-bg-secondary/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-text-muted dark:text-dark-text-muted flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-text-muted dark:text-dark-text-muted flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                        {task.taskName}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${PRIORITY_BADGE_COLORS[task.priority]}`}
                      >
                        {task.priority}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE_COLORS[task.status]}`}
                      >
                        {STATUS_LABELS[task.status]}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 line-clamp-1">
                      {task.description}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted dark:text-dark-text-muted">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {task.createdBy}
                      </span>
                      {task.claimedBy && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          claimed: {task.claimedBy}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(task.createdAt)}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-border dark:border-dark-border space-y-2 text-xs">
                    <div>
                      <span className="font-medium text-text-primary dark:text-dark-text-primary">
                        Description
                      </span>
                      <p className="text-text-muted dark:text-dark-text-muted mt-0.5 whitespace-pre-wrap">
                        {task.description}
                      </p>
                    </div>
                    {task.context && (
                      <div>
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          Context
                        </span>
                        <p className="text-text-muted dark:text-dark-text-muted mt-0.5 whitespace-pre-wrap">
                          {task.context}
                        </p>
                      </div>
                    )}
                    {task.expectedOutput && (
                      <div>
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          Expected Output
                        </span>
                        <p className="text-text-muted dark:text-dark-text-muted mt-0.5 whitespace-pre-wrap">
                          {task.expectedOutput}
                        </p>
                      </div>
                    )}
                    {task.deadline && (
                      <div>
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          Deadline
                        </span>
                        <span className="ml-1.5 text-text-muted dark:text-dark-text-muted">
                          {new Date(task.deadline).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {(task.status === 'completed' || task.status === 'failed') && task.result && (
                      <div>
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          Result
                        </span>
                        <p
                          className={`mt-0.5 whitespace-pre-wrap ${
                            task.status === 'failed'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-text-muted dark:text-dark-text-muted'
                          }`}
                        >
                          {task.result}
                        </p>
                      </div>
                    )}
                    {task.completedAt && (
                      <div className="text-text-muted dark:text-dark-text-muted">
                        Completed {formatTimeAgo(task.completedAt)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

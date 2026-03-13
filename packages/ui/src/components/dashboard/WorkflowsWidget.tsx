/**
 * Workflows Widget - Shows recent workflow executions with status and duration
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
} from '../icons';
import { workflowsApi, type WorkflowLog } from '../../api';
import { Skeleton } from '../Skeleton';

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return CheckCircle2;
    case 'failed':
      return XCircle;
    case 'running':
      return RefreshCw;
    case 'cancelled':
      return XCircle;
    default:
      return Clock;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-success bg-success/10';
    case 'failed':
      return 'text-error bg-error/10';
    case 'running':
      return 'text-primary bg-primary/10';
    case 'cancelled':
      return 'text-warning bg-warning/10';
    default:
      return 'text-text-muted bg-text-muted/10 dark:text-dark-text-muted dark:bg-dark-text-muted/10';
  }
}

interface WorkflowsWidgetProps {
  limit?: number;
}

export function WorkflowsWidget({ limit = 6 }: WorkflowsWidgetProps) {
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const [workflowNames, setWorkflowNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await workflowsApi.recentLogs({ limit: String(limit) });
        setLogs(result.logs);

        // Fetch workflow names for each unique workflowId
        const workflowIds = [...new Set(result.logs.map((l) => l.workflowId).filter(Boolean))] as string[];
        const names: Record<string, string> = {};

        await Promise.all(
          workflowIds.map(async (id) => {
            try {
              const wf = await workflowsApi.get(id);
              names[id] = wf.name;
            } catch {
              names[id] = `Workflow ${id.slice(0, 8)}`;
            }
          })
        );

        setWorkflowNames(names);
      } catch {
        setError('Failed to load workflows');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [limit]);

  const completedCount = logs.filter((l) => l.status === 'completed').length;
  const failedCount = logs.filter((l) => l.status === 'failed').length;

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Workflows
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Workflows
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Workflows
          </h3>
        </div>
        <div className="text-center py-6">
          <GitBranch className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No workflow executions yet
          </p>
          <Link
            to="/workflows"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            Create one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Workflows
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({logs.length})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="w-3 h-3" />
            {completedCount}
          </span>
          <span className="flex items-center gap-1 text-error">
            <XCircle className="w-3 h-3" />
            {failedCount}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {logs.map((log) => {
          const StatusIcon = getStatusIcon(log.status);
          const statusColor = getStatusColor(log.status);

          return (
            <Link
              key={log.id}
              to={`/workflows/${log.workflowId}/logs/${log.id}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${statusColor}`}
              >
                <StatusIcon className={`w-4 h-4 ${log.status === 'running' ? 'animate-spin' : ''}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {log.workflowId ? (workflowNames[log.workflowId] || `Workflow ${log.workflowId.slice(0, 8)}`) : 'Unknown Workflow'}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                      log.status === 'completed'
                        ? 'bg-success/10 text-success'
                        : log.status === 'failed'
                          ? 'bg-error/10 text-error'
                          : log.status === 'running'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-warning/10 text-warning'
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span>
                    {new Date(log.startedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {log.durationMs && (
                <div className="text-xs text-text-muted dark:text-dark-text-muted">
                  {(log.durationMs / 1000).toFixed(1)}s
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
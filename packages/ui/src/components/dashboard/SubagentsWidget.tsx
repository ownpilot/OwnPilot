/**
 * Subagents Widget - Shows recent subagent sessions
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
} from '../icons';
import { subagentsApi, type SubagentHistoryView } from '../../api';
import { Skeleton } from '../Skeleton';

function getStateIcon(state: string) {
  switch (state) {
    case 'completed':
      return CheckCircle2;
    case 'failed':
    case 'timeout':
      return XCircle;
    case 'running':
      return RefreshCw;
    case 'cancelled':
      return XCircle;
    default:
      return Clock;
  }
}

function getStateColor(state: string): string {
  switch (state) {
    case 'completed':
      return 'text-success bg-success/10';
    case 'failed':
    case 'timeout':
      return 'text-error bg-error/10';
    case 'running':
      return 'text-primary bg-primary/10';
    case 'cancelled':
      return 'text-warning bg-warning/10';
    default:
      return 'text-text-muted bg-text-muted/10 dark:text-dark-text-muted dark:bg-dark-text-muted/10';
  }
}

interface SubagentsWidgetProps {
  limit?: number;
}

export function SubagentsWidget({ limit = 6 }: SubagentsWidgetProps) {
  const [sessions, setSessions] = useState<SubagentHistoryView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await subagentsApi.getHistory(undefined, limit, 0);
        setSessions(result.entries);
      } catch {
        setError('Failed to load subagents');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [limit]);

  const completedCount = sessions.filter((s) => s.state === 'completed').length;
  const failedCount = sessions.filter((s) => s.state === 'failed' || s.state === 'timeout').length;

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-cyan-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Subagents
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
          <Bot className="w-4 h-4 text-cyan-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Subagents
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-cyan-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Subagents
          </h3>
        </div>
        <div className="text-center py-6">
          <Bot className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No subagent sessions yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyan-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Subagents
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({sessions.length})
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
        {sessions.map((session) => {
          const StateIcon = getStateIcon(session.state);
          const stateColor = getStateColor(session.state);

          return (
            <Link
              key={session.id}
              to={`/subagents/${session.id}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${stateColor}`}
              >
                <StateIcon className={`w-4 h-4 ${session.state === 'running' ? 'animate-spin' : ''}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {session.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                      session.state === 'completed'
                        ? 'bg-success/10 text-success'
                        : session.state === 'failed' || session.state === 'timeout'
                          ? 'bg-error/10 text-error'
                          : session.state === 'running'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-warning/10 text-warning'
                    }`}
                  >
                    {session.state}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span className="truncate max-w-[200px]">{session.task}</span>
                </div>
              </div>

              <div className="flex flex-col items-end text-xs text-text-muted dark:text-dark-text-muted">
                {session.durationMs && (
                  <span>{(session.durationMs / 1000).toFixed(1)}s</span>
                )}
                {session.toolCallsUsed > 0 && (
                  <span>{session.toolCallsUsed} tools</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
/**
 * Heartbeat Logs Widget - Shows recent heartbeat executions
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Heart,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
} from '../icons';
import { heartbeatLogsApi, soulsApi, type HeartbeatLog } from '../../api';
import { Skeleton } from '../Skeleton';

interface HeartbeatLogsWidgetProps {
  limit?: number;
}

export function HeartbeatLogsWidget({ limit = 6 }: HeartbeatLogsWidgetProps) {
  const [logs, setLogs] = useState<HeartbeatLog[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [agentEmojis, setAgentEmojis] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const [logsResult, soulsResult] = await Promise.all([
          heartbeatLogsApi.list(limit, 0),
          soulsApi.list(),
        ]);

        setLogs(logsResult.items);

        // Build agent name/emoji map
        const names: Record<string, string> = {};
        const emojis: Record<string, string> = {};
        for (const soul of soulsResult.items) {
          names[soul.agentId] = soul.identity.name;
          emojis[soul.agentId] = soul.identity.emoji || '🤖';
        }
        setAgentNames(names);
        setAgentEmojis(emojis);
      } catch {
        setError('Failed to load heartbeat logs');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [limit]);

  const successCount = logs.filter((l) => l.tasksFailed.length === 0 && l.tasksRun.length > 0).length;
  const failedCount = logs.filter((l) => l.tasksFailed.length > 0).length;
  const totalCost = logs.reduce((sum, l) => sum + l.cost, 0);

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Heart className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Heartbeat Logs
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
          <Heart className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Heartbeat Logs
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
          <Heart className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Heartbeat Logs
          </h3>
        </div>
        <div className="text-center py-6">
          <Heart className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No heartbeats yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Heartbeat Logs
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({logs.length})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <CheckCircle2 className="w-3 h-3" />
            {successCount}
          </span>
          <span className="flex items-center gap-1 text-error">
            <XCircle className="w-3 h-3" />
            {failedCount}
          </span>
          <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
            <Zap className="w-3 h-3" />
            ${totalCost.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {logs.map((log) => {
          const hasError = log.tasksFailed.length > 0;
          const agentName = agentNames[log.agentId] || `Agent ${log.agentId.slice(0, 8)}`;
          const agentEmoji = agentEmojis[log.agentId] || '🤖';

          return (
            <Link
              key={log.id}
              to={`/autonomous?agent=${log.agentId}&tab=logs`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  hasError ? 'bg-error/10' : 'bg-success/10'
                }`}
              >
                {hasError ? (
                  <XCircle className="w-4 h-4 text-error" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {agentEmoji} {agentName}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      hasError
                        ? 'bg-error/10 text-error'
                        : 'bg-success/10 text-success'
                    }`}
                  >
                    {hasError ? 'Failed' : 'Success'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span>
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <span>•</span>
                  <span>{log.tasksRun.length} tasks</span>
                  {log.tasksFailed.length > 0 && (
                    <>
                      <span className="text-error">{log.tasksFailed.length} failed</span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-xs text-text-muted dark:text-dark-text-muted">
                {(log.durationMs / 1000).toFixed(1)}s
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
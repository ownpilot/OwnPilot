/**
 * Agentic Executions Widget — shows recent autonomous task executions on the dashboard
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Play, Loader2, CheckCircle2, X, Clock, DollarSign } from '../icons';
import { agenticApi, type AgenticExecution } from '../../api/endpoints/agentic';
import { Skeleton } from '../Skeleton';

export function AgenticExecutionsWidget() {
  const [executions, setExecutions] = useState<AgenticExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        setError(null);
        const data = await agenticApi.list(5, 0);
        setExecutions(data.executions);
        setTotal(data.total);
      } catch {
        setError('Could not load');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, []);

  return (
    <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border p-4">
      <div className="flex items-center justify-between mb-3">
        <Link to="/agentic" className="flex items-center gap-2 text-text-primary dark:text-dark-text-primary hover:text-purple-500 transition-colors">
          <div className="p-1.5 bg-purple-500/10 rounded-lg"><Brain className="w-4 h-4 text-purple-500" /></div>
          <span className="font-semibold text-sm">Agentic Tasks</span>
        </Link>
        <Link to="/agentic" className="text-xs text-purple-500 hover:text-purple-400 transition-colors">
          {total > 0 ? `View all (${total})` : 'Open'}
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
      ) : error ? (
        <div className="text-xs text-text-muted dark:text-dark-text-muted text-center py-4">{error}</div>
      ) : executions.length === 0 ? (
        <div className="text-xs text-text-muted dark:text-dark-text-muted text-center py-4">
          No executions yet — run a task via the Agentic Center
        </div>
      ) : (
        <div className="space-y-1.5">
          {executions.map((e) => {
            const isRunning = e.status === 'running' || e.status === 'pending';
            const isFailed = e.status === 'failed';
            const isCompleted = e.status === 'completed';
            const Icon = isRunning ? Loader2 : isCompleted ? CheckCircle2 : isFailed ? X : Clock;
            const color = isRunning ? 'text-blue-500' : isCompleted ? 'text-green-500' : isFailed ? 'text-red-500' : 'text-gray-400';
            const dur = e.totalDurationMs >= 1000 ? `${(e.totalDurationMs / 1000).toFixed(1)}s` : `${e.totalDurationMs}ms`;

            return (
              <Link
                key={e.id}
                to={`/agentic`}
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${color} ${isRunning ? 'animate-spin' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">{e.taskName}</div>
                  <div className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                    {e.completedSteps}/{e.stepCount} steps · ${e.totalCostUsd.toFixed(4)} · {dur}
                  </div>
                </div>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  e.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                  e.status === 'running' ? 'bg-blue-900/30 text-blue-400' :
                  e.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {e.status === 'partially_completed' ? 'partial' : e.status}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

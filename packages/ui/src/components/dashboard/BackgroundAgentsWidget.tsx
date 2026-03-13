/**
 * Background Agents Widget - Shows running background agents with status, cycles, cost
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Play,
  Pause,
  Square,
  AlertCircle,
  Clock,
  DollarSign,
  RefreshCw,
} from '../icons';
import { backgroundAgentsApi, type BackgroundAgentConfig } from '../../api';
import { Skeleton } from '../Skeleton';

function getStateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'text-success';
    case 'paused':
    case 'waiting':
      return 'text-warning';
    case 'failed':
    case 'stopped':
      return 'text-error';
    default:
      return 'text-text-muted dark:text-dark-text-muted';
  }
}

function getStateIcon(state: string) {
  switch (state) {
    case 'running':
      return Play;
    case 'paused':
    case 'waiting':
      return Pause;
    case 'failed':
    case 'stopped':
      return Square;
    default:
      return Clock;
  }
}

interface BackgroundAgentsWidgetProps {
  limit?: number;
}

export function BackgroundAgentsWidget({ limit = 6 }: BackgroundAgentsWidgetProps) {
  const [agents, setAgents] = useState<BackgroundAgentConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await backgroundAgentsApi.list();
        setAgents(result);
      } catch {
        setError('Failed to load background agents');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const displayAgents = agents.slice(0, limit);

  const runningCount = agents.filter((a) => a.session?.state === 'running').length;
  const totalCost = agents.reduce((sum, a) => sum + (a.session?.totalCostUsd || 0), 0);

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Background Agents
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Background Agents
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displayAgents.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              Background Agents
            </h3>
          </div>
        </div>
        <div className="text-center py-6">
          <Bot className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No background agents
          </p>
          <Link
            to="/background-agents"
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
          <Bot className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Background Agents
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({agents.length})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <Play className="w-3 h-3" />
            {runningCount} running
          </span>
          <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
            <DollarSign className="w-3 h-3" />
            ${totalCost.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {displayAgents.map((agent) => {
          const state = agent.session?.state || 'stopped';
          const StateIcon = getStateIcon(state);

          return (
            <Link
              key={agent.id}
              to={`/background-agents?id=${agent.id}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  state === 'running'
                    ? 'bg-success/10'
                    : state === 'failed'
                      ? 'bg-error/10'
                      : 'bg-blue-500/10'
                }`}
              >
                <StateIcon className={`w-4 h-4 ${getStateColor(state)}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {agent.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      state === 'running'
                        ? 'bg-success/10 text-success'
                        : state === 'paused' || state === 'waiting'
                          ? 'bg-warning/10 text-warning'
                          : state === 'failed'
                            ? 'bg-error/10 text-error'
                            : 'bg-text-muted/10 text-text-muted dark:bg-dark-text-muted/10 dark:text-dark-text-muted'
                    }`}
                  >
                    {state}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span className="capitalize">{agent.mode}</span>
                  {agent.session && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        {agent.session.cyclesCompleted} cycles
                      </span>
                    </>
                  )}
                </div>
              </div>

              {agent.session?.lastCycleDurationMs && (
                <div className="text-xs text-text-muted dark:text-dark-text-muted">
                  {(agent.session.lastCycleDurationMs / 1000).toFixed(1)}s
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
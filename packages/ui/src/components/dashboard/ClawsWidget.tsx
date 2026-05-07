/**
 * Claws Widget - Shows active claws with status, cycles, cost
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Play, Pause, Square, AlertCircle, Clock, DollarSign, RefreshCw } from '../icons';
import { clawsApi, type ClawConfig, type ClawState } from '../../api';
import { Skeleton } from '../Skeleton';
import { useGateway } from '../../hooks/useWebSocket';

function getStateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'text-success';
    case 'paused':
    case 'waiting':
      return 'text-warning';
    case 'escalation_pending':
      return 'text-purple-500';
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
    case 'escalation_pending':
      return AlertCircle;
    case 'failed':
    case 'stopped':
      return Square;
    default:
      return Clock;
  }
}

interface ClawsWidgetProps {
  limit?: number;
}

export function ClawsWidget({ limit = 6 }: ClawsWidgetProps) {
  const [claws, setClaws] = useState<ClawConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useGateway();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const result = await clawsApi.list();
      setClaws(result.claws);
    } catch {
      setError('Failed to load claws');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live updates via WebSocket
  useEffect(() => {
    const unsubs = [
      subscribe<{
        clawId: string;
        state: ClawState;
        cyclesCompleted?: number;
        totalToolCalls?: number;
        totalCostUsd?: number;
        lastCycleAt?: string;
      }>('claw.update', (data) => {
        setClaws((prev) =>
          prev.map((c) => {
            if (c.id !== data.clawId) return c;
            return {
              ...c,
              session: c.session
                ? {
                    ...c.session,
                    state: data.state ?? c.session.state,
                    cyclesCompleted: data.cyclesCompleted ?? c.session.cyclesCompleted,
                    totalToolCalls: data.totalToolCalls ?? c.session.totalToolCalls,
                    totalCostUsd: data.totalCostUsd ?? c.session.totalCostUsd,
                    lastCycleAt: data.lastCycleAt ?? c.session.lastCycleAt,
                  }
                : null,
            };
          })
        );
      }),
      subscribe('claw.started', () => fetchData()),
      subscribe('claw.stopped', () => fetchData()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchData]);

  const displayClaws = claws.slice(0, limit);
  const runningCount = claws.filter(
    (c) => c.session?.state === 'running' || c.session?.state === 'starting'
  ).length;
  const escalationCount = claws.filter((c) => c.session?.state === 'escalation_pending').length;
  const totalCost = claws.reduce((sum, c) => sum + (c.session?.totalCostUsd || 0), 0);

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Claws
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
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Claws
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displayClaws.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              Claws
            </h3>
          </div>
        </div>
        <div className="text-center py-6">
          <Zap className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">No claws</p>
          <Link to="/claws" className="text-xs text-primary hover:underline mt-2 inline-block">
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
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Claws
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({claws.length})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <Play className="w-3 h-3" />
            {runningCount} running
          </span>
          {escalationCount > 0 && (
            <span className="flex items-center gap-1 text-purple-500">
              <AlertCircle className="w-3 h-3" />
              {escalationCount} pending
            </span>
          )}
          <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
            <DollarSign className="w-3 h-3" />${totalCost.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {displayClaws.map((claw) => {
          const state = claw.session?.state || 'stopped';
          const StateIcon = getStateIcon(state);

          return (
            <Link
              key={claw.id}
              to="/claws"
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  state === 'running'
                    ? 'bg-success/10'
                    : state === 'escalation_pending'
                      ? 'bg-purple-500/10'
                      : state === 'failed'
                        ? 'bg-error/10'
                        : 'bg-primary/10'
                }`}
              >
                <StateIcon className={`w-4 h-4 ${getStateColor(state)}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {claw.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      state === 'running'
                        ? 'bg-success/10 text-success'
                        : state === 'escalation_pending'
                          ? 'bg-purple-500/10 text-purple-500'
                          : state === 'paused' || state === 'waiting'
                            ? 'bg-warning/10 text-warning'
                            : state === 'failed'
                              ? 'bg-error/10 text-error'
                              : 'bg-text-muted/10 text-text-muted dark:bg-dark-text-muted/10 dark:text-dark-text-muted'
                    }`}
                  >
                    {state === 'escalation_pending' ? 'escalation' : state}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span>{claw.mode}</span>
                  {claw.depth > 0 && <span>depth {claw.depth}</span>}
                  {claw.session && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        {claw.session.cyclesCompleted} cycles
                      </span>
                    </>
                  )}
                </div>
              </div>

              {claw.session?.totalCostUsd ? (
                <div className="text-xs text-text-muted dark:text-dark-text-muted">
                  ${claw.session.totalCostUsd.toFixed(4)}
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

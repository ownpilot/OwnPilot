/**
 * Claws Widget - Shows active claws with status, cycles, cost
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap,
  Play,
  Pause,
  Square,
  AlertCircle,
  Clock,
  DollarSign,
  RefreshCw,
  Target,
  Brain,
} from '../icons';
import { clawsApi, type ClawConfig, type ClawState, type ClawTask } from '../../api';
import { Skeleton } from '../Skeleton';
import { useGateway } from '../../hooks/useWebSocket';

// Mirrors CLAW_TASK_STALL_THRESHOLD on the backend. Local copy so the widget
// can highlight stalled focus without an extra DTO field.
const WIDGET_STALL_THRESHOLD = 5;
// Mirrors CLAW_REFLECTION_THRESHOLD on the backend.
const WIDGET_REFLECTION_THRESHOLD = 2;

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

function RowPlanLine({ tasks }: { tasks: ClawTask[] }) {
  if (!tasks || tasks.length === 0) return null;
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const focus = tasks.find((t) => t.status === 'in_progress');
  const stalled = focus ? (focus.cyclesInProgress ?? 0) >= WIDGET_STALL_THRESHOLD : false;

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-text-muted dark:text-dark-text-muted">
        <div className="flex-1 h-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono shrink-0">
          {completed}/{total}
          {blocked > 0 && <span className="text-amber-500"> · {blocked}b</span>}
        </span>
      </div>
      {focus && (
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          <Target className={`w-3 h-3 shrink-0 ${stalled ? 'text-red-500' : 'text-blue-500'}`} />
          <span
            className={`truncate ${stalled ? 'text-red-500' : 'text-text-secondary dark:text-dark-text-secondary'}`}
            title={focus.title}
          >
            {focus.title}
          </span>
          {stalled && (
            <span className="text-[10px] text-red-500 shrink-0">
              ⚠ {focus.cyclesInProgress ?? 0}c
            </span>
          )}
        </div>
      )}
    </div>
  );
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

  // Live updates via WebSocket — note the WS server emits colon-separated
  // event names (`claw:update`, not `claw.update`). Earlier revisions used
  // dot-separated names which silently no-op'd because no broadcaster matches,
  // so the dashboard widget never got live state and only refreshed on
  // its own `fetchData()` call.
  useEffect(() => {
    const unsubs = [
      subscribe<{
        clawId: string;
        state: ClawState;
        cyclesCompleted?: number;
        totalToolCalls?: number;
        totalCostUsd?: number;
        lastCycleAt?: string;
      }>('claw:update', (data) => {
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
      subscribe('claw:started', () => fetchData()),
      subscribe('claw:stopped', () => fetchData()),
      // Plan mutations from either the agent or the operator REST path —
      // we refetch instead of trying to splice the partial event payload
      // into local state, mirroring how PlanTab/ClawManagementPanel handle it.
      subscribe('claw:plan:updated', () => fetchData()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchData]);

  // Priority ranking — lower scores bubble to the top. Operators don't have
  // to scroll to find the claws that actually need them.
  const attentionScore = (c: ClawConfig): number => {
    if (c.session?.state === 'escalation_pending') return 0;
    if ((c.session?.consecutiveErrors ?? 0) >= WIDGET_REFLECTION_THRESHOLD) return 1;
    if (c.session?.state === 'failed') return 2;
    const focus = c.session?.tasks?.find((t) => t.status === 'in_progress');
    if (focus && (focus.cyclesInProgress ?? 0) >= WIDGET_STALL_THRESHOLD) return 3;
    if (c.session?.state === 'running' || c.session?.state === 'starting') return 4;
    if (c.session?.state === 'waiting' || c.session?.state === 'paused') return 5;
    return 6;
  };
  const displayClaws = [...claws]
    .sort((a, b) => attentionScore(a) - attentionScore(b))
    .slice(0, limit);
  const runningCount = claws.filter(
    (c) => c.session?.state === 'running' || c.session?.state === 'starting'
  ).length;
  const escalationCount = claws.filter((c) => c.session?.state === 'escalation_pending').length;
  const reflectionCount = claws.filter(
    (c) => (c.session?.consecutiveErrors ?? 0) >= WIDGET_REFLECTION_THRESHOLD
  ).length;
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
          {reflectionCount > 0 && (
            <span
              className="flex items-center gap-1 text-purple-500"
              title="Claws with consecutive errors past the reflection threshold"
            >
              <Brain className="w-3 h-3" />
              {reflectionCount} reflect
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
          const consecutiveErrors = claw.session?.consecutiveErrors ?? 0;
          const reflectionPending = consecutiveErrors >= WIDGET_REFLECTION_THRESHOLD;
          const tasks = claw.session?.tasks ?? [];

          return (
            <Link
              key={claw.id}
              // Land directly on the Plan tab when the claw needs intervention
              // (reflection / stalled / failed / escalation) so the operator
              // sees the queue-intent + reset-failures + plan-edit controls
              // immediately. Otherwise default to overview.
              to={`/claws?claw=${encodeURIComponent(claw.id)}${
                attentionScore(claw) <= 3 ? '&tab=plan' : ''
              }`}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
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
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted flex-wrap">
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
                  {reflectionPending && (
                    <span
                      className="inline-flex items-center gap-1 text-purple-500"
                      title={`Reflection required after ${consecutiveErrors} consecutive errors`}
                    >
                      <Brain className="w-3 h-3" />
                      reflect
                    </span>
                  )}
                  {consecutiveErrors > 0 && !reflectionPending && (
                    <span
                      className="inline-flex items-center gap-1 text-amber-500"
                      title={`${consecutiveErrors} consecutive error(s)`}
                    >
                      ⚠ {consecutiveErrors}
                    </span>
                  )}
                </div>
                <RowPlanLine tasks={tasks} />
              </div>

              {claw.session?.totalCostUsd ? (
                <div className="text-xs text-text-muted dark:text-dark-text-muted shrink-0 pt-0.5">
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

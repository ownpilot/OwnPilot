import { useState, useEffect } from 'react';
import type { ClawConfig, ClawRunEval } from '../../../api/endpoints/claws';
import { clawsApi } from '../../../api/endpoints/claws';
import { ignoreError } from '../../../utils/ignore-error';
import {
  Terminal,
  TrendingUp,
  Zap,
  DollarSign,
  Activity,
  Terminal as TerminalIcon,
  ShieldAlert,
} from '../../../components/icons';
import { formatDuration, formatCost, timeAgo } from '../utils';

export function StatsTab({ claw }: { claw: ClawConfig }) {
  const session = claw.session;
  const [history, setHistory] = useState<
    Array<{
      cycleNumber: number;
      durationMs: number;
      costUsd?: number;
      success: boolean;
      error?: string;
    }>
  >([]);
  const [reliability, setReliability] = useState<ClawRunEval | null>(null);

  useEffect(() => {
    ignoreError(
      clawsApi.getHistory(claw.id, 20).then((r) => {
        setHistory(
          r.entries.map((e) => ({
            cycleNumber: e.cycleNumber,
            durationMs: e.durationMs,
            costUsd: e.costUsd,
            success: e.success,
            error: e.error,
          }))
        );
      }),
      'claw.statsTab'
    );
    ignoreError(clawsApi.evaluate(claw.id, 200).then(setReliability), 'claw.statsTab.eval');
  }, [claw.id]);

  const totalCost = session?.totalCostUsd ?? 0;
  const totalToolCalls = session?.totalToolCalls ?? 0;
  const cyclesDone = session?.cyclesCompleted ?? 0;
  const avgCostPerCycle = cyclesDone > 0 ? totalCost / cyclesDone : 0;
  const avgToolCallsPerCycle = cyclesDone > 0 ? totalToolCalls / cyclesDone : 0;

  const budgetUsedPct = claw.limits.totalBudgetUsd
    ? Math.min((totalCost / claw.limits.totalBudgetUsd) * 100, 100)
    : 0;

  const sessionDurationMs = session?.startedAt
    ? session.stoppedAt
      ? new Date(session.stoppedAt).getTime() - new Date(session.startedAt).getTime()
      : Date.now() - new Date(session.startedAt).getTime()
    : 0;

  const costPerHour = sessionDurationMs > 0 ? (totalCost / sessionDurationMs) * 3600 * 1000 : 0;

  const lastError = session?.lastCycleError;
  const isOrphan = lastError === 'orphan_recovery';

  return (
    <div className="space-y-4">
      {/* Reliability — objective score from run history. The headline is the
          repeated-failure list: the same tool failing the same way is wasted
          effort and the highest-leverage thing to fix. */}
      {reliability && reliability.reliabilityScore !== null && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Reliability
            </p>
            <span className="text-[10px] text-text-muted">
              over {reliability.sampleSize} cycle{reliability.sampleSize === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {(() => {
              const score = reliability.reliabilityScore ?? 0;
              const color = score >= 85 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
              return (
                <div className="shrink-0 text-center">
                  <p className="text-3xl font-bold font-mono leading-none" style={{ color }}>
                    {score}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">score</p>
                </div>
              );
            })()}
            <div className="flex-1 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-sm font-bold text-text-primary dark:text-dark-text-primary">
                  {Math.round(reliability.toolCalls.successRate * 100)}%
                </p>
                <p className="text-[10px] text-text-muted">tool success</p>
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary dark:text-dark-text-primary">
                  {Math.round(reliability.cycles.successRate * 100)}%
                </p>
                <p className="text-[10px] text-text-muted">cycle success</p>
              </div>
              <div>
                <p
                  className={`text-sm font-bold ${reliability.efficiency.wastedCalls > 0 ? 'text-rose-500' : 'text-text-primary dark:text-dark-text-primary'}`}
                >
                  {reliability.efficiency.wastedCalls}
                </p>
                <p className="text-[10px] text-text-muted">wasted calls</p>
              </div>
            </div>
          </div>

          {reliability.repeatedFailures.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border dark:border-dark-border space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                <p className="text-[10px] uppercase tracking-wider text-rose-500">
                  Repeated failures (wasted retries)
                </p>
              </div>
              {reliability.repeatedFailures.slice(0, 4).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-rose-400 shrink-0">×{r.count}</span>
                  <span className="font-mono text-text-primary dark:text-dark-text-primary shrink-0">
                    {r.tool}
                  </span>
                  <span className="text-text-muted truncate">{r.signature}</span>
                  {r.lastSeen && (
                    <span
                      className="text-text-muted/70 shrink-0 ml-auto tabular-nums"
                      title={`Last seen ${new Date(r.lastSeen).toLocaleString()}`}
                    >
                      {timeAgo(r.lastSeen)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
          <Activity className="w-3.5 h-3.5 text-text-muted mb-1" />
          <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
            {cyclesDone}
          </p>
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">Cycles</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
          <TerminalIcon className="w-3.5 h-3.5 text-text-muted mb-1" />
          <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
            {totalToolCalls}
          </p>
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">Tool Calls</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
          <DollarSign className="w-3.5 h-3.5 text-text-muted mb-1" />
          <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
            {formatCost(totalCost)}
          </p>
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">Total Cost</p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
          <TrendingUp className="w-3.5 h-3.5 text-text-muted mb-1" />
          <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
            {avgToolCallsPerCycle.toFixed(1)}
          </p>
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">Calls/Cycle</p>
        </div>
      </div>

      {/* Cost bar + budget */}
      {claw.limits.totalBudgetUsd && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Budget
            </p>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {formatCost(totalCost)} / {formatCost(claw.limits.totalBudgetUsd)}
            </p>
          </div>
          <div className="w-full bg-[#1a1a1a] rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetUsedPct > 90 ? 'bg-red-500' : budgetUsedPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${budgetUsedPct}%` }}
            />
          </div>
          <p className="text-[10px] text-text-muted mt-1 text-right">
            {budgetUsedPct.toFixed(1)}% used
          </p>
        </div>
      )}

      {/* Cost per hour + avg cycle cost */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-text-muted dark:text-dark-text-muted">Cost / Hour</p>
          </div>
          <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
            {formatCost(costPerHour)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-green-500" />
            <p className="text-xs text-text-muted dark:text-dark-text-muted">Avg / Cycle</p>
          </div>
          <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
            {formatCost(avgCostPerCycle)}
          </p>
        </div>
      </div>

      {/* Cycle history: duration + cost sparklines + success ring. Two
          parallel strips so operators can spot a cycle that ran long AND
          cost a lot — usually the canary for a model getting stuck in a
          retry loop. */}
      {history.length > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border space-y-3">
          {(() => {
            const successCount = history.filter((h) => h.success && !h.error).length;
            const successPct = Math.round((successCount / history.length) * 100);
            const ringColor =
              successPct >= 90 ? '#22c55e' : successPct >= 70 ? '#f59e0b' : '#ef4444';
            const ringRadius = 18;
            const ringCirc = 2 * Math.PI * ringRadius;
            const ringDash = (successPct / 100) * ringCirc;
            const maxMs = Math.max(...history.map((x) => x.durationMs), 1);
            const costValues = history.map((x) => x.costUsd ?? 0);
            const maxCost = Math.max(...costValues, 0.0001);
            const hasCost = costValues.some((c) => c > 0);
            return (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                      Last {history.length} cycle{history.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-[10px] text-text-muted">
                      duration top · cost bottom · failures in red
                    </p>
                  </div>
                  <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                    <svg width="48" height="48" className="transform -rotate-90">
                      <circle
                        cx="24"
                        cy="24"
                        r={ringRadius}
                        fill="none"
                        stroke="#1a1a1a"
                        strokeWidth="4"
                      />
                      <circle
                        cx="24"
                        cy="24"
                        r={ringRadius}
                        fill="none"
                        stroke={ringColor}
                        strokeWidth="4"
                        strokeDasharray={`${ringDash} ${ringCirc}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span
                      className="absolute text-[10px] font-bold font-mono"
                      style={{ color: ringColor }}
                      title={`${successCount}/${history.length} cycles succeeded`}
                    >
                      {successPct}%
                    </span>
                  </div>
                </div>

                {/* Duration strip */}
                <div>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                    Duration
                  </p>
                  <div className="flex items-end gap-0.5 h-14">
                    {history.map((h, i) => {
                      const barHeight = Math.max((h.durationMs / maxMs) * 56, 2);
                      const color = h.error || !h.success ? 'bg-red-400' : 'bg-green-400';
                      return (
                        <div
                          key={i}
                          className="flex-1 group relative"
                          title={`Cycle ${h.cycleNumber}: ${formatDuration(h.durationMs)}${h.costUsd != null ? ` · ${formatCost(h.costUsd)}` : ''}${h.error ? ` · ${h.error}` : ''}`}
                        >
                          <div
                            className={`w-full rounded-sm ${color} opacity-80 group-hover:opacity-100 transition-opacity`}
                            style={{ height: `${barHeight}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cost strip — only render when at least one cycle had cost
                    data; otherwise the strip is misleading flat bars. */}
                {hasCost && (
                  <div>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                      Cost
                    </p>
                    <div className="flex items-end gap-0.5 h-10">
                      {history.map((h, i) => {
                        const cost = h.costUsd ?? 0;
                        const barHeight = cost > 0 ? Math.max((cost / maxCost) * 40, 2) : 1;
                        const tone =
                          cost > maxCost * 0.66
                            ? 'bg-amber-400'
                            : cost > 0
                              ? 'bg-emerald-400'
                              : 'bg-gray-700';
                        return (
                          <div
                            key={i}
                            className="flex-1 group relative"
                            title={`Cycle ${h.cycleNumber}: ${formatCost(cost)}`}
                          >
                            <div
                              className={`w-full rounded-sm ${tone} opacity-80 group-hover:opacity-100 transition-opacity`}
                              style={{ height: `${barHeight}px` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-between text-[10px] text-text-muted font-mono">
                  <span>#{history[0]?.cycleNumber}</span>
                  <span>#{history[history.length - 1]?.cycleNumber}</span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Limits */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
          Limits
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-xs">
          {[
            { label: 'Max Turns/Cycle', value: claw.limits.maxTurnsPerCycle },
            { label: 'Max Tool Calls/Cycle', value: claw.limits.maxToolCallsPerCycle },
            { label: 'Max Cycles/Hour', value: claw.limits.maxCyclesPerHour },
            { label: 'Cycle Timeout', value: formatDuration(claw.limits.cycleTimeoutMs) },
            {
              label: 'Total Budget',
              value: claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'none',
            },
          ].map((l) => (
            <div
              key={l.label}
              className="flex justify-between p-1.5 bg-bg-primary dark:bg-dark-bg-primary rounded"
            >
              <span className="text-text-muted">{l.label}</span>
              <span className="font-mono font-medium text-text-primary dark:text-dark-text-primary">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Session timeline */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
          Session Timeline
        </p>
        <div className="space-y-1.5 text-xs">
          {(
            [
              {
                label: 'State',
                value: session?.state ?? 'none',
                color: session?.state === 'running' ? 'text-green-500' : 'text-text-muted',
              },
              { label: 'Started', value: session?.startedAt ? timeAgo(session.startedAt) : '-' },
              {
                label: 'Last Cycle',
                value: session?.lastCycleAt ? timeAgo(session.lastCycleAt) : '-',
              },
              { label: 'Stopped', value: session?.stoppedAt ? timeAgo(session.stoppedAt) : '-' },
              {
                label: 'Duration',
                value: session?.startedAt ? formatDuration(sessionDurationMs) : '-',
              },
              {
                label: 'Last Duration',
                value: session?.lastCycleDurationMs
                  ? formatDuration(session.lastCycleDurationMs)
                  : '-',
              },
            ] as Array<{ label: string; value: string; color?: string }>
          ).map((l) => (
            <div
              key={l.label}
              className="flex justify-between py-1 border-b border-border dark:border-dark-border last:border-0"
            >
              <span className="text-text-muted">{l.label}</span>
              <span
                className={`font-medium ${l.color ?? 'text-text-primary dark:text-dark-text-primary'}`}
              >
                {l.value}
              </span>
            </div>
          ))}
          {isOrphan && (
            <div className="flex items-center gap-1.5 pt-1 text-red-500">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-xs">Orphan recovery — claw was interrupted by crash</span>
            </div>
          )}
        </div>
      </div>

      {/* Stop condition */}
      {claw.stopCondition && (
        <div className="flex items-center gap-2 p-2 rounded bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-xs text-text-muted shrink-0">Stop:</span>
          <code className="text-xs font-mono text-cyan-400 bg-cyan-500/5 px-1.5 py-0.5 rounded flex-1">
            {claw.stopCondition}
          </code>
        </div>
      )}
    </div>
  );
}

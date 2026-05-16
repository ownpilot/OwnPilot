import { useState, useEffect } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { clawsApi } from '../../../api/endpoints/claws';
import { ignoreError } from '../../../utils/ignore-error';
import { Terminal } from '../../../components/icons';
import { formatDuration, formatCost, timeAgo } from '../utils';

export function StatsTab({ claw }: { claw: ClawConfig }) {
  const session = claw.session;
  const [stats, setStats] = useState<{
    totalCycles: number;
    totalCost: number;
    totalToolCalls: number;
    avgCycleMs: number;
  } | null>(null);

  useEffect(() => {
    ignoreError(
      clawsApi.getHistory(claw.id, 1, 0).then((r) => {
        const entries = r.entries;
        if (!entries.length) {
          setStats({ totalCycles: 0, totalCost: 0, totalToolCalls: 0, avgCycleMs: 0 });
          return;
        }
        setStats({
          totalCycles: session?.cyclesCompleted ?? 0,
          totalCost: session?.totalCostUsd ?? 0,
          totalToolCalls: session?.totalToolCalls ?? 0,
          avgCycleMs: session?.lastCycleDurationMs ?? 0,
        });
      }),
      'claw.detailTabs.getHistory'
    );
  }, [claw.id, session]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Runtime statistics and cost breakdown.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Total Cycles</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            {session?.cyclesCompleted ?? 0}
          </p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Total Cost</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            {formatCost(session?.totalCostUsd ?? 0)}
          </p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Tool Calls</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            {session?.totalToolCalls ?? 0}
          </p>
        </div>
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3">
          <p className="text-xs text-text-muted dark:text-dark-text-muted">Avg Cycle</p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            {formatDuration(session?.lastCycleDurationMs ?? 0)}
          </p>
        </div>
      </div>

      {/* Cost breakdown bar */}
      {stats && stats.totalCost > 0 && (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
            Cost Distribution
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-[#1a1a1a] rounded-full h-3 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '60%' }} />
            </div>
            <span className="text-xs font-mono text-green-400">{formatCost(stats.totalCost)}</span>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-text-muted">
            <span>
              Budget: {claw.limits.totalBudgetUsd ? `$${claw.limits.totalBudgetUsd}` : 'unlimited'}
            </span>
            <span>
              {(
                (stats.totalCost / Math.max(claw.limits.totalBudgetUsd ?? stats.totalCost, 0.01)) *
                100
              ).toFixed(1)}
              % used
            </span>
          </div>
        </div>
      )}

      {/* Limits config */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
          Limits
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
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

      {/* Session info */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mb-2">
          Session
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { label: 'State', value: session?.state ?? 'none' },
            { label: 'Started', value: session?.startedAt ? timeAgo(session.startedAt) : '-' },
            {
              label: 'Last Cycle',
              value: session?.lastCycleAt ? timeAgo(session.lastCycleAt) : '-',
            },
            { label: 'Stopped', value: session?.stoppedAt ? timeAgo(session.stoppedAt) : '-' },
          ].map((l) => (
            <div
              key={l.label}
              className="flex justify-between p-1.5 bg-bg-primary dark:bg-dark-bg-primary rounded"
            >
              <span className="text-text-muted">{l.label}</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stop condition */}
      {claw.stopCondition && (
        <div className="flex items-center gap-2 p-2 rounded bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-text-muted">Stop condition:</span>
          <code className="text-xs font-mono text-cyan-400 bg-cyan-500/5 px-1.5 py-0.5 rounded">
            {claw.stopCondition}
          </code>
        </div>
      )}
    </div>
  );
}

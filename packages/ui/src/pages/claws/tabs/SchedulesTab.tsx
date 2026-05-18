import { Clock, AlertTriangle, CheckCircle2, ExternalLink } from '../../../components/icons';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { labelClass as lbl } from '../utils';
import { formatDuration, timeAgo } from '../utils';

function calcNextRun(lastRun: string | null | undefined, intervalMs: number): string | null {
  if (!lastRun) return null;
  const next = new Date(lastRun).getTime() + intervalMs;
  return new Date(next).toISOString();
}

function ScheduleRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border dark:border-dark-border last:border-0">
      <span className="text-xs text-text-muted dark:text-dark-text-muted">{label}</span>
      <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary text-right">
        {value}
      </span>
    </div>
  );
}

export function SchedulesTab({ claw }: { claw: ClawConfig }) {
  const session = claw.session;
  const intervalMs = claw.intervalMs;
  const mode = claw.mode;

  const lastRun = session?.lastCycleAt ?? null;
  const nextRun = intervalMs ? calcNextRun(lastRun, intervalMs) : null;
  const isActive = session && ['running', 'starting', 'waiting'].includes(session.state);

  const overdueMs = nextRun ? Date.now() - new Date(nextRun).getTime() : 0;
  const isOverdue = overdueMs > 0 && isActive;

  // Missed runs: if interval is set but no cycle has run in 2x the interval
  const missedRuns =
    intervalMs && lastRun
      ? Math.floor((Date.now() - new Date(lastRun).getTime()) / intervalMs) - 1
      : 0;

  return (
    <div className="space-y-4">
      {/* Schedule mode badge */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <Clock className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
            {mode === 'interval'
              ? `Interval · every ${intervalMs ? Math.round(intervalMs / 1000) : 0}s`
              : mode === 'continuous'
                ? 'Continuous'
                : mode === 'event'
                  ? 'Event-driven'
                  : mode === 'single-shot'
                    ? 'Single-shot'
                    : mode}
          </span>
        </div>
        {claw.autoStart && (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-green-500/10 text-green-600">
            Auto-start
          </span>
        )}
        {isOverdue && (
          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-red-500/10 text-red-600">
            <AlertTriangle className="w-3 h-3" />
            Overdue
          </span>
        )}
        {missedRuns > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-amber-500/10 text-amber-600">
            <AlertTriangle className="w-3 h-3" />
            {missedRuns} missed
          </span>
        )}
      </div>

      {/* Next run prediction */}
      {mode === 'interval' && intervalMs ? (
        <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          <p className={lbl}>Schedule</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="flex flex-col items-center p-2 rounded bg-bg-primary dark:bg-dark-bg-primary">
              <p className="text-[10px] text-text-muted mb-1">Last run</p>
              <p className="text-sm font-bold text-text-primary dark:text-dark-text-primary">
                {lastRun ? timeAgo(lastRun) : 'Never'}
              </p>
              {session?.lastCycleDurationMs != null && (
                <p className="text-[10px] text-text-muted">
                  {formatDuration(session.lastCycleDurationMs)}
                </p>
              )}
            </div>
            <div className="flex flex-col items-center p-2 rounded bg-bg-primary dark:bg-dark-bg-primary relative">
              <p className="text-[10px] text-text-muted mb-1">Next run</p>
              <p
                className={`text-sm font-bold ${isOverdue ? 'text-red-500' : 'text-text-primary dark:text-dark-text-primary'}`}
              >
                {nextRun ? timeAgo(nextRun) : 'Unknown'}
              </p>
              {intervalMs && (
                <p className="text-[10px] text-text-muted">in ~{Math.round(intervalMs / 1000)}s</p>
              )}
              {isOverdue && (
                <div className="absolute -top-1 -right-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                </div>
              )}
            </div>
          </div>

          {/* Timeline visualization */}
          {lastRun && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted mb-1">
                <span>{timeAgo(lastRun)}</span>
                <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded relative overflow-hidden">
                  {/* Progress bar showing time since last run */}
                  <div
                    className={`absolute left-0 top-0 h-full rounded ${isOverdue ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{
                      width: `${Math.min(((Date.now() - new Date(lastRun).getTime()) / intervalMs) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span>+{Math.round(intervalMs / 1000)}s</span>
              </div>
              <p className="text-[10px] text-text-muted text-center">
                {isOverdue
                  ? `Overdue by ${formatDuration(overdueMs)}`
                  : `${Math.round(((Date.now() - new Date(lastRun).getTime()) / intervalMs) * 100)}% through interval`}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
          {isActive ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
                {mode === 'continuous'
                  ? 'Continuous mode — running continuously'
                  : mode === 'single-shot'
                    ? 'Single-shot mode — will run once when triggered'
                    : mode === 'event'
                      ? 'Event-driven — waiting for matching events'
                      : 'No schedule configured'}
              </p>
            </>
          ) : (
            <>
              <Clock className="w-4 h-4 text-text-muted shrink-0" />
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
                {session?.state === 'stopped'
                  ? 'Claw is stopped'
                  : session?.state === 'paused'
                    ? 'Claw is paused'
                    : 'No active session'}
              </p>
            </>
          )}
        </div>
      )}

      {/* Session lifecycle */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <p className={lbl}>Session Timeline</p>
        <div className="mt-2 space-y-0.5">
          <ScheduleRow
            label="State"
            value={
              <span
                className={
                  session?.state === 'running'
                    ? 'text-green-500'
                    : session?.state === 'paused'
                      ? 'text-amber-500'
                      : 'text-text-muted'
                }
              >
                {session?.state ?? 'stopped'}
              </span>
            }
          />
          <ScheduleRow
            label="Started"
            value={session?.startedAt ? timeAgo(session.startedAt) : '-'}
          />
          <ScheduleRow
            label="Stopped"
            value={session?.stoppedAt ? timeAgo(session.stoppedAt) : '-'}
          />
          <ScheduleRow label="Cycles" value={session?.cyclesCompleted ?? 0} />
          <ScheduleRow
            label="Interval"
            value={intervalMs ? `every ${Math.round(intervalMs / 1000)}s` : '-'}
          />
          <ScheduleRow
            label="Last cycle"
            value={
              session?.lastCycleAt
                ? `${timeAgo(session.lastCycleAt)} (${formatDuration(session.lastCycleDurationMs ?? 0)})`
                : '-'
            }
          />
          <ScheduleRow label="Last error" value={session?.lastCycleError ?? '-'} />
        </div>
      </div>

      {/* Missed runs warning */}
      {missedRuns > 3 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {missedRuns} missed runs detected
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
              This claw has an interval of {Math.round(intervalMs! / 1000)}s but no cycle has run in{' '}
              {timeAgo(lastRun!)}. The claw may be stuck, disabled, or the interval may have been
              changed recently.
            </p>
          </div>
        </div>
      )}

      {/* Interval misconfiguration nudge */}
      {mode === 'interval' && !intervalMs && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              No interval configured
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
              This claw is set to interval mode but has no intervalMs. Edit the config to add an
              interval.
            </p>
          </div>
        </div>
      )}

      {/* All claws schedule table (overview section) */}
      <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <div className="flex items-center justify-between mb-2">
          <p className={lbl}>All Claw Schedules</p>
          <a
            href="/api/v1/claws"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            API <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border dark:border-dark-border">
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">Name</th>
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">Mode</th>
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">Interval</th>
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">Last Run</th>
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">Next</th>
                <th className="text-left py-1.5 px-2 text-text-muted font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border dark:border-dark-border last:border-0">
                <td className="py-1.5 px-2 font-medium text-text-primary dark:text-dark-text-primary truncate max-w-[120px]">
                  {claw.name}
                </td>
                <td className="py-1.5 px-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-600">
                    {claw.mode}
                  </span>
                </td>
                <td className="py-1.5 px-2 font-mono text-text-secondary dark:text-dark-text-secondary">
                  {claw.intervalMs ? `${Math.round(claw.intervalMs / 1000)}s` : '-'}
                </td>
                <td className="py-1.5 px-2 text-text-muted">
                  {session?.lastCycleAt ? timeAgo(session.lastCycleAt) : 'Never'}
                </td>
                <td className="py-1.5 px-2">
                  {nextRun ? (
                    <span className={isOverdue ? 'text-red-500' : 'text-text-muted'}>
                      {isOverdue ? 'OVERDUE' : timeAgo(nextRun)}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="py-1.5 px-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      session?.state === 'running'
                        ? 'bg-green-500/10 text-green-600'
                        : session?.state === 'paused'
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-gray-500/10 text-gray-500'
                    }`}
                  >
                    {session?.state ?? 'stopped'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

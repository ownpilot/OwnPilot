import type { FleetConfig } from '../../api/endpoints/fleet';
import { Play, Pause, Square, Trash2, Clock, Plus, Send, Gauge } from '../../components/icons';
import {
  getStateBadge,
  getWorkerTypeIcon,
  getWorkerTypeLabel,
  getWorkerTypeColor,
  getScheduleLabel,
  formatCost,
} from './utils';

export function FleetCard({
  fleet,
  onAction,
  onSelect,
}: {
  fleet: FleetConfig;
  onAction: (action: string, fleet: FleetConfig) => void;
  onSelect: (fleet: FleetConfig) => void;
}) {
  const state = fleet.session?.state ?? null;
  const isRunning = state === 'running';
  const isPaused = state === 'paused';

  return (
    <div
      className="rounded-xl border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => onSelect(fleet)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {fleet.name}
            </h3>
            <p className="text-xs text-text-tertiary dark:text-dark-text-tertiary line-clamp-2 mt-0.5">
              {fleet.mission}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ml-2 flex-shrink-0 ${getStateBadge(state)}`}
          >
            {isRunning && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
              </span>
            )}
            {state ?? 'idle'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1 mb-3">
          {fleet.workers.map((w, idx) => {
            const Icon = getWorkerTypeIcon(w.type);
            const colorClass = getWorkerTypeColor(w.type);
            return (
              <span
                key={idx}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border ${colorClass}`}
                title={`${w.name} (${getWorkerTypeLabel(w.type)})`}
              >
                <Icon className="w-3 h-3" />
                {w.name}
              </span>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-xs text-text-tertiary dark:text-dark-text-tertiary mb-2">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {getScheduleLabel(fleet.scheduleType)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            {fleet.concurrencyLimit} max
          </span>
        </div>

        {fleet.session && (
          <div className="grid grid-cols-4 gap-1 text-center">
            <div>
              <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                {fleet.session.cyclesCompleted}
              </div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">
                cycles
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-success">{fleet.session.tasksCompleted}</div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">
                done
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-error">{fleet.session.tasksFailed}</div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">
                failed
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                {formatCost(fleet.session.totalCostUsd)}
              </div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">
                cost
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className="flex items-center border-t border-border dark:border-dark-border"
        onClick={(e) => e.stopPropagation()}
      >
        {!isRunning && !isPaused && (
          <button
            onClick={() => onAction('start', fleet)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-success hover:bg-success/5"
            title="Start"
          >
            <Play className="w-3.5 h-3.5" /> Start
          </button>
        )}
        {isRunning && (
          <>
            <button
              onClick={() => onAction('pause', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-warning hover:bg-warning/5"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
            <button
              onClick={() => onAction('stop', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button
              onClick={() => onAction('resume', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-success hover:bg-success/5"
              title="Resume"
            >
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
            <button
              onClick={() => onAction('stop', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          </>
        )}
        <button
          onClick={() => onAction('addTasks', fleet)}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-primary hover:bg-primary/5 border-l border-border dark:border-dark-border"
          title="Add Tasks"
        >
          <Plus className="w-3.5 h-3.5" /> Tasks
        </button>
        {isRunning && (
          <button
            onClick={() => onAction('broadcast', fleet)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-info hover:bg-info/5 border-l border-border dark:border-dark-border"
            title="Broadcast"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onAction('delete', fleet)}
          className="flex items-center justify-center py-2 px-3 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

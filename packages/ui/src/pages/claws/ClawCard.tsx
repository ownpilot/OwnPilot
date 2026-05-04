import type { ClawConfig } from '../../api/endpoints/claws';
import { Play, Pause, Square, Copy, Trash2 } from '../../components/icons';
import { getStateBadge, formatCost } from './utils';

export function ClawCard({
  claw,
  onStart,
  onPause,
  onResume,
  onStop,
  onDelete,
  onClone,
  onApproveEscalation,
  onDenyEscalation,
  onSelect,
  isSelected,
  isChecked,
  onToggleCheck,
}: {
  claw: ClawConfig;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDelete: () => void;
  onClone: () => void;
  onApproveEscalation: () => void;
  onDenyEscalation: () => void;
  isChecked?: boolean;
  onToggleCheck?: () => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const state = claw.session?.state ?? null;
  const badge = getStateBadge(state);
  const isRunning = state === 'running' || state === 'starting' || state === 'waiting';
  const isPaused = state === 'paused';
  const isEscalation = state === 'escalation_pending';
  const healthTone =
    claw.health?.status === 'healthy'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : claw.health?.status === 'idle'
        ? 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';

  return (
    <div
      onClick={onSelect}
      className={`bg-bg-primary dark:bg-dark-bg-primary border rounded-xl p-4 hover:shadow-sm transition-all cursor-pointer ${
        isSelected
          ? 'border-primary ring-1 ring-primary/30'
          : 'border-border dark:border-dark-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        {onToggleCheck && (
          <input
            type="checkbox"
            checked={isChecked ?? false}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCheck();
            }}
            className="w-3.5 h-3.5 rounded accent-primary mt-1 mr-2 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
            {claw.name}
          </h3>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {claw.mode} {claw.depth > 0 && `· depth ${claw.depth}`}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.classes}`}>
          {badge.text}
        </span>
      </div>

      {/* Mission */}
      <p className="text-xs text-text-secondary dark:text-dark-text-secondary line-clamp-2 mb-3">
        {claw.mission}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {claw.health && (
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${healthTone}`}
            title={claw.health.recommendations[0] ?? claw.health.signals[0]}
          >
            {claw.health.score} - {claw.health.status}
            {claw.health.contractScore < 60 ? ' · contract' : ''}
          </span>
        )}
        {claw.preset && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
            {claw.preset}
          </span>
        )}
      </div>

      {/* Stats */}
      {claw.session && (
        <div className="flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted mb-3">
          <span title="Cycles">{claw.session.cyclesCompleted} cycles</span>
          <span title="Tool calls">{claw.session.totalToolCalls} calls</span>
          <span title="Cost">{formatCost(claw.session.totalCostUsd)}</span>
        </div>
      )}

      {/* Escalation Banner */}
      {isEscalation && claw.session?.pendingEscalation && (
        <div className="mb-3 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">
            {claw.session.pendingEscalation.type}: {claw.session.pendingEscalation.reason}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApproveEscalation();
              }}
              className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDenyEscalation();
              }}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 pt-2 border-t border-border dark:border-dark-border">
        {!isRunning && !isPaused && !isEscalation && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
            title="Start"
          >
            <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          </button>
        )}
        {isRunning && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPause();
              }}
              className="p-1.5 rounded hover:bg-amber-500/10 transition-colors"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            </button>
          </>
        )}
        {isPaused && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
            className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
            title="Resume"
          >
            <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClone();
          }}
          className="p-1.5 rounded hover:bg-blue-500/10 transition-colors"
          title="Clone"
        >
          <Copy className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
        </button>
      </div>
    </div>
  );
}

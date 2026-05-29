/**
 * ClawListRow — compact one-line row for the Claws page list view.
 *
 * Trade-off vs ClawCard: less visual weight per claw, more density. Same
 * state-accent + focus + cycles/cost + inline lifecycle controls.
 * Live state dot mirrors the sidebar accordion tones so users learn one rule.
 */

import { Link } from 'react-router-dom';
import type { ClawConfig } from '../../api/endpoints/claws';
import {
  Play,
  Pause,
  Square,
  Copy,
  Trash2,
  Wrench,
  Target,
  AlertCircle,
} from '../../components/icons';
import { formatCost, timeAgo } from './utils';

// Mirrors backend thresholds.
const ROW_STALL_THRESHOLD = 5;
const ROW_REFLECT_THRESHOLD = 2;

function stateDotClass(claw: ClawConfig): string {
  const s = claw.session?.state;
  if (s === 'escalation_pending') return 'bg-purple-500 animate-pulse';
  if ((claw.session?.consecutiveErrors ?? 0) >= ROW_REFLECT_THRESHOLD)
    return 'bg-purple-500 animate-pulse';
  if (s === 'failed') return 'bg-amber-500';
  if (s === 'running' || s === 'starting') return 'bg-green-500';
  if (s === 'paused' || s === 'waiting') return 'bg-amber-500';
  return 'bg-gray-400 dark:bg-gray-600';
}

function stateLabel(claw: ClawConfig): string {
  const s = claw.session?.state ?? 'stopped';
  if (s === 'escalation_pending') return 'escalation';
  if ((claw.session?.consecutiveErrors ?? 0) >= ROW_REFLECT_THRESHOLD) return 'reflect';
  return s;
}

export function ClawListRow({
  claw,
  isChecked,
  onToggleCheck,
  onSelect,
  isSelected,
  onStart,
  onPause,
  onResume,
  onStop,
  onClone,
  onDoctor,
  onDelete,
  onApproveEscalation,
}: {
  claw: ClawConfig;
  isChecked: boolean;
  onToggleCheck?: () => void;
  onSelect: () => void;
  isSelected: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClone: () => void;
  onDoctor: () => void;
  onDelete: () => void;
  onApproveEscalation: () => void;
}) {
  const state = claw.session?.state ?? null;
  const isRunning = state === 'running' || state === 'starting' || state === 'waiting';
  const isPaused = state === 'paused';
  const isEscalation = state === 'escalation_pending';
  const tasks = claw.session?.tasks ?? [];
  const focus = tasks.find((t) => t.status === 'in_progress');
  const stalled = focus !== undefined && (focus.cyclesInProgress ?? 0) >= ROW_STALL_THRESHOLD;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  const planPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg border bg-bg-primary dark:bg-dark-bg-primary transition-all cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary ${
        isSelected
          ? 'border-primary ring-1 ring-primary/30'
          : isEscalation
            ? 'border-purple-500/30'
            : (claw.session?.consecutiveErrors ?? 0) >= ROW_REFLECT_THRESHOLD
              ? 'border-purple-500/30'
              : 'border-border dark:border-dark-border'
      }`}
    >
      {/* Checkbox */}
      {onToggleCheck && (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleCheck();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded accent-primary shrink-0"
        />
      )}

      {/* State dot */}
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${stateDotClass(claw)}`}
        title={stateLabel(claw)}
        aria-label={stateLabel(claw)}
      />

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
            {claw.name}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
            {claw.mode}
            {claw.depth > 0 && ` · d${claw.depth}`}
          </span>
          {claw.session?.nextIntent && (
            <span
              className={`text-[10px] px-1.5 rounded shrink-0 ${
                claw.session.nextIntent.startsWith('[OPERATOR] ')
                  ? 'bg-purple-500/15 text-purple-500'
                  : 'bg-blue-500/15 text-blue-500'
              }`}
              title={claw.session.nextIntent}
            >
              {claw.session.nextIntent.startsWith('[OPERATOR] ') ? '↳ op-queued' : '↻ next'}
            </span>
          )}
        </div>
        {focus && (
          <div className="flex items-center gap-1 text-[11px] min-w-0">
            <Target className={`w-3 h-3 shrink-0 ${stalled ? 'text-red-500' : 'text-blue-500'}`} />
            <span
              className={`truncate ${stalled ? 'text-red-500' : 'text-text-muted'}`}
              title={focus.title}
            >
              {focus.title}
            </span>
            {stalled && (
              <span className="text-[10px] text-red-500 shrink-0">⚠ {focus.cyclesInProgress}c</span>
            )}
          </div>
        )}
        {!focus && claw.session?.lastCycleAt && (
          <span className="text-[11px] text-text-muted">
            last cycle {timeAgo(claw.session.lastCycleAt)}
          </span>
        )}
      </div>

      {/* Stat mini-pills */}
      {claw.session && (
        <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px]">
          {totalTasks > 0 && (
            <span
              className="flex items-center gap-1.5"
              title={`${completedTasks} of ${totalTasks} tasks completed${blockedTasks > 0 ? `, ${blockedTasks} blocked` : ''}`}
            >
              <span className="w-14 h-1.5 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary overflow-hidden">
                <span
                  className={`block h-full rounded-full transition-all ${
                    blockedTasks > 0
                      ? 'bg-amber-500'
                      : planPct === 100
                        ? 'bg-emerald-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${planPct}%` }}
                />
              </span>
              <span className="font-mono text-text-muted tabular-nums">
                {completedTasks}/{totalTasks}
              </span>
            </span>
          )}
          <span
            className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono font-semibold"
            title={`${claw.session.cyclesCompleted} cycles`}
          >
            {claw.session.cyclesCompleted}c
          </span>
          {claw.session.consecutiveErrors >= ROW_REFLECT_THRESHOLD ? (
            <span
              className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 font-mono font-semibold"
              title={`${claw.session.consecutiveErrors} consecutive errors`}
            >
              ⚠ {claw.session.consecutiveErrors}
            </span>
          ) : (
            <span
              className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-mono font-semibold"
              title={`Total spend: ${formatCost(claw.session.totalCostUsd)}`}
            >
              {formatCost(claw.session.totalCostUsd)}
            </span>
          )}
        </div>
      )}

      {/* Inline lifecycle actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {isEscalation && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApproveEscalation();
            }}
            className="p-1.5 rounded hover:bg-purple-500/10 transition-colors"
            title="Approve escalation"
          >
            <AlertCircle className="w-3.5 h-3.5 text-purple-500" />
          </button>
        )}
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDoctor();
          }}
          className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Doctor"
        >
          <Wrench className="w-3.5 h-3.5 text-text-muted" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClone();
          }}
          className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Clone"
        >
          <Copy className="w-3.5 h-3.5 text-text-muted" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5 text-text-muted" />
        </button>
        <Link
          to={`/claws?claw=${encodeURIComponent(claw.id)}&tab=plan`}
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Open Plan tab"
        >
          <Target className="w-3.5 h-3.5 text-primary" />
        </Link>
      </div>
    </div>
  );
}

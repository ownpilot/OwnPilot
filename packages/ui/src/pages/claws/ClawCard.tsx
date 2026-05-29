import type { ClawConfig, ClawTask } from '../../api/endpoints/claws';
import { Play, Pause, Square, Copy, Trash2, Wrench, Target } from '../../components/icons';
import { getStateBadge, formatCost } from './utils';

// Mirrors CLAW_TASK_STALL_THRESHOLD on the backend. Kept local so the card
// can highlight stalled focus without an extra DTO field.
const CARD_STALL_THRESHOLD = 5;

function PlanSummary({ tasks }: { tasks: ClawTask[] }) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const focus = tasks.find((t) => t.status === 'in_progress');
  const stalled = focus ? (focus.cyclesInProgress ?? 0) >= CARD_STALL_THRESHOLD : false;

  return (
    <div className="mb-3 p-2 rounded-md bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
      <div className="flex items-center justify-between mb-1 text-[11px]">
        <span className="text-text-muted">Plan</span>
        <span className="font-mono text-text-secondary dark:text-dark-text-secondary">
          {completed}/{total}
          {blocked > 0 && <span className="text-amber-500"> · {blocked} blocked</span>}
        </span>
      </div>
      <div className="w-full bg-[#1a1a1a] rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {focus && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] min-w-0">
          <Target className={`w-3 h-3 shrink-0 ${stalled ? 'text-red-500' : 'text-blue-500'}`} />
          <span
            className={`truncate ${stalled ? 'text-red-500' : 'text-text-primary dark:text-dark-text-primary'}`}
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

export function ClawCard({
  claw,
  onStart,
  onPause,
  onResume,
  onStop,
  onDelete,
  onClone,
  onDoctor,
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
  onDoctor: () => void;
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
      className={`relative bg-bg-primary dark:bg-dark-bg-primary border rounded-xl p-4 pl-5 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden ${
        isSelected
          ? 'border-primary ring-1 ring-primary/30'
          : state === 'escalation_pending'
            ? 'border-purple-500/40 shadow-[0_0_0_1px_rgba(168,85,247,0.15)]'
            : (claw.session?.consecutiveErrors ?? 0) >= 2
              ? 'border-purple-500/30'
              : state === 'failed'
                ? 'border-amber-500/30'
                : 'border-border dark:border-dark-border'
      }`}
    >
      {/* Left-edge state accent — colored vertical bar that pulses on
          attention states. Makes the card grid scannable at a glance
          without reading the badge — operator's eye snaps to the bright
          colors first. */}
      <span
        className={`absolute left-0 top-0 bottom-0 w-1 ${
          state === 'escalation_pending'
            ? 'bg-purple-500 animate-pulse'
            : (claw.session?.consecutiveErrors ?? 0) >= 2
              ? 'bg-purple-500 animate-pulse'
              : isRunning
                ? 'bg-green-500'
                : isPaused
                  ? 'bg-amber-500'
                  : state === 'failed'
                    ? 'bg-amber-500'
                    : 'bg-transparent'
        }`}
        aria-hidden="true"
      />
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
            {claw.mode}
            {claw.intervalMs && ` · every ${Math.round(claw.intervalMs / 1000)}s`}
            {claw.depth > 0 && ` · depth ${claw.depth}`}
            {claw.preset && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-medium">
                {claw.preset}
              </span>
            )}
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
        {claw.skills && claw.skills.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-pink-500/10 text-pink-600 dark:text-pink-400">
            {claw.skills.length} skills
          </span>
        )}
        {claw.codingAgentProvider && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            {claw.codingAgentProvider}
          </span>
        )}
      </div>

      {/* Stats — three iconified mini-tiles. More visual weight than a
          plain text row, easier to scan at a distance. The failure tile
          replaces the cost tile when reflection is active so the most
          important number is biggest. */}
      {claw.session && (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <StatTile
            label="cycles"
            value={claw.session.cyclesCompleted}
            tone="blue"
            title={`${claw.session.cyclesCompleted} cycles completed`}
          />
          <StatTile
            label="calls"
            value={claw.session.totalToolCalls}
            tone="cyan"
            title={`${claw.session.totalToolCalls} tool calls`}
          />
          {claw.session.consecutiveErrors >= 2 ? (
            <StatTile
              label="errors"
              value={`⚠ ${claw.session.consecutiveErrors}`}
              tone="red"
              title={`${claw.session.consecutiveErrors} consecutive failed cycles`}
            />
          ) : (
            <StatTile
              label="cost"
              value={formatCost(claw.session.totalCostUsd)}
              tone="emerald"
              title={`Total spend: ${formatCost(claw.session.totalCostUsd)}`}
            />
          )}
        </div>
      )}

      {/* Plan progress + focus */}
      {claw.session && claw.session.tasks.length > 0 && <PlanSummary tasks={claw.session.tasks} />}

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
            onDoctor();
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-medium"
          title="Open Doctor"
        >
          <Wrench className="w-3.5 h-3.5" />
          Doctor
        </button>
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

/**
 * Compact stat tile used in the card stats row. Each tile is a one-glance
 * unit — colored top stripe + big tabular number + small label.
 */
function StatTile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  tone: 'blue' | 'cyan' | 'emerald' | 'red';
  title?: string;
}) {
  const toneCls: Record<typeof tone, string> = {
    blue: 'bg-blue-500/8 text-blue-500',
    cyan: 'bg-cyan-500/8 text-cyan-500',
    emerald: 'bg-emerald-500/8 text-emerald-500',
    red: 'bg-red-500/10 text-red-500',
  };
  return (
    <div
      title={title}
      className={`px-2 py-1.5 rounded-md flex flex-col items-center ${toneCls[tone]}`}
    >
      <span className="text-sm font-bold tabular-nums leading-tight">{value}</span>
      <span className="text-[9px] uppercase tracking-wider opacity-75 leading-tight">{label}</span>
    </div>
  );
}

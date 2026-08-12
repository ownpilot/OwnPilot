/**
 * The fleet-grid card for a single claw.
 *
 * Extracted from MissionControlPage.tsx (1109 LOC). Presentational plus local
 * intervene state (intent / message drafts); every mutation is delegated to a
 * callback so the page owns the API calls and the refresh.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import {
  Play,
  Pause,
  Square,
  Target,
  RefreshCw,
  Brain,
  Send,
  MessageSquare,
} from '../../components/icons';
import { clawsApi, type ClawConfig } from '../../api';
import { useToast } from '../../components/ToastProvider';
import { REFLECT_THRESHOLD, STALL_THRESHOLD } from './derive';

type InterveneMode = 'closed' | 'intent' | 'message';

export function ClawMissionCard({
  claw,
  busy,
  selectMode,
  selected,
  onToggleSelect,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
  onIntervened,
}: {
  claw: ClawConfig;
  busy: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
  onIntervened: () => void;
}) {
  const state = claw.session?.state ?? 'stopped';
  const isRunning = state === 'running' || state === 'starting' || state === 'waiting';
  const isPaused = state === 'paused';
  const focus = claw.session?.tasks?.find((t) => t.status === 'in_progress');
  const tasks = claw.session?.tasks ?? [];
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const consecErrors = claw.session?.consecutiveErrors ?? 0;
  const reflectionPending = consecErrors >= REFLECT_THRESHOLD;
  const stalled = focus !== undefined && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD;

  // Inline intervene panel — operator can queue a next-cycle directive or
  // drop a message into the inbox without leaving Mission Control. Only
  // surfaces on live claws (the API rejects intervene on stopped ones).
  const [intervene, setIntervene] = useState<InterveneMode>('closed');
  const [draft, setDraft] = useState('');
  const [interveneBusy, setInterveneBusy] = useState(false);
  const interveneAvailable = isRunning || isPaused || state === 'escalation_pending';
  const toast = useToast();

  const submitIntervene = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setInterveneBusy(true);
    try {
      if (intervene === 'intent') {
        await clawsApi.setNextIntent(claw.id, text);
        toast.success(`Queued [OPERATOR] directive for ${claw.name}`);
      } else if (intervene === 'message') {
        await clawsApi.sendMessage(claw.id, text);
        toast.success(`Sent inbox message to ${claw.name}`);
      }
      setIntervene('closed');
      setDraft('');
      onIntervened();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Intervene failed');
    } finally {
      setInterveneBusy(false);
    }
  };

  // Highlight border on attention-tier claws so the card visibly stands out
  // in the grid — the user sees the urgent cards at the top AND outlined.
  const borderCls =
    state === 'escalation_pending'
      ? 'border-purple-500/60'
      : reflectionPending
        ? 'border-purple-500/40'
        : stalled
          ? 'border-red-500/40'
          : state === 'failed'
            ? 'border-amber-500/40'
            : 'border-border dark:border-dark-border';

  return (
    <div
      className={`p-3 rounded-lg border ${borderCls} bg-bg-primary dark:bg-dark-bg-primary ${
        selected ? 'ring-2 ring-primary/40' : ''
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 accent-primary shrink-0"
            aria-label={`Select ${claw.name}`}
          />
        )}
        <Link
          to={`/claws?claw=${encodeURIComponent(claw.id)}&tab=plan`}
          className="flex-1 min-w-0 hover:underline"
        >
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
            {claw.name}
          </p>
          <p className="text-[11px] text-text-muted truncate">
            {claw.mode} · {claw.id}
          </p>
        </Link>
        <StatePill state={state} />
      </div>

      {/* Focus + progress */}
      {focus ? (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Target className={`w-3 h-3 shrink-0 ${stalled ? 'text-red-500' : 'text-blue-500'}`} />
            <span
              className={`truncate ${stalled ? 'text-red-500 font-medium' : 'text-text-secondary'}`}
              title={focus.title}
            >
              {focus.title}
            </span>
            {stalled && (
              <span className="text-[10px] text-red-500 shrink-0">⚠ {focus.cyclesInProgress}c</span>
            )}
          </div>
          {total > 0 && (
            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
              <div className="flex-1 h-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono shrink-0">
                {completed}/{total}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted mb-2 italic">No active focus.</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-text-muted mb-2">
        <span>cyc {claw.session?.cyclesCompleted ?? 0}</span>
        <span>${(claw.session?.totalCostUsd ?? 0).toFixed(4)}</span>
        {reflectionPending && (
          <span className="inline-flex items-center gap-0.5 text-purple-500 font-medium">
            <Brain className="w-3 h-3" />
            reflect ({consecErrors})
          </span>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1 pt-2 border-t border-border dark:border-dark-border">
        {!isRunning && !isPaused && state !== 'escalation_pending' && (
          <ActionBtn label="Start" Icon={Play} tone="green" onClick={onStart} disabled={busy} />
        )}
        {isRunning && (
          <>
            <ActionBtn label="Pause" Icon={Pause} tone="amber" onClick={onPause} disabled={busy} />
            <ActionBtn label="Stop" Icon={Square} tone="red" onClick={onStop} disabled={busy} />
          </>
        )}
        {isPaused && (
          <>
            <ActionBtn label="Resume" Icon={Play} tone="green" onClick={onResume} disabled={busy} />
            <ActionBtn label="Stop" Icon={Square} tone="red" onClick={onStop} disabled={busy} />
          </>
        )}
        {(reflectionPending || claw.session?.recentFailures?.length) && (
          <ActionBtn
            label="Reset"
            Icon={RefreshCw}
            tone="purple"
            onClick={onReset}
            disabled={busy}
          />
        )}
        {interveneAvailable && (
          <>
            <ActionBtn
              label="Queue next-cycle directive"
              Icon={Send}
              tone="purple"
              onClick={() => {
                setIntervene(intervene === 'intent' ? 'closed' : 'intent');
                setDraft('');
              }}
              disabled={busy || interveneBusy}
            />
            <ActionBtn
              label="Send inbox message"
              Icon={MessageSquare}
              tone="purple"
              onClick={() => {
                setIntervene(intervene === 'message' ? 'closed' : 'message');
                setDraft('');
              }}
              disabled={busy || interveneBusy}
            />
          </>
        )}
        <Link
          to={`/claws?claw=${encodeURIComponent(claw.id)}&tab=plan`}
          className="ml-auto p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          title="Open in Plan tab"
        >
          <Target className="w-3.5 h-3.5 text-text-muted" />
        </Link>
      </div>

      {/* Inline intervene panel — appears below action row when an
          intervene button is active. Two modes share the same form:
          intent posts to /next-intent (queued for next cycle, no
          interrupt); message posts to /message (lands in inbox). */}
      {intervene !== 'closed' && (
        <div className="mt-2 p-2 rounded border border-purple-500/30 bg-purple-500/5">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-purple-500 mb-1.5">
            {intervene === 'intent' ? '↳ Queue next-cycle directive' : '✉ Send inbox message'}
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              intervene === 'intent'
                ? 'e.g., Switch focus to fixing the failing browser_click selector first'
                : 'Message text — read at the next cycle'
            }
            className="w-full text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1.5 min-h-[48px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIntervene('closed');
                setDraft('');
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitIntervene();
              }
            }}
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-text-muted">
              {intervene === 'intent' ? 'no interrupt — runs next cycle' : 'lands in inbox'}
              {' · ⌘+Enter to submit'}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setIntervene('closed');
                  setDraft('');
                }}
                disabled={interveneBusy}
                className="px-2 py-1 text-[11px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitIntervene}
                disabled={interveneBusy || draft.trim().length === 0}
                className="px-2 py-1 text-[11px] rounded bg-purple-500 text-white hover:bg-purple-500/80 disabled:opacity-50"
              >
                {intervene === 'intent' ? 'Queue' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  Icon,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: 'green' | 'amber' | 'red' | 'purple';
  onClick: () => void;
  disabled: boolean;
}) {
  const cls =
    tone === 'green'
      ? 'hover:bg-green-500/10 text-green-600 dark:text-green-400'
      : tone === 'amber'
        ? 'hover:bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : tone === 'red'
          ? 'hover:bg-red-500/10 text-red-600 dark:text-red-400'
          : 'hover:bg-purple-500/10 text-purple-600 dark:text-purple-400';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors disabled:opacity-40 ${cls}`}
      title={label}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function StatePill({ state }: { state: string }) {
  const meta: Record<string, { label: string; cls: string }> = {
    running: { label: 'running', cls: 'bg-green-500/15 text-green-500' },
    starting: { label: 'starting', cls: 'bg-green-500/15 text-green-500' },
    waiting: { label: 'waiting', cls: 'bg-amber-500/15 text-amber-500' },
    paused: { label: 'paused', cls: 'bg-amber-500/15 text-amber-500' },
    failed: { label: 'failed', cls: 'bg-amber-500/15 text-amber-500' },
    stopped: { label: 'stopped', cls: 'bg-gray-500/15 text-gray-500' },
    completed: { label: 'done', cls: 'bg-blue-500/15 text-blue-500' },
    escalation_pending: {
      label: 'escalation',
      cls: 'bg-purple-500/15 text-purple-500 animate-pulse',
    },
  };
  const m = meta[state] ?? { label: state, cls: 'bg-gray-500/15 text-gray-500' };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${m.cls}`}>
      {m.label}
    </span>
  );
}

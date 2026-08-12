/**
 * Small presentational pieces of Mission Control.
 *
 * State pills, the fleet-summary chips, the empty hint, the escalation card and
 * one activity-feed row. Extracted from MissionControlPage.tsx — props in,
 * markup out.
 */

import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, X as XIcon, Zap } from '../../components/icons';
import type { ClawConfig, ClawPlanHistoryEntry } from '../../api';
import type { CodingAgentSession } from '../../api/endpoints/coding-agents';

export function CodingStatePill({ state }: { state: CodingAgentSession['state'] }) {
  const meta: Record<string, { label: string; cls: string }> = {
    running: { label: 'running', cls: 'bg-green-500/15 text-green-500' },
    starting: { label: 'starting', cls: 'bg-green-500/15 text-green-500' },
    waiting: { label: 'waiting', cls: 'bg-amber-500/15 text-amber-500' },
    completed: { label: 'done', cls: 'bg-blue-500/15 text-blue-500' },
    failed: { label: 'failed', cls: 'bg-amber-500/15 text-amber-500' },
    terminated: { label: 'killed', cls: 'bg-gray-500/15 text-gray-500' },
  };
  const m = meta[state] ?? { label: state, cls: 'bg-gray-500/15 text-gray-500' };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function FleetChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'purple' | 'red' | 'amber';
}) {
  if (count === 0) return null;
  const cls =
    tone === 'purple'
      ? 'bg-purple-500/15 text-purple-500 animate-pulse'
      : tone === 'red'
        ? 'bg-red-500/15 text-red-500 animate-pulse'
        : 'bg-amber-500/15 text-amber-500';
  return (
    <span className={`px-2 py-0.5 rounded-full font-semibold ${cls}`}>
      {count} {label}
    </span>
  );
}

export function EmptyHint() {
  return (
    <div className="p-6 text-center rounded-lg border border-dashed border-border dark:border-dark-border">
      <Zap className="w-10 h-10 text-text-muted mx-auto mb-2 opacity-40" />
      <p className="text-sm text-text-muted">No claws configured yet.</p>
      <Link to="/claws" className="text-xs text-primary hover:underline mt-2 inline-block">
        Create your first claw →
      </Link>
    </div>
  );
}

export function EscalationCard({
  claw,
  isDenying,
  denyReason,
  busy,
  onApprove,
  onStartDeny,
  onChangeDenyReason,
  onSubmitDeny,
  onCancelDeny,
}: {
  claw: ClawConfig;
  isDenying: boolean;
  denyReason: string;
  busy: boolean;
  onApprove: () => void;
  onStartDeny: () => void;
  onChangeDenyReason: (v: string) => void;
  onSubmitDeny: () => void;
  onCancelDeny: () => void;
}) {
  const esc = claw.session?.pendingEscalation;
  if (!esc) return null;
  return (
    <div className="p-2.5 rounded-md border border-purple-500/30 bg-purple-500/5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{claw.name}</p>
          <p className="text-[11px] text-purple-500 uppercase tracking-wider font-semibold">
            {esc.type}
          </p>
          <p className="text-xs text-text-secondary mt-1">{esc.reason}</p>
        </div>
        <AlertCircle className="w-4 h-4 text-purple-500 shrink-0" />
      </div>
      {!isDenying ? (
        <div className="flex items-center gap-1 mt-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="px-2 py-1 text-[11px] rounded bg-green-500 text-white hover:bg-green-500/80 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" />
            Approve
          </button>
          <button
            type="button"
            onClick={onStartDeny}
            disabled={busy}
            className="px-2 py-1 text-[11px] rounded border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-50 inline-flex items-center gap-1"
          >
            <XIcon className="w-3 h-3" />
            Deny
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <input
            type="text"
            value={denyReason}
            onChange={(e) => onChangeDenyReason(e.target.value)}
            placeholder="Reason (optional)…"
            className="w-full text-[11px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded p-1.5"
            autoFocus
          />
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={onCancelDeny}
              disabled={busy}
              className="px-2 py-1 text-[11px] rounded bg-bg-tertiary dark:bg-dark-bg-tertiary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmitDeny}
              disabled={busy}
              className="px-2 py-1 text-[11px] rounded bg-red-500 text-white hover:bg-red-500/80 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActivityRow({
  clawName,
  clawId,
  entry,
}: {
  clawName: string;
  clawId: string;
  entry: ClawPlanHistoryEntry;
}) {
  let label = '';
  if (entry.kind === 'replace') {
    label = `replaced plan (${entry.newTaskCount ?? 0} tasks)`;
  } else if (entry.kind === 'task_added') {
    label = `added task${entry.title ? `: ${entry.title.slice(0, 32)}` : ''}`;
  } else {
    label = `${entry.taskId ?? '?'} ${entry.prevStatus ?? '?'} → ${entry.newStatus ?? '?'}`;
  }
  const time = entry.at.slice(11, 19);
  return (
    <li className="text-[11px] flex items-start gap-1.5">
      <span className="text-text-muted font-mono shrink-0">{time}</span>
      <span
        className={`px-1 rounded font-semibold shrink-0 ${
          entry.actor === 'agent'
            ? 'bg-blue-500/15 text-blue-500'
            : 'bg-purple-500/15 text-purple-500'
        }`}
      >
        {entry.actor === 'agent' ? 'A' : 'O'}
      </span>
      <span className="text-text-muted truncate">
        <Link
          to={`/claws?claw=${encodeURIComponent(clawId)}&tab=plan`}
          className="text-text-primary dark:text-dark-text-primary hover:underline"
        >
          {clawName}
        </Link>{' '}
        {label}
      </span>
    </li>
  );
}

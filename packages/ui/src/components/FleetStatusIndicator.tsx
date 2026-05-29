/**
 * FleetStatusIndicator — global header chip that summarizes Claw runtime
 * attention across the whole fleet, on every page.
 *
 * Hidden when nothing needs the operator. When something does, shows a
 * pulsing chip with the total count. Click opens a dropdown listing each
 * claw that needs attention grouped by reason, with one-click jump
 * directly to that claw's Plan tab.
 *
 * Why in the global header: the per-page Claws attention strip and the
 * sidebar accordion badges both require the operator to be looking at
 * that surface. From any other page (chat, workflows, settings) attention
 * was invisible. This chip closes the gap.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap } from './icons';
import { clawsApi, type ClawConfig } from '../api';
import { useGateway } from '../hooks/useWebSocket';

// Mirrors backend thresholds — kept hardcoded in the small set of UI files
// that need them rather than piped through the DTO. If the backend
// constants move, search for these.
const REFLECT_THRESHOLD = 2;
const STALL_THRESHOLD = 5;

export type AttentionReason = 'escalation' | 'reflection' | 'stalled' | 'failed';

export interface AttentionBreakdown {
  escalation: number;
  reflection: number;
  stalled: number;
  failed: number;
  total: number;
}

export interface AttentionEntry {
  claw: ClawConfig;
  reason: AttentionReason;
  /** Short context for the row ("3 consecutive errors", "7 cycles stuck"). */
  detail: string;
}

/**
 * Pure breakdown of a claw list into the four attention dimensions. Exported
 * for unit tests — the component itself just wraps this with fetch + WS
 * subscribe + render.
 */
export function summarizeFleetAttention(claws: ClawConfig[]): AttentionBreakdown {
  let escalation = 0;
  let reflection = 0;
  let stalled = 0;
  let failed = 0;
  for (const c of claws) {
    if (!c.session) continue;
    const sess = c.session;
    if (sess.state === 'escalation_pending') {
      escalation += 1;
      continue;
    }
    if ((sess.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD) {
      reflection += 1;
      continue;
    }
    if (sess.state === 'failed') {
      failed += 1;
      continue;
    }
    const focus = sess.tasks?.find((t) => t.status === 'in_progress');
    if (focus && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD) {
      stalled += 1;
    }
  }
  return {
    escalation,
    reflection,
    stalled,
    failed,
    total: escalation + reflection + stalled + failed,
  };
}

/**
 * Classify each claw in the list to its attention reason (if any), preserving
 * the same priority order as summarizeFleetAttention so the dropdown ordering
 * matches the header count semantics. Exported for tests.
 */
export function listFleetAttention(claws: ClawConfig[]): AttentionEntry[] {
  const out: AttentionEntry[] = [];
  for (const c of claws) {
    if (!c.session) continue;
    const sess = c.session;
    if (sess.state === 'escalation_pending') {
      out.push({
        claw: c,
        reason: 'escalation',
        detail: sess.pendingEscalation?.reason
          ? sess.pendingEscalation.reason.slice(0, 60)
          : 'awaiting decision',
      });
      continue;
    }
    if ((sess.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD) {
      out.push({
        claw: c,
        reason: 'reflection',
        detail: `${sess.consecutiveErrors} consecutive errors`,
      });
      continue;
    }
    if (sess.state === 'failed') {
      out.push({
        claw: c,
        reason: 'failed',
        detail: sess.lastCycleError ? sess.lastCycleError.slice(0, 60) : 'terminal failure',
      });
      continue;
    }
    const focus = sess.tasks?.find((t) => t.status === 'in_progress');
    if (focus && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD) {
      out.push({
        claw: c,
        reason: 'stalled',
        detail: `${focus.cyclesInProgress}c on "${focus.title.slice(0, 32)}"`,
      });
    }
  }
  // Priority order: escalation > reflection > stalled > failed.
  const rank: Record<AttentionReason, number> = {
    escalation: 0,
    reflection: 1,
    stalled: 2,
    failed: 3,
  };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason]);
}

const REASON_LABEL: Record<AttentionReason, string> = {
  escalation: 'Escalation',
  reflection: 'Reflection required',
  stalled: 'Stalled',
  failed: 'Failed',
};

const REASON_TONE: Record<AttentionReason, string> = {
  escalation: 'bg-purple-500 animate-pulse',
  reflection: 'bg-purple-500 animate-pulse',
  stalled: 'bg-red-500 animate-pulse',
  failed: 'bg-amber-500',
};

export function FleetStatusIndicator() {
  const [breakdown, setBreakdown] = useState<AttentionBreakdown>({
    escalation: 0,
    reflection: 0,
    stalled: 0,
    failed: 0,
    total: 0,
  });
  const [entries, setEntries] = useState<AttentionEntry[]>([]);
  const [open, setOpen] = useState(false);
  const { subscribe } = useGateway();
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      // Pull the full set — 50 is enough; deeper fleets can still bubble
      // their first few attention items here and the actual Claws page
      // surfaces the rest. Cheaper than calling stats() AND list().
      const res = await clawsApi.list(50, 0);
      setBreakdown(summarizeFleetAttention(res.claws));
      setEntries(listFleetAttention(res.claws));
    } catch {
      // Silent — header indicator is non-critical; surface elsewhere.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Close the dropdown on outside-click. ESC handled via onKeyDown on the
  // wrapper button.
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Live updates on the same event set that drives the sidebar accordion
  // refetch.
  useEffect(() => {
    const unsubs = [
      subscribe('claw:update', () => refresh()),
      subscribe('claw:started', () => refresh()),
      subscribe('claw:stopped', () => refresh()),
      subscribe('claw:plan:updated', () => refresh()),
      subscribe('claw:escalation', () => refresh()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, refresh]);

  if (breakdown.total === 0) return null;

  const headlineTone =
    breakdown.escalation > 0 || breakdown.reflection > 0 || breakdown.stalled > 0
      ? 'urgent'
      : 'warn';

  // Build a stable tooltip so even users who never click the chip get a
  // breakdown on hover.
  const tooltipParts: string[] = [];
  if (breakdown.escalation > 0) tooltipParts.push(`${breakdown.escalation} escalation`);
  if (breakdown.reflection > 0) tooltipParts.push(`${breakdown.reflection} reflecting`);
  if (breakdown.stalled > 0) tooltipParts.push(`${breakdown.stalled} stalled`);
  if (breakdown.failed > 0) tooltipParts.push(`${breakdown.failed} failed`);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        title={`Fleet needs attention: ${tooltipParts.join(' · ')}`}
        data-testid="fleet-status-indicator"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold transition-colors shrink-0 ${
          headlineTone === 'urgent'
            ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25 animate-pulse'
            : 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25'
        }`}
      >
        <Zap className="w-3 h-3" />
        <span>{breakdown.total}</span>
        {breakdown.escalation > 0 && <span className="hidden sm:inline">⚠</span>}
      </button>

      {open && entries.length > 0 && (
        <div
          className="absolute right-0 mt-2 w-80 max-h-[60vh] overflow-y-auto rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary shadow-xl z-50"
          data-testid="fleet-status-dropdown"
        >
          <div className="px-3 py-2 border-b border-border dark:border-dark-border">
            <p className="text-xs uppercase tracking-wider font-semibold text-text-muted dark:text-dark-text-muted">
              Needs attention ({entries.length})
            </p>
          </div>
          <div className="py-1">
            {entries.map(({ claw, reason, detail }) => (
              <button
                key={claw.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  // Land directly on the Plan tab — that's where the
                  // operator's recovery controls live (queue intent,
                  // reset failures, edit plan, split task).
                  navigate(`/claws?claw=${encodeURIComponent(claw.id)}&tab=plan`);
                }}
                className="w-full text-left px-3 py-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors flex items-start gap-2"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${REASON_TONE[reason]}`}
                  aria-label={reason}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                      {claw.name}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold shrink-0 ${
                        reason === 'failed' ? 'text-amber-500' : 'text-red-500'
                      }`}
                    >
                      {REASON_LABEL[reason]}
                    </span>
                  </div>
                  <p
                    className="text-xs text-text-muted dark:text-dark-text-muted truncate"
                    title={detail}
                  >
                    {detail}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-border dark:border-dark-border">
            <Link
              to="/claws"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-xs text-center text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
            >
              Open Claws page →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

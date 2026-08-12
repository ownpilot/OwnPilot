/**
 * MissionControlPage — single-pane operator dashboard for the autonomous fleet.
 *
 * Aggregates the three things an operator needs to see and act on without
 * navigating into individual claws:
 *
 *  1. Fleet grid — every claw as a compact live card with inline start /
 *     pause / stop / reset-failures controls. Sorted by attention priority.
 *  2. Escalation queue — pending escalations with one-click approve / deny.
 *  3. Activity feed — recent plan-history entries + cycle outcomes across
 *     all claws as a unified timeline.
 *
 * Why it exists: the per-claw detail panel is rich but requires drilling in.
 * The dashboard widget is summary-only with no actions. Mission Control sits
 * between them — broad enough to cover the whole fleet, deep enough to act
 * without context-switching.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { Activity, RefreshCw, Zap } from '../components/icons';
import { clawsApi, type ClawConfig } from '../api';
import { codingAgentsApi, type CodingAgentSession } from '../api/endpoints/coding-agents';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { summarizeFleetAttention, listFleetAttention } from '../components/FleetStatusIndicator';
import { CreateClawModal } from './claws/CreateClawModal';
import { ClawMissionCard } from './mission-control/ClawMissionCard';
import {
  CodingStatePill,
  FleetChip,
  EmptyHint,
  EscalationCard,
  ActivityRow,
} from './mission-control/panels';
import {
  selectVisibleClaws,
  buildActivityFeed,
  selectEscalations,
  type FleetFilter,
} from './mission-control/derive';

export function MissionControlPage() {
  const [claws, setClaws] = useState<ClawConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyDraftFor, setDenyDraftFor] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('all');
  const [search, setSearch] = useState('');
  // Bulk select mode — when true each card shows a checkbox and the
  // action bar at the bottom becomes visible.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [codingSessions, setCodingSessions] = useState<CodingAgentSession[]>([]);
  const { subscribe } = useGateway();
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const [clawRes, sessionRes] = await Promise.all([
        clawsApi.list(50, 0),
        // Coding agent sessions are a parallel autonomous runtime — show
        // them in the right rail. Treat failure as empty rather than
        // blocking the whole page when the API is unavailable.
        codingAgentsApi.listSessions().catch(() => [] as CodingAgentSession[]),
      ]);
      setClaws(clawRes.claws);
      setCodingSessions(sessionRes);
    } catch {
      toast.error('Failed to load claws');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubs = [
      subscribe('claw:update', () => refresh()),
      subscribe('claw:started', () => refresh()),
      subscribe('claw:stopped', () => refresh()),
      subscribe('claw:plan:updated', () => refresh()),
      subscribe('claw:escalation', () => refresh()),
      subscribe('claw:cycle:complete', () => refresh()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, refresh]);

  const visibleClaws = useMemo(
    () => selectVisibleClaws(claws, filter, search),
    [claws, filter, search]
  );
  // Drop selections that filtered out — avoids ghost selections being
  // acted on by bulk operations.
  const visibleIds = useMemo(() => new Set(visibleClaws.map((c) => c.id)), [visibleClaws]);
  const effectiveSelectedIds = useMemo(
    () => new Set([...selectedIds].filter((id) => visibleIds.has(id))),
    [selectedIds, visibleIds]
  );
  // Compatibility alias for the rest of the page that already references
  // `sorted`. Keeps the render code unchanged below.
  const sorted = visibleClaws;

  const breakdown = useMemo(() => summarizeFleetAttention(claws), [claws]);
  const attentionEntries = useMemo(() => listFleetAttention(claws), [claws]);

  const escalations = useMemo(() => selectEscalations(claws), [claws]);

  const activity = useMemo(() => buildActivityFeed(claws), [claws]);

  const wrap = (action: string, fn: () => Promise<unknown>) => async (id: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(`${action} succeeded`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyId(null);
    }
  };

  const handleStart = (id: string) => wrap('Start', () => clawsApi.start(id))(id);
  const handlePause = (id: string) => wrap('Pause', () => clawsApi.pause(id))(id);
  const handleResume = (id: string) => wrap('Resume', () => clawsApi.resume(id))(id);
  const handleStop = (id: string) => wrap('Stop', () => clawsApi.stop(id))(id);
  const handleReset = (id: string) => wrap('Reset failures', () => clawsApi.resetFailures(id))(id);
  const handleApprove = (id: string) => wrap('Approve', () => clawsApi.approveEscalation(id))(id);

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = (): void => {
    setSelectedIds(new Set(visibleClaws.map((c) => c.id)));
  };
  const clearSelection = (): void => setSelectedIds(new Set());

  const runBulk = async (
    action: 'pause' | 'resume' | 'stop' | 'start' | 'reset',
    fn: (id: string) => Promise<unknown>
  ): Promise<void> => {
    const ids = [...effectiveSelectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    // Run sequentially — bulk operator actions on a fleet are not the
    // common path, and parallel start/stop spam can race the manager.
    for (const id of ids) {
      try {
        await fn(id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    refresh();
    toast.success(`${action}: ${ok} succeeded${failed > 0 ? `, ${failed} failed` : ''}`);
  };

  const handleDeny = async (id: string) => {
    setBusyId(id);
    try {
      await clawsApi.denyEscalation(id, denyReason || undefined);
      toast.success('Denied');
      setDenyDraftFor(null);
      setDenyReason('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deny failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page Header */}
      <header className="px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Mission Control
            </h1>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Live operator view of every autonomous Claw — state, plans, escalations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90 inline-flex items-center gap-1"
            >
              <Zap className="w-3.5 h-3.5" />+ New Claw
            </button>
            <button
              type="button"
              onClick={refresh}
              className="px-3 py-1.5 text-xs rounded-md border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
              Refresh
            </button>
            <Link
              to="/claws"
              className="px-3 py-1.5 text-xs rounded-md border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            >
              Manage all
            </Link>
          </div>
        </div>

        {/* Fleet attention summary strip */}
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-text-muted dark:text-dark-text-muted">
            {claws.length} claw{claws.length === 1 ? '' : 's'}
          </span>
          <FleetChip label="escalation" count={breakdown.escalation} tone="purple" />
          <FleetChip label="reflecting" count={breakdown.reflection} tone="purple" />
          <FleetChip label="stalled" count={breakdown.stalled} tone="red" />
          <FleetChip label="failed" count={breakdown.failed} tone="amber" />
          {breakdown.total === 0 && claws.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 font-semibold">
              ✓ Fleet healthy
            </span>
          )}
        </div>
      </header>

      {/* 3-section body */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* === Live Fleet (spans 2 cols on lg) === */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
              Live Fleet ({sorted.length}
              {claws.length !== sorted.length ? ` / ${claws.length}` : ''})
            </h2>
            <button
              type="button"
              onClick={() => {
                setSelecting((s) => !s);
                if (selecting) clearSelection();
              }}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                selecting
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted'
              }`}
            >
              {selecting ? 'Cancel select' : 'Select…'}
            </button>
          </div>

          {/* Filter + search bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or id…"
              className="flex-1 min-w-[180px] text-xs bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded p-1.5"
            />
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'attention', label: 'Attention' },
                { id: 'escalation', label: 'Escalation' },
                { id: 'running', label: 'Running' },
                { id: 'paused', label: 'Paused' },
                { id: 'failed', label: 'Failed' },
              ] as { id: FleetFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`text-[11px] px-2 py-1 rounded-full transition-colors ${
                  filter === f.id
                    ? 'bg-primary/15 text-primary border border-primary/40 font-semibold'
                    : 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-sm text-text-muted">Loading…</div>
          ) : sorted.length === 0 ? (
            claws.length === 0 ? (
              <EmptyHint />
            ) : (
              <p className="text-xs text-text-muted p-3 rounded border border-dashed border-border dark:border-dark-border">
                No claws match the current filter.
              </p>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sorted.map((claw) => (
                <ClawMissionCard
                  key={claw.id}
                  claw={claw}
                  busy={busyId === claw.id}
                  selectMode={selecting}
                  selected={effectiveSelectedIds.has(claw.id)}
                  onToggleSelect={() => toggleSelect(claw.id)}
                  onStart={() => handleStart(claw.id)}
                  onPause={() => handlePause(claw.id)}
                  onResume={() => handleResume(claw.id)}
                  onStop={() => handleStop(claw.id)}
                  onReset={() => handleReset(claw.id)}
                  onIntervened={refresh}
                />
              ))}
            </div>
          )}

          {/* Bulk action sticky bar — only when selecting AND something
              actually selected. Operator picks the action and we run it
              sequentially per claw. */}
          {selecting && effectiveSelectedIds.size > 0 && (
            <div className="sticky bottom-0 -mx-6 px-6 py-2 bg-bg-secondary/95 dark:bg-dark-bg-secondary/95 backdrop-blur border-t border-border dark:border-dark-border flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-text-primary dark:text-dark-text-primary">
                {effectiveSelectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-[11px] px-2 py-1 rounded border border-border dark:border-dark-border text-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
              >
                Select all visible
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('start', (id) => clawsApi.start(id))}
                className="text-[11px] px-2 py-1 rounded bg-green-500 text-white hover:bg-green-500/80 disabled:opacity-50"
              >
                Start
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('pause', (id) => clawsApi.pause(id))}
                className="text-[11px] px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-500/80 disabled:opacity-50"
              >
                Pause
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('resume', (id) => clawsApi.resume(id))}
                className="text-[11px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-600/80 disabled:opacity-50"
              >
                Resume
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('reset', (id) => clawsApi.resetFailures(id))}
                className="text-[11px] px-2 py-1 rounded bg-purple-500 text-white hover:bg-purple-500/80 disabled:opacity-50"
              >
                Reset failures
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('stop', (id) => clawsApi.stop(id))}
                className="text-[11px] px-2 py-1 rounded bg-red-500 text-white hover:bg-red-500/80 disabled:opacity-50"
              >
                Stop
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="text-[11px] px-2 py-1 rounded text-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {/* === Right rail: escalations + activity === */}
        <aside className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mb-3">
              Escalations ({escalations.length})
            </h2>
            {escalations.length === 0 ? (
              <p className="text-xs text-text-muted">No pending escalations.</p>
            ) : (
              <div className="space-y-2">
                {escalations.map((claw) => (
                  <EscalationCard
                    key={claw.id}
                    claw={claw}
                    isDenying={denyDraftFor === claw.id}
                    denyReason={denyReason}
                    busy={busyId === claw.id}
                    onApprove={() => handleApprove(claw.id)}
                    onStartDeny={() => setDenyDraftFor(claw.id)}
                    onChangeDenyReason={setDenyReason}
                    onSubmitDeny={() => handleDeny(claw.id)}
                    onCancelDeny={() => {
                      setDenyDraftFor(null);
                      setDenyReason('');
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mb-3">
              Needs attention ({attentionEntries.length})
            </h2>
            {attentionEntries.length === 0 ? (
              <p className="text-xs text-text-muted">Nothing flagged.</p>
            ) : (
              <div className="space-y-1.5">
                {attentionEntries.slice(0, 8).map((entry) => (
                  <Link
                    key={`${entry.claw.id}-${entry.reason}`}
                    to={`/claws?claw=${encodeURIComponent(entry.claw.id)}&tab=plan`}
                    className="block p-2 rounded-md border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{entry.claw.name}</span>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold shrink-0 ${
                          entry.reason === 'failed' ? 'text-amber-500' : 'text-red-500'
                        }`}
                      >
                        {entry.reason}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted truncate">{entry.detail}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
                Coding agents ({codingSessions.length})
              </h2>
              <Link to="/coding-agents" className="text-[11px] text-primary hover:underline">
                Open →
              </Link>
            </div>
            {codingSessions.length === 0 ? (
              <p className="text-xs text-text-muted">No active sessions.</p>
            ) : (
              <div className="space-y-1.5">
                {codingSessions.slice(0, 5).map((s) => (
                  <Link
                    key={s.id}
                    to={`/coding-agents`}
                    className="block p-2 rounded-md border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{s.displayName}</span>
                      <CodingStatePill state={s.state} />
                    </div>
                    <p className="text-[11px] text-text-muted truncate" title={s.prompt}>
                      {s.provider}
                      {s.model ? ` · ${s.model}` : ''}
                      {s.prompt ? ` · "${s.prompt.slice(0, 40)}"` : ''}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mb-3">
              Recent plan activity
            </h2>
            {activity.length === 0 ? (
              <p className="text-xs text-text-muted">No plan changes yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {activity.slice(0, 12).map(({ claw, entry, at }, i) => (
                  <ActivityRow
                    key={`${claw.id}-${at}-${i}`}
                    clawName={claw.name}
                    clawId={claw.id}
                    entry={entry}
                  />
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {showCreate && (
        <CreateClawModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

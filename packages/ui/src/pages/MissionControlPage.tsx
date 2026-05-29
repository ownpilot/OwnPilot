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
import { Link } from 'react-router-dom';
import {
  Activity,
  Play,
  Pause,
  Square,
  AlertCircle,
  CheckCircle2,
  X as XIcon,
  Target,
  RefreshCw,
  Zap,
  Brain,
  Send,
  MessageSquare,
} from '../components/icons';
import { clawsApi, type ClawConfig, type ClawPlanHistoryEntry } from '../api';
import { codingAgentsApi, type CodingAgentSession } from '../api/endpoints/coding-agents';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { summarizeFleetAttention, listFleetAttention } from '../components/FleetStatusIndicator';
import { CreateClawModal } from './claws/CreateClawModal';

// Mirrors backend thresholds.
const REFLECT_THRESHOLD = 2;
const STALL_THRESHOLD = 5;

// ─── Sort helpers ───────────────────────────────────────────────────────

function attentionScore(c: ClawConfig): number {
  if (c.session?.state === 'escalation_pending') return 0;
  if ((c.session?.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD) return 1;
  if (c.session?.state === 'failed') return 2;
  const focus = c.session?.tasks?.find((t) => t.status === 'in_progress');
  if (focus && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD) return 3;
  if (c.session?.state === 'running' || c.session?.state === 'starting') return 4;
  if (c.session?.state === 'waiting' || c.session?.state === 'paused') return 5;
  return 6;
}

// ─── Page ───────────────────────────────────────────────────────────────

type FleetFilter = 'all' | 'attention' | 'running' | 'paused' | 'failed' | 'escalation';

function matchesFilter(claw: ClawConfig, filter: FleetFilter): boolean {
  const s = claw.session?.state ?? 'stopped';
  if (filter === 'all') return true;
  if (filter === 'running') return s === 'running' || s === 'starting' || s === 'waiting';
  if (filter === 'paused') return s === 'paused';
  if (filter === 'failed') return s === 'failed';
  if (filter === 'escalation') return s === 'escalation_pending';
  if (filter === 'attention') return attentionScore(claw) <= 3;
  return true;
}

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

  const visibleClaws = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...claws]
      .filter((c) => matchesFilter(c, filter))
      .filter((c) => (q.length === 0 ? true : c.name.toLowerCase().includes(q) || c.id.includes(q)))
      .sort((a, b) => attentionScore(a) - attentionScore(b));
  }, [claws, filter, search]);
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

  const escalations = useMemo(
    () =>
      claws.filter((c) => c.session?.state === 'escalation_pending' && c.session.pendingEscalation),
    [claws]
  );

  // Unified activity timeline — newest first. Pulls planHistory entries from
  // each live session and tags them with the source claw, then sorts by
  // timestamp. Keeps the most recent 30 globally.
  const activity = useMemo(() => {
    const all: Array<{
      claw: ClawConfig;
      entry: ClawPlanHistoryEntry;
      at: string;
    }> = [];
    for (const c of claws) {
      for (const e of c.session?.planHistory ?? []) {
        all.push({ claw: c, entry: e, at: e.at });
      }
    }
    all.sort((a, b) => (a.at < b.at ? 1 : -1));
    return all.slice(0, 30);
  }, [claws]);

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

function CodingStatePill({ state }: { state: CodingAgentSession['state'] }) {
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

// ─── Sub-components ─────────────────────────────────────────────────────

function FleetChip({
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

function EmptyHint() {
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

type InterveneMode = 'closed' | 'intent' | 'message';

function ClawMissionCard({
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

function EscalationCard({
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

function ActivityRow({
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

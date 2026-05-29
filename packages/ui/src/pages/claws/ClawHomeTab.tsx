/**
 * ClawHomeTab — operator dashboard for the Claws page.
 *
 * Was previously a capability-marketing page ("LLM Brain", "Code Execution",
 * etc.). Replaced with a real at-a-glance view: KPI strip, top-cost / most
 * active leaderboards, recent activity timeline, attention summary. Anything
 * shown is clickable into the relevant detail surface (Plan tab, full list).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Zap,
  DollarSign,
  Terminal,
  AlertCircle,
  Brain,
  Play,
  Plus,
  TrendingUp,
} from '../../components/icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { ClawConfig } from '../../api/endpoints/claws';
import { clawsApi } from '../../api/endpoints/claws';
import { useNavigate } from 'react-router-dom';

// Mirrors backend constants — keep in sync with claw-types.ts.
const REFLECT_THRESHOLD = 2;
const STALL_THRESHOLD = 5;

const PULSE_BUCKET_MS = 60_000;

interface FleetPulse {
  buckets: { count: number; failed: number }[];
  windowMs: number;
  total: number;
  failed: number;
  lastActivityAgoMs: number | null;
}

function buildFleetPulse(recent: RecentActivity[], bucketCount: number): FleetPulse {
  const buckets = Array.from({ length: bucketCount }, () => ({ count: 0, failed: 0 }));
  const now = Date.now();
  const windowMs = bucketCount * PULSE_BUCKET_MS;
  let total = 0;
  let failed = 0;
  let lastActivityAgoMs: number | null = null;
  for (const r of recent) {
    const t = new Date(r.executedAt).getTime();
    const age = now - t;
    if (age < 0 || age > windowMs) continue;
    const bucketIdx = bucketCount - 1 - Math.floor(age / PULSE_BUCKET_MS);
    if (bucketIdx < 0 || bucketIdx >= bucketCount) continue;
    const b = buckets[bucketIdx]!;
    b.count += 1;
    if (!r.success || r.error) b.failed += 1;
    total += 1;
    if (!r.success || r.error) failed += 1;
    if (lastActivityAgoMs === null || age < lastActivityAgoMs) lastActivityAgoMs = age;
  }
  return { buckets, windowMs, total, failed, lastActivityAgoMs };
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function FleetPulseStrip({ pulse }: { pulse: FleetPulse }) {
  const max = Math.max(1, ...pulse.buckets.map((b) => b.count));
  const recentlyActive = pulse.lastActivityAgoMs !== null && pulse.lastActivityAgoMs < 60_000;
  const isQuiet = pulse.total === 0;
  return (
    <div className="p-3 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center justify-between mb-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              recentlyActive ? 'bg-emerald-400' : isQuiet ? 'bg-gray-600' : 'bg-amber-400'
            }`}
          >
            {recentlyActive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
          </span>
          <span className="text-text-secondary dark:text-dark-text-secondary font-medium">
            Fleet pulse
          </span>
          <span className="text-text-muted text-[10px]">
            last {Math.round(pulse.windowMs / 60_000)}m
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted">
          <span>
            <span className="text-emerald-400">{pulse.total - pulse.failed}</span> ok
          </span>
          {pulse.failed > 0 && (
            <span>
              <span className="text-red-400">{pulse.failed}</span> failed
            </span>
          )}
          {pulse.lastActivityAgoMs !== null ? (
            <span>last {formatAgo(pulse.lastActivityAgoMs)} ago</span>
          ) : (
            <span>idle</span>
          )}
        </div>
      </div>
      <div className="flex items-end gap-px h-8" title={`${pulse.total} cycles in window`}>
        {pulse.buckets.map((b, i) => {
          const pct = b.count === 0 ? 0 : Math.max(8, Math.round((b.count / max) * 100));
          const isLast = i >= pulse.buckets.length - 2 && b.count > 0;
          const tone =
            b.count === 0
              ? 'bg-[#1a1a1a]'
              : b.failed > 0 && b.failed === b.count
                ? 'bg-red-500/70'
                : b.failed > 0
                  ? 'bg-amber-400'
                  : isLast
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-emerald-500/40';
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-all ${tone}`}
              style={{ height: b.count === 0 ? '4px' : `${pct}%` }}
              title={
                b.count > 0
                  ? `${b.count} cycle${b.count === 1 ? '' : 's'}${b.failed > 0 ? ` (${b.failed} failed)` : ''}`
                  : 'idle'
              }
            />
          );
        })}
      </div>
    </div>
  );
}

interface RecentActivity {
  clawId: string;
  clawName: string;
  cycleNumber: number;
  success: boolean;
  durationMs: number;
  costUsd?: number;
  executedAt: string;
  outputMessage: string;
  error?: string;
}

export function ClawHomeTab({
  claws,
  onCreateClaw,
  onViewClaws,
}: {
  claws: ClawConfig[];
  onCreateClaw: () => void;
  onViewClaws: () => void;
}) {
  const navigate = useNavigate();

  // Fleet-wide aggregates.
  const totalCycles = claws.reduce((s, c) => s + (c.session?.cyclesCompleted ?? 0), 0);
  const totalToolCalls = claws.reduce((s, c) => s + (c.session?.totalToolCalls ?? 0), 0);
  const totalCost = claws.reduce((s, c) => s + (c.session?.totalCostUsd ?? 0), 0);
  const runningCount = claws.filter(
    (c) =>
      c.session?.state === 'running' ||
      c.session?.state === 'starting' ||
      c.session?.state === 'waiting'
  ).length;

  // Attention breakdown — same priority as everywhere else in the app.
  const attention = useMemo(() => {
    let escalation = 0;
    let reflection = 0;
    let stalled = 0;
    let failed = 0;
    for (const c of claws) {
      if (!c.session) continue;
      if (c.session.state === 'escalation_pending') {
        escalation += 1;
        continue;
      }
      if ((c.session.consecutiveErrors ?? 0) >= REFLECT_THRESHOLD) {
        reflection += 1;
        continue;
      }
      if (c.session.state === 'failed') {
        failed += 1;
        continue;
      }
      const focus = c.session.tasks?.find((t) => t.status === 'in_progress');
      if (focus && (focus.cyclesInProgress ?? 0) >= STALL_THRESHOLD) {
        stalled += 1;
      }
    }
    return { escalation, reflection, stalled, failed };
  }, [claws]);

  // Top-N most active claws (by cycles) — bar chart data.
  const topActive = useMemo(
    () =>
      [...claws]
        .filter((c) => (c.session?.cyclesCompleted ?? 0) > 0)
        .sort((a, b) => (b.session?.cyclesCompleted ?? 0) - (a.session?.cyclesCompleted ?? 0))
        .slice(0, 6)
        .map((c) => ({
          id: c.id,
          name: c.name.length > 18 ? `${c.name.slice(0, 16)}…` : c.name,
          cycles: c.session?.cyclesCompleted ?? 0,
          fullName: c.name,
        })),
    [claws]
  );

  // Top-N most expensive claws.
  const topCost = useMemo(
    () =>
      [...claws]
        .filter((c) => (c.session?.totalCostUsd ?? 0) > 0)
        .sort((a, b) => (b.session?.totalCostUsd ?? 0) - (a.session?.totalCostUsd ?? 0))
        .slice(0, 6)
        .map((c) => ({
          id: c.id,
          name: c.name.length > 18 ? `${c.name.slice(0, 16)}…` : c.name,
          cost: Number((c.session?.totalCostUsd ?? 0).toFixed(4)),
          fullName: c.name,
        })),
    [claws]
  );

  // Recent activity timeline — fetched from each running claw's history
  // and merged. Capped so we don't slam the API on huge fleets.
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  useEffect(() => {
    const live = claws.filter((c) => c.session && c.session.cyclesCompleted > 0).slice(0, 8);
    if (live.length === 0) {
      setRecent([]);
      return;
    }
    Promise.allSettled(
      live.map((c) =>
        clawsApi.getHistory(c.id, 5).then((r) =>
          r.entries.map((e) => ({
            clawId: c.id,
            clawName: c.name,
            cycleNumber: e.cycleNumber,
            success: e.success,
            durationMs: e.durationMs,
            costUsd: e.costUsd,
            executedAt: e.executedAt,
            outputMessage: e.outputMessage,
            error: e.error,
          }))
        )
      )
    ).then((results) => {
      const merged: RecentActivity[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') merged.push(...r.value);
      }
      merged.sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1));
      setRecent(merged.slice(0, 15));
    });
  }, [claws]);

  if (claws.length === 0) {
    return <EmptyState onCreateClaw={onCreateClaw} />;
  }

  const attentionTotal =
    attention.escalation + attention.reflection + attention.stalled + attention.failed;

  // Bucket recent activity by minute over the last 30 minutes so the strip
  // gives a quick visual answer to "is the fleet doing work right now".
  const fleetPulse = buildFleetPulse(recent, 30);

  return (
    <div className="space-y-5">
      {/* === Fleet pulse strip — bucketed activity over the last 30 minutes,
          using the same `recent[]` entries the activity feed shows below.
          Trailing bars pulse so operators can tell whether the fleet is
          currently working or has gone quiet. === */}
      <FleetPulseStrip pulse={fleetPulse} />

      {/* === KPI strip === */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          icon={Zap}
          label="Total Claws"
          value={claws.length}
          tone="primary"
          accent={`${runningCount} live now`}
        />
        <KpiCard icon={Activity} label="Cycles" value={totalCycles.toLocaleString()} tone="blue" />
        <KpiCard
          icon={Terminal}
          label="Tool Calls"
          value={totalToolCalls.toLocaleString()}
          tone="cyan"
        />
        <KpiCard
          icon={DollarSign}
          label="Total Spend"
          value={`$${totalCost.toFixed(4)}`}
          tone="emerald"
        />
        <KpiCard
          icon={AlertCircle}
          label="Needs Attention"
          value={attentionTotal}
          tone={attentionTotal > 0 ? 'red' : 'gray'}
          accent={attentionTotal > 0 ? 'click to view' : 'all clear'}
          onClick={attentionTotal > 0 ? onViewClaws : undefined}
        />
      </div>

      {/* === Attention chips bar (only when attention > 0) === */}
      {attentionTotal > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <span className="text-xs font-semibold text-red-500 uppercase tracking-wider">
            Needs attention
          </span>
          {attention.escalation > 0 && (
            <ChipBtn
              color="purple"
              count={attention.escalation}
              label="escalation"
              onClick={onViewClaws}
            />
          )}
          {attention.reflection > 0 && (
            <ChipBtn
              color="purple"
              count={attention.reflection}
              label="reflecting"
              onClick={onViewClaws}
            />
          )}
          {attention.stalled > 0 && (
            <ChipBtn color="red" count={attention.stalled} label="stalled" onClick={onViewClaws} />
          )}
          {attention.failed > 0 && (
            <ChipBtn color="amber" count={attention.failed} label="failed" onClick={onViewClaws} />
          )}
        </div>
      )}

      {/* === Two-column body: charts + activity === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Charts (2-col on lg) */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Most active claws" subtitle="by cycles completed">
            {topActive.length === 0 ? (
              <ChartEmpty label="No cycles yet" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={topActive}
                  layout="vertical"
                  margin={{ left: 6, right: 8, top: 4, bottom: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={90}
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className="text-text-muted"
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(59,130,246,0.08)' }}
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-secondary, #1a1a1a)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    formatter={(v) => [`${v} cycles`, 'cycles']}
                    labelFormatter={(_, payload) =>
                      payload && payload[0]
                        ? (payload[0].payload as { fullName: string }).fullName
                        : ''
                    }
                  />
                  <Bar dataKey="cycles" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {topActive.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill="#3b82f6"
                        onClick={() =>
                          navigate(`/claws?claw=${encodeURIComponent(entry.id)}&tab=overview`)
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Most expensive" subtitle="by total spend USD">
            {topCost.length === 0 ? (
              <ChartEmpty label="No spend recorded" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={topCost}
                  layout="vertical"
                  margin={{ left: 6, right: 8, top: 4, bottom: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={90}
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className="text-text-muted"
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-secondary, #1a1a1a)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'spent']}
                    labelFormatter={(_, payload) =>
                      payload && payload[0]
                        ? (payload[0].payload as { fullName: string }).fullName
                        : ''
                    }
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {topCost.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill="#10b981"
                        onClick={() =>
                          navigate(`/claws?claw=${encodeURIComponent(entry.id)}&tab=stats`)
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Recent activity (right column on lg, full on mobile) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-dark-text-secondary">
              Recent activity
            </h3>
            <TrendingUp className="w-3.5 h-3.5 text-text-muted" />
          </div>
          {recent.length === 0 ? (
            <p className="text-xs text-text-muted p-3 rounded border border-dashed border-border dark:border-dark-border">
              No cycle activity yet.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {recent.map((a, i) => (
                <ActivityItem
                  key={`${a.clawId}-${a.cycleNumber}-${i}`}
                  a={a}
                  onClick={() => navigate(`/claws?claw=${encodeURIComponent(a.clawId)}&tab=runs`)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* === Quick CTAs === */}
      <div className="flex items-center gap-2 pt-2 border-t border-border dark:border-dark-border">
        <button
          onClick={onCreateClaw}
          className="px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90 inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> New Claw
        </button>
        <button
          onClick={onViewClaws}
          className="px-3 py-1.5 text-xs rounded-md border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
        >
          See all claws
        </button>
        <button
          onClick={() => navigate('/mission-control')}
          className="ml-auto px-3 py-1.5 text-xs rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
        >
          <Brain className="w-3.5 h-3.5" /> Open Mission Control
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  tone: 'primary' | 'blue' | 'cyan' | 'emerald' | 'red' | 'gray';
  accent?: string;
  onClick?: () => void;
}) {
  const toneCls: Record<typeof tone, string> = {
    primary: 'bg-primary/10 text-primary',
    blue: 'bg-blue-500/10 text-blue-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    red: 'bg-red-500/10 text-red-500 animate-pulse',
    gray: 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted',
  };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`p-3 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-left ${
        onClick ? 'hover:border-primary/40 transition-colors' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`w-7 h-7 rounded-md flex items-center justify-center ${toneCls[tone]}`}>
          <Icon className="w-4 h-4" />
        </span>
        {accent && <span className="text-[10px] text-text-muted truncate">{accent}</span>}
      </div>
      <p className="text-2xl font-bold mt-2 text-text-primary dark:text-dark-text-primary tabular-nums">
        {value}
      </p>
      <p className="text-[11px] text-text-muted uppercase tracking-wider">{label}</p>
    </Wrapper>
  );
}

function ChipBtn({
  color,
  count,
  label,
  onClick,
}: {
  color: 'purple' | 'red' | 'amber';
  count: number;
  label: string;
  onClick: () => void;
}) {
  const cls =
    color === 'purple'
      ? 'bg-purple-500/15 text-purple-500 hover:bg-purple-500/25'
      : color === 'red'
        ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25'
        : 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${cls}`}
    >
      {count} {label}
    </button>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary">
      <div className="mb-2">
        <p className="text-xs font-semibold text-text-primary dark:text-dark-text-primary">
          {title}
        </p>
        <p className="text-[10px] text-text-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function ActivityItem({ a, onClick }: { a: RecentActivity; onClick: () => void }) {
  const time = a.executedAt.slice(11, 19);
  const summary = a.outputMessage
    ? a.outputMessage.replace(/\s+/g, ' ').slice(0, 60)
    : a.error
      ? `error: ${a.error.slice(0, 60)}`
      : 'no output';
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-2 rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary hover:border-primary/40 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                a.success ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs font-medium truncate">{a.clawName}</span>
            <span className="text-[10px] text-text-muted shrink-0">#{a.cycleNumber}</span>
          </div>
          <span className="text-[10px] text-text-muted font-mono shrink-0">{time}</span>
        </div>
        <p
          className="text-[11px] text-text-muted truncate mt-0.5"
          title={a.outputMessage || a.error}
        >
          {summary}
        </p>
      </button>
    </li>
  );
}

function EmptyState({ onCreateClaw }: { onCreateClaw: () => void }) {
  return (
    <div className="p-8 text-center rounded-lg border border-dashed border-border dark:border-dark-border">
      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
        <Zap className="w-6 h-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
        No claws yet
      </h3>
      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 max-w-md mx-auto">
        Claws are unified autonomous agent runtimes — they cycle through LLM reasoning + tool use
        until their mission is done. Spin one up and watch it work.
      </p>
      <button
        type="button"
        onClick={onCreateClaw}
        className="mt-4 px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary/90 inline-flex items-center gap-1.5"
      >
        <Play className="w-4 h-4" /> Create your first Claw
      </button>
    </div>
  );
}

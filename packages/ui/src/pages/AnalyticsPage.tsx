/**
 * AnalyticsPage — System-wide analytics dashboard with rich visualizations
 *
 * Charts: Cost trend, provider breakdown, agent activity, task completion,
 * claw execution, token usage, and real-time KPI cards.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  RadialBarChart,
  RadialBar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  costsApi,
  summaryApi,
  clawsApi,
  backgroundAgentsApi,
  soulsApi,
  fleetApi,
  workflowsApi,
} from '../api';
import type { SummaryData, CostsData } from '../types';
import { Skeleton } from '../components/Skeleton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderBreakdownItem {
  provider: string;
  requests: number;
  cost: number;
  percentOfTotal: number;
  inputTokens: number;
  outputTokens: number;
}

interface DailyUsageItem {
  date: string;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ClawStats {
  total: number;
  running: number;
  totalCost: number;
  totalCycles: number;
  totalToolCalls: number;
  byMode: Record<string, number>;
  byState: Record<string, number>;
}

interface AgentCounts {
  souls: number;
  background: number;
  claws: number;
  fleets: number;
  workflows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#64748b', // slate
];

const STATE_COLORS: Record<string, string> = {
  running: '#22c55e',
  paused: '#eab308',
  stopped: '#64748b',
  failed: '#ef4444',
  completed: '#6366f1',
  waiting: '#06b6d4',
  starting: '#3b82f6',
  escalation_pending: '#a855f7',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(val: number): string {
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.01) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

function formatTokens(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Small Components
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  color = 'indigo',
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: React.ReactNode;
}) {
  const ring = `ring-${color}-500/20`;
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-white dark:bg-dark-bg-secondary border border-border-primary dark:border-dark-border-primary p-4 shadow-sm hover:shadow-md transition-shadow ${ring}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            {value}
          </p>
          {sub && (
            <p className="text-xs text-text-secondary dark:text-dark-text-secondary">{sub}</p>
          )}
        </div>
        <div className="p-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-white dark:bg-dark-bg-secondary border border-border-primary dark:border-dark-border-primary p-5 shadow-sm ${className}`}
    >
      <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

function MiniDonut({
  data,
  colors,
}: {
  data: { name: string; value: number }[];
  colors: string[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-text-secondary dark:text-dark-text-secondary">
        No data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--color-bg-secondary, #1e293b)',
            border: '1px solid var(--color-border-primary, #334155)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value: unknown, name: unknown) => [
            `${value} (${total > 0 ? ((Number(value) / total) * 100).toFixed(0) : 0}%)`,
            String(name),
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function DonutLegend({
  data,
  colors,
}: {
  data: { name: string; value: number }[];
  colors: string[];
}) {
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-2 text-xs">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: colors[i % colors.length] }}
          />
          <span className="text-text-secondary dark:text-dark-text-secondary truncate">
            {d.name}
          </span>
          <span className="ml-auto font-medium text-text-primary dark:text-dark-text-primary">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-bg-primary dark:bg-dark-bg-tertiary border border-border-primary dark:border-dark-border-primary p-2.5 shadow-lg text-xs">
      <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-text-secondary dark:text-dark-text-secondary">{p.name}:</span>
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {typeof p.value === 'number' && p.name.toLowerCase().includes('cost')
              ? formatCost(p.value)
              : typeof p.value === 'number' && p.name.toLowerCase().includes('token')
                ? formatTokens(p.value)
                : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);

  // Data
  const [usage, setUsage] = useState<CostsData | null>(null);
  const [breakdown, setBreakdown] = useState<{
    byProvider: ProviderBreakdownItem[];
    daily: DailyUsageItem[];
  } | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [clawStats, setClawStats] = useState<ClawStats | null>(null);
  const [agentCounts, setAgentCounts] = useState<AgentCounts>({
    souls: 0,
    background: 0,
    claws: 0,
    fleets: 0,
    workflows: 0,
  });

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usageRes, breakdownRes, summaryRes, clawStatsRes, soulsRes, bgRes, fleetsRes, wfRes] =
        await Promise.allSettled([
          costsApi.usage(),
          costsApi.getBreakdown(period),
          summaryApi.get(),
          clawsApi.stats(),
          soulsApi.list(),
          backgroundAgentsApi.list(),
          fleetApi.list(),
          workflowsApi.list(),
        ]);

      if (usageRes.status === 'fulfilled') setUsage(usageRes.value);
      if (breakdownRes.status === 'fulfilled') setBreakdown(breakdownRes.value);
      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value);
      if (clawStatsRes.status === 'fulfilled') setClawStats(clawStatsRes.value);

      const count = (res: PromiseSettledResult<unknown>) => {
        if (res.status !== 'fulfilled') return 0;
        const v = res.value;
        if (Array.isArray(v)) return v.length;
        if (v && typeof v === 'object' && 'total' in v) return (v as { total: number }).total;
        if (v && typeof v === 'object' && 'items' in v)
          return (v as { items: unknown[] }).items.length;
        return 0;
      };

      setAgentCounts({
        souls: count(soulsRes),
        background: count(bgRes),
        claws: clawStatsRes.status === 'fulfilled' ? (clawStatsRes.value as ClawStats).total : 0,
        fleets: count(fleetsRes),
        workflows: count(wfRes),
      });
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Derived data
  const dailyData = (breakdown?.daily ?? []).map((d) => ({
    ...d,
    date: shortDate(d.date),
    tokens: d.inputTokens + d.outputTokens,
  }));

  const providerDonut = (breakdown?.byProvider ?? [])
    .filter((p) => p.cost > 0)
    .map((p) => ({ name: p.provider, value: Math.round(p.cost * 100) / 100 }));

  const providerRequests = (breakdown?.byProvider ?? [])
    .filter((p) => p.requests > 0)
    .slice(0, 8)
    .map((p) => ({
      name: p.provider,
      requests: p.requests,
      input: p.inputTokens,
      output: p.outputTokens,
    }));

  const clawModeData = clawStats
    ? Object.entries(clawStats.byMode)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: k, value: v }))
    : [];

  const clawStateData = clawStats
    ? Object.entries(clawStats.byState)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: k, value: v }))
    : [];

  const agentBarData = [
    { name: 'Soul Agents', count: agentCounts.souls, fill: '#6366f1' },
    { name: 'Background', count: agentCounts.background, fill: '#8b5cf6' },
    { name: 'Claws', count: agentCounts.claws, fill: '#ec4899' },
    { name: 'Fleet', count: agentCounts.fleets, fill: '#f97316' },
    { name: 'Workflows', count: agentCounts.workflows, fill: '#22c55e' },
  ];

  const taskProgress = summary
    ? {
        completed: summary.tasks.completed,
        pending: summary.tasks.pending,
        overdue: summary.tasks.overdue,
        total: summary.tasks.total,
        pct:
          summary.tasks.total > 0
            ? Math.round((summary.tasks.completed / summary.tasks.total) * 100)
            : 0,
      }
    : null;

  const taskRadial = taskProgress
    ? [{ name: 'Completed', value: taskProgress.pct, fill: '#22c55e' }]
    : [];

  const habitData = summary?.habits;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
            Analytics
          </h1>
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-0.5">
            System-wide metrics and performance insights
          </p>
        </div>
        <div className="flex items-center gap-1 bg-bg-secondary dark:bg-dark-bg-tertiary rounded-lg p-0.5">
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? 'bg-white dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary shadow-sm'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {p === 'week' ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Today Cost"
          value={usage ? formatCost(usage.daily.totalCost) : '$0'}
          sub={`${usage?.daily.totalRequests ?? 0} requests`}
          color="indigo"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
        <KpiCard
          label="Month Cost"
          value={usage ? formatCost(usage.monthly.totalCost) : '$0'}
          sub={`${usage?.monthly.totalRequests ?? 0} requests`}
          color="violet"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          }
        />
        <KpiCard
          label="Tokens Today"
          value={formatTokens(usage?.daily.totalTokens ?? 0)}
          sub={`${formatTokens(usage?.daily.totalInputTokens ?? 0)} in / ${formatTokens(usage?.daily.totalOutputTokens ?? 0)} out`}
          color="cyan"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
          }
        />
        <KpiCard
          label="Active Agents"
          value={agentCounts.souls + agentCounts.background + (clawStats?.running ?? 0)}
          sub={`${agentCounts.souls} souls, ${agentCounts.background} bg, ${clawStats?.running ?? 0} claws`}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        />
        <KpiCard
          label="Claw Cycles"
          value={clawStats?.totalCycles ?? 0}
          sub={`${clawStats?.totalToolCalls ?? 0} tool calls`}
          color="pink"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          }
        />
        <KpiCard
          label="Tasks"
          value={summary?.tasks.total ?? 0}
          sub={`${summary?.tasks.completed ?? 0} done, ${summary?.tasks.overdue ?? 0} overdue`}
          color="yellow"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          }
        />
      </div>

      {/* Row 2: Cost Trend + Token Volume */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Cost Trend">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-primary, #334155)"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="#6366f1"
                  fill="url(#costGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No cost data for this period
            </div>
          )}
        </ChartCard>

        <ChartCard title="Token Volume">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-primary, #334155)"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                  tickFormatter={formatTokens}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="inputTokens"
                  name="Input Tokens"
                  fill="#6366f1"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="outputTokens"
                  name="Output Tokens"
                  fill="#a855f7"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No token data for this period
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 3: Provider Breakdown + Agent Distribution + Request Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Provider Cost Breakdown */}
        <ChartCard title="Cost by Provider">
          <div className="flex items-center gap-4">
            <div className="w-36 h-36">
              <MiniDonut data={providerDonut} colors={COLORS} />
            </div>
            <DonutLegend
              data={providerDonut.map((p) => ({ name: p.name, value: p.value }))}
              colors={COLORS}
            />
          </div>
        </ChartCard>

        {/* Agent Distribution */}
        <ChartCard title="Agent Distribution">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={agentBarData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border-primary, #334155)"
                opacity={0.3}
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                stroke="var(--color-text-secondary, #94a3b8)"
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 11 }}
                stroke="var(--color-text-secondary, #94a3b8)"
                width={85}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]}>
                {agentBarData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Requests by Provider */}
        <ChartCard title="Requests by Provider">
          {providerRequests.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={providerRequests} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-primary, #334155)"
                  opacity={0.3}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                  width={85}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="requests" name="Requests" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No request data
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 4: Claw Stats + Task Completion + Habits */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Claw by Mode */}
        <ChartCard title="Claws by Mode">
          <div className="flex items-center gap-4">
            <div className="w-28 h-28">
              <MiniDonut
                data={clawModeData}
                colors={['#6366f1', '#ec4899', '#f97316', '#22c55e']}
              />
            </div>
            <DonutLegend
              data={clawModeData}
              colors={['#6366f1', '#ec4899', '#f97316', '#22c55e']}
            />
          </div>
        </ChartCard>

        {/* Claw by State */}
        <ChartCard title="Claws by State">
          <div className="flex items-center gap-4">
            <div className="w-28 h-28">
              <MiniDonut
                data={clawStateData}
                colors={clawStateData.map((d) => STATE_COLORS[d.name] ?? '#64748b')}
              />
            </div>
            <DonutLegend
              data={clawStateData}
              colors={clawStateData.map((d) => STATE_COLORS[d.name] ?? '#64748b')}
            />
          </div>
        </ChartCard>

        {/* Task Completion Gauge */}
        <ChartCard title="Task Completion">
          {taskProgress ? (
            <div className="flex flex-col items-center">
              <div className="w-28 h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                    data={taskRadial}
                  >
                    <RadialBar
                      dataKey="value"
                      cornerRadius={10}
                      background={{ fill: 'var(--color-bg-secondary, #1e293b)' }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary -mt-4">
                {taskProgress.pct}%
              </p>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                {taskProgress.completed}/{taskProgress.total} tasks
              </p>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-sm text-text-secondary">
              No tasks
            </div>
          )}
        </ChartCard>

        {/* Habits */}
        <ChartCard title="Habits Today">
          {habitData ? (
            <div className="flex flex-col items-center">
              <div className="w-28 h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                    data={[{ name: 'Habits', value: habitData.percentage, fill: '#8b5cf6' }]}
                  >
                    <RadialBar
                      dataKey="value"
                      cornerRadius={10}
                      background={{ fill: 'var(--color-bg-secondary, #1e293b)' }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary -mt-4">
                {habitData.percentage}%
              </p>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                {habitData.completedToday}/{habitData.totalToday} habits | Best streak:{' '}
                {habitData.bestStreak}
              </p>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No habits
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 5: Daily Requests Line + Claw Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="Daily Requests" className="lg:col-span-2">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-primary, #334155)"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-text-secondary, #94a3b8)"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-secondary, #94a3b8)" />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No request data
            </div>
          )}
        </ChartCard>

        {/* Claw Summary */}
        <ChartCard title="Claw Runtime Summary">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Claws', value: clawStats?.total ?? 0, color: 'text-indigo-500' },
              { label: 'Running', value: clawStats?.running ?? 0, color: 'text-green-500' },
              {
                label: 'Total Cycles',
                value: clawStats?.totalCycles ?? 0,
                color: 'text-purple-500',
              },
              {
                label: 'Tool Calls',
                value: clawStats?.totalToolCalls ?? 0,
                color: 'text-pink-500',
              },
              {
                label: 'Total Cost',
                value: formatCost(clawStats?.totalCost ?? 0),
                color: 'text-amber-500',
              },
              { label: 'Workflows', value: agentCounts.workflows, color: 'text-cyan-500' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg bg-bg-secondary dark:bg-dark-bg-tertiary p-3 text-center"
              >
                <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                <p className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider mt-0.5">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Row 6: Personal Data Overview */}
      {summary && (
        <ChartCard title="Personal Data Overview">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {[
              {
                label: 'Notes',
                value: summary.notes.total,
                recent: summary.notes.recent,
                color: '#6366f1',
              },
              {
                label: 'Bookmarks',
                value: summary.bookmarks.total,
                recent: summary.bookmarks.favorites,
                color: '#8b5cf6',
              },
              {
                label: 'Contacts',
                value: summary.contacts.total,
                recent: summary.contacts.favorites,
                color: '#ec4899',
              },
              {
                label: 'Events',
                value: summary.calendar.total,
                recent: summary.calendar.today,
                color: '#f97316',
              },
              {
                label: 'Expenses',
                value: summary.expenses?.total ?? 0,
                recent: 0,
                color: '#eab308',
              },
              { label: 'Memories', value: 0, recent: 0, color: '#22c55e' },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div
                  className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg"
                  style={{ background: item.color }}
                >
                  {item.value}
                </div>
                <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                  {item.label}
                </p>
                {item.recent > 0 && (
                  <p className="text-[10px] text-text-secondary dark:text-dark-text-secondary">
                    {item.recent} active
                  </p>
                )}
              </div>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}

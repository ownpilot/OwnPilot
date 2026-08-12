/**
 * AnalyticsPage — System-wide analytics dashboard with rich visualizations
 *
 * Uses the same design tokens as DashboardPage:
 *   card-elevated, bg-bg-secondary, border-border, text-text-primary, text-text-muted
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
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
  DollarSign,
  Zap,
  MessageSquare,
  Activity,
  Bot,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Layers,
  Repeat,
  FileText,
  Bookmark,
  Users,
  Calendar,
  Receipt,
  RefreshCw,
} from '../components/icons';
import { costsApi, summaryApi, clawsApi, soulsApi, workflowsApi } from '../api';
import type { ProviderBreakdown, DailyUsage } from '../api';
import type { SummaryData, CostsData } from '../types';
import { Skeleton } from '../components/Skeleton';
import { CHART_COLORS, STATE_COLORS, fmtCost, fmtTokens } from './analytics/format';
import {
  SectionCard,
  StatCard,
  MiniDonut,
  DonutLegend,
  ChartTooltip,
  EmptyChart,
} from './analytics/chart-primitives';
import {
  toDailySeries,
  toProviderDonut,
  toProviderRequests,
  toModelCostSeries,
  toCountSeries,
  toAgentBars,
  toTaskProgress,
} from './analytics/derive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  claws: number;
  workflows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reusable — matches dashboard card-elevated pattern
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data
  const [usage, setUsage] = useState<CostsData | null>(null);
  const [breakdown, setBreakdown] = useState<{
    byProvider: ProviderBreakdown[];
    byModel: ProviderBreakdown[];
    daily: DailyUsage[];
    totalCost: number;
  } | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [clawStats, setClawStats] = useState<ClawStats | null>(null);
  const [agentCounts, setAgentCounts] = useState<AgentCounts>({
    souls: 0,
    claws: 0,
    workflows: 0,
  });
  const [subscriptionData, setSubscriptionData] = useState<{
    subscriptions: Array<{
      providerId: string;
      displayName: string;
      monthlyCostUsd: number;
      planName?: string;
    }>;
    totalMonthlyUsd: number;
    counts: { subscription: number; payPerUse: number; free: number };
  } | null>(null);

  const fetchAll = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [usageRes, breakdownRes, summaryRes, clawStatsRes, soulsRes, wfRes, subsRes] =
          await Promise.allSettled([
            costsApi.usage(),
            costsApi.getBreakdown(period),
            summaryApi.get(),
            clawsApi.stats(),
            soulsApi.list(),
            workflowsApi.list(),
            costsApi.getSubscriptions(),
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
          claws: clawStatsRes.status === 'fulfilled' ? (clawStatsRes.value as ClawStats).total : 0,
          workflows: count(wfRes),
        });

        if (subsRes.status === 'fulfilled') setSubscriptionData(subsRes.value);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [period]
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Derived data — pure transforms, see ./analytics/derive
  const dailyData = toDailySeries(breakdown);
  const providerDonut = toProviderDonut(breakdown);
  const providerRequests = toProviderRequests(breakdown);
  const modelCostData = toModelCostSeries(breakdown);
  const clawModeData = toCountSeries(clawStats?.byMode);
  const clawStateData = toCountSeries(clawStats?.byState);
  const agentBarData = toAgentBars(agentCounts);
  const taskProgress = toTaskProgress(summary);
  const habitData = summary?.habits;

  // Axis styling
  const axisProps = { tick: { fontSize: 11 }, stroke: 'var(--color-text-muted, #94a3b8)' };
  const gridProps = {
    strokeDasharray: '3 3' as const,
    stroke: 'var(--color-border, #334155)',
    opacity: 0.4,
  };

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
            Analytics
          </h1>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            System-wide metrics and performance insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAll(true)}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex items-center bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg p-0.5">
            {(['week', 'month'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  period === p
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
                }`}
              >
                {p === 'week' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- KPI Row — matches dashboard stat cards exactly ---- */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <StatCard
          label="Today Cost"
          value={usage ? fmtCost(usage.daily.totalCost) : '$0'}
          sub={`${usage?.daily.totalRequests ?? 0} requests`}
          icon={DollarSign}
          color="text-indigo-500"
          bgColor="bg-indigo-500/10"
          link="/costs"
        />
        <StatCard
          label="Month Cost"
          value={usage ? fmtCost(usage.monthly.totalCost) : '$0'}
          sub={`${usage?.monthly.totalRequests ?? 0} requests`}
          icon={TrendingUp}
          color="text-violet-500"
          bgColor="bg-violet-500/10"
          link="/costs"
        />
        <StatCard
          label="Tokens Today"
          value={fmtTokens(usage?.daily.totalTokens ?? 0)}
          sub={`${fmtTokens(usage?.daily.totalInputTokens ?? 0)} in / ${fmtTokens(usage?.daily.totalOutputTokens ?? 0)} out`}
          icon={MessageSquare}
          color="text-cyan-500"
          bgColor="bg-cyan-500/10"
        />
        <StatCard
          label="Active Agents"
          value={agentCounts.souls + (clawStats?.running ?? 0)}
          sub={`${agentCounts.souls} souls, ${clawStats?.running ?? 0} claws`}
          icon={Bot}
          color="text-emerald-500"
          bgColor="bg-emerald-500/10"
          link="/autonomous"
        />
        <StatCard
          label="Claw Cycles"
          value={clawStats?.totalCycles ?? 0}
          sub={`${clawStats?.totalToolCalls ?? 0} tool calls`}
          icon={Zap}
          color="text-pink-500"
          bgColor="bg-pink-500/10"
          link="/claws"
        />
        <StatCard
          label="Tasks"
          value={summary?.tasks.total ?? 0}
          sub={`${summary?.tasks.completed ?? 0} done${summary?.tasks.overdue ? `, ${summary.tasks.overdue} overdue` : ''}`}
          icon={CheckCircle2}
          color="text-amber-500"
          bgColor="bg-amber-500/10"
          link="/tasks"
        />
      </div>

      {/* ---- Billing Overview ---- */}
      {subscriptionData &&
        (subscriptionData.subscriptions.length > 0 || subscriptionData.counts.free > 0) && (
          <SectionCard title="Billing Overview" icon={DollarSign} iconColor="text-violet-500">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Billing type distribution */}
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 flex-shrink-0">
                  <MiniDonut
                    data={[
                      { name: 'Pay-per-use', value: subscriptionData.counts.payPerUse },
                      { name: 'Subscription', value: subscriptionData.counts.subscription },
                      { name: 'Free', value: subscriptionData.counts.free },
                    ].filter((d) => d.value > 0)}
                    colors={['#3b82f6', '#8b5cf6', '#22c55e']}
                  />
                </div>
                <DonutLegend
                  data={[
                    { name: 'Pay-per-use (API)', value: subscriptionData.counts.payPerUse },
                    { name: 'Subscription', value: subscriptionData.counts.subscription },
                    { name: 'Free', value: subscriptionData.counts.free },
                  ].filter((d) => d.value > 0)}
                  colors={['#3b82f6', '#8b5cf6', '#22c55e']}
                />
              </div>

              {/* Monthly subscription total */}
              <div className="flex flex-col justify-center items-center">
                <p className="text-xs text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-1">
                  Monthly Subscriptions
                </p>
                <p className="text-3xl font-bold text-violet-500">
                  ${subscriptionData.totalMonthlyUsd.toFixed(2)}
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  {subscriptionData.subscriptions.length} subscription
                  {subscriptionData.subscriptions.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Subscription list */}
              <div className="space-y-2">
                {subscriptionData.subscriptions.length > 0 ? (
                  subscriptionData.subscriptions.map((sub) => (
                    <div
                      key={sub.providerId}
                      className="flex items-center justify-between p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
                    >
                      <div>
                        <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                          {sub.displayName}
                        </p>
                        {sub.planName && (
                          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
                            {sub.planName}
                          </p>
                        )}
                      </div>
                      <p className="text-sm font-bold text-violet-500">${sub.monthlyCostUsd}/mo</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-text-muted dark:text-dark-text-muted text-center py-4">
                    No subscriptions configured
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        )}

      {/* ---- Row 2: Cost Trend + Token Volume ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Cost Trend" icon={TrendingUp} iconColor="text-indigo-500">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v) => `$${v}`} />
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
            <EmptyChart message="No cost data for this period" />
          )}
        </SectionCard>

        <SectionCard title="Token Volume" icon={BarChart3} iconColor="text-violet-500">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dailyData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtTokens} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="inputTokens"
                  name="Input Tokens"
                  fill="#6366f1"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="outputTokens"
                  name="Output Tokens"
                  fill="#a855f7"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No token data for this period" />
          )}
        </SectionCard>
      </div>

      {/* ---- Row 3: Provider Breakdown + Model Cost + Agent Distribution + Requests ---- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SectionCard title="Cost by Provider" icon={DollarSign} iconColor="text-pink-500">
          {providerDonut.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-32 h-32 flex-shrink-0">
                <MiniDonut data={providerDonut} colors={CHART_COLORS} />
              </div>
              <DonutLegend data={providerDonut} colors={CHART_COLORS} />
            </div>
          ) : (
            <EmptyChart height={140} message="No cost data" />
          )}
        </SectionCard>

        <SectionCard title="Cost by Model" icon={BarChart3} iconColor="text-violet-500">
          {modelCostData.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={modelCostData} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={(v) => `$${v}`} />
                <YAxis dataKey="name" type="category" {...axisProps} width={80} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="cost" name="Cost" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={170} message="No model data" />
          )}
        </SectionCard>

        <SectionCard title="Agent Distribution" icon={Bot} iconColor="text-emerald-500">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={agentBarData} layout="vertical" margin={{ left: 0 }}>
              <CartesianGrid {...gridProps} horizontal={false} />
              <XAxis type="number" {...axisProps} />
              <YAxis dataKey="name" type="category" {...axisProps} width={80} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]}>
                {agentBarData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Requests by Provider" icon={Activity} iconColor="text-blue-500">
          {providerRequests.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={providerRequests} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis dataKey="name" type="category" {...axisProps} width={80} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="requests" name="Requests" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={170} message="No request data" />
          )}
        </SectionCard>
      </div>

      {/* ---- Row 4: Claw Mode/State + Task Gauge + Habits ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SectionCard title="Claws by Mode" icon={Zap} iconColor="text-pink-500">
          <div className="flex items-center gap-3">
            <div className="w-24 h-24 flex-shrink-0">
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
        </SectionCard>

        <SectionCard title="Claws by State" icon={Layers} iconColor="text-cyan-500">
          <div className="flex items-center gap-3">
            <div className="w-24 h-24 flex-shrink-0">
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
        </SectionCard>

        <SectionCard title="Task Completion" icon={CheckCircle2} iconColor="text-success">
          {taskProgress && taskProgress.total > 0 ? (
            <div className="flex flex-col items-center">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                    data={[{ name: 'Done', value: taskProgress.pct, fill: '#22c55e' }]}
                  >
                    <RadialBar
                      dataKey="value"
                      cornerRadius={10}
                      background={{ fill: 'var(--color-bg-tertiary, #1e293b)' }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary -mt-3">
                {taskProgress.pct}%
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                {taskProgress.completed}/{taskProgress.total} tasks
              </p>
            </div>
          ) : (
            <EmptyChart height={120} message="No tasks" />
          )}
        </SectionCard>

        <SectionCard title="Habits Today" icon={Repeat} iconColor="text-emerald-500">
          {habitData && habitData.totalToday > 0 ? (
            <div className="flex flex-col items-center">
              <div className="w-24 h-24">
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
                      background={{ fill: 'var(--color-bg-tertiary, #1e293b)' }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary -mt-3">
                {habitData.percentage}%
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                {habitData.completedToday}/{habitData.totalToday} habits | {habitData.bestStreak}d
                streak
              </p>
            </div>
          ) : (
            <EmptyChart height={120} message="No habits today" />
          )}
        </SectionCard>
      </div>

      {/* ---- Row 5: Daily Requests + Claw Summary ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard
          title="Daily Requests"
          icon={Activity}
          iconColor="text-blue-500"
          className="lg:col-span-2"
        >
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} />
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
            <EmptyChart height={200} message="No request data" />
          )}
        </SectionCard>

        <SectionCard title="Claw Runtime" icon={Zap} iconColor="text-pink-500">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Total', value: clawStats?.total ?? 0, color: 'text-indigo-500' },
              { label: 'Running', value: clawStats?.running ?? 0, color: 'text-emerald-500' },
              { label: 'Cycles', value: clawStats?.totalCycles ?? 0, color: 'text-violet-500' },
              {
                label: 'Tool Calls',
                value: clawStats?.totalToolCalls ?? 0,
                color: 'text-pink-500',
              },
              { label: 'Cost', value: fmtCost(clawStats?.totalCost ?? 0), color: 'text-amber-500' },
              { label: 'Workflows', value: agentCounts.workflows, color: 'text-cyan-500' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary p-2.5 text-center"
              >
                <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                <p className="text-[10px] font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---- Row 6: Personal Data Overview ---- */}
      {summary && (
        <SectionCard title="Personal Data" icon={FileText} iconColor="text-indigo-500">
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
            {[
              {
                label: 'Tasks',
                value: summary.tasks.total,
                icon: CheckCircle2,
                color: 'text-indigo-500',
                bgColor: 'bg-indigo-500/10',
                link: '/tasks',
              },
              {
                label: 'Notes',
                value: summary.notes.total,
                icon: FileText,
                color: 'text-orange-500',
                bgColor: 'bg-orange-500/10',
                link: '/notes',
              },
              {
                label: 'Events',
                value: summary.calendar.total,
                icon: Calendar,
                color: 'text-emerald-500',
                bgColor: 'bg-emerald-500/10',
                link: '/calendar',
              },
              {
                label: 'Contacts',
                value: summary.contacts.total,
                icon: Users,
                color: 'text-purple-500',
                bgColor: 'bg-purple-500/10',
                link: '/contacts',
              },
              {
                label: 'Bookmarks',
                value: summary.bookmarks.total,
                icon: Bookmark,
                color: 'text-blue-500',
                bgColor: 'bg-blue-500/10',
                link: '/bookmarks',
              },
              {
                label: 'Habits',
                value: habitData?.total ?? 0,
                icon: Repeat,
                color: 'text-emerald-500',
                bgColor: 'bg-emerald-500/10',
                link: '/habits',
              },
              {
                label: 'Expenses',
                value: summary.expenses?.total ?? 0,
                icon: Receipt,
                color: 'text-orange-500',
                bgColor: 'bg-orange-500/10',
                link: '/expenses',
              },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.link}
                className="flex flex-col items-center p-3 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
              >
                <div
                  className={`w-10 h-10 rounded-lg ${item.bgColor} flex items-center justify-center mb-1.5`}
                >
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                  {item.value}
                </p>
                <p className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                  {item.label}
                </p>
              </Link>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

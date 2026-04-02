import { useState, useEffect, useCallback } from 'react';
import { formatNumber } from '../utils/formatters';
import { costsApi } from '../api';
import type { CostSummary, BudgetStatus, ProviderBreakdown, DailyUsage } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../components/ToastProvider';
import { DollarSign, Home, BarChart, TrendingUp, Calendar, Layers, RefreshCw, AlertTriangle } from '../components/icons';
import { EmptyState } from '../components/EmptyState';
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { PageHomeTab } from '../components/PageHomeTab';

type Period = 'day' | 'week' | 'month' | 'year';

export function CostsPage() {
  const toast = useToast();

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:costs:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [breakdown, setBreakdown] = useState<{
    byProvider: ProviderBreakdown[];
    daily: DailyUsage[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'overview' | 'breakdown' | 'budget'>('home');

  // Auto-redirect to overview if skipHome is enabled
  useEffect(() => {
    if (skipHome && activeTab === 'home') {
      setActiveTab('overview');
    }
  }, [skipHome, activeTab]);

  // Budget form state
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [weeklyLimit, setWeeklyLimit] = useState<string>('');
  const [monthlyLimit, setMonthlyLimit] = useState<string>('');
  const [savingBudget, setSavingBudget] = useState(false);

  const fetchCosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch summary
      const summaryData = await costsApi.getSummary(period);
      setSummary(summaryData.summary);
      setBudget(summaryData.budget);

      // Fetch breakdown
      const breakdownData = await costsApi.getBreakdown(period);
      setBreakdown({
        byProvider: breakdownData.byProvider,
        daily: breakdownData.daily,
      });
    } catch {
      setError('Failed to fetch cost data');
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  const saveBudget = useCallback(async () => {
    setSavingBudget(true);
    try {
      const body: Record<string, number> = {};
      if (dailyLimit) body.dailyLimit = parseFloat(dailyLimit);
      if (weeklyLimit) body.weeklyLimit = parseFloat(weeklyLimit);
      if (monthlyLimit) body.monthlyLimit = parseFloat(monthlyLimit);

      const data = await costsApi.setBudget(body);
      setBudget(data.status);
      toast.success('Budget saved');
    } catch {
      toast.error('Failed to save budget');
    } finally {
      setSavingBudget(false);
    }
  }, [dailyLimit, weeklyLimit, monthlyLimit, toast]);

  if (isLoading && !summary) {
    return <LoadingSpinner message="Loading cost data..." />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Cost Dashboard
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            AI usage costs and budget tracking
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-2">
          {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                period === p
                  ? 'bg-success text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'overview', 'breakdown', 'budget'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Home tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-auto p-4">
          <PageHomeTab
            heroIcons={[
              { icon: DollarSign, color: 'text-primary bg-primary/10' },
              { icon: BarChart, color: 'text-emerald-500 bg-emerald-500/10' },
              { icon: TrendingUp, color: 'text-violet-500 bg-violet-500/10' },
            ]}
            title="Track Your AI Spending"
            subtitle="Monitor API usage costs across all providers — daily breakdowns, monthly trends, and spending alerts."
            cta={{
              label: 'View Daily Costs',
              icon: Calendar,
              onClick: () => setActiveTab('overview'),
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Costs"
            features={[
              {
                icon: Calendar,
                color: 'text-primary bg-primary/10',
                title: 'Daily Breakdown',
                description:
                  'See exactly how much you spend each day across all AI providers and models.',
              },
              {
                icon: BarChart,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Monthly Overview',
                description:
                  'Track monthly spending trends and compare usage across billing periods.',
              },
              {
                icon: Layers,
                color: 'text-orange-500 bg-orange-500/10',
                title: 'Provider Costs',
                description: 'Break down costs by provider to understand where your budget goes.',
              },
              {
                icon: TrendingUp,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Usage Analytics',
                description:
                  'Analyze token usage patterns and identify opportunities to optimize costs.',
              },
            ]}
            steps={[
              {
                title: 'Connect providers',
                detail: 'Add your API keys for each AI provider you use.',
              },
              {
                title: 'View cost dashboard',
                detail: 'Monitor real-time spending across all connected providers.',
              },
              {
                title: 'Set budget alerts',
                detail: 'Configure daily, weekly, and monthly spending limits.',
              },
              {
                title: 'Optimize usage',
                detail: 'Use analytics to reduce costs without sacrificing quality.',
              },
            ]}
            quickActions={[
              {
                icon: Calendar,
                label: 'Daily View',
                description: 'View daily cost breakdown',
                onClick: () => setActiveTab('overview'),
              },
              {
                icon: BarChart,
                label: 'Monthly View',
                description: 'View monthly cost trends',
                onClick: () => setActiveTab('breakdown'),
              },
            ]}
          />
        </div>
      )}

      {/* Content */}
      {activeTab !== 'home' && (
        <div className="flex-1 overflow-auto p-4 animate-fade-in-up">
          {error && (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load cost data"
              description={error}
              variant="card"
              iconBgColor="bg-orange-500/10 dark:bg-orange-500/20"
              iconColor="text-orange-500"
              action={{
                label: 'Try Again',
                onClick: fetchCosts,
                icon: RefreshCw,
              }}
            />
          )}

          {activeTab === 'overview' && summary && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                  <div className="text-sm text-text-muted dark:text-dark-text-muted">
                    Total Cost
                  </div>
                  <div className="text-2xl font-bold text-success">
                    {summary.totalCostFormatted}
                  </div>
                </div>
                <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                  <div className="text-sm text-text-muted dark:text-dark-text-muted">Requests</div>
                  <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                    {formatNumber(summary.totalRequests)}
                  </div>
                  <div className="text-xs text-text-muted">
                    {summary.failedRequests > 0 && (
                      <span className="text-error">{summary.failedRequests} failed</span>
                    )}
                  </div>
                </div>
                <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                  <div className="text-sm text-text-muted dark:text-dark-text-muted">
                    Input Tokens
                  </div>
                  <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                    {formatNumber(summary.totalInputTokens)}
                  </div>
                </div>
                <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                  <div className="text-sm text-text-muted dark:text-dark-text-muted">
                    Output Tokens
                  </div>
                  <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                    {formatNumber(summary.totalOutputTokens)}
                  </div>
                </div>
              </div>

              {/* Budget Status */}
              {budget && (
                <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                  <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-4">
                    Budget Status
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(['daily', 'weekly', 'monthly'] as const).map((p) => {
                      const b = budget[p];
                      return (
                        <div key={p} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-text-secondary dark:text-dark-text-secondary capitalize">
                              {p}
                            </span>
                            <span className="text-text-primary dark:text-dark-text-primary">
                              ${b.spent.toFixed(2)} {b.limit ? `/ $${b.limit.toFixed(2)}` : ''}
                            </span>
                          </div>
                          {b.limit && (
                            <div className="h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  b.percentage > 90
                                    ? 'bg-error'
                                    : b.percentage > 75
                                      ? 'bg-warning'
                                      : 'bg-success'
                                }`}
                                style={{ width: `${Math.min(b.percentage, 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {budget.alerts.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {budget.alerts.map((alert, i) => (
                        <div key={i} className="p-2 bg-warning/5 text-warning rounded text-sm">
                          {alert.type} budget at {alert.threshold}% - $
                          {alert.currentSpend.toFixed(2)} / ${alert.limit.toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Daily Cost Trend */}
              {breakdown && breakdown.daily.length > 0 && (
                <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                  <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-success" />
                    Daily Cost Trend
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart
                      data={breakdown.daily.map((d) => ({
                        ...d,
                        date: new Date(d.date).toLocaleDateString('en', {
                          month: 'short',
                          day: 'numeric',
                        }),
                      }))}
                    >
                      <defs>
                        <linearGradient id="costAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border, #334155)"
                        opacity={0.4}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-text-muted, #94a3b8)"
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-text-muted, #94a3b8)"
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--color-bg-secondary, #1e293b)',
                          border: '1px solid var(--color-border, #334155)',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(value: unknown) => [`$${Number(value).toFixed(4)}`, 'Cost']}
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="#22c55e"
                        fill="url(#costAreaGrad)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Token Volume */}
              {breakdown && breakdown.daily.length > 0 && (
                <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                  <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
                    <BarChart className="w-4 h-4 text-indigo-500" />
                    Token Volume
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <RechartsBarChart
                      data={breakdown.daily.map((d) => ({
                        ...d,
                        date: new Date(d.date).toLocaleDateString('en', {
                          month: 'short',
                          day: 'numeric',
                        }),
                      }))}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border, #334155)"
                        opacity={0.4}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-text-muted, #94a3b8)"
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-text-muted, #94a3b8)"
                        tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--color-bg-secondary, #1e293b)',
                          border: '1px solid var(--color-border, #334155)',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="inputTokens"
                        name="Input"
                        fill="#6366f1"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="outputTokens"
                        name="Output"
                        fill="#a855f7"
                        radius={[3, 3, 0, 0]}
                      />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === 'breakdown' && breakdown && (
            <div className="space-y-6">
              {/* Provider Cost Distribution */}
              {breakdown.byProvider.filter((p) => p.cost > 0).length > 0 && (
                <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                  <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2 mb-4">
                    <DollarSign className="w-4 h-4 text-pink-500" />
                    Cost Distribution
                  </h3>
                  <div className="flex items-center gap-8">
                    <div className="w-48 h-48 flex-shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={breakdown.byProvider
                              .filter((p) => p.cost > 0)
                              .map((p) => ({
                                name: p.provider,
                                value: Math.round(p.cost * 100) / 100,
                              }))}
                            cx="50%"
                            cy="50%"
                            innerRadius="50%"
                            outerRadius="85%"
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                          >
                            {breakdown.byProvider
                              .filter((p) => p.cost > 0)
                              .map((_, i) => (
                                <Cell
                                  key={i}
                                  fill={
                                    [
                                      '#6366f1',
                                      '#8b5cf6',
                                      '#ec4899',
                                      '#f97316',
                                      '#22c55e',
                                      '#06b6d4',
                                      '#3b82f6',
                                      '#eab308',
                                    ][i % 8]
                                  }
                                />
                              ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: 'var(--color-bg-secondary, #1e293b)',
                              border: '1px solid var(--color-border, #334155)',
                              borderRadius: '8px',
                              fontSize: '12px',
                            }}
                            formatter={(value: unknown) => [`$${Number(value).toFixed(4)}`, 'Cost']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 min-w-0">
                      {breakdown.byProvider
                        .filter((p) => p.cost > 0)
                        .map((p, i) => (
                          <div key={p.provider} className="flex items-center gap-2 text-sm">
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{
                                background: [
                                  '#6366f1',
                                  '#8b5cf6',
                                  '#ec4899',
                                  '#f97316',
                                  '#22c55e',
                                  '#06b6d4',
                                  '#3b82f6',
                                  '#eab308',
                                ][i % 8],
                              }}
                            />
                            <span className="text-text-muted dark:text-dark-text-muted capitalize truncate">
                              {p.provider}
                            </span>
                            <span className="ml-auto font-medium text-text-primary dark:text-dark-text-primary whitespace-nowrap">
                              {p.costFormatted}
                            </span>
                            <span className="text-text-muted dark:text-dark-text-muted text-xs w-12 text-right">
                              {p.percentOfTotal.toFixed(0)}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Provider Breakdown List */}
              <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                <div className="p-4 border-b border-border dark:border-dark-border">
                  <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                    <Layers className="w-4 h-4 text-orange-500" />
                    Provider Details
                  </h3>
                </div>
                <div className="divide-y divide-border dark:divide-dark-border">
                  {breakdown.byProvider.map((provider) => (
                    <div key={provider.provider} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center text-sm font-medium">
                          {provider.provider.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-text-primary dark:text-dark-text-primary capitalize">
                            {provider.provider}
                          </div>
                          <div className="text-sm text-text-muted">
                            {formatNumber(provider.requests)} requests
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-text-primary dark:text-dark-text-primary">
                          {provider.costFormatted}
                        </div>
                        <div className="text-sm text-text-muted">
                          {provider.percentOfTotal.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  ))}
                  {breakdown.byProvider.length === 0 && (
                    <div className="p-8 text-center text-text-muted">No usage data yet</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'budget' && (
            <div className="space-y-6">
              <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-6">
                <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-4">
                  Configure Budget Limits
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-text-secondary dark:text-dark-text-secondary mb-1">
                      Daily Limit (USD)
                    </label>
                    <input
                      type="number"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      placeholder={budget?.daily.limit?.toString() ?? 'No limit'}
                      className="w-full px-3 py-2 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-success"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-text-secondary dark:text-dark-text-secondary mb-1">
                      Weekly Limit (USD)
                    </label>
                    <input
                      type="number"
                      value={weeklyLimit}
                      onChange={(e) => setWeeklyLimit(e.target.value)}
                      placeholder={budget?.weekly.limit?.toString() ?? 'No limit'}
                      className="w-full px-3 py-2 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-success"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-text-secondary dark:text-dark-text-secondary mb-1">
                      Monthly Limit (USD)
                    </label>
                    <input
                      type="number"
                      value={monthlyLimit}
                      onChange={(e) => setMonthlyLimit(e.target.value)}
                      placeholder={budget?.monthly.limit?.toString() ?? 'No limit'}
                      className="w-full px-3 py-2 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-success"
                    />
                  </div>

                  <button
                    onClick={saveBudget}
                    disabled={savingBudget}
                    className="w-full py-2 px-4 bg-success hover:bg-success/90 disabled:bg-success/60 text-white rounded-lg transition-colors"
                  >
                    {savingBudget ? 'Saving...' : 'Save Budget'}
                  </button>
                </div>
              </div>

              <div className="bg-warning/5 border border-warning/30 rounded-lg p-4">
                <h4 className="font-medium text-warning mb-2">About Budget Alerts</h4>
                <p className="text-sm text-warning">
                  Budget alerts are triggered at 50%, 75%, 90%, and 100% of your configured limits.
                  Alerts help you monitor spending but don't automatically block requests.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

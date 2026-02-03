import { useState, useEffect, useCallback } from 'react';
import { costsApi } from '../api';
import type { CostSummary, BudgetStatus, ProviderBreakdown, DailyUsage } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../components/ToastProvider';
import { DollarSign } from '../components/icons';

type Period = 'day' | 'week' | 'month' | 'year';

export function CostsPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [breakdown, setBreakdown] = useState<{
    byProvider: ProviderBreakdown[];
    daily: DailyUsage[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'breakdown' | 'budget'>('overview');

  // Budget form state
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [weeklyLimit, setWeeklyLimit] = useState<string>('');
  const [monthlyLimit, setMonthlyLimit] = useState<string>('');
  const [savingBudget, setSavingBudget] = useState(false);

  const fetchCosts = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  const saveBudget = async () => {
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
      setError('Failed to save budget');
    } finally {
      setSavingBudget(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  if (loading && !summary) {
    return <LoadingSpinner message="Loading cost data..." />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <DollarSign className="w-6 h-6 text-success" />
          <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">Cost Dashboard</h1>
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
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-2 border-b border-border dark:border-dark-border">
        {(['overview', 'breakdown', 'budget'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary'
                : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 animate-fade-in-up">
        {error && (
          <div className="mb-4 p-3 bg-error/10 text-error rounded-lg">
            {error}
          </div>
        )}

        {activeTab === 'overview' && summary && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Total Cost</div>
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
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Input Tokens</div>
                <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                  {formatNumber(summary.totalInputTokens)}
                </div>
              </div>
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                <div className="text-sm text-text-muted dark:text-dark-text-muted">Output Tokens</div>
                <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                  {formatNumber(summary.totalOutputTokens)}
                </div>
              </div>
            </div>

            {/* Budget Status */}
            {budget && (
              <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-4">Budget Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['daily', 'weekly', 'monthly'] as const).map((p) => {
                    const b = budget[p];
                    return (
                      <div key={p} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary dark:text-dark-text-secondary capitalize">{p}</span>
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
                      <div
                        key={i}
                        className="p-2 bg-warning/5 text-warning rounded text-sm"
                      >
                        {alert.type} budget at {alert.threshold}% - ${alert.currentSpend.toFixed(2)} / ${alert.limit.toFixed(2)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Daily Chart */}
            {breakdown && breakdown.daily.length > 0 && (
              <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-4">Daily Usage</h3>
                <div className="flex gap-1 items-end h-32">
                  {breakdown.daily.slice(-14).map((day) => {
                    const maxCost = Math.max(...breakdown.daily.map((d) => d.cost));
                    const height = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                    return (
                      <div
                        key={day.date}
                        className="flex-1 group relative"
                        title={`${day.date}: ${day.costFormatted}`}
                      >
                        <div
                          className="bg-success rounded-t transition-all hover:bg-success/80"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                          {day.date}: {day.costFormatted}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-text-muted">
                  <span>{breakdown.daily[0]?.date}</span>
                  <span>{breakdown.daily[breakdown.daily.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'breakdown' && breakdown && (
          <div className="space-y-6">
            {/* Provider Breakdown */}
            <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
              <div className="p-4 border-b border-border dark:border-dark-border">
                <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary">By Provider</h3>
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
              <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-4">Configure Budget Limits</h3>

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
    </div>
  );
}

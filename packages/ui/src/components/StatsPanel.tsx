/**
 * Stats Panel Component
 *
 * Right sidebar displaying real-time stats:
 * - Personal data counts (tasks, notes, etc.)
 * - Token/cost usage (actual data)
 * - Provider/model info
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { formatNumber } from '../utils/formatters';
import { useGateway } from '../hooks/useWebSocket';
import {
  Activity,
  Brain,
  DollarSign,
  Hash,
  PanelRight,
  ChevronRight,
  CheckCircle2,
  FileText,
  Calendar,
  Users,
  Bookmark,
  AlertCircle,
  TrendingUp,
  Cpu,
} from './icons';
import { summaryApi, costsApi, providersApi, modelsApi } from '../api';
import type { SummaryData, CostsData } from '../types';
import { LoadingSpinner } from './LoadingSpinner';

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
  alert?: boolean;
}

function StatCard({ icon: Icon, label, value, subValue, color = 'text-primary', alert }: StatCardProps) {
  return (
    <div className={`p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg ${alert ? 'ring-1 ring-error' : ''}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${alert ? 'text-error' : color}`} />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold ${alert ? 'text-error' : 'text-text-primary dark:text-dark-text-primary'}`}>
          {value}
        </span>
        {subValue && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted">{subValue}</span>
        )}
      </div>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

interface StatsPanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function StatsPanel({ isCollapsed, onToggle }: StatsPanelProps) {
  const { status: wsStatus, subscribe } = useGateway();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [providerCount, setProviderCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchStats(), 2000);
  }, []);

  // Fetch stats only when panel is expanded; poll every 30s
  useEffect(() => {
    if (isCollapsed) return;
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => {
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isCollapsed]);

  // WS-triggered refresh
  useEffect(() => {
    const unsubs = [
      subscribe('system:notification', debouncedRefresh),
      subscribe('channel:message', debouncedRefresh),
      subscribe('tool:end', debouncedRefresh),
      subscribe('data:changed', debouncedRefresh),
      subscribe('trigger:executed', debouncedRefresh),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, debouncedRefresh]);

  const fetchStats = async () => {
    try {
      const results = await Promise.allSettled([
        summaryApi.get(),
        costsApi.usage(),
        providersApi.list(),
        modelsApi.list(),
      ]);

      if (results[0].status === 'fulfilled') setSummary(results[0].value);
      if (results[1].status === 'fulfilled') setCosts(results[1].value);
      if (results[2].status === 'fulfilled') {
        const providersList = results[2].value.providers as Array<{ isConfigured?: boolean }>;
        setProviderCount(providersList?.filter((p) => p.isConfigured).length ?? 0);
      }
      if (results[3].status === 'fulfilled') {
        setModelCount(results[3].value.models?.length ?? 0);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  // Collapsed state
  if (isCollapsed) {
    return (
      <aside className="w-12 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col">
        <button
          onClick={onToggle}
          className="p-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Expand stats panel"
          aria-label="Expand stats panel"
        >
          <PanelRight className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
        </button>

        <div className="flex-1 flex flex-col items-center gap-2 py-4">
          {summary && summary.tasks.overdue > 0 && (
            <div className="p-2 rounded-lg bg-error/10" title={`${summary.tasks.overdue} overdue tasks`}>
              <AlertCircle className="w-4 h-4 text-error" />
            </div>
          )}
          <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary" title={`${summary?.tasks.total ?? 0} tasks`}>
            <CheckCircle2 className="w-4 h-4 text-primary" />
          </div>
          <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary" title={`${costs?.daily.totalTokens ?? 0} tokens today`}>
            <Hash className="w-4 h-4 text-success" />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border dark:border-dark-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Stats
        </h3>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
          title="Collapse panel"
          aria-label="Collapse panel"
        >
          <ChevronRight className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <LoadingSpinner size="sm" message="Loading..." />
        ) : (
          <>
            {/* Personal Data */}
            {summary && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                  Personal Data
                </h4>
                <StatCard
                  icon={CheckCircle2}
                  label="Tasks"
                  value={summary.tasks.total}
                  subValue={summary.tasks.pending > 0 ? `${summary.tasks.pending} pending` : undefined}
                  color="text-primary"
                  alert={summary.tasks.overdue > 0}
                />
                {summary.tasks.overdue > 0 && (
                  <div className="px-3 py-2 bg-error/10 rounded-lg text-xs text-error flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    {summary.tasks.overdue} overdue task{summary.tasks.overdue > 1 ? 's' : ''}
                  </div>
                )}
                {summary.tasks.dueToday > 0 && (
                  <div className="px-3 py-2 bg-warning/10 rounded-lg text-xs text-warning flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    {summary.tasks.dueToday} due today
                  </div>
                )}
                <StatCard
                  icon={FileText}
                  label="Notes"
                  value={summary.notes.total}
                  subValue={summary.notes.pinned > 0 ? `${summary.notes.pinned} pinned` : undefined}
                  color="text-warning"
                />
                <StatCard
                  icon={Calendar}
                  label="Events"
                  value={summary.calendar.total}
                  subValue={summary.calendar.upcoming > 0 ? `${summary.calendar.upcoming} upcoming` : undefined}
                  color="text-success"
                />
                <StatCard
                  icon={Users}
                  label="Contacts"
                  value={summary.contacts.total}
                  color="text-purple-500"
                />
                <StatCard
                  icon={Bookmark}
                  label="Bookmarks"
                  value={summary.bookmarks.total}
                  subValue={summary.bookmarks.favorites > 0 ? `${summary.bookmarks.favorites} favorites` : undefined}
                  color="text-blue-500"
                />
              </div>
            )}

            {/* Usage Stats */}
            {costs && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                  API Usage
                </h4>
                <StatCard
                  icon={Hash}
                  label="Tokens Today"
                  value={formatNumber(costs.daily.totalTokens)}
                  color="text-primary"
                />
                <StatCard
                  icon={DollarSign}
                  label="Cost Today"
                  value={formatCurrency(costs.daily.totalCost)}
                  color="text-success"
                />
                <StatCard
                  icon={TrendingUp}
                  label="This Month"
                  value={formatCurrency(costs.monthly.totalCost)}
                  subValue={`${formatNumber(costs.monthly.totalTokens)} tokens`}
                  color="text-text-secondary"
                />
              </div>
            )}

            {/* System Info */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                System
              </h4>
              <StatCard
                icon={Brain}
                label="Providers"
                value={providerCount}
                subValue="configured"
                color="text-primary"
              />
              <StatCard
                icon={Cpu}
                label="Models"
                value={modelCount}
                subValue="available"
                color="text-text-secondary"
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border dark:border-dark-border">
        <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
          {wsStatus === 'connected' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span>Live</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span>Updates every 30s</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

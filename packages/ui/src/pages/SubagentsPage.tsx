/**
 * Subagents Page — Ephemeral single-task agent executions
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import {
  Bot,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Home,
} from '../components/icons';
import { subagentsApi } from '../api/endpoints/subagents';
import type { SubagentHistoryEntry } from '../api/endpoints/subagents';

type TabId = 'home' | 'subagents';

const TAB_LABELS: Record<TabId, string> = { home: 'Home', subagents: 'Subagents' };

interface SubagentStats {
  active: number;
  total: number;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  errorRate: number;
  byState: Record<string, number>;
  totalTokens: { input: number; output: number };
}

interface SubagentHealth {
  status: string;
  score: number;
  signals: string[];
  recommendations: string[];
}

export function SubagentsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { subscribe } = useGateway();

  const SKIP_HOME_KEY = 'ownpilot:subagents:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try { return localStorage.getItem(SKIP_HOME_KEY) === 'true'; } catch { return false; }
  });

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'subagents'] as string[]).includes(tabParam) ? tabParam : 'home';

  useEffect(() => {
    if (skipHome && !tabParam) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'subagents');
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [skipHome, tabParam, searchParams, navigate]);

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try { localStorage.setItem(SKIP_HOME_KEY, String(checked)); } catch { /* */ }
  }, []);

  const [stats, setStats] = useState<SubagentStats | null>(null);
  const [health, setHealth] = useState<SubagentHealth | null>(null);
  const [history, setHistory] = useState<SubagentHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [statsData, healthData, historyData] = await Promise.all([
        subagentsApi.stats().catch(() => null),
        subagentsApi.health().catch(() => null),
        subagentsApi.getHistory(undefined, 50, 0).catch(() => ({ entries: [], total: 0 })),
      ]);
      setStats(statsData);
      setHealth(healthData);
      setHistory(historyData.entries);
    } catch {
      toast.error('Failed to load subagent data');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const unsubs = [
      subscribe('subagent:spawned', loadData),
      subscribe('subagent:completed', loadData),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, loadData]);

  const healthColor = health?.status === 'healthy' ? 'text-green-500' :
    health?.status === 'watch' ? 'text-yellow-500' : 'text-red-500';

  const statCards = stats ? [
    { label: 'Total Runs', value: stats.total.toLocaleString(), icon: Bot, color: 'text-blue-500' },
    { label: 'Active', value: stats.active.toString(), icon: Activity, color: 'text-green-500' },
    { label: 'Success Rate', value: `${(stats.successRate * 100).toFixed(1)}%`, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: 'Error Rate', value: `${(stats.errorRate * 100).toFixed(1)}%`, icon: XCircle, color: 'text-red-500' },
    { label: 'Avg Cost', value: `$${stats.avgCost.toFixed(4)}`, icon: DollarSign, color: 'text-amber-500' },
    { label: 'Avg Duration', value: `${stats.avgDuration.toFixed(0)}ms`, icon: Clock, color: 'text-purple-500' },
    { label: 'Total Cost', value: `$${stats.totalCost.toFixed(4)}`, icon: DollarSign, color: 'text-indigo-500' },
    { label: 'Input Tokens', value: `${(stats.totalTokens.input / 1000).toFixed(1)}K`, icon: Activity, color: 'text-cyan-500' },
  ] : [];

  const activeSessions = history.filter((s) => s.state === 'running' || s.state === 'pending');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">Subagents</h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {stats ? `${stats.total} total · ${stats.active} active` : 'Loading...'}
          </p>
        </div>
        {health && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${healthColor} bg-opacity-20`}>
            {health.status} ({health.score})
          </span>
        )}
      </header>

      {/* Stats strip */}
      {stats && (
        <div className="flex items-center gap-4 px-6 py-2 border-b border-border dark:border-dark-border bg-bg-tertiary/50">
          {[
            { label: 'Total', value: stats.total.toLocaleString() },
            { label: 'Success', value: `${(stats.successRate * 100).toFixed(1)}%` },
            { label: 'Avg Cost', value: `$${stats.avgCost.toFixed(4)}` },
            { label: 'Avg Duration', value: `${(stats.avgDuration / 1000).toFixed(1)}s` },
            { label: 'Total Cost', value: `$${stats.totalCost.toFixed(4)}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-medium text-text-secondary dark:text-dark-text-secondary">{value}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'subagents'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Hero */}
            <div className="text-center py-8 space-y-3">
              <div className="flex justify-center gap-3 mb-4">
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center bg-primary/10 text-primary">
                  <Bot className="w-6 h-6" />
                </span>
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center bg-emerald-500/10 text-emerald-500">
                  <Activity className="w-6 h-6" />
                </span>
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center bg-cyan-500/10 text-cyan-500">
                  <Clock className="w-6 h-6" />
                </span>
              </div>
              <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                Subagent Observability
              </h1>
              <p className="text-text-secondary dark:text-dark-text-secondary max-w-xl mx-auto">
                Monitor ephemeral single-task agent executions — spawned on-demand, completing in seconds to minutes.
              </p>
              <button
                onClick={() => setTab('subagents')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors mt-2"
              >
                <Bot className="w-4 h-4" />
                View Executions
              </button>
              {handleSkipHomeChange && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <input
                    type="checkbox"
                    id="skip-home"
                    checked={skipHome}
                    onChange={(e) => handleSkipHomeChange(e.target.checked)}
                    className="w-4 h-4 rounded border-border dark:border-dark-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="skip-home" className="text-sm text-text-secondary dark:text-dark-text-secondary cursor-pointer">
                    Skip this screen next time
                  </label>
                </div>
              )}
            </div>

            {/* Stats grid */}
            {stats && (
              <div className="grid grid-cols-4 gap-4">
                {statCards.map((card) => (
                  <div key={card.label} className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <card.icon className={`w-4 h-4 ${card.color}`} />
                      <span className="text-xs text-muted">{card.label}</span>
                    </div>
                    <div className="text-xl font-semibold">{card.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Health signals */}
            {health && health.signals.length > 0 && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <h3 className="text-sm font-medium text-yellow-500 mb-2">Health Signals</h3>
                <ul className="space-y-1">
                  {health.signals.map((s, i) => <li key={i} className="text-xs text-yellow-400">• {s}</li>)}
                </ul>
                {health.recommendations.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {health.recommendations.map((r, i) => <li key={i} className="text-xs text-yellow-600">→ {r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subagents tab */}
      {activeTab === 'subagents' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Recent Executions</h2>
            <span className="text-xs text-muted">
              {isLoading ? 'Loading...' : `${history.length} total · ${activeSessions.length} active`}
            </span>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-muted text-sm">No subagent executions yet</div>
            ) : (
              history.map((session) => (
                <div key={session.id} className="bg-card border border-border dark:border-dark-border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Bot className="w-4 h-4 text-accent" />
                      <div>
                        <div className="text-sm font-medium">{session.name}</div>
                        <div className="text-xs text-muted">{session.task?.slice(0, 80)}{session.task && session.task.length > 80 ? '...' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        session.state === 'completed' ? 'bg-green-500/20 text-green-400' :
                        session.state === 'failed' ? 'bg-red-500/20 text-red-400' :
                        session.state === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        session.state === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>{session.state}</span>
                      {session.durationMs != null && (
                        <span className="text-xs text-muted">{session.durationMs}ms</span>
                      )}
                    </div>
                  </div>
                  {session.error && (
                    <div className="mt-2 text-xs text-error bg-error/10 rounded px-2 py-1">{session.error}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
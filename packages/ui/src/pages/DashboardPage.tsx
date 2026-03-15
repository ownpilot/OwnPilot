import { useState, useEffect } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { useDebouncedCallback } from '../hooks';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  FileText,
  Bookmark,
  Repeat,
  Users,
  Calendar,
  AlertTriangle,
  Clock,
  TrendingUp,
  Lightbulb,
  LayoutDashboard,
  Brain,
  Puzzle,
  Zap,
  RefreshCw,
} from '../components/icons';
import { AIBriefingCard } from '../components/AIBriefingCard';
import { TimelineView } from '../components/TimelineView';
import { SkeletonStats, SkeletonCard } from '../components/Skeleton';
import { QUICK_ADD_ITEMS, QuickAddModal } from '../components/QuickAddModal';
import { ArtifactCard } from '../components/ArtifactCard';
import { artifactsApi } from '../api/endpoints/artifacts';
import type { Artifact } from '../api/endpoints/artifacts';
import type { QuickAddType } from '../components/QuickAddModal';

import { summaryApi } from '../api';
import type { SummaryData } from '../types';

import {
  SystemStatsWidget,
  SoulAgentsWidget,
  BackgroundAgentsWidget,
  WorkflowsWidget,
  SkillsWidget,
  HeartbeatLogsWidget,
  CrewsWidget,
  SubagentsWidget,
  FleetWidget,
} from '../components/dashboard';

type TabId = 'overview' | 'agents' | 'automation' | 'extensions';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Brain },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
];

export function DashboardPage() {
  const { subscribe } = useGateway();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [quickAddType, setQuickAddType] = useState<QuickAddType | null>(null);
  const [pinnedArtifacts, setPinnedArtifacts] = useState<Artifact[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchPinnedArtifacts = async () => {
    try {
      const result = await artifactsApi.list({ pinned: true, limit: 20 });
      setPinnedArtifacts(result.artifacts);
    } catch {
      // silent — not critical for dashboard
    }
  };

  const fetchSummary = async () => {
    try {
      setError(null);
      const data = await summaryApi.get();
      setSummary(data);
      setLastUpdated(new Date());
    } catch {
      setError('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const debouncedRefresh = useDebouncedCallback(() => fetchSummary(), 2000);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchSummary(), fetchPinnedArtifacts()]);
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchSummary();
    fetchPinnedArtifacts();
  }, []);

  // WS-triggered refresh
  useEffect(() => {
    const unsubs = [
      subscribe('system:notification', debouncedRefresh),
      subscribe('channel:message', debouncedRefresh),
      subscribe('tool:end', debouncedRefresh),
      subscribe<{ entity: string }>('data:changed', (data) => {
        debouncedRefresh();
        if (data.entity === 'artifact') fetchPinnedArtifacts();
      }),
      subscribe('trigger:executed', debouncedRefresh),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, debouncedRefresh]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <SkeletonStats count={4} />
        <SkeletonCard count={3} />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg text-center">
          <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={fetchSummary}
            className="mt-3 px-4 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Safely compute task completion (fallback prevents NaN)
  const tasksCompleted =
    summary?.tasks.completed ?? (summary ? summary.tasks.total - summary.tasks.pending : 0);
  const tasksTotal = summary?.tasks.total ?? 0;
  const completionPct = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;
  const habits = (summary as Record<string, unknown> | null)?.habits as
    | { total: number; completedToday: number; totalToday: number; percentage: number; bestStreak: number }
    | undefined;

  const stats = summary
    ? [
        {
          label: 'Pending Tasks',
          value: summary.tasks.pending,
          sub: summary.tasks.overdue > 0 ? `${summary.tasks.overdue} overdue` : undefined,
          icon: CheckCircle2,
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          alert: summary.tasks.overdue > 0,
          link: '/tasks',
        },
        {
          label: 'Notes',
          value: summary.notes.total,
          sub: summary.notes.pinned > 0 ? `${summary.notes.pinned} pinned` : undefined,
          icon: FileText,
          color: 'text-warning',
          bgColor: 'bg-warning/10',
          alert: false,
          link: '/notes',
        },
        {
          label: 'Events',
          value: summary.calendar.total,
          sub:
            summary.calendar.upcoming > 0
              ? `${summary.calendar.upcoming} upcoming`
              : summary.calendar.today > 0
                ? `${summary.calendar.today} today`
                : undefined,
          icon: Calendar,
          color: 'text-success',
          bgColor: 'bg-success/10',
          alert: false,
          link: '/calendar',
        },
        {
          label: 'Contacts',
          value: summary.contacts.total,
          sub:
            summary.contacts.favorites > 0 ? `${summary.contacts.favorites} favorites` : undefined,
          icon: Users,
          color: 'text-purple-500',
          bgColor: 'bg-purple-500/10',
          alert: false,
          link: '/contacts',
        },
        {
          label: 'Bookmarks',
          value: summary.bookmarks.total,
          sub:
            summary.bookmarks.favorites > 0
              ? `${summary.bookmarks.favorites} favorites`
              : undefined,
          icon: Bookmark,
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10',
          alert: false,
          link: '/bookmarks',
        },
        ...(habits
          ? [
              {
                label: 'Habits',
                value: habits.total,
                sub:
                  habits.totalToday > 0
                    ? `${habits.completedToday}/${habits.totalToday} today`
                    : habits.bestStreak > 0
                      ? `${habits.bestStreak}d streak`
                      : undefined,
                icon: Repeat,
                color: 'text-emerald-500',
                bgColor: 'bg-emerald-500/10',
                alert: false,
                link: '/habits',
              },
            ]
          : []),
      ]
    : [];

  // Render Overview Tab (original content)
  const renderOverviewTab = () => (
    <>
      {/* AI Briefing Card */}
      <AIBriefingCard />

      {/* Stats Grid — 5 cards, responsive */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className={`card-elevated card-hover p-4 bg-bg-secondary dark:bg-dark-bg-secondary border rounded-xl transition-colors ${
              stat.alert
                ? 'border-error/40 hover:border-error'
                : 'border-border dark:border-dark-border hover:border-primary'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center flex-shrink-0`}
              >
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary leading-tight">
                  {stat.value}
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                  {stat.label}
                </p>
              </div>
            </div>
            {stat.sub && (
              <p
                className={`mt-2 text-xs ${stat.alert ? 'text-error' : 'text-text-muted dark:text-dark-text-muted'}`}
              >
                {stat.sub}
              </p>
            )}
          </Link>
        ))}
      </div>

      {/* Task Progress Bar */}
      {summary && tasksTotal > 0 && (
        <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-success" />
              Task Progress
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                {completionPct}%
              </span>
              <Link to="/tasks" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
          </div>
          <div className="h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-success rounded-full transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-text-muted dark:text-dark-text-muted">
            <span>{tasksCompleted} completed</span>
            <span>{summary.tasks.pending} pending</span>
            {summary.tasks.overdue > 0 && (
              <span className="text-error">{summary.tasks.overdue} overdue</span>
            )}
          </div>
        </div>
      )}

      {/* Pinned Artifacts */}
      {pinnedArtifacts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
              Pinned Artifacts
            </h3>
            <Link to="/artifacts" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {pinnedArtifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onUpdate={(updated) =>
                  setPinnedArtifacts((prev) =>
                    updated.pinned
                      ? prev.map((a) => (a.id === updated.id ? updated : a))
                      : prev.filter((a) => a.id !== updated.id)
                  )
                }
                onDelete={(id) => setPinnedArtifacts((prev) => prev.filter((a) => a.id !== id))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Fleet Overview (if any fleets exist) */}
      <FleetWidget limit={4} />

      {/* Two-column: Timeline + Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Timeline */}
        <TimelineView />

        {/* Quick Actions */}
        <div className="space-y-6">
          <div className="card-elevated p-5 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-4">
              Quick Add
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_ADD_ITEMS.map(({ type, icon: Icon, label, color }) => (
                <button
                  key={type}
                  onClick={() => setQuickAddType(type)}
                  className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-transparent hover:border-border dark:hover:border-dark-border transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-bg-primary dark:bg-dark-bg-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted group-hover:text-text-primary dark:group-hover:text-dark-text-primary">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Upcoming Events */}
          {summary && summary.calendar.upcoming > 0 && (
            <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Upcoming Events
                </h3>
                <Link to="/calendar" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                {summary.calendar.upcoming} event{summary.calendar.upcoming !== 1 ? 's' : ''} coming
                up this week
              </p>
            </div>
          )}

          {/* Captures hint */}
          {summary && (
            <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Capture a thought
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">
                    Quickly save ideas, snippets, or reminders
                  </p>
                </div>
                <button
                  onClick={() => setQuickAddType('capture')}
                  className="ml-auto px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
                >
                  Capture
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // Render Agents Tab
  const renderAgentsTab = () => (
    <div className="space-y-4">
      <SystemStatsWidget />
      <div className="grid gap-4 lg:grid-cols-2">
        <SoulAgentsWidget limit={8} />
        <BackgroundAgentsWidget limit={8} />
        <FleetWidget limit={8} />
        <CrewsWidget limit={8} />
      </div>
    </div>
  );

  // Render Automation Tab
  const renderAutomationTab = () => (
    <div className="space-y-4">
      <SystemStatsWidget />
      <div className="grid gap-4 lg:grid-cols-2">
        <WorkflowsWidget limit={8} />
        <HeartbeatLogsWidget limit={8} />
      </div>
    </div>
  );

  // Render Extensions Tab
  const renderExtensionsTab = () => (
    <div className="space-y-4">
      <SystemStatsWidget />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkillsWidget limit={8} />
        <SubagentsWidget limit={8} />
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'agents':
        return renderAgentsTab();
      case 'automation':
        return renderAutomationTab();
      case 'extensions':
        return renderExtensionsTab();
      default:
        return renderOverviewTab();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Dashboard
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Your personal assistant overview
          </p>
        </div>
        {lastUpdated && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 text-text-muted dark:text-dark-text-muted ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {lastUpdated.toLocaleTimeString()}
            </span>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="px-6 pt-4 border-b border-border dark:border-dark-border">
        <div className="flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  isActive
                    ? 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary border-t border-l border-r border-border dark:border-dark-border'
                    : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">{renderTabContent()}</div>

      {/* Quick Add Modal */}
      {quickAddType && (
        <QuickAddModal
          type={quickAddType}
          onClose={() => setQuickAddType(null)}
          onCreated={fetchSummary}
        />
      )}
    </div>
  );
}

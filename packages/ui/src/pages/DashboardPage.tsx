import { useState, useEffect, useRef, useCallback } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  FileText,
  Bookmark,
  Users,
  Calendar,
  AlertTriangle,
  Clock,
  TrendingUp,
  Target,
} from '../components/icons';
import { AIBriefingCard } from '../components/AIBriefingCard';
import { TimelineView } from '../components/TimelineView';
import { SkeletonStats, SkeletonCard } from '../components/Skeleton';

import { summaryApi } from '../api';
import type { SummaryData } from '../types';

export function DashboardPage() {
  const { subscribe } = useGateway();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSummary = async () => {
    try {
      const data = await summaryApi.get();
      setSummary(data);
      setLastUpdated(new Date());
    } finally {
      setIsLoading(false);
    }
  };

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSummary(), 2000);
  }, []);

  useEffect(() => {
    fetchSummary();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <SkeletonStats count={4} />
        <SkeletonCard count={3} />
      </div>
    );
  }

  const stats = summary
    ? [
        {
          label: 'Pending Tasks',
          value: summary.tasks.pending,
          icon: CheckCircle2,
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          link: '/tasks',
        },
        {
          label: 'Overdue',
          value: summary.tasks.overdue,
          icon: AlertTriangle,
          color: summary.tasks.overdue > 0 ? 'text-error' : 'text-text-muted',
          bgColor: summary.tasks.overdue > 0 ? 'bg-error/10' : 'bg-text-muted/10',
          link: '/tasks',
        },
        {
          label: 'Notes',
          value: summary.notes.total,
          icon: FileText,
          color: 'text-success',
          bgColor: 'bg-success/10',
          link: '/notes',
        },
        {
          label: 'Bookmarks',
          value: summary.bookmarks.total,
          icon: Bookmark,
          color: 'text-warning',
          bgColor: 'bg-warning/10',
          link: '/bookmarks',
        },
        {
          label: 'Events Today',
          value: summary.calendar.today,
          icon: Calendar,
          color: 'text-primary',
          bgColor: 'bg-primary/10',
          link: '/calendar',
        },
        {
          label: 'Contacts',
          value: summary.contacts.total,
          icon: Users,
          color: 'text-info',
          bgColor: 'bg-info/10',
          link: '/contacts',
        },
      ]
    : [];

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
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            Last updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* AI Briefing Card */}
        <AIBriefingCard />

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              to={stat.link}
              className="card-elevated card-hover p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                    {stat.value}
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    {stat.label}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Timeline and Quick Actions Grid */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          {/* Timeline */}
          <TimelineView />

          {/* Quick Actions & Goals */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
              <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-4">
                Quick Actions
              </h3>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/tasks"
                  className="flex items-center gap-2 px-3 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors text-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Add Task
                </Link>
                <Link
                  to="/notes"
                  className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors text-sm"
                >
                  <FileText className="w-4 h-4" />
                  New Note
                </Link>
                <Link
                  to="/bookmarks"
                  className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors text-sm"
                >
                  <Bookmark className="w-4 h-4" />
                  Add Bookmark
                </Link>
                <Link
                  to="/calendar"
                  className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors text-sm"
                >
                  <Calendar className="w-4 h-4" />
                  Schedule Event
                </Link>
                <Link
                  to="/goals"
                  className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors text-sm"
                >
                  <Target className="w-4 h-4" />
                  New Goal
                </Link>
              </div>
            </div>

            {/* Task Progress (moved here) */}
            {summary && summary.tasks.total > 0 && (
              <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-success" />
                    Task Progress
                  </h3>
                  <Link
                    to="/tasks"
                    className="text-sm text-primary hover:underline"
                  >
                    View all
                  </Link>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted dark:text-dark-text-muted">
                      {summary.tasks.completed} of {summary.tasks.total} completed
                    </span>
                    <span className="text-text-primary dark:text-dark-text-primary font-medium">
                      {Math.round((summary.tasks.completed / summary.tasks.total) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-success rounded-full transition-all"
                      style={{
                        width: `${(summary.tasks.completed / summary.tasks.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Events */}
        {summary && summary.calendar.upcoming > 0 && (
          <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Upcoming Events
              </h3>
              <Link
                to="/calendar"
                className="text-sm text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            <p className="text-text-muted dark:text-dark-text-muted">
              {summary.calendar.upcoming} event{summary.calendar.upcoming !== 1 ? 's' : ''} coming up this week
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

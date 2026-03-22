/**
 * System Stats Widget - Shows aggregate system statistics
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Users, GitBranch, Heart, Puzzle, Zap, AlertCircle, Plus } from '../icons';
import {
  soulsApi,
  crewsApi,
  workflowsApi,
  extensionsApi,
  heartbeatLogsApi,
  subagentsApi,
} from '../../api';
import { Skeleton } from '../Skeleton';

interface SystemStats {
  souls: number;
  crews: number;
  workflows: number;
  extensions: number;
  heartbeatLogs: number;
  subagents: number;
}

export function SystemStatsWidget() {
  const [stats, setStats] = useState<SystemStats>({
    souls: 0,
    crews: 0,
    workflows: 0,
    extensions: 0,
    heartbeatLogs: 0,
    subagents: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const [souls, crews, extensions, heartbeats, subagents] = await Promise.all([
          soulsApi.list().catch(() => ({ items: [], total: 0 })),
          crewsApi.list().catch(() => ({ items: [], total: 0 })),
          extensionsApi.list().catch(() => []),
          heartbeatLogsApi.list(1, 0).catch(() => ({ items: [], total: 0 })),
          subagentsApi.getHistory(undefined, 1, 0).catch(() => ({ entries: [], total: 0 })),
        ]);

        // Get workflow count from recent logs
        let workflowCount = 0;
        try {
          const wfLogs = await workflowsApi.recentLogs({ limit: '100' });
          const uniqueWorkflows = new Set(wfLogs.logs.map((l) => l.workflowId).filter(Boolean));
          workflowCount = uniqueWorkflows.size;
        } catch {
          workflowCount = 0;
        }

        setStats({
          souls: souls.total,
          crews: crews.total,
          workflows: workflowCount,
          extensions: extensions.length,
          heartbeatLogs: heartbeats.total,
          subagents: subagents.total,
        });
      } catch {
        setError('Failed to load system stats');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const statItems = [
    {
      label: 'Souls',
      value: stats.souls,
      icon: Brain,
      link: '/autonomous',
      createLink: '/autonomous?new=1',
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Crews',
      value: stats.crews,
      icon: Users,
      link: '/autonomous?tab=crews',
      createLink: '/autonomous?new=crew',
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      label: 'Workflows',
      value: stats.workflows,
      icon: GitBranch,
      link: '/workflows',
      createLink: '/workflows/new',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      label: 'Extensions',
      value: stats.extensions,
      icon: Puzzle,
      link: '/extensions',
      createLink: '/skills',
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      label: 'Heartbeats',
      value: stats.heartbeatLogs,
      icon: Heart,
      link: '/autonomous?tab=logs',
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
    },
    {
      label: 'Subagents',
      value: stats.subagents,
      icon: Zap,
      link: '/subagents',
      color: 'text-cyan-500',
      bgColor: 'bg-cyan-500/10',
    },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  // Don't render if all stats are zero
  const totalItems = statItems.reduce((sum, item) => sum + item.value, 0);
  if (totalItems === 0) {
    return null;
  }

  return (
    <>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        {statItems.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="card-elevated card-hover p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl transition-colors hover:border-primary"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-lg ${stat.bgColor} flex items-center justify-center flex-shrink-0`}
              >
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold text-text-primary dark:text-dark-text-primary leading-tight">
                  {stat.value}
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                  {stat.label}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border dark:border-dark-border">
        <span className="text-xs text-text-muted dark:text-dark-text-muted mr-1">
          Quick create:
        </span>
        <Link
          to="/autonomous?new=1"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Soul
        </Link>
        <Link
          to="/autonomous?new=crew"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Crew
        </Link>
        <Link
          to="/workflows/new"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Workflow
        </Link>
        <Link
          to="/skills"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Skill
        </Link>
      </div>
    </>
  );
}

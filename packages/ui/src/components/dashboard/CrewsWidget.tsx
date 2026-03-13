/**
 * Crews Widget - Shows agent crews and their status
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  AlertCircle,
} from '../icons';
import { crewsApi, type AgentCrew, type CrewStatusMetrics } from '../../api';
import { Skeleton } from '../Skeleton';

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'text-success bg-success/10';
    case 'paused':
      return 'text-warning bg-warning/10';
    case 'disbanded':
      return 'text-error bg-error/10';
    default:
      return 'text-text-muted bg-text-muted/10 dark:text-dark-text-muted dark:bg-dark-text-muted/10';
  }
}

interface CrewsWidgetProps {
  limit?: number;
}

export function CrewsWidget({ limit = 6 }: CrewsWidgetProps) {
  const [crews, setCrews] = useState<AgentCrew[]>([]);
  const [crewMetrics, setCrewMetrics] = useState<Record<string, CrewStatusMetrics>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await crewsApi.list();
        setCrews(result.items);

        // Fetch status metrics for each crew in parallel
        const crewItems = result.items;
        const statusResults = await Promise.allSettled(
          crewItems.map((crew) => crewsApi.getStatus(crew.id))
        );

        const metricsMap: Record<string, CrewStatusMetrics> = {};
        statusResults.forEach((settledResult, i) => {
          const crewItem = crewItems[i];
          if (settledResult.status === 'fulfilled' && settledResult.value?.metrics && crewItem) {
            metricsMap[crewItem.id] = settledResult.value.metrics;
          }
        });
        setCrewMetrics(metricsMap);
      } catch {
        setError('Failed to load crews');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const displayCrews = crews.slice(0, limit);
  const activeCount = crews.filter((c) => c.status === 'active').length;

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Crews
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Crews
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displayCrews.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Crews
          </h3>
        </div>
        <div className="text-center py-6">
          <Users className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No crews yet
          </p>
          <Link
            to="/autonomous?tab=crews"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            Create one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Crews
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({crews.length})
          </span>
        </div>
        <span className="text-xs text-success">
          {activeCount} active
        </span>
      </div>

      <div className="space-y-2">
        {displayCrews.map((crew) => {
          const statusColor = getStatusColor(crew.status);
          const metrics = crewMetrics[crew.id];

          return (
            <Link
              key={crew.id}
              to={`/autonomous?crew=${crew.id}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${statusColor}`}
              >
                <Users className="w-4 h-4" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {crew.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                      crew.status === 'active'
                        ? 'bg-success/10 text-success'
                        : crew.status === 'paused'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-error/10 text-error'
                    }`}
                  >
                    {crew.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span className="capitalize">{crew.coordinationPattern}</span>
                  {crew.agents && (
                    <>
                      <span>·</span>
                      <span>{crew.agents.length} members</span>
                    </>
                  )}
                </div>
                {metrics && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {metrics.activeAgents > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-success/10 text-success">
                        {metrics.activeAgents} running
                      </span>
                    )}
                    {metrics.pausedAgents > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-warning/10 text-warning">
                        {metrics.pausedAgents} paused
                      </span>
                    )}
                    {metrics.unreadMessages > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/10 text-blue-500">
                        {metrics.unreadMessages} unread
                      </span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-500/10 text-purple-500">
                      {metrics.health}% health
                    </span>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {crews.length > limit && (
        <Link
          to="/autonomous?tab=crews"
          className="block text-center text-xs text-primary hover:underline mt-3 pt-3 border-t border-border dark:border-dark-border"
        >
          View all ({crews.length})
        </Link>
      )}
    </div>
  );
}

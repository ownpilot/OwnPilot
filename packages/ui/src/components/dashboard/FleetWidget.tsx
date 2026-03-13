/**
 * Fleet Widget - Shows fleet status overview with worker counts and task stats
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers,
  Play,
  Pause,
  Square,
  AlertCircle,
  DollarSign,
  Users,
  CheckCircle2,
} from '../icons';
import { fleetApi, type FleetConfig } from '../../api/endpoints/fleet';
import { Skeleton } from '../Skeleton';

function getStateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'text-success';
    case 'paused':
      return 'text-warning';
    case 'error':
    case 'stopped':
      return 'text-error';
    case 'completed':
      return 'text-info';
    default:
      return 'text-text-muted dark:text-dark-text-muted';
  }
}

function getStateIcon(state: string) {
  switch (state) {
    case 'running':
      return Play;
    case 'paused':
      return Pause;
    case 'stopped':
    case 'error':
      return Square;
    case 'completed':
      return CheckCircle2;
    default:
      return Square;
  }
}

interface FleetWidgetProps {
  limit?: number;
}

export function FleetWidget({ limit = 6 }: FleetWidgetProps) {
  const [fleets, setFleets] = useState<FleetConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const result = await fleetApi.list();
        setFleets(result);
      } catch {
        setError('Failed to load fleets');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const displayFleets = fleets.slice(0, limit);

  const runningCount = fleets.filter((f) => f.session?.state === 'running').length;
  const totalCost = fleets.reduce((sum, f) => sum + (f.session?.totalCostUsd || 0), 0);

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Fleets
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Fleets
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displayFleets.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-500" />
            <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              Fleets
            </h3>
          </div>
        </div>
        <div className="text-center py-6">
          <Layers className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">No fleets deployed</p>
          <Link to="/fleet" className="text-xs text-primary hover:underline mt-2 inline-block">
            Deploy your first fleet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Fleets
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({fleets.length})
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <Play className="w-3 h-3" />
            {runningCount} running
          </span>
          <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
            <DollarSign className="w-3 h-3" />${totalCost.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {displayFleets.map((fleet) => {
          const state = fleet.session?.state || 'stopped';
          const StateIcon = getStateIcon(state);

          return (
            <Link
              key={fleet.id}
              to="/fleet"
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  state === 'running'
                    ? 'bg-success/10'
                    : state === 'error'
                      ? 'bg-error/10'
                      : 'bg-purple-500/10'
                }`}
              >
                <StateIcon className={`w-4 h-4 ${getStateColor(state)}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {fleet.name}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      state === 'running'
                        ? 'bg-success/10 text-success'
                        : state === 'paused'
                          ? 'bg-warning/10 text-warning'
                          : state === 'error'
                            ? 'bg-error/10 text-error'
                            : 'bg-text-muted/10 text-text-muted dark:bg-dark-text-muted/10 dark:text-dark-text-muted'
                    }`}
                  >
                    {state}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {fleet.workers.length} workers
                  </span>
                  {fleet.session && (
                    <>
                      <span>·</span>
                      <span>
                        {fleet.session.tasksCompleted} done / {fleet.session.tasksFailed} failed
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

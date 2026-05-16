/**
 * GlobalStatusBar — compact header showing pulse engine status and budget
 */

import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import type { UnifiedAgent } from '../types';
import { formatCost } from '../helpers';
import { agentsOverviewApi } from '../../../api';
import type { AgentOverview } from '../../../api';
import { silentCatch } from '../../../utils/ignore-error';

interface Props {
  agents: UnifiedAgent[];
  isRefreshing?: boolean;
  isConnected?: boolean;
}

export function GlobalStatusBar({ agents, isRefreshing, isConnected }: Props) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);

  useEffect(() => {
    agentsOverviewApi.overview().then(setOverview).catch(silentCatch('agentsOverview'));
  }, []);

  const running = agents.filter(
    (a) => a.status === 'running' || a.status === 'starting' || a.status === 'waiting'
  ).length;
  const paused = agents.filter((a) => a.status === 'paused').length;
  const errors = agents.filter((a) => a.status === 'error').length;
  const totalCost = agents.reduce((sum, a) => sum + a.todayCost, 0);

  const runnerCount = overview
    ? [
        overview.subagent.stats.total > 0 ? 'subagent' : null,
        overview.fleet.stats.totalFleets > 0 ? 'fleet' : null,
        overview.orchestra.stats.total > 0 ? 'orchestra' : null,
        overview.soul.stats.totalCycles > 0 ? 'soul' : null,
        overview.crew.stats.totalCrews > 0 ? 'crew' : null,
        overview.claw.stats.total > 0 ? 'claw' : null,
      ].filter(Boolean).length
    : 0;

  return (
    <div className="flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
      <span className="text-text-primary dark:text-dark-text-primary font-medium">
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </span>
      {running > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="relative flex">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-success" />
          </span>
          <span className="text-success font-medium">{running} running</span>
        </span>
      )}
      {paused > 0 && <span className="text-warning font-medium">{paused} paused</span>}
      {errors > 0 && (
        <span className="flex items-center gap-1 text-danger font-medium">
          <span className="inline-flex rounded-full w-2 h-2 bg-danger" />
          {errors} error{errors !== 1 ? 's' : ''}
        </span>
      )}
      {totalCost > 0 && <span>{formatCost(totalCost)} today</span>}
      {overview && runnerCount > 0 && (
        <span className="text-xs text-text-muted">
          · {runnerCount} runner{runnerCount !== 1 ? 's' : ''} active
        </span>
      )}
      {isRefreshing && <span className="text-primary animate-pulse">Refreshing...</span>}
      {isConnected !== undefined && (
        <span
          className={`flex items-center gap-1 ${isConnected ? 'text-success' : 'text-text-muted dark:text-dark-text-muted'}`}
        >
          <span
            className={`inline-flex rounded-full w-1.5 h-1.5 ${isConnected ? 'bg-success' : 'bg-text-muted dark:bg-dark-text-muted'}`}
          />
          {isConnected ? 'Live' : 'Offline'}
        </span>
      )}
      <Link to="/autonomy" className="text-primary hover:text-primary-dark transition-colors">
        Autonomy Settings →
      </Link>
    </div>
  );
}

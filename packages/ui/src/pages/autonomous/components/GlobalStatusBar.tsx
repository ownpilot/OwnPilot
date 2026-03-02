/**
 * GlobalStatusBar — compact header showing pulse engine status and budget
 */

import { Link } from 'react-router-dom';
import type { UnifiedAgent } from '../types';

interface Props {
  agents: UnifiedAgent[];
}

export function GlobalStatusBar({ agents }: Props) {
  const running = agents.filter(
    (a) => a.status === 'running' || a.status === 'starting' || a.status === 'waiting'
  ).length;
  const totalCost = agents.reduce((sum, a) => sum + a.todayCost, 0);

  return (
    <div className="flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
      <span className="text-text-primary dark:text-dark-text-primary font-medium">
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </span>
      {running > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="relative flex">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-green-500" />
          </span>
          <span className="text-green-600 dark:text-green-400 font-medium">{running} running</span>
        </span>
      )}
      {totalCost > 0 && <span>${totalCost.toFixed(2)} today</span>}
      <Link to="/autonomy" className="text-primary hover:text-primary-dark transition-colors">
        Autonomy Settings →
      </Link>
    </div>
  );
}

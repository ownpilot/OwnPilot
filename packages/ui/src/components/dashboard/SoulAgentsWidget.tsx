/**
 * Soul Agents Widget - Shows active soul agents with status, autonomy level, last heartbeat
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Brain,
  Heart,
  Clock,
  AlertCircle,
  Pause,
  Zap,
} from '../icons';
import { soulsApi, type AgentSoul, type HeartbeatLog } from '../../api';
import { Skeleton } from '../Skeleton';

function getAutonomyLabel(level: number): string {
  const labels = ['Manual', 'Guided', 'Supervised', 'Autonomous', 'Fully Autonomous'];
  return labels[level] || 'Unknown';
}

function getAutonomyColor(level: number): string {
  if (level <= 1) return 'text-text-muted dark:text-dark-text-muted';
  if (level <= 2) return 'text-blue-500';
  if (level <= 3) return 'text-warning';
  return 'text-success';
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-success/10 text-success">
      <Heart className="w-3 h-3" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-text-muted/10 text-text-muted dark:bg-dark-text-muted/10 dark:text-dark-text-muted">
      <Pause className="w-3 h-3" />
      Paused
    </span>
  );
}

interface SoulAgentsWidgetProps {
  limit?: number;
}

export function SoulAgentsWidget({ limit = 6 }: SoulAgentsWidgetProps) {
  const [souls, setSouls] = useState<AgentSoul[]>([]);
  const [lastHeartbeats, setLastHeartbeats] = useState<Record<string, HeartbeatLog>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const [soulsResult, heartbeatsResult] = await Promise.all([
          soulsApi.list(),
          heartbeatLogsApi.list(limit * 2, 0),
        ]);

        setSouls(soulsResult.items);

        // Map latest heartbeat to each agent
        const heartbeats: Record<string, HeartbeatLog> = {};
        for (const log of heartbeatsResult.items) {
          if (!heartbeats[log.agentId]) {
            heartbeats[log.agentId] = log;
          }
        }
        setLastHeartbeats(heartbeats);
      } catch {
        setError('Failed to load soul agents');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [limit]);

  const displaySouls = souls.slice(0, limit);

  if (isLoading) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Soul Agents
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
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Soul Agents
          </h3>
        </div>
        <div className="flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (displaySouls.length === 0) {
    return (
      <div className="card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Soul Agents
          </h3>
        </div>
        <div className="text-center py-6">
          <Bot className="w-8 h-8 text-text-muted dark:text-dark-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            No soul agents yet
          </p>
          <Link
            to="/autonomous"
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
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Soul Agents
          </h3>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            ({souls.length})
          </span>
        </div>
        <Link to="/autonomous" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>

      <div className="space-y-2">
        {displaySouls.map((soul) => {
          const lastHeartbeat = lastHeartbeats[soul.agentId];
          return (
            <Link
              key={soul.agentId}
              to={`/autonomous?agent=${soul.agentId}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-lg">{soul.identity.emoji || '🤖'}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                    {soul.identity.name}
                  </span>
                  <StatusBadge enabled={soul.heartbeat.enabled} />
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                  <span className={getAutonomyColor(soul.autonomy.level)}>
                    <Zap className="w-3 h-3 inline mr-0.5" />
                    {getAutonomyLabel(soul.autonomy.level)}
                  </span>
                  {lastHeartbeat && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(lastHeartbeat.createdAt).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-xs text-text-muted dark:text-dark-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                {soul.identity.role}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Import heartbeatLogsApi for fetching heartbeats
import { heartbeatLogsApi } from '../../api';